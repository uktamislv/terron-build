import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import * as authRepo from '@/data/authRepo'
import * as cashRepo from '@/data/cashRepo'
import { toRepoError } from '@/data/errors'
import * as materialsRepo from '@/data/materialsRepo'
import * as movementsRepo from '@/data/movementsRepo'
import * as objectsRepo from '@/data/objectsRepo'
import * as purchasesRepo from '@/data/purchasesRepo'
import * as suppliersRepo from '@/data/suppliersRepo'
import type { CashBalance, Purchase, Supplier } from '@/data/types'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { COMPANY_ID, makeMaterial, makeObject, makeProfile, makeUnit } from '@/test/fixtures'

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
vi.mock('@/data/usageRepo', () => ({ getMyMaterialUsage: vi.fn(async () => []) }))
vi.mock('@/data/companiesRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/companiesRepo')>()),
  getCompanySettings: vi.fn(async () => ({ receiptMismatchPct: '2', priceDeviationPct: '8', priceAvgWindow: 5 })),
}))
vi.mock('@/data/cashRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/cashRepo')>()),
  getMyBalance: vi.fn(),
}))
vi.mock('@/data/requestsRepo', () => ({ listMyRequests: vi.fn(async () => []) }))
vi.mock('@/data/transfersRepo', () => ({ listMyTransfers: vi.fn(async () => []), listIncomingTransfers: vi.fn(async () => []) }))
vi.mock('@/data/purchasesRepo', () => ({
  createPurchase: vi.fn(),
  checkPurchasePrice: vi.fn(async () => 'ok'),
  listMyPurchases: vi.fn(async () => []),
}))
vi.mock('@/data/suppliersRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/suppliersRepo')>()),
  listSuppliers: vi.fn(async () => []),
  createSupplier: vi.fn(),
}))
vi.mock('@/data/movementsRepo', () => ({ createMovement: vi.fn(), listMyMovements: vi.fn(async () => []) }))
vi.mock('@/data/photosRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/photosRepo')>()),
  uploadPhoto: vi.fn(),
  signedPhotoUrl: vi.fn(),
}))

const tm = t.tg.movement
const tp = t.tg.purchase

const sement = makeMaterial('m-sem', 'Sement', 'kg', { units: [makeUnit('u-qop', 'm-sem', 'qop', '50.0000000000')] })
const objA = makeObject('o-a', 'Obyekt A')
const bozor: Supplier = {
  id: 's-1',
  company_id: COMPANY_ID,
  name: 'Chilonzor bozori',
  phone: null,
  note: null,
  created_at: '2026-10-01T05:00:00Z',
  deleted_at: null,
}

function balance(value: string): CashBalance {
  return { ...cashRepo.emptyBalance(COMPANY_ID, 'p-haydovchi'), balance: value }
}

function savedPurchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: 'pu1',
    company_id: COMPANY_ID,
    buyer_id: 'p-haydovchi',
    object_id: 'o-a',
    material_id: 'm-sem',
    supplier_id: null,
    unit_id: 'u-qop',
    qty_input: '3',
    unit_input: 'qop',
    unit_variant: null,
    qty_base: '150',
    total_amount: '1250000',
    unit_price: '416666.67',
    price_per_base: '8333.3333',
    receipt_photo_path: null,
    purchased_at: '2026-10-25T05:00:00Z',
    note: null,
    created_by: 'p-haydovchi',
    created_at: '2026-10-25T05:00:00Z',
    deleted_at: null,
    object_name: 'Obyekt A',
    material_name: 'Sement',
    base_unit: 'kg',
    buyer_name: 'Test haydovchi',
    supplier_name: null,
    receipt: null,
    alert_types: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('haydovchi'))
  vi.mocked(objectsRepo.listObjects).mockResolvedValue([objA])
  vi.mocked(materialsRepo.listMaterials).mockResolvedValue([sement])
  vi.mocked(cashRepo.getMyBalance).mockResolvedValueOnce(balance('2000000')).mockResolvedValue(balance('750000'))
  vi.mocked(purchasesRepo.createPurchase).mockResolvedValue(savedPurchase())
  vi.mocked(purchasesRepo.checkPurchasePrice).mockResolvedValue('ok')
  vi.mocked(suppliersRepo.listSuppliers).mockResolvedValue([bozor])
})

function open(path = '/tg/purchase') {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

async function pickSement() {
  const grid = await screen.findByRole('region', { name: tm.chooseMaterial })
  fireEvent.click(within(grid).getByRole('button', { name: /Sement/ }))
}

function fill(qty: string, sum: string) {
  fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: qty } })
  fireEvent.click(within(screen.getByRole('group', { name: tm.unit })).getByRole('button', { name: 'qop' }))
  fireEvent.change(screen.getByLabelText(tp.sum), { target: { value: sum } })
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: tp.save }))
}

describe('/tg/purchase — haydovchi, bitta obyekt', () => {
  it('qo‘limdagi pul → material → 3 qop, 1250000 → "1 250 000" → narx → saqlash → balans yangilanadi', async () => {
    open()
    expect(await screen.findByTestId('cash-balance')).toHaveTextContent('Qo‘limda: 2 000 000 so‘m')
    await pickSement()
    // Obyekt avtomatik
    expect(screen.queryByRole('region', { name: tm.chooseObject })).not.toBeInTheDocument()
    expect(screen.getByText('Obyekt A')).toBeInTheDocument()

    fill('3', '1250000')
    expect(screen.getByLabelText(tp.sum)).toHaveValue('1 250 000')
    expect(screen.getByLabelText(tp.sum)).toHaveAttribute('inputmode', 'numeric')
    expect(screen.getByText('1 kg narxi: 8 333,33 so‘m')).toBeInTheDocument()

    save()
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalledTimes(1))
    expect(vi.mocked(purchasesRepo.createPurchase).mock.calls[0]?.[0]).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      companyId: COMPANY_ID,
      objectId: 'o-a',
      materialId: 'm-sem',
      unitId: 'u-qop',
      qtyInput: '3',
      totalAmount: '1250000',
      supplierId: null,
      receiptPhotoPath: null,
      note: '',
      buyerId: 'p-haydovchi',
      purchasedAt: null,
      requestId: null,
      receipt: null,
      geo: { status: 'unavailable' },
    })
    // Tasdiq: asosiy matn va summa — alohida qatorlarda
    const banner = (await screen.findByText(/Xarid saqlandi: 3 qop Sement/)).closest('[role="status"]') as HTMLElement
    expect(within(banner).getByText('1 250 000 so‘m')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('cash-balance')).toHaveTextContent('Qo‘limda: 750 000 so‘m'))
    expect(cashRepo.getMyBalance).toHaveBeenCalledTimes(2)
    // Keyingi yozuv uchun material tanlash
    expect(screen.getByRole('region', { name: tm.chooseMaterial })).toBeInTheDocument()
  })

  it('manfiy balans — qizil', async () => {
    vi.mocked(cashRepo.getMyBalance).mockReset().mockResolvedValue(balance('-150000'))
    open()
    const el = await screen.findByTestId('cash-balance')
    expect(el).toHaveTextContent('\u2212150 000 so‘m')
    expect(el).toHaveAttribute('data-negative', 'true')
    expect(el.querySelector('[data-negative]')).toHaveClass('text-danger')
  })

  it('narx yuqori (RPC "high") — sariq ogohlantirish, foiz va o‘rtacha yo‘q; saqlanadi', async () => {
    vi.mocked(purchasesRepo.checkPurchasePrice).mockResolvedValue('high')
    open()
    await pickSement()
    fill('3', '1 250 000')
    expect(await screen.findByText(tp.priceHigh)).toBeInTheDocument()
    // price_per_base satr sifatida, purchasePrices bilan hisoblangan
    expect(purchasesRepo.checkPurchasePrice).toHaveBeenLastCalledWith('m-sem', '8333.3333')
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    save()
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalledTimes(1))
  })

  it('narx juda past (RPC "low") — birlikni tekshirish haqida ogohlantirish', async () => {
    vi.mocked(purchasesRepo.checkPurchasePrice).mockResolvedValue('low')
    open()
    await pickSement()
    fill('3', '1000')
    expect(await screen.findByText(tp.priceLow)).toBeInTheDocument()
  })

  it('narx tekshiruvi debounce: tez yozishda bitta so‘rov; "ok" — ogohlantirish yo‘q', async () => {
    open()
    await pickSement()
    fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: '3' } })
    for (const v of ['1', '12', '125', '1250', '12500']) {
      fireEvent.change(screen.getByLabelText(tp.sum), { target: { value: v } })
    }
    await waitFor(() => expect(purchasesRepo.checkPurchasePrice).toHaveBeenCalledTimes(1))
    // 12500 / 3 = 4166.6667 (1 kg = asosiy birlik)
    expect(purchasesRepo.checkPurchasePrice).toHaveBeenCalledWith('m-sem', '4166.6667')
    expect(screen.queryByText(tp.priceHigh)).not.toBeInTheDocument()
    expect(screen.queryByText(tp.priceLow)).not.toBeInTheDocument()
  })

  it('asosiy bo‘lmagan birlik — "= 150 kg" katta ko‘rsatiladi; asosiy birlikda — oddiy', async () => {
    open()
    await pickSement()
    fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: '3' } })
    expect(screen.getByTestId('base-qty')).not.toHaveAttribute('data-emphasized')
    fireEvent.click(within(screen.getByRole('group', { name: tm.unit })).getByRole('button', { name: 'qop' }))
    const box = screen.getByTestId('base-qty')
    expect(box).toHaveTextContent('= 150 kg')
    expect(box).toHaveAttribute('data-emphasized', 'true')
    expect(within(box).getByText('150')).toHaveClass('text-hero')
  })

  it('summa bo‘sh yoki noto‘g‘ri — xato, saqlanmaydi', async () => {
    open()
    await pickSement()
    fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: '3' } })
    save()
    expect(await screen.findByText(tp.errors.sumRequired)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(tp.sum), { target: { value: '0' } })
    save()
    expect(await screen.findByText(tp.errors.sumInvalid)).toBeInTheDocument()
    expect(purchasesRepo.createPurchase).not.toHaveBeenCalled()
  })

  it('mavjud sotuvchi tugmasi — supplierId yuboriladi', async () => {
    open()
    await pickSement()
    fill('3', '1250000')
    const section = screen.getByRole('region', { name: tp.supplier })
    fireEvent.click(within(section).getByRole('button', { name: 'Chilonzor bozori' }))
    save()
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalled())
    expect(vi.mocked(purchasesRepo.createPurchase).mock.calls[0]?.[0].supplierId).toBe('s-1')
    expect(suppliersRepo.createSupplier).not.toHaveBeenCalled()
  })

  it('yangi sotuvchi — avval yaratiladi, keyin xarid; xato bo‘lsa qayta urinishda qayta yaratilmaydi', async () => {
    const created: Supplier = { ...bozor, id: 's-new', name: 'Yangi Baza' }
    vi.mocked(suppliersRepo.createSupplier).mockResolvedValue(created)
    vi.mocked(purchasesRepo.createPurchase)
      .mockRejectedValueOnce(toRepoError(new TypeError('Failed to fetch')))
      .mockResolvedValueOnce(savedPurchase({ supplier_id: 's-new' }))
    open()
    await pickSement()
    fill('3', '1250000')
    fireEvent.click(screen.getByRole('button', { name: tp.supplierNew }))
    fireEvent.change(screen.getByLabelText(tp.supplierName), { target: { value: '  Yangi Baza ' } })
    save()
    expect(await screen.findByText(new RegExp(t.errors.network))).toBeInTheDocument()
    expect(suppliersRepo.createSupplier).toHaveBeenCalledWith({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      companyId: COMPANY_ID,
      name: '  Yangi Baza ',
      tin: null,
    })
    fireEvent.click(screen.getByRole('button', { name: t.common.retry }))
    expect(await screen.findByText(/Xarid saqlandi/)).toBeInTheDocument()
    const calls = vi.mocked(purchasesRepo.createPurchase).mock.calls.map((c) => c[0])
    expect(calls).toHaveLength(2)
    expect(calls[1]?.id).toBe(calls[0]?.id)
    expect(calls.every((c) => c.supplierId === 's-new')).toBe(true)
    expect(suppliersRepo.createSupplier).toHaveBeenCalledTimes(1)
  })

  it('sotuvchi nomi o‘zgarsa — yangi qoralama id; yaratilgandan keyin ham yangi id', async () => {
    vi.mocked(suppliersRepo.createSupplier)
      .mockRejectedValueOnce(toRepoError(new TypeError('Failed to fetch')))
      .mockResolvedValueOnce({ ...bozor, id: 's-b', name: 'B baza' })
      .mockResolvedValueOnce({ ...bozor, id: 's-c', name: 'C baza' })
    open()
    await pickSement()
    fill('3', '1250000')
    fireEvent.click(screen.getByRole('button', { name: tp.supplierNew }))
    fireEvent.change(screen.getByLabelText(tp.supplierName), { target: { value: 'A baza' } })
    save()
    expect(await screen.findByText(new RegExp(t.errors.network))).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(tp.supplierName), { target: { value: 'B baza' } })
    save()
    expect(await screen.findByText(/Xarid saqlandi/)).toBeInTheDocument()

    await pickSement()
    fill('1', '400000')
    fireEvent.click(screen.getByRole('button', { name: tp.supplierNew }))
    fireEvent.change(screen.getByLabelText(tp.supplierName), { target: { value: 'C baza' } })
    save()
    await waitFor(() => expect(suppliersRepo.createSupplier).toHaveBeenCalledTimes(3))
    const ids = vi.mocked(suppliersRepo.createSupplier).mock.calls.map((c) => c[0].id)
    expect(new Set(ids).size).toBe(3)
  })

  it('yangi sotuvchi nomi mavjudiga mos — yaratilmaydi', async () => {
    open()
    await pickSement()
    fill('3', '1250000')
    fireEvent.click(screen.getByRole('button', { name: tp.supplierNew }))
    fireEvent.change(screen.getByLabelText(tp.supplierName), { target: { value: 'chilonzor  BOZORI' } })
    save()
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalled())
    expect(suppliersRepo.createSupplier).not.toHaveBeenCalled()
    expect(vi.mocked(purchasesRepo.createPurchase).mock.calls[0]?.[0].supplierId).toBe('s-1')
  })

  it('yangi sotuvchi nomi bo‘sh — xato', async () => {
    open()
    await pickSement()
    fill('3', '1250000')
    fireEvent.click(screen.getByRole('button', { name: tp.supplierNew }))
    save()
    expect(await screen.findByText(tp.errors.supplierName)).toBeInTheDocument()
    expect(purchasesRepo.createPurchase).not.toHaveBeenCalled()
  })

  it('ikki tez bosish — bitta createPurchase; keyingi xarid — yangi id', async () => {
    let resolve: (p: Purchase) => void = () => undefined
    vi.mocked(purchasesRepo.createPurchase).mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    open()
    await pickSement()
    fill('3', '1250000')
    const button = screen.getByRole('button', { name: tp.save })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalledTimes(1))
    await act(async () => resolve(savedPurchase()))
    expect(await screen.findByText(/Xarid saqlandi/)).toBeInTheDocument()

    await pickSement()
    fill('1', '400000')
    save()
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalledTimes(2))
    const [first, second] = vi.mocked(purchasesRepo.createPurchase).mock.calls.map((c) => c[0].id)
    expect(second).not.toBe(first)
  })
})

describe('/tg/mine — xaridlar ham', () => {
  it('kirim va xarid aralash, vaqt bo‘yicha; xarid tafsilotida summa', async () => {
    vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('prorab'))
    vi.mocked(movementsRepo.listMyMovements).mockResolvedValue([
      {
        id: 'mv1',
        company_id: COMPANY_ID,
        type: 'kirim',
        object_id: 'o-a',
        material_id: 'm-qum',
        unit_id: 'u',
        qty_input: '2',
        unit_input: 'm³',
        unit_variant: null,
        qty_base: '2',
        purchase_id: null,
        photo_path: null,
        occurred_at: '2026-10-25T04:00:00Z',
        note: null,
        created_by: 'p-prorab',
        created_at: '2026-10-25T04:00:00Z',
        deleted_at: null,
        object_name: 'Obyekt A',
        material_name: 'Qum',
        base_unit: 'm³',
        created_by_name: 'Test prorab',
      },
    ])
    vi.mocked(purchasesRepo.listMyPurchases).mockResolvedValue([
      savedPurchase({ supplier_name: 'Chilonzor bozori', buyer_id: 'p-prorab', created_by: 'p-prorab' }),
      savedPurchase({ id: 'pu2', buyer_id: 'p-prorab', created_by: 'p-admin', created_at: '2026-10-25T03:00:00Z', material_name: 'Kafel' }),
    ])
    open('/tg/mine')
    const list = within(await screen.findByRole('list', { name: t.tg.mine.title }))
    const items = list.getAllByRole('button')
    expect(items).toHaveLength(3)
    // Admin mening nomimga kiritgan xarid — belgi bilan; o'zim kiritganda belgi yo'q
    expect(within(items[2] as HTMLElement).getByText(t.tg.mine.enteredByOther)).toBeInTheDocument()
    expect(within(items[0] as HTMLElement).queryByText(t.tg.mine.enteredByOther)).not.toBeInTheDocument()
    // Xarid (05:00) kirimdan (04:00) yangi — birinchi
    expect(items[0]).toHaveTextContent('Sement')
    expect(items[0]).toHaveTextContent('1 250 000 so‘m')
    // Tur nomi qatorda ko'rinadigan matn sifatida (belgi — dekorativ)
    expect(within(items[0] as HTMLElement).getByText(t.tg.mine.purchase)).toBeInTheDocument()
    expect(purchasesRepo.listMyPurchases).toHaveBeenCalledWith('p-prorab', 50)

    fireEvent.click(items[0] as HTMLElement)
    expect(await screen.findByText('Chilonzor bozori')).toBeInTheDocument()
    expect(screen.getByText(t.tg.mine.noReceipt)).toBeInTheDocument()
  })
})
