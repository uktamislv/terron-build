import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { Eye, EyeOff } from 'lucide-react'
import { BrandMark, Button, FullPageSpinner, Notice, TextField } from '@/components/ui'
import { signInWithPassword, type SignInError } from '@/data/authRepo'
import { t } from '@/i18n'

const signInMessages: Record<SignInError, string> = {
  not_configured: t.auth.notConfigured,
  invalid_login: t.auth.invalidLogin,
  invalid_credentials: t.auth.invalidCredentials,
  network: t.errors.network,
  unknown: t.errors.unknown,
}

export function LoginPage() {
  const { configured, loading, profile, profileError, notice, clearNotice } = useAuth()
  const location = useLocation()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const from = (location.state as { from?: string } | null)?.from
  if (profile || profileError) return <Navigate to={from && from !== '/login' ? from : '/'} replace />
  if (loading && !submitting) return <FullPageSpinner />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    clearNotice()
    if (!login.trim() || !password) {
      setError(t.auth.required)
      return
    }
    setError(null)
    setSubmitting(true)
    const result = await signInWithPassword(login, password)
    setSubmitting(false)
    // Muvaffaqiyatda AuthProvider sessiyani oladi va yuqoridagi Navigate ishlaydi
    if (!result.ok) setError(signInMessages[result.error])
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-100">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-14" />
          <div>
            <p className="text-2xl font-semibold tracking-tight text-ink">{t.app.name}</p>
            <p className="mt-1 text-sm text-muted">{t.app.tagline}</p>
          </div>
        </div>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-ink">{t.auth.title}</h1>

          {!configured && <Notice tone="warn">{t.auth.notConfigured}</Notice>}
          {notice === 'noAccess' && <Notice>{t.auth.noAccess}</Notice>}
          {error && <Notice>{error}</Notice>}

          <TextField
            label={t.auth.loginLabel}
            placeholder={t.auth.loginPlaceholder}
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            disabled={!configured}
          />
          <div className="flex flex-col gap-1.5">
            <TextField
              label={t.auth.passwordLabel}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!configured}
            />
            <button
              type="button"
              aria-pressed={showPassword}
              className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg px-1 text-sm font-semibold text-brand hover:underline"
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff aria-hidden className="size-4" strokeWidth={1.75} /> : <Eye aria-hidden className="size-4" strokeWidth={1.75} />}
              {showPassword ? t.auth.hidePassword : t.auth.showPassword}
            </button>
          </div>

          <Button type="submit" size="lg" disabled={!configured} loading={submitting} className="w-full">
            {submitting ? t.auth.submitting : t.auth.submit}
          </Button>
          <p className="text-center text-xs text-muted">{t.auth.forgot}</p>
        </form>
      </div>
    </div>
  )
}
