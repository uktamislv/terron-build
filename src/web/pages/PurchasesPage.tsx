import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, History, PencilLine, Plus, Receipt, RotateCcw, ShoppingCart, Trash2 } from 'lucide-react'
import { CorrectionForm } from '@/components/corrections/CorrectionForm'
import { useAuth } from '@/auth/authContext'
import {
  ActionMenu,
  Badge,
  Button,
  DataTable,
  EmptyState,
  EntryRow,
  FilterBar,
  Modal,
  Money,
  Notice,
  PageHeader,
  Pager,
  Qty,
  RetryNotice,
  Spinner,
  type FilterDef,
} from '@/components/ui'
import { DEFAULT_COMPANY_SETTINGS, getCompanySettings } from '@/data/companiesRepo'
import { listMaterials } from '@/data/materialsRepo'
import { listObjects } from '@/data/objectsRepo'
import { listDirectory } from '@/data/profileDirectory'
import { listAllPurchases, listPurchases, PURCHASES_PAGE_SIZE, restorePurchase, softDeletePurchase, type PurchaseFilters } from '@/data/purchasesRepo'
import { listSuppliers } from '@/data/suppliersRepo'
import type { Material, ObjectRow, PersonRef, Purchase, Supplier } from '@/data/types'
import { adminCorrection } from '@/domain/corrections'
import { can } from '@/domain/roles'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { formatDateTime, formatSum } from '@/lib/format'
import { ExportButton } from '../ExportButton'
import { HistoryLink } from '../history/HistoryLink'
import { useHistoryHref } from '../history/useHistoryHref'
import { purchasesSheet } from '../exports'
import { paramDate, paramId } from '../urlFilters'
import { dayStartIso, nextDayStartIso } from '../movements/movementFilters'
import { AddPurchaseDialog } from '../purchases/AddPurchaseDialog'
import { PurchaseDetailDialog } from '../purchases/PurchaseDetailDialog'
import { ReceiptBadge } from '../purchases/ReceiptBadge'
import { QrBadge } from '../purchases/QrBadge'

const tp = t.purchases
const to = t.ombor
const ic = {
  className: 'size-5',
  strokeWidth: 1.75,
  'aria-hidden': true,
} as const

export interface PurchaseFilterForm {
  objectId: string
  materialId: string
  buyerId: string
  supplierId: string
  from: string
  to: string
  includeDeleted: boolean
}

const EMPTY: PurchaseFilterForm = {
  objectId: '',
  materialId: '',
  buyerId: '',
  supplierId: '',
  from: '',
  to: '',
  includeDeleted: false,
}

function toFilters(f: PurchaseFilterForm, canSeeDeleted: boolean): PurchaseFilters {
  return {
    objectId: f.objectId || undefined,
    materialId: f.materialId || undefined,
    buyerId: f.buyerId || undefined,
    supplierId: f.supplierId || undefined,
    from: dayStartIso(f.from),
    to: nextDayStartIso(f.to),
    includeDeleted: canSeeDeleted && f.includeDeleted ? true : undefined,
  }
}

function inputUnit(p: Purchase): string {
  return unitLabel({ unit: p.unit_input, variant: p.unit_variant })
}

function AlertBadges({ p }: { p: Purchase }) {
  if (p.alert_types.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {p.alert_types.map((type) => (
        <Badge key={type} tone={type === 'ozi_qabul_qilgan' ? 'neutral' : 'warn'}>
          {t.alertTexts.types[type]}
        </Badge>
      ))}
    </span>
  )
}

export interface PurchasesViewProps {
  rows: Purchase[] | null
  total: number
  page: number
  onPage: (page: number) => void
  form: PurchaseFilterForm
  onFilter: (patch: Partial<PurchaseFilterForm>) => void
  objects: ObjectRow[]
  materials: Material[]
  profiles: PersonRef[]
  /** Sotuvchi filtri (bo'sh — filtr ko'rsatilmaydi). */
  suppliers?: Supplier[]
  canDelete: boolean
  canSeeDeleted: boolean
  thresholdPct: string
  nowIso: string
  busy?: boolean
  error?: string | null
  actionError?: string | null
  onRetry?: () => void
  onOpen?: (p: Purchase) => void
  onDelete?: (p: Purchase) => void
  onRestore?: (p: Purchase) => void
  exportSlot?: ReactNode
  /** "Xarid qo'shish" tugmasi (ta'minotchi, admin). */
  addSlot?: ReactNode
  /** Amal natijasi (masalan "Xarid saqlandi") — filtrlar ostida. */
  notice?: ReactNode
}

/** Xaridlar: sarlavha, filtrlar, jadval (telefonda yuk xati qatorlari). Ma'lumot props orqali. */
export function PurchasesView({
  rows,
  total,
  page,
  onPage,
  form,
  onFilter,
  objects,
  materials,
  profiles,
  suppliers = [],
  canDelete,
  canSeeDeleted,
  thresholdPct,
  nowIso,
  busy = false,
  error,
  actionError,
  onRetry,
  onOpen,
  onDelete,
  onRestore,
  exportSlot,
  addSlot,
  notice,
}: PurchasesViewProps) {
  const all = { value: '', label: to.all }
  const filters: FilterDef[] = [
    {
      kind: 'select',
      key: 'object',
      label: to.filterObject,
      value: form.objectId,
      onChange: (v) => onFilter({ objectId: v }),
      options: [all, ...objects.map((o) => ({ value: o.id, label: o.name }))],
    },
    {
      kind: 'select',
      key: 'material',
      label: to.filterMaterial,
      value: form.materialId,
      onChange: (v) => onFilter({ materialId: v }),
      options: [all, ...materials.map((m) => ({ value: m.id, label: m.name }))],
    },
    {
      kind: 'select',
      key: 'buyer',
      label: tp.filterBuyer,
      value: form.buyerId,
      onChange: (v) => onFilter({ buyerId: v }),
      options: [all, ...profiles.map((p) => ({ value: p.id, label: p.full_name }))],
    },
    ...(suppliers.length > 0
      ? [
          {
            kind: 'select' as const,
            key: 'supplier',
            label: tp.filterSupplier,
            value: form.supplierId,
            onChange: (v: string) => onFilter({ supplierId: v }),
            options: [all, ...suppliers.map((s) => ({ value: s.id, label: s.name }))],
          },
        ]
      : []),
    {
      kind: 'dateRange',
      key: 'date',
      label: tp.colDate,
      from: form.from,
      to: form.to,
      onFrom: (v) => onFilter({ from: v }),
      onTo: (v) => onFilter({ to: v }),
      fromLabel: to.filterFrom,
      toLabel: to.filterTo,
    },
  ]
  if (canSeeDeleted)
    filters.push({
      kind: 'toggle',
      key: 'deleted',
      label: to.filterDeleted,
      checked: form.includeDeleted,
      onChange: (v) => onFilter({ includeDeleted: v }),
    })

  const navigate = useNavigate()
  const historyHref = useHistoryHref()
  /** Jadval qatori "⋯" menyusi. Telefonda qator bosilsa tafsilot ochiladi (amallar o'sha yerda). */
  const actions = (p: Purchase) => (
    <ActionMenu
      items={[
        onOpen && {
          key: 'open',
          label: tp.open,
          icon: <ChevronRight {...ic} />,
          onSelect: () => onOpen(p),
        },
        canDelete &&
          Boolean(p.deleted_at) &&
          onRestore && {
            key: 'restore',
            label: to.restore,
            icon: <RotateCcw {...ic} />,
            disabled: busy,
            onSelect: () => onRestore(p),
          },
        Boolean(historyHref('purchases', p.id)) && {
          key: 'history',
          label: t.history.link,
          icon: <History {...ic} />,
          onSelect: () => navigate(historyHref('purchases', p.id) ?? '/history'),
        },
        canDelete &&
          !p.deleted_at &&
          onDelete && {
            key: 'delete',
            label: to.delete,
            icon: <Trash2 {...ic} />,
            danger: true,
            onSelect: () => onDelete(p),
          },
      ]}
    />
  )
  const receiptIcon = (p: Purchase) =>
    p.receipt_photo_path ? (
      <Receipt role="img" aria-label={tp.receiptPhoto} className="size-5 text-navy" strokeWidth={1.75} />
    ) : (
      <span className="text-muted">—</span>
    )
  const deleted = (p: Purchase) => (p.deleted_at ? <Badge tone="danger">{t.movements.deleted}</Badge> : null)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={tp.title}
        icon={<ShoppingCart strokeWidth={1.75} />}
        actions={
          (exportSlot || addSlot) && (
            <>
              {exportSlot}
              {addSlot}
            </>
          )
        }
      />
      <FilterBar label={to.filters} filters={filters} onClear={() => onFilter(EMPTY)} />
      {notice}

      {error && <RetryNotice message={error} onRetry={onRetry ?? (() => undefined)} />}
      {actionError && <Notice>{actionError}</Notice>}
      {!rows && !error && <Spinner />}

      {rows && (
        <DataTable
          caption={tp.title}
          rows={rows}
          rowKey={(p) => p.id}
          rowTestId="purchase-row"
          rowClassName={(p) => (p.deleted_at ? 'bg-canvas/60 text-muted' : undefined)}
          empty={<EmptyState icon={<ShoppingCart strokeWidth={1.5} />} title={tp.empty} text={tp.emptyHint} />}
          columns={[
            {
              key: 'date',
              header: tp.colDate,
              cell: (p) => (
                <span className="flex flex-col items-start gap-1">
                  <span className="tabular whitespace-nowrap text-muted">{formatDateTime(p.purchased_at)}</span>
                  {deleted(p)}
                </span>
              ),
            },
            { key: 'buyer', header: tp.colBuyer, cell: (p) => p.buyer_name },
            { key: 'object', header: tp.colObject, cell: (p) => p.object_name },
            {
              key: 'material',
              header: tp.colMaterial,
              cell: (p) => (
                <span className="flex flex-col">
                  <span className={p.deleted_at ? 'line-through' : 'font-medium text-ink'}>{p.material_name}</span>
                  {p.supplier_name && <span className="text-xs text-muted">{p.supplier_name}</span>}
                  <span className="mt-1 empty:hidden">
                    <QrBadge p={p} />
                  </span>
                </span>
              ),
            },
            {
              key: 'qty',
              header: tp.colQty,
              align: 'right',
              cell: (p) => <Qty value={p.qty_input} unit={inputUnit(p)} size="sm" />,
            },
            {
              key: 'total',
              header: tp.colTotal,
              align: 'right',
              cell: (p) => (
                <span className="flex flex-col items-end">
                  <Money value={p.total_amount} size="sm" />
                  <span className="tabular text-xs whitespace-nowrap text-muted">
                    {formatSum(p.unit_price)} / {inputUnit(p)}
                  </span>
                </span>
              ),
            },
            {
              key: 'receipt',
              header: tp.colReceipt,
              align: 'center',
              cell: receiptIcon,
            },
            {
              key: 'status',
              header: tp.colStatus,
              cell: (p) => <ReceiptBadge p={p} thresholdPct={thresholdPct} nowIso={nowIso} level />,
            },
            {
              key: 'alerts',
              header: tp.colAlerts,
              cell: (p) => <AlertBadges p={p} />,
            },
            {
              key: 'actions',
              header: tp.colActions,
              srHeader: true,
              cell: actions,
            },
          ]}
          renderMobile={(p) => (
            <EntryRow
              kind="xarid"
              deleted={Boolean(p.deleted_at)}
              title={p.material_name}
              badge={deleted(p)}
              meta={
                <>
                  <span>{p.object_name}</span>
                  <span>{p.buyer_name}</span>
                  {p.supplier_name && <span>{p.supplier_name}</span>}
                  <QrBadge p={p} />
                  <span className="tabular">{formatDateTime(p.purchased_at)}</span>
                  <span className="mt-1 flex-col !items-start">
                    <ReceiptBadge p={p} thresholdPct={thresholdPct} nowIso={nowIso} level />
                  </span>
                  <AlertBadges p={p} />
                </>
              }
              trailing={<Money value={p.total_amount} size="lg" />}
              trailingMeta={<Qty value={p.qty_input} unit={inputUnit(p)} size="sm" tone="muted" />}
              onClick={onOpen ? () => onOpen(p) : undefined}
            />
          )}
          footer={<Pager page={page} pageSize={PURCHASES_PAGE_SIZE} total={total} onPage={onPage} />}
        />
      )}
    </div>
  )
}

type Dialog =
  | { kind: 'detail'; purchase: Purchase }
  | { kind: 'delete'; purchase: Purchase }
  | { kind: 'correct'; purchase: Purchase }
  | { kind: 'add' }
  | null

/** Xaridlar jadvali: filtrlar, qabul holati, alert belgilari, tafsilot. Ko'rinish RLS bilan cheklanadi. */
export function PurchasesPage() {
  const { profile: me } = useAuth()
  const purchaseHistoryHref = useHistoryHref()
  const [objects, setObjects] = useState<ObjectRow[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [profiles, setProfiles] = useState<PersonRef[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [savedText, setSavedText] = useState<string | null>(null)
  const [params] = useSearchParams()
  // Bosh sahifa havolalari: ?from=...&to=...&object=...
  const [form, setForm] = useState<PurchaseFilterForm>(() => ({
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
  // Veb "Xarid qo'shish" — ta'minotchi va admin (CLAUDE.md: ta'minotchi veb panelda ishlaydi)
  const canCreate = role === 'taminotchi' || role === 'admin' || role === 'super_admin'
  // Admin tuzatishi (correct_entry) — istalgan vaqtda, bog'lanmagan xaridda
  const canCorrect = role === 'admin' || role === 'super_admin'

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
    listDirectory()
      .then((list) => alive && setProfiles(list))
      .catch(() => undefined)
    listSuppliers()
      .then((list) => alive && setSuppliers(list))
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

  const update = (patch: Partial<PurchaseFilterForm>) => {
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
    await exportWorkbook({
      fileName: exportFileName(t.excel.sections.purchases),
      sheets: [purchasesSheet(rows)],
      signal,
    })
  }

  return (
    <>
      <PurchasesView
        rows={data?.rows ?? null}
        total={data?.total ?? 0}
        page={page}
        onPage={setPage}
        form={form}
        onFilter={update}
        objects={objects}
        materials={materials}
        profiles={profiles}
        suppliers={suppliers}
        canDelete={canDelete}
        canSeeDeleted={canSeeDeleted}
        thresholdPct={threshold}
        nowIso={nowIso}
        busy={busy}
        error={error}
        actionError={dialog?.kind === 'delete' ? null : actionError}
        onRetry={reload}
        onOpen={(p) => setDialog({ kind: 'detail', purchase: p })}
        onDelete={(p) => setDialog({ kind: 'delete', purchase: p })}
        onRestore={(p) => void run(() => restorePurchase(p.id))}
        exportSlot={<ExportButton run={runExport} />}
        addSlot={
          canCreate && (
            <Button icon={<Plus aria-hidden className="size-5" strokeWidth={1.75} />} onClick={() => setDialog({ kind: 'add' })}>
              {tp.add}
            </Button>
          )
        }
        notice={savedText && <Notice tone="ok">{savedText}</Notice>}
      />
      {dialog?.kind === 'add' && (
        <AddPurchaseDialog
          onClose={closeDialog}
          onSaved={(p) => {
            setDialog(null)
            setSavedText(tp.added(p.material_name ?? ''))
            reload()
          }}
        />
      )}
      {dialog?.kind === 'correct' && (
        <Modal title={t.correction.title} onClose={closeDialog}>
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted">{t.correction.adminHint}</p>
            <CorrectionForm
              target={{
                table: 'purchases',
                id: dialog.purchase.id,
                materialId: dialog.purchase.material_id,
                materialName: dialog.purchase.material_name,
                qtyInput: dialog.purchase.qty_input,
                unitId: dialog.purchase.unit_id,
                totalAmount: dialog.purchase.total_amount,
                note: dialog.purchase.note,
              }}
              onCancel={closeDialog}
              onDone={() => {
                setDialog(null)
                setSavedText(t.correction.saved)
                reload()
              }}
            />
          </div>
        </Modal>
      )}

      {dialog?.kind === 'detail' && (
        <PurchaseDetailDialog
          purchase={dialog.purchase}
          canSeeAlerts={canSeeAlerts}
          thresholdPct={threshold}
          nowIso={nowIso}
          onClose={closeDialog}
          footer={
            (canDelete || Boolean(purchaseHistoryHref('purchases', dialog.purchase.id))) && (
              <>
                <HistoryLink table="purchases" id={dialog.purchase.id} className="flex-1 sm:flex-none" />
                {canCorrect &&
                  adminCorrection({
                    table: 'purchases',
                    createdBy: dialog.purchase.created_by,
                    createdAt: dialog.purchase.created_at,
                    deletedAt: dialog.purchase.deleted_at,
                    linkedReceipts: dialog.purchase.receipt ? dialog.purchase.receipt.receipt_count : null,
                  }) && (
                    <Button
                      variant="secondary"
                      className="flex-1 sm:flex-none"
                      icon={<PencilLine aria-hidden className="size-5" strokeWidth={1.75} />}
                      onClick={() => setDialog({ kind: 'correct', purchase: dialog.purchase })}
                    >
                      {t.correction.action}
                    </Button>
                  )}
                {canDelete &&
                  (dialog.purchase.deleted_at ? (
                    <Button
                      variant="secondary"
                      className="flex-1 sm:flex-none"
                      icon={<RotateCcw aria-hidden className="size-5" strokeWidth={1.75} />}
                      loading={busy}
                      onClick={() => {
                        const id = dialog.purchase.id
                        void run(() => restorePurchase(id))
                      }}
                    >
                      {to.restore}
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      className="flex-1 sm:flex-none"
                      icon={<Trash2 aria-hidden className="size-5" strokeWidth={1.75} />}
                      onClick={() => setDialog({ kind: 'delete', purchase: dialog.purchase })}
                    >
                      {to.delete}
                    </Button>
                  ))}
              </>
            )
          }
        />
      )}
      {dialog?.kind === 'delete' && (
        <Modal
          title={to.delete}
          onClose={closeDialog}
          footer={
            <>
              <Button variant="secondary" onClick={closeDialog}>
                {t.common.no}
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void run(() => softDeletePurchase(dialog.purchase.id))}>
                {t.common.yes}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">{tp.deleteConfirm}</p>
            {actionError && <Notice>{actionError}</Notice>}
          </div>
        </Modal>
      )}
    </>
  )
}
