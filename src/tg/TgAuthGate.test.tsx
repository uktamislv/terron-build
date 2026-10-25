import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '@/auth/AuthProvider'
import * as authRepo from '@/data/authRepo'
import type { AuthSession } from '@/data/types'
import { t } from '@/i18n'
import { makeProfile } from '@/test/fixtures'
import { TgAuthGate } from './TgAuthGate'
import * as telegram from './telegram'

const auth = vi.hoisted(() => ({
  cb: null as null | ((s: AuthSession | null) => void),
  session: null as AuthSession | null,
}))

vi.mock('@/data/systemRepo', () => ({
  isConfigured: () => true,
  getSystemStatus: () => ({ supabaseConfigured: true }),
}))

vi.mock('@/data/authRepo', () => ({
  getSession: vi.fn(async () => auth.session),
  onAuthChange: vi.fn((cb: (s: AuthSession | null) => void) => {
    auth.cb = cb
    return () => undefined
  }),
  getMyProfile: vi.fn(),
  signOut: vi.fn(async () => undefined),
  signInWithPassword: vi.fn(),
  telegramSignIn: vi.fn(),
  clearLocalSession: vi.fn(async () => undefined),
}))

vi.mock('./telegram', () => ({
  isInsideTelegram: vi.fn(() => true),
  getInitData: vi.fn(() => 'query_id=1&hash=abc'),
  requestContact: vi.fn(async () => true),
  botLink: vi.fn(() => 'https://t.me/terron_test_bot'),
  initTelegram: vi.fn(),
  stripLaunchParamsFromUrl: vi.fn(),
  haptic: { tap: vi.fn(), success: vi.fn(), error: vi.fn(), select: vi.fn() },
}))

const repo = vi.mocked(authRepo)
const tg = vi.mocked(telegram)

/** tg-auth "ok" — server sessiya beradi, supabase onAuthChange orqali xabar qiladi. */
async function okSignIn() {
  auth.session = { userId: 'u-prorab', email: null, mustChangePassword: false }
  auth.cb?.(auth.session)
  return 'ok' as const
}

function renderGate(props: { pollIntervalMs?: number; pollTimeoutMs?: number } = {}) {
  render(
    <MemoryRouter>
      <AuthProvider>
        <TgAuthGate pollIntervalMs={10} pollTimeoutMs={200} {...props}>
          <p>ILOVA</p>
        </TgAuthGate>
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.cb = null
  auth.session = null
  tg.isInsideTelegram.mockReturnValue(true)
  tg.requestContact.mockResolvedValue(true)
  repo.getMyProfile.mockResolvedValue(makeProfile('prorab'))
})

describe('TgAuthGate', () => {
  it('Telegram tashqarisida — "Ilovani Telegram orqali oching" va bot havolasi', () => {
    tg.isInsideTelegram.mockReturnValue(false)
    renderGate()
    expect(screen.getByText(t.tg.gate.outsideTitle)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t.tg.gate.openBot })).toHaveAttribute('href', 'https://t.me/terron_test_bot')
    expect(repo.telegramSignIn).not.toHaveBeenCalled()
  })

  it('ok — initData serverga yuboriladi, profil yuklanib ilova ochiladi', async () => {
    repo.telegramSignIn.mockImplementation(okSignIn)
    renderGate()
    expect(await screen.findByText('ILOVA')).toBeInTheDocument()
    expect(repo.telegramSignIn).toHaveBeenCalledWith('query_id=1&hash=abc')
  })

  it('need_contact → raqam ulashiladi → polling → ok', async () => {
    repo.telegramSignIn
      .mockResolvedValueOnce('need_contact')
      .mockResolvedValueOnce('need_contact')
      .mockImplementation(okSignIn)
    renderGate()
    fireEvent.click(await screen.findByRole('button', { name: t.tg.gate.shareContact }))
    expect(tg.requestContact).toHaveBeenCalled()
    expect(await screen.findByText('ILOVA')).toBeInTheDocument()
    expect(repo.telegramSignIn).toHaveBeenCalledTimes(3)
  })

  it('need_contact → vaqt tugaydi → "Qayta urinish" va adminga murojaat', async () => {
    repo.telegramSignIn.mockResolvedValue('need_contact')
    renderGate({ pollIntervalMs: 10, pollTimeoutMs: 50 })
    fireEvent.click(await screen.findByRole('button', { name: t.tg.gate.shareContact }))
    expect(await screen.findByText(t.tg.gate.timeoutText)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.common.retry })).toBeInTheDocument()
    const calls = repo.telegramSignIn.mock.calls.length
    expect(calls).toBeGreaterThan(1)
    expect(calls).toBeLessThanOrEqual(6)
  })

  it('raqam ulashilmasa — ogohlantirish', async () => {
    repo.telegramSignIn.mockResolvedValue('need_contact')
    tg.requestContact.mockResolvedValue(false)
    renderGate()
    fireEvent.click(await screen.findByRole('button', { name: t.tg.gate.shareContact }))
    expect(await screen.findByText(t.tg.gate.declined)).toBeInTheDocument()
  })

  it('inactive — "Hisobingiz faol emas"', async () => {
    repo.telegramSignIn.mockResolvedValue('inactive')
    renderGate()
    expect(await screen.findByText(t.tg.gate.inactive)).toBeInTheDocument()
    expect(screen.queryByText('ILOVA')).not.toBeInTheDocument()
  })

  it('ok — URL’dan #tgWebAppData olib tashlanadi, mavjud sessiya tozalanmaydi', async () => {
    repo.telegramSignIn.mockImplementation(okSignIn)
    renderGate()
    await screen.findByText('ILOVA')
    expect(tg.stripLaunchParamsFromUrl).toHaveBeenCalled()
    expect(repo.clearLocalSession).not.toHaveBeenCalled()
  })

  it('server session: null qaytarsa (mavjud sessiya tasdiqlandi) — eski sessiya bilan ilova ochiladi', async () => {
    // telegramSignIn "ok", lekin onAuthChange hodisasi yo'q — sessiya avvaldan bor edi
    auth.session = { userId: 'u-prorab', email: null, mustChangePassword: false }
    repo.telegramSignIn.mockResolvedValue('ok')
    renderGate()
    expect(await screen.findByText('ILOVA')).toBeInTheDocument()
    expect(repo.clearLocalSession).not.toHaveBeenCalled()
  })

  it.each(['need_contact', 'invalid', 'inactive'] as const)('%s — qurilmadagi eski sessiya tozalanadi', async (status) => {
    auth.session = { userId: 'u-boshqa', email: null, mustChangePassword: false }
    repo.telegramSignIn.mockResolvedValue(status)
    renderGate()
    await vi.waitFor(() => expect(repo.clearLocalSession).toHaveBeenCalled())
    expect(screen.queryByText('ILOVA')).not.toBeInTheDocument()
    expect(tg.stripLaunchParamsFromUrl).not.toHaveBeenCalled()
  })

  it('profil yuklashda tarmoq xatosi — "Aloqa yo‘q", sessiya yopilmaydi', async () => {
    repo.getMyProfile.mockRejectedValue(new Error('Failed to fetch'))
    repo.telegramSignIn.mockImplementation(okSignIn)
    renderGate()
    expect(await screen.findByText(t.auth.offlineText)).toBeInTheDocument()
    expect(repo.signOut).not.toHaveBeenCalled()
  })

  it('invalid — "Qayta oching"', async () => {
    repo.telegramSignIn.mockResolvedValue('invalid')
    renderGate()
    expect(await screen.findByText(t.tg.gate.invalid)).toBeInTheDocument()
  })

  it('tarmoq xatosi — "Qayta urinish" qayta tekshiradi', async () => {
    repo.telegramSignIn.mockRejectedValueOnce(new Error('network')).mockImplementation(okSignIn)
    renderGate()
    const retry = await screen.findByRole('button', { name: t.common.retry })
    await act(async () => {
      fireEvent.click(retry)
    })
    expect(await screen.findByText('ILOVA')).toBeInTheDocument()
  })

  it('ok, lekin profil topilmadi — faol emas xabari', async () => {
    repo.getMyProfile.mockResolvedValue(null)
    repo.telegramSignIn.mockImplementation(okSignIn)
    renderGate()
    expect(await screen.findByText(t.tg.gate.inactive)).toBeInTheDocument()
  })
})
