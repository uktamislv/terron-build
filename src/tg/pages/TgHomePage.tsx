import { useAuth } from '@/auth/authContext'
import { t } from '@/i18n'
import { formatDate } from '@/lib/format'

export function TgHomePage() {
  const { profile } = useAuth()

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl bg-brand p-5 text-white">
        <p className="text-sm opacity-80">{formatDate(new Date())}</p>
        <h1 className="mt-1 text-xl font-semibold">
          {t.tg.hello}
          {profile ? `, ${profile.full_name}` : ''}!
        </h1>
        {profile && <p className="mt-1 text-sm opacity-90">{t.roles[profile.role]}</p>}
      </div>
      <p className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-600">{t.app.tagline}</p>
    </div>
  )
}
