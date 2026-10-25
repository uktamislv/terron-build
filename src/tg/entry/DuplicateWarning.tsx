import { CopyX } from 'lucide-react'
import { Button } from '@/components/ui'
import { t } from '@/i18n'

const ta = t.tg.auto

/** Batch 12 (C): saqlashdan oldin takroriy yozuv ogohlantirishi — bloklamaydi. */
export function DuplicateWarning({
  minutes,
  busy,
  onConfirm,
  onCancel,
}: {
  minutes: number
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div role="alert" data-testid="duplicate-warning" className="flex flex-col gap-3 rounded-xl border border-warn/25 bg-warn-bg p-3">
      <p className="flex items-start gap-2 text-sm text-warn">
        <CopyX aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
        <span>
          <span className="block font-semibold">{ta.duplicateTitle}</span>
          {ta.duplicateText(minutes)}
        </span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {ta.duplicateCancel}
        </Button>
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          {ta.duplicateSave}
        </Button>
      </div>
    </div>
  )
}
