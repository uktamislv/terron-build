import { useCallback, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { ChangePasswordForm } from '@/auth/ChangePasswordForm'
import { Modal } from '@/components/ui'
import { t } from '@/i18n'
import { webNavForRole } from './nav'

export function WebLayout() {
  const [open, setOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const closePassword = useCallback(() => setPasswordOpen(false), [])
  const { profile, signOut } = useAuth()
  const nav = profile ? webNavForRole(profile.role) : []

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 transform overflow-y-auto bg-brand-dark text-white transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center px-5 text-lg font-bold">{t.app.name}</div>
        <nav aria-label={t.app.name} className="flex flex-col gap-1 px-3 pb-6">
          {nav.map((item) => (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex min-h-11 items-center rounded-lg px-3 text-sm font-medium ${
                  isActive ? 'bg-brand text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {open && (
        <button
          type="button"
          aria-label={t.common.closeMenu}
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:px-8">
          <button
            type="button"
            aria-label={t.common.openMenu}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-brand-dark hover:bg-brand-light lg:hidden"
            onClick={() => setOpen(true)}
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="hidden truncate font-semibold text-brand-dark md:block">{t.app.tagline}</span>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            {profile && (
              <div className="min-w-0 text-right leading-tight">
                <p className="truncate text-sm font-semibold text-slate-900">{profile.full_name}</p>
                <p className="truncate text-xs text-slate-500">{t.roles[profile.role]}</p>
              </div>
            )}
            <button
              type="button"
              aria-label={t.password.change}
              onClick={() => setPasswordOpen(true)}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium text-brand hover:bg-brand-light"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="8" cy="15" r="4" />
                <path d="M11 12l9-9M17 6l3 3M15 8l2 2" />
              </svg>
              <span className="hidden xl:inline">{t.password.change}</span>
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium text-brand hover:bg-brand-light"
            >
              {t.common.signOut}
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
      {passwordOpen && (
        <Modal title={t.password.change} onClose={closePassword}>
          <ChangePasswordForm onDone={closePassword} />
        </Modal>
      )}
    </div>
  )
}
