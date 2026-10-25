import { useState } from 'react'
import { LocateFixed } from 'lucide-react'
import { Notice } from '@/components/ui'
import { setObjectLocation } from '@/data/objectsRepo'
import type { ObjectRow } from '@/data/types'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { captureLocation } from '../location'
import { haptic } from '../telegram'

const ta = t.tg.auto
/** Ataylab bosilgan amal — oddiy 3 s dan uzoqroq kutiladi. */
const SET_TIMEOUT_MS = 10_000

/**
 * Batch 12 (D): admin Mini App'da turgan joyini obyekt koordinatasi qiladi (radius o'zgarmaydi).
 * Faqat admin uchun ko'rsatiladi (sahifa hal qiladi); RLS baribir tekshiradi.
 */
export function ObjectLocationButton({ object, onSaved }: { object: ObjectRow; onSaved?: (o: ObjectRow) => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const run = async () => {
    if (busy) return
    haptic.tap()
    setBusy(true)
    setResult(null)
    try {
      const fix = await captureLocation(SET_TIMEOUT_MS)
      if (fix.status !== 'ok' || !fix.lat || !fix.lng) {
        haptic.error()
        setResult({ ok: false, text: ta.objectLocationFailed })
        return
      }
      const saved = await setObjectLocation(object.id, fix.lat, fix.lng)
      haptic.success()
      setResult({ ok: true, text: ta.objectLocationSaved(fix.accuracyM !== undefined ? String(fix.accuracyM) : '') })
      onSaved?.(saved)
    } catch (err) {
      haptic.error()
      setResult({ ok: false, text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl border border-line bg-paper px-3 text-sm font-semibold text-brand hover:bg-ice disabled:opacity-60"
      >
        <LocateFixed aria-hidden className="size-4" strokeWidth={2} />
        {busy ? ta.settingLocation : ta.setObjectLocation}
      </button>
      {result && <Notice tone={result.ok ? 'ok' : 'warn'}>{result.text}</Notice>}
    </div>
  )
}
