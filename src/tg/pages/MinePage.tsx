import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAuth } from '@/auth/authContext'
import type { CorrectionTarget } from '@/components/corrections/CorrectionForm'
import { MovementPhoto } from '@/components/MovementPhoto'
import { NotifyWorkflowToggle } from '@/components/NotifyWorkflowToggle'
import { INVENTORY_TONE, REQUEST_TONE, TRANSFER_TONE } from '@/components/statusTones'
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Bug,
  Camera,
  ClipboardCheck,
  ClipboardList,
  PencilLine,
  Receipt,
  Trash2,
  Scale,
  ShoppingCart,
  Undo2,
  Wallet,
  XCircle,
} from 'lucide-react'
import {
  Badge,
  BottomSheet,
  Button,
  choiceClass,
  DetailRows,
  FilterBar,
  EmptyState,
  EntryRow,
  type BadgeTone,
  type EntryKind,
  Money,
  Notice,
  Qty,
  RetryNotice,
  sameQty,
  SkeletonRows,
} from '@/components/ui'
import { listMyBugReports, type BugReport, type BugReportStatus } from '@/data/bugReportsRepo'
import { listMyAdvances } from '@/data/cashRepo'
import { listCounts } from '@/data/inventoryRepo'
import { listMyMovements } from '@/data/movementsRepo'
import { listMyPurchases } from '@/data/purchasesRepo'
import { listMyExpenses } from '@/data/expensesRepo'
import { listMyRequests } from '@/data/requestsRepo'
import { cancelTransfer, CANCEL_REASON_MAX, listMyTransfers } from '@/data/transfersRepo'
import type { CashAdvance, Expense, InventoryCount, MaterialRequest, Movement, Purchase, Transfer } from '@/data/types'
import { cancelOwnEntry, CORRECTION_NOTE_MAX } from '@/data/correctionsRepo'
import { remainingMinutes, selfCorrection, type CorrectableEntry } from '@/domain/corrections'
import { simpleReceiptStatus, type SimpleReceiptStatus } from '@/domain/purchaseStatus'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDate, formatDateTime, formatQtyUnit, formatSum } from '@/lib/format'
import { useNow } from '@/lib/useNow'
import { useCompanySettings } from '../entry/useCompanySettings'
import { haptic } from '../telegram'
import { BackLink } from '../ui'
import { useBackButton } from '../useTelegramButtons'
import {
  filterEntries,
  MINE_LIMIT,
  mergeEntries,
  mineSources,
  presentCategories,
  type Entry,
  type ExpenseEntry,
  type MineCategory,
  type OtherEntry,
  type PlanEntry,
  type RecordEntry,
} from '../mine/mineEntries'
import { TgCorrectionForm } from '../corrections/TgCorrectionForm'
import { readUuidParam } from '../deepLinks'
import { ExpenseDetail, ExpenseRow } from '../mine/ExpenseItems'
import { ReasonForm } from '../mine/ReasonForm'

const tm = t.tg.mine

function isPlan(e: Entry): e is PlanEntry {
  return e.kind === 'request' || e.kind === 'transfer'
}

function isExpense(e: Entry): e is ExpenseEntry {
  return e.kind === 'expense'
}

function isRecord(e: Entry): e is RecordEntry {
  return e.kind === 'movement' || e.kind === 'purchase'
}

function inputQty(m: Pick<Movement, 'qty_input' | 'unit_input' | 'unit_variant'>): string {
  return formatQtyUnit(m.qty_input, unitLabel({ unit: m.unit_input, variant: m.unit_variant }))
}

function baseQty(m: Pick<Movement, 'qty_base' | 'base_unit'>): string {
  return formatQtyUnit(m.qty_base, m.base_unit)
}

const ic = 'size-5'

/** Yozuv turi: chiziq rangi, belgi va nom (kirim — yashil, chiqim — ko'k, xarid — navy, o'tkazma — kulrang-ko'k). */
function typeMark(e: Entry): { kind: EntryKind; icon: ReactNode; label: string } {
  if (e.kind === 'request') return { kind: 'neutral', icon: <ClipboardList className={ic} strokeWidth={1.75} />, label: tm.request }
  if (e.kind === 'transfer') return { kind: 'transfer', icon: <ArrowLeftRight className={ic} strokeWidth={1.75} />, label: tm.transfer }
  if (e.kind === 'purchase') return { kind: 'xarid', icon: <ShoppingCart className={ic} strokeWidth={1.75} />, label: tm.purchase }
  if (e.kind === 'expense') return { kind: 'xarid', icon: <Receipt className={ic} strokeWidth={1.75} />, label: t.expenses.one }
  if (e.kind === 'count') return { kind: 'neutral', icon: <ClipboardCheck className={ic} strokeWidth={1.75} />, label: tm.count }
  if (e.kind === 'bug') return { kind: 'neutral', icon: <Bug className={ic} strokeWidth={1.75} />, label: tm.bug }
  if (e.kind === 'cash') {
    return e.row.kind === 'qaytarildi'
      ? { kind: 'neutral', icon: <Undo2 className={ic} strokeWidth={1.75} />, label: tm.cashReturned }
      : { kind: 'ok', icon: <Wallet className={ic} strokeWidth={1.75} />, label: tm.cashIssued }
  }
  const m = e.row
  const label = t.movements.types[m.type]
  if (m.type === 'kirim') return { kind: 'kirim', icon: <ArrowDownLeft className={ic} strokeWidth={2} />, label }
  if (m.type === 'chiqim') return { kind: 'chiqim', icon: <ArrowUpRight className={ic} strokeWidth={2} />, label }
  if (m.type === 'transfer_in' || m.type === 'transfer_out')
    return { kind: 'transfer', icon: <ArrowLeftRight className={ic} strokeWidth={1.75} />, label }
  return { kind: 'neutral', icon: <Scale className={ic} strokeWidth={1.75} />, label }
}

/** Kiritilgan birlik asosiy bilan bir xil — "= ..." takrorlanmaydi (umumiy qoida: `sameQty`). */
function sameAsBase(m: Pick<Movement, 'qty_input' | 'unit_input' | 'unit_variant' | 'qty_base' | 'base_unit'>): boolean {
  return sameQty({ value: m.qty_input, unit: unitOf(m) }, { value: m.qty_base, unit: m.base_unit })
}

function unitOf(m: Pick<Movement, 'unit_input' | 'unit_variant'>): string {
  return unitLabel({ unit: m.unit_input, variant: m.unit_variant })
}

/** Xarid mening nomimga boshqa odam (admin) tomonidan kiritilgan. */
function byOther(p: Purchase, myId: string): boolean {
  return p.created_by !== null && p.created_by !== myId
}

const RECEIPT_TONE: Record<SimpleReceiptStatus, BadgeTone> = { received: 'ok', partial: 'warn', pending: 'neutral' }

/** Qabul holati belgisi — firma chegarasi (receipt_mismatch_pct) bilan. */
function receiptBadge(p: Purchase, thresholdPct: string): ReactNode {
  const status = simpleReceiptStatus(p.qty_base, p.receipt?.received_qty_base, thresholdPct)
  return status ? <Badge tone={RECEIPT_TONE[status]}>{tm.receiptStatus[status]}</Badge> : null
}

const BUG_TONE: Record<BugReportStatus, BadgeTone> = { yangi: 'info', korildi: 'neutral', hal_qilindi: 'ok' }

/** Sanash holati: qoralama / yakunlangan / qoldiq tuzatilgan. */
function countBadge(c: InventoryCount): ReactNode {
  if (c.applied_at) return <Badge tone="ok">{tm.countApplied}</Badge>
  return <Badge tone={INVENTORY_TONE[c.status]}>{t.inventory.statuses[c.status]}</Badge>
}

function correctable(e: RecordEntry): CorrectableEntry {
  return e.kind === 'movement'
    ? {
        table: 'movements',
        createdBy: e.row.created_by,
        createdAt: e.row.created_at,
        deletedAt: e.row.deleted_at,
        movementType: e.row.type,
        purchaseId: e.row.purchase_id,
        transferId: e.row.transfer_id ?? null,
        inventoryCountId: e.row.inventory_count_id ?? null,
      }
    : {
        table: 'purchases',
        createdBy: e.row.created_by,
        createdAt: e.row.created_at,
        deletedAt: e.row.deleted_at,
        linkedReceipts: e.row.receipt ? e.row.receipt.receipt_count : null,
      }
}

function correctionTarget(e: RecordEntry): CorrectionTarget {
  const r = e.row
  return {
    table: e.kind === 'movement' ? 'movements' : 'purchases',
    id: r.id,
    materialId: r.material_id,
    materialName: r.material_name,
    objectId: r.object_id,
    qtyInput: r.qty_input,
    unitId: r.unit_id,
    totalAmount: e.kind === 'purchase' ? e.row.total_amount : null,
    note: r.note,
  }
}

export function MinePage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Qo'shimcha ro'yxatlardan biri yuklanmadi — asosiy ro'yxat baribir ko'rsatiladi
  const [partial, setPartial] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // "Ko'proq yuklash": har bosishda yana 50 ta (har bir manba shu chegaragacha o'qiladi)
  const [limit, setLimit] = useState(MINE_LIMIT)
  const [hasMore, setHasMore] = useState(false)
  const [category, setCategory] = useState<MineCategory>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // Telegram xabaridagi havola: /tg/mine?request=<id> yoki ?purchase=<id> — tafsilot ochiladi (topilmasa — jim)
  const [params, setParams] = useSearchParams()
  const linkedRequest = readUuidParam(params, 'request')
  const linkedPurchase = readUuidParam(params, 'purchase')
  const linkedExpense = readUuidParam(params, 'expense')
  const linkedKey = linkedRequest
    ? `r:${linkedRequest}`
    : linkedPurchase
      ? `p:${linkedPurchase}`
      : linkedExpense
        ? `e:${linkedExpense}`
        : null
  // Havola birinchi ochilishda eslab qolinadi; ro'yxatda topilmasa — jim (oddiy ro'yxat)
  const [pendingLink, setPendingLink] = useState(linkedKey)
  const profileId = profile?.id
  const role = profile?.role

  useEffect(() => {
    if (!profileId || !role) return
    let alive = true
    let failed = false
    const src = mineSources(role)
    // Qo'shimcha ro'yxatlar: xato bo'lsa ham kirim/chiqimlar ko'rsatiladi, lekin xato yashirilmaydi
    function optional<T>(p: Promise<T>, fallback: T): Promise<T> {
      return p.catch(() => {
        failed = true
        return fallback
      })
    }
    const none = <T,>(): Promise<T[]> => Promise.resolve([])
    Promise.all([
      src.movements ? listMyMovements(profileId, limit) : none<Movement>(),
      src.purchases ? optional(listMyPurchases(profileId, limit), [] as Purchase[]) : none<Purchase>(),
      src.requests ? optional(listMyRequests(profileId, limit), [] as MaterialRequest[]) : none<MaterialRequest>(),
      optional<Transfer[] | null>(listMyTransfers(profileId, limit), null),
      src.counts ? optional(listCounts({ createdBy: profileId }).then((r) => r.rows), [] as InventoryCount[]) : none<InventoryCount>(),
      src.cashRecipient ? optional(listMyAdvances(profileId, 'recipient'), [] as CashAdvance[]) : none<CashAdvance>(),
      src.cashCreator ? optional(listMyAdvances(profileId, 'creator'), [] as CashAdvance[]) : none<CashAdvance>(),
      optional(listMyBugReports(profileId), [] as BugReport[]),
      src.expenses ? optional(listMyExpenses(profileId, limit), [] as Expense[]) : none<Expense>(),
    ])
      .then(([movements, purchases, requests, transfers, counts, cashIn, cashOut, bugs, expenses]) => {
        if (!alive) return
        const all = mergeEntries(
          movements,
          purchases,
          requests,
          transfers,
          { counts, cash: [...cashIn, ...cashOut], bugs, expenses },
          Number.MAX_SAFE_INTEGER,
        )
        setRows(all.slice(0, limit))
        // Biror manba chegaraga yetdi yoki birlashgan ro'yxat uzunroq — yana bor
        setHasMore(all.length > limit || [movements, purchases, requests, transfers ?? [], expenses].some((list) => list.length >= limit))
        setPartial(failed)
        setError(null)
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err))
      })
    return () => {
      alive = false
    }
  }, [profileId, role, reloadKey, limit])

  const close = useCallback(() => {
    setOpenKey(null)
    setPendingLink(null)
  }, [])
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const open = rows?.find((r) => r.key === (openKey ?? pendingLink)) ?? null
  // Havola parametri bir marta ishlatiladi — URL tozalanadi (orqaga qaytganda qayta ochilmasin)
  useEffect(() => {
    if (!linkedKey) return
    const next = new URLSearchParams(params)
    next.delete('request')
    next.delete('purchase')
    next.delete('expense')
    setParams(next, { replace: true })
  }, [linkedKey, params, setParams])
  const shown = useMemo(() => (rows ? filterEntries(rows, category, from, to) : null), [rows, category, from, to])
  const categories = useMemo(() => (rows ? presentCategories(rows) : []), [rows])
  useBackButton(open ? close : null)
  // Tuzatish oynasi sanog'i — faqat ro'yxat ko'rinib turganda
  const now = useNow(15_000, Boolean(rows))
  const settings = useCompanySettings(profile?.company_id)

  if (!profile) return null
  // Faqat ko'ruvchi rol (direktor): ish xabarlari va yozuv kiritish yo'q
  const viewer = profile.role === 'direktor'

  const finished = (text: string) => {
    haptic.success()
    setDone(text)
    setOpenKey(null)
    reload()
  }

  if (open && isPlan(open)) return <PlanDetail entry={open} myId={profile.id} onClose={close} onCancelled={() => finished(tm.cancelled)} />
  if (open && isRecord(open))
    return (
      <RecordDetail
        entry={open}
        myId={profile.id}
        nowIso={now}
        thresholdPct={settings.receiptMismatchPct}
        onClose={close}
        onCorrected={() => finished(t.correction.saved)}
        onCancelled={() => finished(t.correction.cancelled)}
      />
    )
  if (open && isExpense(open))
    return (
      <ExpenseDetail
        row={open.row}
        myId={profile.id}
        nowIso={now}
        onClose={close}
        onCorrected={() => finished(t.correction.saved)}
        onCancelled={() => finished(t.correction.cancelled)}
      />
    )
  if (open) return <OtherDetail entry={open} onClose={close} />

  return (
    <div className="flex flex-col gap-4">
      {/* Ish xabarlari (so'rov, o'tkazma, xarid) — tepada; direktorga tegishli emas */}
      {!viewer && <NotifyWorkflowToggle compact />}
      {done && <Notice tone="ok">{done}</Notice>}
      {error && <RetryNotice message={error} onRetry={reload} />}
      {!error && partial && <RetryNotice message={tm.partialError} onRetry={reload} />}
      {!rows && !error && <SkeletonRows rows={4} />}
      {rows && rows.length === 0 && (
        <EmptyState
          icon={<ClipboardList strokeWidth={1.5} />}
          title={viewer ? tm.emptyViewerTitle : tm.empty}
          text={viewer ? tm.emptyViewerHint : tm.emptyHint}
        />
      )}
      {rows && rows.length > 0 && (
        <>
          {categories.length > 2 && (
            <div role="group" aria-label={tm.filterLabel} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={category === c}
                  className={choiceClass({ selected: category === c, size: 'md' })}
                  onClick={() => {
                    haptic.select()
                    setCategory(c)
                  }}
                >
                  {tm.filters[c]}
                </button>
              ))}
            </div>
          )}
          <FilterBar
            filters={[
              { kind: 'dateRange', key: 'date', label: tm.dateFilter, from, to, onFrom: setFrom, onTo: setTo, fromLabel: tm.dateFrom, toLabel: tm.dateTo },
            ]}
            onClear={() => {
              setFrom('')
              setTo('')
            }}
          />
        </>
      )}
      {shown && rows && rows.length > 0 && shown.length === 0 && (
        <EmptyState compact icon={<ClipboardList strokeWidth={1.5} />} title={tm.emptyFiltered} text={hasMore ? tm.emptyFilteredHint : undefined} />
      )}
      {shown && shown.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={tm.title}>
          {shown.map((e) => {
            const openRow = () => {
              haptic.tap()
              setDone(null)
              setOpenKey(e.key)
            }
            if (isPlan(e)) return <PlanRow key={e.key} entry={e} onOpen={openRow} />
            if (isExpense(e)) return <ExpenseRow key={e.key} row={e.row} myId={profile.id} nowIso={now} onOpen={openRow} />
            if (!isRecord(e)) return <OtherRow key={e.key} entry={e} onOpen={openRow} />
            const mark = typeMark(e)
            const r = e.row
            const hasPhoto = e.kind === 'purchase' ? Boolean(e.row.receipt_photo_path) : Boolean(e.row.photo_path)
            const fix = selfCorrection(correctable(e), profile.id, now)
            return (
              <EntryRow
                key={e.key}
                as="li"
                kind={mark.kind}
                icon={mark.icon}
                deleted={Boolean(r.deleted_at)}
                title={r.material_name ?? ''}
                badge={
                  <>
                    {hasPhoto && (
                      <Camera role="img" aria-label={t.movements.hasPhoto} className="size-4 text-muted" strokeWidth={1.75} />
                    )}
                    {r.deleted_at && <Badge tone="danger">{t.movements.deleted}</Badge>}
                    {e.kind === 'purchase' && byOther(e.row, profile.id) && <Badge tone="info">{tm.enteredByOther}</Badge>}
                    {e.kind === 'purchase' && !r.deleted_at && receiptBadge(e.row, settings.receiptMismatchPct)}
                    {fix.allowed && (
                      <Badge tone="info" icon={<PencilLine aria-hidden strokeWidth={2} />}>
                        {t.correction.remainingShort(remainingMinutes(fix.remainingMs))}
                      </Badge>
                    )}
                  </>
                }
                meta={
                  <>
                    <span>
                      <span className="font-medium text-ink">{mark.label}</span>
                      <span>{r.object_name}</span>
                    </span>
                    <span className="tabular">{formatDateTime(e.kind === 'purchase' ? e.row.purchased_at : e.row.occurred_at)}</span>
                  </>
                }
                trailing={
                  e.kind === 'purchase' ? <Money value={e.row.total_amount} /> : <Qty value={r.qty_input} unit={unitOf(r)} />
                }
                trailingMeta={e.kind === 'purchase' ? inputQty(r) : sameAsBase(r) ? undefined : `= ${baseQty(r)}`}
                onClick={openRow}
              />
            )
          })}
        </ul>
      )}
      {rows && hasMore && (
        <Button
          variant="secondary"
          size="lg"
          onClick={() => {
            haptic.tap()
            setLimit((n) => n + MINE_LIMIT)
          }}
        >
          {tm.loadMore}
        </Button>
      )}
    </div>
  )
}

/** Tafsilot kartochkasi (DetailRows atrofida). */
const detailCard = 'rounded-xl border border-line bg-paper px-4'

/** Kiritilgan miqdor; asosiy birlikda boshqacha bo'lsa — ostida alohida qatorda "= …". */
function QtyWithBase({ r }: { r: Pick<Movement, 'qty_input' | 'unit_input' | 'unit_variant' | 'qty_base' | 'base_unit'> }) {
  return (
    <span className="tabular inline-flex flex-col items-end">
      <span>{inputQty(r)}</span>
      {!sameAsBase(r) && <span className="text-xs font-normal text-muted">= {baseQty(r)}</span>}
    </span>
  )
}

function DetailHeader({ mark, children }: { mark: ReturnType<typeof typeMark>; children?: ReactNode }) {
  const tone: Record<EntryKind, string> = {
    kirim: 'bg-ok-bg text-ok',
    ok: 'bg-ok-bg text-ok',
    chiqim: 'bg-ice text-brand',
    xarid: 'bg-ice text-navy',
    transfer: 'bg-canvas text-transfer',
    warn: 'bg-warn-bg text-warn',
    danger: 'bg-danger-bg text-danger',
    neutral: 'bg-canvas text-muted',
  }
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className={`inline-flex size-12 shrink-0 items-center justify-center rounded-xl [&>svg]:size-6 ${tone[mark.kind]}`}>
        {mark.icon}
      </span>
      <div className="flex flex-col items-start gap-1">
        <h2 className="text-xl font-semibold text-ink">{mark.label}</h2>
        {children}
      </div>
    </div>
  )
}

/** Kirim/chiqim yoki xarid tafsiloti; 30 daqiqa ichida — "Tuzatish". */
function RecordDetail({
  entry,
  myId,
  nowIso,
  thresholdPct,
  onClose,
  onCorrected,
  onCancelled,
}: {
  entry: RecordEntry
  myId: string
  nowIso: string
  thresholdPct: string
  onClose: () => void
  onCorrected: () => void
  onCancelled: () => void
}) {
  const [correcting, setCorrecting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const mark = typeMark(entry)
  const r = entry.row
  const fix = selfCorrection(correctable(entry), myId, nowIso)
  return (
    <article className="flex flex-col gap-4" aria-label={tm.detail}>
      <BackLink label={t.common.back} onClick={onClose} />
      <DetailHeader mark={mark}>
        {r.deleted_at && <Badge tone="danger">{t.movements.deleted}</Badge>}
        {entry.kind === 'purchase' && byOther(entry.row, myId) && <Badge tone="info">{tm.enteredByOther}</Badge>}
        {entry.kind === 'purchase' && !r.deleted_at && receiptBadge(entry.row, thresholdPct)}
      </DetailHeader>
      <div className="flex flex-col gap-1 rounded-xl border border-line bg-paper px-4 py-3">
        <span className="text-sm text-muted">{r.material_name}</span>
        {entry.kind === 'purchase' ? <Money value={entry.row.total_amount} size="hero" /> : <Qty value={r.qty_input} unit={unitOf(r)} size="hero" />}
      </div>
      {fix.allowed && (
        <Button
          variant="secondary"
          size="lg"
          icon={<PencilLine aria-hidden className="size-5" strokeWidth={1.75} />}
          onClick={() => {
            haptic.tap()
            setCorrecting(true)
          }}
        >
          {t.correction.actionWithTime(remainingMinutes(fix.remainingMs))}
        </Button>
      )}
      {fix.allowed && (
        <Button
          variant="danger"
          size="lg"
          icon={<Trash2 aria-hidden className="size-5" strokeWidth={1.75} />}
          onClick={() => {
            haptic.tap()
            setCancelling(true)
          }}
        >
          {t.correction.cancelAction}
        </Button>
      )}
      <DetailRows
        className={detailCard}
        items={[
          { label: tm.material, value: r.material_name },
          { label: tm.qty, value: <QtyWithBase r={r} /> },
          entry.kind === 'purchase' && { label: tm.sum, value: <span className="tabular font-semibold">{formatSum(entry.row.total_amount)}</span> },
          entry.kind === 'purchase' && {
            label: tm.unitPrice,
            value: <span className="tabular">{`${formatSum(entry.row.unit_price)} / ${unitOf(entry.row)}`}</span>,
          },
          entry.kind === 'purchase' && entry.row.supplier_name ? { label: tm.supplier, value: entry.row.supplier_name } : null,
          entry.kind === 'purchase' && entry.row.receipt
            ? {
                label: tm.received,
                value: <span className="tabular">{formatQtyUnit(entry.row.receipt.received_qty_base, entry.row.base_unit)}</span>,
              }
            : null,
          { label: tm.object, value: r.object_name },
          {
            label: tm.time,
            value: <span className="tabular">{formatDateTime(entry.kind === 'purchase' ? entry.row.purchased_at : entry.row.occurred_at)}</span>,
          },
          r.note ? { label: t.movements.note, value: <span className="whitespace-pre-wrap">{r.note}</span> } : null,
        ]}
      />
      {entry.kind === 'purchase' ? (
        entry.row.receipt_photo_path ? (
          <MovementPhoto path={entry.row.receipt_photo_path} alt={tm.receipt} />
        ) : (
          <p className="text-sm text-muted">{tm.noReceipt}</p>
        )
      ) : entry.row.photo_path ? (
        <MovementPhoto path={entry.row.photo_path} alt={t.movements.photo} />
      ) : (
        <p className="text-sm text-muted">{t.movements.noPhoto}</p>
      )}
      {correcting && (
        <BottomSheet title={t.correction.title} onClose={() => setCorrecting(false)}>
          <TgCorrectionForm
            target={correctionTarget(entry)}
            remaining={fix.allowed ? remainingMinutes(fix.remainingMs) : null}
            onCancel={() => setCorrecting(false)}
            onDone={() => {
              setCorrecting(false)
              onCorrected()
            }}
          />
        </BottomSheet>
      )}
      {cancelling && (
        <BottomSheet title={t.correction.cancelTitle} onClose={() => setCancelling(false)}>
          <ReasonForm
            text={t.correction.cancelText}
            label={t.correction.cancelReason}
            requiredText={t.correction.errCancelReason}
            confirm={t.correction.cancelConfirm}
            maxLength={CORRECTION_NOTE_MAX}
            onCancel={() => setCancelling(false)}
            onSubmit={(reason) => cancelOwnEntry(entry.kind === 'movement' ? 'movements' : 'purchases', r.id, reason)}
            onDone={() => {
              setCancelling(false)
              onCancelled()
            }}
          />
        </BottomSheet>
      )}
    </article>
  )
}

function planStatus(e: PlanEntry) {
  return e.kind === 'request' ? (
    <Badge tone={REQUEST_TONE[e.row.status]}>{t.requests.statuses[e.row.status]}</Badge>
  ) : (
    <Badge tone={TRANSFER_TONE[e.row.status]}>{t.transfers.statuses[e.row.status]}</Badge>
  )
}

function planPlace(e: PlanEntry): string {
  if (e.kind === 'request') return e.row.object_name ?? ''
  return `${e.row.from_object_name ?? t.tg.incoming.otherObject} → ${e.row.to_object_name ?? t.tg.incoming.otherObject}`
}

/** So'rov yoki o'tkazma qatori — holati bilan. */
function PlanRow({ entry, onOpen }: { entry: PlanEntry; onOpen: () => void }) {
  const mark = typeMark(entry)
  const r = entry.row
  return (
    <EntryRow
      as="li"
      kind={mark.kind}
      icon={mark.icon}
      title={r.material_name ?? ''}
      badge={planStatus(entry)}
      meta={
        <>
          <span>
            <span className="font-medium text-ink">{mark.label}</span>
            <span>{planPlace(entry)}</span>
          </span>
          <span className="tabular">{formatDateTime(r.created_at)}</span>
        </>
      }
      trailing={<Qty value={r.qty_input} unit={unitOf(r)} />}
      onClick={onOpen}
    />
  )
}

/** So'rov / o'tkazma tafsiloti. O'z o'tkazmasi "Yuborildi" holatida — "Bekor qilish" (cancel_transfer). */
function PlanDetail({
  entry,
  myId,
  onClose,
  onCancelled,
}: {
  entry: PlanEntry
  myId: string
  onClose: () => void
  onCancelled: () => void
}) {
  const [cancelling, setCancelling] = useState(false)
  const mark = typeMark(entry)
  const r = entry.row
  const canCancel = entry.kind === 'transfer' && entry.row.status === 'yuborildi' && entry.row.created_by === myId
  return (
    <article className="flex flex-col gap-4" aria-label={tm.detail}>
      <BackLink label={t.common.back} onClick={onClose} />
      <DetailHeader mark={mark}>{planStatus(entry)}</DetailHeader>
      <div className="flex flex-col gap-1 rounded-xl border border-line bg-paper px-4 py-3">
        <span className="text-sm text-muted">{r.material_name}</span>
        <Qty value={r.qty_input} unit={unitOf(r)} size="hero" />
      </div>
      <DetailRows
        className={detailCard}
        items={[
          { label: tm.material, value: r.material_name },
          { label: tm.qty, value: <QtyWithBase r={r} /> },
          ...(entry.kind === 'request'
            ? [
                { label: tm.object, value: entry.row.object_name },
                entry.row.needed_by
                  ? { label: tm.neededBy, value: <span className="tabular">{formatDate(`${entry.row.needed_by}T12:00:00+05:00`)}</span> }
                  : null,
                entry.row.decision_note
                  ? { label: tm.decisionNote, value: <span className="whitespace-pre-wrap">{entry.row.decision_note}</span> }
                  : null,
              ]
            : [
                { label: tm.from, value: entry.row.from_object_name ?? t.tg.incoming.otherObject },
                { label: tm.to, value: entry.row.to_object_name ?? t.tg.incoming.otherObject },
                entry.row.received_qty_base !== null
                  ? { label: tm.received, value: <span className="tabular">{formatQtyUnit(entry.row.received_qty_base, entry.row.base_unit)}</span> }
                  : null,
                entry.row.cancel_reason
                  ? { label: tm.decisionNote, value: <span className="whitespace-pre-wrap">{entry.row.cancel_reason}</span> }
                  : null,
              ]),
          { label: tm.time, value: <span className="tabular">{formatDateTime(r.created_at)}</span> },
          r.note ? { label: t.movements.note, value: <span className="whitespace-pre-wrap">{r.note}</span> } : null,
        ]}
      />
      {canCancel && (
        <Button
          variant="danger"
          size="lg"
          icon={<XCircle aria-hidden className="size-5" strokeWidth={1.75} />}
          onClick={() => {
            haptic.tap()
            setCancelling(true)
          }}
        >
          {tm.cancelTransfer}
        </Button>
      )}
      {cancelling && entry.kind === 'transfer' && (
        <BottomSheet title={tm.cancelTitle} onClose={() => setCancelling(false)}>
          <ReasonForm
            text={t.ombor.transfers.cancelText}
            label={t.ombor.transfers.cancelReason}
            requiredText={t.ombor.transfers.cancelReasonRequired}
            confirm={tm.cancelTransfer}
            maxLength={CANCEL_REASON_MAX}
            onCancel={() => setCancelling(false)}
            onSubmit={(reason) => cancelTransfer(entry.row.id, reason)}
            onDone={onCancelled}
          />
        </BottomSheet>
      )}
    </article>
  )
}

function otherTitle(e: OtherEntry): string {
  if (e.kind === 'count') return e.row.object_name ?? ''
  if (e.kind === 'cash') return e.row.kind === 'qaytarildi' ? tm.cashReturned : tm.cashIssued
  const msg = e.row.message.trim()
  return msg.length > 80 ? `${msg.slice(0, 80)}…` : msg
}

function otherBadge(e: OtherEntry): ReactNode {
  if (e.kind === 'count') return countBadge(e.row)
  if (e.kind === 'bug') return <Badge tone={BUG_TONE[e.row.status]}>{t.bugReports.statuses[e.row.status]}</Badge>
  return null
}

function cashMeta(c: CashAdvance): string {
  return c.kind === 'qaytarildi' ? tm.cashFrom(c.recipient_name ?? '') : tm.cashTo(c.recipient_name ?? '')
}

/** Sanash, pul yoki xatolik xabari qatori. */
function OtherRow({ entry, onOpen }: { entry: OtherEntry; onOpen: () => void }) {
  const mark = typeMark(entry)
  const at = entry.kind === 'cash' ? entry.row.issued_at : entry.row.created_at
  return (
    <EntryRow
      as="li"
      kind={mark.kind}
      icon={mark.icon}
      title={otherTitle(entry)}
      badge={otherBadge(entry)}
      meta={
        <>
          <span>
            <span className="font-medium text-ink">{mark.label}</span>
            {entry.kind === 'count' && <span>{tm.countItems(entry.row.item_count)}</span>}
            {entry.kind === 'cash' && <span>{cashMeta(entry.row)}</span>}
          </span>
          <span className="tabular">{formatDateTime(at)}</span>
        </>
      }
      trailing={entry.kind === 'cash' ? <Money value={entry.row.amount} /> : undefined}
      onClick={onOpen}
    />
  )
}

function OtherDetail({ entry, onClose }: { entry: OtherEntry; onClose: () => void }) {
  const mark = typeMark(entry)
  return (
    <article className="flex flex-col gap-4" aria-label={tm.detail}>
      <BackLink label={t.common.back} onClick={onClose} />
      <DetailHeader mark={mark}>{otherBadge(entry)}</DetailHeader>
      {entry.kind === 'count' && (
        <>
          <DetailRows
            className={detailCard}
            items={[
              { label: tm.object, value: entry.row.object_name },
              { label: tm.countItemsLabel, value: <span className="tabular">{entry.row.item_count}</span> },
              { label: tm.time, value: <span className="tabular">{formatDateTime(entry.row.created_at)}</span> },
              entry.row.applied_at
                ? { label: tm.countApplied, value: <span className="tabular">{formatDateTime(entry.row.applied_at)}</span> }
                : null,
            ]}
          />
          {entry.row.status === 'draft' && (
            <Link
              to="/tg/inventory"
              className="inline-flex min-h-13 items-center justify-center rounded-xl bg-brand px-5 text-base font-semibold text-white"
            >
              {tm.countContinue}
            </Link>
          )}
        </>
      )}
      {entry.kind === 'cash' && (
        <>
          <div className="flex flex-col gap-1 rounded-xl border border-line bg-paper px-4 py-3">
            <Money value={entry.row.amount} size="hero" />
          </div>
          <DetailRows
            className={detailCard}
            items={[
              { label: entry.row.kind === 'qaytarildi' ? tm.cashFromLabel : tm.cashToLabel, value: entry.row.recipient_name },
              entry.row.created_by_name ? { label: tm.cashBy, value: entry.row.created_by_name } : null,
              { label: tm.time, value: <span className="tabular">{formatDateTime(entry.row.issued_at)}</span> },
              entry.row.note ? { label: t.movements.note, value: <span className="whitespace-pre-wrap">{entry.row.note}</span> } : null,
            ]}
          />
        </>
      )}
      {entry.kind === 'bug' && (
        <DetailRows
          className={detailCard}
          items={[
            { label: t.bugReport.message, value: <span className="whitespace-pre-wrap">{entry.row.message}</span> },
            entry.row.screen ? { label: t.bugReports.screen, value: entry.row.screen } : null,
            { label: tm.time, value: <span className="tabular">{formatDateTime(entry.row.created_at)}</span> },
          ]}
        />
      )}
    </article>
  )
}
