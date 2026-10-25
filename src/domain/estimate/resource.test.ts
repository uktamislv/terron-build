import { describe, expect, it } from 'vitest'
import {
  aggregateMaterials,
  detectResourceLayout,
  guessUnit,
  materialNameFromEstimate,
  parseResourceEstimate,
  selectMainMaterials,
  type AggregatedMaterial,
  type ResourceRow,
} from './resource'
import { RESOURCE_LRV, RESOURCE_LRV_NO_TOTALS } from './__fixtures__/resourceLrv'
import { GRAND_SMETA } from './__fixtures__/grandSmeta'
import { UZ_SIMPLE } from './__fixtures__/uzSimple'
import { CSV_STYLE } from './__fixtures__/csvStyle'
import type { Cell } from './types'

const LAYOUT = detectResourceLayout(RESOURCE_LRV)
if (!LAYOUT) throw new Error('layout topilmadi')
const PARSED = parseResourceEstimate(RESOURCE_LRV, LAYOUT)
const byRow = (n: number): ResourceRow | undefined => PARSED.resources.find((r) => r.rowNumber === n)

describe('detectResourceLayout', () => {
  it('LRV: sarlavha, ost-sarlavha, ustun raqamlari qatori sarlavha emas, tur ustunlari jamidan', () => {
    expect(LAYOUT).toEqual({
      headerRow: 1,
      dataStartRow: 4,
      col: {
        no: 0,
        code: 1,
        name: 2,
        unit: 3,
        perUnit: 4,
        qty: 5,
        price: 6,
        sum: 7,
        labor: 8,
        machine: 9,
        material: 10,
        cable: 11,
        equipment: 12,
      },
    })
  })

  it('jami qatorlarisiz — ovozlar bo\'yicha (ЧЕЛ-Ч, МАШ-Ч, eng ko\'p to\'ldirilgan)', () => {
    const l = detectResourceLayout(RESOURCE_LRV_NO_TOTALS)
    expect(l?.col.labor).toBe(8)
    expect(l?.col.machine).toBe(9)
    expect(l?.col.material).toBe(10)
    expect(new Set([l?.col.equipment, l?.col.cable])).toEqual(new Set([11, 12]))
  })

  it('ost-sarlavhasiz: perUnit null, qty — КОЛ-ВО', () => {
    const rows = RESOURCE_LRV.filter((_, i) => i !== 2)
    const l = detectResourceLayout(rows)
    expect(l?.headerRow).toBe(1)
    expect(l?.dataStartRow).toBe(3)
    expect(l?.col.perUnit).toBeNull()
    expect(l?.col.qty).toBe(4)
  })

  it('oddiy smetalar va bo\'sh — null', () => {
    expect(detectResourceLayout(GRAND_SMETA)).toBeNull()
    expect(detectResourceLayout(UZ_SIMPLE)).toBeNull()
    expect(detectResourceLayout(CSV_STYLE)).toBeNull()
    expect(detectResourceLayout([])).toBeNull()
    expect(detectResourceLayout([[1, 2, 3, 4, 5, 6, 7, 8]])).toBeNull()
  })

  it('"№" kod ustuniga tushsa (ОБОСНОВАНИЕ yo\'q) — null', () => {
    const rows: Cell[][] = [['№', 'Наименование', 'Ед. изм.', 'Кол-во', 'Цена', 'Сумма'], ['1', 'Qum', 'м3', '1', 1, 1]]
    expect(detectResourceLayout(rows)).toBeNull()
  })
})

describe('parseResourceEstimate', () => {
  it('ishlar: raqam, kod, hajm (vergul, manfiy), bo\'lim', () => {
    expect(PARSED.works.map((w) => w.no)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    expect(PARSED.works[0]).toEqual({
      rowNumber: 7,
      no: '1',
      code: 'E1-1-8-8 ШHК.ДОП.3',
      name: 'РАЗРАБОТКА ГРУНТА ЭКСКАВАТОРАМИ',
      unit: '1000М3',
      qty: '0.5',
      section: 'РАЗДЕЛ: ЗЕМЛЯНЫЕ РАБОТЫ',
    })
    expect(PARSED.works.find((w) => w.no === '6')?.qty).toBe('-2')
    expect(PARSED.works.find((w) => w.no === '3')?.section).toBe('РАЗДЕЛ: ФУНДАМЕНТЫ')
    expect(PARSED.works.find((w) => w.no === '10')?.section).toBe('РАЗДЕЛ: ОБОРУДОВАНИЕ И СЕТИ')
  })

  it('resurs qatori: ПО ПРОЕКТУ miqdori, norma, narx, summa, workNo', () => {
    expect(byRow(10)).toEqual({
      rowNumber: 10,
      workNo: '1',
      code: '009219',
      name: 'ВОДА',
      unit: 'М3',
      perUnit: '20',
      qty: '10',
      price: '2000',
      sum: '20000',
      kind: 'material',
    })
    expect(byRow(13)?.perUnit).toBe('10') // son katak
    expect(byRow(19)?.sum).toBe('18360000') // "18 360 000"
  })

  it('ПО ПРОЕКТУ bo\'sh — norma × ish hajmi', () => {
    expect(byRow(14)?.qty).toBe('3.75')
  })

  it('tur: summa ustuni bo\'yicha; kabel → equipment; ustunsiz — birlik/kod, bo\'lmasa unknown', () => {
    expect(byRow(8)?.kind).toBe('labor')
    expect(byRow(9)?.kind).toBe('machine')
    expect(byRow(19)?.kind).toBe('material')
    expect(byRow(37)?.kind).toBe('equipment') // kabel ustuni
    expect(byRow(39)?.kind).toBe('unknown')
    const counts: Record<string, number> = {}
    for (const r of PARSED.resources) counts[r.kind] = (counts[r.kind] ?? 0) + 1
    expect(counts).toEqual({ labor: 6, machine: 2, material: 13, equipment: 3, unknown: 1 })
  })

  it('tur ustuni bo\'sh resurs: ЧЕЛ-Ч → labor, МАШ-Ч → machine, 000001 → labor', () => {
    const rows = RESOURCE_LRV.slice(0, 10).map((r) => [...r])
    for (const i of [7, 8]) for (const c of [8, 9, 10]) (rows[i] as Cell[])[c] = null
    ;(rows[7] as Cell[])[3] = 'ЧАС' // kod 000001
    const l = detectResourceLayout(RESOURCE_LRV)
    if (!l) throw new Error()
    const p = parseResourceEstimate(rows, l)
    expect(p.resources.find((r) => r.rowNumber === 8)?.kind).toBe('labor')
    expect(p.resources.find((r) => r.rowNumber === 9)?.kind).toBe('machine')
  })

  it('ish qatorining o\'zi resurs (material, uskuna, kabel): workNo = o\'z raqami', () => {
    expect(byRow(21)).toEqual({
      rowNumber: 21,
      workNo: '4',
      code: 'С124-9221',
      name: 'АРМАТУРА КЛАССА АIII, ДИАМЕТРОМ 12 ММ',
      unit: 'Т',
      perUnit: null,
      qty: '2.5',
      price: '8000000',
      sum: '20000000',
      kind: 'material',
    })
    expect(byRow(33)?.kind).toBe('equipment')
    expect(byRow(34)?.kind).toBe('equipment')
    expect(byRow(34)?.code).toBe('ОВК8')
    // narxsiz ish qatori resurs emas
    expect(byRow(7)).toBeUndefined()
  })

  it('manfiy miqdor (chegirma) qabul qilinadi', () => {
    expect(byRow(30)?.qty).toBe('-10')
    expect(byRow(31)?.sum).toBe('-2000')
  })

  it('o\'tkazilganlar: bo\'lim, jami, bo\'sh', () => {
    const reasons = (r: string) => PARSED.skipped.filter((s) => s.reason === r).map((s) => s.rowNumber)
    expect(reasons('section')).toEqual([5, 6, 15, 32])
    expect(reasons('total')).toEqual([40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 52])
    expect(reasons('empty')).toEqual([51])
    expect(reasons('invalid')).toEqual([])
    expect(reasons('header')).toEqual([])
  })

  it('jami qiymatlar', () => {
    expect(PARSED.totals).toEqual({
      labor: '3680000',
      machine: '252000',
      material: '61494750',
      equipment: '50000000',
      cable: '2850000',
      grand: '133589960',
    })
  })

  it('yorliqsiz: tur jamilari ustunlar yig\'indisi qatoridan, grand — oxirgi Итого', () => {
    const rows = RESOURCE_LRV.slice(0, 40).concat([[null, null, 'Итого', 'СУМ', null, null, null, 118276750]])
    expect(parseResourceEstimate(rows, LAYOUT).totals).toEqual({
      labor: '3680000',
      machine: '252000',
      material: '61494750',
      equipment: '50000000',
      cable: '2850000',
      grand: '118276750',
    })
  })

  it('xato qatorlar: nom/birlik/miqdor yo\'q, noto\'g\'ri son; ustun raqamlari qatori — header', () => {
    const rows: Cell[][] = [
      ...RESOURCE_LRV.slice(0, 7),
      ['1.1', '000001', '', 'ЧЕЛ-Ч', '1', '1', 1, 1, 1],
      ['1.2', '009219', 'ВОДА', '', '1', '1', 1, 1, null, null, 1],
      ['1.3', '009219', 'ВОДА', 'М3', '1', 'abc', 1, 1, null, null, 1],
      ['1.4', '009219', 'ВОДА', 'М3', '1', '1', 'x', 1, null, null, 1],
      ['2', 'E1', '', 'М3', '1'],
      [1, 2, 3, 4, 5, 6, 7, 8],
      ['abc', 'X', 'Y', 'М3', '1', '1', 1, 1],
    ]
    const p = parseResourceEstimate(rows, LAYOUT)
    expect(p.resources).toEqual([])
    expect(p.skipped.slice(-7)).toEqual([
      { rowNumber: 8, reason: 'invalid' },
      { rowNumber: 9, reason: 'invalid' },
      { rowNumber: 10, reason: 'invalid' },
      { rowNumber: 11, reason: 'invalid' },
      { rowNumber: 12, reason: 'invalid' },
      { rowNumber: 13, reason: 'header' },
      { rowNumber: 14, reason: 'invalid' },
    ])
  })

  it('bo\'sh jadval', () => {
    expect(parseResourceEstimate([], LAYOUT)).toEqual({
      works: [],
      resources: [],
      skipped: [],
      totals: { labor: null, machine: null, material: null, equipment: null, cable: null, grand: null },
    })
  })
})

describe('aggregateMaterials', () => {
  const agg = aggregateMaterials(PARSED.resources)
  const get = (k: string): AggregatedMaterial | undefined => agg.find((a) => a.key === k)

  it('kalit — kod; yig\'indilar, o\'rtacha narx, qatorlar', () => {
    expect(get('009219')).toEqual({
      key: '009219',
      code: '009219',
      name: 'ВОДА',
      unit: 'М3',
      qty: '17',
      avgPrice: '2000',
      sum: '34000',
      occurrences: 4,
      rowNumbers: [10, 13, 26, 31],
      kind: 'material',
    })
    expect(get('045050')?.qty).toBe('5.75')
    expect(get('045050')?.sum).toBe('431250')
    expect(get('045050')?.avgPrice).toBe('75000')
  })

  it('bir kod turli birlikda — code|birlik', () => {
    expect(get('064848')).toBeUndefined()
    expect(get('064848|100шт')?.qty).toBe('3')
    expect(get('064848|10шт')?.sum).toBe('4500')
  })

  it('standart: material + equipment, unknown/labor/machine yo\'q; summa bo\'yicha kamayish', () => {
    expect(agg.map((a) => a.key)).toEqual([
      'Т-ДС-04',
      'С124-9221',
      '043101',
      '011001',
      '040101',
      'ОВК8',
      '034482',
      '045050',
      '033001',
      '064848|100шт',
      '009219',
      '064848|10шт',
    ])
    expect(get('Т-ДС-04')?.kind).toBe('equipment')
    expect(get('034482')?.kind).toBe('equipment')
    expect(aggregateMaterials(PARSED.resources, ['material']).some((a) => a.kind === 'equipment')).toBe(false)
    expect(aggregateMaterials(PARSED.resources, ['unknown']).map((a) => a.key)).toEqual(['КRJ-45'])
  })

  it('kod bo\'sh — normalizeAlias(nom)|birlik; summa yo\'q — qty × narx; qty 0 — avgPrice null', () => {
    const base: ResourceRow = { rowNumber: 1, workNo: '1', code: '', name: 'Qum  Mayda', unit: 'М3', perUnit: null, qty: '2', price: '1000.555', sum: null, kind: 'material' }
    const r = aggregateMaterials([
      base,
      { ...base, rowNumber: 2, name: 'QUM MAYDA', unit: 'м3', qty: '-2', price: null, sum: '-100' },
      // "X" identifikator emas (raqamsiz, qisqa) — nom bo'yicha birlashadi
      { ...base, rowNumber: 3, code: 'X', qty: '0', price: null, sum: null },
      { ...base, rowNumber: 4, code: 'C-100', qty: '0', price: null, sum: null },
    ])
    expect(r).toEqual([
      {
        key: 'qum mayda|м3',
        code: '',
        name: 'Qum  Mayda',
        unit: 'М3',
        qty: '0',
        avgPrice: null,
        sum: '1901.11',
        occurrences: 3,
        rowNumbers: [1, 2, 3],
        kind: 'material',
      },
      { key: 'C-100', code: 'C-100', name: 'Qum  Mayda', unit: 'М3', qty: '0', avgPrice: null, sum: '0', occurrences: 1, rowNumbers: [4], kind: 'material' },
    ])
  })

  it('bir kod ostida turli nomlar ("ПРАЙС", umumiy raqamli kod) — nom bo\'yicha, code bo\'sh', () => {
    const row = (rowNumber: number, code: string, name: string, unit: string, qty: string, sum: string): ResourceRow => ({
      rowNumber,
      workNo: '1',
      code,
      name,
      unit,
      perUnit: null,
      qty,
      price: null,
      sum,
      kind: 'material',
    })
    const r = aggregateMaterials([
      row(1, 'ПРАЙС', 'Плитка керамическая', 'М2', '10', '1000'),
      row(2, 'ПРАЙС', 'Клей плиточный', 'КГ', '50', '500'),
      row(3, 'прайс', 'ПЛИТКА  КЕРАМИЧЕСКАЯ', 'м2', '5', '500'),
      row(4, '999999', 'Труба стальная', 'М', '100', '3000'),
      row(5, '999999', 'Отвод стальной', 'ШТ', '4', '400'),
      row(6, '999999', 'Труба стальная', 'М', '20', '600'),
      row(7, '045050', 'Щебень', 'М3', '2', '200'),
      row(8, '045050', 'ЩЕБЕНЬ', 'М3', '1', '100'),
    ])
    expect(r.map((a) => [a.key, a.code, a.qty, a.sum, a.rowNumbers])).toEqual([
      ['труба стальная|м', '', '120', '3600', [4, 6]],
      ['плитка керамическая|м2', '', '15', '1500', [1, 3]],
      ['клей плиточный|кг', '', '50', '500', [2]],
      ['отвод стальной|шт', '', '4', '400', [5]],
      ['045050', '045050', '3', '300', [7, 8]],
    ])
  })

  it('unknown turi ham agregatsiya qilinadi; aralash tur — material ustun', () => {
    const base: ResourceRow = { rowNumber: 1, workNo: '1', code: 'КRJ-45', name: 'Коннектор', unit: 'ШТ', perUnit: null, qty: '2', price: null, sum: '100', kind: 'unknown' }
    const rows: ResourceRow[] = [base, { ...base, rowNumber: 2, kind: 'equipment' }, { ...base, rowNumber: 3, kind: 'material' }]
    const all = ['material', 'equipment', 'unknown'] as const
    expect(aggregateMaterials([base], [...all])).toMatchObject([{ key: 'КRJ-45', code: 'КRJ-45', kind: 'unknown', sum: '100' }])
    expect(aggregateMaterials(rows.slice(0, 2), [...all])[0]?.kind).toBe('equipment')
    expect(aggregateMaterials(rows, [...all])[0]).toMatchObject({ kind: 'material', qty: '6', sum: '300', occurrences: 3 })
    expect(aggregateMaterials(rows)[0]).toMatchObject({ kind: 'material', occurrences: 2 })
  })

  it('o\'rtacha narx 2 xonaga yaxlitlanadi; bo\'sh ro\'yxat', () => {
    const base: ResourceRow = { rowNumber: 1, workNo: '1', code: 'A', name: 'A', unit: 'Т', perUnit: null, qty: '3', price: null, sum: '10', kind: 'material' }
    expect(aggregateMaterials([base])[0]?.avgPrice).toBe('3.33')
    expect(aggregateMaterials([{ ...base, sum: '20' }])[0]?.avgPrice).toBe('6.67')
    expect(aggregateMaterials([])).toEqual([])
  })
})

describe('selectMainMaterials', () => {
  const agg = aggregateMaterials(PARSED.resources)
  it('95 %: kumulyativ ulush chegarani kesib o\'tgunicha', () => {
    // jami 114 344 750; 50+20+18,36+18 = 106,36 mln < 108,63 mln (95 %) → +4,5 mln
    expect([...selectMainMaterials(agg)]).toEqual(['Т-ДС-04', 'С124-9221', '043101', '011001', '040101'])
  })

  it('boshqa ulushlar va chegaralar', () => {
    expect([...selectMainMaterials(agg, '50')]).toEqual(['Т-ДС-04', 'С124-9221'])
    expect(selectMainMaterials(agg, '0').size).toBe(1)
    expect(selectMainMaterials(agg, '-5').size).toBe(1)
    expect(selectMainMaterials(agg, '100').size).toBe(12)
    expect(selectMainMaterials(agg, '150').size).toBe(12)
    expect(selectMainMaterials(agg, 'abc').size).toBe(1)
  })

  it('aynan chegarada to\'xtaydi; bo\'sh; nol summalar', () => {
    const mk = (key: string, sum: string): AggregatedMaterial => ({
      key,
      code: key,
      name: key,
      unit: 'Т',
      qty: '1',
      avgPrice: null,
      sum,
      occurrences: 1,
      rowNumbers: [1],
      kind: 'material',
    })
    expect([...selectMainMaterials([mk('a', '50'), mk('b', '45'), mk('c', '5')])]).toEqual(['a', 'b'])
    expect([...selectMainMaterials([mk('b', '45'), mk('a', '50'), mk('c', '5')], '50')]).toEqual(['a'])
    expect(selectMainMaterials([]).size).toBe(0)
    expect([...selectMainMaterials([mk('z', '0'), mk('y', '0')])]).toEqual(['z'])
    expect([...selectMainMaterials([mk('a', '10'), mk('n', '-5')])]).toEqual(['a'])
  })
})

describe('guessUnit', () => {
  it.each([
    ['Т', 't', '1', 't'],
    ['ТН', 't', '1', 't'],
    ['т.', 't', '1', 't'],
    ['КГ', 'kg', '1', 'kg'],
    ['М3', 'm³', '1', 'm³'],
    ['м³', 'm³', '1', 'm³'],
    ['M3', 'm³', '1', 'm³'], // lotin M
    ['М2', 'm²', '1', 'm²'],
    ['М', 'm', '1', 'm'],
    ['Л', 'l', '1', 'l'],
    ['ШТ', 'dona', '1', 'dona'],
    ['шт.', 'dona', '1', 'dona'],
    ['КОМП', 'komplekt', '1', 'komplekt'],
    ['КОМПЛ', 'komplekt', '1', 'komplekt'],
    ['КОМПЛЕКТ', 'komplekt', '1', 'komplekt'],
    ['К-Т', 'komplekt', '1', 'komplekt'],
    ['10 ШТ', 'dona', '10', '10 dona'],
    ['10ШТ', 'dona', '10', '10 dona'],
    ['100ШТ', 'dona', '100', '100 dona'],
    ['1000ШТ', 'dona', '1000', '1000 dona'],
    ['100М', 'm', '100', '100 m'],
    ['1000М', 'm', '1000', '1000 m'],
    ['10М2', 'm²', '10', '10 m²'],
    ['100М2', 'm²', '100', '100 m²'],
    ['100М3', 'm³', '100', '100 m³'],
    ['1000М3', 'm³', '1000', '1000 m³'],
    ['100КГ', 'kg', '100', '100 kg'],
  ])('%s → %s × %s', (input, baseUnit, factor, unitLabel) => {
    expect(guessUnit(input)).toEqual({ baseUnit, factor, unitLabel })
  })

  it.each(['ЧЕЛ-Ч', 'МАШ-Ч', 'СУМ', '', '  ', '0ШТ', '100', 'ПОГ.М2', 'шт/м'])('%j → null', (input) => {
    expect(guessUnit(input)).toBeNull()
  })
})

describe('materialNameFromEstimate', () => {
  it.each([
    ['ЩЕБЕНЬ ИЗ ПРИРОДНОГО КАМНЯ ДЛЯ СТРОИТЕЛЬНЫХ РАБОТ ФРАКЦИИ 5-10 ММ', 'Щебень из природного камня для строительных работ фракции 5-10 мм'],
    ['БЕТОН ТЯЖЕЛЫЙ КЛАССА В15 /М-200/', 'Бетон тяжелый класса В15 /М-200/'],
    ['КИРПИЧ КЕРАМИЧЕСКИЙ М-150', 'Кирпич керамический М-150'],
    ['ЭЛЕКТРОДЫ Э42А ДИАМЕТРОМ 4 ММ', 'Электроды Э42А диаметром 4 мм'],
    ['ЭМАЛЬ ПФ-115', 'Эмаль ПФ-115'],
    ['ГРУНТОВКА ГФ-021', 'Грунтовка ГФ-021'],
    ['КАБЕЛЬ С МЕДНЫМИ ЖИЛАМИ МАРКИ NYM 5Х1,5', 'Кабель с медными жилами марки NYM 5Х1,5'],
    ['ТРУБЫ ПВХ Ø50 ММ', 'Трубы ПВХ Ø50 мм'],
    ['АРМАТУРА КЛАССА АIII, ДИАМЕТРОМ 12 ММ', 'Арматура класса АIII, диаметром 12 мм'],
    ['БИТУМЫ НЕФТЯНЫЕ ДОРОЖНЫЕ ЖИДКИЕ КЛАСС МГ И СГ', 'Битумы нефтяные дорожные жидкие класс МГ и СГ'],
    ['АВТОМОБИЛИ-САМОСВАЛЫ ГРУЗОПОДЪЕМНОСТЬЮ ДО 10 Т', 'Автомобили-самосвалы грузоподъемностью до 10 т'],
    ['ТРУБЫ В ИЗОЛЯЦИИ (КРОМЕ ПОДЗЕМНЫХ)', 'Трубы в изоляции (кроме подземных)'],
    ['ПЕСОК, М3', 'Песок, м3'],
    ['NYM КАБЕЛЬ', 'NYM кабель'],
    ['СОЛНЕЧНАЯ ПАНЕЛЬ 725 W', 'Солнечная панель 725 W'],
    ['  ВОДА   ПИТЬЕВАЯ ', 'Вода питьевая'],
  ])('%s', (input, expected) => {
    expect(materialNameFromEstimate(input)).toBe(expected)
  })

  it('kichik harfli nom — faqat bo\'sh joylar; bo\'sh va raqamli', () => {
    expect(materialNameFromEstimate('Цемент  М500 ')).toBe('Цемент М500')
    expect(materialNameFromEstimate('')).toBe('')
    expect(materialNameFromEstimate('   ')).toBe('')
    expect(materialNameFromEstimate('5-10')).toBe('5-10')
  })
})
