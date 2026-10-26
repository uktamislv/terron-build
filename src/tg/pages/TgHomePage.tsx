import { useEffect } from 'react'
import { useAuth } from '@/auth/authContext'
import { can, type Role } from '@/domain/roles'
import { AlertDeepLink } from '../home/AlertDeepLink'
import { DirectorHome } from '../home/DirectorHome'
import { HomeSections } from '../home/HomeSections'
import { SiteAlerts } from '../home/SiteAlerts'
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
  // Pastki menyuga sig'magan va qo'shimcha bo'limlar: "Qoldiq", "So'rovlarni tasdiqlash", "Sanash" —
  // asosiy plitkalar ostida ixcham qator
  const sections = <HomeSections role={profile.role} />
  return (
    <div className="flex flex-col gap-5">
      {/* Batch 12 (J): Telegram xabaridagi "Ochish" → shu ogohlantirish */}
      <AlertDeepLink role={profile.role} />
      {DIRECTOR_HOME.includes(profile.role) ? (
        <DirectorHome name={profile.full_name} sections={sections} />
      ) : (
        // Prorab / omborchi: "Kirim" va "Chiqim" plitkalari, ostida "Bo'limlar", keyin bugungi yozuvlar
        <WorkerHome profile={profile} sections={sections} />
      )}
      {/* Prorab / omborchi: a'zo obyektlardagi ogohlantirishlar (faqat ko'rish) */}
      {(profile.role === 'prorab' || profile.role === 'omborchi') && <SiteAlerts profileId={profile.id} />}
      {/* Batch 12 (K): tugayotgan materiallar (prorab, omborchi, direktor, admin) */}
      <RunningLow companyId={profile.company_id} role={profile.role} profileId={profile.id} />
    </div>
  )
}
