// "Excel" tugmasi: eksport jarayonida spinner va "Bekor qilish"; xato — qisqa xabar.
import { useEffect, useRef, useState } from 'react'
import { FileSpreadsheet, LoaderCircle } from 'lucide-react'
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
          <LoaderCircle aria-hidden className="size-5 animate-spin text-brand" strokeWidth={1.75} />
          <span className="text-sm text-muted">{t.excel.exporting}</span>
          <Button variant="secondary" onClick={cancel}>
            {t.excel.cancel}
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => void start()}
          icon={<FileSpreadsheet aria-hidden className="size-5 text-ok" strokeWidth={1.75} />}
        >
          {label}
        </Button>
      )}
      {error && (
        <p role="alert" className="max-w-xs text-right text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
