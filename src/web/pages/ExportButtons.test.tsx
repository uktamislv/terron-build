import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import * as alertsRepo from '@/data/alertsRepo'
import * as authRepo from '@/data/authRepo'
import * as cashRepo from '@/data/cashRepo'
import { RepoError } from '@/data/errors'
import * as movementsRepo from '@/data/movementsRepo'
import * as purchasesRepo from '@/data/purchasesRepo'
import type { Purchase } from '@/data/types'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import * as excel from '@/lib/excelExport'
import { routes } from '@/routes'
import { makeObject, makeProfile } from '@/test/fixtures'

vi.mock('@/data/systemRepo', () => ({
  isConfigured: () => true,
  getSystemStatus: () => ({ supabaseConfigured: true }),
}))
vi.mock('@/data/authRepo', () => ({
  getSession: vi.fn(async () => ({ userId: 'u1', email: 'a@b.uz', mustChangePassword: false })),
  onAuthChange: vi.fn(() => () => undefined),
  getMyProfile: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
  telegramSignIn: vi.fn(),
  clearLocalSession: vi.fn(),
  changePassword: vi.fn(),
  MIN_PASSWORD_LENGTH: 8,
}))
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn(async () => [makeObject('3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e', 'Obyekt A')]) }))
vi.mock('@/data/materialsRepo', () => ({ listMaterials: vi.fn(async () => []) }))
vi.mock('@/data/profilesRepo', () => ({
  listProfiles: vi.fn(async () => [
    { ...makeProfile('haydovchi'), id: 'p1', full_name: 'Ali' },
    { ...makeProfile('taminotchi'), id: 'p2', full_name: 'Vali' },
  ]),
}))
vi.mock('@/data/cashRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/cashRepo')>()),
  listBalances: vi.fn(async () =>
    ['p1', 'p2'].map((id) => ({
      company_id: 'c',
      profile_id: id,
      issued_total: '100',
      spent_total: '0',
      balance: '100',
      last_issued_at: null,
      last_spent_at: null,
    })),
  ),
  listCashHistory: vi.fn(async () => []),
  listAllCashHistory: vi.fn(async () => []),
}))
vi.mock('@/data/companiesRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/companiesRepo')>()),
  getCompanySettings: vi.fn(async () => ({ receiptMismatchPct: '5' })),
}))
vi.mock('@/data/purchasesRepo', () => ({
  PURCHASES_PAGE_SIZE: 50,
  listPurchases: vi.fn(async () => ({ rows: [], total: 0 })),
  listAllPurchases: vi.fn(),
  restorePurchase: vi.fn(),
  softDeletePurchase: vi.fn(),
}))
vi.mock('@/data/alertsRepo', () => ({
  ALERTS_PAGE_SIZE: 50,
  CLOSE_NOTE_MAX: 500,
  listAlerts: vi.fn(async () => ({ rows: [], total: 0 })),
  listAllAlerts: vi.fn(async () => []),
  markAlertSeen: vi.fn(),
  closeAlert: vi.fn(),
}))
vi.mock('@/data/movementsRepo', () => ({
  MOVEMENTS_PAGE_SIZE: 50,
  listMovements: vi.fn(async () => ({ rows: [], total: 0 })),
  listAllMovements: vi.fn(async () => []),
  restoreMovement: vi.fn(),
  softDeleteMovement: vi.fn(),
}))
vi.mock('@/lib/excelExport', async (orig) => ({
  ...(await orig<typeof import('@/lib/excelExport')>()),
  exportWorkbook: vi.fn(async () => undefined),
}))

function open(path: string, role: Role = 'admin') {
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile(role))
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

const purchase = {
  id: 'p1',
  purchased_at: '2026-10-20T05:00:00Z',
  object_name: 'Obyekt A',
  material_name: 'Sement',
  qty_input: '10',
  unit_input: 'qop',
  unit_variant: null,
  qty_base: '500',
  base_unit: 'kg',
  total_amount: '1250000',
  unit_price: '125000',
  receipt: { received_qty_base: '500', remaining_qty_base: '0', receipt_count: 1, last_received_at: null },
  buyer_name: '=HYPERLINK("x")',
  supplier_name: null,
  note: null,
  deleted_at: null,
} as unknown as Purchase

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Excel tugmalari va URL filtrlari', () => {
  it('Xaridlar: URL filtri so‘rovga tushadi; Excel — hamma qatorlar shu filtr bilan', async () => {
    vi.mocked(purchasesRepo.listAllPurchases).mockResolvedValue([purchase])
    open('/purchases?from=2026-10-01&to=2026-10-07&object=3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e')
    await waitFor(() =>
      expect(purchasesRepo.listPurchases).toHaveBeenCalledWith(
        expect.objectContaining({ objectId: '3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e', from: '2026-09-30T19:00:00.000Z', to: '2026-10-07T19:00:00.000Z' }),
        0,
      ),
    )
    fireEvent.click(await screen.findByRole('button', { name: t.excel.button }))
    await waitFor(() => expect(excel.exportWorkbook).toHaveBeenCalled())
    expect(vi.mocked(purchasesRepo.listAllPurchases).mock.calls[0]?.[0]).toMatchObject({ objectId: '3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e' })
    const arg = vi.mocked(excel.exportWorkbook).mock.calls[0]?.[0]
    expect(arg?.fileName).toMatch(/^terron-xaridlar-\d{2}\.\d{2}\.\d{4}\.xlsx$/)
    const sheet = arg?.sheets[0]
    expect(sheet?.columns.find((c) => c.key === 'total_amount')?.type).toBe('money')
    expect(sheet?.rows[0]).toMatchObject({ total_amount: '1250000', received: '500', unit: 'qop' })
    // Formula himoyasi katak qurishda: buyer nomi matn
    const ws = excel.buildWorksheet(sheet?.columns ?? [], sheet?.rows ?? [])
    const buyerCol = sheet?.columns.findIndex((c) => c.key === 'buyer') ?? -1
    expect(ws[excel.cellRef(1, buyerCol)]).toEqual({ t: 's', v: `'=HYPERLINK("x")` })
  })

  it('Eksport xatosi (juda ko‘p qator) — xabar ko‘rsatiladi', async () => {
    vi.mocked(purchasesRepo.listAllPurchases).mockRejectedValue(new RepoError('export_too_large'))
    open('/purchases')
    fireEvent.click(await screen.findByRole('button', { name: t.excel.button }))
    expect(await screen.findByText(t.errors.export_too_large)).toBeInTheDocument()
    expect(excel.exportWorkbook).not.toHaveBeenCalled()
  })

  it('Bekor qilish — signal to‘xtatiladi, fayl yaratilmaydi', async () => {
    let seen: AbortSignal | undefined
    vi.mocked(purchasesRepo.listAllPurchases).mockImplementation(
      (_f, signal) =>
        new Promise((_resolve, reject) => {
          seen = signal
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )
    open('/purchases')
    fireEvent.click(await screen.findByRole('button', { name: t.excel.button }))
    expect(await screen.findByText(t.excel.exporting)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.excel.cancel }))
    expect(seen?.aborted).toBe(true)
    expect(await screen.findByRole('button', { name: t.excel.button })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(excel.exportWorkbook).not.toHaveBeenCalled()
  })

  it('Ogohlantirishlar: ?severity=jiddiy&object=3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e', async () => {
    open('/alerts?status=open&severity=jiddiy&object=3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e')
    await waitFor(() =>
      expect(alertsRepo.listAlerts).toHaveBeenCalledWith(
        { statuses: ['yangi', 'korildi'], type: undefined, severity: 'jiddiy', objectId: '3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e' },
        0,
      ),
    )
  })

  it('Ombor: ?type=kirim&from=...; Excel — ombor harakatlari', async () => {
    open('/movements?type=kirim&from=2026-10-01&to=2026-10-02')
    await waitFor(() =>
      expect(movementsRepo.listMovements).toHaveBeenCalledWith(expect.objectContaining({ type: 'kirim' }), 0),
    )
    fireEvent.click(await screen.findByRole('button', { name: t.excel.button }))
    await waitFor(() => expect(excel.exportWorkbook).toHaveBeenCalled())
    expect(vi.mocked(movementsRepo.listAllMovements).mock.calls[0]?.[0]).toMatchObject({ type: 'kirim' })
    expect(vi.mocked(excel.exportWorkbook).mock.calls[0]?.[0].fileName).toMatch(/^terron-ombor-harakatlari-/)
  })

  it('Podotchet: odam tanlansa — balans varag‘i ham shu odamga', async () => {
    open('/cash')
    await screen.findByRole('option', { name: 'Vali' })
    fireEvent.change(screen.getByLabelText(t.cash.filterPerson), { target: { value: 'p2' } })
    fireEvent.click(screen.getByRole('button', { name: t.excel.button }))
    await waitFor(() => expect(excel.exportWorkbook).toHaveBeenCalled())
    expect(vi.mocked(cashRepo.listAllCashHistory).mock.calls[0]?.[0]).toMatchObject({ profileId: 'p2' })
    const sheets = vi.mocked(excel.exportWorkbook).mock.calls[0]?.[0].sheets
    expect(sheets?.[0]?.rows).toEqual([expect.objectContaining({ profile_id: 'p2', name: 'Vali' })])
  })
})
