import { useAuth } from '@/auth/authContext'
import type { Role } from '@/domain/roles'
import { DirectorHome } from '../home/DirectorHome'
import { WorkerHome } from '../home/WorkerHome'

/** Direktor bosh ekrani ko'rinadigan rollar (Mini App'da "Bosh" bandi bor rollar). */
const DIRECTOR_HOME: readonly Role[] = ['direktor', 'admin', 'super_admin']

export function TgHomePage() {
  const { profile } = useAuth()
  if (!profile) return null
  if (DIRECTOR_HOME.includes(profile.role)) return <DirectorHome name={profile.full_name} />
  // Prorab / omborchi: "Kirim" va "Chiqim" plitkalari + bugungi yozuvlar
  return <WorkerHome profile={profile} />
}
