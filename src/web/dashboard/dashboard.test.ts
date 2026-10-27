import { normalizeSummary, type NormOverviewRow } from '@/data/reportsRepo'
import { t } from '@/i18n'
import { makeProfile } from '@/test/fixtures'
import { plain } from '@/test/text'
import { buildCards, dashboardSections, summaryExportRows } from './cards'
import { axisNumber, cashChartRows, dailyChartRows, normChartRows, spendChartRows } from './chartData'
import { dashboardSearch, isoToUz, parseUzDate, presetOf, readDashboardQuery } from './query'

const TODAY = '2026-10-25'

describe('dashboard query (URL ↔ davr)', () => {
  it('parametrsiz — 7 kun', () => {
    const q = readDashboardQuery(new URLSearchParams(), TODAY)
    expect(q).toMatchObject({ from: '2026-10-19', to: TODAY, objectId: '', preset: 'last7', invalid: null })
  })

  it('from/to va obyekt URL dan; tayyor davrga mos kelsa — preset', () => {
    const q = readDashboardQuery(new URLSearchParams('from=2026-10-01&to=2026-10-25&object=3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e'), TODAY)
    expect(q).toMatchObject({ from: '2026-10-01', to: TODAY, objectId: '3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e', preset: 'thisMonth' })
    const custom = readDashboardQuery(new URLSearchParams('from=2026-09-03&to=2026-09-10'), TODAY)
    expect(custom.preset).toBeNull()
  })

  it('noto‘g‘ri / teskari / juda uzun davr — standart davr va belgi', () => {
    expect(readDashboardQuery(new URLSearchParams('from=2026-13-01&to=2026-10-01'), TODAY).invalid).toBe('invalid')
    expect(readDashboardQuery(new URLSearchParams('from=2026-10-10&to=2026-10-01'), TODAY)).toMatchObject({
      invalid: 'reversed',
      preset: 'last7',
    })
    expect(readDashboardQuery(new URLSearchParams('from=2024-01-01&to=2026-10-01'), TODAY).invalid).toBe('too_long')
  })

  it('dashboardSearch — bo‘sh obyekt yozilmaydi', () => {
    expect(dashboardSearch({ from: '2026-10-01', to: '2026-10-02', objectId: '' }).toString()).toBe('from=2026-10-01&to=2026-10-02')
    expect(dashboardSearch({ from: 'a', to: 'b', objectId: 'x' }).get('object')).toBe('x')
  })

  it('dd.mm.yyyy ↔ ISO', () => {
    expect(parseUzDate('01.10.2026')).toBe('2026-10-01')
    expect(parseUzDate(' 1.2.2026 ')).toBe('2026-02-01')
    expect(parseUzDate('30.02.2026')).toBeNull()
    expect(parseUzDate('2026-10-01')).toBeNull()
    expect(isoToUz('2026-10-01')).toBe('01.10.2026')
    expect(presetOf(TODAY, TODAY, TODAY)).toBe('today')
  })
})

const summary = normalizeSummary({
  kirim_count: 12,
  chiqim_count: 3,
  purchases_count: 4,
  purchases_sum: '1250000.50',
  cash_issued_sum: '500000',
  cash_returned_sum: '0',
  cash_on_hand_total: '-1000',
  alerts_open: 5,
  alerts_serious_open: 2,
  alerts_new_in_period: 1,
  unreceived_purchases_count: 0,
  pending_transfers_count: 1,
  pending_requests_count: 2,
  objects_over_norm_count: 1,
})

describe('kartochkalar', () => {
  const range = { from: '2026-10-01', to: '2026-10-07', objectId: '3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e' }

  it('normalizeSummary — yo‘q kalitlar 0, pul satr', () => {
    const s = normalizeSummary({ kirim_count: '7' })
    expect(s.kirim_count).toBe(7)
    expect(s.purchases_sum).toBe('0')
    expect(s.alerts_open).toBe(0)
  })

  it('direktor — hamma kartochkalar, havolalar filtr bilan; ruxsatsiz sahifa — havolasiz', () => {
    const cards = buildCards(summary, 'direktor', range)
    expect(cards.map((c) => c.key)).toEqual([
      'kirim',
      'chiqim',
      'purchases',
      'expenses',
      'spendTotal',
      'cashIssued',
      'cashOnHand',
      'alertsOpen',
      'unreceived',
      'pendingTransfers',
      'pendingRequests',
      'overNorm',
    ])
    const by = Object.fromEntries(cards.map((c) => [c.key, c]))
    expect(by.kirim?.to).toBe('/movements?type=kirim&from=2026-10-01&to=2026-10-07&object=3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e')
    expect(by.purchases?.to).toBe('/purchases?from=2026-10-01&to=2026-10-07&object=3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e')
    expect(plain(String(by.purchases?.value))).toBe('1 250 000,5 so‘m')
    expect(by.alertsOpen?.to).toBe('/alerts?status=open&object=3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e')
    expect(by.alertsOpen?.tone).toBe('danger')
    expect(by.cashOnHand?.tone).toBe('danger')
    expect(by.pendingRequests?.to).toBe('/requests?status=kutilmoqda&object=3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e')
    expect(by.pendingTransfers?.to).toBe('/movements?tab=transfers')
    // direktor menyusida Smeta bor, Obyektlar yo'q
    expect(by.overNorm?.to).toBe('/estimates?object=3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e')
    expect(by.kirim?.current).toBe(false)
    expect(by.alertsOpen?.current).toBe(true)
    expect(by.cashIssued?.companyWide).toBe(true)
  })

  it('buxgalter — so‘rovlar sahifasi yo‘q: kartochka bor, havola yo‘q', () => {
    const card = buildCards(summary, 'buxgalter', range).find((c) => c.key === 'pendingRequests')
    expect(card?.to).toBeNull()
  })

  it('omborchi — faqat kirim/chiqim va o‘tkazmalar; taminotchi — xaridlar va so‘rovlar; tekshiruvchi — hech narsa', () => {
    expect(buildCards(summary, 'omborchi', range).map((c) => c.key)).toEqual(['kirim', 'chiqim', 'pendingTransfers'])
    expect(buildCards(summary, 'taminotchi', range).map((c) => c.key)).toEqual(['purchases', 'expenses', 'spendTotal', 'unreceived', 'pendingRequests'])
    expect(buildCards(summary, 'tekshiruvchi', range)).toEqual([])
    expect(dashboardSections('tekshiruvchi').size).toBe(0)
    expect(makeProfile('prorab').role).toBe('prorab')
    expect(dashboardSections('prorab').has('cash')).toBe(false)
  })

  it('eksport xulosasi — aniq qiymatlar (pul satr)', () => {
    const rows = summaryExportRows(summary, 'admin')
    expect(rows).toContainEqual({ indicator: t.reports.exportRows.purchasesSum, value: '1250000.50' })
    expect(rows).toContainEqual({ indicator: t.reports.cards.kirim, value: '12' })
  })
})

describe('diagramma qatorlari', () => {
  it('kunlik — bo‘sh kunlar nol bilan, tooltip uchun aniq summa', () => {
    const data = dailyChartRows(
      [{ day: '2026-10-02', kirim_count: 2, chiqim_count: 1, purchases_sum: '1500000.25', alerts_count: 0 }],
      '2026-10-01',
      '2026-10-03',
    )
    expect(data.map((d) => d.day)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(data[1]).toMatchObject({ label: '02.10', date: '02.10.2026', kirim: 2, sum: 1500000.25, sumText: '1500000.25' })
    expect(data[0]?.kirim).toBe(0)
  })

  it('norma — obyektlar yig‘iladi, sarf bo‘yicha top 10, oshganlar belgilanadi', () => {
    const row = (o: string, m: string, allowed: string, consumed: string): NormOverviewRow => ({
      object_id: o,
      object_name: o,
      material_id: m,
      material_name: `Mat ${m}`,
      base_unit: 'kg',
      norm_qty_base: allowed,
      allowed_qty_base: allowed,
      consumed_qty_base: consumed,
      usage_pct: null,
    })
    const rows = [row('A', 'm1', '100', '60'), row('B', 'm1', '50', '50'), row('A', 'm2', '10', '30')]
    for (let i = 3; i < 15; i++) rows.push(row('A', `m${i}`, '1000', String(i)))
    const data = normChartRows(rows)
    expect(data).toHaveLength(10)
    expect(data[0]).toMatchObject({ materialId: 'm1', allowedText: '150', consumedText: '110', over: false })
    expect(data[1]).toMatchObject({ materialId: 'm2', over: true })
  })

  it('xarajat — top 8 + "Boshqa", sotuvchisiz va noma’lum nomlar', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      key: `k${i}`,
      label: `L${i}`,
      purchases_sum: String((10 - i) * 1000),
      purchases_count: 1,
      expenses_sum: '0',
      expenses_count: 0,
      total_sum: String((10 - i) * 1000),
    }))
    const data = spendChartRows(rows)
    expect(data).toHaveLength(9)
    expect(data[8]).toMatchObject({ label: t.reports.charts.other, valueText: '3000', count: 2, other: true })
    const named = spendChartRows(
      [
        { key: null, label: null, purchases_sum: '5', purchases_count: 1, expenses_sum: '0', expenses_count: 0, total_sum: '5' },
        { key: 'x', label: null, purchases_sum: '3', purchases_count: 1, expenses_sum: '0', expenses_count: 0, total_sum: '3' },
      ],
      8,
      'supplier',
    )
    expect(named.map((d) => d.label)).toEqual([t.reports.charts.noSupplier, t.reports.charts.unknown])
  })

  it('podotchet — nollar tashlanadi, kattasi birinchi, manfiy belgilanadi', () => {
    const b = (id: string, balance: string) => ({
      company_id: 'c',
      profile_id: id,
      issued_total: '0',
      spent_total: '0',
      balance,
      last_issued_at: null,
      last_spent_at: null,
    })
    const data = cashChartRows([b('p1', '-500'), b('p2', '0'), b('p3', '1000')], [
      { id: 'p1', full_name: 'Ali' },
      { id: 'p3', full_name: 'Vali' },
    ])
    expect(data.map((d) => [d.name, d.negative])).toEqual([
      ['Vali', false],
      ['Ali', true],
    ])
  })

  it('o‘q yozuvlari — o‘zbekcha qisqa', () => {
    expect(axisNumber(12_500_000)).toBe(`12,5 ${t.reports.units.mln}`)
    expect(axisNumber(2_000_000_000)).toBe(`2 ${t.reports.units.bln}`)
    expect(axisNumber(950)).toBe('950')
  })
})

describe('Batch 9 review tuzatishlari', () => {
  it('URL obyekt — faqat UUID', () => {
    expect(readDashboardQuery(new URLSearchParams('object=o1'), TODAY).objectId).toBe('')
    expect(readDashboardQuery(new URLSearchParams("object=x'),or(id.eq.1"), TODAY).objectId).toBe('')
    const id = '3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e'
    expect(readDashboardQuery(new URLSearchParams(`object=${id}`), TODAY).objectId).toBe(id)
  })

  it('urlFilters.paramId — UUID bo‘lmasa bo‘sh', async () => {
    const { paramId } = await import('../urlFilters')
    expect(paramId(new URLSearchParams('object=abc'), 'object')).toBe('')
    expect(paramId(new URLSearchParams('object=3F2B8C1E-1D2A-4B5C-9D8E-0F1A2B3C4D5E'), 'object')).not.toBe('')
  })

  it('norma: bir obyektda oshgan material yig‘indida yashirinmaydi', () => {
    const row = (o: string, allowed: string, consumed: string): NormOverviewRow => ({
      object_id: o,
      object_name: o,
      material_id: 'm1',
      material_name: 'Sement',
      base_unit: 'kg',
      norm_qty_base: allowed,
      allowed_qty_base: allowed,
      consumed_qty_base: consumed,
      usage_pct: null,
    })
    // A: 120 / 100 (oshgan), B: 10 / 1000 — yig'indi 130 / 1100, lekin qizil
    const [p] = normChartRows([row('A', '100', '120'), row('B', '1000', '10')])
    expect(p).toMatchObject({ allowedText: '1100', consumedText: '130', over: true })
  })
})
