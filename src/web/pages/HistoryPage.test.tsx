import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthContext, type AuthState } from '@/auth/authContext'
import * as authRepo from '@/data/authRepo'
import { RepoError } from '@/data/errors'
import * as historyRepo from '@/data/historyRepo'
import type { AuditEntry, DeletedRecord } from '@/data/historyRepo'
import type { Role } from '@/domain/roles'
import { addDays } from '@/domain/reports'
import { t } from '@/i18n'
import * as excel from '@/lib/excelExport'
import { tashkentIsoDate } from '@/lib/format'
import { routes } from '@/routes'
import { makeProfile } from '@/test/fixtures'
import { HistoryLink } from '../history/HistoryLink'
import { historyHref } from '../history/historyQuery'

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
vi.mock('@/data/profilesRepo', () => ({ listProfiles: vi.fn(async () => [makeProfile('prorab')]) }))
vi.mock('@/data/historyRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/historyRepo')>()),
  listAuditFeed: vi.fn(),
  listAllAuditFeed: vi.fn(),
  listDeletedRecords: vi.fn(),
  restoreRecord: vi.fn(async () => undefined),
  getRecordDate: vi.fn(async () => null),
  loadRefNames: vi.fn(),
}))
vi.mock('@/lib/excelExport', async (orig) => ({
  ...(await orig<typeof import('@/lib/excelExport')>()),
  exportWorkbook: vi.fn(async () => undefined),
}))

const th = t.history
const REC = '5b0e6f0a-1c2d-4e3f-8a9b-0c1d2e3f4a5b'
const MAT = '6c1f7a1b-2d3e-4f40-9b0c-1d2e3f4a5b6c'
const SUP = '7d2a8b2c-3e4f-4051-8c1d-2e3f4a5b6c7d'

let seq = 100
function entry(p: Partial<AuditEntry> = {}): AuditEntry {
  seq -= 1
  return {
    id: seq,
    created_at: '2026-10-25T05:00:00Z',
    table_name: 'movements',
    record_id: REC,
    action: 'UPDATE',
    actor_profile_id: null,
    actor_name: 'Test admin',
    device: 'veb',
    changed_fields: ['note'],
    old_data: { note: 'eski' },
    new_data: { note: 'yangi' },
    record_label: 'Sement · 30 qop kirim',
    ...p,
  }
}

const purchaseUpdate = entry({
  table_name: 'purchases',
  record_label: 'Sement · xarid',
  changed_fields: ['total_amount', 'qty_base', 'material_id', 'supplier_id', 'updated_at'],
  old_data: { total_amount: '1000000.00', qty_base: '1000.000000', material_id: null, supplier_id: SUP, updated_at: 'x' },
  new_data: { total_amount: '1250000.00', qty_base: '1500.000000', material_id: MAT, supplier_id: null, updated_at: 'y' },
})

function setRole(role: Role) {
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile(role))
}

beforeEach(() => {
  vi.clearAllMocks()
  seq = 100
  setRole('admin')
  vi.mocked(historyRepo.listAuditFeed).mockResolvedValue({ rows: [entry()], hasMore: false })
  vi.mocked(historyRepo.listDeletedRecords).mockResolvedValue({ rows: [], hasMore: false })
  vi.mocked(historyRepo.restoreRecord).mockResolvedValue(undefined)
  vi.mocked(historyRepo.loadRefNames).mockResolvedValue({
    ...historyRepo.emptyRefNames(),
    materials: { [MAT]: 'Sement M400' },
    suppliers: { [SUP]: 'Baraka savdo' },
  })
})

function open(url = '/history') {
  const router = createMemoryRouter(routes, { initialEntries: [url] })
  render(<RouterProvider router={router} />)
  return router
}

const lastFeed = () => vi.mocked(historyRepo.listAuditFeed).mock.lastCall

describe('/history — Tarix', () => {
  it('standart davr (7 kun), filtrlar URL bilan sinxron', async () => {
    const router = open()
    expect(await screen.findByText('Sement · 30 qop kirim')).toBeInTheDocument()
    const today = tashkentIsoDate()
    expect(lastFeed()?.[0]).toMatchObject({ from: addDays(today, -6), to: today })

    fireEvent.change(screen.getByLabelText(th.filterTable), { target: { value: 'purchases' } })
    await waitFor(() => expect(lastFeed()?.[0]).toMatchObject({ table: 'purchases' }))
    expect(router.state.location.search).toContain('table=purchases')

    fireEvent.change(screen.getByLabelText(th.filterAction), { target: { value: 'SOFT_DELETE' } })
    fireEvent.change(screen.getByLabelText(th.filterDevice), { target: { value: 'mobil' } })
    await waitFor(() => expect(lastFeed()?.[0]).toMatchObject({ table: 'purchases', action: 'SOFT_DELETE', device: 'mobil' }))
    expect(router.state.location.search).toContain('device=mobil')
  })

  it('URL dan: ?record=&table= — bitta yozuv tarixi (366 kun), chipni yopish', async () => {
    const router = open(historyHref('movements', REC))
    expect(await screen.findByText(textIncludes(th.recordFilter))).toBeInTheDocument()
    const today = tashkentIsoDate()
    expect(lastFeed()?.[0]).toMatchObject({ recordId: REC, table: 'movements', from: addDays(today, -365), to: today })
    fireEvent.click(screen.getByRole('button', { name: th.recordFilterClear }))
    await waitFor(() => expect(lastFeed()?.[0]?.recordId).toBeUndefined())
    expect(router.state.location.search).not.toContain('record=')
  })

  it('noto‘g‘ri URL qiymatlari e’tiborsiz qoldiriladi', async () => {
    open('/history?table=audit_log&action=DROP&actor=x&device=pc&record=1')
    await screen.findByText('Sement · 30 qop kirim')
    const f = lastFeed()?.[0]
    expect(f).toMatchObject({ table: undefined, action: undefined, actorId: undefined, device: undefined, recordId: undefined })
  })

  it('keyset "Yana yuklash": oxirgi id bilan, qatorlar qo‘shiladi', async () => {
    const first = [entry({ record_label: 'Birinchi' }), entry({ record_label: 'Ikkinchi' })]
    vi.mocked(historyRepo.listAuditFeed)
      .mockResolvedValueOnce({ rows: first, hasMore: true })
      .mockResolvedValueOnce({ rows: [entry({ record_label: 'Uchinchi' })], hasMore: false })
    open()
    fireEvent.click(await screen.findByRole('button', { name: th.loadMore }))
    expect(await screen.findByText('Uchinchi')).toBeInTheDocument()
    expect(lastFeed()?.[1]).toBe(first[1]?.id)
    expect(screen.getAllByTestId('history-row')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: th.loadMore })).not.toBeInTheDocument()
  })

  it('diff: summa, miqdor va bog‘langan nomlar formatlangan, texnik maydonlar yo‘q', async () => {
    vi.mocked(historyRepo.listAuditFeed).mockResolvedValue({ rows: [purchaseUpdate], hasMore: false })
    open()
    fireEvent.click(await screen.findByText('Sement · xarid'))
    const diff = await screen.findByTestId('history-diff')
    const row = (field: string) => diff.querySelector(`tr[data-field="${field}"]`) as HTMLElement
    expect(within(row('total_amount')).getByText('1 000 000 so‘m')).toBeInTheDocument()
    expect(within(row('total_amount')).getByText('1 250 000 so‘m')).toBeInTheDocument()
    expect(within(row('qty_base')).getByText('1 500')).toBeInTheDocument()
    expect(within(row('material_id')).getByText('Sement M400')).toBeInTheDocument()
    expect(within(row('material_id')).getByText('—')).toBeInTheDocument()
    expect(within(row('supplier_id')).getByText('Baraka savdo')).toBeInTheDocument()
    expect(within(row('total_amount')).getByText(th.fields.total_amount ?? '')).toBeInTheDocument()
    expect(diff.querySelector('tr[data-field="updated_at"]')).toBeNull()
    expect(historyRepo.loadRefNames).toHaveBeenCalledTimes(1)
    expect(vi.mocked(historyRepo.loadRefNames).mock.calls[0]?.[0]).toMatchObject({ materials: [MAT], suppliers: [SUP] })
    expect(screen.getByRole('link', { name: th.wholeHistory })).toHaveAttribute('href', historyHref('purchases', purchaseUpdate.record_id))
  })

  it('tiklash: admin, tasdiq bilan; muvaffaqiyat — toast', async () => {
    const del = entry({ action: 'SOFT_DELETE', changed_fields: ['deleted_at'], old_data: { deleted_at: null }, new_data: { deleted_at: '2026-10-25T05:00:00Z' } })
    vi.mocked(historyRepo.listAuditFeed).mockResolvedValue({ rows: [del], hasMore: false })
    open()
    fireEvent.click(await screen.findByText('Sement · 30 qop kirim'))
    fireEvent.click(await screen.findByRole('button', { name: th.restore }))
    const dialog = await screen.findByRole('dialog', { name: th.restoreTitle })
    expect(historyRepo.restoreRecord).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: th.restore }))
    await waitFor(() => expect(historyRepo.restoreRecord).toHaveBeenCalledWith('movements', REC))
    expect(await screen.findByText(th.restored)).toBeInTheDocument()
  })

  it('tiklash xatosi — hint matni', async () => {
    const del = entry({ action: 'SOFT_DELETE', changed_fields: ['deleted_at'], old_data: { deleted_at: null }, new_data: { deleted_at: 'x' } })
    vi.mocked(historyRepo.listAuditFeed).mockResolvedValue({ rows: [del], hasMore: false })
    vi.mocked(historyRepo.restoreRecord).mockRejectedValue(new RepoError('restore_not_deleted'))
    open()
    fireEvent.click(await screen.findByText('Sement · 30 qop kirim'))
    fireEvent.click(await screen.findByRole('button', { name: th.restore }))
    const dialog = await screen.findByRole('dialog', { name: th.restoreTitle })
    fireEvent.click(within(dialog).getByRole('button', { name: th.restore }))
    expect(await within(dialog).findByText(t.errors.restore_not_deleted)).toBeInTheDocument()
  })

  it('direktor: ko‘radi, lekin "Tiklash" yo‘q', async () => {
    setRole('direktor')
    const del = entry({ action: 'SOFT_DELETE', changed_fields: ['deleted_at'], old_data: { deleted_at: null }, new_data: { deleted_at: 'x' } })
    vi.mocked(historyRepo.listAuditFeed).mockResolvedValue({ rows: [del], hasMore: false })
    open()
    fireEvent.click(await screen.findByText('Sement · 30 qop kirim'))
    await screen.findByRole('link', { name: th.wholeHistory })
    expect(screen.queryByRole('button', { name: th.restore })).not.toBeInTheDocument()
  })

  it('Excel: joriy filtr bo‘yicha hamma yozuvlar', async () => {
    vi.mocked(historyRepo.listAllAuditFeed).mockResolvedValue([purchaseUpdate])
    open('/history?table=purchases')
    await screen.findByText('Sement · 30 qop kirim')
    fireEvent.click(screen.getByRole('button', { name: t.excel.button }))
    await waitFor(() => expect(excel.exportWorkbook).toHaveBeenCalled())
    expect(vi.mocked(historyRepo.listAllAuditFeed).mock.calls[0]?.[0]).toMatchObject({ table: 'purchases' })
    const sheet = vi.mocked(excel.exportWorkbook).mock.calls[0]?.[0].sheets[0]
    expect(String(sheet?.rows[0]?.changes)).toContain('1 000 000 so‘m → 1 250 000 so‘m')
    expect(String(sheet?.rows[0]?.changes)).toContain('Sement M400')
  })
})

describe('/history — O‘chirilganlar', () => {
  const rec: DeletedRecord & { record_label: string } = { table_name: 'purchases', record_id: REC, record_label: 'Qum · xarid', deleted_at: '2026-10-25T05:00:00Z', deleted_by_name: 'Test admin' }

  it('davr va jadval filtri, tiklash — ro‘yxatdan chiqadi', async () => {
    vi.mocked(historyRepo.listDeletedRecords).mockResolvedValue({ rows: [rec], hasMore: false })
    const router = open('/history?tab=deleted&table=purchases')
    expect(await screen.findByText('Qum · xarid')).toBeInTheDocument()
    expect(vi.mocked(historyRepo.listDeletedRecords).mock.lastCall?.[0]).toMatchObject({ table: 'purchases' })
    expect(historyRepo.listAuditFeed).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(th.filterAction)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: th.restore }))
    const dialog = await screen.findByRole('dialog', { name: th.restoreTitle })
    fireEvent.click(within(dialog).getByRole('button', { name: th.restore }))
    await waitFor(() => expect(historyRepo.restoreRecord).toHaveBeenCalledWith('purchases', REC))
    await waitFor(() => expect(screen.queryByText('Qum · xarid')).not.toBeInTheDocument())
    expect(screen.getByText(th.restored)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: th.tabFeed }))
    await waitFor(() => expect(router.state.location.search).not.toContain('tab=deleted'))
  })

  it('tiklanmaydigan jadval (transfers) — "Tiklash" yo‘q', async () => {
    vi.mocked(historyRepo.listDeletedRecords).mockResolvedValue({ rows: [{ ...rec, table_name: 'transfers' }], hasMore: false })
    open('/history?tab=deleted')
    await screen.findByText('Qum · xarid')
    expect(screen.queryByRole('button', { name: th.restore })).not.toBeInTheDocument()
  })
})

function auth(role: Role): AuthState {
  return {
    configured: true,
    loading: false,
    session: { userId: 'u', email: null, mustChangePassword: false },
    profile: makeProfile(role),
    profileError: null,
    notice: null,
    clearNotice: () => undefined,
    signOut: async () => undefined,
    reloadProfile: () => undefined,
    refreshSession: async () => undefined,
  }
}

const softDelete = (p: Partial<AuditEntry> = {}) =>
  entry({ action: 'SOFT_DELETE', changed_fields: ['deleted_at'], old_data: { deleted_at: null }, new_data: { deleted_at: '2026-10-25T05:00:00Z' }, ...p })

async function openRestore(rows: AuditEntry[], title: string) {
  vi.mocked(historyRepo.listAuditFeed).mockResolvedValue({ rows, hasMore: false })
  open()
  fireEvent.click(await screen.findByText(title))
  fireEvent.click(await screen.findByRole('button', { name: th.restore }))
  return screen.findByRole('dialog', { name: th.restoreTitle })
}

describe('/history — tiklash ogohlantirishlari (review)', () => {
  it('eski sanali harakat: sana, "O‘tgan davr", direktorga xabar', async () => {
    const dialog = await openRestore(
      [softDelete({ old_data: { deleted_at: null, occurred_at: '2025-01-10T05:00:00Z' }, new_data: { deleted_at: 'x', occurred_at: '2025-01-10T05:00:00Z' } })],
      'Sement · 30 qop kirim',
    )
    expect(within(dialog).getByText(th.restoreDate('10.01.2025'))).toBeInTheDocument()
    expect(within(dialog).getByText(th.restorePastPeriod)).toBeInTheDocument()
    expect(within(dialog).getByText(th.restoreNotify)).toBeInTheDocument()
    expect(within(dialog).queryByText(th.restoreProfileNote)).not.toBeInTheDocument()
  })

  it('joriy oy sanasi — "O‘tgan davr" yo‘q', async () => {
    const now = new Date().toISOString()
    const dialog = await openRestore([softDelete({ new_data: { deleted_at: 'x', occurred_at: now } })], 'Sement · 30 qop kirim')
    expect(within(dialog).queryByText(th.restorePastPeriod)).not.toBeInTheDocument()
    expect(within(dialog).getByText(th.restoreNotify)).toBeInTheDocument()
  })

  it('profil: nofaol holda tiklanadi, toast — Foydalanuvchilar havolasi', async () => {
    const dialog = await openRestore([softDelete({ table_name: 'profiles', record_label: 'Ali Valiyev' })], 'Ali Valiyev')
    expect(within(dialog).getByText(th.restoreProfileNote)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: th.restore }))
    const toast = (await screen.findByText(th.restoredProfile)).closest('[role=status]') as HTMLElement
    expect(within(toast).getByRole('link', { name: th.restoredProfileLink })).toHaveAttribute('href', '/users')
  })

  it('smeta: joriy bo‘lmagan versiya sifatida tiklandi', async () => {
    const dialog = await openRestore([softDelete({ table_name: 'estimates', record_label: 'Smeta v2' })], 'Smeta v2')
    fireEvent.click(within(dialog).getByRole('button', { name: th.restore }))
    expect(await screen.findByText(th.restoredEstimate)).toBeInTheDocument()
  })

  it('o‘tkazma harakati va keyinroq tiklangan yozuv — "Tiklash" yo‘q', async () => {
    const transfer = softDelete({ record_label: 'O‘tkazma harakati', new_data: { deleted_at: 'x', transfer_id: REC } })
    const restoredAgain = entry({ action: 'RESTORE', id: 500, record_id: MAT, record_label: 'Qayta tiklangan' })
    const oldDelete = softDelete({ record_id: MAT, record_label: 'Oldin o‘chirilgan' })
    vi.mocked(historyRepo.listAuditFeed).mockResolvedValue({ rows: [restoredAgain, transfer, oldDelete], hasMore: false })
    open()
    fireEvent.click(await screen.findByText('O‘tkazma harakati'))
    await screen.findByRole('link', { name: th.wholeHistory })
    expect(screen.queryByRole('button', { name: th.restore })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.common.close }))
    fireEvent.click(screen.getByText('Oldin o‘chirilgan'))
    expect(await screen.findByText(th.restoredLater)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: th.restore })).not.toBeInTheDocument()
  })

  it('alert yozuvi nomidagi xom tur tarjima qilinadi', async () => {
    vi.mocked(historyRepo.listAuditFeed).mockResolvedValue({ rows: [entry({ table_name: 'alerts', record_label: 'yozuv_ochirildi · Sement' })], hasMore: false })
    open()
    expect(await screen.findByText(`${t.alertTexts.types.yozuv_ochirildi} · Sement`)).toBeInTheDocument()
  })

  it('O‘chirilganlar: yozuv sanasi serverdan', async () => {
    vi.mocked(historyRepo.listDeletedRecords).mockResolvedValue({
      rows: [{ table_name: 'cash_advances', record_id: REC, record_label: 'Ali · 500 000 so‘m', deleted_at: '2026-10-25T05:00:00Z', deleted_by_name: null }],
      hasMore: false,
    })
    vi.mocked(historyRepo.getRecordDate).mockResolvedValue('2025-03-01T05:00:00Z')
    open('/history?tab=deleted')
    fireEvent.click(await screen.findByRole('button', { name: th.restore }))
    const dialog = await screen.findByRole('dialog', { name: th.restoreTitle })
    expect(await within(dialog).findByText(th.restoreDate('01.03.2025'))).toBeInTheDocument()
    expect(within(dialog).getByText(th.restorePastPeriod)).toBeInTheDocument()
    expect(historyRepo.getRecordDate).toHaveBeenCalledWith('cash_advances', REC)
  })
})

describe('"Tarix" havolasi', () => {
  it.each(['admin', 'direktor'] as const)('%s — havola bor', (role) => {
    render(
      <AuthContext.Provider value={auth(role)}>
        <MemoryRouter>
          <HistoryLink table="materials" id={REC} />
        </MemoryRouter>
      </AuthContext.Provider>,
    )
    expect(screen.getByRole('link', { name: th.link })).toHaveAttribute('href', `/history?record=${REC}&table=materials`)
  })

  it.each(['buxgalter', 'prorab'] as const)('%s — havola yo‘q', (role) => {
    render(
      <AuthContext.Provider value={auth(role)}>
        <MemoryRouter>
          <HistoryLink table="materials" id={REC} />
        </MemoryRouter>
      </AuthContext.Provider>,
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

function textIncludes(part: string) {
  return (_: string, el: Element | null) => Boolean(el?.textContent?.includes(part)) && !Array.from(el?.children ?? []).some((c) => c.textContent?.includes(part))
}
