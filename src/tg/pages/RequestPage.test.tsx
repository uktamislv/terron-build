import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import * as authRepo from '@/data/authRepo'
import { RepoError } from '@/data/errors'
import * as materialsRepo from '@/data/materialsRepo'
import * as normsRepo from '@/data/normsRepo'
import * as objectsRepo from '@/data/objectsRepo'
import * as requestsRepo from '@/data/requestsRepo'
import * as stockRepo from '@/data/stockRepo'
import * as transfersRepo from '@/data/transfersRepo'
import type { MaterialRequest, NormUsage } from '@/data/types'
import { t } from '@/i18n'
import { tashkentIsoDate } from '@/lib/format'
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
vi.mock('@/data/normsRepo', () => ({ getNormUsage: vi.fn(), listNormUsage: vi.fn() }))
vi.mock('@/data/requestsRepo', () => ({ createRequest: vi.fn(), listMyRequests: vi.fn(async () => []) }))
vi.mock('@/data/transfersRepo', () => ({
  createTransfer: vi.fn(async () => 'tr1'),
  listMyTransfers: vi.fn(async () => []),
  listTransferTargets: vi.fn(),
}))
vi.mock('@/data/stockRepo', () => ({ getStock: vi.fn(async () => '420'), listStock: vi.fn(async () => []) }))

const tr = t.tg.request
const tt = t.tg.transfer
const tm = t.tg.movement

const sement = makeMaterial('m-sem', 'Sement', 'kg', { units: [makeUnit('u-qop', 'm-sem', 'qop', '50')] })
const qum = makeMaterial('m-qum', 'Qum', 'm³')
const objA = makeObject('o-a', 'Obyekt A')
const objB = makeObject('o-b', 'Obyekt B')

const norm: NormUsage = {
  company_id: 'c',
  object_id: 'o-a',
  material_id: 'm-sem',
  estimate_id: 'e1',
  norm_qty_base: '1000',
  allowed_qty_base: '1000',
  consumed_qty_base: '200',
  delivered_qty_base: '0',
  requested_open_qty_base: '300',
  remaining_qty_base: '800',
  usage_pct: '20',
}

function request(overrides: Partial<MaterialRequest> = {}): MaterialRequest {
  return {
    id: 'rq1',
    company_id: 'c',
    object_id: 'o-a',
    material_id: 'm-sem',
    unit_id: 'u-qop',
    qty_input: '3',
    unit_input: 'qop',
    unit_variant: null,
    qty_base: '150',
    status: 'kutilmoqda',
    needed_by: null,
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

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('prorab'))
  vi.mocked(objectsRepo.listObjects).mockResolvedValue([objA])
  vi.mocked(materialsRepo.listMaterials).mockResolvedValue([sement, qum])
  vi.mocked(normsRepo.listNormUsage).mockResolvedValue([norm])
  vi.mocked(transfersRepo.listTransferTargets).mockResolvedValue([
    { id: 'o-a', name: 'Obyekt A' },
    { id: 'o-b', name: 'Obyekt B' },
    { id: 'o-c', name: 'Obyekt C (boshqa prorab)' },
  ])
  vi.mocked(requestsRepo.createRequest).mockResolvedValue(request())
  vi.mocked(stockRepo.getStock).mockResolvedValue('420')
})

function open() {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/tg/request'] })} />)
}

async function pickMaterial(name: string) {
  const grid = await screen.findByRole('region', { name: tm.chooseMaterial })
  fireEvent.click(within(grid).getByRole('button', { name: new RegExp(name) }))
}

function typeQty(value: string) {
  fireEvent.change(screen.getByLabelText(tm.qty), { target: { value } })
}

describe('/tg/request — So‘rov', () => {
  it('jonli "Smetada qolgan", ortiq bo‘lsa sariq ogohlantirish (bloklamaydi)', async () => {
    open()
    await pickMaterial('Sement')
    // allowed 1000 − sarf 200 − boshqa ochiq 300 = 500
    const box = await screen.findByTestId('norm-left')
    expect(box).toHaveTextContent(tr.normLeft('500', 'kg'))
    expect(box).not.toHaveAttribute('data-over')

    typeQty('150') // 150 kg (asosiy birlik)
    expect(screen.getByTestId('norm-left')).not.toHaveAttribute('data-over')

    // 12 qop = 600 kg → 100 kg ortiq
    fireEvent.click(screen.getByRole('button', { name: 'qop' }))
    typeQty('12')
    expect(screen.getByTestId('norm-left')).toHaveAttribute('data-over', 'true')
    expect(screen.getByText(tr.normOver('100', 'kg'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: tr.save })).toBeEnabled()
  })

  it('material smetada yo‘q — ogohlantirish', async () => {
    open()
    await pickMaterial('Qum')
    expect(await screen.findByText(tr.notInEstimate)).toBeInTheDocument()
    expect(screen.queryByText(tr.noEstimate)).not.toBeInTheDocument()
    expect(screen.queryByTestId('norm-left')).not.toBeInTheDocument()
    expect(normsRepo.listNormUsage).toHaveBeenCalledWith({ objectId: 'o-a' })
  })

  it('obyektda joriy smeta yo‘q — alohida matn', async () => {
    vi.mocked(normsRepo.listNormUsage).mockResolvedValue([])
    open()
    await pickMaterial('Sement')
    expect(await screen.findByText(tr.noEstimate)).toBeInTheDocument()
    expect(screen.queryByText(tr.notInEstimate)).not.toBeInTheDocument()
  })

  it('yetkazilgan sarfdan ko‘p bo‘lsa — qolgan yetkazilgan bo‘yicha (Y5)', async () => {
    // allowed 1000 − max(sarf 200, yetkazilgan 700) − ochiq 300 = 0
    vi.mocked(normsRepo.listNormUsage).mockResolvedValue([{ ...norm, delivered_qty_base: '700' }])
    open()
    await pickMaterial('Sement')
    expect(await screen.findByTestId('norm-left')).toHaveTextContent(tr.normLeft('0', 'kg'))
    typeQty('50')
    expect(screen.getByTestId('norm-left')).toHaveAttribute('data-over', 'true')
  })

  it('saqlash: kerakli sana tez tugmasi, idempotent qayta urinish (bir xil id)', async () => {
    vi.mocked(requestsRepo.createRequest)
      .mockRejectedValueOnce(new RepoError('network'))
      .mockResolvedValueOnce(request({ qty_input: '3' }))
    open()
    await pickMaterial('Sement')
    typeQty('3')
    fireEvent.click(screen.getByRole('button', { name: new RegExp(tr.needed.tomorrow) }))
    fireEvent.click(screen.getByRole('button', { name: tr.save }))
    expect(await screen.findByText(t.errors.network)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: tr.save }))
    // Tasdiq: ✓ belgisi (Lucide) va matn — role="status"
    expect((await screen.findByText(tr.saved('3', 'qop', 'Sement'), { exact: false })).closest('[role="status"]')).toBeInTheDocument()

    const calls = vi.mocked(requestsRepo.createRequest).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0]?.[0].id).toBe(calls[1]?.[0].id)
    expect(calls[0]?.[0]).toMatchObject({
      objectId: 'o-a',
      materialId: 'm-sem',
      unitId: 'm-sem-base',
      qtyInput: '3',
      neededBy: tashkentIsoDate(1),
    })
  })

  it('xato miqdor — saqlanmaydi', async () => {
    open()
    await pickMaterial('Sement')
    typeQty('abc')
    fireEvent.click(screen.getByRole('button', { name: tr.save }))
    expect(await screen.findByText(tm.errors.qty.not_number)).toBeInTheDocument()
    expect(requestsRepo.createRequest).not.toHaveBeenCalled()
  })

  it('"Mening so‘rovlarim" — holatlar va rad sababi', async () => {
    vi.mocked(requestsRepo.listMyRequests).mockResolvedValue([
      request(),
      request({ id: 'rq2', status: 'rad', decision_note: 'Smetada yo‘q' }),
    ])
    open()
    const list = await screen.findByRole('region', { name: tr.mine })
    await waitFor(() => expect(within(list).getAllByTestId('my-request')).toHaveLength(2))
    expect(within(list).getByText(t.requests.statuses.kutilmoqda)).toBeInTheDocument()
    expect(within(list).getByText(t.requests.statuses.rad)).toBeInTheDocument()
    expect(within(list).getByText(tr.reason('Smetada yo‘q'))).toBeInTheDocument()
  })
})

describe('/tg/request — O‘tkazma', () => {
  it('qayerdan → material → qayerga, joriy qoldiq, ortiq bo‘lsa ogohlantirish, create_transfer', async () => {
    vi.mocked(objectsRepo.listObjects).mockResolvedValue([objA, objB])
    open()
    fireEvent.click(await screen.findByRole('button', { name: tr.tabTransfer }))
    // Ikki obyekt — avval qayerdan
    const chooser = await screen.findByRole('region', { name: tm.chooseObject })
    fireEvent.click(within(chooser).getByRole('button', { name: 'Obyekt A' }))
    await pickMaterial('Sement')

    // Qayerga — faqat boshqa obyektlar
    const to = screen.getByRole('group', { name: tt.to })
    expect(within(to).queryByRole('button', { name: 'Obyekt A' })).not.toBeInTheDocument()
    expect(await screen.findByTestId('transfer-stock')).toHaveTextContent(tt.stock('420', 'kg'))

    // Qayerga tanlanmagan — saqlanmaydi
    typeQty('500') // 500 kg > 420
    expect(screen.getByText(tt.exceeds)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tt.save }))
    expect(await screen.findByText(tt.errorTo)).toBeInTheDocument()
    expect(transfersRepo.createTransfer).not.toHaveBeenCalled()

    fireEvent.click(within(to).getByRole('button', { name: 'Obyekt B' }))
    fireEvent.click(screen.getByRole('button', { name: tt.save }))
    expect(await screen.findByText(tt.saved('500', 'kg', 'Sement', 'Obyekt B'), { exact: false })).toBeInTheDocument()
    expect(transfersRepo.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ fromObjectId: 'o-a', toObjectId: 'o-b', materialId: 'm-sem', unitId: 'm-sem-base', qtyInput: '500' }),
    )
  })

  it('"qayerga" — transfer_target_objects (a\'zo bo\'lmagan obyektlar ham), joriy "qayerdan" chiqariladi', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: tr.tabTransfer }))
    await pickMaterial('Sement')
    const to = await screen.findByRole('group', { name: tt.to })
    expect(within(to).getAllByRole('button').map((b) => b.textContent)).toEqual(['Obyekt B', 'Obyekt C (boshqa prorab)'])
    expect(transfersRepo.listTransferTargets).toHaveBeenCalledTimes(1)
  })

  it('boshqa obyekt yo‘q — "qayerga" yo‘q xabari', async () => {
    vi.mocked(transfersRepo.listTransferTargets).mockResolvedValue([{ id: 'o-a', name: 'Obyekt A' }])
    open()
    fireEvent.click(await screen.findByRole('button', { name: tr.tabTransfer }))
    await pickMaterial('Sement')
    expect(await screen.findByText(tt.noTargets)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: tt.save })).not.toBeInTheDocument()
  })
})
