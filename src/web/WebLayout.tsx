import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { t } from '@/i18n'
import { webNav } from './nav'

export function WebLayout() {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 transform overflow-y-auto bg-brand-dark text-white transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center px-5 text-lg font-bold">{t.app.name}</div>
        <nav className="flex flex-col gap-1 px-3 pb-6">
          {webNav.map((item) => (
            <NavLink
              key={item.to}
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
            className="inline-flex size-11 items-center justify-center rounded-lg text-brand-dark hover:bg-brand-light lg:hidden"
            onClick={() => setOpen(true)}
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="truncate font-semibold text-brand-dark">{t.app.tagline}</span>
        </header>
        <main className="flex-1 p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
