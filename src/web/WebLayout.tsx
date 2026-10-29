import { Fragment, useCallback, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { BellRing, Bug, CircleHelp, KeyRound, LogOut, Menu, X } from 'lucide-react'
import { useActiveCompany } from '@/auth/activeCompany'
import { ActiveCompanyProvider } from '@/auth/ActiveCompanyProvider'
import { useAuth } from '@/auth/authContext'
import { ChangePasswordForm } from '@/auth/ChangePasswordForm'
import { BugReportForm } from '@/components/bugReport/BugReportForm'
import { NotifyWorkflowToggle } from '@/components/NotifyWorkflowToggle'
import { BrandMark, cx, IconButton, Modal, useOverlay, Wordmark } from '@/components/ui'
import { t } from '@/i18n'
import { webNavForRole } from './nav'
import { webNavIcons } from './navIcons'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·'
}

/** Telefon/planshet: ochiq yon menyu — Esc, fokus tuzog'i. */
function DrawerBehaviour({ target, onClose }: { target: RefObject<HTMLElement | null>; onClose: () => void }) {
  useOverlay(target, onClose)
  return null
}

/** super_admin: faol firma tanlagichi (yon menyudagi foydalanuvchi bloki). Boshqa rollarga ko'rinmaydi. */
function CompanySwitcher() {
  const active = useActiveCompany()
  const id = useId()
  if (!active?.canSwitch || active.companies.length === 0) return null
  return (
    <div className="flex flex-col gap-1 px-1 pb-2 lg:hidden xl:flex">
      <label htmlFor={id} className="text-xs text-navy-muted">
        {t.companies.switcher}
      </label>
      <select
        id={id}
        value={active.companyId}
        title={t.companies.switcherHint}
        onChange={(e) => active.setCompanyId(e.target.value)}
        className="min-h-11 w-full rounded-xl border border-white/15 bg-white/10 px-3 text-sm text-white [&>option]:text-ink"
      >
        {/* Tanlangan firma ro'yxatda bo'lmasa ham (masalan hali yuklanmagan) — ko'rinsin */}
        {!active.companies.some((c) => c.id === active.companyId) && <option value={active.companyId}>—</option>}
        {active.companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.is_active ? c.name : `${c.name} (${t.companies.inactive})`}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Sahifalar faol firma almashganda qaytadan yuklanadi (har sahifa o'z ro'yxatini qayta so'raydi). */
function CompanyKeyed({ children }: { children: ReactNode }) {
  const active = useActiveCompany()
  return <Fragment key={active?.companyId ?? ''}>{children}</Fragment>
}

/**
 * Veb panel: navy yon menyu (≥ 1280 — keng, 1024–1279 — faqat belgilar + tooltip, < 1024 — varaq),
 * pastda foydalanuvchi bloki. Kontent chapga tekislangan, maksimal 1280 px.
 */
export function WebLayout({ children }: { children?: ReactNode } = {}) {
  return (
    <ActiveCompanyProvider>
      <WebShell>{children}</WebShell>
    </ActiveCompanyProvider>
  )
}

function WebShell({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  // Ish xabarlari (so'rov, o'tkazma, xarid) — o'z profilida; direktorga tegishli emas
  const [notifyOpen, setNotifyOpen] = useState(false)
  const closeNotify = useCallback(() => setNotifyOpen(false), [])
  // Batch 11: xatolik haqida xabar (sozlamalar endi alohida sahifa — /settings)
  const [bugOpen, setBugOpen] = useState(false)
  const closeBug = useCallback(() => setBugOpen(false), [])
  const { pathname } = useLocation()
  const closePassword = useCallback(() => setPasswordOpen(false), [])
  const closeMenu = useCallback(() => setOpen(false), [])
  const { profile, signOut } = useAuth()
  const nav = profile ? webNavForRole(profile.role) : []
  const aside = useRef<HTMLElement>(null)
  const asideId = useId()

  return (
    <div className="flex min-h-dvh bg-canvas [--header-h:3.5rem] lg:[--header-h:0px]">
      <aside
        ref={aside}
        id={asideId}
        tabIndex={-1}
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-navy text-white outline-none transition-[transform,visibility] duration-200 print:hidden',
          // Navy fonda ko'k halqa ko'rinmaydi — oq halqa
          '[&_:focus-visible]:outline-white',
          'lg:sticky lg:top-0 lg:z-30 lg:h-screen lg:w-19 lg:translate-x-0 xl:w-64',
          open ? 'visible translate-x-0 shadow-float' : 'invisible -translate-x-full lg:visible',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 px-5 lg:justify-center lg:px-0 xl:justify-start xl:px-5">
          <BrandMark className="hidden size-9 shrink-0 rounded-lg ring-1 ring-white/15 lg:block xl:hidden" />
          <Wordmark onDark className="text-[28px] lg:hidden xl:inline-flex" />
          {open && (
            <IconButton
              label={t.common.closeMenu}
              variant="onDark"
              className="ml-auto lg:hidden"
              icon={<X className="size-5" strokeWidth={1.75} />}
              onClick={closeMenu}
            />
          )}
        </div>
        <nav
          aria-label={t.app.name}
          className="scrollbar-dark flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2 lg:overflow-visible lg:px-3 xl:overflow-y-auto"
        >
          {nav.map((item) => (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.to === '/'}
              onClick={closeMenu}
              className={({ isActive }) =>
                cx(
                  'group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors lg:justify-center lg:px-0 xl:justify-start xl:px-3',
                  isActive ? 'bg-ice/10 text-white' : 'text-navy-muted hover:bg-white/5 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden
                    className={cx('absolute top-2 bottom-2 -left-3 w-1 rounded-r-full', isActive ? 'bg-brand-300' : 'bg-transparent')}
                  />
                  {webNavIcons[item.key]}
                  <span
                    className={cx(
                      'truncate',
                      // 1024–1279: tooltip
                      'lg:pointer-events-none lg:absolute lg:left-full lg:z-50 lg:ml-3 lg:hidden lg:rounded-lg lg:bg-ink lg:px-2.5 lg:py-1.5 lg:text-xs lg:whitespace-nowrap lg:shadow-float',
                      'lg:group-hover:block lg:group-focus-visible:block',
                      'xl:pointer-events-auto xl:static xl:ml-0 xl:block xl:bg-transparent xl:p-0 xl:text-sm xl:shadow-none',
                    )}
                  >
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        {profile && (
          <div className="shrink-0 border-t border-white/10 p-3">
            <CompanySwitcher />
            <div className="flex items-center gap-3 px-1 py-2 lg:justify-center xl:justify-start">
              <span
                aria-hidden
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold"
              >
                {initials(profile.full_name)}
              </span>
              <div className="min-w-0 leading-tight lg:sr-only xl:not-sr-only">
                <p className="truncate text-sm font-semibold">{profile.full_name}</p>
                <p className="truncate text-xs text-navy-muted">{t.roles[profile.role]}</p>
              </div>
            </div>
            <NavLink
              to="/help"
              title={t.help.open}
              onClick={closeMenu}
              className={({ isActive }) =>
                cx(
                  'mt-1 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-2 text-sm hover:bg-white/10 hover:text-white xl:justify-start xl:px-3',
                  isActive ? 'bg-ice/10 text-white' : 'text-navy-muted',
                )
              }
            >
              <CircleHelp aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
              <span className="truncate lg:sr-only xl:not-sr-only">{t.help.open}</span>
            </NavLink>
            <button
              type="button"
              title={t.bugReport.open}
              onClick={() => {
                closeMenu()
                setBugOpen(true)
              }}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-2 text-sm text-navy-muted hover:bg-white/10 hover:text-white xl:justify-start xl:px-3"
            >
              <Bug aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
              <span className="truncate lg:sr-only xl:not-sr-only">{t.bugReport.open}</span>
            </button>
            {profile.role !== 'direktor' && (
              <button
                type="button"
                title={t.settings.notify.title}
                onClick={() => {
                  closeMenu()
                  setNotifyOpen(true)
                }}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-2 text-sm text-navy-muted hover:bg-white/10 hover:text-white xl:justify-start xl:px-3"
              >
                <BellRing aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
                <span className="truncate lg:sr-only xl:not-sr-only">{t.settings.notify.title}</span>
              </button>
            )}
            <div className="mt-1 flex gap-1 lg:flex-col xl:flex-row">
              <button
                type="button"
                title={t.password.change}
                onClick={() => setPasswordOpen(true)}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-2 text-sm text-navy-muted hover:bg-white/10 hover:text-white"
              >
                <KeyRound aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
                <span className="lg:sr-only xl:not-sr-only">{t.password.change}</span>
              </button>
              <button
                type="button"
                title={t.common.signOut}
                onClick={() => void signOut()}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-2 text-sm text-navy-muted hover:bg-white/10 hover:text-white"
              >
                <LogOut aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
                <span className="lg:sr-only xl:not-sr-only">{t.common.signOut}</span>
              </button>
            </div>
          </div>
        )}
      </aside>
      {open && <DrawerBehaviour target={aside} onClose={closeMenu} />}

      {open && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t.common.closeMenu}
          className="fixed inset-0 z-30 animate-fade-in bg-navy/40 lg:hidden"
          onClick={closeMenu}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-paper/95 px-2 backdrop-blur lg:hidden print:hidden">
          <IconButton
            label={t.common.openMenu}
            aria-expanded={open}
            aria-controls={asideId}
            icon={<Menu className="size-6" strokeWidth={1.75} />}
            className="text-ink"
            onClick={() => setOpen(true)}
          />
          <NavLink to="/" end className="ml-1 inline-flex min-h-11 items-center rounded-lg">
            <Wordmark className="text-2xl" />
          </NavLink>
        </header>
        <main className="w-full max-w-7xl flex-1 px-4 py-4 md:px-6 md:py-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
          <CompanyKeyed>{children ?? <Outlet />}</CompanyKeyed>
        </main>
      </div>
      {bugOpen && profile && (
        <Modal title={t.bugReport.title} onClose={closeBug}>
          <BugReportForm screen={pathname} onClose={closeBug} />
        </Modal>
      )}
      {notifyOpen && (
        <Modal title={t.settings.notify.title} onClose={closeNotify}>
          <NotifyWorkflowToggle />
        </Modal>
      )}
      {passwordOpen && (
        <Modal title={t.password.change} onClose={closePassword}>
          <ChangePasswordForm onDone={closePassword} />
        </Modal>
      )}
    </div>
  )
}
