// Audit tuzatishlari — Telegram ilovasi sof funksiyalari: "Qoldiq" ro'yxati, bosh ekran bo'limlari,
// "Yozuvlarim" manbalari va birlashtirish.
import type { BugReport } from '@/data/bugReportsRepo'
import type { StockForecastRow } from '@/data/forecastRepo'
import type { CashAdvance, InventoryCount, Movement, StockBalance } from '@/data/types'
import { t } from '@/i18n'
import { makeAlias, makeMaterial } from '@/test/fixtures'
import { homeSectionLinks } from './home/sections'
import { mergeEntries, mineSources } from './mine/mineEntries'
import { buildStockList } from './stock/stockList'

const stock = (materialId: string, qty: string): StockBalance => ({
  company_id: 'c',
  object_id: 'o',
  material_id: materialId,
  qty_base: qty,
  last_movement_at: null,
})
const fc = (materialId: string, daysLeft: string | null): StockForecastRow => ({
  objectId: 'o',
  materialId,
  stockQtyBase: '0',
  avgDailyOut: '1',
  daysLeft,
  otherStockQtyBase: '0',
  estimateRemainingQtyBase: null,
})

describe('buildStockList — "Qoldiq"', () => {
  const sement = { ...makeMaterial('m-s', 'Sement', 'kg'), aliases: [makeAlias('a1', 'm-s', 'Цемент')] }
  const materials = [sement, makeMaterial('m-q', 'Qum', 'm3'), makeMaterial('m-a', 'Armatura', 'kg'), makeMaterial('m-k', 'Kafel', 'm2')]

  it('manfiy, keyin tugayotganlar (kam kun birinchi), keyin nom; 0 qoldiq — ko‘rsatilmaydi', () => {
    const list = buildStockList(
      [stock('m-s', '100'), stock('m-q', '5'), stock('m-a', '-2'), stock('m-k', '0')],
      [fc('m-s', '10'), fc('m-q', '1.5'), fc('m-a', null)],
      materials,
      '',
      3,
    )
    expect(list.map((i) => i.name)).toEqual(['Armatura', 'Qum', 'Sement'])
    expect(list[0]).toMatchObject({ negative: true, low: true })
    expect(list[1]).toMatchObject({ low: true, daysLeft: '1.5', baseUnit: 'm3' })
    expect(list[2]).toMatchObject({ low: false, daysLeft: '10' })
  })

  it('qidiruv — nom va muqobil nom bo‘yicha', () => {
    const list = buildStockList([stock('m-s', '100'), stock('m-q', '5')], [], materials, 'цемент', 3)
    expect(list.map((i) => i.materialId)).toEqual(['m-s'])
  })

  it('prognoz yo‘q — daysLeft null, tugayotgan emas', () => {
    expect(buildStockList([stock('m-q', '5')], [], materials, '', 3)[0]).toMatchObject({ daysLeft: null, low: false })
  })
})

describe('bosh ekran "Bo‘limlar"', () => {
  it('admin: Qoldiq, Tasdiqlash va pastki menyuga sig‘magan Sanash', () => {
    expect(homeSectionLinks('admin').map((l) => l.to)).toEqual(['/tg/stock', '/tg/approvals', '/tg/inventory'])
  })
  it('prorab, omborchi, direktor (faqat ko‘rish) — Qoldiq; tekshiruvchi, haydovchi — yo‘q', () => {
    expect(homeSectionLinks('prorab').map((l) => l.key)).toEqual(['stock'])
    expect(homeSectionLinks('omborchi').map((l) => l.key)).toEqual(['stock'])
    expect(homeSectionLinks('tekshiruvchi')).toEqual([])
    expect(homeSectionLinks('direktor').map((l) => l.key)).toEqual(['stock'])
    expect(homeSectionLinks('admin')[0]?.label).toBe(t.tg.stock.title)
  })
})

describe('"Yozuvlarim" manbalari', () => {
  it('rol bo‘yicha: tekshiruvchi — sanashlar; haydovchi — xarid va unga berilgan pul; buxgalter — bergan puli', () => {
    // Tekshiruvchi harakatlarni o'qiy olmaydi (RLS) — so'ralmaydi
    expect(mineSources('tekshiruvchi')).toEqual({ movements: false, purchases: false, requests: false, counts: true, cashRecipient: false, cashCreator: false })
    expect(mineSources('omborchi').movements).toBe(true)
    expect(mineSources('haydovchi')).toMatchObject({ purchases: true, cashRecipient: true, cashCreator: false, counts: false })
    expect(mineSources('buxgalter')).toMatchObject({ purchases: false, cashCreator: true, cashRecipient: false })
    expect(mineSources('prorab')).toMatchObject({ requests: true, purchases: true })
  })

  it('mergeEntries: hamma turlar vaqt bo‘yicha, pul takrorlanmaydi, transfer_out yashiriladi', () => {
    const mv = (id: string, at: string, type: Movement['type'] = 'kirim') => ({ id, created_at: at, type }) as Movement
    const cash = { id: 'a1', created_at: '2026-10-26T09:00:00Z', kind: 'berildi' } as CashAdvance
    const list = mergeEntries([mv('m1', '2026-10-26T08:00:00Z'), mv('m2', '2026-10-26T11:00:00Z', 'transfer_out')], [], [], [], {
      counts: [{ id: 'c1', created_at: '2026-10-26T10:00:00Z' } as InventoryCount],
      cash: [cash, cash],
      bugs: [{ id: 'b1', created_at: '2026-10-26T07:00:00Z' } as BugReport],
    })
    expect(list.map((e) => e.key)).toEqual(['c:c1', 'a:a1', 'm:m1', 'b:b1'])
  })
})
