import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { History, Image as ImageIcon, PencilLine, RotateCcw, Trash2, Warehouse } from 'lucide-react'
import { CorrectionForm } from '@/components/corrections/CorrectionForm'
import { MovementPhoto } from '@/components/MovementPhoto'
import {
  ActionMenu,
  Badge,
  Button,
  DetailRows,
  DetailSheet,
  DataTable,
  EmptyState,
  EntryRow,
  FilterBar,
  Modal,
  Notice,
  Pager,
  Qty,
  RetryNotice,
  sameQty,
  Spinner,
  type ActionItem,
  type FilterDef,
} from '@/components/ui'
import { listAllMovements, listMovements, MOVEMENTS_PAGE_SIZE, restoreMovement, softDeleteMovement } from '@/data/movementsRepo'
import { MOVEMENT_KINDS, type Material, type Movement, type MovementKind, type ObjectRow, type PersonRef } from '@/data/types'
import { adminCorrection } from '@/domain/corrections'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { formatDateTime } from '@/lib/format'
import { ExportButton } from '../ExportButton'
import { movementsSheet } from '../exports'
import { useHistoryHref } from '../history/useHistoryHref'
import { MOVEMENT_ENTRY_KIND } from './stockRows'
import { EMPTY_FILTERS, toRepoFilters, type MovementFilterForm } from './movementFilters'

const to = t.ombor
const ic = { className: 'size-5', strokeWidth: 1.75, 'aria-hidden': true } as const

const TYPE_TONE: Record<MovementKind, 'ok' | 'info' | 'neutral' | 'warn'> = {
  kirim: 'ok',
  chiqim: 'info',
  transfer_out: 'neutral',
  transfer_in: 'neutral',
  inventory_adjust: 'warn',
}

function inputUnit(m: Movement): string {
  return unitLabel({ unit: m.unit_input, variant: m.unit_variant })
}

export interface MovementsTabViewProps {
  rows: Movement[] | null
  total: number
  page: number
  onPage: (page: number) => void
  form: MovementFilterForm
  onFilter: (patch: Partial<MovementFilterForm>) => void
  objects: ObjectRow[]
  materials: Material[]
  profiles: PersonRef[]
  isAdmin: boolean
  canSeeDeleted: boolean
  busy?: boolean
  error?: string | null
  actionError?: string | null
  onRetry?: () => void
  onShowPhoto?: (m: Movement) => void
  onDelete?: (m: Movement) => void
  /** Admin: tuzatish (correct_entry). */
  onCorrect?: (m: Movement) => void
  onRestore?: (m: Movement) => void
  /** Excel tugmasi (container beradi; ko'rgazmada yo'q). */
  exportSlot?: ReactNode
}

/** Harakatlar: filtrlar, jadval (telefonda yuk xati qatorlari), sahifalash. Ma'lumot props orqali. */
export function MovementsTabView({
  rows,
  total,
  page,
  onPage,
  form,
  onFilter,
  objects,
  materials,
  profiles,
  isAdmin,
  canSeeDeleted,
  busy = false,
  error,
  actionError,
  onRetry,
  onShowPhoto,
  onDelete,
  onCorrect,
  onRestore,
  exportSlot,
}: MovementsTabViewProps) {
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
      key: 'type',
      label: to.filterType,
      value: form.type,
      onChange: (v) => onFilter({ type: v as MovementFilterForm['type'] }),
      options: [all, ...MOVEMENT_KINDS.map((k) => ({ value: k, label: t.movements.types[k] }))],
    },
    {
      kind: 'select',
      key: 'user',
      label: to.filterUser,
      value: form.createdBy,
      onChange: (v) => onFilter({ createdBy: v }),
      options: [all, ...profiles.map((p) => ({ value: p.id, label: p.full_name }))],
    },
    {
      kind: 'dateRange',
      key: 'date',
      label: to.colDate,
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

  const [detail, setDetail] = useState<Movement | null>(null)
  const navigate = useNavigate()
  const historyHref = useHistoryHref()

  /** Qator amallari: jadvalda "⋯" menyusi, telefonda — tafsilot varag'ida. */
  const actionItems = (m: Movement): ActionItem[] => {
    const items: ActionItem[] = []
    if (m.photo_path && onShowPhoto)
      items.push({ key: 'photo', label: to.showPhoto, icon: <ImageIcon {...ic} />, onSelect: () => onShowPhoto(m) })
    // Admin tuzatishi (correct_entry): istalgan vaqtda, bog'lanmagan kirim/chiqim
    if (
      isAdmin &&
      onCorrect &&
      adminCorrection({
        table: 'movements',
        createdBy: m.created_by,
        createdAt: m.created_at,
        deletedAt: m.deleted_at,
        movementType: m.type,
        purchaseId: m.purchase_id,
      })
    )
      items.push({ key: 'correct', label: t.correction.action, icon: <PencilLine {...ic} />, disabled: busy, onSelect: () => onCorrect(m) })
    if (isAdmin && m.deleted_at && onRestore)
      items.push({ key: 'restore', label: to.restore, icon: <RotateCcw {...ic} />, disabled: busy, onSelect: () => onRestore(m) })
    const href = historyHref('movements', m.id)
    if (href) items.push({ key: 'history', label: t.history.link, icon: <History {...ic} />, onSelect: () => navigate(href) })
    if (isAdmin && !m.deleted_at && onDelete)
      items.push({ key: 'delete', label: to.delete, icon: <Trash2 {...ic} />, danger: true, onSelect: () => onDelete(m) })
    return items
  }

  const deletedBadge = (m: Movement) => (m.deleted_at ? <Badge tone="danger">{t.movements.deleted}</Badge> : null)

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        label={to.filters}
        filters={filters}
        onClear={() => onFilter(EMPTY_FILTERS)}
        extra={exportSlot && <div className="md:ml-auto">{exportSlot}</div>}
      />

      {error && <RetryNotice message={error} onRetry={onRetry ?? (() => undefined)} />}
      {actionError && <Notice>{actionError}</Notice>}
      {!rows && !error && <Spinner />}

      {rows && (
        <DataTable
          caption={to.tabMovements}
          rows={rows}
          rowKey={(m) => m.id}
          rowTestId="movement-row"
          rowClassName={(m) => (m.deleted_at ? 'bg-canvas/60 text-muted' : undefined)}
          empty={<EmptyState icon={<Warehouse strokeWidth={1.5} />} title={to.empty} text={to.emptyHint} />}
          columns={[
            {
              key: 'date',
              header: to.colDate,
              cell: (m) => <span className="tabular whitespace-nowrap text-muted">{formatDateTime(m.occurred_at)}</span>,
            },
            {
              key: 'type',
              header: to.colType,
              cell: (m) => (
                <span className="flex flex-wrap items-center gap-1">
                  <Badge tone={TYPE_TONE[m.type]}>{t.movements.types[m.type]}</Badge>
                  {deletedBadge(m)}
                </span>
              ),
            },
            { key: 'object', header: to.colObject, className: 'min-w-32', cell: (m) => m.object_name },
            {
              key: 'material',
              header: to.colMaterial,
              className: 'min-w-32',
              cell: (m) => <span className={m.deleted_at ? 'line-through' : 'font-medium text-ink'}>{m.material_name}</span>,
            },
            { key: 'qty', header: to.colQty, align: 'right', cell: (m) => <Qty value={m.qty_input} unit={inputUnit(m)} size="sm" /> },
            {
              key: 'base',
              header: to.colBase,
              align: 'right',
              cell: (m) => <Qty value={m.qty_base} unit={m.base_unit} size="sm" tone="muted" />,
            },
            { key: 'user', header: to.colUser, className: 'min-w-28', cell: (m) => m.created_by_name },
            { key: 'note', header: to.colNote, className: 'max-w-48 text-muted', cell: (m) => m.note },
            { key: 'actions', header: to.colActions, srHeader: true, cell: (m) => <ActionMenu items={actionItems(m)} /> },
          ]}
          renderMobile={(m) => (
            <EntryRow
              kind={MOVEMENT_ENTRY_KIND[m.type]}
              deleted={Boolean(m.deleted_at)}
              title={m.material_name}
              badge={deletedBadge(m)}
              meta={
                <>
                  <span>
                    {t.movements.types[m.type]}, {m.object_name}
                  </span>
                  <span className="tabular">{formatDateTime(m.occurred_at)}</span>
                  {m.created_by_name && <span>{m.created_by_name}</span>}
                  {m.note && <span className="text-ink/80">{m.note}</span>}
                </>
              }
              qty={{ value: m.qty_input, unit: inputUnit(m) }}
              baseQty={{ value: m.qty_base, unit: m.base_unit }}
              qtySize="lg"
              onClick={() => setDetail(m)}
            />
          )}
          footer={<Pager page={page} pageSize={MOVEMENTS_PAGE_SIZE} total={total} onPage={onPage} />}
        />
      )}

      {detail && (
        <DetailSheet
          title={detail.material_name ?? t.ui.details}
          onClose={() => setDetail(null)}
          footer={
            actionItems(detail).length > 0 &&
            actionItems(detail).map((a) => (
              <Button
                key={a.key}
                variant={a.danger ? 'danger' : 'secondary'}
                className="flex-1"
                icon={a.icon}
                disabled={a.disabled}
                onClick={() => {
                  setDetail(null)
                  a.onSelect()
                }}
              >
                {a.label}
              </Button>
            ))
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TYPE_TONE[detail.type]}>{t.movements.types[detail.type]}</Badge>
              {deletedBadge(detail)}
            </div>
            <div className="flex flex-col gap-1">
              <Qty value={detail.qty_input} unit={inputUnit(detail)} size="hero" />
              {!sameQty({ value: detail.qty_input, unit: inputUnit(detail) }, { value: detail.qty_base, unit: detail.base_unit }) && (
                <span className="text-sm text-muted">
                  = <Qty value={detail.qty_base} unit={detail.base_unit} size="md" tone="muted" />
                </span>
              )}
            </div>
            <DetailRows
              items={[
                { label: to.colObject, value: detail.object_name },
                { label: to.colDate, value: <span className="tabular">{formatDateTime(detail.occurred_at)}</span> },
                detail.created_by_name ? { label: to.colUser, value: detail.created_by_name } : null,
                detail.note ? { label: to.colNote, value: detail.note } : null,
              ]}
            />
          </div>
        </DetailSheet>
      )}
    </div>
  )
}

type Dialog =
  | { kind: 'photo'; movement: Movement }
  | { kind: 'delete'; movement: Movement }
  | { kind: 'correct'; movement: Movement }
  | null

export function MovementsTab({
  objects,
  materials,
  profiles,
  isAdmin,
  canSeeDeleted,
  initial = EMPTY_FILTERS,
}: {
  objects: ObjectRow[]
  materials: Material[]
  profiles: PersonRef[]
  isAdmin: boolean
  /** admin va direktor — o'chirilganlarni ko'radi (direktor faqat ko'radi) */
  canSeeDeleted: boolean
  /** Boshlang'ich filtr (URL'dan). */
  initial?: MovementFilterForm
}) {
  const [form, setForm] = useState<MovementFilterForm>(initial)
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ rows: Movement[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  useEffect(() => {
    let alive = true
    listMovements(toRepoFilters(form, canSeeDeleted), page)
      .then((result) => {
        if (!alive) return
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err))
      })
    return () => {
      alive = false
    }
  }, [form, page, canSeeDeleted, reloadKey])

  const update = (patch: Partial<MovementFilterForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setPage(0)
  }

  /** `leavesPage` — qator joriy ro'yxatdan chiqadi (o'chirildi va o'chirilganlar ko'rsatilmayapti). */
  const run = async (action: () => Promise<void>, opts: { leavesPage?: boolean } = {}) => {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      setDialog(null)
      if (opts.leavesPage && page > 0 && data?.rows.length === 1) setPage((p) => p - 1)
      else reload()
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <MovementsTabView
        rows={data?.rows ?? null}
        total={data?.total ?? 0}
        page={page}
        onPage={setPage}
        form={form}
        onFilter={update}
        objects={objects}
        materials={materials}
        profiles={profiles}
        isAdmin={isAdmin}
        canSeeDeleted={canSeeDeleted}
        busy={busy}
        error={error}
        actionError={dialog ? null : actionError}
        onRetry={reload}
        onShowPhoto={(m) => setDialog({ kind: 'photo', movement: m })}
        onDelete={(m) => setDialog({ kind: 'delete', movement: m })}
        onCorrect={(m) => setDialog({ kind: 'correct', movement: m })}
        onRestore={(m) => void run(() => restoreMovement(m.id))}
        exportSlot={
          <ExportButton
            run={async (signal) => {
              const rows = await listAllMovements(toRepoFilters(form, canSeeDeleted), signal)
              await exportWorkbook({
                fileName: exportFileName(t.excel.sections.movements),
                sheets: [movementsSheet(rows)],
                signal,
              })
            }}
          />
        }
      />

      {dialog?.kind === 'correct' && (
        <Modal title={t.correction.title} onClose={closeDialog}>
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted">{t.correction.adminHint}</p>
            <CorrectionForm
              target={{
                table: 'movements',
                id: dialog.movement.id,
                materialId: dialog.movement.material_id,
                materialName: dialog.movement.material_name,
                qtyInput: dialog.movement.qty_input,
                unitId: dialog.movement.unit_id,
                note: dialog.movement.note,
              }}
              onCancel={closeDialog}
              onDone={() => {
                setDialog(null)
                reload()
              }}
            />
          </div>
        </Modal>
      )}
      {dialog?.kind === 'photo' && dialog.movement.photo_path && (
        <Modal title={t.movements.photo} onClose={closeDialog}>
          <MovementPhoto path={dialog.movement.photo_path} alt={t.movements.photo} />
        </Modal>
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
              <Button
                variant="danger"
                loading={busy}
                onClick={() => void run(() => softDeleteMovement(dialog.movement.id), { leavesPage: !form.includeDeleted })}
              >
                {t.common.yes}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">{to.deleteConfirm}</p>
            {actionError && <Notice>{actionError}</Notice>}
          </div>
        </Modal>
      )}
    </>
  )
}
