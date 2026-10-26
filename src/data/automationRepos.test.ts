// Batch 12 — repo qatlami: yangi ustunlar, RPC va Edge Function shartnomasi (supabase soxta).
import { getAlertById } from './alertsRepo'
import { emptyBalance, issueAdvance, listCashHistory } from './cashRepo'
import { DEFAULT_COMPANY_SETTINGS, getCompanySettings, normalizeSettings, updateCompanySettings } from './companiesRepo'
import { RepoError, SERVER_HINTS, toRepoError } from './errors'
import { getStockForecast } from './forecastRepo'
import * as functions from './functions'
import { cleanSha256, geoColumns } from './geo'
import { updateMaterial } from './materialsRepo'
import { createMovement } from './movementsRepo'
import { setObjectLocation, updateObject } from './objectsRepo'
import { createPurchase } from './purchasesRepo'
import { receiptLookup } from './receiptRepo'
import { listApprovedRequests } from './requestsRepo'
import { cleanTin, createSupplier, findByTin } from './suppliersRepo'
import type { Supplier } from './types'
import { t } from '@/i18n'

type Call = [string, ...unknown[]]

const fake = vi.hoisted(() => ({
  calls: [] as [string, ...unknown[]][],
  results: [] as unknown[],
  /** `profile_directory` qatorlari (ismlar ikkinchi so'rovda). */
  people: [] as { id: string; company_id?: string; full_name: string; role: string; is_active?: boolean }[],
}))

function fakeQuery(calls: Call[], result: () => unknown): unknown {
  const q: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve, reject)
        }
        return (...args: unknown[]) => {
          calls.push([prop, ...args])
          return q
        }
      },
    },
  )
  return q
}

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabase: () => ({
    from: (table: string) => {
      fake.calls.push(['from', table])
      if (table === 'profile_directory') return fakeQuery(fake.calls, () => ({ data: fake.people, error: null }))
      return fakeQuery(fake.calls, () => fake.results.shift())
    },
    rpc: (fn: string, args: unknown) => {
      fake.calls.push(['rpc', fn, args])
      return Promise.resolve(fake.results.shift())
    },
  }),
}))
vi.mock('./functions', () => ({ invokeFunction: vi.fn() }))

beforeEach(() => {
  fake.calls.length = 0
  fake.results.length = 0
  fake.people.length = 0
})

const arg = (method: string) => fake.calls.find((c) => c[0] === method)?.[1]
const SHA = 'a'.repeat(64)

describe('geo yordamchilari', () => {
  it('koordinata faqat `ok` da va juft; aniqlik 0..100000', () => {
    expect(geoColumns({ status: 'ok', lat: '41.311081', lng: '69.240562', accuracyM: 12.6 })).toEqual({
      geo_status: 'ok',
      geo_lat: '41.311081',
      geo_lng: '69.240562',
      geo_accuracy_m: 13,
    })
    expect(geoColumns({ status: 'ok', lat: '41.3' })).toEqual({ geo_status: 'unavailable', geo_lat: null, geo_lng: null, geo_accuracy_m: null })
    expect(geoColumns({ status: 'denied' })).toMatchObject({ geo_status: 'denied', geo_lat: null })
    expect(geoColumns({ status: 'ok', lat: '1', lng: '2', accuracyM: 1e9 }).geo_accuracy_m).toBe(100_000)
    expect(geoColumns(null)).toEqual({})
  })

  it('SHA-256: faqat 64 kichik hex', () => {
    expect(cleanSha256(SHA.toUpperCase())).toBe(SHA)
    expect(cleanSha256('abc')).toBeNull()
    expect(cleanSha256(null)).toBeNull()
  })
})

describe('movementsRepo / purchasesRepo — Batch 12 ustunlari', () => {
  it('createMovement: geo; rasm xeshi klientdan yuborilmaydi (server — photo-hash)', async () => {
    fake.results.push({ data: { id: 'm1', object: null, material: null, creator: null }, error: null })
    await createMovement({
      id: 'm1',
      companyId: 'c',
      type: 'kirim',
      objectId: 'o',
      materialId: 'mat',
      unitId: 'u',
      qtyInput: '1',
      photoPath: 'c/2026/10/a.jpg',
      geo: { status: 'denied' },
    })
    expect(arg('insert')).toMatchObject({ photo_path: 'c/2026/10/a.jpg', geo_status: 'denied', geo_lat: null, geo_lng: null })
    expect(arg('insert')).not.toHaveProperty('photo_sha256')
    expect(String(arg('select'))).toContain('geo_lat::text')
  })

  it('createMovement: rasmsiz — xesh yuborilmaydi; geo berilmasa (veb) — ustunlar yo‘q', async () => {
    fake.results.push({ data: { id: 'm1', object: null, material: null, creator: null }, error: null })
    await createMovement({ id: 'm1', companyId: 'c', type: 'chiqim', objectId: 'o', materialId: 'mat', unitId: 'u', qtyInput: '1' })
    const row = arg('insert') as Record<string, unknown>
    expect(row).not.toHaveProperty('photo_sha256')
    expect(row).not.toHaveProperty('geo_status')
  })

  it('createPurchase: chek QR, so‘rov, sana, STIR tozalanadi', async () => {
    fake.results.push({ data: { id: 'p1', object: null, material: null, buyer: null, supplier: null }, error: null })
    await createPurchase({
      id: 'p1',
      companyId: 'c',
      objectId: 'o',
      materialId: 'mat',
      unitId: 'u',
      qtyInput: '2',
      totalAmount: '100000',
      purchasedAt: '2026-10-25T14:30:00+05:00',
      requestId: 'rq',
      receipt: { fiscalSign: '248429044289', terminalId: 'UZ1', receiptNo: '643', verified: false, total: null, sellerTin: '12 345 678' },
      receiptPhotoPath: null,
      geo: { status: 'unavailable' },
    })
    expect(arg('insert')).toMatchObject({
      purchased_at: '2026-10-25T14:30:00+05:00',
      request_id: 'rq',
      receipt_fiscal_sign: '248429044289',
      receipt_terminal_id: 'UZ1',
      receipt_no: '643',
      receipt_verified: false,
      receipt_total: null,
      // 8 raqam — baza qabul qilmaydi (9–14) → null
      seller_tin: null,
      geo_status: 'unavailable',
    })
    expect(arg('insert')).not.toHaveProperty('receipt_photo_sha256')
    expect(String(arg('select'))).toContain('receipt_verified')
  })

  it('receipt_already_used — ism va vaqt parametr sifatida (server matni xom ko‘rsatilmaydi)', () => {
    const err = toRepoError({ code: '23505', hint: 'receipt_already_used', message: 'Bu chek allaqachon ishlatilgan: Ali, 24.10.2026 14:00' })
    expect(err.code).toBe('receipt_already_used')
    expect(err.params).toEqual(['Ali', '24.10.2026 14:00'])
  })

  it('yangi hint kalitlari — har biriga i18n matni', () => {
    for (const k of [
      'transfer_insufficient_stock',
      'photo_required',
      'photo_sha256_invalid',
      'receipt_already_used',
      'purchase_request_invalid',
      'supplier_tin_duplicate',
      'receipt_lookup_invalid',
      'alert_action_forbidden',
      'alert_not_found',
    ] as const) {
      expect(SERVER_HINTS).toHaveProperty(k)
      expect(t.errors[k]).toBeTruthy()
    }
    expect(SERVER_HINTS.transfer_insufficient_stock.showServerMessage).toBe(false)
  })
})

describe('objectsRepo / materialsRepo / suppliersRepo', () => {
  it('obyekt koordinatasi va radius', async () => {
    fake.results.push({ data: { id: 'o' }, error: null })
    await updateObject('o', { lat: '41.3', lng: '69.2', radiusM: 500 })
    expect(arg('update')).toEqual({ lat: '41.3', lng: '69.2', radius_m: 500 })
    fake.calls.length = 0
    fake.results.push({ data: { id: 'o' }, error: null })
    await setObjectLocation('o', '1.000000', '2.000000')
    expect(arg('update')).toEqual({ lat: '1.000000', lng: '2.000000' })
  })

  it('material "rasm majburiy"', async () => {
    fake.results.push({ data: { id: 'm' }, error: null })
    await updateMaterial('m', { photoRequired: true })
    expect(arg('update')).toEqual({ photo_required: true })
  })

  it('STIR: 9–14 raqam; topish', () => {
    expect(cleanTin('123 456 789')).toBe('123456789')
    expect(cleanTin('12345678')).toBeNull()
    expect(cleanTin('123456789012345')).toBeNull()
    const s = { id: 's1', tin: '123456789' } as Supplier
    expect(findByTin([s], '123-456-789')).toBe(s)
    expect(findByTin([s], null)).toBeNull()
  })

  it('createSupplier: STIR bilan; STIR dublikati — mavjud qator', async () => {
    fake.results.push({ data: null, error: { code: '23505', hint: 'supplier_tin_duplicate', message: 'x' } })
    fake.results.push({ data: [{ id: 's-old', name: 'Baza', tin: '123456789' }], error: null })
    const s = await createSupplier({ id: 's-new', companyId: 'c', name: 'Baza MChJ', tin: '123456789' })
    expect(arg('insert')).toMatchObject({ tin: '123456789' })
    expect(s.id).toBe('s-old')
  })
})

describe('companiesRepo — sozlamalar', () => {
  it('o‘qish: yangi ustunlar; yo‘q bo‘lsa — standart', async () => {
    fake.results.push({
      data: {
        receipt_mismatch_pct: '2.00',
        price_deviation_pct: '8.00',
        price_avg_window: 5,
        photo_required_amount: '1000000.00',
        cash_max_days: 10,
        duplicate_window_minutes: 0,
        request_overbuy_pct: '25.00',
        alert_remind_hours: 24,
        forecast_days_warn: 5,
      },
      error: null,
    })
    const s = await getCompanySettings('c')
    expect(s).toMatchObject({ photoRequiredAmount: '1000000.00', cashMaxDays: 10, duplicateWindowMinutes: 0, requestOverbuyPct: '25.00', forecastDaysWarn: 5 })
    expect(normalizeSettings({ receipt_mismatch_pct: '2', price_deviation_pct: '8', price_avg_window: 5 })).toEqual(DEFAULT_COMPANY_SETTINGS)
  })

  it('saqlash: faqat berilgan maydonlar, snake_case', async () => {
    fake.results.push({ data: { id: 'c' }, error: null })
    await updateCompanySettings('c', { photoRequiredAmount: null, cashMaxDays: 7 })
    expect(arg('update')).toEqual({ photo_required_amount: null, cash_max_days: 7 })
  })
})

describe('cashRepo — qaytarish', () => {
  it('issueAdvance kind=qaytarildi; berildi — ustun yuborilmaydi', async () => {
    fake.results.push({ data: { id: 'a1', kind: 'qaytarildi', recipient: null, creator: null }, error: null })
    await issueAdvance({ id: 'a1', companyId: 'c', recipientId: 'p', amount: '100', kind: 'qaytarildi' })
    expect(arg('insert')).toMatchObject({ kind: 'qaytarildi' })
    fake.calls.length = 0
    fake.results.push({ data: { id: 'a2', recipient: null, creator: null }, error: null })
    await issueAdvance({ id: 'a2', companyId: 'c', recipientId: 'p', amount: '100' })
    expect(arg('insert')).not.toHaveProperty('kind')
  })

  it('tarix: qaytarilgan yozuv `returned`', async () => {
    fake.results.push({
      data: [
        { id: 'a1', kind: 'qaytarildi', recipient_id: 'p', amount: '50', issued_at: '2026-10-02T00:00:00Z', recipient: null, creator: null },
        { id: 'a2', kind: 'berildi', recipient_id: 'p', amount: '100', issued_at: '2026-10-01T00:00:00Z', recipient: null, creator: null },
      ],
      error: null,
    })
    fake.results.push({ data: [], error: null })
    const h = await listCashHistory()
    expect(h.map((e) => e.kind)).toEqual(['returned', 'issued'])
    expect(emptyBalance('c', 'p').returned_total).toBe('0')
  })
})

describe('stock_forecast, so‘rovlar, alert', () => {
  it('getStockForecast: RPC ustunlari', async () => {
    fake.results.push({
      data: [
        {
          material_id: 'm',
          material_name: 'Sement',
          base_unit: 'kg',
          stock_qty_base: 20,
          avg_daily_qty_base: '10.000000',
          days_left: '2.0',
          other_objects_qty_base: 100,
          estimate_remaining_qty_base: null,
        },
      ],
      error: null,
    })
    expect(await getStockForecast('o')).toEqual([
      {
        objectId: 'o',
        materialId: 'm',
        stockQtyBase: '20',
        avgDailyOut: '10.000000',
        daysLeft: '2.0',
        otherStockQtyBase: '100',
        estimateRemainingQtyBase: null,
      },
    ])
    expect(fake.calls[0]).toEqual(['rpc', 'stock_forecast', { p_object_id: 'o' }])
  })

  it('listApprovedRequests: obyekt + tasdiqlandi', async () => {
    fake.results.push({ data: [], error: null })
    await listApprovedRequests('o')
    expect(fake.calls).toContainEqual(['eq', 'object_id', 'o'])
    expect(fake.calls).toContainEqual(['eq', 'status', 'tasdiqlandi'])
  })

  it('getAlertById: yo‘q — null', async () => {
    fake.results.push({ data: null, error: null })
    expect(await getAlertById('x')).toBeNull()
  })
})

describe('receiptLookup — Edge Function shartnomasi', () => {
  it('200 → { receipt, cached } ichidagi chek', async () => {
    vi.mocked(functions.invokeFunction).mockResolvedValue({
      ok: true,
      data: {
        cached: false,
        receipt: { sellerName: 'Baza', sellerTin: '123456789', datetime: null, total: 250000, items: [{ name: 'Sement', qty: 5, price: 50000, sum: 250000 }], fiscalSign: '1', terminalId: 'UZ1', receiptNo: '9' },
      },
    })
    const r = await receiptLookup('https://ofd.soliq.uz/check?t=UZ1&r=9&s=1')
    expect(functions.invokeFunction).toHaveBeenCalledWith('receipt-lookup', { url: 'https://ofd.soliq.uz/check?t=UZ1&r=9&s=1' })
    expect(r.total).toBe('250000')
    expect(r.items).toEqual([{ name: 'Sement', qty: '5', price: '50000', sum: '250000', unit: null }])
  })

  it.each([
    [400, 'receipt_url_invalid'],
    [401, 'session_expired'],
    [403, 'forbidden'],
    [422, 'receipt_unreadable'],
    [502, 'receipt_unreadable'],
    [500, 'receipt_unreadable'],
  ] as const)('%i → %s', async (status, code) => {
    vi.mocked(functions.invokeFunction).mockResolvedValue({ ok: false, status, body: { error: 'x' }, network: false })
    await expect(receiptLookup('u')).rejects.toMatchObject({ code })
  })

  it('tarmoq xatosi', async () => {
    vi.mocked(functions.invokeFunction).mockResolvedValue({ ok: false, status: 0, body: null, network: true })
    await expect(receiptLookup('u')).rejects.toBeInstanceOf(RepoError)
  })
})
