import type { ReactNode } from 'react'
import { Button, Notice } from '@/components/ui'
import { t } from '@/i18n'
import { useAuth } from './authContext'
import { ChangePasswordForm } from './ChangePasswordForm'

function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-lg font-bold text-brand-dark">{t.app.name}</p>
        {children}
      </div>
    </div>
  )
}

/** Profilni yuklashda tarmoq xatosi — sessiya saqlanadi, qayta urinish mumkin. */
export function ProfileErrorScreen() {
  const { reloadProfile, signOut } = useAuth()
  return (
    <CenteredCard>
      <h1 className="text-xl font-semibold">{t.auth.offlineTitle}</h1>
      <Notice tone="warn">{t.auth.offlineText}</Notice>
      <Button onClick={reloadProfile}>{t.common.retry}</Button>
      <Button variant="secondary" onClick={() => void signOut()}>
        {t.common.signOut}
      </Button>
    </CenteredCard>
  )
}

/** Admin bergan vaqtinchalik parol bilan kirilgan — boshqa sahifalar o'rniga. */
export function ForcePasswordChangeScreen() {
  const { signOut } = useAuth()
  return (
    <CenteredCard>
      <h1 className="text-xl font-semibold">{t.password.forcedTitle}</h1>
      <p className="text-sm text-slate-600">{t.password.forcedText}</p>
      <ChangePasswordForm />
      <Button variant="ghost" onClick={() => void signOut()}>
        {t.common.signOut}
      </Button>
    </CenteredCard>
  )
}
