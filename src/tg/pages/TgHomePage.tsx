import { useEffect } from 'react'
import { useAuth } from '@/auth/authContext'
import { can, type Role } from '@/domain/roles'
import { AlertDeepLink } from '../home/AlertDeepLink'
import { DirectorHome } from '../home/DirectorHome'
import { RunningLow } from '../home/RunningLow'
import { WorkerHome } from '../home/WorkerHome'
import { captureLocation } from '../location'

/** Direktor bosh ekrani ko'rinadigan rollar (Mini App'da "Bosh" bandi bor rollar). */
const DIRECTOR_HOME: readonly Role[] = ['direktor', 'admin', 'super_admin']

export function TgHomePage() {
  const { profile } = useAuth()
  const role = profile?.role
  // Batch 12 (D): yozuv kiritadiganlarga joylashuv ruxsati oynasi bosh ekrandayoq chiqsin —
  // natija ishlatilmaydi, hech narsani kutdirmaydi
  useEffect(() => {
    if (role && (can(role, 'create_movement') || can(role, 'create_purchase'))) void captureLocation()
  }, [role])
  if (!profile) return null
  return (
    <div className="flex flex-col gap-5">
      {/* Batch 12 (J): Telegram xabaridagi "Ochish" → shu ogohlantirish */}
      <AlertDeepLink role={profile.role} />
      {DIRECTOR_HOME.includes(profile.role) ? (
        <DirectorHome name={profile.full_name} />
      ) : (
        // Prorab / omborchi: "Kirim" va "Chiqim" plitkalari + bugungi yozuvlar
        <WorkerHome profile={profile} />
      )}
      {/* Batch 12 (K): tugayotgan materiallar (prorab, omborchi, direktor, admin) */}
      <RunningLow companyId={profile.company_id} role={profile.role} />
    </div>
  )
}
