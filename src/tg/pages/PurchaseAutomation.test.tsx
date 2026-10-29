// Batch 12 — xarid ekrani: chek QR (G), tasdiqlangan so'rovlar (H), takroriy xarid (C),
// rasm majburiy (E), joylashuv (D).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as authRepo from '@/data/authRepo'
import * as cashRepo from '@/data/cashRepo'
import * as companiesRepo from '@/data/companiesRepo'
import { RepoError } from '@/data/errors'
import * as materialsRepo from '@/data/materialsRepo'
import * as objectsRepo from '@/data/objectsRepo'
import * as purchasesRepo from '@/data/purchasesRepo'
import * as receiptRepo from '@/data/receiptRepo'
import * as requestsRepo from '@/data/requestsRepo'
import * as suppliersRepo from '@/data/suppliersRepo'
import type { MaterialRequest, Purchase, Supplier } from '@/data/types'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { COMPANY_ID, makeMaterial, makeObject, makeProfile, makeUnit } from '@/test/fixtures'

const tg = vi.hoisted(() => ({
  app: null as null | Record<string, unknown>,
  main: null as null | (() => void),
  scanResult: null as null | string,
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
vi.mock('@/data/usageRepo', () => ({ getMyMaterialUsage: vi.fn(async () => []) }))
vi.mock('@/data/companiesRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/companiesRepo')>()),
  getCompanySettings: vi.fn(),
}))
vi.mock('@/data/cashRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/cashRepo')>()),
  getMyBalance: vi.fn(),
}))
vi.mock('@/data/requestsRepo', () => ({ listMyRequests: vi.fn(async () => []), listApprovedRequests: vi.fn(async () => []) }))
vi.mock('@/data/transfersRepo', () => ({ listIncomingTransfers: vi.fn(async () => []) }))
vi.mock('@/data/purchasesRepo', () => ({
  createPurchase: vi.fn(),
  checkPurchasePrice: vi.fn(async () => 'ok'),
  listMyPurchases: vi.fn(async () => []),
}))
vi.mock('@/data/receiptRepo', () => ({ receiptLookup: vi.fn() }))
vi.mock('@/data/suppliersRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/suppliersRepo')>()),
  listSuppliers: vi.fn(async () => []),
  createSupplier: vi.fn(),
}))
vi.mock('@/data/photosRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/photosRepo')>()),
  uploadPhoto: vi.fn(async () => 'c/2026/10/r.jpg'),
}))

const tm = t.tg.movement
const tp = t.tg.purchase
const ta = t.tg.auto
const QR = 'https://ofd.soliq.uz/check?t=UZ170703100189&r=643&c=20261025143000&s=248429044289'

const sement = makeMaterial('m-sem', 'Sement', 'kg', { units: [makeUnit('u-qop', 'm-sem', 'qop', '50.0000000000')] })
const qum = makeMaterial('m-qum', 'Qum', 'm³')
const objA = makeObject('o-a', 'Obyekt A')
const baza: Supplier = {
  id: 's-baza',
  company_id: COMPANY_ID,
  name: 'Baza 1',
  phone: null,
  note: null,
  tin: '123456789',
  created_at: '2026-10-01T05:00:00Z',
  deleted_at: null,
}

function savedPurchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: 'pu-old',
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
    purchased_at: new Date().toISOString(),
    note: null,
    created_by: 'p-haydovchi',
    created_at: new Date(Date.now() - 60_000).toISOString(),
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

function approvedRequest(): MaterialRequest {
  return {
    id: 'rq-1',
    company_id: COMPANY_ID,
    object_id: 'o-a',
    material_id: 'm-sem',
    unit_id: 'u-qop',
    qty_input: '40',
    unit_input: 'qop',
    unit_variant: null,
    qty_base: '2000',
    status: 'tasdiqlandi',
    needed_by: null,
    decided_by: 'p-admin',
    decided_at: '2026-10-24T05:00:00Z',
    decision_note: null,
    purchase_id: null,
    note: null,
    created_by: 'p-prorab',
    created_at: '2026-10-24T04:00:00Z',
    deleted_at: null,
    object_name: 'Obyekt A',
    material_name: 'Sement',
    base_unit: 'kg',
    created_by_name: 'Prorab',
    decided_by_name: 'Admin',
  }
}

/** Telegram ilovasi: MainButton, BackButton va QR skaner soxtasi. */
function telegramApp() {
  const main: Record<string, unknown> = {}
  for (const m of ['setText', 'show', 'hide', 'enable', 'disable', 'showProgress', 'hideProgress', 'setParams']) {
    main[m] = vi.fn(() => main)
  }
  main.onClick = vi.fn((cb: () => void) => {
    tg.main = cb
    return main
  })
  main.offClick = vi.fn(() => main)
  return {
    MainButton: main,
    BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
    showScanQrPopup: vi.fn((_p: unknown, cb: (text: string) => boolean) => {
      if (tg.scanResult !== null) cb(tg.scanResult)
    }),
    onEvent: vi.fn(),
    offEvent: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  tg.app = null
  tg.main = null
  tg.scanResult = QR
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('haydovchi'))
  vi.mocked(objectsRepo.listObjects).mockResolvedValue([objA])
  vi.mocked(materialsRepo.listMaterials).mockResolvedValue([sement, qum])
  vi.mocked(cashRepo.getMyBalance).mockResolvedValue({ ...cashRepo.emptyBalance(COMPANY_ID, 'p-haydovchi'), balance: '5000000' })
  vi.mocked(companiesRepo.getCompanySettings).mockResolvedValue(companiesRepo.DEFAULT_COMPANY_SETTINGS)
  vi.mocked(purchasesRepo.createPurchase).mockResolvedValue(savedPurchase({ id: 'pu-new' }))
  vi.mocked(purchasesRepo.listMyPurchases).mockResolvedValue([])
  vi.mocked(requestsRepo.listApprovedRequests).mockResolvedValue([])
  vi.mocked(suppliersRepo.listSuppliers).mockResolvedValue([baza])
})

function open() {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/tg/purchase'] })} />)
}

async function pickMaterial(name: string) {
  const grid = await screen.findByRole('region', { name: tm.chooseMaterial })
  fireEvent.click(within(grid).getByRole('button', { name: new RegExp(name) }))
}

function fill(qty: string, sum: string) {
  fireEvent.change(screen.getByLabelText(tm.qty), { target: { value: qty } })
  fireEvent.change(screen.getByLabelText(tp.sum), { target: { value: sum } })
}

async function pressMain() {
  await waitFor(() => expect(tg.main).not.toBeNull())
  // Telegram MainButton bosilishi React holatini yangilaydi — act ichida (ogohlantirishsiz)
  await act(async () => {
    tg.main?.()
  })
}

describe('Batch 12 (G) — chek QR', () => {
  it('bitta qatorli chek — summa, sotuvchi (STIR bo‘yicha), material, miqdor to‘ladi; tasdiqlangan', async () => {
    tg.app = telegramApp()
    vi.mocked(receiptRepo.receiptLookup).mockResolvedValue({
      sellerName: 'Baza 1 MChJ',
      sellerTin: '123456789',
      datetime: '2026-10-25T14:30:00+05:00',
      total: '250000',
      items: [{ name: 'Sement', qty: '5', price: '50000', sum: '250000', unit: null }],
      fiscalSign: '248429044289',
      terminalId: 'UZ170703100189',
      receiptNo: '643',
      verified: true,
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: ta.scanReceipt }))
    expect(await screen.findByTestId('receipt-card')).toHaveAttribute('data-verified', 'true')
    expect(receiptRepo.receiptLookup).toHaveBeenCalledWith(QR)
    expect(screen.getByText(ta.receiptVerified)).toBeInTheDocument()
    expect(screen.getByLabelText(tm.qty)).toHaveValue('5')
    expect(screen.getByLabelText(tp.sum)).toHaveValue('250 000')
    expect(screen.getByRole('button', { name: 'Baza 1' })).toHaveAttribute('aria-pressed', 'true')
    await pressMain()
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalled())
    const arg = vi.mocked(purchasesRepo.createPurchase).mock.calls[0]?.[0]
    expect(arg).toMatchObject({
      materialId: 'm-sem',
      qtyInput: '5',
      totalAmount: '250000',
      supplierId: 's-baza',
      purchasedAt: '2026-10-25T14:30:00+05:00',
      receipt: {
        fiscalSign: '248429044289',
        terminalId: 'UZ170703100189',
        receiptNo: '643',
        verified: true,
        total: '250000',
        sellerTin: '123456789',
      },
    })
  })

  it('sotuvchi STIR bo‘yicha topilmasa — nom bilan yangi, STIR bilan yaratiladi', async () => {
    tg.app = telegramApp()
    vi.mocked(suppliersRepo.listSuppliers).mockResolvedValue([])
    vi.mocked(suppliersRepo.createSupplier).mockResolvedValue({ ...baza, id: 's-new', name: 'Yangi do‘kon' })
    vi.mocked(receiptRepo.receiptLookup).mockResolvedValue({
      sellerName: 'Yangi do‘kon',
      sellerTin: '987654321',
      datetime: null,
      total: '100000',
      items: [{ name: 'Qum', qty: '2', price: '50000', sum: '100000', unit: null }],
      fiscalSign: '1',
      terminalId: 'UZ1',
      receiptNo: '1',
      verified: true,
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: ta.scanReceipt }))
    await screen.findByTestId('receipt-card')
    await pressMain()
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalled())
    expect(suppliersRepo.createSupplier).toHaveBeenCalledWith(expect.objectContaining({ name: 'Yangi do‘kon', tin: '987654321' }))
  })

  it('ko‘p qatorli chek — qator tanlanadi, shu qator summasi va materiali', async () => {
    tg.app = telegramApp()
    vi.mocked(receiptRepo.receiptLookup).mockResolvedValue({
      sellerName: 'Baza 1',
      sellerTin: null,
      datetime: null,
      total: '400000',
      items: [
        { name: 'Sement', qty: '4', price: '50000', sum: '200000', unit: null },
        { name: 'Qum', qty: '2', price: '100000', sum: '200000', unit: null },
      ],
      fiscalSign: '1',
      terminalId: 'UZ1',
      receiptNo: '9',
      verified: true,
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: ta.scanReceipt }))
    const group = await screen.findByRole('group', { name: ta.receiptChooseLine })
    // Hali tanlanmagan — material ekrani
    expect(screen.getByRole('region', { name: tm.chooseMaterial })).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('button', { name: /Qum/ }))
    expect(screen.getByTestId('receipt-other-lines')).toHaveTextContent(ta.receiptOtherLines)
    expect(await screen.findByLabelText(tm.qty)).toHaveValue('2')
    expect(screen.getByLabelText(tp.sum)).toHaveValue('200 000')
    expect(screen.getByRole('region', { name: 'Qum' })).toBeInTheDocument()
    await pressMain()
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalled())
    // QR — bitta xaridga; receipt_total — butun chek jami
    expect(vi.mocked(purchasesRepo.createPurchase).mock.calls[0]?.[0]).toMatchObject({
      totalAmount: '200000',
      receipt: { total: '400000', verified: true },
    })
  })

  it('sahifa o‘qilmasa — QR maydonlari saqlanadi, qo‘lda to‘ldiriladi, tasdiqlanmagan', async () => {
    tg.app = telegramApp()
    vi.mocked(receiptRepo.receiptLookup).mockRejectedValue(new RepoError('receipt_unreadable'))
    open()
    fireEvent.click(await screen.findByRole('button', { name: ta.scanReceipt }))
    const card = await screen.findByTestId('receipt-card')
    expect(card).not.toHaveAttribute('data-verified')
    expect(screen.getByText(ta.receiptUnverified)).toBeInTheDocument()
    await pickMaterial('Sement')
    fill('2', '100000')
    await pressMain()
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalled())
    expect(vi.mocked(purchasesRepo.createPurchase).mock.calls[0]?.[0].receipt).toEqual({
      fiscalSign: '248429044289',
      terminalId: 'UZ170703100189',
      receiptNo: '643',
      verified: false,
      total: null,
      sellerTin: null,
    })
  })

  it('soliq cheki bo‘lmagan QR — rad, so‘rov yuborilmaydi', async () => {
    tg.app = telegramApp()
    tg.scanResult = 'https://evil.example/check?t=UZ1&r=1&s=1'
    open()
    fireEvent.click(await screen.findByRole('button', { name: ta.scanReceipt }))
    expect(await screen.findByText(ta.notReceiptQr)).toBeInTheDocument()
    expect(receiptRepo.receiptLookup).not.toHaveBeenCalled()
  })

  it('chek allaqachon ishlatilgan — server xabari va "olib tashlash" izohi', async () => {
    tg.app = telegramApp()
    vi.mocked(receiptRepo.receiptLookup).mockRejectedValue(new RepoError('receipt_unreadable'))
    vi.mocked(purchasesRepo.createPurchase).mockRejectedValue(
      new RepoError('receipt_already_used', 'x', ['Ali', '24.10.2026 14:00']),
    )
    open()
    fireEvent.click(await screen.findByRole('button', { name: ta.scanReceipt }))
    await screen.findByTestId('receipt-card')
    await pickMaterial('Sement')
    fill('2', '100000')
    await pressMain()
    expect(await screen.findByText(t.errorsWith.receipt_already_used('Ali', '24.10.2026 14:00'))).toBeInTheDocument()
    expect(screen.getByText(ta.receiptUsed)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ta.receiptRemove }))
    expect(screen.queryByTestId('receipt-card')).not.toBeInTheDocument()
  })

  it('Telegram tashqarisida skaner tugmasi yo‘q', async () => {
    open()
    await screen.findByRole('region', { name: tm.chooseMaterial })
    expect(screen.queryByRole('button', { name: ta.scanReceipt })).not.toBeInTheDocument()
  })
})

describe('Batch 12 (G) — qisman bo‘sh 200 javob', () => {
  it('chek jami noma’lum (null) — tasdiqlanmagan (server bilan bir xil: receiptVerified), rasm majburiyati qoladi', async () => {
    tg.app = telegramApp()
    vi.mocked(materialsRepo.listMaterials).mockResolvedValue([{ ...sement, photo_required: true }, qum])
    vi.mocked(receiptRepo.receiptLookup).mockResolvedValue({
      sellerName: null,
      sellerTin: null,
      datetime: null,
      total: null,
      items: [],
      fiscalSign: null,
      terminalId: null,
      receiptNo: null,
      verified: true,
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: ta.scanReceipt }))
    expect(await screen.findByTestId('receipt-card')).not.toHaveAttribute('data-verified')
    await pickMaterial('Sement')
    fill('2', '100000')
    // Material "rasm majburiy" — QR ozod qilmaydi (chek jami noma'lum)
    expect(await screen.findByTestId('photo-required')).toBeInTheDocument()
    await pressMain()
    expect(purchasesRepo.createPurchase).not.toHaveBeenCalled()
  })

  it('audit 3 (E6): server tasdiqlamagan chek (verified: false) — summa mos bo‘lsa ham tasdiqlanmagan, rasm majburiy', async () => {
    tg.app = telegramApp()
    vi.mocked(materialsRepo.listMaterials).mockResolvedValue([{ ...sement, photo_required: true }, qum])
    vi.mocked(receiptRepo.receiptLookup).mockResolvedValue({
      sellerName: null,
      sellerTin: null,
      datetime: new Date().toISOString(),
      total: '100000',
      items: [],
      fiscalSign: null,
      terminalId: null,
      receiptNo: null,
      verified: false,
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: ta.scanReceipt }))
    await screen.findByTestId('receipt-card')
    await pickMaterial('Sement')
    fill('2', '100000')
    expect(await screen.findByTestId('receipt-card')).not.toHaveAttribute('data-verified')
    expect(await screen.findByTestId('photo-required')).toBeInTheDocument()
  })

  it('chek jami summaga mos va sana ±3 kun ichida — tasdiqlangan, rasm majburiyati yo‘q', async () => {
    tg.app = telegramApp()
    vi.mocked(materialsRepo.listMaterials).mockResolvedValue([{ ...sement, photo_required: true }, qum])
    vi.mocked(receiptRepo.receiptLookup).mockResolvedValue({
      sellerName: null,
      sellerTin: null,
      datetime: new Date().toISOString(),
      total: '100000',
      items: [],
      fiscalSign: null,
      terminalId: null,
      receiptNo: null,
      verified: true,
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: ta.scanReceipt }))
    await screen.findByTestId('receipt-card')
    await pickMaterial('Sement')
    fill('2', '100000')
    expect(await screen.findByTestId('receipt-card')).toHaveAttribute('data-verified', 'true')
    expect(screen.queryByTestId('photo-required')).not.toBeInTheDocument()
    await pressMain()
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalled())
    expect(vi.mocked(purchasesRepo.createPurchase).mock.calls[0]?.[0].receipt).toMatchObject({ verified: true, total: '100000' })
  })
})

describe('Batch 12 (H) — tasdiqlangan so‘rov', () => {
  it('chip bosilsa — material, birlik, miqdor to‘ladi va requestId yuboriladi', async () => {
    vi.mocked(requestsRepo.listApprovedRequests).mockResolvedValue([approvedRequest()])
    open()
    fireEvent.click(await screen.findByTestId('approved-request'))
    expect(requestsRepo.listApprovedRequests).toHaveBeenCalledWith('o-a')
    expect(await screen.findByTestId('request-tag')).toHaveTextContent(ta.byRequest('40', 'qop'))
    expect(screen.getByLabelText(tm.qty)).toHaveValue('40')
    expect(within(screen.getByRole('group', { name: tm.unit })).getByRole('button', { name: 'qop' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByLabelText(tp.sum), { target: { value: '2000000' } })
    fireEvent.click(screen.getByRole('button', { name: tp.save }))
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalled())
    expect(vi.mocked(purchasesRepo.createPurchase).mock.calls[0]?.[0].requestId).toBe('rq-1')
  })

  it('obyekt o‘zgarsa — tanlangan so‘rov tozalanadi', async () => {
    vi.mocked(objectsRepo.listObjects).mockResolvedValue([objA, makeObject('o-b', 'Obyekt B')])
    // Xarid obyekti — kirim/chiqimnikidan alohida kalit
    window.localStorage.setItem('terron.purchase.object', 'o-a')
    vi.mocked(requestsRepo.listApprovedRequests).mockImplementation(async (id) => (id === 'o-a' ? [approvedRequest()] : []))
    open()
    fireEvent.click(await screen.findByTestId('approved-request'))
    expect(await screen.findByTestId('request-tag')).toBeInTheDocument()
    // Obyekt satridagi "O'zgartirish" (birinchisi; ikkinchisi — material)
    fireEvent.click(screen.getAllByRole('button', { name: tm.change })[0] as HTMLElement)
    const chooser = await screen.findByRole('region', { name: tm.chooseObject })
    fireEvent.click(within(chooser).getByRole('button', { name: /Obyekt B/ }))
    fireEvent.change(await screen.findByLabelText(tp.sum), { target: { value: '2000000' } })
    expect(screen.queryByTestId('request-tag')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tp.save }))
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalled())
    expect(vi.mocked(purchasesRepo.createPurchase).mock.calls[0]?.[0]).toMatchObject({ objectId: 'o-b', requestId: null })
  })

  it('"So‘rovsiz" — requestId yuborilmaydi', async () => {
    vi.mocked(requestsRepo.listApprovedRequests).mockResolvedValue([approvedRequest()])
    open()
    fireEvent.click(await screen.findByTestId('approved-request'))
    fireEvent.click(await screen.findByRole('button', { name: ta.clearRequest }))
    fireEvent.change(screen.getByLabelText(tp.sum), { target: { value: '2000000' } })
    fireEvent.click(screen.getByRole('button', { name: tp.save }))
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalled())
    expect(vi.mocked(purchasesRepo.createPurchase).mock.calls[0]?.[0].requestId).toBeNull()
  })
})

describe('Batch 12 (C, E) — takroriy xarid va rasm majburiy', () => {
  it('xuddi shunday xarid (miqdor va summa) — ogohlantirish; "Baribir saqlash"', async () => {
    vi.mocked(purchasesRepo.listMyPurchases).mockResolvedValue([savedPurchase()])
    open()
    await pickMaterial('Sement')
    fill('3', '1250000')
    fireEvent.click(within(screen.getByRole('group', { name: tm.unit })).getByRole('button', { name: 'qop' }))
    fireEvent.click(screen.getByRole('button', { name: tp.save }))
    const warning = await screen.findByTestId('duplicate-warning')
    expect(purchasesRepo.createPurchase).not.toHaveBeenCalled()
    fireEvent.click(within(warning).getByRole('button', { name: ta.duplicateSave }))
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalledTimes(1))
  })

  it('summa chegaradan katta — chek rasmi majburiy; Saqlash bosilsa saqlanmaydi, rasm maydoniga aylantiriladi', async () => {
    vi.mocked(companiesRepo.getCompanySettings).mockResolvedValue({
      ...companiesRepo.DEFAULT_COMPANY_SETTINGS,
      photoRequiredAmount: '1000000',
    })
    open()
    await pickMaterial('Sement')
    fill('3', '900000')
    expect(screen.queryByTestId('photo-required')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(tp.sum), { target: { value: '1000000' } })
    expect(await screen.findByTestId('photo-required')).toBeInTheDocument()
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    expect(screen.getByRole('button', { name: tp.save })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: tp.save }))
    expect(purchasesRepo.createPurchase).not.toHaveBeenCalled()
    expect(scroll.mock.contexts[0]).toHaveAttribute('data-photo-field')
  })

  it('material "rasm majburiy" — QR tasdiqlangan chek bo‘lsa rasmsiz ham', async () => {
    tg.app = telegramApp()
    vi.mocked(materialsRepo.listMaterials).mockResolvedValue([{ ...sement, photo_required: true }, qum])
    vi.mocked(receiptRepo.receiptLookup).mockResolvedValue({
      sellerName: null,
      sellerTin: null,
      datetime: null,
      total: '250000',
      items: [{ name: 'Sement', qty: '5', price: '50000', sum: '250000', unit: null }],
      fiscalSign: '1',
      terminalId: 'UZ1',
      receiptNo: '1',
      verified: true,
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: ta.scanReceipt }))
    await screen.findByTestId('receipt-card')
    expect(screen.queryByTestId('photo-required')).not.toBeInTheDocument()
    await pressMain()
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalled())
  })
})
