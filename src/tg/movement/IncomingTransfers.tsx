import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Notice, Spinner } from '@/components/ui'
import { listIncomingTransfers, receiveTransfer } from '@/data/transfersRepo'
import type { Transfer } from '@/data/types'
import { cmp } from '@/domain/decimal'
import type { DraftErrorCode } from '@/domain/movements'
import { unitLabel, validateQtyInput } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDateTime, formatQty } from '@/lib/format'
import { NoteField, QtyField } from '../entry/QtyField'
import { getWebApp, haptic } from '../telegram'
import { useBackButton, useMainButton } from '../useTelegramButtons'

const ti = t.tg.incoming

/** Qabul miqdori: 0 ham to'g'ri (hech narsa kelmadi — baza alert yaratadi). */
function parseReceived(input: string): { ok: true; value: string } | { ok: false; reason: DraftErrorCode } {
  const p = validateQtyInput(input)
  if (p.ok) return p
  if (p.reason === 'zero') return { ok: true, value: '0' }
  return { ok: false, reason: p.reason === 'empty' ? 'required' : p.reason }
}

function transferUnit(tr: Pick<Transfer, 'unit_input' | 'unit_variant'>): string {
  return unitLabel({ unit: tr.unit_input, variant: tr.unit_variant })
}

/** Qabul qilish: miqdor standart — yuborilgan (o'tkazma birligida), o'zgartirish mumkin. */
function ReceiveForm({ transfer, onDone }: { transfer: Transfer; onDone: (text: string) => void }) {
  // Bo'sh boshlanadi — omborchi haqiqatda sanab kiritsin; "Hammasi keldi" — bir bosishda yuborilgan miqdor
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [qtyError, setQtyError] = useState<DraftErrorCode | undefined>()
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = parseReceived(qty)
  const differs = parsed.ok && cmp(parsed.value, transfer.qty_input) !== 0
  const unit = transferUnit(transfer)

  const receive = useCallback(async () => {
    if (savingRef.current) return
    const p = parseReceived(qty)
    if (!p.ok) {
      setQtyError(p.reason)
      haptic.error()
      return
    }
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const same = cmp(p.value, transfer.qty_input) === 0
      await receiveTransfer(transfer.id, same ? null : p.value, note)
      haptic.success()
      onDone(ti.received(formatQty(p.value), unit, transfer.material_name ?? ''))
    } catch (err) {
      haptic.error()
      setError(errorText(err))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [qty, note, transfer, unit, onDone])

  const onMain = useCallback(() => void receive(), [receive])
  useMainButton(ti.receive, onMain, false, saving)
  const insideTelegram = getWebApp() !== null

  return (
    <section aria-label={transfer.material_name ?? ti.title} className="flex flex-col gap-4">
      <div className="rounded-2xl border border-slate-200 p-4">
        <p className="text-lg font-semibold text-slate-900">{transfer.material_name}</p>
        <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-500">{ti.from}</dt>
          <dd className="text-slate-900">{transfer.from_object_name ?? ti.otherObject}</dd>
          <dt className="text-slate-500">{ti.to}</dt>
          <dd className="text-slate-900">{transfer.to_object_name ?? '—'}</dd>
          <dt className="text-slate-500">{ti.sent}</dt>
          <dd data-testid="incoming-sent" className="font-semibold text-slate-900">
            {formatQty(transfer.qty_input)} {unit}
            {transfer.base_unit && (
              <span className="font-normal text-slate-500">
                {' '}
                (= {formatQty(transfer.qty_base)} {transfer.base_unit})
              </span>
            )}
          </dd>
          {transfer.created_by_name && (
            <>
              <dt className="text-slate-500">{ti.sentBy}</dt>
              <dd className="text-slate-900">{transfer.created_by_name}</dd>
            </>
          )}
        </dl>
      </div>
      <QtyField
        label={`${ti.receivedQty}, ${unit}`}
        value={qty}
        error={qtyError}
        onChange={(v) => {
          setQty(v)
          setQtyError(undefined)
        }}
      />
      <Button
        variant="secondary"
        className="min-h-12 text-base"
        onClick={() => {
          haptic.select()
          setQty(formatQty(transfer.qty_input).replace(/\s/g, ''))
          setQtyError(undefined)
        }}
      >
        {ti.allArrived(`${formatQty(transfer.qty_input)} ${unit}`)}
      </Button>
      {differs && <Notice tone="warn">{ti.diffWarn}</Notice>}
      <NoteField label={t.tg.movement.note} value={note} onChange={setNote} />
      {error && <Notice>{error}</Notice>}
      {!insideTelegram && (
        <Button className="min-h-12 text-base" onClick={onMain} disabled={saving}>
          {saving ? t.common.saving : ti.receive}
        </Button>
      )}
    </section>
  )
}

/**
 * Kirim/chiqim ekrani tepasidagi "Kelayotgan o'tkazmalar (N)" banneri va qabul qilish oqimi.
 * `objectIds` — foydalanuvchi qabul qila oladigan obyektlar. Ochiq bo'lsa sahifa formani yashiradi.
 */
export function IncomingTransfers({
  objectIds,
  open,
  onOpenChange,
}: {
  objectIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [rows, setRows] = useState<Transfer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [doneText, setDoneText] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const idsKey = objectIds.join(',')

  useEffect(() => {
    if (!idsKey) return
    let alive = true
    listIncomingTransfers(idsKey.split(','))
      .then((list) => {
        if (!alive) return
        setRows(list)
        setError(null)
      })
      .catch((err: unknown) => {
        // Banner qo'shimcha — xato bo'lsa forma baribir ishlaydi
        if (alive) setError(errorText(err))
      })
    return () => {
      alive = false
    }
  }, [idsKey, reloadKey])

  const selected = rows?.find((r) => r.id === selectedId) ?? null
  const back = useCallback(() => {
    if (selectedId) setSelectedId(null)
    else onOpenChange(false)
  }, [selectedId, onOpenChange])
  useBackButton(open ? back : null)

  const onDone = useCallback((text: string) => {
    setDoneText(text)
    setSelectedId(null)
    setReloadKey((k) => k + 1)
  }, [])

  if (!open) {
    if (!rows || rows.length === 0) return null
    return (
      <button
        type="button"
        onClick={() => {
          haptic.tap()
          setDoneText(null)
          onOpenChange(true)
        }}
        className="flex min-h-12 items-center justify-between gap-2 rounded-2xl border border-warn/30 bg-warn/5 px-4 text-left font-semibold text-warn"
      >
        <span>📦 {ti.banner(rows.length)}</span>
        <span aria-hidden>›</span>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-brand-dark">{ti.title}</h2>
        <button type="button" onClick={back} className="min-h-11 px-2 text-sm font-medium text-brand">
          ← {selected ? t.common.back : ti.back}
        </button>
      </div>
      {doneText && (
        <div role="status" className="rounded-2xl border border-ok/30 bg-ok/5 p-4 font-semibold text-ok">
          ✓ {doneText}
        </div>
      )}
      {selected ? (
        <ReceiveForm key={selected.id} transfer={selected} onDone={onDone} />
      ) : (
        <>
          {error && <Notice>{error}</Notice>}
          {!rows && !error && <Spinner />}
          {rows && rows.length === 0 && <p className="text-slate-600">{ti.empty}</p>}
          {rows && rows.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label={ti.title}>
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      haptic.tap()
                      setDoneText(null)
                      setSelectedId(r.id)
                    }}
                    className="flex min-h-16 w-full flex-col items-start rounded-2xl border border-slate-200 p-3 text-left"
                  >
                    <span className="font-semibold text-slate-900">
                      {r.material_name} · {formatQty(r.qty_input)} {transferUnit(r)}
                    </span>
                    <span className="text-sm text-slate-600">
                      {r.from_object_name ?? ti.otherObject} → {r.to_object_name ?? '—'}
                    </span>
                    <span className="text-xs text-slate-500">{formatDateTime(r.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
