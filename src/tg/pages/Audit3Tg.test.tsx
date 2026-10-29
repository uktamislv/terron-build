// Audit 3 (Mini App): kirim/chiqim turi, Xarid → Kirim yo'li, qoldiq, qoralama id, forma tashlab ketish,
// narx tekshiruvi xatosi, "1,500" tasdiqi, material to'ri, MainButton rangi va "Saqlandi" holati.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as authRepo from '@/data/authRepo'
import * as cashRepo from '@/data/cashRepo'
import { RepoError, toRepoError } from '@/data/errors'
import * as materialsRepo from '@/data/materialsRepo'
import * as movementsRepo from '@/data/movementsRepo'
import * as objectsRepo from '@/data/objectsRepo'
import * as openPurchasesRepo from '@/data/openPurchasesRepo'
import * as purchasesRepo from '@/data/purchasesRepo'
import * as stockRepo from '@/data/stockRepo'
import type { Material, Movement, MyOpenPurchase, Purchase } from '@/data/types'
import { colors } from '@/components/ui/tokens'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { COMPANY_ID, makeMaterial, makeObject, makeProfile, makeUnit } from '@/test/fixtures'

const tg = vi.hoisted(() => ({
  app: null as null | { MainButton: Record<string, ReturnType<typeof vi.fn>>; BackButton: Record<string, unknown> },
  mainClick: null as null | (() => void),
}))

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
  getWebApp: () => tg.app,
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
vi.mock('@/data/movementsRepo', () => ({ createMovement: vi.fn(), listMyMovements: vi.fn(async () => []), MOVEMENTS_PAGE_SIZE: 50 }))
vi.mock('@/data/openPurchasesRepo', () => ({ listOpenPurchases: vi.fn(async () => []), listMyOpenPurchases: vi.fn(async () => []) }))
vi.mock('@/data/stockRepo', () => ({ getStock: vi.fn(async () => '420'), listStock: vi.fn(async () => []) }))
vi.mock('@/data/usageRepo', () => ({ getMyMaterialUsage: vi.fn(async () => []) }))
vi.mock('@/data/requestsRepo', () => ({
  listMyRequests: vi.fn(async () => []),
  listApprovedRequests: vi.fn(async () => []),
  listApprovedRequestsAll: vi.fn(async () => []),
}))
vi.mock('@/data/transfersRepo', () => ({
  listMyTransfers: vi.fn(async () => []),
  listIncomingTransfers: vi.fn(async () => []),
  listTransferTargets: vi.fn(async () => [{ id: 'o-b', name: 'Obyekt B' }]),
}))
vi.mock('@/data/normsRepo', () => ({ listNormUsage: vi.fn(async () => []) }))
vi.mock('@/data/purchasesRepo', () => ({
  createPurchase: vi.fn(),
  checkPurchasePrice: vi.fn(async () => 'ok'),
  listMyPurchases: vi.fn(async () => []),
}))
vi.mock('@/data/cashRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/cashRepo')>()),
  getMyBalance: vi.fn(),
}))
vi.mock('@/data/suppliersRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/suppliersRepo')>()),
  listSuppliers: vi.fn(async () => []),
  createSupplier: vi.fn(),
}))
vi.mock('@/data/photosRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/photosRepo')>()),
  uploadPhoto: vi.fn(),
  signedPhotoUrl: vi.fn(),
}))

const tm = t.tg.movement
const tp = t.tg.purchase
const tpe = t.tg.pending

const sement = makeMaterial('m-sem', 'Sement', 'kg', { units: [makeUnit('u-qop', 'm-sem', 'qop', '50.0000000000')] })
const qum = makeMaterial('m-qum', 'Qum', 'm³')
const objA = makeObject('o-a', 'Obyekt A')

function savedMovement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: 'mv1',
    company_id: COMPANY_ID,
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
    note: null,
    created_by: 'p-prorab',
    created_at: '2026-10-25T05:00:00Z',
    deleted_at: null,
    object_name: 'Obyekt A',
    material_name: 'Sement',
    base_unit: 'kg',
    created_by_name: null,
    ...overrides,
  }
}

function savedPurchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: 'pu1',
    company_id: COMPANY_ID,
    buyer_id: 'p-prorab',
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
    created_by: 'p-prorab',
    created_at: '2026-10-25T05:00:00Z',
    deleted_at: null,
    object_name: 'Obyekt A',
    material_name: 'Sement',
    base_unit: 'kg',
    buyer_name: null,
    supplier_name: null,
    receipt: null,
    alert_types: [],
    ...overrides,
  }
}

function pending(overrides: Partial<MyOpenPurchase> = {}): MyOpenPurchase {
  return {
    purchase_id: 'pu7',
    object_id: 'o-a',
    object_name: 'Obyekt A',
    material_id: 'm-sem',
    material_name: 'Sement',
    base_unit: 'kg',
    qty_base: '150',
    received_qty_base: '50',
    remaining_qty_base: '100',
    purchased_at: '2026-10-24T05:00:00Z',
    buyer_id: 'p-h',
    buyer_name: 'Ali haydovchi',
    ...overrides,
  }
}

function telegramApp() {
  const main: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of ['setText', 'offClick', 'enable', 'disable', 'showProgress', 'hideProgress', 'show', 'hide', 'setParams']) {
    main[m] = vi.fn(() => main)
  }
  main.onClick = vi.fn((cb: () => void) => {
    tg.mainClick = cb
    return main
  })
  return { MainButton: main, BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() } }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  tg.app = null
  tg.mainClick = null
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('prorab'))
  vi.mocked(objectsRepo.listObjects).mockResolvedValue([objA])
  vi.mocked(materialsRepo.listMaterials).mockResolvedValue([qum, sement])
  vi.mocked(stockRepo.getStock).mockResolvedValue('420')
  vi.mocked(movementsRepo.createMovement).mockResolvedValue(savedMovement())
  vi.mocked(purchasesRepo.createPurchase).mockResolvedValue(savedPurchase())
  vi.mocked(purchasesRepo.checkPurchasePrice).mockResolvedValue('ok')
  vi.mocked(cashRepo.getMyBalance).mockResolvedValue({ ...cashRepo.emptyBalance(COMPANY_ID, 'p-prorab'), balance: '1000000' })
  vi.mocked(openPurchasesRepo.listMyOpenPurchases).mockResolvedValue([])
})

function open(path: string | { pathname: string; state: unknown } = '/tg/movement') {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

async function pickMaterial(name: string) {
  const grid = await screen.findByRole('region', { name: tm.chooseMaterial })
  fireEvent.click(within(grid).getByRole('button', { name: new RegExp(name) }))
}

describe('T1 — kirim/chiqim turi', () => {
  it('MainButton matni va rangi turga qarab; forma ichida tur belgisi', async () => {
    tg.app = telegramApp()
    open()
    await pickMaterial('Sement')
    const main = tg.app.MainButton
    await waitFor(() => expect(main.setText).toHaveBeenLastCalledWith(tm.saveKirim))
    expect(main.setParams).toHaveBeenLastCalledWith({ color: colors.ok, text_color: colors.paper })
    expect(screen.getByTestId('movement-type-badge')).toHaveTextContent(t.movements.types.kirim)
    fireEvent.click(screen.getByRole('button', { name: t.movements.types.chiqim }))
    await waitFor(() => expect(main.setText).toHaveBeenLastCalledWith(tm.saveChiqim))
    expect(main.setParams).toHaveBeenLastCalledWith({ color: colors.brand, text_color: colors.paper })
    expect(screen.getByTestId('movement-type-badge')).toHaveTextContent(t.movements.types.chiqim)
  })
})

describe('T2 — Xarid → Kirim', () => {
  it('xarid saqlangach "Qabul qilish (kirim)" — kirim formasi: obyekt, material, miqdor (asosiy birlikda) va xarid bog\'langan', async () => {
    vi.mocked(openPurchasesRepo.listOpenPurchases).mockResolvedValue([
      {
        id: 'pu1',
        purchased_at: '2026-10-25T05:00:00Z',
        buyer_id: 'p-prorab',
        buyer_name: null,
        qty_base: '150',
        received_qty_base: '0',
        remaining_qty_base: '150',
        unit_input: 'qop',
        unit_variant: null,
        qty_input: '3',
      },
      {
        id: 'pu0',
        purchased_at: '2026-10-20T05:00:00Z',
        buyer_id: 'p-h',
        buyer_name: null,
        qty_base: '50',
        received_qty_base: '0',
        remaining_qty_base: '50',
        unit_input: 'kg',
        unit_variant: null,
        qty_input: '50',
      },
    ])
    open('/tg/purchase')
    await pickMaterial('Sement')
    fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: '3' } })
    fireEvent.click(within(screen.getByRole('group', { name: tm.unit })).getByRole('button', { name: 'qop' }))
    fireEvent.change(screen.getByLabelText(tp.sum), { target: { value: '1250000' } })
    fireEvent.click(screen.getByRole('button', { name: tp.save }))
    const receive = await screen.findByRole('button', { name: tpe.receiveNow })
    // Forma tozalangani (dirty = false) sahifaga yetib borsin
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(receive)
    // Kirim formasi: material ochiq, miqdor 150 (kg), bir nechta ochiq xariddan aynan shu xarid tanlangan
    expect(await screen.findByRole('region', { name: 'Sement' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.movements.types.kirim })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText(tm.qty)).toHaveValue('150')
    await screen.findByRole('region', { name: tm.linked.title })
    fireEvent.click(screen.getByRole('button', { name: tm.save }))
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalledTimes(1))
    expect(vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0]).toMatchObject({
      type: 'kirim',
      objectId: 'o-a',
      materialId: 'm-sem',
      unitId: 'm-sem-base',
      qtyInput: '150',
      purchaseId: 'pu1',
    })
  })

  it('kirim qila olmaydigan rol (haydovchi) — "Qabul qilish" tugmasi yo\'q', async () => {
    vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('haydovchi'))
    open('/tg/purchase')
    await pickMaterial('Sement')
    fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(tp.sum), { target: { value: '1250000' } })
    fireEvent.click(screen.getByRole('button', { name: tp.save }))
    await screen.findByText(/Xarid saqlandi/)
    expect(screen.queryByRole('button', { name: tpe.receiveNow })).not.toBeInTheDocument()
  })

  it('"Qabul kutilmoqda (N)" — kirim tomonida; qator tanlansa kirim oldindan to\'ldiriladi; plitkada belgi', async () => {
    vi.mocked(openPurchasesRepo.listMyOpenPurchases).mockResolvedValue([pending()])
    open()
    const banner = await screen.findByTestId('pending-receipts')
    expect(banner).toHaveTextContent(tpe.banner(1))
    // Kirim rejimida material plitkasida belgi
    const grid = screen.getByRole('region', { name: tm.chooseMaterial })
    expect(within(grid).getByRole('button', { name: /Sement/ })).toHaveAttribute('data-flagged', 'true')
    expect(within(grid).getByRole('button', { name: /Qum/ })).not.toHaveAttribute('data-flagged')
    fireEvent.click(banner)
    fireEvent.click(await screen.findByTestId('pending-receipt').then((li) => within(li).getByRole('button')))
    expect(await screen.findByRole('region', { name: 'Sement' })).toBeInTheDocument()
    expect(screen.getByLabelText(tm.qty)).toHaveValue('100')
    // Chiqimda banner ko'rsatilmaydi
    fireEvent.click(screen.getByRole('button', { name: tm.change }))
    fireEvent.click(screen.getByRole('button', { name: t.movements.types.chiqim }))
    expect(screen.queryByTestId('pending-receipts')).not.toBeInTheDocument()
  })

  it('bosh ekranda "Qabul kutilmoqda" — bosilsa kirim formasi to\'ldirilgan holda', async () => {
    vi.mocked(openPurchasesRepo.listMyOpenPurchases).mockResolvedValue([pending()])
    open('/tg')
    fireEvent.click(await screen.findByTestId('pending-receipts'))
    fireEvent.click(await screen.findByTestId('pending-receipt').then((li) => within(li).getByRole('button')))
    expect(await screen.findByRole('region', { name: 'Sement' })).toBeInTheDocument()
    expect(screen.getByLabelText(tm.qty)).toHaveValue('100')
    expect(screen.getByRole('button', { name: t.movements.types.kirim })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('T5 — qoralama id xatodan keyin', () => {
  it('xatodan keyin miqdor o\'zgarsa — yangi id; o\'zgarmasa — o\'sha id', async () => {
    vi.mocked(movementsRepo.createMovement).mockRejectedValueOnce(toRepoError(new TypeError('Failed to fetch')))
    vi.mocked(movementsRepo.createMovement).mockRejectedValueOnce(toRepoError(new TypeError('Failed to fetch')))
    open()
    await pickMaterial('Sement')
    fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: tm.save }))
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalledTimes(1))
    await screen.findByText(t.errors.network)
    fireEvent.click(screen.getByRole('button', { name: tm.save }))
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: tm.save })).toBeEnabled())
    fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: tm.save }))
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalledTimes(3))
    const ids = vi.mocked(movementsRepo.createMovement).mock.calls.map((c) => c[0].id)
    expect(ids[0]).toBe(ids[1])
    expect(ids[2]).not.toBe(ids[1])
  })

  it('draft_conflict — xabar va keyingi urinish yangi id bilan', async () => {
    vi.mocked(movementsRepo.createMovement).mockRejectedValueOnce(new RepoError('draft_conflict'))
    open()
    await pickMaterial('Sement')
    fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: tm.save }))
    expect(await screen.findByText(t.errors.draft_conflict)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tm.save }))
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalledTimes(2))
    const ids = vi.mocked(movementsRepo.createMovement).mock.calls.map((c) => c[0].id)
    expect(ids[1]).not.toBe(ids[0])
  })
})

describe('T7 — to\'ldirilgan formani tashlab ketish', () => {
  it('miqdor kiritilgan — pastki menyu orqali chiqishdan oldin tasdiq; "Qolish" — forma joyida, "Chiqish" — o\'tadi', async () => {
    const router = open()
    await pickMaterial('Sement')
    fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: '3' } })
    act(() => {
      void router.navigate('/tg/mine')
    })
    expect(await screen.findByTestId('discard-confirm')).toHaveTextContent(t.tg.discard.text)
    fireEvent.click(screen.getByRole('button', { name: t.tg.discard.stay }))
    expect(router.state.location.pathname).toBe('/tg/movement')
    expect(screen.getByLabelText(tm.qty)).toHaveValue('3')
    act(() => {
      void router.navigate('/tg/mine')
    })
    fireEvent.click(await screen.findByRole('button', { name: t.tg.discard.leave }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tg/mine'))
  })

  it('bo\'sh forma — tasdiqsiz o\'tadi', async () => {
    const router = open()
    await pickMaterial('Sement')
    act(() => {
      void router.navigate('/tg/mine')
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/tg/mine'))
    expect(screen.queryByTestId('discard-confirm')).not.toBeInTheDocument()
  })

  it('Xarid: "Material | Xarajat" almashtirish — summa kiritilgan bo\'lsa tasdiq', async () => {
    open('/tg/purchase')
    await pickMaterial('Sement')
    fireEvent.change(screen.getByLabelText(tp.sum), { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: t.expenses.modeExpense }))
    expect(await screen.findByTestId('discard-confirm')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.tg.discard.stay }))
    expect(screen.getByLabelText(tp.sum)).toHaveValue('1 000')
  })
})

describe('T7 / T20 — So\'rov ekrani', () => {
  it('"So\'rov | O\'tkazma" almashtirish — miqdor kiritilgan bo\'lsa tasdiq; "Chiqish" — almashadi', async () => {
    open('/tg/request')
    await pickMaterial('Sement')
    fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: t.tg.request.tabTransfer }))
    expect(await screen.findByTestId('discard-confirm')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.tg.request.tabRequest })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: t.tg.discard.leave }))
    await waitFor(() => expect(screen.getByRole('button', { name: t.tg.request.tabTransfer })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('smetaga kirmaydigan material — "smeta bo\'yicha tekshirilmaydi" (smeta yo\'q / smetada yo\'q emas)', async () => {
    vi.mocked(materialsRepo.listMaterials).mockResolvedValue([{ ...sement, outside_estimate: true }, qum])
    open('/tg/request')
    await pickMaterial('Sement')
    expect(await screen.findByText(t.tg.request.outsideEstimate)).toBeInTheDocument()
    expect(screen.queryByText(t.tg.request.noEstimate)).not.toBeInTheDocument()
  })
})

describe('T21 — narx tekshiruvi xatosi', () => {
  it('RPC xato — ogohlantirish ham, "odatdagidek" ham ko\'rsatilmaydi', async () => {
    vi.mocked(purchasesRepo.checkPurchasePrice).mockRejectedValue(toRepoError(new TypeError('Failed to fetch')))
    open('/tg/purchase')
    await pickMaterial('Sement')
    fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(tp.sum), { target: { value: '1250000' } })
    await waitFor(() => expect(purchasesRepo.checkPurchasePrice).toHaveBeenCalled())
    expect(screen.queryByText(tp.priceHigh)).not.toBeInTheDocument()
    expect(screen.queryByText(tp.priceLow)).not.toBeInTheDocument()
  })
})

describe('T11 / T22 — miqdor maydoni', () => {
  it('"1,500" — "1,5 qop deb saqlanadi (1 500 emas)" qatori', async () => {
    open()
    await pickMaterial('Sement')
    fireEvent.click(within(screen.getByRole('group', { name: tm.unit })).getByRole('button', { name: 'qop' }))
    fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: '1,500' } })
    expect(screen.getByTestId('qty-hint').textContent?.replace(/\s/g, ' ')).toBe('1,5 qop deb saqlanadi (1 500 emas)')
    fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: '1,5' } })
    expect(screen.queryByTestId('qty-hint')).not.toBeInTheDocument()
  })

  it('xarid: miqdorda "Keyingi" — summa maydoniga o\'tadi', async () => {
    open('/tg/purchase')
    await pickMaterial('Sement')
    const qty = screen.getByLabelText(tm.qty)
    expect(qty).toHaveAttribute('enterkeyhint', 'next')
    fireEvent.keyDown(qty, { key: 'Enter' })
    expect(screen.getByLabelText(tp.sum)).toHaveFocus()
  })
})

describe('T9 — katta katalog', () => {
  it('dastlab 60 ta plitka, "Yana ko\'rsatish" bilan qolgani', async () => {
    const many: Material[] = Array.from({ length: 130 }, (_, i) => makeMaterial(`m${i}`, `Material ${String(i).padStart(3, '0')}`, 'dona'))
    vi.mocked(materialsRepo.listMaterials).mockResolvedValue(many)
    open()
    const grid = await screen.findByRole('region', { name: tm.chooseMaterial })
    expect(within(grid).getAllByRole('button', { name: /^Material / })).toHaveLength(60)
    fireEvent.click(within(grid).getByRole('button', { name: tm.showMore(70) }))
    expect(within(grid).getAllByRole('button', { name: /^Material / })).toHaveLength(130)
    expect(within(grid).queryByRole('button', { name: /Yana/ })).not.toBeInTheDocument()
  })
})

describe('T13 — "Saqlandi" boshqa ekranga o\'tmaydi', () => {
  it('saqlangach boshqa bo\'limga o\'tilsa — u yerdagi MainButton "Saqlandi" emas', async () => {
    tg.app = telegramApp()
    const router = open()
    await pickMaterial('Sement')
    fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: '3' } })
    await waitFor(() => expect(tg.mainClick).not.toBeNull())
    act(() => tg.mainClick?.())
    await waitFor(() => expect(tg.app?.MainButton.setText).toHaveBeenCalledWith(t.ui.saved))
    act(() => {
      void router.navigate('/tg/purchase')
    })
    await pickMaterial('Sement')
    await waitFor(() => expect(tg.app?.MainButton.setText).toHaveBeenLastCalledWith(tp.save))
  })
})
