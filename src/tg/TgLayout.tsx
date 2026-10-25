import { useEffect, type ReactNode } from 'react'
import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { Forbidden } from '@/components/Forbidden'
import type { TgNavKey } from '@/domain/roles'
import { tgNavForRole } from './nav'
import { haptic, initTelegram } from './telegram'

export function TgLayout() {
  const { profile } = useAuth()
  const nav = profile ? tgNavForRole(profile.role) : []

  useEffect(() => {
    initTelegram()
  }, [])

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-white">
      <main className="flex-1 p-4 pb-24">
        <Outlet />
      </main>
      {nav.length > 0 && (
        <nav
          className="fixed inset-x-0 bottom-0 z-10 mx-auto grid max-w-md border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
          // Band soni rolga qarab 1–4 ta — ustunlar soni shunga moslashadi
          style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}
        >
          {nav.map((item) => (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.to === '/tg'}
              onClick={haptic.select}
              className={({ isActive }) =>
                `flex min-h-14 items-center justify-center px-1 text-center text-xs font-medium ${
                  isActive ? 'text-brand' : 'text-slate-500'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}

/** /tg ochilganda: rolda "Bosh" bo'lmasa — birinchi ruxsat etilgan bandga. */
export function TgIndex({ home }: { home: ReactNode }) {
  const { profile } = useAuth()
  if (!profile) return null
  const nav = tgNavForRole(profile.role)
  if (nav.some((item) => item.key === 'home')) return <>{home}</>
  const first = nav[0]
  return first ? <Navigate to={first.to} replace /> : <Forbidden homePath={null} />
}

/** Rolga ruxsat etilmagan Mini App ekrani — "Ruxsat yo'q". Haqiqiy himoya RLS'da. */
export function RequireTgNav({ navKey, children }: { navKey: TgNavKey; children: ReactNode }) {
  const { profile } = useAuth()
  if (!profile) return null
  if (tgNavForRole(profile.role).some((item) => item.key === navKey)) return <>{children}</>
  return <Forbidden homePath="/tg" />
}
