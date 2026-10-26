import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import * as authRepo from '@/data/authRepo'
import * as inventoryRepo from '@/data/inventoryRepo'
import * as materialsRepo from '@/data/materialsRepo'
import * as normsRepo from '@/data/normsRepo'
import * as objectsRepo from '@/data/objectsRepo'
import * as stockRepo from '@/data/stockRepo'
import * as transfersRepo from '@/data/transfersRepo'
import type { InventoryCount, InventoryCountItem, Transfer } from '@/data/types'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { makeMaterial, makeObject, makeProfile, makeUnit } from '@/test/fixtures'

vi.mock('@/data/systemRepo', () => ({
  isConfigured: () => true,
  getSystemStatus: () => ({ supabaseConfigured: true }),
}))
vi.mock('@/data/authRepo', () => ({
  getSession: vi.fn(async () => ({ userId: 'u1', email: null, mustChangePassword: false })),
  onAuthChange: vi.fn(() => () => undefined),
  getMyProfile: vi.fn(),
  signOut: vi.fn(async () => undefined),
  signInWithPassword: vi.fn(),
  telegramSignIn: vi.fn(async () => 'ok'),
  clearLocalSession: vi.fn(async () => undefined),
}))
vi.mock('@/tg/telegram', () => ({
  isInsideTelegram: () => true,
  getWebApp: () => null,
  getInitData: () => 'init',
  requestContact: vi.fn(),
  botLink: () => 'https://t.me/x',
  initTelegram: vi.fn(),
  stripLaunchParamsFromUrl: vi.fn(),
  haptic: { tap: vi.fn(), success: vi.fn(), error: vi.fn(), select: vi.fn() },
}))
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn() }))
vi.mock('@/data/materialsRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/materialsRepo')>()),
  listMaterials: vi.fn(),
}))
vi.mock('@/data/movementsRepo', () => ({ createMovement: vi.fn(), listMyMovements: vi.fn(async () => []) }))
vi.mock('@/data/openPurchasesRepo', () => ({ listOpenPurchases: vi.fn(async () => []) }))
vi.mock('@/data/usageRepo', () => ({ getMyMaterialUsage: vi.fn(async () => []) }))
vi.mock('@/data/stockRepo', () => ({ getStock: vi.fn(async () => '0'), listStock: vi.fn(async () => []) }))
vi.mock('@/data/normsRepo', () => ({ listNormUsage: vi.fn(async () => []), getNormUsage: vi.fn(async () => null) }))
vi.mock('@/data/transfersRepo', () => ({
  listIncomingTransfers: vi.fn(async () => []),
  receiveTransfer: vi.fn(async () => undefined),
  listMyTransfers: vi.fn(async () => []),
}))
vi.mock('@/data/inventoryRepo', () => ({
  listCounts: vi.fn(async () => ({ rows: [], total: 0 })),
  createCount: vi.fn(),
  listCountItems: vi.fn(async () => []),
  saveCountItem: vi.fn(),
  submitCount: vi.fn(),
  listCandidateMaterials: vi.fn(),
}))

const ti = t.tg.incoming
const tinv = t.tg.inventory
const tm = t.tg.movement

const sement = makeMaterial('m-sem', 'Sement', 'kg', { units: [makeUnit('u-qop', 'm-sem', 'qop', '50')] })
const qum = makeMaterial('m-qum', 'Qum', 'm³')
const objA = makeObject('o-a', 'Obyekt A')

const incoming: Transfer = {
  id: 'tr1',
  company_id: 'c',
  from_object_id: 'o-x',
  to_object_id: 'o-a',
  material_id: 'm-sem',
  unit_id: 'u-qop',
  qty_input: '10',
  unit_input: 'qop',
  unit_variant: null,
  qty_base: '500',
  status: 'yuborildi',
  received_qty_base: null,
  received_at: null,
  received_by: null,
  cancel_reason: null,
  note: null,
  created_by: 'p-other',
  created_at: '2026-10-25T05:00:00Z',
  deleted_at: null,
  from_object_name: null,
  to_object_name: 'Obyekt A',
  material_name: 'Sement',
  base_unit: 'kg',
  created_by_name: 'Boshqa prorab',
}

function open(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.mocked(objectsRepo.listObjects).mockResolvedValue([objA])
  vi.mocked(materialsRepo.listMaterials).mockResolvedValue([sement, qum])
})

describe('/tg/movement — kelayotgan o‘tkazmalar', () => {
  beforeEach(() => {
    vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('omborchi'))
    vi.mocked(transfersRepo.listIncomingTransfers).mockResolvedValue([incoming])
  })

  it('banner → ro‘yxat → qabul: miqdor standart — yuborilgan, o‘zgarmasa null yuboriladi', async () => {
    open('/tg/movement')
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(ti.banner(1).replace(/[()]/g, '\\$&')) }))
    expect(transfersRepo.listIncomingTransfers).toHaveBeenCalledWith(['o-a'])
    const list = await screen.findByRole('list', { name: ti.title })
    // Boshqa obyekt nomi RLS tufayli ko'rinmaydi
    expect(within(list).getByText(new RegExp(ti.otherObject))).toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button'))

    const input = screen.getByLabelText(ti.receivedQty)
    // Bo'sh boshlanadi — bo'sh holda yuborilmaydi
    expect(input).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: ti.receive }))
    expect(await screen.findByText(tm.errors.qty.required)).toBeInTheDocument()
    expect(transfersRepo.receiveTransfer).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: ti.allArrived('10 qop') }))
    expect(input).toHaveValue('10')
    expect(screen.queryByText(ti.diffWarn)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ti.receive }))
    await waitFor(() => expect(transfersRepo.receiveTransfer).toHaveBeenCalledWith('tr1', null, ''))
    expect(await screen.findByText(ti.received('10', 'qop', 'Sement'), { exact: false })).toBeInTheDocument()
  })

  it('miqdor farq qilsa — "Farq direktorga xabar qilinadi", kiritilgan miqdor yuboriladi', async () => {
    open('/tg/movement')
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(ti.banner(1).replace(/[()]/g, '\\$&')) }))
    fireEvent.click(within(await screen.findByRole('list', { name: ti.title })).getByRole('button'))
    fireEvent.change(screen.getByLabelText(ti.receivedQty), { target: { value: '9,5' } })
    expect(screen.getByText(ti.diffWarn)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ti.receive }))
    await waitFor(() => expect(transfersRepo.receiveTransfer).toHaveBeenCalledWith('tr1', '9.5', ''))
  })

  it('kelayotgan o‘tkazma yo‘q — banner ko‘rinmaydi', async () => {
    vi.mocked(transfersRepo.listIncomingTransfers).mockResolvedValue([])
    open('/tg/movement')
    await screen.findByRole('region', { name: tm.chooseMaterial })
    expect(screen.queryByText(new RegExp(ti.title))).not.toBeInTheDocument()
  })
})

describe('/tg/inventory', () => {
  const count: InventoryCount = {
    id: 'ic1',
    company_id: 'c',
    object_id: 'o-a',
    status: 'draft',
    counted_at: '2026-10-25T05:00:00Z',
    note: null,
    applied_at: null,
    applied_by: null,
    created_by: 'p-tekshiruvchi',
    created_at: '2026-10-25T05:00:00Z',
    updated_at: '2026-10-25T05:00:00Z',
    object_name: 'Obyekt A',
    created_by_name: 'Test tekshiruvchi',
    item_count: 0,
  }
  const item = (overrides: Partial<InventoryCountItem> = {}): InventoryCountItem => ({
    id: 'it1',
    inventory_count_id: 'ic1',
    material_id: 'm-sem',
    qty_counted: '150',
    qty_expected: null,
    qty_input: '3',
    unit_id: 'u-qop',
    updated_at: '2026-10-25T05:00:00Z',
    material_name: 'Sement',
    base_unit: 'kg',
    ...overrides,
  })

  beforeEach(() => {
    vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('tekshiruvchi'))
    vi.mocked(inventoryRepo.createCount).mockResolvedValue(count)
    vi.mocked(inventoryRepo.listCounts).mockResolvedValue({ rows: [], total: 0 })
    vi.mocked(inventoryRepo.listCountItems).mockResolvedValue([])
    vi.mocked(inventoryRepo.listCandidateMaterials).mockResolvedValue(['m-sem', 'm-qum'])
    vi.mocked(inventoryRepo.submitCount).mockResolvedValue({ hasShortage: true, notCountedCount: 1 })
  })

  it('yangi sanash → miqdor + birlik (kutilgan ko‘rsatilmaydi) → darhol saqlanadi → yakunlash tasdig‘i → natija', async () => {
    vi.mocked(inventoryRepo.saveCountItem).mockResolvedValue(item())
    open('/tg/inventory')
    fireEvent.click(await screen.findByRole('button', { name: tinv.newCount }))
    await waitFor(() => expect(inventoryRepo.createCount).toHaveBeenCalledWith(expect.objectContaining({ objectId: 'o-a' })))

    // Obyektdagi material (qoldig'i bor) — ro'yxatda, lekin qoldiq raqami hech qayerda yo'q
    const grid = await screen.findByRole('region', { name: tm.chooseMaterial })
    await waitFor(() => expect(within(grid).getByRole('button', { name: /Sement/ })).toBeInTheDocument())
    expect(screen.getByTestId('counted-count')).toHaveTextContent(tinv.counted(0))

    fireEvent.click(within(grid).getByRole('button', { name: /Sement/ }))
    fireEvent.click(screen.getByRole('button', { name: 'qop' }))
    fireEvent.change(screen.getByLabelText(tinv.qty), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: tinv.save }))
    await waitFor(() =>
      expect(inventoryRepo.saveCountItem).toHaveBeenCalledWith(
        expect.objectContaining({ countId: 'ic1', materialId: 'm-sem', unitId: 'u-qop', qtyInput: '3', exists: false }),
      ),
    )
    expect(await screen.findByTestId('counted-count')).toHaveTextContent(tinv.counted(1))
    expect(screen.getByText(tinv.countedMark)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: tinv.finish }))
    const dialog = await screen.findByRole('dialog', { name: tinv.confirmTitle })
    expect(within(dialog).getByText(tinv.confirmText(1))).toBeInTheDocument()
    // Obyektdagi Qum sanalmagan — ogohlantirish
    expect(within(dialog).getByTestId('not-counted')).toHaveTextContent(tinv.notCounted(1))
    expect(within(dialog).getByText(tinv.notCountedWarn)).toBeInTheDocument()

    // Yakunlangandan keyin: kamomad bor (raqamlar ko'rsatilmaydi)
    fireEvent.click(within(dialog).getByRole('button', { name: tinv.confirm }))
    await waitFor(() => expect(inventoryRepo.submitCount).toHaveBeenCalledWith('ic1'))
    expect(await screen.findByTestId('inventory-result')).toHaveTextContent(tinv.resultShortage)
    // Ko'r-ko'rona: qoldiq, harakatlar va norma umuman so'ralmaydi
    expect(stockRepo.listStock).not.toHaveBeenCalled()
    expect(stockRepo.getStock).not.toHaveBeenCalled()
    expect(normsRepo.listNormUsage).not.toHaveBeenCalled()
    expect(inventoryRepo.listCandidateMaterials).toHaveBeenCalledWith('o-a')
  })

  it('qoralama davom ettiriladi; mavjud qator yangilanadi (exists: true)', async () => {
    vi.mocked(inventoryRepo.listCounts).mockResolvedValue({ rows: [{ ...count, item_count: 1 }], total: 1 })
    vi.mocked(inventoryRepo.listCountItems).mockResolvedValue([item()])
    vi.mocked(inventoryRepo.saveCountItem).mockResolvedValue(item({ qty_input: '4', qty_counted: '200' }))
    open('/tg/inventory')
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(tinv.continueDraft('.*', 1).replace(/[()]/g, '')) }))
    expect(await screen.findByTestId('counted-count')).toHaveTextContent(tinv.counted(1))
    fireEvent.click(screen.getByRole('button', { name: /Sement/ }))
    expect(screen.getByLabelText(tinv.qty)).toHaveValue('3')
    fireEvent.change(screen.getByLabelText(tinv.qty), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: tinv.save }))
    await waitFor(() =>
      expect(inventoryRepo.saveCountItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'it1', exists: true, qtyInput: '4' })),
    )
    expect(inventoryRepo.createCount).not.toHaveBeenCalled()
  })

  it('farq yo‘q — "Farq topilmadi"; hech narsa sanalmagan bo‘lsa yakunlab bo‘lmaydi', async () => {
    open('/tg/inventory')
    fireEvent.click(await screen.findByRole('button', { name: tinv.newCount }))
    fireEvent.click(await screen.findByRole('button', { name: tinv.finish }))
    const dialog = await screen.findByRole('dialog', { name: tinv.confirmTitle })
    expect(within(dialog).getByText(tinv.nothingCounted)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: tinv.confirm })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: t.common.cancel }))

    vi.mocked(inventoryRepo.saveCountItem).mockResolvedValue(item())
    fireEvent.click(screen.getByRole('button', { name: /Sement/ }))
    fireEvent.change(screen.getByLabelText(tinv.qty), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: tinv.save }))
    await screen.findByText(tinv.countedMark)
    // Tekshiruvchi: server faqat {ok:true} — natija yashirin, neytral "yuborildi"
    vi.mocked(inventoryRepo.submitCount).mockResolvedValue({ hasShortage: null, notCountedCount: 0 })
    fireEvent.click(screen.getByRole('button', { name: tinv.finish }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: tinv.confirm }))
    expect(await screen.findByTestId('inventory-result')).toHaveTextContent(tinv.resultSent)
  })
})
