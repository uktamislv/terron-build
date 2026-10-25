// Ko'rgazma sahifasi — faqat DEV (`import.meta.env.DEV`), production build'ga kirmaydi (src/routes.tsx).
// /__preview — ro'yxat; ?view=<id> — bitta ekran; ?w=mobile — 390 px ramka (iframe: media so'rovlar telefon bo'yicha).
import { useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Monitor, Smartphone } from 'lucide-react'
import { AuthContext, type AuthState } from '@/auth/authContext'
import { BrandMark, ToastProvider } from '@/components/ui'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import { TgLayout } from '@/tg/TgLayout'
import { WebLayout } from '@/web/WebLayout'
import { previewProfile } from './fixtures'
import type { PreviewView } from './types'
import { views as kitViews } from './views/kit'
import { views as tgViews } from './views/tg'
import { views as webMainViews } from './views/webMain'
import { views as webOmborViews } from './views/webOmbor'

const allViews: PreviewView[] = [...kitViews, ...webMainViews, ...webOmborViews, ...tgViews]

function fakeAuth(role: Role): AuthState {
  const profile = previewProfile(role)
  return {
    configured: true,
    loading: false,
    session: { userId: profile.auth_user_id ?? 'pv', email: null, mustChangePassword: false },
    profile,
    profileError: null,
    notice: null,
    clearNotice: () => undefined,
    signOut: async () => undefined,
    reloadProfile: () => undefined,
    refreshSession: async () => undefined,
  }
}

function Screen({ view }: { view: PreviewView }) {
  const auth = useMemo(() => fakeAuth(view.role), [view.role])
  const body = view.render()
  return (
    <AuthContext.Provider value={auth}>
      <ToastProvider>{view.surface === 'web' ? <WebLayout>{body}</WebLayout> : <TgLayout>{body}</TgLayout>}</ToastProvider>
    </AuthContext.Provider>
  )
}

function MobileFrame({ view }: { view: PreviewView }) {
  return (
    <div className="flex min-h-screen flex-col items-center gap-3 bg-[#dfe5ef] p-6">
      <p className="text-sm font-semibold text-ink">
        {view.title} · 390 px
      </p>
      <iframe
        title={view.title}
        src={`/__preview?view=${encodeURIComponent(view.id)}&embed=1`}
        className="h-[844px] w-[390px] rounded-[28px] border-8 border-ink bg-canvas shadow-float"
      />
    </div>
  )
}

function Index() {
  const link = (v: PreviewView, mobile: boolean): ReactNode => (
    <Link
      to={`/__preview?view=${v.id}${mobile ? '&w=mobile' : ''}`}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-paper px-3 text-sm font-semibold text-ink hover:border-brand/40 hover:bg-ice/40"
    >
      {mobile ? <Smartphone aria-hidden className="size-4" /> : <Monitor aria-hidden className="size-4" />}
      {mobile ? '390 px' : 'Keng'}
    </Link>
  )
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center gap-3">
        <BrandMark className="size-10" />
        <div>
          <h1 className="text-[28px] font-semibold text-ink">{t.ui.preview}</h1>
          <p className="text-sm text-muted">{t.app.name} — /__preview?view=…</p>
        </div>
      </header>
      {(['web', 'tg'] as const).map((surface) => (
        <section key={surface} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink">{surface === 'web' ? 'Veb panel' : 'Mini App'}</h2>
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-paper">
            {allViews
              .filter((v) => v.surface === surface)
              .map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <div>
                    <p className="font-semibold text-ink">{v.title}</p>
                    <code className="text-xs text-muted">?view={v.id}</code>
                  </div>
                  <div className="flex gap-2">
                    {surface === 'web' && link(v, false)}
                    {link(v, true)}
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </main>
  )
}

export function PreviewPage() {
  const [params] = useSearchParams()
  const view = allViews.find((v) => v.id === params.get('view'))
  if (!view) return <Index />
  if (params.get('w') === 'mobile' && params.get('embed') !== '1') return <MobileFrame view={view} />
  return <Screen view={view} />
}

