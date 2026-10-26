import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '@/auth/authContext'
import { ForcePasswordChangeScreen, ProfileErrorScreen } from '@/auth/screens'
import { Forbidden } from '@/components/Forbidden'
import { FullPageSpinner } from '@/components/ui'
import { webNavFor, type WebNavKey } from '@/domain/roles'
import { t } from '@/i18n'

/**
 * Sessiyasiz foydalanuvchi /login ga yuboriladi (qaytish manzili saqlanadi).
 * Profil tarmoq xatosi bilan yuklanmasa — "Aloqa yo'q"; vaqtinchalik parol — majburiy o'zgartirish.
 */
export function RequireAuth() {
  const { loading, profile, profileError, session } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageSpinner />
  if (profileError) return <ProfileErrorScreen />
  if (!profile) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (session?.mustChangePassword) return <ForcePasswordChangeScreen />
  return <Outlet />
}

/**
 * Rolga ruxsat etilmagan bo'lim — "Ruxsat yo'q". UI qulayligi uchun; haqiqiy himoya RLS'da.
 */
export function RequireNav({ navKey, children }: { navKey: WebNavKey; children: ReactNode }) {
  const { profile } = useAuth()
  if (!profile) return null
  const allowed = webNavFor(profile.role)
  if (allowed.includes(navKey)) return <>{children}</>
  if (allowed.length === 0) return <Forbidden text={t.forbidden.noWeb} homePath={null} />
  return <Forbidden />
}
