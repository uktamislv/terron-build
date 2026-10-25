import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { StatusBadge } from '@/components/StatusBadge'
import { Button, Modal, Notice, Spinner } from '@/components/ui'
import { DEFAULT_COMPANY_SETTINGS, getCompanySettings } from '@/data/companiesRepo'
import { listMaterials } from '@/data/materialsRepo'
import { listObjects } from '@/data/objectsRepo'
import { listProfiles } from '@/data/profilesRepo'
import {
  listAllPurchases,
  listPurchases,
  PURCHASES_PAGE_SIZE,
  restorePurchase,
  softDeletePurchase,
  type PurchaseFilters,
} from '@/data/purchasesRepo'
import type { Material, ObjectRow, Profile, Purchase } from '@/data/types'
import { can } from '@/domain/roles'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { formatDateTime, formatQty, formatSum } from '@/lib/format'
import { ExportButton } from '../ExportButton'
import { purchasesSheet } from '../exports'
import { paramDate, paramId } from '../urlFilters'
import { DateField, Pager, RetryNotice, SelectField } from '../fields'
import { dayStartIso, nextDayStartIso } from '../movements/movementFilters'
import { PurchaseDetailDialog } from '../purchases/PurchaseDetailDialog'
import { ReceiptBadge } from '../purchases/ReceiptBadge'

const tp = t.purchases
const to = t.ombor

interface FilterForm {
  objectId: string
  materialId: string
  buyerId: string
  from: string
  to: string
  includeDeleted: boolean
}

const EMPTY: FilterForm = { objectId: '', materialId: '', buyerId: '', from: '', to: '', includeDeleted: false }

function toFilters(f: FilterForm, canSeeDeleted: boolean): PurchaseFilters {
  return {
    objectId: f.objectId || undefined,
    materialId: f.materialId || undefined,
    buyerId: f.buyerId || undefined,
    from: dayStartIso(f.from),
    to: nextDayStartIso(f.to),
    includeDeleted: canSeeDeleted && f.includeDeleted ? true : undefined,
  }
}

function qtyText(p: Purchase): string {
  return `${formatQty(p.qty_input)} ${unitLabel({ unit: p.unit_input, variant: p.unit_variant })}`
}

function AlertBadges({ p }: { p: Purchase }) {
  if (p.alert_types.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {p.alert_types.map((type) => (
        <StatusBadge key={type} tone={type === 'ozi_qabul_qilgan' ? 'neutral' : 'warn'}>
          {t.alertTexts.types[type]}
        </StatusBadge>
      ))}
    </span>
  )
}

type Dialog = { kind: 'detail'; purchase: Purchase } | { kind: 'delete'; purchase: Purchase } | null

/** Xaridlar jadvali: filtrlar, qabul holati, alert belgilari, tafsilot. Ko'rinish RLS bilan cheklanadi. */
export function PurchasesPage() {
  const { profile: me } = useAuth()
  const [objects, setObjects] = useState<ObjectRow[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [params] = useSearchParams()
  // Bosh sahifa havolalari: ?from=...&to=...&object=...
  const [form, setForm] = useState<FilterForm>(() => ({
    ...EMPTY,
    objectId: paramId(params, 'object'),
    from: paramDate(params, 'from'),
    to: paramDate(params, 'to'),
  }))
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ rows: Purchase[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)

  const [threshold, setThreshold] = useState(DEFAULT_COMPANY_SETTINGS.receiptMismatchPct)
  // Qabul holati shu vaqtga nisbatan baholanadi (ro'yxat yuklangan payt)
  const [nowIso, setNowIso] = useState(() => new Date().toISOString())

  const role = me?.role
  const companyId = me?.company_id
  // Xaridni o'chirish va tiklash — faqat admin (purchases_update RLS)
  const canDelete = role ? can(role, 'restore_records') : false
  const canSeeDeleted = canDelete || role === 'direktor'
  const canSeeAlerts = role ? can(role, 'view_alerts') : false

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  useEffect(() => {
    let alive = true
    listObjects()
      .then((list) => alive && setObjects(list))
      .catch(() => undefined)
    listMaterials()
      .then((list) => alive && setMaterials(list))
      .catch(() => undefined)
    listProfiles()
      .then((list) => alive && setProfiles(list))
      .catch(() => undefined)
    if (companyId) {
      getCompanySettings(companyId)
        .then((s) => alive && setThreshold(s.receiptMismatchPct))
        .catch(() => undefined)
    }
    return () => {
      alive = false
    }
  }, [companyId])

  useEffect(() => {
    let alive = true
    listPurchases(toFilters(form, canSeeDeleted), page)
      .then((result) => {
        if (!alive) return
        setNowIso(new Date().toISOString())
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    return () => {
      alive = false
    }
  }, [form, page, canSeeDeleted, reloadKey])

  const update = (patch: Partial<FilterForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setPage(0)
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      setDialog(null)
      reload()
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (!me) return null

  const runExport = async (signal: AbortSignal) => {
    const rows = await listAllPurchases(toFilters(form, canSeeDeleted), signal)
    await exportWorkbook({ fileName: exportFileName(t.excel.sections.purchases), sheets: [purchasesSheet(rows)], signal })
  }

  const actions = (p: Purchase) => (
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost" onClick={() => setDialog({ kind: 'detail', purchase: p })}>
        {tp.open}
      </Button>
      {canDelete &&
        (p.deleted_at ? (
          <Button variant="secondary" disabled={busy} onClick={() => void run(() => restorePurchase(p.id))}>
            {to.restore}
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setDialog({ kind: 'delete', purchase: p })}>
            {to.delete}
          </Button>
        ))}
    </div>
  )

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-brand-dark">{tp.title}</h1>
        <ExportButton run={runExport} />
      </div>

      <form
        aria-label={to.filters}
        onSubmit={(e) => e.preventDefault()}
        className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <SelectField label={to.filterObject} value={form.objectId} onChange={(v) => update({ objectId: v })}>
          <option value="">{to.all}</option>
          {objects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={to.filterMaterial} value={form.materialId} onChange={(v) => update({ materialId: v })}>
          <option value="">{to.all}</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={tp.filterBuyer} value={form.buyerId} onChange={(v) => update({ buyerId: v })}>
          <option value="">{to.all}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </SelectField>
        <DateField label={to.filterFrom} value={form.from} onChange={(v) => update({ from: v })} />
        <DateField label={to.filterTo} value={form.to} onChange={(v) => update({ to: v })} />
        <div className="flex flex-wrap items-center gap-3">
          {canSeeDeleted && (
            <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="size-5"
                checked={form.includeDeleted}
                onChange={(e) => update({ includeDeleted: e.target.checked })}
              />
              {to.filterDeleted}
            </label>
          )}
          <Button variant="ghost" onClick={() => update(EMPTY)}>
            {to.reset}
          </Button>
        </div>
      </form>

      {error && <RetryNotice message={error} onRetry={reload} />}
      {actionError && !dialog && <Notice>{actionError}</Notice>}
      {!data && !error && <Spinner />}
      {data && data.rows.length === 0 && <p className="text-slate-600">{tp.empty}</p>}

      {data && data.rows.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white lg:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">{tp.colDate}</th>
                  <th className="px-3 py-2 font-medium">{tp.colBuyer}</th>
                  <th className="px-3 py-2 font-medium">{tp.colObject}</th>
                  <th className="px-3 py-2 font-medium">{tp.colMaterial}</th>
                  <th className="px-3 py-2 text-right font-medium">{tp.colQty}</th>
                  <th className="px-3 py-2 text-right font-medium">{tp.colTotal}</th>
                  <th className="px-3 py-2 text-right font-medium">{tp.colUnitPrice}</th>
                  <th className="px-3 py-2 font-medium">{tp.colSupplier}</th>
                  <th className="px-3 py-2 font-medium">{tp.colReceipt}</th>
                  <th className="px-3 py-2 font-medium">{tp.colStatus}</th>
                  <th className="px-3 py-2 font-medium">{tp.colAlerts}</th>
                  <th className="px-3 py-2 font-medium">{tp.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p) => (
                  <tr
                    key={p.id}
                    data-testid="purchase-row"
                    className={`border-t border-slate-100 align-top ${p.deleted_at ? 'text-slate-400' : ''}`}
                  >
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatDateTime(p.purchased_at)}
                      {p.deleted_at && (
                        <span className="ml-1">
                          <StatusBadge tone="danger">{t.movements.deleted}</StatusBadge>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{p.buyer_name}</td>
                    <td className="px-3 py-2">{p.object_name}</td>
                    <td className="px-3 py-2">{p.material_name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{qtyText(p)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{formatSum(p.total_amount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {formatSum(p.unit_price)} / {unitLabel({ unit: p.unit_input, variant: p.unit_variant })}
                    </td>
                    <td className="px-3 py-2">{p.supplier_name ?? '—'}</td>
                    <td className="px-3 py-2">
                      {p.receipt_photo_path ? (
                        <span aria-label={tp.receiptPhoto}>📷</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <ReceiptBadge p={p} thresholdPct={threshold} nowIso={nowIso} />
                    </td>
                    <td className="px-3 py-2">
                      <AlertBadges p={p} />
                    </td>
                    <td className="px-3 py-2">{actions(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 lg:hidden" aria-label={tp.title}>
            {data.rows.map((p) => (
              <li
                key={p.id}
                className={`flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 ${
                  p.deleted_at ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">{p.material_name}</p>
                    <p className="text-sm text-slate-600">
                      {p.object_name} · {p.buyer_name}
                    </p>
                  </div>
                  <p className="text-right font-semibold text-slate-900">{formatSum(p.total_amount)}</p>
                </div>
                <p className="text-sm text-slate-800">
                  {qtyText(p)} · {p.supplier_name ?? '—'} {p.receipt_photo_path && '📷'}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <ReceiptBadge p={p} thresholdPct={threshold} nowIso={nowIso} />
                  <AlertBadges p={p} />
                  {p.deleted_at && <StatusBadge tone="danger">{t.movements.deleted}</StatusBadge>}
                </div>
                <p className="text-xs text-slate-500">{formatDateTime(p.purchased_at)}</p>
                {actions(p)}
              </li>
            ))}
          </ul>

          <Pager page={page} pageSize={PURCHASES_PAGE_SIZE} total={data.total} onPage={setPage} />
        </>
      )}

      {dialog?.kind === 'detail' && (
        <PurchaseDetailDialog
          purchase={dialog.purchase}
          canSeeAlerts={canSeeAlerts}
          thresholdPct={threshold}
          nowIso={nowIso}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'delete' && (
        <Modal title={to.delete} onClose={closeDialog}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-700">{tp.deleteConfirm}</p>
            {actionError && <Notice>{actionError}</Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeDialog}>
                {t.common.no}
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void run(() => softDeletePurchase(dialog.purchase.id))}
              >
                {t.common.yes}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
