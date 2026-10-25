import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { Button, FullPageSpinner, Notice, TextField } from '@/components/ui'
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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-2xl font-bold text-brand-dark">{t.app.name}</p>
          <p className="mt-1 text-sm text-slate-600">{t.app.tagline}</p>
        </div>
        <form
          noValidate
          onSubmit={onSubmit}
          className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h1 className="text-xl font-semibold text-brand-dark">{t.auth.title}</h1>

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
              className="self-start text-sm font-medium text-brand min-h-11"
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? t.auth.hidePassword : t.auth.showPassword}
            </button>
          </div>

          <Button type="submit" disabled={!configured || submitting} className="w-full">
            {submitting ? t.auth.submitting : t.auth.submit}
          </Button>
          <p className="text-center text-xs text-slate-500">{t.auth.forgot}</p>
        </form>
      </div>
    </div>
  )
}
