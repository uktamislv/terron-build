// Audit tuzatishlari — veb panel: xarid qo'shish, admin tuzatishi, sotuvchilar, podotchet izohi,
// alertni yopish sababi, sozlamalar (tinch soatlar, Telegram holati), foydalanuvchilar, tekshiruvchi,
// ish xabarlari, Excel tugmalari.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import * as adminUsersRepo from '@/data/adminUsersRepo'
import * as alertsRepo from '@/data/alertsRepo'
import * as authRepo from '@/data/authRepo'
import * as cashRepo from '@/data/cashRepo'
import * as companiesRepo from '@/data/companiesRepo'
import * as correctionsRepo from '@/data/correctionsRepo'
import * as inventoryRepo from '@/data/inventoryRepo'
import * as materialsRepo from '@/data/materialsRepo'
import * as movementsRepo from '@/data/movementsRepo'
import * as profilesRepo from '@/data/profilesRepo'
import * as purchasesRepo from '@/data/purchasesRepo'
import * as suppliersRepo from '@/data/suppliersRepo'
import type { Alert, InventoryCount, Movement, Purchase, Supplier } from '@/data/types'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { COMPANY_ID, makeMaterial, makeObject, makeProfile, makeUnit } from '@/test/fixtures'

vi.mock('@/data/systemRepo', () => ({ isConfigured: () => true, getSystemStatus: () => ({ supabaseConfigured: true }) }))
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
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn(async () => [makeObject('o-a', 'Obyekt A')]) }))
vi.mock('@/data/objectMembersRepo', () => ({ listObjectMembers: vi.fn(async () => []) }))
vi.mock('@/data/materialsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/materialsRepo')>()),
  listMaterials: vi.fn(),
  getMaterial: vi.fn(),
}))
vi.mock('@/data/profileDirectory', async (orig) => {
  const people = () => [makeProfile('taminotchi', { id: 'p-tam', full_name: 'Vali ta’minotchi' }), makeProfile('haydovchi', { id: 'p-hay', full_name: 'Ali haydovchi' })]
  return { ...(await orig<typeof import('@/data/profileDirectory')>()), listDirectory: vi.fn(async () => people()), listActiveDirectory: vi.fn(async () => people()) }
})
vi.mock('@/data/profilesRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/profilesRepo')>()),
  listProfiles: vi.fn(async () => []),
  setMyNotifyWorkflow: vi.fn(async () => undefined),
}))
vi.mock('@/data/purchasesRepo', () => ({
  listPurchases: vi.fn(),
  listAllPurchases: vi.fn(async () => []),
  listMyPurchases: vi.fn(async () => []),
  createPurchase: vi.fn(),
  checkPurchasePrice: vi.fn(async () => 'high'),
  softDeletePurchase: vi.fn(async () => undefined),
  restorePurchase: vi.fn(async () => undefined),
  PURCHASES_PAGE_SIZE: 50,
}))
vi.mock('@/data/suppliersRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/suppliersRepo')>()),
  listSuppliers: vi.fn(async () => []),
  listAllSuppliers: vi.fn(async () => []),
  createSupplier: vi.fn(),
  mergeSuppliers: vi.fn(async () => 2),
  updateSupplier: vi.fn(async () => undefined),
  softDeleteSupplier: vi.fn(async () => undefined),
  restoreSupplier: vi.fn(async () => undefined),
}))
vi.mock('@/data/requestsRepo', () => ({ listApprovedRequests: vi.fn(async () => []) }))
vi.mock('@/data/movementsRepo', () => ({
  listMovements: vi.fn(async () => ({ rows: [], total: 0 })),
  listAllMovements: vi.fn(async () => []),
  softDeleteMovement: vi.fn(),
  restoreMovement: vi.fn(),
  MOVEMENTS_PAGE_SIZE: 50,
}))
vi.mock('@/data/stockRepo', () => ({ listStock: vi.fn(async () => []), listAllStock: vi.fn(async () => []) }))
vi.mock('@/data/alertsRepo', () => ({
  listAlerts: vi.fn(async () => ({ rows: [], total: 0 })),
  listAllAlerts: vi.fn(async () => []),
  listRecentAlerts: vi.fn(async () => []),
  markAlertSeen: vi.fn(async () => undefined),
  closeAlert: vi.fn(async () => undefined),
  CLOSE_NOTE_MAX: 500,
  ALERTS_PAGE_SIZE: 50,
}))
vi.mock('@/data/companiesRepo', async (orig) => {
  const actual = await orig<typeof import('@/data/companiesRepo')>()
  return {
    ...actual,
    getCompanySettings: vi.fn(async () => actual.DEFAULT_COMPANY_SETTINGS),
    updateCompanySettings: vi.fn(async () => undefined),
    getNotificationHealth: vi.fn(),
  }
})
vi.mock('@/data/cashRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/cashRepo')>()),
  listBalances: vi.fn(async () => []),
  listCashHistory: vi.fn(async () => []),
  updateAdvanceNote: vi.fn(async () => undefined),
}))
vi.mock('@/data/correctionsRepo', async (orig) => ({ ...(await orig<typeof import('@/data/correctionsRepo')>()), correctEntry: vi.fn(async () => undefined) }))
vi.mock('@/data/inventoryRepo', async (orig) => ({ ...(await orig<typeof import('@/data/inventoryRepo')>()), listCounts: vi.fn(async () => ({ rows: [], total: 0 })) }))
vi.mock('@/data/adminUsersRepo', async (orig) => ({ ...(await orig<typeof import('@/data/adminUsersRepo')>()), setLogin: vi.fn() }))
vi.mock('@/data/photosRepo', async (orig) => ({ ...(await orig<typeof import('@/data/photosRepo')>()), signedPhotoUrl: vi.fn(), uploadPhoto: vi.fn() }))
vi.mock('@/data/functions', () => ({ requestPhotoHash: vi.fn(async () => null), invokeFunction: vi.fn() }))

const sement = makeMaterial('m-sem', 'Sement', 'kg', { units: [makeUnit('u-qop', 'm-sem', 'qop', '50')] })

function purchase(over: Partial<Purchase> = {}): Purchase {
  return {
    id: 'pu1',
    company_id: COMPANY_ID,
    buyer_id: 'p-hay',
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
    created_by: 'p-hay',
    created_at: '2026-10-25T05:00:00Z',
    deleted_at: null,
    object_name: 'Obyekt A',
    material_name: 'Sement',
    base_unit: 'kg',
    buyer_name: 'Ali haydovchi',
    supplier_name: null,
    receipt: { received_qty_base: '0', remaining_qty_base: '150', receipt_count: 0, last_received_at: null },
    alert_types: [],
    ...over,
  }
}

function open(path: string, role: Role = 'admin', over: Parameters<typeof makeProfile>[1] = {}) {
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile(role, over))
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(materialsRepo.listMaterials).mockResolvedValue([sement])
  vi.mocked(materialsRepo.getMaterial).mockResolvedValue(sement)
  vi.mocked(purchasesRepo.listPurchases).mockResolvedValue({ rows: [], total: 0 })
  vi.mocked(suppliersRepo.listSuppliers).mockResolvedValue([])
  vi.mocked(suppliersRepo.listAllSuppliers).mockResolvedValue([])
  vi.mocked(movementsRepo.listMovements).mockResolvedValue({ rows: [], total: 0 })
  vi.mocked(alertsRepo.listAlerts).mockResolvedValue({ rows: [], total: 0 })
  vi.mocked(cashRepo.listCashHistory).mockResolvedValue([])
  vi.mocked(inventoryRepo.listCounts).mockResolvedValue({ rows: [], total: 0 })
  vi.mocked(profilesRepo.listProfiles).mockResolvedValue([])
})

describe('/purchases — "Xarid qo‘shish" (ta’minotchi, admin)', () => {
  it('ta’minotchi: forma → createPurchase (o‘z nomidan, bugun — sana yuborilmaydi); narx ogohlantirishi', async () => {
    vi.mocked(purchasesRepo.createPurchase).mockResolvedValue(purchase({ id: 'new' }))
    open('/purchases', 'taminotchi')
    fireEvent.click(await screen.findByRole('button', { name: t.purchases.add }))
    const dialog = within(await screen.findByRole('dialog', { name: t.purchases.addForm.title }))
    await dialog.findByRole('group', { name: t.tg.movement.material })
    // Bitta obyekt — avtomatik tanlangan; material — qidiruv natijasidan
    fireEvent.click(dialog.getByRole('button', { name: /Sement/ }))
    fireEvent.click(dialog.getByRole('button', { name: 'qop' }))
    fireEvent.change(dialog.getByLabelText(t.tg.movement.qty), { target: { value: '3' } })
    fireEvent.change(dialog.getByLabelText(t.tg.purchase.sum), { target: { value: '1250000' } })
    expect(dialog.getByLabelText(t.tg.purchase.sum)).toHaveValue('1 250 000')
    expect(await dialog.findByText(t.tg.purchase.priceHigh)).toBeInTheDocument()
    // Taminotchi uchun xaridor tanlovi yo'q
    expect(dialog.queryByLabelText(t.purchases.addForm.buyer)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.common.save }))
    await waitFor(() => expect(purchasesRepo.createPurchase).toHaveBeenCalled())
    expect(vi.mocked(purchasesRepo.createPurchase).mock.calls[0]?.[0]).toMatchObject({
      objectId: 'o-a',
      materialId: 'm-sem',
      unitId: 'u-qop',
      qtyInput: '3',
      totalAmount: '1250000',
      buyerId: makeProfile('taminotchi').id,
      purchasedAt: null,
      supplierId: null,
      receiptPhotoPath: null,
      requestId: null,
    })
    expect(await screen.findByText(t.purchases.added('Sement'))).toBeInTheDocument()
  })

  it('direktor — tugma yo‘q; sotuvchi filtri so‘rovga tushadi', async () => {
    vi.mocked(suppliersRepo.listSuppliers).mockResolvedValue([{ id: 's1', name: 'Bozor', company_id: COMPANY_ID, phone: null, note: null, created_at: '', deleted_at: null }])
    open('/purchases', 'direktor')
    await screen.findByRole('heading', { name: t.purchases.title })
    expect(screen.queryByRole('button', { name: t.purchases.add })).not.toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText(t.purchases.filterSupplier), { target: { value: 's1' } })
    await waitFor(() => expect(purchasesRepo.listPurchases).toHaveBeenLastCalledWith(expect.objectContaining({ supplierId: 's1' }), 0))
  })

  it('admin: xaridor tanlovi (directory) bor', async () => {
    open('/purchases', 'admin')
    fireEvent.click(await screen.findByRole('button', { name: t.purchases.add }))
    const dialog = within(await screen.findByRole('dialog', { name: t.purchases.addForm.title }))
    const buyer = await dialog.findByLabelText(t.purchases.addForm.buyer)
    expect(within(buyer).getByRole('option', { name: /Ali haydovchi/ })).toBeInTheDocument()
  })
})

describe('admin tuzatishi (correct_entry, istalgan vaqtda)', () => {
  it('xarid tafsilotida "Tuzatish" — kirimga bog‘lanmagan; sabab bilan RPC', async () => {
    vi.mocked(purchasesRepo.listPurchases).mockResolvedValue({ rows: [purchase()], total: 1 })
    open('/purchases', 'admin')
    const [row] = await screen.findAllByTestId('purchase-row')
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: t.ui.actions }))
    fireEvent.click(within(row as HTMLElement).getByRole('menuitem', { name: t.purchases.open }))
    const detail = await screen.findByRole('dialog')
    fireEvent.click(await within(detail).findByRole('button', { name: t.correction.action }))
    const form = within(await screen.findByRole('dialog', { name: t.correction.title }))
    fireEvent.change(form.getByLabelText(t.correction.total), { target: { value: '1200000' } })
    fireEvent.change(form.getByLabelText(t.correction.note), { target: { value: 'chekda 1 200 000' } })
    fireEvent.click(form.getByRole('button', { name: t.correction.save }))
    await waitFor(() =>
      expect(correctionsRepo.correctEntry).toHaveBeenCalledWith({
        table: 'purchases',
        id: 'pu1',
        qtyInput: null,
        unitId: null,
        totalAmount: '1200000',
        note: 'chekda 1 200 000',
      }),
    )
  })

  it('kirimga bog‘langan xarid — "Tuzatish" yo‘q; direktor — yo‘q', async () => {
    vi.mocked(purchasesRepo.listPurchases).mockResolvedValue({
      rows: [purchase({ receipt: { received_qty_base: '150', remaining_qty_base: '0', receipt_count: 1, last_received_at: null } })],
      total: 1,
    })
    open('/purchases', 'admin')
    const [row] = await screen.findAllByTestId('purchase-row')
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: t.ui.actions }))
    fireEvent.click(within(row as HTMLElement).getByRole('menuitem', { name: t.purchases.open }))
    const detail = await screen.findByRole('dialog')
    await within(detail).findByText(t.purchases.noLinked)
    expect(within(detail).queryByRole('button', { name: t.correction.action })).not.toBeInTheDocument()
  })

  it('ombor: admin — harakat menyusida "Tuzatish"', async () => {
    const m = {
      id: 'mv1',
      company_id: COMPANY_ID,
      type: 'chiqim',
      object_id: 'o-a',
      material_id: 'm-sem',
      unit_id: 'u-qop',
      qty_input: '2',
      unit_input: 'qop',
      unit_variant: null,
      qty_base: '100',
      purchase_id: null,
      photo_path: null,
      occurred_at: '2026-09-01T05:00:00Z',
      note: null,
      created_by: 'p-prorab',
      created_at: '2026-09-01T05:00:00Z',
      deleted_at: null,
      object_name: 'Obyekt A',
      material_name: 'Sement',
      base_unit: 'kg',
      created_by_name: 'Prorab',
    } as Movement
    vi.mocked(movementsRepo.listMovements).mockResolvedValue({ rows: [m], total: 1 })
    open('/movements', 'admin')
    const actions = await screen.findAllByRole('button', { name: t.ui.actions })
    fireEvent.click(actions[0] as HTMLElement)
    fireEvent.click(await screen.findByRole('menuitem', { name: t.correction.action }))
    const form = within(await screen.findByRole('dialog', { name: t.correction.title }))
    expect(form.getByText(t.correction.adminHint)).toBeInTheDocument()
    fireEvent.change(form.getByLabelText(t.correction.qty), { target: { value: '3' } })
    fireEvent.change(form.getByLabelText(t.correction.note), { target: { value: 'sanoq xatosi' } })
    fireEvent.click(form.getByRole('button', { name: t.correction.save }))
    await waitFor(() => expect(correctionsRepo.correctEntry).toHaveBeenCalledWith(expect.objectContaining({ table: 'movements', id: 'mv1', qtyInput: '3' })))
  })
})

describe('Materiallar → Sotuvchilar (admin)', () => {
  const s = (id: string, name: string, over: Partial<Supplier> = {}): Supplier => ({
    id,
    company_id: COMPANY_ID,
    name,
    phone: null,
    note: null,
    tin: null,
    created_at: '',
    deleted_at: null,
    ...over,
  })

  it('birlashtirish: tanlash → tasdiq → merge_suppliers; o‘chirilgan — tiklash', async () => {
    vi.mocked(suppliersRepo.listAllSuppliers).mockResolvedValue([s('s1', 'Bozor'), s('s2', 'Bozor (eski)'), s('s3', 'Yopiq', { deleted_at: '2026-10-01T00:00:00Z' })])
    open('/materials?tab=suppliers', 'admin')
    const rows = await screen.findAllByTestId('supplier-row')
    expect(rows).toHaveLength(3)
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: t.ui.actions }))
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('menuitem', { name: t.suppliers.merge }))
    const dialog = within(await screen.findByRole('dialog', { name: t.suppliers.mergeTitle }))
    fireEvent.change(dialog.getByLabelText(t.suppliers.mergeInto), { target: { value: 's1' } })
    fireEvent.click(screen.getByRole('button', { name: t.suppliers.mergeNext }))
    expect(dialog.getByText(t.suppliers.mergeWarning('Bozor (eski)', 'Bozor'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.suppliers.mergeConfirm }))
    await waitFor(() => expect(suppliersRepo.mergeSuppliers).toHaveBeenCalledWith('s1', 's2'))
    expect(await screen.findByText(t.suppliers.merged('Bozor (eski)', 'Bozor', 2))).toBeInTheDocument()

    // Ro'yxat qayta yuklangan — qatorlar qayta olinadi
    const fresh = (await screen.findAllByTestId('supplier-row'))[2] as HTMLElement
    fireEvent.click(within(fresh).getByRole('button', { name: t.ui.actions }))
    fireEvent.click(within(fresh).getByRole('menuitem', { name: t.suppliers.restore }))
    await waitFor(() => expect(suppliersRepo.restoreSupplier).toHaveBeenCalledWith('s3'))
  })

  it('tahrirlash: noto‘g‘ri STIR — xato; to‘g‘ri — updateSupplier', async () => {
    vi.mocked(suppliersRepo.listAllSuppliers).mockResolvedValue([s('s1', 'Bozor')])
    open('/materials?tab=suppliers', 'admin')
    const [row] = await screen.findAllByTestId('supplier-row')
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: t.ui.actions }))
    fireEvent.click(within(row as HTMLElement).getByRole('menuitem', { name: t.common.edit }))
    const dialog = within(await screen.findByRole('dialog', { name: t.suppliers.editTitle }))
    fireEvent.change(dialog.getByLabelText(t.suppliers.colTin), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: t.common.save }))
    expect(await dialog.findByText(t.suppliers.errTin)).toBeInTheDocument()
    fireEvent.change(dialog.getByLabelText(t.suppliers.colTin), { target: { value: '123456789' } })
    fireEvent.click(screen.getByRole('button', { name: t.common.save }))
    await waitFor(() => expect(suppliersRepo.updateSupplier).toHaveBeenCalledWith('s1', { name: 'Bozor', phone: '', tin: '123456789', note: '' }))
  })

  it('ta’minotchi — "Sotuvchilar" bo‘limi yo‘q', async () => {
    open('/materials?tab=suppliers', 'taminotchi')
    await screen.findByRole('heading', { name: t.materials.title })
    expect(screen.queryByRole('tab', { name: t.suppliers.title })).not.toBeInTheDocument()
    expect(suppliersRepo.listAllSuppliers).not.toHaveBeenCalled()
  })
})

describe('/cash — izohni tahrirlash (summa va sana o‘zgarmaydi)', () => {
  it('admin: tafsilotdan "Izohni tahrirlash" → updateAdvanceNote', async () => {
    vi.mocked(cashRepo.listCashHistory).mockResolvedValue([
      { kind: 'issued', id: 'a1', profileId: 'p-hay', profileName: 'Ali haydovchi', amount: '500000', at: '2026-10-25T05:00:00Z', note: 'eski', createdByName: 'Admin', deletedAt: null },
    ])
    open('/cash', 'admin')
    fireEvent.click(await screen.findByText(t.cash.kinds.issued, { selector: 'span' }))
    fireEvent.click(await screen.findByRole('button', { name: t.cash.editNote }))
    const dialog = within(await screen.findByRole('dialog', { name: t.cash.editNote }))
    expect(dialog.getByLabelText(t.cash.note)).toHaveValue('eski')
    fireEvent.change(dialog.getByLabelText(t.cash.note), { target: { value: 'yangi izoh' } })
    fireEvent.click(screen.getByRole('button', { name: t.common.save }))
    await waitFor(() => expect(cashRepo.updateAdvanceNote).toHaveBeenCalledWith('a1', 'yangi izoh'))
  })
})

describe('/alerts — yopish sababi majburiy', () => {
  it('bo‘sh sabab — xato, closeAlert chaqirilmaydi', async () => {
    const a = {
      id: 'a1',
      company_id: COMPANY_ID,
      type: 'sozlama_ozgardi',
      status: 'yangi',
      severity: 'ogohlantirish',
      object_id: null,
      material_id: null,
      purchase_id: null,
      movement_id: null,
      details: { changes: [{ key: 'price_deviation_pct', before: 8, after: 20 }], actor_name: 'Admin' },
      closed_by: null,
      closed_at: null,
      close_note: null,
      created_at: '2026-10-25T05:00:00Z',
      deleted_at: null,
      object_name: null,
      material_name: null,
      base_unit: null,
    } as Alert
    vi.mocked(alertsRepo.listAlerts).mockResolvedValue({ rows: [a], total: 1 })
    open('/alerts', 'admin')
    const [row] = await screen.findAllByTestId('alert-row')
    expect(within(row as HTMLElement).getByText(t.alertTexts.types.sozlama_ozgardi)).toBeInTheDocument()
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: t.alertsPage.close }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(t.alertsPage.closeNote)).toBeRequired()
    fireEvent.click(within(dialog).getAllByRole('button', { name: t.alertsPage.close }).at(-1) as HTMLElement)
    expect(await within(dialog).findByText(t.alertsPage.closeNoteRequired)).toBeInTheDocument()
    expect(alertsRepo.closeAlert).not.toHaveBeenCalled()
  })
})

describe('/settings — tinch soatlar va Telegram holati', () => {
  it('tinch soatlarni o‘chirish — ikkala ustun null', async () => {
    open('/settings', 'admin')
    const toggle = await screen.findByRole('checkbox', { name: t.settings.quietEnabled })
    expect(toggle).toBeChecked()
    expect(screen.getByLabelText(t.settings.quietStart)).toHaveValue('22:00')
    fireEvent.click(toggle)
    expect(screen.getByText(t.settings.quietOff)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.common.save }))
    await waitFor(() =>
      expect(companiesRepo.updateCompanySettings).toHaveBeenCalledWith(COMPANY_ID, expect.objectContaining({ quietHoursStart: null, quietHoursEnd: null })),
    )
  })

  it('narx og‘ishi 60% — xato (≤ 50)', async () => {
    open('/settings', 'admin')
    const field = await screen.findByLabelText(t.settings.priceDeviationPct)
    fireEvent.change(field, { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: t.common.save }))
    expect(await screen.findByText(t.settings.errPct(50))).toBeInTheDocument()
    expect(companiesRepo.updateCompanySettings).not.toHaveBeenCalled()
  })

  it('Telegram bo‘limi: tiqilib qolgan — danger, sozlash maslahati, bloklaganlar', async () => {
    vi.mocked(companiesRepo.getNotificationHealth).mockResolvedValue({
      lastSentAt: null,
      stuckPendingCount: 3,
      failed7dCount: 1,
      lastErrors: [{ id: 'o1', kind: 'alert', status: 'failed', lastError: 'Forbidden: bot was blocked', attempts: 5, updatedAt: null }],
      blockedProfiles: [{ profileId: 'p1', fullName: 'Ali', role: 'prorab', blockedAt: '2026-10-25T05:00:00Z' }],
    })
    open('/settings?tab=telegram', 'admin')
    expect(await screen.findByTestId('telegram-health')).toHaveAttribute('data-level', 'danger')
    expect(screen.getByText(t.settings.health.fixHint)).toBeInTheDocument()
    expect(screen.getByText('Forbidden: bot was blocked')).toBeInTheDocument()
    expect(screen.getByText(t.settings.health.blockedHint)).toBeInTheDocument()
    expect(screen.getByText(t.settings.health.never)).toBeInTheDocument()
  })
})

describe('/users — bot bloklangan, himoyalangan profil', () => {
  it('belgi va himoya: admin direktorni nofaol qila olmaydi, rol tanlanmaydi', async () => {
    vi.mocked(profilesRepo.listProfiles).mockResolvedValue([
      makeProfile('admin'),
      makeProfile('direktor', { id: 'p-dir', full_name: 'Direktor Aka' }),
      makeProfile('prorab', { id: 'p-pr', full_name: 'Prorab Uka', telegram_blocked_at: '2026-10-25T05:00:00Z' }),
    ])
    open('/users', 'admin')
    const card = async (name: string) => within((await screen.findByText(name)).closest('li') as HTMLElement)
    const prorab = await card('Prorab Uka')
    expect(prorab.getByText(t.users.botBlocked)).toBeInTheDocument()
    expect(prorab.getByRole('button', { name: t.users.deactivate })).toBeInTheDocument()
    const dir = await card('Direktor Aka')
    expect(dir.getByText(t.users.protectedBadge)).toBeInTheDocument()
    expect(dir.queryByRole('button', { name: t.users.deactivate })).not.toBeInTheDocument()
    fireEvent.click(dir.getByRole('button', { name: t.common.edit }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByLabelText(t.users.phone)).toBeDisabled()
    expect(dialog.queryByRole('radio', { name: t.roles.prorab })).not.toBeInTheDocument()
  })

  it('login almashtirilsa — ogohlantirish (egasiga xabar boradi)', async () => {
    vi.mocked(profilesRepo.listProfiles).mockResolvedValue([makeProfile('admin'), makeProfile('prorab', { id: 'p-pr', full_name: 'Prorab Uka', login_kind: 'web' })])
    vi.mocked(adminUsersRepo.setLogin).mockResolvedValue({ login: '+998901234567', loginKind: 'web', existingLoginReplaced: true })
    open('/users', 'admin')
    const card = within((await screen.findByText('Prorab Uka')).closest('li') as HTMLElement)
    fireEvent.click(card.getByRole('button', { name: t.users.resetPassword }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.change(dialog.getByLabelText(t.login.password), { target: { value: 'yangi-parol-1' } })
    fireEvent.click(dialog.getByRole('button', { name: t.login.submit }))
    expect(await screen.findByText(t.login.replacedWarning)).toBeInTheDocument()
  })
})

describe('tekshiruvchi va ish xabarlari', () => {
  it('tekshiruvchi bosh sahifasi — oxirgi sanashlari', async () => {
    vi.mocked(inventoryRepo.listCounts).mockResolvedValue({
      rows: [{ id: 'c1', object_name: 'Obyekt A', status: 'submitted', applied_at: null, item_count: 7, created_at: '2026-10-25T05:00:00Z' } as InventoryCount],
      total: 1,
    })
    open('/', 'tekshiruvchi')
    const item = await screen.findByTestId('inspector-count')
    expect(item).toHaveTextContent('Obyekt A')
    expect(item).toHaveTextContent(t.inventory.statuses.submitted)
    expect(inventoryRepo.listCounts).toHaveBeenCalledWith({ createdBy: makeProfile('tekshiruvchi').id })
  })

  it('Yordam sahifasida "Ish xabarlari" — o‘chiq profil yoqiladi', async () => {
    open('/help', 'buxgalter', { notify_workflow: false })
    const toggle = await screen.findByRole('switch', { name: t.settings.notify.toggle })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    await waitFor(() => expect(profilesRepo.setMyNotifyWorkflow).toHaveBeenCalledWith(makeProfile('buxgalter').id, true))
  })

  it('prorab — Smeta (faqat ko‘rish) menyuda', async () => {
    open('/estimates', 'prorab')
    expect(await screen.findByText(t.estimates.readOnly)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.estimates.upload })).not.toBeInTheDocument()
  })
})

describe('Excel tugmalari (yangi)', () => {
  it('Materiallar sahifasida Excel (katalog va birliklar varag‘i — auditWeb.pure.test)', async () => {
    open('/materials', 'buxgalter')
    expect(await screen.findByRole('button', { name: t.excel.button })).toBeInTheDocument()
  })
})
