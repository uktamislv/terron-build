import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as authRepo from '@/data/authRepo'
import * as membersRepo from '@/data/objectMembersRepo'
import * as profilesRepo from '@/data/profilesRepo'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { COMPANY_ID, makeObject, makeProfile } from '@/test/fixtures'

vi.mock('@/data/systemRepo', () => ({
  isConfigured: () => true,
  getSystemStatus: () => ({ supabaseConfigured: true }),
}))

vi.mock('@/data/authRepo', () => ({
  getSession: vi.fn(async () => ({ userId: 'u-admin', email: 'admin@firma.uz' })),
  onAuthChange: vi.fn(() => () => undefined),
  getMyProfile: vi.fn(),
  signOut: vi.fn(async () => undefined),
  signInWithPassword: vi.fn(),
  telegramSignIn: vi.fn(),
  clearLocalSession: vi.fn(async () => undefined),
  changePassword: vi.fn(),
  MIN_PASSWORD_LENGTH: 8,
}))

vi.mock('@/data/profilesRepo', () => ({
  listProfiles: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  setProfileActive: vi.fn(),
}))
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn(async () => [makeObject('o1', 'Chilonzor 5')]) }))
vi.mock('@/data/objectMembersRepo', () => ({
  listObjectMembers: vi.fn(async () => []),
  syncProfileObjects: vi.fn(async () => undefined),
}))

const admin = makeProfile('admin', { full_name: 'Admin Adminov' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(admin)
  vi.mocked(profilesRepo.listProfiles).mockResolvedValue([
    admin,
    makeProfile('prorab', { id: 'p2', full_name: 'Karim Prorab', phone: '+998911112233', telegram_user_id: 555 }),
  ])
})

async function openAddForm() {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/users'] })} />)
  expect(await screen.findByText('Karim Prorab')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: t.users.add }))
  return within(await screen.findByRole('dialog'))
}

describe('/users — foydalanuvchi qo‘shish formasi', () => {
  it('ro‘yxat: telefon formatlangan, Telegram holati', async () => {
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/users'] })} />)
    expect(await screen.findByText('+998 91 111 22 33')).toBeInTheDocument()
    expect(screen.getByText(t.users.linked)).toBeInTheDocument()
  })

  it('bo‘sh forma — xatolar, repo chaqirilmaydi', async () => {
    const dialog = await openAddForm()
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    expect(await dialog.findByText(t.users.errName)).toBeInTheDocument()
    expect(dialog.getByText(t.users.errPhone)).toBeInTheDocument()
    expect(dialog.getByText(t.users.errRole)).toBeInTheDocument()
    expect(profilesRepo.createProfile).not.toHaveBeenCalled()
  })

  it('super_admin roli tanlovda yo‘q', async () => {
    const dialog = await openAddForm()
    expect(dialog.queryByLabelText(t.roles.super_admin)).not.toBeInTheDocument()
    expect(dialog.getByLabelText(t.roles.admin)).toBeInTheDocument()
  })

  it('prorab — obyekt tanlanmasa xato, tanlansa saqlanadi', async () => {
    vi.mocked(profilesRepo.createProfile).mockResolvedValue(makeProfile('prorab', { id: 'new' }))
    const dialog = await openAddForm()
    fireEvent.change(dialog.getByLabelText(t.users.fullName), { target: { value: 'Yangi Prorab' } })
    fireEvent.change(dialog.getByLabelText(t.users.phone), { target: { value: '90 765 43 21' } })
    fireEvent.click(dialog.getByLabelText(t.roles.prorab))
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    expect(await dialog.findByText(t.users.errObjects)).toBeInTheDocument()
    expect(profilesRepo.createProfile).not.toHaveBeenCalled()

    fireEvent.click(dialog.getByLabelText('Chilonzor 5'))
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    await waitFor(() =>
      expect(profilesRepo.createProfile).toHaveBeenCalledWith({
        companyId: COMPANY_ID,
        fullName: 'Yangi Prorab',
        phone: '+998907654321',
        role: 'prorab',
      }),
    )
    await waitFor(() => expect(membersRepo.syncProfileObjects).toHaveBeenCalledWith(COMPANY_ID, 'new', ['o1'], []))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('telefon band — tushunarli xato', async () => {
    const { RepoError } = await import('@/data/errors')
    vi.mocked(profilesRepo.createProfile).mockRejectedValue(new RepoError('phone_taken'))
    const dialog = await openAddForm()
    fireEvent.change(dialog.getByLabelText(t.users.fullName), { target: { value: 'Ali' } })
    fireEvent.change(dialog.getByLabelText(t.users.phone), { target: { value: '+998901112233' } })
    fireEvent.click(dialog.getByLabelText(t.roles.buxgalter))
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    expect(await dialog.findByText(t.errors.phone_taken)).toBeInTheDocument()
  })
})

function renderUsers() {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/users'] })} />)
}

function card(name: string) {
  const list = within(screen.getByRole('list', { name: t.users.title }))
  return within(list.getByText(name).closest('li') as HTMLElement)
}

describe('/users — login_kind va login tugmasi', () => {
  beforeEach(() => {
    vi.mocked(profilesRepo.listProfiles).mockResolvedValue([
      admin,
      makeProfile('admin', { id: 'a2', full_name: 'Ikkinchi Admin', phone: '+998900000002' }),
      makeProfile('buxgalter', { id: 'b1', full_name: 'Veb Buxgalter', login_kind: 'web' }),
      makeProfile('haydovchi', { id: 'h1', full_name: 'Tg Haydovchi', login_kind: 'tg', telegram_user_id: 7 }),
      makeProfile('omborchi', { id: 'o1', full_name: 'Yangi Omborchi', login_kind: 'none', auth_user_id: null }),
    ])
  })

  it('ustun: web → Bor, tg → Faqat Telegram, none → Yo‘q; tugma matni login_kind bo‘yicha', async () => {
    renderUsers()
    await screen.findByText('Veb Buxgalter')
    expect(card('Veb Buxgalter').getByText(t.users.hasLogin)).toBeInTheDocument()
    expect(card('Veb Buxgalter').getByRole('button', { name: t.users.resetPassword })).toBeInTheDocument()
    expect(card('Tg Haydovchi').getByText(t.users.tgOnly)).toBeInTheDocument()
    expect(card('Tg Haydovchi').getByRole('button', { name: t.users.setLogin })).toBeInTheDocument()
    expect(card('Yangi Omborchi').getByText(t.users.noLogin)).toBeInTheDocument()
    expect(card('Yangi Omborchi').getByRole('button', { name: t.users.setLogin })).toBeInTheDocument()
  })

  it('admin boshqa admin login/parolini o‘zgartira olmaydi, o‘zinikini — mumkin', async () => {
    renderUsers()
    await screen.findByText('Ikkinchi Admin')
    const other = card('Ikkinchi Admin')
    expect(other.queryByRole('button', { name: t.users.resetPassword })).not.toBeInTheDocument()
    expect(other.queryByRole('button', { name: t.users.setLogin })).not.toBeInTheDocument()
    expect(card('Admin Adminov').getByRole('button', { name: t.users.resetPassword })).toBeInTheDocument()
  })

  it('o‘z profilida telefon maydoni o‘chirilgan, izoh bilan', async () => {
    vi.mocked(profilesRepo.updateProfile).mockResolvedValue(admin)
    renderUsers()
    await screen.findByText('Admin Adminov')
    fireEvent.click(card('Admin Adminov').getByRole('button', { name: t.common.edit }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByLabelText(t.users.phone)).toBeDisabled()
    // Admin profili himoyalangan (profile_protected) — telefon va rol faqat tizim egasida
    expect(dialog.getByText(t.users.protectedHint)).toBeInTheDocument()
    expect(dialog.getByTestId('role-locked')).toHaveTextContent(t.roles.admin)
    fireEvent.change(dialog.getByLabelText(t.users.fullName), { target: { value: 'Admin Yangi' } })
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    await waitFor(() => expect(profilesRepo.updateProfile).toHaveBeenCalledWith(admin.id, { fullName: 'Admin Yangi' }))
  })
})

describe('/users — atomar bo‘lmagan qo‘shishdan tiklanish', () => {
  it('obyektlar biriktirilmasa — xabar; qayta saqlash faqat sinxronlaydi', async () => {
    vi.mocked(profilesRepo.createProfile).mockResolvedValue(makeProfile('prorab', { id: 'new' }))
    vi.mocked(membersRepo.syncProfileObjects).mockRejectedValueOnce(new Error('network'))
    const dialog = await openAddForm()
    fireEvent.change(dialog.getByLabelText(t.users.fullName), { target: { value: 'Yangi Prorab' } })
    fireEvent.change(dialog.getByLabelText(t.users.phone), { target: { value: '90 765 43 21' } })
    fireEvent.click(dialog.getByLabelText(t.roles.prorab))
    fireEvent.click(dialog.getByLabelText('Chilonzor 5'))
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    expect(await dialog.findByText(t.users.partialCreate)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: t.users.editTitle })).toBeInTheDocument()
    expect(dialog.getByLabelText(t.users.phone)).toBeDisabled()

    vi.mocked(membersRepo.listObjectMembers).mockClear()
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    await waitFor(() => expect(membersRepo.syncProfileObjects).toHaveBeenCalledTimes(2))
    expect(membersRepo.listObjectMembers).toHaveBeenCalled()
    expect(membersRepo.syncProfileObjects).toHaveBeenLastCalledWith(COMPANY_ID, 'new', ['o1'], [])
    expect(profilesRepo.createProfile).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
