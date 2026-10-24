import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { t } from '@/i18n'
import { haptic, initTelegram } from './telegram'

// Rolga qarab filtrlash Batch 2 da qo'shiladi
const nav = [
  { to: '/tg', label: t.tg.nav.home },
  { to: '/tg/movement', label: t.tg.nav.movement },
  { to: '/tg/purchase', label: t.tg.nav.purchase },
  { to: '/tg/mine', label: t.tg.nav.mine },
] as const

export function TgLayout() {
  useEffect(() => {
    initTelegram()
  }, [])

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-white">
      <main className="flex-1 p-4 pb-24">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto grid max-w-md grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        {nav.map((item) => (
          <NavLink
            key={item.to}
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
    </div>
  )
}
