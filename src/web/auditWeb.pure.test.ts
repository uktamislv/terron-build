// Audit tuzatishlari — veb sof funksiyalari: sozlamalar chegaralari va tinch soatlar, Telegram holati,
// Excel varaqlari, "Xarid qo'shish" formasi, sotuvchilar qidiruvi.
import { DEFAULT_COMPANY_SETTINGS, type NotificationHealth } from '@/data/companiesRepo'
import { supplierPatchToRow } from '@/data/suppliersRepo'
import type { EstimateItem, InventoryDetailRow, Supplier, Transfer } from '@/data/types'
import { t } from '@/i18n'
import { makeMaterial, makeUnit } from '@/test/fixtures'
import { estimateItemsSheet, inventorySheet, materialsSheets, transfersSheet } from './exports'
import { filterSuppliers } from './materials/supplierFilter'
import { emptyPurchaseForm, validateAddPurchase } from './purchases/addPurchaseForm'
import { fromForm, INT_LIMITS, PCT_LIMITS, parseTime, QUIET_TIME_OPTIONS, toForm } from './settings/settingsForm'
import { healthLevel, kindLabel, needsSetupHint, statusLabel } from './settings/telegramHealth'

describe('settingsForm — yangi chegaralar (B2) va tinch soatlar (C)', () => {
  const base = toForm(DEFAULT_COMPANY_SETTINGS)

  it('chegaralar bazadagi CHECK bilan bir xil', () => {
    expect(PCT_LIMITS).toEqual({ receiptMismatchPct: 50, priceDeviationPct: 50, requestOverbuyPct: 200 })
    expect(INT_LIMITS.duplicateWindowMinutes).toEqual([1, 1440])
    expect(INT_LIMITS.alertRemindHours).toEqual([1, 168])
  })

  it.each([
    ['priceDeviationPct', '50.01'],
    ['receiptMismatchPct', '51'],
    ['requestOverbuyPct', '200.5'],
    ['duplicateWindowMinutes', '0'],
    ['alertRemindHours', '169'],
  ] as const)('%s = %s — xato', (key, value) => {
    const r = fromForm({ ...base, [key]: value })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors[key]).toBe(true)
  })

  it('chegaraning o‘zi — to‘g‘ri', () => {
    const r = fromForm({ ...base, priceDeviationPct: '50', requestOverbuyPct: '0', duplicateWindowMinutes: '1440', alertRemindHours: '168' })
    expect(r.ok).toBe(true)
  })

  it('tinch soatlar: standart 22:00–07:00; ikkalasi bo‘sh — o‘chiq (null)', () => {
    expect(base.quietHoursStart).toBe('22:00')
    expect(base.quietHoursEnd).toBe('07:00')
    expect(fromForm(base)).toMatchObject({ ok: true, value: { quietHoursStart: '22:00', quietHoursEnd: '07:00' } })
    expect(fromForm({ ...base, quietHoursStart: '', quietHoursEnd: '' })).toMatchObject({
      ok: true,
      value: { quietHoursStart: null, quietHoursEnd: null },
    })
  })

  it('tinch soatlar: bittasi bo‘sh, noto‘g‘ri yoki bir xil — xato', () => {
    expect(fromForm({ ...base, quietHoursEnd: '' })).toMatchObject({ ok: false, errors: { quietHoursEnd: true } })
    expect(fromForm({ ...base, quietHoursStart: '25:00' })).toMatchObject({ ok: false, errors: { quietHoursStart: true } })
    expect(fromForm({ ...base, quietHoursStart: '07:00', quietHoursEnd: '07:00' })).toMatchObject({ ok: false, errors: { quietHoursEnd: true } })
  })

  it('parseTime va tanlov ro‘yxati (30 daqiqa)', () => {
    expect(parseTime(' 06:30 ')).toBe('06:30')
    expect(parseTime('6:30')).toBeNull()
    expect(QUIET_TIME_OPTIONS).toHaveLength(48)
    expect(QUIET_TIME_OPTIONS[0]).toBe('00:00')
    expect(QUIET_TIME_OPTIONS.at(-1)).toBe('23:30')
  })
})

describe('Telegram holati', () => {
  const ok: NotificationHealth = { lastSentAt: '2026-10-26T10:00:00Z', stuckPendingCount: 0, failed7dCount: 0, lastErrors: [], blockedProfiles: [] }
  const blocked = [{ profileId: 'p', fullName: 'Ali', role: 'prorab', blockedAt: null }]

  it('tiqilib qolgan — danger; 7 kunda xato yoki bloklagan — warn; aks holda ok', () => {
    expect(healthLevel(ok)).toBe('ok')
    expect(healthLevel({ ...ok, lastSentAt: null })).toBe('ok')
    expect(healthLevel({ ...ok, failed7dCount: 2 })).toBe('warn')
    expect(healthLevel({ ...ok, blockedProfiles: blocked })).toBe('warn')
    expect(healthLevel({ ...ok, stuckPendingCount: 1, failed7dCount: 3 })).toBe('danger')
  })

  it('sozlash skripti maslahati — tiqilish yoki xatolarda', () => {
    expect(needsSetupHint(ok)).toBe(false)
    expect(needsSetupHint({ ...ok, failed7dCount: 1 })).toBe(true)
    expect(needsSetupHint({ ...ok, blockedProfiles: blocked })).toBe(false)
    // Admin uchun — qo'llab-quvvatlashga murojaat; dasturchi skripti faqat docs'da
    expect(t.settings.health.fixHint).toContain('qo‘llab-quvvatlash')
    expect(t.settings.health.fixHint).not.toContain('setup-telegram')
  })

  it('xabar turi va holati — o‘zbekcha, noma’lumi xom ko‘rsatilmaydi', () => {
    expect(kindLabel('daily_report')).toBe(t.settings.health.kinds.daily_report)
    expect(kindLabel('request_created')).toBe(t.settings.health.kinds.request_created)
    expect(kindLabel('xyz')).toBe(t.settings.health.kindOther)
    expect(statusLabel('failed')).toBe(t.settings.health.statuses.failed)
    expect(statusLabel('weird')).toBe(t.settings.health.statusOther)
  })
})

describe('Excel varaqlari', () => {
  const transfer = {
    id: 't1',
    created_at: '2026-10-26T05:00:00Z',
    from_object_name: 'A',
    to_object_name: 'B',
    material_name: 'Sement',
    qty_input: '3',
    unit_input: 'qop',
    unit_variant: null,
    qty_base: '150',
    received_qty_base: '140',
    base_unit: 'kg',
    status: 'qabul_qilindi',
    received_at: '2026-10-26T08:00:00Z',
    created_by_name: 'Ali',
    cancel_reason: null,
    note: null,
  } as unknown as Transfer

  it('o‘tkazmalar: farq = qabul − yuborilgan (raqam), holat matni', () => {
    const sheet = transfersSheet([transfer, { ...transfer, id: 't2', received_qty_base: null, status: 'yuborildi' }])
    expect(sheet.sheetName).toBe(t.excel.sheets.transfers)
    expect(sheet.rows[0]).toMatchObject({ qty_base: '150', received: '140', diff: '-10', status: t.transfers.statuses.qabul_qilindi, user: 'Ali' })
    expect(sheet.rows[1]).toMatchObject({ received: null, diff: null })
    expect(sheet.columns.find((c) => c.key === 'diff')?.type).toBe('qty')
  })

  it('inventarizatsiya: kamomadlar birinchi, qiymat — pul ustuni', () => {
    const row = (name: string, diff: string | null, value: string | null): InventoryDetailRow => ({
      material_id: name,
      material_name: name,
      base_unit: 'kg',
      qty_input: null,
      unit_id: null,
      qty_counted: '1',
      qty_expected: '1',
      diff,
      shortage_value: value,
    })
    const sheet = inventorySheet([row('Qum', '2', null), row('Sement', '-10', '120000'), row('Shag‘al', null, null)], {
      objectName: 'Obyekt A',
      countedAt: '2026-10-26T05:00:00Z',
    })
    expect(sheet.rows.map((r) => r.material)).toEqual(['Sement', 'Qum', 'Shag‘al'])
    expect(sheet.rows[0]).toMatchObject({ object: 'Obyekt A', diff: '-10', shortage_value: '120000' })
    expect(sheet.columns.find((c) => c.key === 'shortage_value')?.type).toBe('money')
  })

  it('materiallar: ikki varaq — katalog va birliklar koeffitsienti bilan', () => {
    const m = makeMaterial('m1', 'Sement', 'kg', { units: [makeUnit('u1', 'm1', 'kg', '1'), makeUnit('u2', 'm1', 'qop', '50')] })
    const [cat, units] = materialsSheets([m])
    expect(cat?.rows[0]).toMatchObject({ name: 'Sement', base_unit: 'kg', active: t.common.yes })
    expect(units?.rows).toContainEqual({ material: 'Sement', unit: 'qop', variant: null, factor: '50', base_unit: 'kg' })
    expect(units?.rows.every((r) => r.material === 'Sement')).toBe(true)
  })

  it('smeta qatorlari: tur matni, summa va norma', () => {
    const item = {
      id: 'i1',
      estimate_id: 'e',
      item_type: 'material',
      name: 'Цемент М400',
      material_id: 'm1',
      unit: 'т',
      unit_id: null,
      qty: '2',
      unit_price: '1500000',
      line_sum: '3000000',
      norm_qty_base: '2000',
      sort_order: 1,
      code: 'C-1',
      row_number: 7,
      material_name: 'Sement',
      base_unit: 'kg',
    } as EstimateItem
    const sheet = estimateItemsSheet([item])
    expect(sheet.rows[0]).toMatchObject({ row_number: 7, item_type: t.excel.itemTypes.material, line_sum: '3000000', norm_qty_base: '2000' })
    expect(sheet.columns.find((c) => c.key === 'unit_price')?.type).toBe('money')
  })
})

describe('"Xarid qo‘shish" formasi', () => {
  const NOW = '2026-10-26T10:30:00.000Z'
  const filled = { ...emptyPurchaseForm('2026-10-26'), objectId: 'o', materialId: 'm', unitId: 'u', qty: '3', total: '1 250 000' }

  it('bugun — purchasedAt null; summa va miqdor Dec satr', () => {
    expect(validateAddPurchase(filled, { nowIso: NOW, isAdmin: false })).toEqual({
      ok: true,
      value: { qtyInput: '3', totalAmount: '1250000', purchasedAt: null },
    })
  })

  it('majburiy maydonlar va sotuvchi', () => {
    const r = validateAddPurchase({ ...emptyPurchaseForm(''), supplierMode: 'new' }, { nowIso: NOW, isAdmin: false })
    expect(r).toEqual({
      ok: false,
      errors: {
        object: 'required',
        material: 'required',
        unit: 'required',
        qty: 'required',
        total: 'required',
        supplier: 'required',
        date: 'required',
      },
    })
    expect(validateAddPurchase({ ...filled, supplierMode: 'existing' }, { nowIso: NOW, isAdmin: false })).toMatchObject({
      errors: { supplier: 'required' },
    })
  })

  it('sana: admin bo‘lmaganlarga 3 kundan eski — xato; admin — mumkin', () => {
    expect(validateAddPurchase({ ...filled, date: '2026-10-20' }, { nowIso: NOW, isAdmin: false })).toMatchObject({
      ok: false,
      errors: { date: 'invalid' },
    })
    expect(validateAddPurchase({ ...filled, date: '2026-10-20' }, { nowIso: NOW, isAdmin: true })).toMatchObject({
      ok: true,
      value: { purchasedAt: '2026-10-20T10:30:00.000Z' },
    })
  })

  it('summa 0 — xato', () => {
    expect(validateAddPurchase({ ...filled, total: '0' }, { nowIso: NOW, isAdmin: false })).toMatchObject({ errors: { total: 'invalid' } })
  })
})

describe('sotuvchilar qidiruvi', () => {
  const list = [
    { id: 's1', name: 'Chilonzor bozori', phone: '+998 90 111 22 33', tin: null },
    { id: 's2', name: 'Qurilish Mol', phone: null, tin: '123456789' },
  ] as Supplier[]

  it('nom (katta-kichik harf farqsiz), telefon yoki STIR raqamlari', () => {
    expect(filterSuppliers(list, '  CHILONZOR ').map((s) => s.id)).toEqual(['s1'])
    expect(filterSuppliers(list, '1112233').map((s) => s.id)).toEqual(['s1'])
    expect(filterSuppliers(list, '12345').map((s) => s.id)).toEqual(['s2'])
    expect(filterSuppliers(list, '')).toHaveLength(2)
  })

  it('tahrirlash qatori (supplierPatchToRow) — faqat berilgan maydonlar', () => {
    expect(supplierPatchToRow({ phone: '+998901112233' })).toEqual({ phone: '+998901112233' })
  })
})
