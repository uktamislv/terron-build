// "Ish xabarlari" (profiles.notify_workflow) — har bir foydalanuvchi o'z profilida yoqadi/o'chiradi
// (docs/audit-fixes.md D2). Veb: Yordam sahifasi; Telegram ilovasi: "Yozuvlarim".
import { useState } from 'react'
import { BellRing } from 'lucide-react'
import { useAuth } from '@/auth/authContext'
import { setMyNotifyWorkflow } from '@/data/profilesRepo'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { cx } from './ui'

const tn = t.settings.notify

/** Shu sessiyada saqlangan qiymatlar (sahifa almashsa ham to'g'ri ko'rinsin; profil qayta yuklanmaydi). */
const savedValues = new Map<string, boolean>()

export function NotifyWorkflowToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { profile } = useAuth()
  // Saqlangan qiymat shu yerda eslab qolinadi (profilni qayta yuklash butun ilovani kutdirardi)
  const [pending, setPending] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<boolean | null>(null)
  if (!profile) return null
  const enabled = pending ?? savedValues.get(profile.id) ?? profile.notify_workflow !== false

  const toggle = async () => {
    if (busy) return
    const next = !enabled
    setPending(next)
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      await setMyNotifyWorkflow(profile.id, next)
      savedValues.set(profile.id, next)
      setSaved(next)
    } catch (err) {
      setPending(null)
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label={tn.title} className={cx('flex flex-col gap-2 rounded-xl border border-line bg-paper p-4', className)}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-ice text-brand">
          <BellRing className="size-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-ink">{tn.title}</p>
          {!compact && <p className="text-sm text-muted">{tn.text}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={tn.toggle}
          disabled={busy}
          onClick={() => void toggle()}
          className="inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center disabled:opacity-60"
        >
          <span
            aria-hidden
            className={cx(
              'relative inline-flex h-7 w-12 items-center rounded-full border transition-colors',
              enabled ? 'border-brand bg-brand' : 'border-line-strong bg-canvas',
            )}
          >
            <span
              className={cx(
                'absolute size-5 rounded-full bg-paper shadow-sm transition-transform motion-reduce:transition-none',
                enabled ? 'translate-x-6' : 'translate-x-1',
              )}
            />
          </span>
        </button>
      </div>
      <p className="text-sm text-muted" aria-live="polite">
        {saved !== null ? tn.saved(saved) : enabled ? tn.on : tn.off}
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  )
}
