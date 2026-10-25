import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, PackageOpen } from 'lucide-react'
import { Button, EntryRow, Notice, Qty, SkeletonRows } from '@/components/ui'
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
import { BackLink, DetailList, SavedBanner, SectionTitle } from '../ui'
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
      <p className="text-xl leading-tight font-semibold text-ink">{transfer.material_name}</p>
      <DetailList>
          <dt>{ti.from}</dt>
          <dd>{transfer.from_object_name ?? ti.otherObject}</dd>
          <dt>{ti.to}</dt>
          <dd>{transfer.to_object_name ?? '—'}</dd>
          <dt>{ti.sent}</dt>
          <dd data-testid="incoming-sent" className="tabular font-semibold">
            {formatQty(transfer.qty_input)} {unit}
            {transfer.base_unit && (
              <span className="font-normal text-muted">
                {' '}
                (= {formatQty(transfer.qty_base)} {transfer.base_unit})
              </span>
            )}
          </dd>
          {transfer.created_by_name && (
            <>
              <dt>{ti.sentBy}</dt>
              <dd>{transfer.created_by_name}</dd>
            </>
          )}
      </DetailList>
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
        size="lg"
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
        <Button size="lg" onClick={onMain} loading={saving}>
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
        className="flex min-h-13 items-center gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 text-left font-semibold text-warn"
      >
        <PackageOpen aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
        <span className="flex-1">{ti.banner(rows.length)}</span>
        <ChevronRight aria-hidden className="size-5 shrink-0" strokeWidth={2} />
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <BackLink label={selected ? t.common.back : ti.back} onClick={back} />
      <SectionTitle className="text-xl">{ti.title}</SectionTitle>
      {doneText && (
        <SavedBanner>{doneText}</SavedBanner>
      )}
      {selected ? (
        <ReceiveForm key={selected.id} transfer={selected} onDone={onDone} />
      ) : (
        <>
          {error && <Notice>{error}</Notice>}
          {!rows && !error && <SkeletonRows rows={2} />}
          {rows && rows.length === 0 && <p className="text-sm text-muted">{ti.empty}</p>}
          {rows && rows.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label={ti.title}>
              {rows.map((r) => (
                <li key={r.id}>
                  <EntryRow
                    kind="transfer"
                    title={r.material_name ?? ''}
                    meta={
                      <>
                        <span>
                          {r.from_object_name ?? ti.otherObject} → {r.to_object_name ?? '—'}
                        </span>
                        <span className="tabular">{formatDateTime(r.created_at)}</span>
                      </>
                    }
                    trailing={<Qty value={r.qty_input} unit={transferUnit(r)} size="lg" />}
                    onClick={() => {
                      haptic.tap()
                      setDoneText(null)
                      setSelectedId(r.id)
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
