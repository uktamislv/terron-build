import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '@/auth/authContext'
import { ProfileErrorScreen } from '@/auth/screens'
import { Button, FullPageSpinner, Notice, Spinner } from '@/components/ui'
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

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 bg-white p-6 text-center">
      <p className="text-lg font-bold text-brand-dark">{t.app.name}</p>
      {children}
    </div>
  )
}

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
        <Screen>
          <h1 className="text-xl font-semibold">{t.tg.gate.outsideTitle}</h1>
          <p className="text-slate-600">{t.tg.gate.outsideText}</p>
          <a
            href={botLink()}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-5 font-medium text-white"
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
        <Screen>
          <h1 className="text-xl font-semibold">{t.tg.gate.contactTitle}</h1>
          <p className="text-slate-600">{t.tg.gate.contactText}</p>
          {state === 'declined' && <Notice tone="warn">{t.tg.gate.declined}</Notice>}
          <Button onClick={() => void shareContact()}>{t.tg.gate.shareContact}</Button>
        </Screen>
      )
    case 'waiting':
      return (
        <Screen>
          <Spinner label={t.tg.gate.waiting} />
        </Screen>
      )
    case 'timeout':
      return (
        <Screen>
          <h1 className="text-xl font-semibold">{t.tg.gate.timeoutTitle}</h1>
          <Notice tone="warn">{t.tg.gate.timeoutText}</Notice>
          <Button onClick={() => setState('waiting')}>{t.common.retry}</Button>
          <Button variant="secondary" onClick={() => void shareContact()}>
            {t.tg.gate.shareContact}
          </Button>
        </Screen>
      )
    case 'inactive':
      return (
        <Screen>
          <Notice>{t.tg.gate.inactive}</Notice>
        </Screen>
      )
    case 'invalid':
      return (
        <Screen>
          <Notice>{t.tg.gate.invalid}</Notice>
        </Screen>
      )
    case 'error':
      return (
        <Screen>
          <Notice>{t.tg.gate.error}</Notice>
          <Button onClick={() => setState('checking')}>{t.common.retry}</Button>
        </Screen>
      )
    case 'ok':
      if (profile) return <>{children}</>
      if (profileError) return <ProfileErrorScreen />
      // Sessiya bor, lekin profil topilmadi (nofaol / firma nofaol)
      if (notice === 'noAccess') {
        return (
          <Screen>
            <Notice>{t.tg.gate.inactive}</Notice>
          </Screen>
        )
      }
      return <FullPageSpinner />
  }
}
