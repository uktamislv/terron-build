// Sabab majburiy bo'lgan tasdiq formasi ("Yozuvlar": o'tkazmani yoki o'z yozuvini bekor qilish).
import { useState } from 'react'
import { Button, Notice, TextAreaField } from '@/components/ui'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { haptic } from '../telegram'

/** Sabab majburiy bo'lgan tasdiq formasi (o'tkazmani yoki o'z yozuvini bekor qilish). */
export function ReasonForm({
  text,
  label,
  requiredText,
  confirm,
  maxLength,
  onCancel,
  onSubmit,
  onDone,
}: {
  text: string
  label: string
  requiredText: string
  confirm: string
  maxLength: number
  onCancel: () => void
  onSubmit: (reason: string) => Promise<void>
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (busy) return
    if (!reason.trim()) {
      setMissing(true)
      haptic.error()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(reason)
      onDone()
    } catch (err) {
      haptic.error()
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{text}</p>
      <TextAreaField
        label={label}
        required
        aria-required="true"
        rows={2}
        maxLength={maxLength}
        value={reason}
        error={missing ? requiredText : null}
        onChange={(e) => {
          setReason(e.target.value)
          setMissing(false)
        }}
      />
      {error && <Notice>{error}</Notice>}
      <div className="flex flex-col-reverse gap-2">
        <Button variant="secondary" size="lg" onClick={onCancel}>
          {t.common.back}
        </Button>
        <Button variant="danger" size="lg" loading={busy} onClick={() => void submit()}>
          {confirm}
        </Button>
      </div>
    </div>
  )
}
