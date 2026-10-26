import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as alertsRepo from '@/data/alertsRepo'
import * as authRepo from '@/data/authRepo'
import * as estimatesRepo from '@/data/estimatesRepo'
import * as inventoryRepo from '@/data/inventoryRepo'
import * as materialsRepo from '@/data/materialsRepo'
import * as normsRepo from '@/data/normsRepo'
import * as objectsRepo from '@/data/objectsRepo'
import * as purchasesRepo from '@/data/purchasesRepo'
import * as requestsRepo from '@/data/requestsRepo'
import * as transfersRepo from '@/data/transfersRepo'
import type { Estimate, InventoryCount, InventoryCountItem, MaterialRequest, NormUsage, Purchase, Transfer } from '@/data/types'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import { formatSum } from '@/lib/format'
import { routes } from '@/routes'
import { makeMaterial, makeObject, makeProfile } from '@/test/fixtures'
import { plain } from '@/test/text'

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
vi.mock('@/data/profilesRepo', () => ({ listProfiles: vi.fn(async () => []) }))
vi.mock('@/data/movementsRepo', () => ({ listMovements: vi.fn(async () => ({ rows: [], total: 0 })), MOVEMENTS_PAGE_SIZE: 50 }))
vi.mock('@/data/stockRepo', () => ({ listStock: vi.fn(async () => []), getStock: vi.fn() }))
vi.mock('@/data/normsRepo', () => ({ listNormUsage: vi.fn(async () => []), getNormUsage: vi.fn() }))
vi.mock('@/data/purchasesRepo', () => ({ listPurchases: vi.fn(async () => ({ rows: [], total: 0 })), PURCHASES_PAGE_SIZE: 50 }))
vi.mock('@/data/requestsRepo', () => ({
  REQUESTS_PAGE_SIZE: 50,
  DECISION_NOTE_MAX: 500,
  listRequests: vi.fn(),
  approveRequest: vi.fn(async () => undefined),
  rejectRequest: vi.fn(async () => undefined),
  markRequestPurchased: vi.fn(async () => undefined),
}))
vi.mock('@/data/transfersRepo', () => ({
  TRANSFERS_PAGE_SIZE: 50,
  CANCEL_REASON_MAX: 500,
  listTransfers: vi.fn(),
  cancelTransfer: vi.fn(async () => undefined),
}))
vi.mock('@/data/inventoryRepo', () => ({
  COUNTS_PAGE_SIZE: 50,
  listCounts: vi.fn(),
  getCount: vi.fn(),
  listCountItems: vi.fn(),
  getCountDetails: vi.fn(),
  applyAdjustments: vi.fn(async () => undefined),
}))
vi.mock('@/data/alertsRepo', () => ({ listAlerts: vi.fn(async () => ({ rows: [], total: 0 })), ALERTS_PAGE_SIZE: 50 }))
vi.mock('@/data/estimatesRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/estimatesRepo')>()),
  listEstimates: vi.fn(),
  listEstimateItems: vi.fn(async () => []),
}))

const tp = t.requestsPage
const tt = t.ombor.transfers
const ti = t.ombor.inventory
const tn = t.norms

const sement = makeMaterial('m-sem', 'Sement', 'kg', { waste_pct: '5' })
const qum = makeMaterial('m-qum', 'Qum', 'm³')

function req(overrides: Partial<MaterialRequest> = {}): MaterialRequest {
  return {
    id: 'rq1',
    company_id: 'c',
    object_id: 'o-a',
    material_id: 'm-sem',
    unit_id: 'm-sem-base',
    qty_input: '600',
    unit_input: 'kg',
    unit_variant: null,
    qty_base: '600',
    status: 'kutilmoqda',
    needed_by: '2026-10-27',
    decided_by: null,
    decided_at: null,
    decision_note: null,
    purchase_id: null,
    note: null,
    created_by: 'p-prorab',
    created_at: '2026-10-25T05:00:00Z',
    deleted_at: null,
    object_name: 'Obyekt A',
    material_name: 'Sement',
    base_unit: 'kg',
    created_by_name: 'Test prorab',
    decided_by_name: null,
    ...overrides,
  }
}

const norm: NormUsage = {
  company_id: 'c',
  object_id: 'o-a',
  material_id: 'm-sem',
  estimate_id: 'e1',
  norm_qty_base: '1000',
  allowed_qty_base: '1050',
  consumed_qty_base: '250',
  delivered_qty_base: '0',
  requested_open_qty_base: '900', // shu so'rov (600) + boshqalar (300)
  remaining_qty_base: '800',
  usage_pct: '23.8',
}

function login(role: Role) {
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile(role))
}

function open(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(objectsRepo.listObjects).mockResolvedValue([makeObject('o-a', 'Obyekt A'), makeObject('o-b', 'Obyekt B')])
  vi.mocked(materialsRepo.listMaterials).mockResolvedValue([sement, qum])
  vi.mocked(normsRepo.listNormUsage).mockResolvedValue([norm])
  vi.mocked(requestsRepo.listRequests).mockResolvedValue({
    rows: [req(), req({ id: 'rq2', status: 'tasdiqlandi', material_id: 'm-qum', material_name: 'Qum', base_unit: 'm³', qty_base: '5', qty_input: '5', unit_input: 'm³' })],
    total: 2,
  })
})

describe('/requests', () => {
  it('obyektda joriy smeta yo‘q — "Smetada yo‘q" dan alohida', async () => {
    login('admin')
    vi.mocked(normsRepo.listNormUsage).mockResolvedValue([])
    open('/requests')
    const rows = await screen.findAllByTestId('request-row')
    await waitFor(() => expect(within(rows[0] as HTMLElement).getByText(tp.noEstimate)).toBeInTheDocument())
    expect(screen.queryByText(tp.notInEstimate)).not.toBeInTheDocument()
  })

  it('yetkazilgan hisobga olinadi (Y5)', async () => {
    login('admin')
    // 1050 − max(250, 900) − 300 = −150 → 600 so'raldi → 750 ortiq
    vi.mocked(normsRepo.listNormUsage).mockResolvedValue([{ ...norm, delivered_qty_base: '900' }])
    open('/requests')
    const rows = await screen.findAllByTestId('request-row')
    await waitFor(() => expect(within(rows[0] as HTMLElement).getByTestId('norm-over')).toHaveTextContent(tp.normOver('750 kg')))
  })

  it('standart filtr — kutilmoqda; smeta holati: ortiqcha qizil, smetada yo‘q', async () => {
    login('admin')
    open('/requests')
    const rows = await screen.findAllByTestId('request-row')
    expect(requestsRepo.listRequests).toHaveBeenCalledWith(expect.objectContaining({ statuses: ['kutilmoqda'] }), 0)
    // 1050 − 250 − 300 (boshqalar) = 500 → 600 so'raldi → 100 ortiq
    await waitFor(() => expect(within(rows[0] as HTMLElement).getByTestId('norm-over')).toHaveTextContent(tp.normOver('100 kg')))
    expect(within(rows[1] as HTMLElement).getByText(tp.notInEstimate)).toBeInTheDocument()
    expect(screen.getByText(tp.currentHint)).toBeInTheDocument()
  })

  it('admin: tasdiqlash va rad etish (sabab majburiy)', async () => {
    login('admin')
    open('/requests')
    const rows = await screen.findAllByTestId('request-row')
    const first = rows[0] as HTMLElement
    fireEvent.click(within(first).getByRole('button', { name: tp.approve }))
    await waitFor(() => expect(requestsRepo.approveRequest).toHaveBeenCalledWith('rq1'))

    fireEvent.click(within(first).getByRole('button', { name: tp.reject }))
    const dialog = await screen.findByRole('dialog', { name: tp.rejectTitle })
    fireEvent.click(within(dialog).getByRole('button', { name: tp.reject }))
    expect(within(dialog).getByText(tp.rejectReasonRequired)).toBeInTheDocument()
    expect(requestsRepo.rejectRequest).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByLabelText(tp.rejectReason), { target: { value: 'Smetadan ortiq' } })
    fireEvent.click(within(dialog).getByRole('button', { name: tp.reject }))
    await waitFor(() => expect(requestsRepo.rejectRequest).toHaveBeenCalledWith('rq1', 'Smetadan ortiq'))
    // Tasdiqlangan qatorda admin ham "Xarid qilindi" ni ko'radi
    expect(within(rows[1] as HTMLElement).getByRole('button', { name: tp.purchased })).toBeInTheDocument()
  })

  it('ta‘minotchi: faqat "Xarid qilindi", xaridni bog‘lash', async () => {
    login('taminotchi')
    const purchase = {
      id: 'pu1',
      qty_input: '5',
      unit_input: 'm³',
      unit_variant: null,
      total_amount: '750000',
      purchased_at: '2026-10-24T05:00:00Z',
      buyer_name: 'Ali',
    } as Purchase
    vi.mocked(purchasesRepo.listPurchases).mockResolvedValue({ rows: [purchase], total: 1 })
    open('/requests')
    const rows = await screen.findAllByTestId('request-row')
    expect(within(rows[0] as HTMLElement).queryByRole('button', { name: tp.approve })).not.toBeInTheDocument()
    expect(within(rows[0] as HTMLElement).queryByRole('button', { name: tp.reject })).not.toBeInTheDocument()
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: tp.purchased }))
    const dialog = await screen.findByRole('dialog', { name: tp.purchasedTitle })
    await waitFor(() => expect(purchasesRepo.listPurchases).toHaveBeenCalledWith({ objectId: 'o-a', materialId: 'm-qum' }))
    fireEvent.click(await within(dialog).findByRole('radio', { name: new RegExp(formatSum('750000')) }))
    fireEvent.click(within(dialog).getByRole('button', { name: tp.confirm }))
    await waitFor(() => expect(requestsRepo.markRequestPurchased).toHaveBeenCalledWith('rq2', 'pu1'))
  })

  it('direktor (faqat ko‘rish): amallar yo‘q', async () => {
    login('direktor')
    open('/requests')
    await screen.findAllByTestId('request-row')
    expect(screen.queryByRole('button', { name: tp.approve })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: tp.purchased })).not.toBeInTheDocument()
  })
})

const transfer: Transfer = {
  id: 'tr1',
  company_id: 'c',
  from_object_id: 'o-a',
  to_object_id: 'o-b',
  material_id: 'm-sem',
  unit_id: 'm-sem-base',
  qty_input: '100',
  unit_input: 'kg',
  unit_variant: null,
  qty_base: '100',
  status: 'qabul_qilindi',
  received_qty_base: '90',
  received_at: '2026-10-25T08:00:00Z',
  received_by: 'p-x',
  cancel_reason: null,
  note: null,
  created_by: 'p-prorab',
  created_at: '2026-10-25T05:00:00Z',
  deleted_at: null,
  from_object_name: 'Obyekt A',
  to_object_name: 'Obyekt B',
  material_name: 'Sement',
  base_unit: 'kg',
  created_by_name: 'Test prorab',
}

describe('/movements — O‘tkazmalar', () => {
  beforeEach(() => {
    vi.mocked(transfersRepo.listTransfers).mockResolvedValue({
      rows: [transfer, { ...transfer, id: 'tr2', status: 'yuborildi', received_qty_base: null, received_at: null }],
      total: 2,
    })
  })

  it('farq qizil; admin "Bekor qilish" sabab bilan', async () => {
    login('admin')
    open('/movements')
    fireEvent.click(await screen.findByRole('tab', { name: t.ombor.tabTransfers }))
    const rows = await screen.findAllByTestId('transfer-row')
    expect(within(rows[0] as HTMLElement).getByTestId('transfer-diff')).toHaveTextContent('−10 kg')
    // Qabul qilingan o'tkazmada amal yo'q — "⋯" menyusi ham yo'q
    expect(within(rows[0] as HTMLElement).queryByRole('button', { name: t.ui.actions })).not.toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).queryByRole('button', { name: tt.cancel })).not.toBeInTheDocument()
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: t.ui.actions }))
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('menuitem', { name: tt.cancel }))
    const dialog = await screen.findByRole('dialog', { name: tt.cancelTitle })
    fireEvent.change(within(dialog).getByLabelText(tt.cancelReason), { target: { value: 'Xato obyekt' } })
    fireEvent.click(within(dialog).getByRole('button', { name: tt.cancel }))
    await waitFor(() => expect(transfersRepo.cancelTransfer).toHaveBeenCalledWith('tr2', 'Xato obyekt'))
  })

  it('direktor — bekor qilish tugmasi yo‘q', async () => {
    login('direktor')
    open('/movements')
    fireEvent.click(await screen.findByRole('tab', { name: t.ombor.tabTransfers }))
    await screen.findAllByTestId('transfer-row')
    expect(screen.queryByRole('button', { name: tt.cancel })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.ui.actions })).not.toBeInTheDocument()
  })
})

describe('/movements — Inventarizatsiya', () => {
  const count: InventoryCount = {
    id: 'ic1',
    company_id: 'c',
    object_id: 'o-a',
    status: 'submitted',
    counted_at: '2026-10-25T05:00:00Z',
    note: null,
    applied_at: null,
    applied_by: null,
    created_by: 'p-t',
    created_at: '2026-10-25T05:00:00Z',
    updated_at: '2026-10-25T05:00:00Z',
    object_name: 'Obyekt A',
    created_by_name: 'Tekshiruvchi',
    item_count: 2,
  }
  const items: InventoryCountItem[] = [
    {
      id: 'i1',
      inventory_count_id: 'ic1',
      material_id: 'm-sem',
      qty_counted: '80',
      qty_expected: '100',
      qty_input: '80',
      unit_id: 'm-sem-base',
      updated_at: '',
      material_name: 'Sement',
      base_unit: 'kg',
    },
    {
      id: 'i2',
      inventory_count_id: 'ic1',
      material_id: 'm-qum',
      qty_counted: '6',
      qty_expected: '5',
      qty_input: '6',
      unit_id: 'm-qum-base',
      updated_at: '',
      material_name: 'Qum',
      base_unit: 'm³',
    },
  ]

  beforeEach(() => {
    vi.mocked(inventoryRepo.listCounts).mockResolvedValue({ rows: [count], total: 1 })
    vi.mocked(inventoryRepo.getCount).mockResolvedValue(count)
    vi.mocked(inventoryRepo.listCountItems).mockResolvedValue(items)
    vi.mocked(inventoryRepo.getCountDetails).mockResolvedValue([
      ...items.map((i) => ({
        material_id: i.material_id,
        material_name: i.material_name,
        base_unit: i.base_unit,
        qty_input: i.qty_input,
        unit_id: i.unit_id,
        qty_counted: i.qty_counted,
        qty_expected: i.material_id === 'm-sem' ? '100' : '5',
        diff: i.material_id === 'm-sem' ? '-20' : '1',
        shortage_value: i.material_id === 'm-sem' ? '30010' : null,
      })),
      {
        material_id: 'm-gips',
        material_name: 'Gips',
        base_unit: 'dona',
        qty_input: null,
        unit_id: null,
        qty_counted: null,
        qty_expected: '4',
        diff: '-4',
        shortage_value: null,
      },
    ])
  })

  it('tafsilot: kutilgan, sanalgan, farq, kamomad qiymati; admin tuzatadi (tasdiq bilan)', async () => {
    login('admin')
    open('/movements')
    fireEvent.click(await screen.findByRole('tab', { name: t.ombor.tabInventory }))
    fireEvent.click(await screen.findByRole('button', { name: ti.open }))
    expect((await screen.findAllByTestId('inventory-shortage'))[0]).toHaveTextContent('−20 kg')
    expect(screen.getAllByTestId('inventory-shortage')[1]).toHaveTextContent('−4 dona')
    expect(screen.getByTestId('inventory-surplus')).toHaveTextContent('+1 m³')
    // Qiymat bazadan (inventory_count_details) — klientda narx hisoblanmaydi
    expect(screen.getByTestId('inventory-total')).toHaveTextContent(plain(formatSum('30010')))
    expect(inventoryRepo.getCountDetails).toHaveBeenCalledWith('ic1')
    // Sanalmagan material belgili
    expect(screen.getByText(ti.notCountedMark)).toBeInTheDocument()
    await waitFor(() =>
      expect(alertsRepo.listAlerts).toHaveBeenCalledWith({ inventoryCountId: 'ic1', type: 'inventarizatsiya_kamomadi' }),
    )

    fireEvent.click(screen.getByRole('button', { name: ti.apply }))
    const dialog = await screen.findByRole('dialog', { name: ti.applyTitle })
    expect(within(dialog).getByText(ti.applyText(3))).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: ti.apply }))
    await waitFor(() => expect(inventoryRepo.applyAdjustments).toHaveBeenCalledWith('ic1'))
  })

  it('direktor — tuzatish tugmasi yo‘q; qo‘llangan hisob belgili', async () => {
    login('direktor')
    vi.mocked(inventoryRepo.getCount).mockResolvedValue({ ...count, applied_at: '2026-10-25T09:00:00Z' })
    open('/movements')
    fireEvent.click(await screen.findByRole('tab', { name: t.ombor.tabInventory }))
    fireEvent.click(await screen.findByRole('button', { name: ti.open }))
    await screen.findAllByTestId('inventory-shortage')
    expect(screen.getAllByText(ti.applied).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: ti.apply })).not.toBeInTheDocument()
  })

  it('qoralama — kutilgan va farq ko‘rsatilmaydi', async () => {
    login('admin')
    vi.mocked(inventoryRepo.getCount).mockResolvedValue({ ...count, status: 'draft' })
    vi.mocked(inventoryRepo.listCountItems).mockResolvedValue(items.map((i) => ({ ...i, qty_expected: null })))
    vi.mocked(inventoryRepo.getCountDetails).mockClear()
    open('/movements')
    fireEvent.click(await screen.findByRole('tab', { name: t.ombor.tabInventory }))
    fireEvent.click(await screen.findByRole('button', { name: ti.open }))
    expect(await screen.findByText(ti.draftNote)).toBeInTheDocument()
    expect(screen.queryByText(ti.colExpected)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ti.apply })).not.toBeInTheDocument()
    expect(inventoryRepo.getCountDetails).not.toHaveBeenCalled()
  })

  it('kamomad alerti (sanalmaganlar bilan) tafsilotda ko‘rsatiladi', async () => {
    login('admin')
    vi.mocked(alertsRepo.listAlerts).mockResolvedValue({
      rows: [
        {
          id: 'al1', company_id: 'c', type: 'inventarizatsiya_kamomadi', status: 'yangi', severity: 'ogohlantirish',
          object_id: 'o-a', material_id: null, purchase_id: null, movement_id: null, closed_by: null, closed_at: null,
          close_note: null, created_at: '2026-10-25T06:00:00Z', deleted_at: null, object_name: 'Obyekt A',
          material_name: null, base_unit: null,
          details: { items: [], not_counted: [{ material_id: 'm-gips', material_name: 'Gips', base_unit: 'dona', expected: '4', shortage_value: null }] },
        },
      ],
      total: 1,
    })
    open('/movements')
    fireEvent.click(await screen.findByRole('tab', { name: t.ombor.tabInventory }))
    fireEvent.click(await screen.findByRole('button', { name: ti.open }))
    expect(await screen.findByTestId('inventory-alert')).toHaveTextContent(t.alertsPage.details.inventoryNotCounted(1))
  })
})

describe('tekshiruvchi — veb ombor yopiq (ko‘r-ko‘rona sanash)', () => {
  it('/movements — ruxsat yo‘q', async () => {
    login('tekshiruvchi')
    open('/movements')
    expect(await screen.findByText(t.forbidden.title)).toBeInTheDocument()
    expect(transfersRepo.listTransfers).not.toHaveBeenCalled()
  })
})

describe('/estimates — Sarf va norma', () => {
  it('joriy smetali obyekt: norma jadvali, oshganlar qizil va birinchi', async () => {
    login('admin')
    const estimate = { id: 'e1', object_id: 'o-a', version: 1, title: 'Smeta', is_current: true, item_count: 2, total_sum: '0', estimate_date: null, created_at: '2026-10-20T05:00:00Z', source_file_name: null } as Estimate
    vi.mocked(estimatesRepo.listEstimates).mockResolvedValue([estimate])
    vi.mocked(normsRepo.listNormUsage).mockResolvedValue([
      norm,
      { ...norm, material_id: 'm-qum', norm_qty_base: '10', allowed_qty_base: '10', consumed_qty_base: '12', remaining_qty_base: '-2', usage_pct: '120' },
    ])
    open('/estimates')
    const table = await screen.findByRole('region', { name: tn.title })
    const rows = await within(table).findAllByTestId('norm-row')
    expect(normsRepo.listNormUsage).toHaveBeenCalledWith({ objectId: 'o-a' })
    expect(rows[0]).toHaveAttribute('data-status', 'over')
    expect(within(rows[0] as HTMLElement).getByText('Qum')).toBeInTheDocument()
    expect(within(rows[0] as HTMLElement).getByText(tn.over)).toBeInTheDocument()
    expect(rows[1]).toHaveAttribute('data-status', 'ok')
  })
})
