// "Excel" tugmasi: eksport jarayonida spinner va "Bekor qilish"; xato — qisqa xabar.
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { isAbortError } from '@/data/fetchAll'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { RepoError } from '@/data/errors'

export function ExportButton({
  run,
  disabled,
  label = t.excel.button,
}: {
  /** Ma'lumotni yuklab, faylni yaratadi. `signal` bekor qilinsa — to'xtashi kerak. */
  run: (signal: AbortSignal) => Promise<void>
  disabled?: boolean
  label?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  // Sahifadan chiqilsa — yuklash to'xtaydi
  useEffect(() => () => controller.current?.abort(), [])

  const start = async () => {
    const ctrl = new AbortController()
    controller.current = ctrl
    setBusy(true)
    setError(null)
    try {
      await run(ctrl.signal)
    } catch (err) {
      if (!ctrl.signal.aborted && !isAbortError(err)) {
        setError(err instanceof RepoError ? errorText(err) : t.excel.failed)
      }
    } finally {
      if (controller.current === ctrl) {
        controller.current = null
        setBusy(false)
      }
    }
  }

  const cancel = () => {
    controller.current?.abort()
    controller.current = null
    setBusy(false)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {busy ? (
        <div className="flex items-center gap-2" role="status">
          <span className="size-5 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden />
          <span className="text-sm text-slate-600">{t.excel.exporting}</span>
          <Button variant="secondary" onClick={cancel}>
            {t.excel.cancel}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" disabled={disabled} onClick={() => void start()}>
          <svg viewBox="0 0 24 24" className="size-5 text-ok" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
          {label}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-right text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
