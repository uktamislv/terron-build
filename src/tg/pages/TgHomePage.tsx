import { useAuth } from '@/auth/authContext'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import { formatDate } from '@/lib/format'
import { DirectorHome } from '../home/DirectorHome'

/** Direktor bosh ekrani ko'rinadigan rollar (Mini App'da "Bosh" bandi bor rollar). */
const DIRECTOR_HOME: readonly Role[] = ['direktor', 'admin', 'super_admin']

export function TgHomePage() {
  const { profile } = useAuth()

  if (profile && DIRECTOR_HOME.includes(profile.role)) return <DirectorHome name={profile.full_name} />

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
