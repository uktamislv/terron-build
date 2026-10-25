import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '@/auth/authContext'
import { MovementPhoto } from '@/components/MovementPhoto'
import { REQUEST_TONE, TRANSFER_TONE } from '@/components/statusTones'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Camera, ClipboardList, Scale, ShoppingCart } from 'lucide-react'
import { Badge, EmptyState, EntryRow, type EntryKind, Money, PageHeader, Qty, sameQty, SkeletonRows } from '@/components/ui'
import { listMyMovements } from '@/data/movementsRepo'
import { listMyPurchases } from '@/data/purchasesRepo'
import { listMyRequests } from '@/data/requestsRepo'
import { listMyTransfers } from '@/data/transfersRepo'
import type { MaterialRequest, Movement, Purchase, Transfer } from '@/data/types'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDate, formatDateTime, formatQty, formatSum } from '@/lib/format'
import { haptic } from '../telegram'
import { BackLink, DetailList, LoadError } from '../ui'
import { useBackButton } from '../useTelegramButtons'

const tm = t.tg.mine
const MINE_LIMIT = 50

type Entry =
  | { kind: 'movement'; key: string; at: string; row: Movement }
  | { kind: 'purchase'; key: string; at: string; row: Purchase }
  | { kind: 'request'; key: string; at: string; row: MaterialRequest }
  | { kind: 'transfer'; key: string; at: string; row: Transfer }

type PlanEntry = Extract<Entry, { kind: 'request' | 'transfer' }>

function isPlan(e: Entry): e is PlanEntry {
  return e.kind === 'request' || e.kind === 'transfer'
}

function inputQty(m: Pick<Movement, 'qty_input' | 'unit_input' | 'unit_variant'>): string {
  return `${formatQty(m.qty_input)} ${unitLabel({ unit: m.unit_input, variant: m.unit_variant })}`
}

function baseQty(m: Pick<Movement, 'qty_base' | 'base_unit'>): string {
  return `${formatQty(m.qty_base)} ${m.base_unit ?? ''}`.trim()
}

const ic = 'size-[18px]'

/** Yozuv turi: chiziq rangi, belgi va nom (kirim — yashil, chiqim — ko'k, xarid — navy, o'tkazma — kulrang-ko'k). */
function typeMark(e: Entry): { kind: EntryKind; icon: ReactNode; label: string } {
  if (e.kind === 'request') return { kind: 'warn', icon: <ClipboardList className={ic} strokeWidth={1.75} />, label: tm.request }
  if (e.kind === 'transfer') return { kind: 'transfer', icon: <ArrowLeftRight className={ic} strokeWidth={1.75} />, label: tm.transfer }
  if (e.kind === 'purchase') return { kind: 'xarid', icon: <ShoppingCart className={ic} strokeWidth={1.75} />, label: tm.purchase }
  const m = e.row
  const label = t.movements.types[m.type]
  if (m.type === 'kirim' || m.type === 'transfer_in') return { kind: 'kirim', icon: <ArrowDownLeft className={ic} strokeWidth={2} />, label }
  if (m.type === 'chiqim' || m.type === 'transfer_out') return { kind: 'chiqim', icon: <ArrowUpRight className={ic} strokeWidth={2} />, label }
  return { kind: 'warn', icon: <Scale className={ic} strokeWidth={1.75} />, label }
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

/**
 * Kirim/chiqim, xaridlar, so'rovlar va o'tkazmalar aralash, kiritilgan vaqt bo'yicha (yangisi birinchi).
 * O'tkazmalar yuklangan bo'lsa, ularning `transfer_out` harakati alohida ko'rsatilmaydi (takror bo'lmasin).
 */
function mergeEntries(
  movements: Movement[],
  purchases: Purchase[],
  requests: MaterialRequest[] = [],
  transfers: Transfer[] | null = null,
): Entry[] {
  const shownMovements = transfers ? movements.filter((m) => m.type !== 'transfer_out') : movements
  const list: Entry[] = [
    ...shownMovements.map((row): Entry => ({ kind: 'movement', key: `m:${row.id}`, at: row.created_at, row })),
    ...purchases.map((row): Entry => ({ kind: 'purchase', key: `p:${row.id}`, at: row.created_at, row })),
    ...requests.map((row): Entry => ({ kind: 'request', key: `r:${row.id}`, at: row.created_at, row })),
    ...(transfers ?? []).map((row): Entry => ({ kind: 'transfer', key: `t:${row.id}`, at: row.created_at, row })),
  ]
  return list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, MINE_LIMIT)
}

export function MinePage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const profileId = profile?.id

  useEffect(() => {
    if (!profileId) return
    let alive = true
    Promise.all([
      listMyMovements(profileId, MINE_LIMIT),
      // Xaridlar — qo'shimcha: xato bo'lsa ham kirim/chiqimlar ko'rsatiladi
      listMyPurchases(profileId, MINE_LIMIT).catch(() => [] as Purchase[]),
      listMyRequests(profileId, MINE_LIMIT).catch(() => [] as MaterialRequest[]),
      listMyTransfers(profileId, MINE_LIMIT).catch(() => null),
    ])
      .then(([movements, purchases, requests, transfers]) => {
        if (!alive) return
        setRows(mergeEntries(movements, purchases, requests, transfers))
        setError(null)
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err))
      })
    return () => {
      alive = false
    }
  }, [profileId, reloadKey])

  const close = useCallback(() => setOpenKey(null), [])
  const open = rows?.find((r) => r.key === openKey) ?? null
  useBackButton(open ? close : null)

  if (!profile) return null

  if (open && isPlan(open)) return <PlanDetail entry={open} onClose={close} />

  if (open) {
    const mark = typeMark(open)
    const r = open.row
    return (
      <article className="flex flex-col gap-4" aria-label={tm.detail}>
        <BackLink label={t.common.back} onClick={close} />
        <DetailHeader mark={mark}>
          {r.deleted_at && <Badge tone="danger">{t.movements.deleted}</Badge>}
          {open.kind === 'purchase' && byOther(open.row, profile.id) && <Badge tone="info">{tm.enteredByOther}</Badge>}
        </DetailHeader>
        <div className="flex flex-col gap-1 rounded-xl border border-line bg-paper px-4 py-3">
          <span className="text-sm text-muted">{r.material_name}</span>
          {open.kind === 'purchase' ? (
            <Money value={open.row.total_amount} size="hero" />
          ) : (
            <Qty value={r.qty_input} unit={unitOf(r)} size="hero" />
          )}
        </div>
        <DetailList>
          <dt>{tm.material}</dt>
          <dd className="font-medium">{r.material_name}</dd>
          <dt>{tm.qty}</dt>
          <dd className="tabular font-medium">
            {inputQty(r)}
            {!sameAsBase(r) && <span className="text-muted"> (= {baseQty(r)})</span>}
          </dd>
          {open.kind === 'purchase' && (
            <>
              <dt>{tm.sum}</dt>
              <dd className="tabular font-semibold">{formatSum(open.row.total_amount)}</dd>
              <dt>{tm.unitPrice}</dt>
              <dd className="tabular">
                {formatSum(open.row.unit_price)} / {unitOf(open.row)}
              </dd>
              {open.row.supplier_name && (
                <>
                  <dt>{tm.supplier}</dt>
                  <dd>{open.row.supplier_name}</dd>
                </>
              )}
            </>
          )}
          <dt>{tm.object}</dt>
          <dd>{r.object_name}</dd>
          <dt>{tm.time}</dt>
          <dd className="tabular">{formatDateTime(open.kind === 'purchase' ? open.row.purchased_at : open.row.occurred_at)}</dd>
          {r.note && (
            <>
              <dt>{t.movements.note}</dt>
              <dd className="whitespace-pre-wrap">{r.note}</dd>
            </>
          )}
        </DetailList>
        {open.kind === 'purchase' ? (
          open.row.receipt_photo_path ? (
            <MovementPhoto path={open.row.receipt_photo_path} alt={tm.receipt} />
          ) : (
            <p className="text-sm text-muted">{tm.noReceipt}</p>
          )
        ) : open.row.photo_path ? (
          <MovementPhoto path={open.row.photo_path} alt={t.movements.photo} />
        ) : (
          <p className="text-sm text-muted">{t.movements.noPhoto}</p>
        )}
      </article>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={tm.title} />
      {error && <LoadError message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
      {!rows && !error && <SkeletonRows rows={4} />}
      {rows && rows.length === 0 && <EmptyState icon={<ClipboardList strokeWidth={1.5} />} title={tm.empty} />}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={tm.title}>
          {rows.map((e) => {
            const openRow = () => {
              haptic.tap()
              setOpenKey(e.key)
            }
            if (isPlan(e)) return <PlanRow key={e.key} entry={e} onOpen={openRow} />
            const mark = typeMark(e)
            const r = e.row
            const hasPhoto = e.kind === 'purchase' ? Boolean(e.row.receipt_photo_path) : Boolean(e.row.photo_path)
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
                  </>
                }
                meta={
                  <>
                    <span>
                      <span className="font-medium text-ink/80">{mark.label}</span>
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
    </div>
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
        <h1 className="text-xl font-semibold text-ink">{mark.label}</h1>
        {children}
      </div>
    </div>
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
            <span className="font-medium text-ink/80">{mark.label}</span>
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

/** So'rov / o'tkazma tafsiloti. */
function PlanDetail({ entry, onClose }: { entry: PlanEntry; onClose: () => void }) {
  const mark = typeMark(entry)
  const r = entry.row
  return (
    <article className="flex flex-col gap-4" aria-label={tm.detail}>
      <BackLink label={t.common.back} onClick={onClose} />
      <DetailHeader mark={mark}>{planStatus(entry)}</DetailHeader>
      <div className="flex flex-col gap-1 rounded-xl border border-line bg-paper px-4 py-3">
        <span className="text-sm text-muted">{r.material_name}</span>
        <Qty value={r.qty_input} unit={unitOf(r)} size="hero" />
      </div>
      <DetailList>
        <dt>{tm.material}</dt>
        <dd className="font-medium">{r.material_name}</dd>
        <dt>{tm.qty}</dt>
        <dd className="tabular font-medium">
          {inputQty(r)}
            {!sameAsBase(r) && <span className="text-muted"> (= {baseQty(r)})</span>}
        </dd>
        {entry.kind === 'request' ? (
          <>
            <dt>{tm.object}</dt>
            <dd>{entry.row.object_name}</dd>
            {entry.row.needed_by && (
              <>
                <dt>{tm.neededBy}</dt>
                <dd className="tabular">{formatDate(`${entry.row.needed_by}T12:00:00+05:00`)}</dd>
              </>
            )}
            {entry.row.decision_note && (
              <>
                <dt>{tm.decisionNote}</dt>
                <dd className="whitespace-pre-wrap">{entry.row.decision_note}</dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt>{tm.from}</dt>
            <dd>{entry.row.from_object_name ?? t.tg.incoming.otherObject}</dd>
            <dt>{tm.to}</dt>
            <dd>{entry.row.to_object_name ?? t.tg.incoming.otherObject}</dd>
            {entry.row.received_qty_base !== null && (
              <>
                <dt>{tm.received}</dt>
                <dd className="tabular">
                  {formatQty(entry.row.received_qty_base)} {entry.row.base_unit ?? ''}
                </dd>
              </>
            )}
            {entry.row.cancel_reason && (
              <>
                <dt>{tm.decisionNote}</dt>
                <dd className="whitespace-pre-wrap">{entry.row.cancel_reason}</dd>
              </>
            )}
          </>
        )}
        <dt>{tm.time}</dt>
        <dd className="tabular">{formatDateTime(r.created_at)}</dd>
        {r.note && (
          <>
            <dt>{t.movements.note}</dt>
            <dd className="whitespace-pre-wrap">{r.note}</dd>
          </>
        )}
      </DetailList>
    </article>
  )
}
