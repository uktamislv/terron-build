import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Bug, CircleHelp } from 'lucide-react'
import { useAuth } from '@/auth/authContext'
import { BugReportForm } from '@/components/bugReport/BugReportForm'
import { Forbidden } from '@/components/Forbidden'
import { BottomSheet, cx, IconButton } from '@/components/ui'
import type { TgNavKey } from '@/domain/roles'
import { t } from '@/i18n'
import { tgNavForRole } from './nav'
import { tgNavIcons } from './navIcons'
import { haptic, initTelegram } from './telegram'

export function TgLayout({ children }: { children?: ReactNode } = {}) {
  const { profile } = useAuth()
  const nav = profile ? tgNavForRole(profile.role) : []

  const { pathname } = useLocation()
  const [bugOpen, setBugOpen] = useState(false)
  const closeBug = useCallback(() => setBugOpen(false), [])

  useEffect(() => {
    initTelegram()
  }, [])

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-canvas [--header-h:0px]">
      {profile && (
        // Pastki menyu emas: kichik yordamchi tugmalar (Yordam, Xatolik haqida xabar) — har ekranda
        <header className="flex items-center justify-end gap-1 px-2 pt-1 print:hidden">
          <NavLink
            to="/tg/help"
            aria-label={t.help.open}
            title={t.help.open}
            onClick={haptic.select}
            className={({ isActive }) =>
              cx(
                'inline-flex size-11 items-center justify-center rounded-xl transition-colors hover:bg-ice hover:text-brand',
                isActive ? 'bg-ice text-brand' : 'text-muted',
              )
            }
          >
            <CircleHelp aria-hidden className="size-5" strokeWidth={1.75} />
          </NavLink>
          <IconButton
            label={t.bugReport.open}
            icon={<Bug className="size-5" strokeWidth={1.75} />}
            onClick={() => {
              haptic.tap()
              setBugOpen(true)
            }}
          />
        </header>
      )}
      <main className="flex-1 px-4 pt-1 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        {children ?? <Outlet />}
      </main>
      {nav.length > 0 && (
        <nav
          aria-label={t.app.name}
          className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-md print:hidden border-t border-line bg-paper/95 px-0.5 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur"
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
                `flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[11px] leading-tight font-semibold tracking-[-0.01em] whitespace-nowrap transition-colors ${
                  isActive ? 'text-brand' : 'text-muted'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden
                    className={`inline-flex h-8 w-14 items-center justify-center rounded-full transition-colors ${isActive ? 'bg-ice' : ''}`}
                  >
                    {tgNavIcons[item.key]}
                  </span>
                  <span className="max-w-full truncate">{item.shortLabel}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      )}
      {bugOpen && (
        <BottomSheet title={t.bugReport.title} onClose={closeBug}>
          <BugReportForm screen={pathname} onClose={closeBug} onSent={haptic.success} />
        </BottomSheet>
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
