import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { MovementPhoto } from '@/components/MovementPhoto'
import { StatusBadge } from '@/components/StatusBadge'
import { REQUEST_TONE, TRANSFER_TONE } from '@/components/statusTones'
import { Notice, Spinner } from '@/components/ui'
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

/** Kirim — yashil "+", chiqim — "−", xarid — "🛒", boshqalari — "±". */
function typeMark(e: Entry): { sign: string; tone: string; label: string } {
  if (e.kind === 'request') return { sign: '📝', tone: 'bg-warn/10 text-warn', label: tm.request }
  if (e.kind === 'transfer') return { sign: '⇄', tone: 'bg-brand-light text-brand', label: tm.transfer }
  if (e.kind === 'purchase') return { sign: '🛒', tone: 'bg-brand-light text-brand-dark', label: tm.purchase }
  const m = e.row
  const label = t.movements.types[m.type]
  if (m.type === 'kirim' || m.type === 'transfer_in') return { sign: '+', tone: 'bg-ok/10 text-ok', label }
  if (m.type === 'chiqim' || m.type === 'transfer_out') return { sign: '−', tone: 'bg-brand-light text-brand', label }
  return { sign: '±', tone: 'bg-warn/10 text-warn', label }
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
        <button type="button" onClick={close} className="min-h-11 self-start text-sm font-medium text-brand">
          ← {t.common.back}
        </button>
        <div className="flex items-center gap-3">
          <span className={`inline-flex size-11 items-center justify-center rounded-full text-xl font-bold ${mark.tone}`}>
            {mark.sign}
          </span>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{mark.label}</h1>
            {r.deleted_at && <StatusBadge tone="danger">{t.movements.deleted}</StatusBadge>}
            {open.kind === 'purchase' && byOther(open.row, profile.id) && (
              <StatusBadge tone="info">{tm.enteredByOther}</StatusBadge>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">{tm.material}</dt>
          <dd className="font-medium text-slate-900">{r.material_name}</dd>
          <dt className="text-slate-500">{tm.qty}</dt>
          <dd className="font-medium text-slate-900">
            {inputQty(r)} <span className="text-slate-500">(= {baseQty(r)})</span>
          </dd>
          {open.kind === 'purchase' && (
            <>
              <dt className="text-slate-500">{tm.sum}</dt>
              <dd className="font-semibold text-slate-900">{formatSum(open.row.total_amount)}</dd>
              <dt className="text-slate-500">{tm.unitPrice}</dt>
              <dd className="text-slate-900">
                {formatSum(open.row.unit_price)} / {unitLabel({ unit: open.row.unit_input, variant: open.row.unit_variant })}
              </dd>
              {open.row.supplier_name && (
                <>
                  <dt className="text-slate-500">{tm.supplier}</dt>
                  <dd className="text-slate-900">{open.row.supplier_name}</dd>
                </>
              )}
            </>
          )}
          <dt className="text-slate-500">{tm.object}</dt>
          <dd className="text-slate-900">{r.object_name}</dd>
          <dt className="text-slate-500">{tm.time}</dt>
          <dd className="text-slate-900">
            {formatDateTime(open.kind === 'purchase' ? open.row.purchased_at : open.row.occurred_at)}
          </dd>
          {r.note && (
            <>
              <dt className="text-slate-500">{t.movements.note}</dt>
              <dd className="whitespace-pre-wrap text-slate-900">{r.note}</dd>
            </>
          )}
        </dl>
        {open.kind === 'purchase' ? (
          open.row.receipt_photo_path ? (
            <MovementPhoto path={open.row.receipt_photo_path} alt={tm.receipt} />
          ) : (
            <p className="text-sm text-slate-500">{tm.noReceipt}</p>
          )
        ) : open.row.photo_path ? (
          <MovementPhoto path={open.row.photo_path} alt={t.movements.photo} />
        ) : (
          <p className="text-sm text-slate-500">{t.movements.noPhoto}</p>
        )}
      </article>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-brand-dark">{tm.title}</h1>
      {error && (
        <Notice>
          {error}{' '}
          <button
            type="button"
            className="ml-1 inline-flex min-h-11 items-center px-1 font-semibold underline"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            {t.common.retry}
          </button>
        </Notice>
      )}
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && <p className="text-slate-600">{tm.empty}</p>}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={tm.title}>
          {rows.map((e) => {
            if (isPlan(e)) {
              return (
                <li key={e.key}>
                  <PlanRow
                    entry={e}
                    onOpen={() => {
                      haptic.tap()
                      setOpenKey(e.key)
                    }}
                  />
                </li>
              )
            }
            const mark = typeMark(e)
            const r = e.row
            const hasPhoto = e.kind === 'purchase' ? Boolean(e.row.receipt_photo_path) : Boolean(e.row.photo_path)
            return (
              <li key={e.key}>
                <button
                  type="button"
                  onClick={() => {
                    haptic.tap()
                    setOpenKey(e.key)
                  }}
                  className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border border-slate-200 p-3 text-left ${
                    r.deleted_at ? 'opacity-60' : ''
                  }`}
                >
                  <span
                    aria-label={mark.label}
                    className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-bold ${mark.tone}`}
                  >
                    {mark.sign}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-900">{r.material_name}</span>
                    <span className="block text-sm text-slate-700">
                      {inputQty(r)}{' '}
                      <span className="text-slate-500">
                        · {e.kind === 'purchase' ? formatSum(e.row.total_amount) : baseQty(r)}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {r.object_name} · {formatDateTime(e.kind === 'purchase' ? e.row.purchased_at : e.row.occurred_at)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {hasPhoto && <span aria-label={t.movements.hasPhoto}>📷</span>}
                    {r.deleted_at && <StatusBadge tone="danger">{t.movements.deleted}</StatusBadge>}
                    {e.kind === 'purchase' && byOther(e.row, profile.id) && (
                      <StatusBadge tone="info">{tm.enteredByOther}</StatusBadge>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function planStatus(e: PlanEntry) {
  return e.kind === 'request' ? (
    <StatusBadge tone={REQUEST_TONE[e.row.status]}>{t.requests.statuses[e.row.status]}</StatusBadge>
  ) : (
    <StatusBadge tone={TRANSFER_TONE[e.row.status]}>{t.transfers.statuses[e.row.status]}</StatusBadge>
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
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-slate-200 p-3 text-left"
    >
      <span
        aria-label={mark.label}
        className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-bold ${mark.tone}`}
      >
        {mark.sign}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-slate-900">{r.material_name}</span>
        <span className="block text-sm text-slate-700">{inputQty(r)}</span>
        <span className="block truncate text-xs text-slate-500">
          {planPlace(entry)} · {formatDateTime(r.created_at)}
        </span>
      </span>
      <span className="shrink-0">{planStatus(entry)}</span>
    </button>
  )
}

/** So'rov / o'tkazma tafsiloti. */
function PlanDetail({ entry, onClose }: { entry: PlanEntry; onClose: () => void }) {
  const mark = typeMark(entry)
  const r = entry.row
  return (
    <article className="flex flex-col gap-4" aria-label={tm.detail}>
      <button type="button" onClick={onClose} className="min-h-11 self-start text-sm font-medium text-brand">
        ← {t.common.back}
      </button>
      <div className="flex items-center gap-3">
        <span className={`inline-flex size-11 items-center justify-center rounded-full text-xl font-bold ${mark.tone}`}>
          {mark.sign}
        </span>
        <div className="flex flex-col items-start gap-1">
          <h1 className="text-lg font-semibold text-slate-900">{mark.label}</h1>
          {planStatus(entry)}
        </div>
      </div>
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-slate-500">{tm.material}</dt>
        <dd className="font-medium text-slate-900">{r.material_name}</dd>
        <dt className="text-slate-500">{tm.qty}</dt>
        <dd className="font-medium text-slate-900">
          {inputQty(r)} <span className="text-slate-500">(= {baseQty(r)})</span>
        </dd>
        {entry.kind === 'request' ? (
          <>
            <dt className="text-slate-500">{tm.object}</dt>
            <dd className="text-slate-900">{entry.row.object_name}</dd>
            {entry.row.needed_by && (
              <>
                <dt className="text-slate-500">{tm.neededBy}</dt>
                <dd className="text-slate-900">{formatDate(`${entry.row.needed_by}T12:00:00+05:00`)}</dd>
              </>
            )}
            {entry.row.decision_note && (
              <>
                <dt className="text-slate-500">{tm.decisionNote}</dt>
                <dd className="whitespace-pre-wrap text-slate-900">{entry.row.decision_note}</dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt className="text-slate-500">{tm.from}</dt>
            <dd className="text-slate-900">{entry.row.from_object_name ?? t.tg.incoming.otherObject}</dd>
            <dt className="text-slate-500">{tm.to}</dt>
            <dd className="text-slate-900">{entry.row.to_object_name ?? t.tg.incoming.otherObject}</dd>
            {entry.row.received_qty_base !== null && (
              <>
                <dt className="text-slate-500">{tm.received}</dt>
                <dd className="text-slate-900">
                  {formatQty(entry.row.received_qty_base)} {entry.row.base_unit ?? ''}
                </dd>
              </>
            )}
            {entry.row.cancel_reason && (
              <>
                <dt className="text-slate-500">{tm.decisionNote}</dt>
                <dd className="whitespace-pre-wrap text-slate-900">{entry.row.cancel_reason}</dd>
              </>
            )}
          </>
        )}
        <dt className="text-slate-500">{tm.time}</dt>
        <dd className="text-slate-900">{formatDateTime(r.created_at)}</dd>
        {r.note && (
          <>
            <dt className="text-slate-500">{t.movements.note}</dt>
            <dd className="whitespace-pre-wrap text-slate-900">{r.note}</dd>
          </>
        )}
      </dl>
    </article>
  )
}
