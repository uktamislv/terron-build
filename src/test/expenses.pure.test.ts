// Xarajatlar UI'ining sof qismlari: ogohlantirish matni va havolasi, deep link, diagramma qatorlari,
// kartochkalar, "Yozuvlar" birlashmasi, tarix maydonlari.
import type { Alert, Expense } from '@/data/types'
import { tgNavFor } from '@/domain/roles'
import { t } from '@/i18n'
import { deepLinkTarget } from '@/tg/deepLinks'
import { categoryOf, mergeEntries, mineSources, presentCategories } from '@/tg/mine/mineEntries'
import { alertDetailText, expenseAlertHref } from '@/web/alerts/alertDetails'
import { buildCards, summaryExportRows } from '@/web/dashboard/cards'
import { estimateSpendRows, normChartRows, spendChartRows } from '@/web/dashboard/chartData'
import { normalizeSummary } from '@/data/reportsRepo'
import { enumLabel, formatValue, isRestorable, tableLabel } from '@/web/history/historyFormat'
import { emptyRefNames } from '@/data/historyRepo'
import { fieldKind } from '@/domain/history'

const plain = (s: string) => s.replace(/[\u202F\u00A0]/g, ' ')
const ID = '3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e'

function alert(type: Alert['type'], details: Record<string, unknown>, object_name: string | null = null): Alert {
  return {
    id: 'a',
    company_id: 'c',
    type,
    status: 'yangi',
    severity: 'ogohlantirish',
    object_id: null,
    material_id: null,
    purchase_id: null,
    movement_id: null,
    details,
    closed_by: null,
    closed_at: null,
    close_note: null,
    created_at: '2026-11-02T05:00:00Z',
    deleted_at: null,
    object_name,
    material_name: null,
    base_unit: null,
  }
}

describe('ogohlantirishlar — xarajat', () => {
  const base = { table: 'expenses', record_id: ID, expense_id: ID, category_name: 'Oziq-ovqat', amount: 41000 }

  it('details.table = expenses: "Xarajat: tur · summa · obyekt|Umumiy" + tur izohi', () => {
    expect(plain(alertDetailText(alert('takroriy_yozuv', { ...base, window_minutes: 10 })))).toBe(
      'Xarajat: Oziq-ovqat · 41 000 so‘m · Umumiy. Xarajat: 10 daqiqa ichida xuddi shunday yozuv kiritilgan',
    )
    expect(plain(alertDetailText(alert('chek_farqi', { ...base, receipt_total: '40000', total_amount: '41000' }, 'Obyekt A')))).toBe(
      'Xarajat: Oziq-ovqat · 41 000 so‘m · Obyekt A. Chekda 40 000 so‘m, xaridda 41 000 so‘m',
    )
    expect(alertDetailText(alert('xarid_boshqa_nomidan', { ...base, actor_name: 'Admin', payer_name: 'Ali' }))).toContain('Admin Ali nomidan kiritdi')
    expect(alertDetailText(alert('yozuv_ochirildi', { ...base, actor_name: 'Admin' }))).toContain('Xarajat o‘chirildi (Admin)')
    expect(alertDetailText(alert('sotuvchi_stir_farqi', { ...base, seller_tin: '123456789' }))).toContain('123456789')
    for (const type of ['yozuv_tuzatildi', 'yozuv_ozgartirildi', 'yozuv_tiklandi'] as const) {
      expect(alertDetailText(alert(type, base)).startsWith('Xarajat: Oziq-ovqat')).toBe(true)
    }
  })

  it('xarajat_limiti: tur, oy, sarf va limit', () => {
    const a = alert('xarajat_limiti', { category_id: ID, category_name: 'Yoqilg‘i', month: '2026-11', limit: 5000000, spent: 5200000, over: 200000 })
    expect(plain(alertDetailText(a))).toBe('Yoqilg‘i: 11.2026 oyida 5 200 000 so‘m sarflandi, limit 5 000 000 so‘m — 200 000 so‘m oshgan')
    expect(t.alertTexts.types.xarajat_limiti).toBeTruthy()
  })

  it('havola: yozuv — tafsilot, limit — shu tur va oy; boshqalar — null', () => {
    expect(expenseAlertHref(alert('takroriy_yozuv', base))).toBe(`/purchases?tab=expenses&expense=${ID}`)
    expect(expenseAlertHref(alert('xarajat_limiti', { category_id: ID, month: '2026-02' }))).toBe(
      `/purchases?tab=expenses&category=${ID}&from=2026-02-01&to=2026-02-28`,
    )
    expect(expenseAlertHref(alert('takroriy_yozuv', { table: 'purchases', record_id: ID }))).toBeNull()
    expect(expenseAlertHref(alert('takroriy_yozuv', { table: 'expenses', record_id: 'x' }))).toBeNull()
  })
})

describe('deep link ?expense=<id>', () => {
  it('xarajat kiritadiganlar — "Yozuvlar" tafsiloti; boshqalar — oddiy ekran', () => {
    const p = new URLSearchParams(`expense=${ID}`)
    for (const role of ['haydovchi', 'taminotchi', 'prorab', 'buxgalter', 'admin'] as const) {
      expect(deepLinkTarget(role, p)).toBe(`/tg/mine?expense=${ID}`)
      expect(tgNavFor(role)).toContain('mine')
    }
    expect(deepLinkTarget('omborchi', p)).toBeNull()
    expect(deepLinkTarget('direktor', p)).toBeNull()
    expect(deepLinkTarget('haydovchi', new URLSearchParams('expense=bad'))).toBeNull()
  })
})

describe('bosh sahifa', () => {
  const s = normalizeSummary({ purchases_sum: '1000', expense_sum: '250', expense_count: 3, spend_total_sum: '1250' })

  it('Xarajatlar va Umumiy xarajat kartochkalari; havola — Xarajatlar tabi', () => {
    const cards = buildCards(s, 'direktor', { from: '2026-11-01', to: '2026-11-30', objectId: '' })
    const by = Object.fromEntries(cards.map((c) => [c.key, c]))
    expect(plain(by.expenses?.value ?? '')).toBe('250 so‘m')
    expect(by.expenses?.sub).toBe('3 ta')
    expect(by.expenses?.to).toBe('/purchases?tab=expenses&from=2026-11-01&to=2026-11-30')
    expect(plain(by.spendTotal?.value ?? '')).toBe('1 250 so‘m')
    expect(buildCards(s, 'omborchi', { from: '', to: '', objectId: '' }).some((c) => c.key === 'expenses')).toBe(false)
    expect(summaryExportRows(s, 'direktor').map((r) => r.indicator)).toContain(t.expenses.exportExpensesSum)
  })

  it('taqsimot: jami bo‘yicha top N + "Boshqa", material va boshqa xarajat bo‘laklari', () => {
    const row = (key: string | null, p: string, e: string) => ({
      key,
      label: key,
      purchases_sum: p,
      purchases_count: 1,
      expenses_sum: e,
      expenses_count: e === '0' ? 0 : 1,
      total_sum: String(Number(p) + Number(e)),
    })
    const data = spendChartRows([row('a', '10', '0'), row('b', '0', '50'), row('c', '5', '5'), row(null, '0', '1')], 2, 'object')
    expect(data.map((p) => p.key)).toEqual(['b', 'a', '__other__'])
    expect(data[0]).toMatchObject({ materialText: '0', expenseText: '50', valueText: '50' })
    expect(data[2]).toMatchObject({ other: true, materialText: '5', expenseText: '6', valueText: '11', count: 4 })
    // obyektsiz xarajat — "Umumiy"
    expect(spendChartRows([row(null, '0', '1')], 8, 'object')[0]?.label).toBe(t.expenses.general)
  })

  it('smeta va haqiqiy: material va boshqa xarajat segmentlari; oshish — jami bo‘yicha', () => {
    const [p] = estimateSpendRows([{ object_id: 'o', object_name: 'A', estimate_sum: '100', spent_sum: '120', material_sum: '90', expense_sum: '30' }])
    expect(p).toMatchObject({ material: 90, expense: 30, spent: 120, over: true })
  })

  it('norma: "smetaga kirmaydi" — oshgan deb belgilanmaydi', () => {
    const rows = normChartRows([
      {
        object_id: 'o',
        object_name: 'A',
        material_id: 'm',
        material_name: 'Mix',
        base_unit: 'kg',
        norm_qty_base: '0',
        allowed_qty_base: '0',
        consumed_qty_base: '10',
        usage_pct: null,
        outside_estimate: true,
      },
    ])
    expect(rows[0]).toMatchObject({ over: false, outside: true, pct: null })
  })
})

describe('"Yozuvlar" — xarajatlar', () => {
  const e = { id: 'e1', created_at: '2026-11-02T05:00:00Z' } as Expense
  it('manba, birlashma va "Xarajat" filtri', () => {
    expect(mineSources('haydovchi').expenses).toBe(true)
    expect(mineSources('tekshiruvchi').expenses).toBe(false)
    const list = mergeEntries([], [], [], null, { expenses: [e] })
    expect(list[0]).toMatchObject({ kind: 'expense', key: 'e:e1' })
    expect(categoryOf(list[0]!)).toBe('expense')
    expect(presentCategories(list)).toEqual(['all', 'expense'])
    expect(t.tg.mine.filters.expense).toBeTruthy()
  })
})

describe('tarix — yangi jadvallar', () => {
  it('nomlar, tiklash, maydon turlari va yorliqlari', () => {
    expect(isRestorable('expenses')).toBe(true)
    expect(isRestorable('expense_categories')).toBe(true)
    expect(tableLabel('expenses')).toBe('Xarajatlar')
    expect(tableLabel('expense_categories')).toBe('Xarajat turlari')
    expect(fieldKind('expenses', 'category_id')).toBe('ref_category')
    expect(fieldKind('materials', 'outside_estimate')).toBe('bool')
    expect(enumLabel('expenses', 'payment_source', 'firma')).toBe(t.purchases.paymentSources.firma)
    const names = { ...emptyRefNames(), categories: { k1: 'Oziq-ovqat' } }
    expect(formatValue('expenses', 'category_id', 'k1', names)).toBe('Oziq-ovqat')
    for (const f of ['category_id', 'spent_at', 'payer_id', 'monthly_limit', 'outside_estimate', 'payment_source'])
      expect(t.history.fields[f], f).toBeTruthy()
  })

  it('xatolik xabari matni — tizim egasiga', () => {
    expect(t.bugReport.sent).toBe('Rahmat, xabaringiz tizim egasiga yuborildi')
  })
})
