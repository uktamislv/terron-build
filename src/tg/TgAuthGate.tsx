import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '@/auth/authContext'
import { ProfileErrorScreen } from '@/auth/screens'
import { Clock, LoaderCircle, Phone, Send, ShieldX, WifiOff } from 'lucide-react'
import { BrandMark, Button, cx, FullPageSpinner, Notice } from '@/components/ui'
import { clearLocalSession, telegramSignIn, type TelegramSignInStatus } from '@/data/authRepo'
import { t } from '@/i18n'
import { botLink, getInitData, haptic, isInsideTelegram, requestContact, stripLaunchParamsFromUrl } from './telegram'

type GateState =
  | 'outside'
  | 'checking'
  | 'need_contact'
  | 'declined'
  | 'waiting'
  | 'timeout'
  | 'inactive'
  | 'invalid'
  | 'error'
  | 'ok'

interface Props {
  children: ReactNode
  /** Kontakt ulashilgandan keyin tg-auth qayta chaqiriladigan oraliq (ms) */
  pollIntervalMs?: number
  /** Kutishning eng ko'p davomiyligi (ms) */
  pollTimeoutMs?: number
}

/**
 * Bitta tg-auth chaqiruvi. `ok` bo'lsa AuthProvider sessiyani darhol qayta o'qiydi —
 * onAuthChange hodisasini kutib qolmaslik uchun.
 */
async function signInOnce(refreshSession: () => Promise<void>): Promise<TelegramSignInStatus> {
  const status = await telegramSignIn(getInitData())
  if (status === 'ok') {
    stripLaunchParamsFromUrl()
    await refreshSession()
  } else {
    // Server bu Telegram foydalanuvchisini tanimadi — qurilmadagi eski sessiya (boshqa odamniki
    // bo'lishi mumkin) ishlatilmasin
    await clearLocalSession().catch(() => undefined)
  }
  return status
}

/** Kirish holati ekrani: tepada brend, markazda belgi (ice/xato doira), sarlavha, matn va amallar. */
function Screen({ children, icon, tone = 'default' }: { children: ReactNode; icon?: ReactNode; tone?: 'default' | 'danger' }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-canvas px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-2.5">
        <BrandMark className="size-9" />
        <span className="text-base font-semibold text-ink">{t.app.name}</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center [&>button]:w-full [&>a]:w-full">
        {icon && (
          <span
            aria-hidden
            className={cx(
              'inline-flex size-16 items-center justify-center rounded-full [&>svg]:size-8',
              tone === 'danger' ? 'bg-danger-bg text-danger' : 'bg-ice text-brand',
            )}
          >
            {icon}
          </span>
        )}
        {children}
      </div>
    </div>
  )
}

const title = 'text-2xl leading-tight font-semibold text-ink'
const text = 'max-w-xs text-base text-muted'

/**
 * Mini App kirishi. Har ochilganda xom initData serverda (tg-auth) tekshiriladi —
 * initDataUnsafe ga ishonilmaydi. Muvaffaqiyatda AuthProvider profilni yuklaydi.
 */
export function TgAuthGate({ children, pollIntervalMs = 2000, pollTimeoutMs = 30000 }: Props) {
  const { profile, profileError, notice, refreshSession } = useAuth()
  const [state, setState] = useState<GateState>(() => (isInsideTelegram() ? 'checking' : 'outside'))

  // Birinchi tekshiruv (va "Qayta urinish")
  useEffect(() => {
    if (state !== 'checking') return
    let active = true
    signInOnce(refreshSession)
      .then((next) => {
        if (active) setState(next)
      })
      .catch(() => {
        if (active) setState('error')
      })
    return () => {
      active = false
    }
  }, [state, refreshSession])

  // Kontakt ulashilgach: har pollIntervalMs da qayta, eng ko'pi pollTimeoutMs
  useEffect(() => {
    if (state !== 'waiting') return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()
    const tick = async () => {
      // Vaqtinchalik tarmoq xatosi — kutishda davom etamiz
      const status = await signInOnce(refreshSession).catch(() => null)
      if (!active) return
      if (status && status !== 'need_contact') {
        setState(status)
        return
      }
      if (Date.now() - startedAt + pollIntervalMs > pollTimeoutMs) {
        setState('timeout')
        return
      }
      timer = setTimeout(() => void tick(), pollIntervalMs)
    }
    timer = setTimeout(() => void tick(), pollIntervalMs)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [state, pollIntervalMs, pollTimeoutMs, refreshSession])

  useEffect(() => {
    if (state === 'ok') haptic.success()
    if (state === 'inactive' || state === 'invalid' || state === 'timeout') haptic.error()
  }, [state])

  async function shareContact() {
    haptic.tap()
    const shared = await requestContact()
    setState(shared ? 'waiting' : 'declined')
  }

  switch (state) {
    case 'outside':
      return (
        <Screen icon={<Send strokeWidth={1.5} />}>
          <h1 className={title}>{t.tg.gate.outsideTitle}</h1>
          <p className={text}>{t.tg.gate.outsideText}</p>
          <a
            href={botLink()}
            className="mt-2 inline-flex min-h-13 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-base font-semibold text-white"
          >
            {t.tg.gate.openBot}
          </a>
        </Screen>
      )
    case 'checking':
      return <FullPageSpinner label={t.tg.gate.checking} />
    case 'need_contact':
    case 'declined':
      return (
        <Screen icon={<Phone strokeWidth={1.5} />}>
          <h1 className={title}>{t.tg.gate.contactTitle}</h1>
          <p className={text}>{t.tg.gate.contactText}</p>
          {state === 'declined' && <Notice tone="warn" className="w-full text-left">{t.tg.gate.declined}</Notice>}
          <Button size="lg" className="mt-2" onClick={() => void shareContact()}>
            {t.tg.gate.shareContact}
          </Button>
        </Screen>
      )
    case 'waiting':
      return (
        <Screen icon={<LoaderCircle className="animate-spin" strokeWidth={1.5} />}>
          <p role="status" className={text}>
            {t.tg.gate.waiting}
          </p>
        </Screen>
      )
    case 'timeout':
      return (
        <Screen icon={<Clock strokeWidth={1.5} />}>
          <h1 className={title}>{t.tg.gate.timeoutTitle}</h1>
          <Notice tone="warn" className="w-full text-left">{t.tg.gate.timeoutText}</Notice>
          <Button size="lg" className="mt-2" onClick={() => setState('waiting')}>
            {t.common.retry}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => void shareContact()}>
            {t.tg.gate.shareContact}
          </Button>
        </Screen>
      )
    case 'inactive':
      return (
        <Screen icon={<ShieldX strokeWidth={1.5} />} tone="danger">
          <p role="alert" className={text}>{t.tg.gate.inactive}</p>
        </Screen>
      )
    case 'invalid':
      return (
        <Screen icon={<ShieldX strokeWidth={1.5} />} tone="danger">
          <p role="alert" className={text}>{t.tg.gate.invalid}</p>
        </Screen>
      )
    case 'error':
      return (
        <Screen icon={<WifiOff strokeWidth={1.5} />} tone="danger">
          <p role="alert" className={text}>
            {t.tg.gate.error}
          </p>
          <Button size="lg" className="mt-2" onClick={() => setState('checking')}>
            {t.common.retry}
          </Button>
        </Screen>
      )
    case 'ok':
      if (profile) return <>{children}</>
      if (profileError) return <ProfileErrorScreen />
      // Sessiya bor, lekin profil topilmadi (nofaol / firma nofaol)
      if (notice === 'noAccess') {
        return (
          <Screen icon={<ShieldX strokeWidth={1.5} />} tone="danger">
            <p role="alert" className={text}>{t.tg.gate.inactive}</p>
          </Screen>
        )
      }
      return <FullPageSpinner />
  }
}
