// "Xaridlar → Xarajatlar" tabi: ombordan tashqari xarajatlar ro'yxati (DataTable, telefonda EntryRow), filtrlar
// (tur, obyekt — "Umumiy" bilan, to'lovchi, davr), "Xarajat qo'shish", tafsilot (chek, joylashuv, pul manbai),
// tuzatish (admin — istalgan vaqtda; muallif — 30 daqiqa), bekor qilish, o'chirish/tiklash, Excel.
// Havola: `?tab=expenses&expense=<id>` — shu xarajat tafsiloti ochiladi (ogohlantirishlardan).
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { PencilLine, Plus, Receipt, RotateCcw, Trash2 } from 'lucide-react'
import { useAuth } from '@/auth/authContext'
import { MovementPhoto } from '@/components/MovementPhoto'
import { CancelOwnDialog } from '@/components/corrections/CancelOwnDialog'
import { ExpenseCorrectionForm } from '@/components/corrections/ExpenseCorrectionForm'
import {
  Badge,
  Button,
  DataTable,
  DetailSheet,
  EmptyState,
  EntryRow,
  FilterBar,
  Modal,
  Money,
  Notice,
  Pager,
  RetryNotice,
  Spinner,
  type FilterDef,
} from '@/components/ui'
import { cancelOwnEntry } from '@/data/correctionsRepo'
import { listExpenseCategories } from '@/data/expenseCategoriesRepo'
import {
  EXPENSES_PAGE_SIZE,
  getExpenseById,
  listAllExpenses,
  listExpenses,
  NO_OBJECT,
  restoreExpense,
  softDeleteExpense,
  type ExpenseFilters,
} from '@/data/expensesRepo'
import type { Expense, ExpenseCategory, ObjectRow, PersonRef } from '@/data/types'
import { adminCorrection, remainingMinutes, selfCorrection, type CorrectableEntry } from '@/domain/corrections'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { formatDateTime } from '@/lib/format'
import { isUuid } from '@/lib/uuid'
import { ExportButton } from '../ExportButton'
import { expensesSheet } from '../exports'
import { HistoryLink } from '../history/HistoryLink'
import { dayStartIso, nextDayStartIso } from '../movements/movementFilters'
import { paramDate, paramId } from '../urlFilters'
import { PurchaseGeo, PurchaseQr } from './PurchaseAutomationInfo'

const te = t.expenses
const to = t.ombor

export interface ExpenseFilterForm {
  categoryId: string
  objectId: string
  payerId: string
  from: string
  to: string
  includeDeleted: boolean
}

const EMPTY: ExpenseFilterForm = { categoryId: '', objectId: '', payerId: '', from: '', to: '', includeDeleted: false }

function toExpenseFilters(f: ExpenseFilterForm, canSeeDeleted: boolean): ExpenseFilters {
  return {
    categoryId: f.categoryId || undefined,
    objectId: f.objectId || undefined,
    payerId: f.payerId || undefined,
    from: dayStartIso(f.from),
    to: nextDayStartIso(f.to),
    includeDeleted: canSeeDeleted && f.includeDeleted ? true : undefined,
  }
}

function AlertBadges({ e }: { e: Expense }) {
  if (e.alert_types.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {e.alert_types.map((type) => (
        <Badge key={type} tone="warn">
          {t.alertTexts.types[type]}
        </Badge>
      ))}
    </span>
  )
}

type Dialog = { kind: 'detail' | 'delete' | 'correct' | 'cancel'; expense: Expense } | { kind: 'add' } | null

/** Xarajatlar tabi (sahifa sarlavhasi va tablar — `PurchasesPage` da). */
export function ExpensesTab({
  objects,
  profiles,
  header,
  addDialog,
}: {
  objects: ObjectRow[]
  profiles: PersonRef[]
  /** Sarlavha va tablar (amallar shu yerga qo'shiladi). */
  header: (actions: ReactNode) => ReactNode
  /** "Xarajat qo'shish" dialogi (sinovlarda almashtiriladi). */
  addDialog: (props: { onClose: () => void; onSaved: (e: Expense) => void }) => ReactNode
}) {
  const { profile: me } = useAuth()
  const [params, setParams] = useSearchParams()
  const [form, setForm] = useState<ExpenseFilterForm>(() => ({
    ...EMPTY,
    categoryId: paramId(params, 'category'),
    objectId: params.get('object') === NO_OBJECT ? NO_OBJECT : paramId(params, 'object'),
    from: paramDate(params, 'from'),
    to: paramDate(params, 'to'),
  }))
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ rows: Expense[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const role = me?.role
  const isAdmin = role === 'admin' || role === 'super_admin'
  const canSeeDeleted = isAdmin || role === 'direktor'
  const canCreate = role ? can(role, 'create_expense') : false
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const close = useCallback(() => setDialog(null), [])

  useEffect(() => {
    let alive = true
    listExpenseCategories({ includeDeleted: true })
      .then((list) => alive && setCategories(list))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    listExpenses(toExpenseFilters(form, canSeeDeleted), page)
      .then((r) => {
        if (!alive) return
        setData(r)
        setError(null)
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    return () => {
      alive = false
    }
  }, [form, page, canSeeDeleted, reloadKey])

  // Ogohlantirishdan havola: ?expense=<id> — tafsilot (topilmasa — jim); parametr bir marta ishlatiladi.
  // Id holatga ko'chiriladi va URL'dan alohida olib tashlanadi — so'rov params o'zgarishi bilan bekor bo'lmasin.
  const linkedParam = params.get('expense')
  const [linkedId, setLinkedId] = useState<string | null>(null)
  const [seenParam, setSeenParam] = useState<string | null>(null)
  if (linkedParam !== seenParam) {
    // Render paytida (holatdan hosila): yangi havola — id saqlanadi
    setSeenParam(linkedParam)
    if (isUuid(linkedParam)) setLinkedId(linkedParam)
  }
  useEffect(() => {
    if (!params.has('expense')) return
    const next = new URLSearchParams(params)
    next.delete('expense')
    setParams(next, { replace: true })
  }, [params, setParams])
  useEffect(() => {
    if (!linkedId) return
    let alive = true
    getExpenseById(linkedId)
      .then((e) => {
        if (!alive) return
        setDialog({ kind: 'detail', expense: e })
        setLinkedId(null)
      })
      .catch(() => alive && setLinkedId(null))
    return () => {
      alive = false
    }
  }, [linkedId])

  if (!me) return null

  const correctionFor = (e: Expense): { admin: boolean; remaining: number | null } | null => {
    const entry: CorrectableEntry = { table: 'expenses', createdBy: e.created_by, createdAt: e.created_at, deletedAt: e.deleted_at }
    // Muallif (admin ham) 30 daqiqa ichida — obyekt bilan; admin keyin ham — summa va izoh
    const self = selfCorrection(entry, me.id, new Date().toISOString())
    if (self.allowed) return { admin: false, remaining: remainingMinutes(self.remainingMs) }
    if (isAdmin && adminCorrection(entry)) return { admin: true, remaining: null }
    return null
  }

  /** `leavesPage` — qator joriy ro'yxatdan chiqadi (o'chirildi/bekor qilindi va o'chirilganlar ko'rsatilmayapti). */
  const run = async (action: () => Promise<void>, text?: string, opts: { leavesPage?: boolean } = {}) => {
    setBusy(true)
    setActionError(null)
    setNotice(null)
    try {
      await action()
      setDialog(null)
      if (text) setNotice(text)
      // Oxirgi sahifadagi yagona qator ketdi — oldingi sahifaga (bo'sh sahifa qolmasin)
      if (opts.leavesPage && !form.includeDeleted && page > 0 && data?.rows.length === 1) setPage((p) => p - 1)
      else reload()
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const update = (patch: Partial<ExpenseFilterForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setPage(0)
    setNotice(null)
  }

  const all = { value: '', label: to.all }
  const filters: FilterDef[] = [
    {
      kind: 'select',
      key: 'category',
      label: te.filterCategory,
      value: form.categoryId,
      onChange: (v) => update({ categoryId: v }),
      options: [all, ...categories.filter((c) => !c.deleted_at).map((c) => ({ value: c.id, label: c.name }))],
    },
    {
      kind: 'select',
      key: 'object',
      label: te.filterObject,
      value: form.objectId,
      onChange: (v) => update({ objectId: v }),
      options: [all, { value: NO_OBJECT, label: te.general }, ...objects.map((o) => ({ value: o.id, label: o.name }))],
    },
    {
      kind: 'select',
      key: 'payer',
      label: te.filterPayer,
      value: form.payerId,
      onChange: (v) => update({ payerId: v }),
      options: [all, ...profiles.map((p) => ({ value: p.id, label: p.full_name }))],
    },
    {
      kind: 'dateRange',
      key: 'date',
      label: te.colDate,
      from: form.from,
      to: form.to,
      onFrom: (v) => update({ from: v }),
      onTo: (v) => update({ to: v }),
      fromLabel: to.filterFrom,
      toLabel: to.filterTo,
    },
  ]
  if (canSeeDeleted)
    filters.push({ kind: 'toggle', key: 'deleted', label: to.filterDeleted, checked: form.includeDeleted, onChange: (v) => update({ includeDeleted: v }) })

  const runExport = async (signal: AbortSignal) => {
    const rows = await listAllExpenses(toExpenseFilters(form, canSeeDeleted), signal)
    await exportWorkbook({ fileName: exportFileName(te.exportSection), sheets: [expensesSheet(rows)], signal })
  }

  const deleted = (e: Expense) => (e.deleted_at ? <Badge tone="danger">{t.movements.deleted}</Badge> : null)
  const open = (e: Expense) => setDialog({ kind: 'detail', expense: e })

  return (
    <>
      {header(
        <>
          <ExportButton run={runExport} />
          {canCreate && (
            <Button icon={<Plus aria-hidden className="size-5" strokeWidth={1.75} />} onClick={() => setDialog({ kind: 'add' })}>
              {te.add}
            </Button>
          )}
        </>,
      )}
      <FilterBar label={to.filters} filters={filters} onClear={() => update(EMPTY)} />
      {notice && <Notice tone="ok">{notice}</Notice>}
      {error && <RetryNotice message={error} onRetry={reload} />}
      {actionError && !dialog && <Notice>{actionError}</Notice>}
      {!data && !error && <Spinner />}
      {data && (
        <DataTable
          caption={te.title}
          rows={data.rows}
          rowKey={(e) => e.id}
          rowTestId="expense-row"
          rowClassName={(e) => (e.deleted_at ? 'bg-canvas/60 text-muted' : undefined)}
          empty={<EmptyState icon={<Receipt strokeWidth={1.5} />} title={te.empty} text={te.emptyHint} />}
          columns={[
            {
              key: 'date',
              header: te.colDate,
              cell: (e) => (
                <span className="flex flex-col items-start gap-1">
                  <span className="tabular whitespace-nowrap text-muted">{formatDateTime(e.spent_at)}</span>
                  {deleted(e)}
                </span>
              ),
            },
            {
              key: 'category',
              header: te.colCategory,
              cell: (e) => (
                <span className="flex flex-col">
                  <span className={e.deleted_at ? 'line-through' : 'font-medium text-ink'}>{e.category_name}</span>
                  {e.note && <span className="line-clamp-1 text-xs text-muted">{e.note}</span>}
                </span>
              ),
            },
            { key: 'object', header: te.colObject, cell: (e) => e.object_name ?? te.general },
            { key: 'payer', header: te.colPayer, cell: (e) => e.payer_name },
            { key: 'source', header: te.colPaymentSource, cell: (e) => t.purchases.paymentSources[e.payment_source] },
            { key: 'amount', header: te.colAmount, align: 'right', cell: (e) => <Money value={e.amount} size="sm" /> },
            {
              key: 'receipt',
              header: te.colReceipt,
              align: 'center',
              cell: (e) =>
                e.receipt_photo_path ? (
                  <Receipt role="img" aria-label={te.receipt} className="size-5 text-navy" strokeWidth={1.75} />
                ) : (
                  <span className="text-muted">—</span>
                ),
            },
            { key: 'alerts', header: te.colAlerts, cell: (e) => <AlertBadges e={e} /> },
            {
              key: 'actions',
              header: te.colActions,
              srHeader: true,
              cell: (e) => (
                <Button variant="ghost" size="sm" onClick={() => open(e)}>
                  {t.purchases.open}
                </Button>
              ),
            },
          ]}
          renderMobile={(e) => (
            <EntryRow
              kind="xarid"
              icon={<Receipt className="size-5" strokeWidth={1.75} />}
              deleted={Boolean(e.deleted_at)}
              title={e.category_name}
              badge={deleted(e)}
              meta={
                <>
                  <span>{e.object_name ?? te.general}</span>
                  <span>{e.payer_name}</span>
                  <span className="tabular">{formatDateTime(e.spent_at)}</span>
                  <AlertBadges e={e} />
                </>
              }
              trailing={<Money value={e.amount} size="lg" />}
              onClick={() => open(e)}
            />
          )}
          footer={<Pager page={page} pageSize={EXPENSES_PAGE_SIZE} total={data.total} onPage={setPage} />}
        />
      )}

      {dialog?.kind === 'add' &&
        addDialog({
          onClose: close,
          onSaved: (e) => {
            setDialog(null)
            setNotice(te.added(e.category_name ?? ''))
            reload()
          },
        })}

      {dialog?.kind === 'detail' && (
        <ExpenseDetailSheet
          expense={dialog.expense}
          onClose={close}
          footer={
            <>
              <HistoryLink table="expenses" id={dialog.expense.id} className="flex-1 sm:flex-none" />
              {correctionFor(dialog.expense) && (
                <Button
                  variant="secondary"
                  className="flex-1 sm:flex-none"
                  icon={<PencilLine aria-hidden className="size-5" strokeWidth={1.75} />}
                  onClick={() => setDialog({ kind: 'correct', expense: dialog.expense })}
                >
                  {t.correction.action}
                </Button>
              )}
              {correctionFor(dialog.expense)?.admin === false && (
                <Button
                  variant="secondary"
                  className="flex-1 sm:flex-none"
                  icon={<Trash2 aria-hidden className="size-5" strokeWidth={1.75} />}
                  onClick={() => setDialog({ kind: 'cancel', expense: dialog.expense })}
                >
                  {t.correction.cancelAction}
                </Button>
              )}
              {isAdmin &&
                (dialog.expense.deleted_at ? (
                  <Button
                    variant="secondary"
                    className="flex-1 sm:flex-none"
                    loading={busy}
                    icon={<RotateCcw aria-hidden className="size-5" strokeWidth={1.75} />}
                    onClick={() => {
                      const id = dialog.expense.id
                      void run(() => restoreExpense(id), t.history.restored)
                    }}
                  >
                    {to.restore}
                  </Button>
                ) : (
                  <Button
                    variant="danger"
                    className="flex-1 sm:flex-none"
                    icon={<Trash2 aria-hidden className="size-5" strokeWidth={1.75} />}
                    onClick={() => setDialog({ kind: 'delete', expense: dialog.expense })}
                  >
                    {to.delete}
                  </Button>
                ))}
            </>
          }
          error={actionError}
        />
      )}

      {dialog?.kind === 'correct' && (
        <Modal title={t.correction.title} onClose={close}>
          <ExpenseCorrectionForm
            target={dialog.expense}
            allowMove={correctionFor(dialog.expense)?.admin === false}
            remaining={correctionFor(dialog.expense)?.remaining ?? null}
            onCancel={close}
            onDone={() => {
              setDialog(null)
              setNotice(t.correction.saved)
              reload()
            }}
          />
        </Modal>
      )}

      {dialog?.kind === 'cancel' && (
        <CancelOwnDialog
          busy={busy}
          error={actionError}
          onClose={close}
          onConfirm={(reason) =>
            void run(() => cancelOwnEntry('expenses', dialog.expense.id, reason), t.correction.cancelled, { leavesPage: true })
          }
        />
      )}

      {dialog?.kind === 'delete' && (
        <Modal
          title={to.delete}
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                {t.common.no}
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void run(() => softDeleteExpense(dialog.expense.id), undefined, { leavesPage: true })}>
                {t.common.yes}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">{te.deleteConfirm}</p>
            {actionError && <Notice>{actionError}</Notice>}
          </div>
        </Modal>
      )}
    </>
  )
}

/** Xarajat tafsiloti: summa, tur, obyekt, to'lovchi, pul manbai, chek rasmi va QR, joylashuv. */
export function ExpenseDetailSheet({
  expense: e,
  onClose,
  footer,
  error,
}: {
  expense: Expense
  onClose: () => void
  footer?: ReactNode
  error?: string | null
}) {
  const row = (label: string, value: ReactNode) => (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </>
  )
  return (
    <DetailSheet title={te.detailTitle} onClose={onClose} size="lg" footer={footer}>
      <div className="flex flex-col gap-5" data-testid="expense-detail">
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-line bg-canvas p-4">
          <span className="text-lg font-semibold text-ink">{e.category_name}</span>
          <Money value={e.amount} size="lg" />
        </div>
        {e.deleted_at && <Badge tone="danger">{t.movements.deleted}</Badge>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {row(te.colDate, <span className="tabular">{formatDateTime(e.spent_at)}</span>)}
          {row(te.colObject, e.object_name ?? te.general)}
          {row(te.colPayer, e.payer_name ?? '—')}
          {row(te.colPaymentSource, t.purchases.paymentSources[e.payment_source])}
          {e.supplier_name && row(t.purchases.colSupplier, e.supplier_name)}
          {e.note && row(te.colNote, <span className="whitespace-pre-wrap">{e.note}</span>)}
        </dl>
        <AlertBadges e={e} />
        <section className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-ink">{te.receipt}</h3>
          {e.receipt_photo_path ? <MovementPhoto path={e.receipt_photo_path} alt={te.receipt} /> : <p className="text-sm text-muted">{te.noReceipt}</p>}
          {e.receipt_fiscal_sign && <PurchaseQr p={e} />}
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-ink">{t.purchases.geoTitle}</h3>
          <PurchaseGeo p={e} />
        </section>
        {error && <Notice>{error}</Notice>}
      </div>
    </DetailSheet>
  )
}
