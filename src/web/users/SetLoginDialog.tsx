import { useState, type FormEvent } from 'react'
import { Button, Modal, Notice, TextField } from '@/components/ui'
import { setLogin } from '@/data/adminUsersRepo'
import type { Profile } from '@/data/types'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { generatePassword } from '@/lib/password'
import { formatPhoneDisplay } from '@shared/phone'
import { validateLoginForm } from './userForm'

interface Props {
  profile: Profile
  onClose: () => void
  onSaved: () => void
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <code className="flex min-h-11 flex-1 items-center break-all rounded-xl bg-canvas px-3 font-mono text-sm">
          {value}
        </code>
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(value)
              .then(() => setCopied(true))
              .catch(() => undefined)
          }}
        >
          {copied ? t.common.copied : t.common.copy}
        </Button>
      </div>
    </div>
  )
}

export function SetLoginDialog({ profile, onClose, onSaved }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: 'invalid'; password?: 'invalid' }>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<{ login: string; password: string; replaced: boolean } | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validateLoginForm(email, password)
    setErrors(found)
    if (found.email || found.password) return
    setSaveError(null)
    setSaving(true)
    try {
      const result = await setLogin({ profileId: profile.id, email: email.trim() || undefined, password })
      // Parol faqat shu oynada, bir marta ko'rsatiladi — hech qayerda saqlanmaydi
      setDone({ login: result.login, password, replaced: result.existingLoginReplaced })
      setPassword('')
      onSaved()
    } catch (err) {
      setSaveError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    const login = done.login.startsWith('+') ? formatPhoneDisplay(done.login) : done.login
    return (
      <Modal title={t.login.doneTitle} onClose={onClose}>
        <div className="flex flex-col gap-4">
          <Notice tone="warn">{t.login.doneWarning}</Notice>
          {done.replaced && (
            <Notice tone="warn">{t.login.replacedWarning}</Notice>
          )}
          <CopyRow label={t.login.doneLogin} value={login} />
          <CopyRow label={t.login.donePassword} value={done.password} />
          <Button onClick={onClose}>{t.common.close}</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`${t.login.title} — ${profile.full_name}`} onClose={onClose}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t.login.intro}</p>
        {saveError && <Notice>{saveError}</Notice>}
        <TextField
          label={t.login.email}
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint={t.login.emailHint}
          error={errors.email ? t.login.errEmail : null}
        />
        <div className="flex flex-col gap-2">
          <TextField
            label={t.login.password}
            type="text"
            autoComplete="new-password"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={t.login.passwordHint}
            error={errors.password ? t.login.errPassword : null}
          />
          <Button variant="ghost" className="self-start" onClick={() => setPassword(generatePassword())}>
            {t.login.generate}
          </Button>
        </div>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t.common.saving : t.login.submit}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
