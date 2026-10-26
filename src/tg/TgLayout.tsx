import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router'
import { Bug, CircleHelp } from 'lucide-react'
import { useAuth } from '@/auth/authContext'
import { BugReportForm } from '@/components/bugReport/BugReportForm'
import { Forbidden } from '@/components/Forbidden'
import { BottomSheet, BrandMark, cx, IconButton, SheetChromeContext } from '@/components/ui'
import { tgExtraFor, type TgExtraKey, type TgNavKey } from '@/domain/roles'
import { t } from '@/i18n'
import { tgBottomNavForRole, tgNavForRole } from './nav'
import { deepLinkTarget } from './deepLinks'
import { tgNavIcons } from './navIcons'
import { haptic, initTelegram } from './telegram'
import { registerSheet, TgChromeContext } from './useTelegramButtons'

/** Mini App sarlavhasidagi sahifa nomi (yo'l bo'yicha). Bosh ekranda — salomlashish sahifa ichida. */
function pageTitle(pathname: string): string | null {
  const seg = pathname.replace(/^\/tg\/?/, '').split('/')[0] ?? ''
  switch (seg) {
    case 'movement':
      return t.tg.movement.title
    case 'purchase':
      return t.tg.purchase.title
    case 'request':
      return t.tg.request.title
    case 'inventory':
      return t.tg.inventory.title
    case 'mine':
      return t.tg.mine.title
    case 'stock':
      return t.tg.stock.title
    case 'approvals':
      return t.tg.approvals.title
    case 'help':
      return t.help.title
    default:
      return null
  }
}

/** Matn kiritiladigan maydon (klaviatura ochiladi) — checkbox/radio/fayl emas. */
function isTextEntry(el: EventTarget | null): boolean {
  if (el instanceof HTMLTextAreaElement) return true
  if (!(el instanceof HTMLInputElement)) return false
  return !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'range', 'color', 'hidden'].includes(el.type)
}

/** Klaviatura ochiq (matn maydoni fokusda) — pastki menyu yashiriladi. */
function useTextEntryFocused(): boolean {
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    const onIn = (e: FocusEvent) => setFocused(isTextEntry(e.target))
    const onOut = (e: FocusEvent) => {
      if (!isTextEntry(e.relatedTarget)) setFocused(false)
    }
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => {
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
    }
  }, [])
  return focused
}

export function TgLayout({ children }: { children?: ReactNode } = {}) {
  const { profile } = useAuth()
  const nav = profile ? tgBottomNavForRole(profile.role) : []

  const { pathname } = useLocation()
  const [bugOpen, setBugOpen] = useState(false)
  const closeBug = useCallback(() => setBugOpen(false), [])
  const [mainButtons, setMainButtons] = useState(0)
  const chrome = useMemo(
    () => ({ setMainButtonVisible: (visible: boolean) => setMainButtons((n) => Math.max(0, n + (visible ? 1 : -1))) }),
    [],
  )
  const typing = useTextEntryFocused()
  // Telegram MainButton ko'rinib turganda yoki klaviatura ochiq bo'lsa — pastki menyu yashiriladi
  // Rolda bitta band bo'lsa — menyu kerak emas (bitta tugmali menyu joy egallaydi, xolos)
  const navHidden = mainButtons > 0 || typing || nav.length <= 1
  const title = pageTitle(pathname)

  useEffect(() => {
    initTelegram()
  }, [])

  return (
    <TgChromeContext.Provider value={chrome}>
      <SheetChromeContext.Provider value={registerSheet}>
      <div className="min-h-app mx-auto flex max-w-md flex-col bg-canvas [--header-h:3.5rem]">
        {profile && (
          // Sarlavha: chapda sahifa nomi, o'ngda kichik yordamchi tugmalar (Yordam, Xatolik haqida xabar)
          <header className="sticky top-0 z-20 flex min-h-14 items-center gap-1 bg-canvas/95 pr-2 pl-4 backdrop-blur print:hidden">
            {title ? (
              <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight text-ink">{title}</h1>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-navy">
                <BrandMark className="size-7 shrink-0" />
                <span className="truncate">{t.app.name}</span>
              </span>
            )}
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
        <main
          className={cx(
            'flex-1 px-4 pt-1',
            navHidden ? 'pb-[calc(1.5rem+env(safe-area-inset-bottom))]' : 'pb-[calc(6rem+env(safe-area-inset-bottom))]',
          )}
        >
          {children ?? <Outlet />}
        </main>
        {!navHidden && (
          <nav
            aria-label={t.app.name}
            className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-md border-t border-line bg-paper/95 px-0.5 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur print:hidden"
            // Band soni rolga qarab 1–5 ta — ustunlar soni shunga moslashadi
            style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}
          >
            {nav.map((item) => (
              <NavLink
                key={item.key}
                to={item.to}
                end={item.to === '/tg'}
                onClick={haptic.select}
                className={({ isActive }) =>
                  cx(
                    'flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-xs leading-tight font-semibold tracking-tight whitespace-nowrap transition-colors',
                    isActive ? 'text-brand' : 'text-muted',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden
                      className={cx('inline-flex h-8 w-14 items-center justify-center rounded-full transition-colors', isActive && 'bg-ice')}
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
      </SheetChromeContext.Provider>
    </TgChromeContext.Provider>
  )
}

/**
 * /tg ochilganda: ish xabaridagi havola (?request= / ?transfer=) — tegishli ekranga; rolda "Bosh" bo'lmasa —
 * birinchi ruxsat etilgan bandga.
 */
export function TgIndex({ home }: { home: ReactNode }) {
  const { profile } = useAuth()
  const { search } = useLocation()
  if (!profile) return null
  const linked = deepLinkTarget(profile.role, new URLSearchParams(search))
  if (linked) return <Navigate to={linked} replace />
  const nav = tgNavForRole(profile.role)
  if (nav.some((item) => item.key === 'home')) return <>{home}</>
  const first = nav[0]
  return first ? <Navigate to={first.to} replace /> : <Forbidden homePath={null} />
}

/** Qo'shimcha bo'lim ("Qoldiq", "Tasdiqlash") — rolga ochiq bo'lmasa "Ruxsat yo'q". */
export function RequireTgExtra({ extraKey, children }: { extraKey: TgExtraKey; children: ReactNode }) {
  const { profile } = useAuth()
  if (!profile) return null
  if (tgExtraFor(profile.role).includes(extraKey)) return <>{children}</>
  return <Forbidden homePath="/tg" />
}

/** Rolga ruxsat etilmagan Mini App ekrani — "Ruxsat yo'q". Haqiqiy himoya RLS'da. */
export function RequireTgNav({ navKey, children }: { navKey: TgNavKey; children: ReactNode }) {
  const { profile } = useAuth()
  if (!profile) return null
  if (tgNavForRole(profile.role).some((item) => item.key === navKey)) return <>{children}</>
  return <Forbidden homePath="/tg" />
}
