// Audit 2 (UI/UX) — sof funksiyalar va manba kodidagi qoidalar: holat ranglari, ixtiyoriy o'lchamlar,
// tirnoqlar, menyu va sarlavha nomlari, havolalar, "Yozuvlar" filtrlari, qoldiq ro'yxati, smeta diagrammasi.
import { INVENTORY_TONE, REQUEST_TONE, TRANSFER_TONE } from '@/components/statusTones'
import type { StockForecastRow } from '@/data/forecastRepo'
import { normalizeReceipt } from '@/data/receiptRepo'
import type { Movement, StockBalance } from '@/data/types'
import { tgBottomNavFor, tgNavFor, ROLES } from '@/domain/roles'
import { t } from '@/i18n'
import { makeMaterial, makeUnit } from '@/test/fixtures'
import { deepLinkTarget, readUuidParam } from '@/tg/deepLinks'
import { categoryOf, filterEntries, mergeEntries, presentCategories, type Entry } from '@/tg/mine/mineEntries'
import { makeMovementPrefillState, readMovementPrefill } from '@/tg/movement/prefill'
import { tgNavItems } from '@/tg/nav'
import { buildStockList } from '@/tg/stock/stockList'
import { estimateSpendRows } from '@/web/dashboard/chartData'
import { alertDetailText } from '@/web/alerts/alertDetails'

// Manba fayllar (testlar, preview va fixture'larsiz) — xom matn (Vite ?raw)
const SOURCES = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}', '!/src/preview/**', '!/src/**/__fixtures__/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function sourceFiles(): string[] {
  return Object.keys(SOURCES)
}

function readFileSync(path: string): string {
  return SOURCES[path] ?? ''
}

describe('15: reja holatlari — warn/danger faqat ogohlantirishlar uchun', () => {
  it('so‘rov, o‘tkazma, sanash — warn/danger ishlatilmaydi', () => {
    for (const tone of [...Object.values(REQUEST_TONE), ...Object.values(TRANSFER_TONE), ...Object.values(INVENTORY_TONE)]) {
      expect(['warn', 'danger']).not.toContain(tone)
    }
    expect(REQUEST_TONE.kutilmoqda).toBe('info')
    expect(REQUEST_TONE.rad).toBe('neutral')
  })
})

describe('20: ixtiyoriy o‘lchamlar o‘rniga tokenlar; round-1: text-ink/80, text-white/NN', () => {
  const files = sourceFiles()
  it('size-[18px], w-[76px], rounded-[10px], max-w-[400px] yo‘q', () => {
    const bad = files.filter((f) => /size-\[18px\]|w-\[76px\]|rounded-\[10px\]|max-w-\[400px\]/.test(readFileSync(f)))
    expect(bad).toEqual([])
  })
  it('matn rangida shaffoflik yo‘q (text-ink/80, text-white/60–75)', () => {
    const bad = files.filter((f) => /text-ink\/\d|text-white\/(60|70|75)/.test(readFileSync(f)))
    expect(bad).toEqual([])
  })
  it('native checkbox faqat Checkbox komponentida (yoki sr-only chip ichida)', () => {
    const bad = files.filter((f) => {
      const s = readFileSync(f)
      return /type="checkbox"/.test(s) && !f.endsWith('ui/Checkbox.tsx') && !f.endsWith('ui/FilterBar.tsx')
    })
    expect(bad).toEqual([])
  })
})

describe('27: tirnoqlar — faqat “…”', () => {
  it('uz.ts va komponentlarda « » yo‘q', () => {
    const bad = sourceFiles().filter((f) => /[«»]/.test(readFileSync(f)))
    expect(bad).toEqual([])
  })
  it('sotuvchi matnlari: qo‘shimcha tirnoqqa bo‘shliqsiz qo‘shiladi', () => {
    expect(t.suppliers.merged('A', 'B', 2)).toBe('“A” “B”ga birlashtirildi (2 ta xarid ko‘chirildi)')
    expect(t.suppliers.mergeIntro('A')).toMatch(/^“A”ning /)
    expect(t.suppliers.mergeWarning('A', 'B', 3)).toContain('“B”dagi')
    expect(t.suppliers.mergeConfirm(3)).toContain('3 ta xarid ko‘chiriladi')
  })
})

describe('29 / 3: Telegram ilovasi menyusi va sarlavhalar bir xil', () => {
  it('Ombor / So‘rov / Sanash / Yozuvlar — menyu yorlig‘i = ekran sarlavhasi', () => {
    expect(tgNavItems.movement.shortLabel).toBe('Ombor')
    expect(t.tg.movement.title).toBe(tgNavItems.movement.label)
    expect(t.tg.request.title).toBe(tgNavItems.request.label)
    expect(t.tg.inventory.title).toBe(tgNavItems.inventory.label)
    expect(t.tg.mine.title).toBe(tgNavItems.mine.label)
    expect(tgNavItems.mine.shortLabel).toBe('Yozuvlar')
  })
  it('bitta bandli rol (buxgalter) — pastki menyu ko‘rsatilmaydigan holat', () => {
    expect(tgBottomNavFor('buxgalter')).toHaveLength(1)
    expect(ROLES.filter((r) => tgNavFor(r).length > 1)).toContain('prorab')
  })
})

describe('24: chek qatori — birlik taxmin qilinmaydi', () => {
  it('birlik bor — "5 kg — …", yo‘q — "5 × — …" ("ta" emas)', () => {
    expect(t.tg.auto.receiptLine('5', 'kg', '60 000 so‘m')).toBe('5 kg — 60 000 so‘m')
    expect(t.tg.auto.receiptLine('5', null, '60 000 so‘m')).toBe('5 × — 60 000 so‘m')
    expect(t.tg.auto.receiptLine('5', null, 'x')).not.toContain(' ta ')
  })
  it('normalizeReceipt — chekdagi birlik (unit yoki unitName) olinadi', () => {
    const r = normalizeReceipt({ items: [{ name: 'Sement', qty: 5, price: 1, sum: 5, unit: 'kg' }, { name: 'Qum', qty: 1, price: 1, sum: 1 }] })
    expect(r.items.map((i) => i.unit)).toEqual(['kg', null])
  })
})

describe('round-1: alertDetails qty() — formatQtyUnit (bo‘linmas bo‘shliq)', () => {
  it('normadan oshish matnida miqdor va birlik U+00A0 bilan', () => {
    const s = alertDetailText({
      type: 'normadan_oshish',
      base_unit: 'kg',
      details: { allowed_qty_base: '100', consumed_qty_base: '120', over_pct: '20' },
    } as Parameters<typeof alertDetailText>[0])
    expect(s).toContain('120 kg')
  })
})

describe('25 / 28: tuzatish va podotchet matnlari', () => {
  it('entryCorrected — "Ali o‘z kirimini tuzatdi: …", qavslar yo‘q', () => {
    const s = t.alertsPage.details.entryCorrected('Kirim', 'Sement', 'Miqdor: 3 → 5', 'Ali')
    expect(s).toBe('Ali o‘z kirimini tuzatdi: Sement — Miqdor: 3 → 5')
    expect(s).not.toContain('(')
  })
  it('podotchet belgisi — "sana 3 kundan oldingi"', () => {
    expect(t.alertsPage.details.cashFlagReasons.issued_at_outside_window).toBe('sana 3 kundan oldingi')
  })
  it('7: qolgan vaqt — butun daqiqalar, oxirgi daqiqada "1 daqiqadan kam"', () => {
    expect(t.correction.remainingShort(12)).toBe('12 daq qoldi')
    expect(t.correction.remainingShort(0)).toBe('1 daqiqadan kam qoldi')
  })
})

describe('K: Telegram havolalari (?request= / ?transfer=)', () => {
  const ID = '3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e'
  const q = (s: string) => new URLSearchParams(s)
  it('so‘rov: admin — tasdiqlash, ta’minotchi — xarid, prorab — Yozuvlar; haydovchi — yo‘q', () => {
    expect(deepLinkTarget('admin', q(`request=${ID}`))).toBe(`/tg/approvals?request=${ID}`)
    expect(deepLinkTarget('taminotchi', q(`request=${ID}`))).toBe(`/tg/purchase?request=${ID}`)
    expect(deepLinkTarget('prorab', q(`request=${ID}`))).toBe(`/tg/mine?request=${ID}`)
    expect(deepLinkTarget('haydovchi', q(`request=${ID}`))).toBeNull()
  })
  it('o‘tkazma — kirim/chiqim ekrani; noto‘g‘ri UUID — jim (null)', () => {
    expect(deepLinkTarget('omborchi', q(`transfer=${ID}`))).toBe(`/tg/movement?transfer=${ID}`)
    // Xarid: o'z xaridi Yozuvlar'da; xarid kiritmaydiganlar — bosh ekran (null)
    expect(deepLinkTarget('haydovchi', q(`purchase=${ID}`))).toBe(`/tg/mine?purchase=${ID}`)
    expect(deepLinkTarget('direktor', q(`purchase=${ID}`))).toBeNull()
    expect(deepLinkTarget('direktor', q(`transfer=${ID}`))).toBeNull()
    expect(deepLinkTarget('admin', q('request=1;drop'))).toBeNull()
    expect(readUuidParam(q('request=abc'), 'request')).toBeNull()
  })
})

describe('5: "Qoldiq" → chiqim (router state)', () => {
  it('prefill o‘qiladi, noma’lum shakl — null', () => {
    expect(readMovementPrefill(makeMovementPrefillState({ type: 'chiqim', objectId: 'o', materialId: 'm' }))).toEqual({
      type: 'chiqim',
      objectId: 'o',
      materialId: 'm',
    })
    expect(readMovementPrefill({ movementPrefill: { objectId: 1 } })).toBeNull()
    expect(readMovementPrefill(null)).toBeNull()
  })
})

describe('5 / E: qoldiq ro‘yxati', () => {
  const stock = (materialId: string, qty: string): StockBalance => ({ company_id: 'c', object_id: 'o', material_id: materialId, qty_base: qty, last_movement_at: null })
  const fc = (materialId: string, stockQty: string, avg: string, daysLeft: string | null): StockForecastRow => ({
    objectId: 'o',
    materialId,
    stockQtyBase: stockQty,
    avgDailyOut: avg,
    daysLeft,
    otherStockQtyBase: '0',
    estimateRemainingQtyBase: null,
  })
  const sement = makeMaterial('m-s', 'Sement', 'kg', { units: [makeUnit('u-qop', 'm-s', 'qop', '50')] })
  const qum = makeMaterial('m-q', 'Qum', 'm3')

  it('0 qoldiq, lekin sarf/prognoz bor — "Tugagan" (empty), tugayotganlardan oldin', () => {
    const list = buildStockList([stock('m-s', '600')], [fc('m-q', '0', '2', '0'), fc('m-s', '600', '10', '60')], [sement, qum], '', 3)
    expect(list.map((i) => i.name)).toEqual(['Qum', 'Sement'])
    expect(list[0]).toMatchObject({ empty: true, low: true, qtyBase: '0' })
  })

  it('E: oxirgi birlik koeffitsienti > 1 — "12 qop (600 kg)", aks holda asosiy birlik', () => {
    const [withQop] = buildStockList([stock('m-s', '600')], [], [sement], '', 3, () => 'u-qop')
    expect(withQop?.inputView).toEqual({ qty: '12', unit: 'qop' })
    const [plain] = buildStockList([stock('m-s', '600')], [], [sement], '', 3, () => 'm-s-base')
    expect(plain?.inputView).toBeNull()
  })
})

describe('12 / F: "Yozuvlar" filtrlari', () => {
  const mv = (id: string, at: string): Movement =>
    ({ id, type: 'kirim', created_at: at, deleted_at: null, material_name: 'Sement' }) as Movement
  const list: Entry[] = mergeEntries([mv('a', '2026-10-26T05:00:00Z'), mv('b', '2026-10-20T05:00:00Z')], [], [], [], {
    cash: [{ id: 'c1', kind: 'berildi', created_at: '2026-10-25T05:00:00Z' } as never],
  })

  it('toifa: kirim-chiqim, pul; mavjud toifalar chipi', () => {
    expect(filterEntries(list, 'movement').map((e) => e.key)).toEqual(['m:a', 'm:b'])
    expect(filterEntries(list, 'cash').map((e) => categoryOf(e))).toEqual(['cash'])
    expect(presentCategories(list)).toEqual(['all', 'movement', 'cash'])
  })

  it('sana oralig‘i — Toshkent kuni, ikkala chegara kiradi', () => {
    expect(filterEntries(list, 'all', '2026-10-25', '2026-10-26').map((e) => e.key)).toEqual(['m:a', 'a:c1'])
    expect(filterEntries(list, 'all', '', '2026-10-20').map((e) => e.key)).toEqual(['m:b'])
  })

  it('"Ko‘proq yuklash" — mergeEntries chegarasi sozlanadi', () => {
    const many = Array.from({ length: 60 }, (_, i) => mv(`x${i}`, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString()))
    expect(mergeEntries(many, [])).toHaveLength(50)
    expect(mergeEntries(many, [], [], null, {}, 100)).toHaveLength(60)
  })
})

describe('H: "Smeta va haqiqiy" — obyekt bo‘yicha pul', () => {
  it('smeta jami bo‘yicha tartib; xarid smetadan oshsa — over; smetasiz — 0 ustun', () => {
    const rows = estimateSpendRows([
      { object_id: 'a', object_name: 'A', estimate_sum: '1000', spent_sum: '1200' },
      { object_id: 'b', object_name: 'B', estimate_sum: '5000', spent_sum: '100' },
      { object_id: 'c', object_name: 'C', estimate_sum: null, spent_sum: '50' },
    ])
    expect(rows.map((r) => r.name)).toEqual(['B', 'A', 'C'])
    expect(rows[1]).toMatchObject({ over: true, estimate: 1000, spent: 1200 })
    expect(rows[2]).toMatchObject({ estimate: 0, estimateText: null, over: false })
  })
})
