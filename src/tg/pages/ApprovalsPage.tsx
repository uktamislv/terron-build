// Telegram ilovasi: admin uchun so'rovlarni tasdiqlash / rad etish (bosh ekrandan). Izoh (decision_note) —
// tasdiqlashda ixtiyoriy, rad etishda majburiy.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Check, ClipboardList, X } from 'lucide-react'
import { BottomSheet, Button, DetailRows, EmptyState, EntryRow, LevelBar, Notice, Qty, RetryNotice, SkeletonRows, TextAreaField } from '@/components/ui'
import { listNormUsage } from '@/data/normsRepo'
import { getStock } from '@/data/stockRepo'
import { approveRequest, DECISION_NOTE_MAX, listRequests, rejectRequest } from '@/data/requestsRepo'
import type { MaterialRequest, NormUsage } from '@/data/types'
import { sub } from '@/domain/decimal'
import { usagePct } from '@/domain/norms'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDate, formatDateTime, formatQtyUnit } from '@/lib/format'
import { useLoad } from '@/lib/useLoad'
import { requestNormState } from '@/lib/requestNorm'
import { readUuidParam } from '../deepLinks'
import { haptic } from '../telegram'
import { useBackButton } from '../useTelegramButtons'

const tap = t.tg.approvals

export function ApprovalsPage() {
  const navigate = useNavigate()
  const back = useCallback(() => navigate('/tg'), [navigate])
  // Telegram xabaridagi havola: ?request=<id> — kutilayotgan bo'lsa varaq ochiladi, aks holda jim
  const [params, setParams] = useSearchParams()
  const linked = readUuidParam(params, 'request')
  const [openId, setOpenId] = useState<string | null>(linked)
  const [done, setDone] = useState<string | null>(null)
  const closeSheet = useCallback(() => setOpenId(null), [])
  const pending = useLoad(() => listRequests({ statuses: ['kutilmoqda'] }).then((r) => r.rows), 'approvals')
  const open = pending.data?.find((r) => r.id === openId) ?? null
  useBackButton(open ? closeSheet : back)
  // Parametr bir marta ishlatiladi — URL tozalanadi
  useEffect(() => {
    if (!linked) return
    const next = new URLSearchParams(params)
    next.delete('request')
    setParams(next, { replace: true })
  }, [linked, params, setParams])

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{tap.intro}</p>
      {done && <Notice tone="ok">{done}</Notice>}
      {pending.error && <RetryNotice message={pending.error} onRetry={pending.reload} />}
      {pending.loading && <SkeletonRows rows={3} />}
      {pending.data && pending.data.length === 0 && <EmptyState icon={<ClipboardList strokeWidth={1.5} />} title={tap.empty} />}
      {pending.data && pending.data.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={tap.title}>
          {pending.data.map((r) => (
            <EntryRow
              key={r.id}
              as="li"
              testId="approval-row"
              // So'rov — reja, muammo emas: neytral chiziq; ro'yxatda faqat kutilayotganlar (holat belgisi ortiqcha)
              kind="neutral"
              icon={<ClipboardList className="size-5" strokeWidth={1.75} />}
              title={r.material_name ?? ''}
              meta={
                <>
                  <span>{r.object_name}</span>
                  {r.created_by_name && <span>{r.created_by_name}</span>}
                  <span className="tabular">{formatDateTime(r.created_at)}</span>
                </>
              }
              trailing={<Qty value={r.qty_input} unit={unitLabel({ unit: r.unit_input, variant: r.unit_variant })} />}
              onClick={() => {
                haptic.tap()
                setDone(null)
                setOpenId(r.id)
              }}
            />
          ))}
        </ul>
      )}
      {open && (
        <BottomSheet title={tap.decideTitle} onClose={() => setOpenId(null)}>
          <DecisionForm
            request={open}
            onDone={(text) => {
              haptic.success()
              setDone(text)
              setOpenId(null)
              pending.reload()
            }}
          />
        </BottomSheet>
      )}
    </div>
  )
}

function DecisionForm({ request: r, onDone }: { request: MaterialRequest; onDone: (text: string) => void }) {
  const [note, setNote] = useState('')
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decide = async (kind: 'approve' | 'reject') => {
    if (busy) return
    if (kind === 'reject' && !note.trim()) {
      setMissing(true)
      haptic.error()
      return
    }
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'approve') await approveRequest(r.id, note)
      else await rejectRequest(r.id, note)
      onDone(kind === 'approve' ? tap.approved(r.material_name ?? '') : tap.rejected(r.material_name ?? ''))
    } catch (err) {
      haptic.error()
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DetailRows
        className="rounded-xl border border-line bg-paper px-4"
        items={[
          { label: t.tg.mine.material, value: r.material_name },
          {
            label: t.tg.mine.qty,
            value: (
              <span className="tabular inline-flex flex-col items-end">
                <span>{formatQtyUnit(r.qty_input, unitLabel({ unit: r.unit_input, variant: r.unit_variant }))}</span>
                {r.base_unit && r.unit_input !== r.base_unit && (
                  <span className="text-xs font-normal text-muted">= {formatQtyUnit(r.qty_base, r.base_unit)}</span>
                )}
              </span>
            ),
          },
          { label: t.tg.mine.object, value: r.object_name },
          r.created_by_name ? { label: tap.author, value: r.created_by_name } : null,
          r.needed_by
            ? { label: t.tg.mine.neededBy, value: <span className="tabular">{formatDate(`${r.needed_by}T12:00:00+05:00`)}</span> }
            : null,
          r.note ? { label: t.movements.note, value: <span className="whitespace-pre-wrap">{r.note}</span> } : null,
        ]}
      />
      <RequestContext request={r} />
      <TextAreaField
        label={tap.note}
        rows={2}
        maxLength={DECISION_NOTE_MAX}
        value={note}
        hint={tap.noteHint}
        error={missing ? t.requestsPage.rejectReasonRequired : null}
        onChange={(e) => {
          setNote(e.target.value)
          setMissing(false)
        }}
      />
      {error && <Notice>{error}</Notice>}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="danger"
          size="lg"
          loading={busy === 'reject'}
          disabled={busy !== null}
          icon={<X aria-hidden className="size-5" strokeWidth={2} />}
          onClick={() => void decide('reject')}
        >
          {t.requestsPage.reject}
        </Button>
        <Button
          size="lg"
          loading={busy === 'approve'}
          disabled={busy !== null}
          icon={<Check aria-hidden className="size-5" strokeWidth={2} />}
          onClick={() => void decide('approve')}
        >
          {t.requestsPage.approve}
        </Button>
      </div>
    </div>
  )
}

/** Qaror uchun kontekst: smeta normasi, sarflangan, smetada qolgan (oshsa — ogohlantirish) va obyektdagi qoldiq. */
function RequestContext({ request: r }: { request: MaterialRequest }) {
  const ctx = useLoad(
    async (): Promise<{ norms: NormUsage[]; stock: string | null }> => {
      const [norms, stock] = await Promise.all([listNormUsage({ objectId: r.object_id }), getStock(r.object_id, r.material_id).catch(() => null)])
      return { norms, stock }
    },
    `${r.object_id}:${r.material_id}`,
  )
  const unit = r.base_unit ?? ''
  if (ctx.loading) return <SkeletonRows rows={1} />
  if (ctx.error || !ctx.data) return <p className="text-sm text-muted">{tap.contextError}</p>
  const norm = ctx.data.norms.find((n) => n.material_id === r.material_id)
  // `requested_open_qty_base` shu so'rovni ham o'z ichiga oladi — boshqalari ajratiladi (veb bilan bir xil)
  const other = norm ? sub(norm.requested_open_qty_base, r.qty_base) : undefined
  const state = requestNormState(ctx.data.norms, r.material_id, r.qty_base, other)
  const stock = ctx.data.stock
  return (
    <section aria-label={tap.context} className="flex flex-col gap-2">
      {state.kind === 'over' && (
        <Notice tone="warn">
          <span data-testid="approval-overrun">{tap.overrun(formatQtyUnit(state.overQty, unit))}</span>
        </Notice>
      )}
      <DetailRows
        className="rounded-xl border border-line bg-paper px-4"
        items={[
          state.kind === 'no_estimate'
            ? { label: t.requestsPage.colEstimate, value: t.requestsPage.noEstimate }
            : state.kind === 'not_in_estimate' || !norm
              ? { label: t.requestsPage.colEstimate, value: t.requestsPage.notInEstimate }
              : null,
          norm && state.kind !== 'not_in_estimate' && state.kind !== 'no_estimate'
            ? { label: tap.normAllowed, value: <span className="tabular">{formatQtyUnit(norm.allowed_qty_base, unit)}</span> }
            : null,
          norm && state.kind !== 'not_in_estimate' && state.kind !== 'no_estimate'
            ? { label: tap.consumed, value: <span className="tabular">{formatQtyUnit(norm.consumed_qty_base, unit)}</span> }
            : null,
          state.kind === 'ok' || state.kind === 'over'
            ? {
                label: t.requestsPage.colEstimate,
                value: (
                  <span data-testid="approval-remaining" className={state.kind === 'over' ? 'tabular font-semibold text-warn' : 'tabular'}>
                    {tap.remaining(formatQtyUnit(state.available, unit))}
                  </span>
                ),
              }
            : null,
          stock !== null ? { label: tap.stock, value: <span className="tabular">{formatQtyUnit(stock, unit)}</span> } : null,
        ]}
      />
      {norm && state.kind !== 'not_in_estimate' && state.kind !== 'no_estimate' && (
        <LevelBar label={tap.consumed} value={Number(usagePct(norm.consumed_qty_base, norm.allowed_qty_base) ?? 0)} max={100} />
      )}
    </section>
  )
}
