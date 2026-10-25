import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import * as alertsRepo from '@/data/alertsRepo'
import * as authRepo from '@/data/authRepo'
import * as cashRepo from '@/data/cashRepo'
import * as movementsRepo from '@/data/movementsRepo'
import * as purchasesRepo from '@/data/purchasesRepo'
import type { Alert, CashAdvance, CashBalance, Purchase } from '@/data/types'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { COMPANY_ID, makeObject, makeProfile } from '@/test/fixtures'
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
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn(async () => [makeObject('o-a', 'Obyekt A')]) }))
vi.mock('@/data/materialsRepo', () => ({ listMaterials: vi.fn(async () => []) }))
vi.mock('@/data/profilesRepo', () => ({
  listProfiles: vi.fn(async () => [
    makeProfile('haydovchi', { full_name: 'Ali haydovchi' }),
    makeProfile('taminotchi', { full_name: 'Vali taminotchi' }),
    makeProfile('omborchi', { full_name: 'Omborchi' }),
  ]),
}))
vi.mock('@/data/cashRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/cashRepo')>()),
  listBalances: vi.fn(),
  listCashHistory: vi.fn(async () => []),
  issueAdvance: vi.fn(),
  softDeleteAdvance: vi.fn(async () => undefined),
  restoreAdvance: vi.fn(async () => undefined),
}))
vi.mock('@/data/purchasesRepo', () => ({
  listPurchases: vi.fn(),
  softDeletePurchase: vi.fn(async () => undefined),
  restorePurchase: vi.fn(async () => undefined),
  PURCHASES_PAGE_SIZE: 50,
}))
vi.mock('@/data/movementsRepo', () => ({ listMovements: vi.fn(async () => ({ rows: [], total: 0 })) }))
vi.mock('@/data/alertsRepo', () => ({
  listAlerts: vi.fn(),
  markAlertSeen: vi.fn(async () => undefined),
  closeAlert: vi.fn(async () => undefined),
  CLOSE_NOTE_MAX: 500,
  ALERTS_PAGE_SIZE: 50,
}))
vi.mock('@/data/companiesRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/companiesRepo')>()),
  getCompanySettings: vi.fn(async () => ({ receiptMismatchPct: '2', priceDeviationPct: '8', priceAvgWindow: 5 })),
}))
vi.mock('@/data/photosRepo', () => ({ signedPhotoUrl: vi.fn() }))

function bal(profileId: string, balance: string): CashBalance {
  return { ...cashRepo.emptyBalance(COMPANY_ID, profileId), issued_total: '1000000', spent_total: '0', balance }
}

function purchase(id: string, received: string | null, overrides: Partial<Purchase> = {}): Purchase {
  return {
    id,
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
    material_name: `Sement ${id}`,
    base_unit: 'kg',
    buyer_name: 'Ali haydovchi',
    supplier_name: null,
    receipt:
      received === null
        ? null
        : { received_qty_base: received, remaining_qty_base: '0', receipt_count: 1, last_received_at: null },
    alert_types: [],
    ...overrides,
  }
}

function alert(id: string, overrides: Partial<Alert> = {}): Alert {
  return {
    id,
    company_id: COMPANY_ID,
    type: 'narx_ogishi',
    status: 'yangi',
    severity: 'ogohlantirish',
    object_id: 'o-a',
    material_id: 'm-sem',
    purchase_id: 'pu1',
    movement_id: null,
    details: { avg: '1300', price: '1456', diff_pct: '12.00', window: 5 },
    closed_by: null,
    closed_at: null,
    close_note: null,
    created_at: '2026-10-25T05:00:00Z',
    deleted_at: null,
    object_name: 'Obyekt A',
    material_name: 'Sement',
    base_unit: 'kg',
    ...overrides,
  }
}

function open(path: string, role: Role = 'admin') {
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile(role))
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(cashRepo.listBalances).mockResolvedValue([bal('p-haydovchi', '-150000'), bal('p-taminotchi', '400000')])
})

describe('/cash', () => {
  it('balans ranglari: manfiy qizil, musbat yashil, yo‘q — 0', async () => {
    open('/cash')
    const rows = await screen.findAllByTestId('balance-row')
    const byName = (name: string) => rows.find((r) => r.textContent?.includes(name)) as HTMLElement
    const ali = within(byName('Ali haydovchi')).getByText(textOf('-150 000 so‘m'))
    expect(ali.closest('[data-tone]')).toHaveAttribute('data-tone', 'negative')
    expect(ali.className).toContain('text-danger')
    const vali = within(byName('Vali taminotchi')).getByText(textOf('400 000 so‘m'))
    expect(vali.closest('[data-tone]')).toHaveAttribute('data-tone', 'positive')
    expect(vali.className).toContain('text-ok')
    // Omborchi xarid qilmaydi va balansi yo'q — ro'yxatda emas
    expect(rows.some((r) => r.textContent?.includes('Omborchi'))).toBe(false)
  })

  it('admin pul beradi: summa formatlanadi, issueAdvance chaqiriladi, ro‘yxat yangilanadi', async () => {
    const saved: CashAdvance = {
      id: 'ca1',
      company_id: COMPANY_ID,
      recipient_id: 'p-haydovchi',
      amount: '500000',
      issued_at: '2026-10-25T05:00:00Z',
      note: null,
      created_by: 'p-admin',
      created_at: '2026-10-25T05:00:00Z',
      deleted_at: null,
      recipient_name: 'Ali haydovchi',
      created_by_name: 'Test admin',
    }
    vi.mocked(cashRepo.issueAdvance).mockResolvedValue(saved)
    open('/cash')
    await screen.findAllByTestId('balance-row')
    fireEvent.click(screen.getByRole('button', { name: t.cash.issue }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(t.cash.recipient), { target: { value: 'p-haydovchi' } })
    const amount = within(dialog).getByLabelText(t.cash.amount)
    fireEvent.change(amount, { target: { value: '500000' } })
    expect(amount).toHaveValue('500 000')
    fireEvent.click(within(dialog).getByRole('button', { name: t.cash.issue }))
    await waitFor(() => expect(cashRepo.issueAdvance).toHaveBeenCalledTimes(1))
    expect(vi.mocked(cashRepo.issueAdvance).mock.calls[0]?.[0]).toMatchObject({
      companyId: COMPANY_ID,
      recipientId: 'p-haydovchi',
      amount: '500000',
      issuedAt: null,
    })
    expect(await screen.findByText(t.cash.issued('500 000 so‘m', 'Ali haydovchi'))).toBeInTheDocument()
    expect(cashRepo.listBalances).toHaveBeenCalledTimes(2)
  })

  it('summa noto‘g‘ri — xato, chaqirilmaydi', async () => {
    open('/cash')
    await screen.findAllByTestId('balance-row')
    fireEvent.click(screen.getByRole('button', { name: t.cash.issue }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: t.cash.issue }))
    expect(await within(dialog).findByText(t.cash.errAmount)).toBeInTheDocument()
    expect(within(dialog).getByText(t.cash.errRecipient)).toBeInTheDocument()
    expect(cashRepo.issueAdvance).not.toHaveBeenCalled()
  })

  it('direktor — faqat ko‘radi ("Pul berish" yo‘q)', async () => {
    open('/cash', 'direktor')
    await screen.findAllByTestId('balance-row')
    expect(screen.queryByRole('button', { name: t.cash.issue })).not.toBeInTheDocument()
  })
})

describe('/purchases', () => {
  it('qabul holati (evaluateReceipt, chegara 2%): to‘liq/≈ — yashil, kutilmoqda — sariq, kam/ortiqcha/qabulsiz — qizil', async () => {
    const old = '2020-01-01T05:00:00Z'
    const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    vi.mocked(purchasesRepo.listPurchases).mockResolvedValue({
      rows: [
        purchase('full', '150', { purchased_at: old }),
        purchase('approx', '148', { purchased_at: old }),
        purchase('pending', '100', { purchased_at: fresh }),
        purchase('under', '100', { purchased_at: old }),
        purchase('over', '160', { purchased_at: fresh }),
        purchase('none', '0', { purchased_at: old }),
        purchase('nonefresh', '0', { purchased_at: fresh }),
      ],
      total: 7,
    })
    open('/purchases')
    const rows = await screen.findAllByTestId('purchase-row')
    await waitFor(() => expect(within(rows[1] as HTMLElement).getByTestId('receipt-badge')).toBeInTheDocument())
    const badge = (i: number) => within(rows[i] as HTMLElement).getByTestId('receipt-badge')
    const tone = (i: number) => badge(i).querySelector('[data-tone]')?.getAttribute('data-tone')
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => badge(i).getAttribute('data-state'))).toEqual([
      'full',
      'approx',
      'pending',
      'under',
      'over',
      'none',
      'pending',
    ])
    expect([0, 1, 2, 3, 4, 5].map(tone)).toEqual(['ok', 'ok', 'warn', 'danger', 'danger', 'danger'])
    expect(badge(0)).toHaveTextContent('To‘liq · 150 / 150 kg')
    expect(badge(1)).toHaveTextContent('≈ to‘liq')
    expect(badge(5)).toHaveTextContent('Qabul qilinmagan')
  })

  it('tafsilot: bog‘langan kirimlar va alertlar', async () => {
    vi.mocked(purchasesRepo.listPurchases).mockResolvedValue({
      rows: [purchase('pu1', '100', { alert_types: ['narx_ogishi'] })],
      total: 1,
    })
    vi.mocked(alertsRepo.listAlerts).mockResolvedValue({ rows: [alert('a1')], total: 1 })
    open('/purchases')
    const [row] = await screen.findAllByTestId('purchase-row')
    expect(within(row as HTMLElement).getByText(t.alertTexts.types.narx_ogishi)).toBeInTheDocument()
    // "⋯" menyusidan "Ochish"
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: t.ui.actions }))
    fireEvent.click(within(row as HTMLElement).getByRole('menuitem', { name: t.purchases.open }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(t.purchases.noLinked)).toBeInTheDocument()
    expect(movementsRepo.listMovements).toHaveBeenCalledWith({ purchaseId: 'pu1' }, 0)
    expect(alertsRepo.listAlerts).toHaveBeenCalledWith({ purchaseId: 'pu1' }, 0)
    expect(await within(dialog).findByText('Narx o‘rtachadan 12% yuqori (o‘rtacha 1 300 so‘m)')).toBeInTheDocument()
  })
})

describe('/purchases — amallar', () => {
  it('qatorda ochiq "O‘chirish" yo‘q; tafsilotda o‘chirish tasdiq bilan', async () => {
    vi.mocked(purchasesRepo.listPurchases).mockResolvedValue({ rows: [purchase('pu1', '100')], total: 1 })
    open('/purchases')
    const [row] = await screen.findAllByTestId('purchase-row')
    expect(within(row as HTMLElement).queryByRole('button', { name: t.ombor.delete })).not.toBeInTheDocument()
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: t.ui.actions }))
    fireEvent.click(within(row as HTMLElement).getByRole('menuitem', { name: t.purchases.open }))
    const detail = await screen.findByRole('dialog', { name: t.purchases.detailTitle })
    fireEvent.click(within(detail).getByRole('button', { name: t.ombor.delete }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: t.ombor.delete })).getByRole('button', { name: t.common.yes }))
    await waitFor(() => expect(purchasesRepo.softDeletePurchase).toHaveBeenCalledWith('pu1'))
  })

  it('buxgalter — "⋯" menyusida faqat "Ochish", tafsilotda o‘chirish yo‘q', async () => {
    vi.mocked(purchasesRepo.listPurchases).mockResolvedValue({ rows: [purchase('pu1', '100')], total: 1 })
    open('/purchases', 'buxgalter')
    const [row] = await screen.findAllByTestId('purchase-row')
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: t.ui.actions }))
    expect(within(row as HTMLElement).getAllByRole('menuitem').map((x) => x.textContent)).toEqual([t.purchases.open])
    fireEvent.click(within(row as HTMLElement).getByRole('menuitem', { name: t.purchases.open }))
    const detail = await screen.findByRole('dialog', { name: t.purchases.detailTitle })
    expect(within(detail).queryByRole('button', { name: t.ombor.delete })).not.toBeInTheDocument()
  })
})

describe('/alerts', () => {
  beforeEach(() => {
    vi.mocked(alertsRepo.listAlerts).mockResolvedValue({
      rows: [
        alert('a1'),
        alert('a2', {
          type: 'xarid_qabul_farqi',
          status: 'korildi',
          severity: 'jiddiy',
          details: { purchased_qty_base: '100', received_qty_base: '85', diff_pct: '15.00', direction: 'under' },
        }),
        alert('a3', { type: 'ozi_qabul_qilgan', severity: 'belgi', details: {} }),
      ],
      total: 3,
    })
  })

  it('admin: tafsilotlar o‘zbekcha, "Ko‘rildi" va "Yopish"', async () => {
    open('/alerts')
    const rows = await screen.findAllByTestId('alert-row')
    expect(alertsRepo.listAlerts).toHaveBeenCalledWith(expect.objectContaining({ statuses: ['yangi', 'korildi'] }), 0)
    expect(within(rows[1] as HTMLElement).getByText('Xarid: 100 kg, qabul: 85 kg, farq 15%')).toBeInTheDocument()
    expect(within(rows[2] as HTMLElement).getByText(t.alertsPage.details.self)).toBeInTheDocument()
    // "Ko'rildi" faqat yangi alertda
    expect(within(rows[1] as HTMLElement).queryByRole('button', { name: t.alertsPage.markSeen })).not.toBeInTheDocument()
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: t.alertsPage.markSeen }))
    await waitFor(() => expect(alertsRepo.markAlertSeen).toHaveBeenCalledWith('a1'))
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: t.alertsPage.close }))
    const dialog = await screen.findByRole('dialog')
    const note = within(dialog).getByLabelText(t.alertsPage.closeNote)
    expect(note).toHaveAttribute('maxLength', '500')
    fireEvent.change(note, { target: { value: 'Qolgani ertaga keladi' } })
    // Modal sarlavhasidagi X ham "Yopish" — tasdiq tugmasi oxirgisi
    fireEvent.click(within(dialog).getAllByRole('button', { name: t.alertsPage.close }).at(-1) as HTMLElement)
    await waitFor(() => expect(alertsRepo.closeAlert).toHaveBeenCalledWith('a2', 'Qolgani ertaga keladi'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it.each<Role>(['direktor', 'buxgalter'])('%s — faqat ko‘radi, tugmalar yo‘q', async (role) => {
    open('/alerts', role)
    await screen.findAllByTestId('alert-row')
    expect(screen.queryByRole('button', { name: t.alertsPage.markSeen })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.alertsPage.close })).not.toBeInTheDocument()
  })
})

describe('Batch 5 sharh tuzatishlari', () => {
  it('alert matnlari: narx past (direction low), yozuv o‘chirildi, yopish sababi', async () => {
    vi.mocked(alertsRepo.listAlerts).mockResolvedValue({
      rows: [
        alert('a1', { details: { avg: '1300', price: '900', diff_pct: '-30.77', direction: 'low' } }),
        alert('a2', {
          type: 'yozuv_ochirildi',
          details: { table: 'purchases', material_name: 'Sement', total_amount: '1250000', deleted_by_name: 'Ali' },
        }),
        alert('a3', { status: 'yopildi', close_note: 'Haydovchi tushuntirdi' }),
      ],
      total: 3,
    })
    open('/alerts')
    const rows = await screen.findAllByTestId('alert-row')
    expect(within(rows[0] as HTMLElement).getByText('Narx o‘rtachadan 30,77% past (o‘rtacha 1 300 so‘m)')).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).getByText('Xarid o‘chirildi: Sement · 1 250 000 so‘m (Ali)')).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).getByText(t.alertTexts.types.yozuv_ochirildi)).toBeInTheDocument()
    expect(within(rows[2] as HTMLElement).getByText(/Haydovchi tushuntirdi/)).toBeInTheDocument()
  })

  it('pul berish: avvalgi urinish boshqa summa bilan saqlangan — ogohlantirish va yangi id bilan qayta yuborish', async () => {
    const previous: CashAdvance = {
      id: 'ca1',
      company_id: COMPANY_ID,
      recipient_id: 'p-haydovchi',
      amount: '5000000.00',
      issued_at: '2026-10-25T05:00:00Z',
      note: null,
      created_by: 'p-admin',
      created_at: '2026-10-25T05:00:00Z',
      deleted_at: null,
      recipient_name: 'Ali haydovchi',
      created_by_name: 'Test admin',
    }
    vi.mocked(cashRepo.issueAdvance)
      .mockResolvedValueOnce(previous)
      .mockResolvedValueOnce({ ...previous, id: 'ca2', amount: '500000.00' })
    open('/cash')
    await screen.findAllByTestId('balance-row')
    fireEvent.click(screen.getByRole('button', { name: t.cash.issue }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(t.cash.recipient), { target: { value: 'p-haydovchi' } })
    fireEvent.change(within(dialog).getByLabelText(t.cash.amount), { target: { value: '500000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: t.cash.issue }))
    expect(await within(dialog).findByText(t.cash.previousDiffers('5 000 000 so‘m', 'Ali haydovchi'))).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: t.cash.sendAsNew }))
    expect(await screen.findByText(t.cash.issued('500 000 so‘m', 'Ali haydovchi'))).toBeInTheDocument()
    const ids = vi.mocked(cashRepo.issueAdvance).mock.calls.map((c) => c[0].id)
    expect(ids).toHaveLength(2)
    expect(ids[1]).not.toBe(ids[0])
  })

  it('pul berish: "O‘chirish va qayta berish" — o‘chiradi va shu qiymatlar bilan forma ochadi; buxgalter tiklay olmaydi', async () => {
    vi.mocked(cashRepo.listCashHistory).mockResolvedValue([
      {
        kind: 'issued',
        id: 'ca1',
        profileId: 'p-haydovchi',
        profileName: 'Ali haydovchi',
        amount: '700000.00',
        at: '2026-10-25T05:00:00Z',
        note: 'yoqilg‘i',
        createdByName: 'Test buxgalter',
        deletedAt: null,
      },
      {
        kind: 'issued',
        id: 'ca0',
        profileId: 'p-haydovchi',
        profileName: 'Ali haydovchi',
        amount: '100000.00',
        at: '2026-10-24T05:00:00Z',
        note: null,
        createdByName: 'Test buxgalter',
        deletedAt: '2026-10-24T06:00:00Z',
      },
    ])
    open('/cash', 'buxgalter')
    const rows = await screen.findAllByTestId('cash-history-row')
    // Kartochkada amal tugmalari yo'q — faqat ma'lumot
    expect(within(rows[0] as HTMLElement).queryByRole('button', { name: t.cash.delete })).not.toBeInTheDocument()
    // O'chirilgan yozuv: buxgalter tiklay olmaydi (tafsilotda ham tugma yo'q)
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('button'))
    const deletedDetail = await screen.findByRole('dialog')
    expect(within(deletedDetail).queryByRole('button', { name: t.cash.restore })).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button'))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: t.cash.delete }))
    fireEvent.click(await screen.findByRole('button', { name: t.cash.deleteAndReissue }))
    await waitFor(() => expect(cashRepo.softDeleteAdvance).toHaveBeenCalledWith('ca1'))
    const dialog = await screen.findByRole('dialog', { name: t.cash.issueTitle })
    expect(within(dialog).getByLabelText(t.cash.amount)).toHaveValue('700 000,00')
    expect(within(dialog).getByLabelText(t.cash.recipient)).toHaveValue('p-haydovchi')
  })
})
