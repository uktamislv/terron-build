// Batch 11 — veb: yon menyudagi "Xatolik haqida xabar berish" va "Yordam", admin "Xatolik xabarlari",
// qo'llanma ko'rinishi (lokal fixture bilan).
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext, type AuthState } from '@/auth/authContext'
import { GuideView } from '@/components/help/GuideView'
import { ToastProvider } from '@/components/ui'
import * as bugReportsRepo from '@/data/bugReportsRepo'
import type { BugReport } from '@/data/bugReportsRepo'
import { RepoError } from '@/data/errors'
import * as photosRepo from '@/data/photosRepo'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import type { RoleGuide } from '@/i18n/guides.uz'
import { formatDateTime } from '@/lib/format'
import { makeProfile } from '@/test/fixtures'
import { BugReportsList } from '../settings/BugReportsList'
import { WebLayout } from '../WebLayout'

vi.mock('@/data/bugReportsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/bugReportsRepo')>()),
  createBugReport: vi.fn(async () => undefined),
  listBugReports: vi.fn(),
  setBugReportStatus: vi.fn(async () => undefined),
}))
vi.mock('@/data/photosRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/photosRepo')>()),
  signedPhotoUrl: vi.fn(async () => 'https://signed.example/photo.jpg'),
  uploadPhoto: vi.fn(async () => 'c/bug/2026/10/x.jpg'),
}))

const tb = t.bugReports

function withAuth(role: Role, children: ReactNode, path = '/') {
  const value: AuthState = {
    configured: true,
    loading: false,
    session: { userId: 'u', email: null, mustChangePassword: false },
    profile: makeProfile(role),
    profileError: null,
    notice: null,
    clearNotice: () => undefined,
    signOut: async () => undefined,
    reloadProfile: () => undefined,
    refreshSession: async () => undefined,
  }
  return (
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider value={value}>
        <ToastProvider>{children}</ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

function report(over: Partial<BugReport>): BugReport {
  return {
    id: 'r1',
    company_id: 'c',
    created_by: 'p1',
    message: 'Saqlash bosilganda xato',
    screen: '/tg/movement',
    client: 'telegram android 8.0 · Chrome',
    app_version: '1',
    photo_path: null,
    status: 'yangi',
    created_at: '2026-10-20T15:05:00Z',
    updated_at: '2026-10-20T15:05:00Z',
    author_name: 'Ali Valiyev',
    author_role: 'prorab',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(bugReportsRepo.listBugReports).mockResolvedValue({
    rows: [report({}), report({ id: 'r2', status: 'hal_qilindi', photo_path: 'c/2026/10/x.jpg', author_name: null, author_role: null })],
    total: 2,
  })
})

describe('Yon menyu: Yordam va Xatolik haqida xabar', () => {
  it('har rolda (masalan direktor) — Yordam havolasi va xabar tugmasi; Sozlamalar modali yo‘q', () => {
    render(withAuth('direktor', <WebLayout>{null}</WebLayout>))
    expect(screen.getByRole('link', { name: t.help.open })).toHaveAttribute('href', '/help')
    expect(screen.getByRole('button', { name: t.bugReport.open })).toHaveClass('min-h-11')
    expect(screen.queryByRole('button', { name: t.settings.open })).not.toBeInTheDocument()
  })

  it('xabar yuboriladi: joriy ekran va "web" qurilma; rahmat', async () => {
    render(withAuth('buxgalter', <WebLayout>{null}</WebLayout>, '/cash'))
    fireEvent.click(screen.getByRole('button', { name: t.bugReport.open }))
    const dialog = await screen.findByRole('dialog', { name: t.bugReport.title })
    expect(within(dialog).getByText('/cash')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(t.bugReport.message), { target: { value: 'Excel yuklanmadi' } })
    fireEvent.click(within(dialog).getByRole('button', { name: t.bugReport.send }))
    expect(await within(dialog).findByText(t.bugReport.sent)).toBeInTheDocument()
    const sent = vi.mocked(bugReportsRepo.createBugReport).mock.calls[0]?.[0]
    expect(sent).toMatchObject({ message: 'Excel yuklanmadi', screen: '/cash' })
    expect(sent?.client).toMatch(/^web/)
    fireEvent.click(within(dialog).getAllByRole('button', { name: t.common.close }).at(-1) as HTMLElement)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('ixtiyoriy skrinshot — bug/ papkasiga yuklanadi; rasm xatosida qayta urinish', async () => {
    vi.mocked(photosRepo.uploadPhoto).mockRejectedValueOnce(new RepoError('photo_upload_failed'))
    render(withAuth('prorab', <WebLayout>{null}</WebLayout>, '/movements'))
    fireEvent.click(screen.getByRole('button', { name: t.bugReport.open }))
    const dialog = await screen.findByRole('dialog', { name: t.bugReport.title })
    fireEvent.change(within(dialog).getByLabelText(t.bugReport.message), { target: { value: 'Rasm bilan' } })
    fireEvent.change(within(dialog).getByLabelText(t.tg.movement.fromGallery), {
      target: { files: [new File(['x'], 'ekran.png', { type: 'image/png' })] },
    })
    await within(dialog).findByText('ekran.png')
    fireEvent.click(within(dialog).getByRole('button', { name: t.bugReport.send }))
    expect(await within(dialog).findByText(t.errors.photo_upload_failed)).toBeInTheDocument()
    expect(photosRepo.uploadPhoto).toHaveBeenCalledWith(expect.any(Blob), makeProfile('prorab').company_id, 'bug')
    expect(bugReportsRepo.createBugReport).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: t.common.retry }))
    expect(await within(dialog).findByText(t.bugReport.sent)).toBeInTheDocument()
    expect(vi.mocked(bugReportsRepo.createBugReport).mock.calls[0]?.[0].photoPath).toBe('c/bug/2026/10/x.jpg')
  })
})

describe('Admin: Xatolik xabarlari', () => {
  it('kim, rol, vaqt (Toshkent), ekran; holat filtri', async () => {
    render(withAuth('admin', <BugReportsList />))
    const items = await screen.findAllByTestId('bug-report')
    expect(items).toHaveLength(2)
    const first = within(items[0] as HTMLElement)
    expect(first.getByText('Ali Valiyev')).toBeInTheDocument()
    expect(first.getByText(t.roles.prorab)).toBeInTheDocument()
    expect(formatDateTime('2026-10-20T15:05:00Z')).toBe('20.10.2026 20:05')
    expect(first.getByText('20.10.2026 20:05')).toBeInTheDocument()
    expect(first.getByText('/tg/movement')).toBeInTheDocument()
    expect(within(items[1] as HTMLElement).getByText(tb.unknownAuthor)).toBeInTheDocument()
    expect(bugReportsRepo.listBugReports).toHaveBeenLastCalledWith({}, 0)

    const filters = screen.getByRole('group', { name: tb.statusFilter })
    fireEvent.click(within(filters).getByRole('button', { name: tb.statuses.yangi }))
    await waitFor(() => expect(bugReportsRepo.listBugReports).toHaveBeenLastCalledWith({ status: 'yangi' }, 0))
    expect(within(filters).getByRole('button', { name: tb.statuses.yangi })).toHaveAttribute('aria-pressed', 'true')
  })

  it('holatni o‘zgartirish: Ko‘rildi / Hal qilindi / Qayta ochish', async () => {
    render(withAuth('admin', <BugReportsList />))
    const items = await screen.findAllByTestId('bug-report')
    const first = within(items[0] as HTMLElement)
    expect(first.getByRole('button', { name: tb.markResolved })).toBeInTheDocument()
    fireEvent.click(first.getByRole('button', { name: tb.markSeen }))
    await waitFor(() => expect(bugReportsRepo.setBugReportStatus).toHaveBeenCalledWith('r1', 'korildi'))
    await waitFor(() => expect(bugReportsRepo.listBugReports).toHaveBeenCalledTimes(2))
    const second = within((await screen.findAllByTestId('bug-report'))[1] as HTMLElement)
    expect(second.queryByRole('button', { name: tb.markSeen })).not.toBeInTheDocument()
    fireEvent.click(second.getByRole('button', { name: tb.reopen }))
    await waitFor(() => expect(bugReportsRepo.setBugReportStatus).toHaveBeenCalledWith('r2', 'yangi'))
  })

  it('rasm — vaqtinchalik (signed) havola orqali', async () => {
    render(withAuth('admin', <BugReportsList />))
    const items = await screen.findAllByTestId('bug-report')
    expect(within(items[0] as HTMLElement).queryByRole('button', { name: tb.showPhoto })).not.toBeInTheDocument()
    fireEvent.click(within(items[1] as HTMLElement).getByRole('button', { name: tb.showPhoto }))
    const dialog = await screen.findByRole('dialog', { name: tb.photoTitle })
    expect(await within(dialog).findByRole('img', { name: tb.photoTitle })).toHaveAttribute('src', 'https://signed.example/photo.jpg')
    expect(photosRepo.signedPhotoUrl).toHaveBeenCalledWith('c/2026/10/x.jpg')
  })

  it('bo‘sh ro‘yxat', async () => {
    vi.mocked(bugReportsRepo.listBugReports).mockResolvedValue({ rows: [], total: 0 })
    render(withAuth('admin', <BugReportsList />))
    expect(await screen.findByText(tb.empty)).toBeInTheDocument()
  })
})

const fixtureGuide = (name: string): RoleGuide => ({
  title: `${name} uchun qo‘llanma`,
  intro: `${name} vazifasi`,
  daily: [{ title: 'Ertalab', steps: [`${name} 1-qadam`, `${name} 2-qadam`] }],
  rules: [`${name} qoidasi`],
  alerts: [{ name: 'Narx og‘ishi', meaning: 'Narx yuqori', whatToDo: 'Chekni tekshiring' }],
  help: 'Adminga yozing',
})

describe('Qo‘llanma ko‘rinishi (fixture)', () => {
  const fixture: Partial<Record<Role, RoleGuide>> = {
    super_admin: fixtureGuide('Tizim egasi'),
    admin: fixtureGuide('Admin'),
    prorab: fixtureGuide('Prorab'),
  }

  it('o‘z roli; bo‘limlar; boshqa rolga o‘tish; tizim egasi yashirin', () => {
    render(<GuideView guides={fixture} currentRole="prorab" />)
    expect(screen.getByRole('heading', { name: 'Prorab uchun qo‘llanma' })).toBeInTheDocument()
    expect(screen.getByText('Prorab 2-qadam')).toBeInTheDocument()
    expect(screen.getByText('Chekni tekshiring')).toBeInTheDocument()
    const group = screen.getByRole('group', { name: t.help.roleSwitch })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([t.roles.admin, `${t.roles.prorab}(${t.help.yourRole})`])
    expect(group).toHaveClass('print:hidden')
    fireEvent.click(within(group).getByRole('button', { name: t.roles.admin }))
    expect(screen.getByRole('heading', { name: 'Admin uchun qo‘llanma' })).toBeInTheDocument()
    expect(document.querySelector('.guide-print')).not.toBeNull()
  })

  it('qo‘llanmasi yo‘q rol — "hali tayyor emas"', () => {
    render(<GuideView guides={fixture} currentRole="haydovchi" />)
    expect(screen.getByText(t.help.unavailable)).toBeInTheDocument()
  })
})
