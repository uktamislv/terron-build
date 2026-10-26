import { useId, useState, type FormEvent } from 'react'
import { CircleCheck } from 'lucide-react'
import { useAuth } from '@/auth/authContext'
import { Button, Notice, TextAreaField } from '@/components/ui'
import { BUG_MESSAGE_MAX, BUG_SCREEN_MAX, createBugReport } from '@/data/bugReportsRepo'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { APP_VERSION, describeClient } from '@/lib/clientInfo'
import { uuid } from '@/lib/uuid'
import { PhotoField } from '@/tg/entry/PhotoPicker'
import { usePhotoDraft } from '@/tg/entry/usePhotoDraft'
import { getWebApp } from '@/tg/telegram'

const tb = t.bugReport

function currentClient(): string {
  const app = getWebApp()
  return describeClient({
    telegram: app ? { platform: app.platform, version: app.version } : null,
    userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
  })
}

/**
 * "Xatolik haqida xabar berish" formasi (Mini App varag'i va veb dialogi uchun umumiy):
 * matn (majburiy), ixtiyoriy rasm, joriy ekran va qurilma avtomatik.
 */
export function BugReportForm({
  screen,
  onClose,
  onSent,
}: {
  /** Joriy yo'l (masalan "/tg/movement"). */
  screen: string
  onClose: () => void
  /** Muvaffaqiyatli yuborilganda (masalan Telegram haptic). */
  onSent?: () => void
}) {
  const { profile } = useAuth()
  const messageId = useId()
  // Skrinshot — alohida `bug/` papkada (faqat yuboruvchi va admin ko'radi)
  const photo = usePhotoDraft({ kind: 'bug' })
  // Bitta xabar — bitta id: javob yo'qolib qayta yuborilsa, ikkinchi yozuv yaratilmaydi
  const [reportId] = useState(uuid)
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  if (!profile) return null
  const companyId = profile.company_id

  const send = async (withoutPhoto = false) => {
    if (sending) return
    const text = message.trim()
    if (!text) {
      setMessageError(tb.errMessage)
      return
    }
    if (text.length > BUG_MESSAGE_MAX) {
      setMessageError(tb.errTooLong(BUG_MESSAGE_MAX))
      return
    }
    setSending(true)
    setSendError(null)
    try {
      const photoPath = await photo.resolvePath(companyId, withoutPhoto)
      await createBugReport({
        id: reportId,
        companyId,
        message: text,
        screen: screen.slice(0, BUG_SCREEN_MAX),
        client: currentClient(),
        appVersion: APP_VERSION,
        photoPath,
      })
      setSent(true)
      onSent?.()
    } catch (err) {
      if (!photo.handleSaveError(err)) setSendError(errorText(err))
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4 p-2">
        <div role="status" className="flex items-start gap-3 rounded-xl border border-ok/25 bg-ok-bg px-4 py-3 text-ok">
          <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2} />
          <p className="font-semibold">{tb.sent}</p>
        </div>
        <Button variant="secondary" size="lg" onClick={onClose}>
          {t.common.close}
        </Button>
      </div>
    )
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void send()
  }

  return (
    <form noValidate onSubmit={submit} aria-label={tb.title} className="flex flex-col gap-4 p-2">
      <p className="text-sm text-muted">{tb.intro}</p>
      <TextAreaField
        id={messageId}
        label={tb.message}
        rows={4}
        required
        maxLength={BUG_MESSAGE_MAX}
        value={message}
        placeholder={tb.messagePlaceholder}
        error={messageError}
        onChange={(e) => {
          setMessage(e.target.value)
          setMessageError(null)
        }}
      />
      <PhotoField
        label={tb.photo}
        photo={photo.photo}
        busy={sending}
        preparing={photo.preparing}
        notice={photo.notice}
        onPick={(f) => void photo.pick(f)}
        onRemove={photo.remove}
      />
      <p className="text-xs text-muted">
        {tb.screen}: <span className="font-medium text-ink">{screen}</span>
      </p>
      {photo.error && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-danger/20 bg-danger-bg p-3">
          <p className="text-sm font-medium text-danger">{photo.error}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={sending} onClick={() => void send()}>
              {t.common.retry}
            </Button>
            <Button disabled={sending} onClick={() => void send(true)}>
              {tb.sendWithoutPhoto}
            </Button>
          </div>
        </div>
      )}
      {sendError && <Notice>{sendError}</Notice>}
      <Button type="submit" size="lg" loading={sending} disabled={photo.preparing}>
        {sending ? tb.sending : tb.send}
      </Button>
    </form>
  )
}
