// "Excel" tugmasi: o'zgarmas kenglik (jarayonda sakramaydi), spinner tugma ichida, yonida "Bekor qilish"
// belgisi (X); xato — Toast orqali.
import { useEffect, useRef, useState } from 'react'
import { FileSpreadsheet, LoaderCircle, X } from 'lucide-react'
import { Button, IconButton, useToast } from '@/components/ui'
import { isAbortError } from '@/data/fetchAll'
import { RepoError } from '@/data/errors'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'

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
  const controller = useRef<AbortController | null>(null)
  const toast = useToast()

  // Sahifadan chiqilsa — yuklash to'xtaydi
  useEffect(() => () => controller.current?.abort(), [])

  const start = async () => {
    const ctrl = new AbortController()
    controller.current = ctrl
    setBusy(true)
    try {
      await run(ctrl.signal)
    } catch (err) {
      if (!ctrl.signal.aborted && !isAbortError(err)) {
        toast.show(err instanceof RepoError ? errorText(err) : t.excel.failed, 'danger')
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
    <div className="inline-flex items-center gap-1">
      <Button
        variant="secondary"
        className="w-32 justify-center"
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        onClick={() => void start()}
        icon={
          busy ? (
            <LoaderCircle aria-hidden className="size-5 animate-spin text-brand" strokeWidth={1.75} />
          ) : (
            <FileSpreadsheet aria-hidden className="size-5 text-ok" strokeWidth={1.75} />
          )
        }
      >
        {label}
      </Button>
      {busy && (
        <>
          <span role="status" className="sr-only">
            {t.excel.exporting}
          </span>
          <IconButton label={t.excel.cancel} variant="secondary" icon={<X className="size-5" strokeWidth={1.75} />} onClick={cancel} />
        </>
      )}
    </div>
  )
}
