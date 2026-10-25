import { useState, type FormEvent } from 'react'
import { Button, Notice, TextField } from '@/components/ui'
import { changePassword, MIN_PASSWORD_LENGTH } from '@/data/authRepo'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { useAuth } from './authContext'

function validateNewPassword(password: string, repeat: string): { password?: string; repeat?: string } {
  if (password.length < MIN_PASSWORD_LENGTH) return { password: t.password.errShort }
  if (password !== repeat) return { repeat: t.password.errMismatch }
  return {}
}

/** Yangi parol ×2 → changePassword (must_change_password belgisi ham olib tashlanadi). */
export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const { refreshSession } = useAuth()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [errors, setErrors] = useState<{ password?: string; repeat?: string }>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validateNewPassword(password, repeat)
    setErrors(found)
    if (found.password || found.repeat) return
    setSaving(true)
    setSaveError(null)
    try {
      await changePassword(password)
      await refreshSession()
      onDone?.()
    } catch (err) {
      setSaveError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {saveError && <Notice>{saveError}</Notice>}
      <TextField
        label={t.password.newPassword}
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={t.password.hint}
        error={errors.password}
      />
      <TextField
        label={t.password.repeatPassword}
        type="password"
        autoComplete="new-password"
        value={repeat}
        onChange={(e) => setRepeat(e.target.value)}
        error={errors.repeat}
      />
      <Button type="submit" disabled={saving}>
        {saving ? t.common.saving : t.password.submit}
      </Button>
    </form>
  )
}
