import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { StatusBadge } from '@/components/StatusBadge'
import { REQUEST_TONE } from '@/components/statusTones'
import { Button, Notice, Spinner } from '@/components/ui'
import { listMaterials } from '@/data/materialsRepo'
import { listNormUsage } from '@/data/normsRepo'
import { listObjects } from '@/data/objectsRepo'
import {
  REQUESTS_PAGE_SIZE,
  approveRequest,
  listAllRequests,
  listRequests,
  markRequestPurchased,
  rejectRequest,
  type RequestFilters,
} from '@/data/requestsRepo'
import { REQUEST_STATUSES, type Material, type MaterialRequest, type NormUsage, type ObjectRow, type RequestStatus } from '@/data/types'
import { sub } from '@/domain/decimal'
import { usagePct } from '@/domain/norms'
import { can } from '@/domain/roles'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDate, formatDateTime, formatQty } from '@/lib/format'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { requestNormState } from '@/lib/requestNorm'
import { ExportButton } from '../ExportButton'
import { requestsSheet } from '../exports'
import { paramId, paramOneOf } from '../urlFilters'
import { Pager, RetryNotice, SelectField } from '../fields'
import { NormProgress } from '../norms/NormProgress'
import { PurchasedDialog, RejectDialog } from '../requests/RequestDialogs'

const tp = t.requestsPage

type StatusFilter = 'all' | RequestStatus

interface FilterForm {
  status: StatusFilter
  objectId: string
  materialId: string
}

const EMPTY: FilterForm = { status: 'kutilmoqda', objectId: '', materialId: '' }

function toFilters(f: FilterForm): RequestFilters {
  return {
    statuses: f.status === 'all' ? undefined : [f.status],
    objectId: f.objectId || undefined,
    materialId: f.materialId || undefined,
  }
}

const OPEN: readonly RequestStatus[] = ['kutilmoqda', 'tasdiqlandi']

/**
 * So'rov qatori uchun smeta holati (hozirgi holat bo'yicha): qolgan / ortiqcha (qizil) / smetada yo'q /
 * obyektda joriy smeta yo'q, ishlatilish foizi. `objectNorms` — obyektning barcha `norm_usage` qatorlari.
 */
function EstimateCell({ request, objectNorms }: { request: MaterialRequest; objectNorms: NormUsage[] }) {
  const unit = request.base_unit ?? ''
  const norm = objectNorms.find((n) => n.material_id === request.material_id)
  // `requested_open_qty_base` shu so'rovni ham o'z ichiga oladi (ochiq bo'lsa) — boshqalari ajratiladi
  const other =
    norm && OPEN.includes(request.status) ? sub(norm.requested_open_qty_base, request.qty_base) : norm?.requested_open_qty_base
  const state = requestNormState(objectNorms, request.material_id, request.qty_base, other)
  if (state.kind === 'no_estimate') return <StatusBadge tone="neutral">{tp.noEstimate}</StatusBadge>
  if (state.kind === 'not_in_estimate' || !norm) return <StatusBadge tone="warn">{tp.notInEstimate}</StatusBadge>
  return (
    <div className="flex flex-col gap-1">
      {state.kind === 'over' ? (
        <span data-testid="norm-over" className="text-sm font-semibold text-danger">
          {tp.normOver(`${formatQty(state.overQty)} ${unit}`.trim())}
        </span>
      ) : (
        <span data-testid="norm-left" className="text-sm text-slate-700">
          {tp.normLeft(`${formatQty(state.available)} ${unit}`.trim())}
        </span>
      )}
      <NormProgress pct={usagePct(norm.consumed_qty_base, norm.allowed_qty_base)} label={tp.colEstimate} />
    </div>
  )
}

/** So'rovlar: admin — tasdiqlash / rad etish (sabab bilan), ta'minotchi — "Xarid qilindi". */
export function RequestsPage() {
  const { profile: me } = useAuth()
  const [objects, setObjects] = useState<ObjectRow[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [params] = useSearchParams()
  // Bosh sahifa havolalari: ?status=kutilmoqda&object=...
  const [form, setForm] = useState<FilterForm>(() => ({
    status: paramOneOf<StatusFilter>(params, 'status', ['all', ...REQUEST_STATUSES], EMPTY.status) || EMPTY.status,
    objectId: paramId(params, 'object'),
    materialId: paramId(params, 'material'),
  }))
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ rows: MaterialRequest[]; total: number } | null>(null)
  // obyekt → norma qatorlari (faqat so'ralgan obyektlar; yo'q bo'lsa — hali yuklanmagan)
  const [norms, setNorms] = useState<Map<string, NormUsage[]> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<MaterialRequest | null>(null)
  const [purchasing, setPurchasing] = useState<MaterialRequest | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    listObjects()
      .then((list) => alive && setObjects(list))
      .catch(() => undefined)
    Promise.resolve(listMaterials())
      .then((list) => alive && setMaterials(list ?? []))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    listRequests(toFilters(form), page)
      .then(async (result) => {
        if (!alive) return
        setData(result)
        setError(null)
        const objectIds = [...new Set(result.rows.map((r) => r.object_id))]
        // Smeta holati — qo'shimcha: xato bo'lsa ham ro'yxat ko'rsatiladi
        const rows = await listNormUsage({ objectIds }).catch(() => [] as NormUsage[])
        if (!alive) return
        const map = new Map<string, NormUsage[]>(objectIds.map((id) => [id, []]))
        for (const n of rows) map.get(n.object_id)?.push(n)
        setNorms(map)
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    return () => {
      alive = false
    }
  }, [form, page, reloadKey])

  const update = (patch: Partial<FilterForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setPage(0)
  }

  const act = async (id: string, action: () => Promise<void>): Promise<boolean> => {
    setBusyId(id)
    setActionError(null)
    try {
      await action()
      reload()
      return true
    } catch (err) {
      setActionError(errorText(err))
      return false
    } finally {
      setBusyId(null)
    }
  }

  const sortedMaterials = useMemo(() => [...materials].sort((a, b) => a.name.localeCompare(b.name)), [materials])

  if (!me) return null
  const canApprove = can(me.role, 'approve_request')
  const canPurchase = can(me.role, 'mark_request_purchased')
  const showActions = canApprove || canPurchase

  const actions = (r: MaterialRequest) => (
    <div className="flex flex-wrap gap-2">
      {canApprove && r.status === 'kutilmoqda' && (
        <>
          <Button disabled={busyId === r.id} onClick={() => void act(r.id, () => approveRequest(r.id))}>
            {tp.approve}
          </Button>
          <Button
            variant="danger"
            disabled={busyId === r.id}
            onClick={() => {
              setActionError(null)
              setRejecting(r)
            }}
          >
            {tp.reject}
          </Button>
        </>
      )}
      {canPurchase && r.status === 'tasdiqlandi' && (
        <Button
          variant="secondary"
          disabled={busyId === r.id}
          onClick={() => {
            setActionError(null)
            setPurchasing(r)
          }}
        >
          {tp.purchased}
        </Button>
      )}
    </div>
  )

  const qtyText = (r: MaterialRequest) => `${formatQty(r.qty_input)} ${unitLabel({ unit: r.unit_input, variant: r.unit_variant })}`
  const statusCell = (r: MaterialRequest) => (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone={REQUEST_TONE[r.status]}>{t.requests.statuses[r.status]}</StatusBadge>
      {r.decision_note && (
        <span className="text-xs text-slate-600">
          {tp.decisionNote}: {r.decision_note}
        </span>
      )}
      {r.decided_by_name && r.status !== 'kutilmoqda' && (
        <span className="text-xs text-slate-500">{tp.decidedBy(r.decided_by_name)}</span>
      )}
    </span>
  )
  const neededText = (r: MaterialRequest) => (r.needed_by ? formatDate(`${r.needed_by}T12:00:00+05:00`) : '—')

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-brand-dark">{tp.title}</h1>
        <ExportButton
          run={async (signal) => {
            const rows = await listAllRequests(toFilters(form), signal)
            await exportWorkbook({
              fileName: exportFileName(t.excel.sections.requests),
              sheets: [requestsSheet(rows)],
              signal,
            })
          }}
        />
      </div>

      <form
        aria-label={t.ombor.filters}
        onSubmit={(e) => e.preventDefault()}
        className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3"
      >
        <SelectField label={tp.filterStatus} value={form.status} onChange={(v) => update({ status: v as StatusFilter })}>
          {REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.requests.statuses[s]}
            </option>
          ))}
          <option value="all">{tp.all}</option>
        </SelectField>
        <SelectField label={tp.filterObject} value={form.objectId} onChange={(v) => update({ objectId: v })}>
          <option value="">{tp.all}</option>
          {objects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={tp.filterMaterial} value={form.materialId} onChange={(v) => update({ materialId: v })}>
          <option value="">{tp.all}</option>
          {sortedMaterials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
      </form>

      {error && <RetryNotice message={error} onRetry={reload} />}
      {actionError && !rejecting && !purchasing && <Notice>{actionError}</Notice>}
      {!data && !error && <Spinner />}
      {data && data.rows.length === 0 && <p className="text-slate-600">{tp.empty}</p>}

      {data && data.rows.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">{tp.colDate}</th>
                  <th className="px-3 py-2 font-medium">{tp.colObject}</th>
                  <th className="px-3 py-2 font-medium">{tp.colMaterial}</th>
                  <th className="px-3 py-2 text-right font-medium">{tp.colQty}</th>
                  <th className="px-3 py-2 font-medium">{tp.colNeeded}</th>
                  <th className="px-3 py-2 font-medium">{tp.colAuthor}</th>
                  <th className="px-3 py-2 font-medium">
                    {tp.colEstimate}
                    <span className="block text-xs font-normal text-slate-500">{tp.currentHint}</span>
                  </th>
                  <th className="px-3 py-2 font-medium">{tp.colStatus}</th>
                  {showActions && <th className="px-3 py-2 font-medium">{tp.colActions}</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} data-testid="request-row" className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(r.created_at)}</td>
                    <td className="px-3 py-2">{r.object_name ?? '—'}</td>
                    <td className="px-3 py-2 font-medium">{r.material_name ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {qtyText(r)}
                      <span className="block text-xs text-slate-500">
                        = {formatQty(r.qty_base)} {r.base_unit ?? ''}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{neededText(r)}</td>
                    <td className="px-3 py-2">
                      {r.created_by_name ?? '—'}
                      {r.note && <span className="block text-xs text-slate-500">{r.note}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {norms && <EstimateCell request={r} objectNorms={norms.get(r.object_id) ?? []} />}
                    </td>
                    <td className="px-3 py-2">{statusCell(r)}</td>
                    {showActions && <td className="px-3 py-2">{actions(r)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 md:hidden" aria-label={tp.title}>
            {data.rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-900">
                    {r.material_name} · {qtyText(r)}
                  </p>
                  {statusCell(r)}
                </div>
                <p className="text-sm text-slate-600">
                  {r.object_name ?? '—'} · {r.created_by_name ?? '—'} · {formatDateTime(r.created_at)}
                </p>
                {r.needed_by && (
                  <p className="text-sm text-slate-600">
                    {tp.colNeeded}: {neededText(r)}
                  </p>
                )}
                {norms && <EstimateCell request={r} objectNorms={norms.get(r.object_id) ?? []} />}
                {showActions && actions(r)}
              </li>
            ))}
          </ul>

          <Pager page={page} pageSize={REQUESTS_PAGE_SIZE} total={data.total} onPage={setPage} />
        </>
      )}

      {rejecting && (
        <RejectDialog
          request={rejecting}
          busy={busyId === rejecting.id}
          error={actionError}
          onCancel={() => setRejecting(null)}
          onConfirm={(reason) =>
            void act(rejecting.id, () => rejectRequest(rejecting.id, reason)).then((ok) => ok && setRejecting(null))
          }
        />
      )}
      {purchasing && (
        <PurchasedDialog
          request={purchasing}
          busy={busyId === purchasing.id}
          error={actionError}
          onCancel={() => setPurchasing(null)}
          onConfirm={(purchaseId) =>
            void act(purchasing.id, () => markRequestPurchased(purchasing.id, purchaseId)).then(
              (ok) => ok && setPurchasing(null),
            )
          }
        />
      )}
    </div>
  )
}
