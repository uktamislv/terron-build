// Batch 12 — veb: sozlamalar, obyekt koordinatasi, "rasm majburiy", podotchet qaytarish,
// 9 yangi alert turi matni, xarid QR belgisi va joylashuv.
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext, type AuthState } from '@/auth/authContext'
import * as cashRepo from '@/data/cashRepo'
import * as companiesRepo from '@/data/companiesRepo'
import * as materialsRepo from '@/data/materialsRepo'
import * as objectMembersRepo from '@/data/objectMembersRepo'
import * as objectsRepo from '@/data/objectsRepo'
import * as profilesRepo from '@/data/profilesRepo'
import type { Alert, AlertType, Purchase } from '@/data/types'
import { ALERT_TYPES } from '@/data/types'
import { t } from '@/i18n'
import { makeObject, makeProfile } from '@/test/fixtures'
import { plain } from '@/test/text'
import { alertDetailText } from '../alerts/alertDetails'
import { AlertTypeIcon } from '../alerts/AlertTypeIcon'
import { IssueAdvanceDialog } from '../cash/IssueAdvanceDialog'
import { MaterialFormDialog } from '../materials/MaterialFormDialog'
import { parseGeoForm, splitCoordPair } from '../objects/objectGeo'
import { PurchaseGeo, PurchaseQr } from '../purchases/PurchaseAutomationInfo'
import { QrBadge } from '../purchases/QrBadge'
import { CompanySettingsForm } from '../settings/CompanySettingsForm'
import { fromForm, toForm } from '../settings/settingsForm'
import { WebLayout } from '../WebLayout'
import { ObjectsPage } from './ObjectsPage'

vi.mock('@/data/companiesRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/companiesRepo')>()),
  getCompanySettings: vi.fn(),
  updateCompanySettings: vi.fn(async () => undefined),
}))
vi.mock('@/data/cashRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/cashRepo')>()),
  issueAdvance: vi.fn(),
}))
vi.mock('@/data/materialsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/materialsRepo')>()),
  createMaterial: vi.fn(async () => ({ id: 'm-new' })),
  updateMaterial: vi.fn(async () => undefined),
}))
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn(), createObject: vi.fn(), updateObject: vi.fn(async () => ({})) }))
vi.mock('@/data/objectMembersRepo', () => ({ listObjectMembers: vi.fn(async () => []), addObjectMember: vi.fn(), removeObjectMember: vi.fn() }))
vi.mock('@/data/profilesRepo', () => ({ listProfiles: vi.fn(async () => []) }))

const ts = t.settings
const tg = t.objectGeo
const td = t.alertsPage.details

function withAuth(role: 'admin' | 'direktor', children: ReactNode) {
  const value: AuthState = {
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
  return (
    <MemoryRouter>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(companiesRepo.getCompanySettings).mockResolvedValue(companiesRepo.DEFAULT_COMPANY_SETTINGS)
  vi.mocked(objectsRepo.listObjects).mockResolvedValue([{ ...makeObject('o-a', 'Obyekt A'), lat: '41.311081', lng: '69.240562', radius_m: 250 }])
  vi.mocked(objectMembersRepo.listObjectMembers).mockResolvedValue([])
  vi.mocked(profilesRepo.listProfiles).mockResolvedValue([])
})

describe('Sozlamalar', () => {
  it('settingsForm: chegaralar (db-design.md)', () => {
    const base = toForm(companiesRepo.DEFAULT_COMPANY_SETTINGS)
    expect(base.photoRequiredAmount).toBe('')
    expect(fromForm(base)).toEqual({ ok: true, value: companiesRepo.DEFAULT_COMPANY_SETTINGS })
    const bad = fromForm({ ...base, cashMaxDays: '0', duplicateWindowMinutes: '1441', requestOverbuyPct: '1000.5', photoRequiredAmount: '0' })
    expect(bad).toEqual({ ok: false, errors: { cashMaxDays: true, duplicateWindowMinutes: true, requestOverbuyPct: true, photoRequiredAmount: true } })
    // Audit (B2): takroriy yozuv oynasi 1..1440 (0 — endi yo'q)
    expect(fromForm({ ...base, duplicateWindowMinutes: '0' }).ok).toBe(false)
    const ok = fromForm({ ...base, duplicateWindowMinutes: '1', photoRequiredAmount: '1 500 000' })
    expect(ok.ok && ok.value).toMatchObject({ duplicateWindowMinutes: 1, photoRequiredAmount: '1500000' })
  })

  it('forma: o‘qiydi, tekshiradi va saqlaydi', async () => {
    render(<CompanySettingsForm companyId="c" canEdit />)
    const amount = await screen.findByLabelText(ts.photoRequiredAmount)
    fireEvent.change(amount, { target: { value: '2000000' } })
    expect(amount).toHaveValue('2 000 000')
    fireEvent.change(screen.getByLabelText(ts.forecastDaysWarn), { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: t.common.save }))
    expect(await screen.findByText(ts.errInt(1, 60))).toBeInTheDocument()
    expect(companiesRepo.updateCompanySettings).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(ts.forecastDaysWarn), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: t.common.save }))
    await waitFor(() => expect(companiesRepo.updateCompanySettings).toHaveBeenCalled())
    expect(vi.mocked(companiesRepo.updateCompanySettings).mock.calls[0]?.[1]).toMatchObject({ photoRequiredAmount: '2000000', forecastDaysWarn: 5 })
    expect(await screen.findByText(ts.saved)).toBeInTheDocument()
  })

  it('Batch 11: admin — yon menyuda "Sozlamalar" havolasi (/settings, modal emas); direktor ko‘rmaydi', () => {
    const { unmount } = render(withAuth('admin', <WebLayout>{null}</WebLayout>))
    expect(screen.getByRole('link', { name: t.web.nav.settings })).toHaveAttribute('href', '/settings')
    expect(screen.queryByRole('button', { name: ts.open })).not.toBeInTheDocument()
    unmount()
    render(withAuth('direktor', <WebLayout>{null}</WebLayout>))
    expect(screen.queryByRole('link', { name: t.web.nav.settings })).not.toBeInTheDocument()
  })
})

describe('Obyekt koordinatasi', () => {
  it('parseGeoForm: juft, chegaralar, radius 10..50000', () => {
    expect(parseGeoForm('41.3110812', '69.24', '')).toEqual({ ok: true, value: { lat: '41.311081', lng: '69.24', radiusM: 300 } })
    expect(parseGeoForm('', '', '300')).toEqual({ ok: true, value: { lat: null, lng: null, radiusM: 300 } })
    expect(parseGeoForm('41.3', '', '300')).toEqual({ ok: false, errors: { pair: true } })
    expect(parseGeoForm('91', '200', '5')).toEqual({ ok: false, errors: { lat: true, lng: true, radius: true } })
    expect(parseGeoForm('1', '1', '50001')).toMatchObject({ ok: false })
    expect(splitCoordPair('41.311081, 69.240562')).toEqual({ lat: '41.311081', lng: '69.240562' })
  })

  it('obyekt kartasida holat; tahrirda koordinata saqlanadi', async () => {
    render(withAuth('admin', <ObjectsPage />))
    expect(await screen.findByTestId('object-geo')).toHaveTextContent(tg.set('250'))
    fireEvent.click(screen.getByRole('button', { name: t.common.edit }))
    const lat = await screen.findByLabelText(tg.lat)
    expect(lat).toHaveValue('41.311081')
    fireEvent.change(lat, { target: { value: '40.1, 65.2' } })
    expect(screen.getByLabelText(tg.lng)).toHaveValue('65.2')
    fireEvent.change(screen.getByLabelText(tg.radius), { target: { value: '400' } })
    fireEvent.click(screen.getByRole('button', { name: t.common.save }))
    await waitFor(() => expect(objectsRepo.updateObject).toHaveBeenCalled())
    expect(vi.mocked(objectsRepo.updateObject).mock.calls[0]?.[1]).toMatchObject({ lat: '40.1', lng: '65.2', radiusM: 400 })
  })
})

describe('Material "rasm majburiy"', () => {
  it('yangi materialda belgilanadi', async () => {
    render(<MaterialFormDialog companyId="c" materials={[]} categories={[]} onClose={() => undefined} onSaved={() => undefined} />)
    fireEvent.change(screen.getByLabelText(t.materials.name), { target: { value: 'Kafel' } })
    fireEvent.click(screen.getByRole('button', { name: 'm²' }))
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(t.materials.photoRequired) }))
    fireEvent.click(screen.getByRole('button', { name: t.common.save }))
    await waitFor(() => expect(materialsRepo.createMaterial).toHaveBeenCalled())
    expect(vi.mocked(materialsRepo.createMaterial).mock.calls[0]?.[0]).toMatchObject({ name: 'Kafel', photoRequired: true })
  })
})

describe('Podotchet — qaytarish', () => {
  it('"Qaytarish" — kind qaytarildi', async () => {
    vi.mocked(cashRepo.issueAdvance).mockResolvedValue({
      id: 'a1',
      company_id: 'c',
      recipient_id: 'p-haydovchi',
      kind: 'qaytarildi',
      amount: '50000',
      issued_at: '2026-10-25T05:00:00Z',
      note: null,
      created_by: null,
      created_at: '2026-10-25T05:00:00Z',
      deleted_at: null,
      recipient_name: 'Ali',
      created_by_name: null,
    })
    const onIssued = vi.fn()
    render(<IssueAdvanceDialog companyId="c" recipients={[makeProfile('haydovchi')]} kind="qaytarildi" onClose={() => undefined} onIssued={onIssued} />)
    expect(screen.getByRole('heading', { name: t.cash.giveBackTitle })).toBeInTheDocument()
    expect(screen.getByText(t.cash.giveBackHint)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(t.cash.amount), { target: { value: '50000' } })
    fireEvent.click(screen.getByRole('button', { name: t.cash.giveBack }))
    await waitFor(() => expect(onIssued).toHaveBeenCalled())
    expect(vi.mocked(cashRepo.issueAdvance).mock.calls[0]?.[0]).toMatchObject({ kind: 'qaytarildi', amount: '50000', recipientId: 'p-haydovchi' })
  })
})

describe('Yangi alert turlari', () => {
  const alert = (type: AlertType, details: Record<string, unknown>, base_unit: string | null = 'kg'): Pick<Alert, 'type' | 'details' | 'base_unit'> => ({
    type,
    details,
    base_unit,
  })

  it('har biriga nom va belgi', () => {
    for (const type of ALERT_TYPES) {
      expect(t.alertTexts.types[type]).toBeTruthy()
      const { container, unmount } = render(<AlertTypeIcon type={type} />)
      expect(container.querySelector('svg')).not.toBeNull()
      unmount()
    }
  })

  it.each([
    [alert('kirim_manbasiz', { reason: 'open_purchase', qty_base: 150, base_unit: 'kg' }), td.unsourcedOpenPurchase('150 kg')],
    [alert('kirim_manbasiz', { reason: 'no_source', qty_base: 2.5, base_unit: 'm³' }), td.unsourcedNoSource('2,5 m³')],
    [alert('kirim_manbasiz', { reason: 'unlinked_candidate', qty_base: 50 }), td.unsourcedCandidate('50 kg')],
    [alert('manfiy_qoldiq', { stock_after: -20, qty_base: 50, unit: 'kg', movement_type: 'chiqim' }), td.negativeStock('−20 kg', '50 kg')],
    [alert('takroriy_yozuv', { kind: 'record', table: 'purchases', window_minutes: 10 }), td.duplicateEntryWindow('Xarid', '10')],
    [alert('takroriy_yozuv', { kind: 'photo', table: 'movements', first_table: 'purchases' }), td.duplicatePhoto('Harakat')],
    [alert('joylashuv_farqi', { distance_m: 1250, radius_m: 300, accuracy_m: 20 }), td.locationFar('1 250', '300') + td.locationAccuracy('20')],
    [
      alert('smetasiz_chiqim', { day: '2026-10-25', count: 2, materials: [{ material_name: 'Sement', qty_base: 100, base_unit: 'kg' }] }),
      td.noEstimateOut(2, 'Sement 100 kg'),
    ],
    [alert('chek_farqi', { receipt_total: 250000, total_amount: 300000, diff: 50000 }), td.receiptTotal('250 000 so‘m', '300 000 so‘m')],
    [
      alert('sorovdan_ortiq_xarid', { request_qty_base: 1000, purchased_qty_base: 1300, over_pct: 30, threshold_pct: 20, base_unit: 'kg' }),
      td.requestOverbuy('1 000 kg', '1 300 kg', '30'),
    ],
    [alert('podotchet_muddati', { profile_name: 'Ali', balance: 500000, days_open: 20, max_days: 14 }), td.cashOverdue('Ali', '500 000 so‘m', '20')],
    [alert('podotchet_manfiy', { profile_name: 'Vali', balance: -10000 }), td.cashNegative('Vali', '−10 000 so‘m')],
  ])('%#: details → matn', (a, expected) => {
    expect(plain(alertDetailText(a))).toBe(expected)
  })
})

describe('Xarid: QR belgisi va joylashuv', () => {
  const base = { receipt_verified: false, receipt_fiscal_sign: null } as Pick<Purchase, 'receipt_verified' | 'receipt_fiscal_sign'>

  it('QR tasdiqlangan / skanerlangan / yo‘q', () => {
    const { rerender, container } = render(<QrBadge p={{ ...base, receipt_verified: true, receipt_fiscal_sign: '1' }} />)
    expect(screen.getByTestId('qr-verified')).toHaveTextContent(t.purchases.qrVerified)
    rerender(<QrBadge p={{ ...base, receipt_fiscal_sign: '1' }} />)
    expect(screen.getByText(t.purchases.qrScanned)).toBeInTheDocument()
    rerender(<QrBadge p={base} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('tafsilotda: chek maydonlari va joylashuv', () => {
    const p = {
      receipt_fiscal_sign: '248429044289',
      receipt_terminal_id: 'UZ170703100189',
      receipt_no: '643',
      receipt_total: '250000',
      seller_tin: '123456789',
      receipt_verified: false,
      geo_status: 'ok',
      geo_lat: '41.311081',
      geo_lng: '69.240562',
      geo_accuracy_m: 12,
    } as Purchase
    render(
      <>
        <PurchaseQr p={p} />
        <PurchaseGeo p={p} />
      </>,
    )
    const qr = screen.getByTestId('purchase-qr')
    expect(within(qr).getByText('248429044289')).toBeInTheDocument()
    expect(within(qr).getByText(t.purchases.qrVerifiedNo)).toBeInTheDocument()
    const geo = screen.getByTestId('purchase-geo')
    expect(geo).toHaveTextContent(t.purchases.geoStatus.ok)
    expect(geo).toHaveTextContent('41.311081, 69.240562')
    expect(within(geo).getByRole('link', { name: t.purchases.geoOpenMap })).toHaveAttribute('href', expect.stringContaining('mlat=41.311081'))
  })

  it('joylashuvsiz (veb / eski)', () => {
    render(<PurchaseGeo p={{ geo_status: null } as Purchase} />)
    expect(screen.getByText(t.purchases.geoNone)).toBeInTheDocument()
  })
})
