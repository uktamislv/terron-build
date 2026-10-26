import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import * as authRepo from '@/data/authRepo'
import * as materialsRepo from '@/data/materialsRepo'
import * as movementsRepo from '@/data/movementsRepo'
import * as objectsRepo from '@/data/objectsRepo'
import * as stockRepo from '@/data/stockRepo'
import type { Movement } from '@/data/types'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { makeMaterial, makeObject, makeProfile } from '@/test/fixtures'
import { textOf } from '@/test/text'

vi.mock('@/data/systemRepo', () => ({
  isConfigured: () => true,
  getSystemStatus: () => ({ supabaseConfigured: true }),
}))
vi.mock('@/data/authRepo', () => ({
  getSession: vi.fn(async () => ({ userId: 'u-admin', email: 'admin@firma.uz', mustChangePassword: false })),
  onAuthChange: vi.fn(() => () => undefined),
  getMyProfile: vi.fn(),
  signOut: vi.fn(async () => undefined),
  signInWithPassword: vi.fn(),
  telegramSignIn: vi.fn(),
  clearLocalSession: vi.fn(async () => undefined),
  changePassword: vi.fn(),
  MIN_PASSWORD_LENGTH: 8,
}))
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn() }))
vi.mock('@/data/materialsRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/materialsRepo')>()),
  listMaterials: vi.fn(),
}))
// Admin bo'lmaganlar boshqa xodimlar ismini profile_directory dan oladi (docs/audit-fixes.md)
vi.mock('@/data/profileDirectory', async (orig) => {
  // Funksiya — fixtures import qilingandan keyin chaqiriladi (vi.mock yuqoriga ko'tariladi)
  const people = () => [makeProfile('prorab')]
  return {
    ...(await orig<typeof import('@/data/profileDirectory')>()),
    listDirectory: vi.fn(async () => people()),
    listActiveDirectory: vi.fn(async () => people()),
  }
})
vi.mock('@/data/movementsRepo', () => ({
  listMovements: vi.fn(),
  softDeleteMovement: vi.fn(async () => undefined),
  restoreMovement: vi.fn(async () => undefined),
  MOVEMENTS_PAGE_SIZE: 50,
}))
vi.mock('@/data/stockRepo', () => ({ listStock: vi.fn(), getStock: vi.fn() }))
vi.mock('@/data/photosRepo', () => ({ signedPhotoUrl: vi.fn() }))

const to = t.ombor

const row: Movement = {
  id: 'mv1',
  company_id: 'c',
  type: 'kirim',
  object_id: 'o-a',
  material_id: 'm-sem',
  unit_id: 'u-qop',
  qty_input: '3',
  unit_input: 'qop',
  unit_variant: null,
  qty_base: '150',
  purchase_id: null,
  photo_path: null,
  occurred_at: '2026-10-25T05:00:00Z',
  note: 'mashina 01A',
  created_by: 'p-prorab',
  created_at: '2026-10-25T05:00:00Z',
  deleted_at: null,
  object_name: 'Obyekt A',
  material_name: 'Sement',
  base_unit: 'kg',
  created_by_name: 'Test prorab',
}

function mockMobile() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  })
}

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('admin'))
  vi.mocked(objectsRepo.listObjects).mockResolvedValue([makeObject('o-a', 'Obyekt A'), makeObject('o-b', 'Obyekt B')])
  vi.mocked(materialsRepo.listMaterials).mockResolvedValue([
    makeMaterial('m-sem', 'Sement', 'kg'),
    makeMaterial('m-qum', 'Qum', 'm³'),
  ])
  vi.mocked(movementsRepo.listMovements).mockResolvedValue({ rows: [row], total: 1 })
  vi.mocked(stockRepo.listStock).mockResolvedValue([
    { company_id: 'c', object_id: 'o-a', material_id: 'm-sem', qty_base: '420', last_movement_at: '2026-10-25T05:00:00Z' },
    { company_id: 'c', object_id: 'o-b', material_id: 'm-qum', qty_base: '-2.5', last_movement_at: null },
  ])
})

function open() {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/movements'] })} />)
}

/** Jadval qatori "⋯" menyusidan amal tanlash. */
function rowAction(scope: HTMLElement, name: string, index = 0) {
  fireEvent.click(within(scope).getAllByRole('button', { name: t.ui.actions })[index]!)
  fireEvent.click(within(scope).getByRole('menuitem', { name }))
}

const lastFilters = () => vi.mocked(movementsRepo.listMovements).mock.lastCall

describe('/movements — Harakatlar', () => {
  it('jadval va filtrlar: obyekt, tur, sana (Toshkent kuni), sahifa 0 ga qaytadi', async () => {
    open()
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Sement')).toBeInTheDocument()
    expect(within(table).getByText(textOf('3 qop'))).toBeInTheDocument()
    expect(within(table).getByText(textOf('150 kg'))).toBeInTheDocument()
    expect(lastFilters()).toEqual([expect.objectContaining({ objectId: undefined }), 0])

    const filters = within(screen.getByRole('form', { name: to.filters }))
    await waitFor(() => expect(filters.getAllByRole('option', { name: 'Obyekt B' })).toHaveLength(1))
    fireEvent.change(filters.getByLabelText(to.filterObject), { target: { value: 'o-b' } })
    fireEvent.change(filters.getByLabelText(to.filterType), { target: { value: 'chiqim' } })
    fireEvent.change(filters.getByLabelText(to.filterFrom), { target: { value: '2026-10-20' } })
    fireEvent.change(filters.getByLabelText(to.filterTo), { target: { value: '2026-10-25' } })

    await waitFor(() =>
      expect(lastFilters()).toEqual([
        expect.objectContaining({
          objectId: 'o-b',
          type: 'chiqim',
          from: '2026-10-19T19:00:00.000Z',
          to: '2026-10-25T19:00:00.000Z',
        }),
        0,
      ]),
    )
  })

  it('admin o‘chiradi (tasdiq bilan)', async () => {
    open()
    const table = await screen.findByRole('table')
    // Qatorda ochiq "O'chirish" tugmasi yo'q — faqat "⋯" menyusida
    expect(within(table).queryByRole('button', { name: to.delete })).not.toBeInTheDocument()
    rowAction(table, to.delete)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t.common.yes }))
    await waitFor(() => expect(movementsRepo.softDeleteMovement).toHaveBeenCalledWith('mv1'))
  })

  it('oxirgi sahifadagi yagona qator o‘chirilsa — oldingi sahifa', async () => {
    vi.mocked(movementsRepo.listMovements).mockImplementation(async (_f, page = 0) =>
      page === 0
        ? { rows: Array.from({ length: 50 }, (_, i) => ({ ...row, id: `r${i}` })), total: 51 }
        : { rows: [row], total: 51 },
    )
    open()
    fireEvent.click(await screen.findByRole('button', { name: to.next }))
    await waitFor(() => expect(lastFilters()?.[1]).toBe(1))
    const table = await screen.findByRole('table')
    await waitFor(() => expect(within(table).getAllByRole('button', { name: t.ui.actions })).toHaveLength(1))
    rowAction(table, to.delete)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t.common.yes }))
    await waitFor(() => expect(movementsRepo.softDeleteMovement).toHaveBeenCalledWith('mv1'))
    await waitFor(() => expect(lastFilters()?.[1]).toBe(0))
  })

  it('direktor — o‘chirilganlarni ko‘radi, lekin o‘chirish/tiklash yo‘q', async () => {
    vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('direktor'))
    vi.mocked(movementsRepo.listMovements).mockResolvedValue({
      rows: [row, { ...row, id: 'mv2', deleted_at: '2026-10-25T06:00:00Z' }],
      total: 2,
    })
    open()
    const table = await screen.findByRole('table')
    fireEvent.click(screen.getByLabelText(to.filterDeleted))
    await waitFor(() => expect(lastFilters()?.[0]).toMatchObject({ includeDeleted: true }))
    expect(within(table).getByText(t.movements.deleted)).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: to.delete })).not.toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: to.restore })).not.toBeInTheDocument()
    // Rasm yo'q va o'chirish/tiklash huquqi yo'q — "⋯" menyusida faqat "Tarix" (Batch 10)
    fireEvent.click(within(table).getAllByRole('button', { name: t.ui.actions })[0]!)
    expect(within(table).getAllByRole('menuitem').map((el) => el.textContent)).toEqual([t.history.link])
    fireEvent.click(within(table).getByRole('menuitem', { name: t.history.link }))
    expect(await screen.findByRole('heading', { name: t.history.title })).toBeInTheDocument()
  })

  it('prorab — o‘chirish tugmasi yo‘q', async () => {
    vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('prorab'))
    open()
    const table = await screen.findByRole('table')
    expect(within(table).queryByRole('button', { name: to.delete })).not.toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: t.ui.actions })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(to.filterDeleted)).not.toBeInTheDocument()
  })

  it('telefonda — kartochkada tugma yo‘q; qator bosilsa tafsilot varag‘i, o‘chirish o‘sha yerda (tasdiq bilan)', async () => {
    mockMobile()
    open()
    const list = await screen.findByRole('list', { name: to.tabMovements })
    expect(within(list).queryByRole('button', { name: to.delete })).not.toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: /Sement/ }))
    const sheet = screen.getByRole('dialog', { name: 'Sement' })
    expect(sheet).toHaveTextContent('3 qop')
    expect(sheet).toHaveTextContent('150 kg')
    fireEvent.click(within(sheet).getByRole('button', { name: to.delete }))
    fireEvent.click(within(screen.getByRole('dialog', { name: to.delete })).getByRole('button', { name: t.common.yes }))
    await waitFor(() => expect(movementsRepo.softDeleteMovement).toHaveBeenCalledWith('mv1'))
  })
})

describe('/movements — Qoldiq', () => {
  it('manfiy qoldiq qizil, nomlar katalogdan', async () => {
    open()
    fireEvent.click(await screen.findByRole('tab', { name: to.tabStock }))
    await waitFor(() => expect(screen.getAllByTestId('stock-qty')).toHaveLength(2))
    const cells = screen.getAllByTestId('stock-qty')
    expect(cells[0]).toHaveTextContent('420 kg')
    expect(cells[0]).not.toHaveClass('text-danger')
    expect(cells[1]).toHaveTextContent('−2,5 m³')
    expect(cells[1]).toHaveClass('text-danger')

    fireEvent.change(screen.getByLabelText(to.filterObject), { target: { value: 'o-b' } })
    await waitFor(() => expect(stockRepo.listStock).toHaveBeenLastCalledWith({ objectId: 'o-b' }))
  })
})
