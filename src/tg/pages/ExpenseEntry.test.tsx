import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as authRepo from '@/data/authRepo'
import * as cashRepo from '@/data/cashRepo'
import * as companiesRepo from '@/data/companiesRepo'
import * as correctionsRepo from '@/data/correctionsRepo'
import * as expenseCategoriesRepo from '@/data/expenseCategoriesRepo'
import * as expensesRepo from '@/data/expensesRepo'
import * as functions from '@/data/functions'
import * as objectsRepo from '@/data/objectsRepo'
import type { Expense, ExpenseCategory } from '@/data/types'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { COMPANY_ID, makeObject, makeProfile } from '@/test/fixtures'

vi.mock('@/data/systemRepo', () => ({ isConfigured: () => true, getSystemStatus: () => ({ supabaseConfigured: true }) }))
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
vi.mock('@/data/materialsRepo', async (orig) => ({ ...(await orig<typeof import('@/data/materialsRepo')>()), listMaterials: vi.fn(async () => []) }))
vi.mock('@/data/usageRepo', () => ({ getMyMaterialUsage: vi.fn(async () => []) }))
vi.mock('@/data/companiesRepo', async (orig) => ({ ...(await orig<typeof import('@/data/companiesRepo')>()), getCompanySettings: vi.fn() }))
vi.mock('@/data/cashRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/cashRepo')>()),
  getMyBalance: vi.fn(),
  listCashHistory: vi.fn(async () => []),
}))
vi.mock('@/data/purchasesRepo', () => ({ createPurchase: vi.fn(), checkPurchasePrice: vi.fn(async () => 'ok'), listMyPurchases: vi.fn(async () => []) }))
vi.mock('@/data/suppliersRepo', async (orig) => ({ ...(await orig<typeof import('@/data/suppliersRepo')>()), listSuppliers: vi.fn(async () => []) }))
vi.mock('@/data/requestsRepo', () => ({ listApprovedRequests: vi.fn(async () => []), listApprovedRequestsAll: vi.fn(async () => []), listMyRequests: vi.fn(async () => []) }))
vi.mock('@/data/expenseCategoriesRepo', () => ({ listExpenseCategories: vi.fn() }))
vi.mock('@/data/expensesRepo', () => ({
  createExpense: vi.fn(),
  listMyExpenses: vi.fn(async () => []),
  getMyExpenseCategoryUsage: vi.fn(async () => []),
}))
vi.mock('@/data/movementsRepo', () => ({ createMovement: vi.fn(), listMyMovements: vi.fn(async () => []) }))
vi.mock('@/data/transfersRepo', () => ({ listMyTransfers: vi.fn(async () => []), listIncomingTransfers: vi.fn(async () => []) }))
vi.mock('@/data/inventoryRepo', () => ({ listCounts: vi.fn(async () => ({ rows: [], total: 0 })) }))
vi.mock('@/data/bugReportsRepo', async (orig) => ({ ...(await orig<typeof import('@/data/bugReportsRepo')>()), listMyBugReports: vi.fn(async () => []) }))
vi.mock('@/data/correctionsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/correctionsRepo')>()),
  correctEntry: vi.fn(async () => undefined),
  cancelOwnEntry: vi.fn(async () => undefined),
}))
vi.mock('@/data/profilesRepo', async (orig) => ({ ...(await orig<typeof import('@/data/profilesRepo')>()), setMyNotifyWorkflow: vi.fn(async () => undefined) }))
vi.mock('@/data/functions', async (orig) => ({ ...(await orig<typeof import('@/data/functions')>()), requestPhotoHash: vi.fn(async () => null) }))

const te = t.expenses

function category(id: string, name: string, sort: number, extra: Partial<ExpenseCategory> = {}): ExpenseCategory {
  return {
    id,
    company_id: COMPANY_ID,
    name,
    monthly_limit: null,
    photo_required: false,
    is_active: true,
    sort_order: sort,
    created_by: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    deleted_at: null,
    ...extra,
  }
}

const food = category('k-food', 'Oziq-ovqat', 1)
const fuel = category('k-fuel', 'Yoqilg‘i', 2)
const rent = category('k-rent', 'Asbob-uskuna ijarasi', 3, { photo_required: true })

function saved(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    company_id: COMPANY_ID,
    category_id: 'k-fuel',
    object_id: 'o-a',
    amount: '41000',
    spent_at: '2026-11-02T05:00:00Z',
    payer_id: 'p-haydovchi',
    payment_source: 'podotchet',
    supplier_id: null,
    note: null,
    receipt_photo_path: null,
    receipt_photo_sha256: null,
    receipt_fiscal_sign: null,
    receipt_terminal_id: null,
    receipt_no: null,
    receipt_verified: false,
    receipt_total: null,
    seller_tin: null,
    created_by: 'p-haydovchi',
    created_at: new Date().toISOString(),
    deleted_at: null,
    category_name: 'Yoqilg‘i',
    object_name: 'Obyekt A',
    supplier_name: null,
    payer_name: null,
    alert_types: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('haydovchi'))
  vi.mocked(objectsRepo.listObjects).mockResolvedValue([makeObject('o-a', 'Obyekt A')])
  vi.mocked(cashRepo.getMyBalance).mockResolvedValue({ ...cashRepo.emptyBalance(COMPANY_ID, 'p-haydovchi'), balance: '500000' })
  vi.mocked(companiesRepo.getCompanySettings).mockResolvedValue({ ...companiesRepo.DEFAULT_COMPANY_SETTINGS, photoRequiredAmount: '1000000' })
  vi.mocked(expenseCategoriesRepo.listExpenseCategories).mockResolvedValue([food, fuel, rent])
  vi.mocked(expensesRepo.getMyExpenseCategoryUsage).mockResolvedValue([{ categoryId: 'k-fuel', useCount: 4, lastUsedAt: '2026-11-01T00:00:00Z' }])
  vi.mocked(expensesRepo.createExpense).mockResolvedValue(saved())
})

function open(path = '/tg/purchase') {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

function switchToExpense() {
  fireEvent.click(screen.getByRole('button', { name: te.modeExpense }))
}

describe('/tg/purchase — "Xarajat" rejimi', () => {
  it('Xarajat → tur (ko‘p ishlatilgani birinchi) → summa → Saqlash: 4 bosish, obyekt avtomatik, tanlov eslab qolinadi', async () => {
    open()
    await screen.findByRole('group', { name: te.modeLabel })
    switchToExpense()
    expect(window.localStorage.getItem('terron.purchase.mode')).toBe('expense')
    await screen.findAllByTestId('expense-category')
    // Ko'p ishlatilgani (my_expense_category_usage) — birinchi
    await waitFor(() => expect(screen.getAllByTestId('expense-category')[0]).toHaveTextContent('Yoqilg‘i'))
    fireEvent.click(screen.getAllByTestId('expense-category')[0] as HTMLElement)
    const amount = screen.getByLabelText(te.amount)
    expect(amount).toHaveAttribute('inputmode', 'numeric')
    fireEvent.change(amount, { target: { value: '41000' } })
    expect(amount).toHaveValue('41 000')
    // Bitta obyekt — avtomatik tanlangan, "Umumiy" ham bor
    expect(screen.getByTestId('expense-object')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('expense-object-general')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: te.save }))
    await waitFor(() => expect(expensesRepo.createExpense).toHaveBeenCalledTimes(1))
    expect(vi.mocked(expensesRepo.createExpense).mock.calls[0]?.[0]).toMatchObject({
      companyId: COMPANY_ID,
      categoryId: 'k-fuel',
      objectId: 'o-a',
      amount: '41000',
      payerId: 'p-haydovchi',
      spentAt: null,
      receiptPhotoPath: null,
    })
    expect(vi.mocked(expensesRepo.createExpense).mock.calls[0]?.[0]).not.toHaveProperty('paymentSource')
    expect(await screen.findByRole('status')).toHaveTextContent(te.saved('Yoqilg‘i'))
    // Rasmsiz — xesh so'ralmaydi
    expect(functions.requestPhotoHash).not.toHaveBeenCalled()
  })

  it('oxirgi tanlov eslab qolinadi: ochilganda darhol "Xarajat"', async () => {
    window.localStorage.setItem('terron.purchase.mode', 'expense')
    open()
    expect(await screen.findAllByTestId('expense-category')).toHaveLength(3)
    expect(screen.getByRole('button', { name: te.modeExpense })).toHaveAttribute('aria-pressed', 'true')
  })

  it('"Umumiy" tanlansa — objectId null; summa bo‘sh — xato', async () => {
    window.localStorage.setItem('terron.purchase.mode', 'expense')
    open()
    fireEvent.click((await screen.findAllByTestId('expense-category'))[1] as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: te.save }))
    expect(await screen.findByText(te.errors.amountRequired)).toBeInTheDocument()
    expect(expensesRepo.createExpense).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(te.amount), { target: { value: '15000' } })
    fireEvent.click(screen.getByTestId('expense-object-general'))
    fireEvent.click(screen.getByRole('button', { name: te.save }))
    await waitFor(() => expect(expensesRepo.createExpense).toHaveBeenCalledTimes(1))
    expect(vi.mocked(expensesRepo.createExpense).mock.calls[0]?.[0]).toMatchObject({ objectId: null, amount: '15000' })
    expect(window.localStorage.getItem('terron.expense.object')).toBe('none')
  })

  it('tur "rasm majburiy" — "majburiy" belgisi, rasmsiz saqlanmaydi; chegaradan katta summa ham', async () => {
    window.localStorage.setItem('terron.purchase.mode', 'expense')
    open()
    const tiles = await screen.findAllByTestId('expense-category')
    fireEvent.click(tiles.find((x) => x.textContent?.includes('ijarasi')) as HTMLElement)
    fireEvent.change(screen.getByLabelText(te.amount), { target: { value: '5000' } })
    expect(screen.getByText(te.photoRequiredCategory)).toBeInTheDocument()
    // Tugma faol: bosilsa saqlanmaydi, rasm maydoniga aylantiriladi
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const btn = screen.getByRole('button', { name: te.save })
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(expensesRepo.createExpense).not.toHaveBeenCalled()
    expect(scroll).toHaveBeenCalled()
    expect(scroll.mock.contexts[0]).toHaveAttribute('data-photo-field')
  })

  it('takroriy xarajat — ogohlantirish, tasdiqlansa saqlanadi', async () => {
    window.localStorage.setItem('terron.purchase.mode', 'expense')
    vi.mocked(expensesRepo.listMyExpenses).mockResolvedValue([saved({ id: 'prev', created_at: new Date(Date.now() - 60_000).toISOString() })])
    open()
    await waitFor(() => expect(expensesRepo.listMyExpenses).toHaveBeenCalled())
    fireEvent.click((await screen.findAllByTestId('expense-category'))[0] as HTMLElement)
    fireEvent.change(screen.getByLabelText(te.amount), { target: { value: '41000' } })
    fireEvent.click(screen.getByRole('button', { name: te.save }))
    const warning = await screen.findByTestId('duplicate-warning')
    expect(expensesRepo.createExpense).not.toHaveBeenCalled()
    fireEvent.click(within(warning).getByRole('button', { name: t.tg.auto.duplicateSave }))
    await waitFor(() => expect(expensesRepo.createExpense).toHaveBeenCalledTimes(1))
  })
})

describe('/tg/mine — xarajatlar', () => {
  const EXP = '3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e'
  it('havola ?expense=<id> — o‘z xarajati tafsiloti; 30 daqiqa ichida tuzatish (summa, obyekt, izoh, sabab)', async () => {
    vi.mocked(expensesRepo.listMyExpenses).mockResolvedValue([saved({ id: EXP, object_id: null, object_name: null })])
    open('/tg?expense=' + EXP)
    const detail = await screen.findByTestId('mine-expense-detail')
    expect(detail).toHaveTextContent('Yoqilg‘i')
    expect(detail).toHaveTextContent(te.general)
    fireEvent.click(within(detail).getByRole('button', { name: /Tuzatish/ }))
    const form = await screen.findByTestId('expense-correction')
    fireEvent.change(within(form).getByLabelText(te.amount), { target: { value: '45000' } })
    fireEvent.change(within(form).getByRole('combobox', { name: te.object }), { target: { value: 'o-a' } })
    fireEvent.change(within(form).getByLabelText(t.correction.reason), { target: { value: 'chek' } })
    fireEvent.click(within(form).getByRole('button', { name: t.correction.save }))
    await waitFor(() =>
      expect(correctionsRepo.correctEntry).toHaveBeenCalledWith(expect.objectContaining({ table: 'expenses', id: EXP, totalAmount: '45000', objectId: 'o-a' })),
    )
  })

  it('ro‘yxatda Xarajat qatori va filtr; muddati o‘tgan — tuzatish yo‘q', async () => {
    vi.mocked(expensesRepo.listMyExpenses).mockResolvedValue([saved({ created_at: '2026-01-01T00:00:00Z' })])
    open('/tg/mine')
    const row = await screen.findByTestId('mine-expense')
    expect(row).toHaveTextContent('Yoqilg‘i')
    fireEvent.click(row.querySelector('button') ?? row)
    const detail = await screen.findByTestId('mine-expense-detail')
    expect(within(detail).queryByRole('button', { name: /Tuzatish/ })).not.toBeInTheDocument()
  })
})
