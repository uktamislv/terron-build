import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { REQUEST_TONE } from '@/components/statusTones'
import { Check, ClipboardList, ShoppingCart, X } from 'lucide-react'
import { Badge, Button, DataTable, EmptyState, EntryRow, FilterBar, Notice, PageHeader, Pager, Qty, RetryNotice, Spinner } from '@/components/ui'
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
import { NormProgress } from '../norms/NormProgress'
import { PurchasedDialog, RejectDialog } from '../requests/RequestDialogs'

const tp = t.requestsPage
const ic = { className: 'size-5', strokeWidth: 1.75, 'aria-hidden': true } as const

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
  if (state.kind === 'no_estimate') return <Badge tone="neutral">{tp.noEstimate}</Badge>
  if (state.kind === 'not_in_estimate' || !norm) return <Badge tone="warn">{tp.notInEstimate}</Badge>
  return (
    <div className="flex flex-col gap-1">
      {state.kind === 'over' ? (
        <span data-testid="norm-over" className="text-sm font-semibold text-danger">
          {tp.normOver(`${formatQty(state.overQty)} ${unit}`.trim())}
        </span>
      ) : (
        <span data-testid="norm-left" className="text-sm text-muted">
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

  const actions = (r: MaterialRequest) => {
    const approve = canApprove && r.status === 'kutilmoqda'
    const purchase = canPurchase && r.status === 'tasdiqlandi'
    if (!approve && !purchase) return null
    return (
      <div className="flex flex-wrap justify-end gap-1">
        {approve && (
          <>
            <Button size="sm" icon={<Check {...ic} />} disabled={busyId === r.id} onClick={() => void act(r.id, () => approveRequest(r.id))}>
              {tp.approve}
            </Button>
            <Button
              variant="ghost"
              className="text-danger! hover:bg-danger-bg!"
              size="sm"
              icon={<X {...ic} />}
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
        {purchase && (
          <Button
            variant="secondary"
            size="sm"
            icon={<ShoppingCart {...ic} />}
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
  }

  const inputUnit = (r: MaterialRequest) => unitLabel({ unit: r.unit_input, variant: r.unit_variant })
  const statusBadge = (r: MaterialRequest) => <Badge tone={REQUEST_TONE[r.status]}>{t.requests.statuses[r.status]}</Badge>
  const decision = (r: MaterialRequest) => (
    <>
      {r.decision_note && (
        <span className="text-xs text-muted">
          {tp.decisionNote}: {r.decision_note}
        </span>
      )}
      {r.decided_by_name && r.status !== 'kutilmoqda' && <span className="text-xs text-muted">{tp.decidedBy(r.decided_by_name)}</span>}
    </>
  )
  const neededText = (r: MaterialRequest) => (r.needed_by ? formatDate(`${r.needed_by}T12:00:00+05:00`) : '—')
  const estimate = (r: MaterialRequest) => (norms ? <EstimateCell request={r} objectNorms={norms.get(r.object_id) ?? []} /> : null)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={tp.title}
        icon={<ClipboardList strokeWidth={1.75} />}
        actions={
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
        }
      />

      <FilterBar
        label={t.ombor.filters}
        onClear={() => update(EMPTY)}
        filters={[
          {
            kind: 'select',
            key: 'status',
            label: tp.filterStatus,
            value: form.status,
            emptyValue: EMPTY.status,
            onChange: (v) => update({ status: v as StatusFilter }),
            options: [...REQUEST_STATUSES.map((s) => ({ value: s, label: t.requests.statuses[s] })), { value: 'all', label: tp.all }],
          },
          {
            kind: 'select',
            key: 'object',
            label: tp.filterObject,
            value: form.objectId,
            onChange: (v) => update({ objectId: v }),
            options: [{ value: '', label: tp.all }, ...objects.map((o) => ({ value: o.id, label: o.name }))],
          },
          {
            kind: 'select',
            key: 'material',
            label: tp.filterMaterial,
            value: form.materialId,
            onChange: (v) => update({ materialId: v }),
            options: [{ value: '', label: tp.all }, ...sortedMaterials.map((m) => ({ value: m.id, label: m.name }))],
          },
        ]}
      />

      {error && <RetryNotice message={error} onRetry={reload} />}
      {actionError && !rejecting && !purchasing && <Notice>{actionError}</Notice>}
      {!data && !error && <Spinner />}

      {data && (
        <DataTable
          caption={tp.title}
          rows={data.rows}
          rowKey={(r) => r.id}
          rowTestId="request-row"
          empty={<EmptyState icon={<ClipboardList strokeWidth={1.5} />} title={tp.empty} />}
          columns={[
            { key: 'date', header: tp.colDate, cell: (r) => <span className="tabular whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</span> },
            { key: 'object', header: tp.colObject, cell: (r) => r.object_name ?? '—' },
            { key: 'material', header: tp.colMaterial, cell: (r) => <span className="font-medium text-ink">{r.material_name ?? '—'}</span> },
            {
              key: 'qty',
              header: tp.colQty,
              align: 'right',
              cell: (r) => (
                <span className="flex flex-col items-end">
                  <Qty value={r.qty_input} unit={inputUnit(r)} size="sm" />
                  <Qty value={r.qty_base} unit={r.base_unit} size="sm" tone="muted" />
                </span>
              ),
            },
            { key: 'needed', header: tp.colNeeded, cell: (r) => <span className="tabular whitespace-nowrap">{neededText(r)}</span> },
            {
              key: 'author',
              header: tp.colAuthor,
              cell: (r) => (
                <span className="flex flex-col">
                  {r.created_by_name ?? '—'}
                  {r.note && <span className="text-xs text-muted">{r.note}</span>}
                </span>
              ),
            },
            {
              key: 'estimate',
              header: (
                <span className="flex flex-col">
                  {tp.colEstimate}
                  <span className="text-xs font-normal">{tp.currentHint}</span>
                </span>
              ),
              className: 'min-w-44',
              cell: estimate,
            },
            {
              key: 'status',
              header: tp.colStatus,
              cell: (r) => (
                <span className="flex flex-col items-start gap-1">
                  {statusBadge(r)}
                  {decision(r)}
                </span>
              ),
            },
            showActions && { key: 'actions', header: tp.colActions, srHeader: true, cell: actions },
          ]}
          renderMobile={(r) => (
            <EntryRow
              // So'rov qatori chizig'i — neytral; holat belgida
              kind="neutral"
              icon={<ClipboardList className="size-5" strokeWidth={1.75} />}
              title={r.material_name ?? '—'}
              badge={statusBadge(r)}
              meta={
                <>
                  <span>{r.object_name ?? '—'}</span>
                  <span>{r.created_by_name ?? '—'}</span>
                  <span className="tabular">{formatDateTime(r.created_at)}</span>
                  {r.needed_by && (
                    <span>
                      {tp.colNeeded}: {neededText(r)}
                    </span>
                  )}
                  {decision(r)}
                  {norms && <span className="mt-1 flex-col !items-stretch">{estimate(r)}</span>}
                </>
              }
              qty={{ value: r.qty_input, unit: inputUnit(r) }}
              baseQty={{ value: r.qty_base, unit: r.base_unit }}
              qtySize="lg"
              actions={showActions ? actions(r) : undefined}
            />
          )}
          footer={<Pager page={page} pageSize={REQUESTS_PAGE_SIZE} total={data.total} onPage={setPage} />}
        />
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
