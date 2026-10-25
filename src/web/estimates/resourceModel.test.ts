import { cmp } from '@/domain/decimal'
import {
  aggregateMaterials,
  detectResourceLayout,
  parseResourceEstimate,
  selectMainMaterials,
  type AggregatedMaterial,
  type Cell,
} from '@/domain/estimate'
import { RESOURCE_LRV } from '@/domain/estimate/__fixtures__/resourceLrv'
import { RESOURCE_SVOD } from '@/domain/estimate/__fixtures__/resourceVariants'
import { makeAlias, makeMaterial, makeUnit } from '@/test/fixtures'
import {
  autoDecisions,
  autoUnitAnswer,
  autoUnitAnswers,
  classifyResources,
  clip,
  createMaterialsPayload,
  DEFAULT_SHARE,
  matchCounts,
  rememberPayload,
  resourceGroupKey,
  resourceItems,
  resourceSummary,
  shareStats,
  unknownKeysOf,
} from './resourceModel'
import { buildPlan, toImportItems, totalsDiffer, type UnitQuestion } from './wizardModel'

function parse(rows: Cell[][]) {
  const layout = detectResourceLayout(rows)
  if (!layout) throw new Error('layout')
  return parseResourceEstimate(rows, layout)
}

function agg(overrides: Partial<AggregatedMaterial>): AggregatedMaterial {
  return {
    key: 'k',
    code: '',
    name: 'X',
    unit: 'ШТ',
    qty: '1',
    avgPrice: '1',
    sum: '1',
    occurrences: 1,
    rowNumbers: [1],
    kind: 'material',
    ...overrides,
  }
}

describe('resourceSummary', () => {
  it('LRV: fayldagi jami qatorlari, uskuna = uskuna + kabel, turi noma’lum qatorlar alohida', () => {
    const s = resourceSummary(parse(RESOURCE_LRV))
    expect(s.works).toBeGreaterThan(0)
    expect(s.totals.labor).toBe('3680000')
    expect(s.totals.machine).toBe('252000')
    expect(s.totals.equipment).toBe('52850000')
    expect(s.laborMachineRows).toBe(s.byKind.labor + s.byKind.machine)
    expect(s.laborMachineRows).toBeGreaterThan(0)
    // КОННЕКТОР RJ-45 — tur ustuni to'ldirilmagan
    expect(s.byKind.unknown).toBe(1)
    expect(cmp(s.totals.unknown ?? '0', '40000')).toBe(0)
    expect(s.invalidRows).toBe(0)
  })

  it('xato qatorlar soni (parsed.skipped, reason invalid)', () => {
    const rows = [...RESOURCE_LRV.slice(0, 39), ['10.1', '000999', '', 'ШТ', '1', '1', 1, 1], ...RESOURCE_LRV.slice(39)]
    expect(resourceSummary(parse(rows)).invalidRows).toBe(1)
  })

  it('SVOD (tur ustunlarisiz, jami qatorlari yo‘q): resurslar yig‘indisi, 0 yoki NaN yo‘q', () => {
    const parsed = parse(RESOURCE_SVOD)
    expect(parsed.totals.labor).toBeNull()
    const s = resourceSummary(parsed)
    for (const k of ['labor', 'machine', 'material', 'equipment', 'unknown'] as const) {
      const v = s.totals[k]
      if (s.byKind[k] === 0) expect(v).toBeNull()
      else {
        expect(v).not.toBeNull()
        expect(v).not.toMatch(/NaN/)
      }
    }
    expect(s.totals.grand).not.toBeNull()
    expect(s.totals.grand).not.toBe('0')
    expect(s.byKind.labor).toBeGreaterThan(0)
    expect(s.totals.labor).not.toBe('0')
  })
})

describe('resourceItems / shareStats', () => {
  it('miqdori ≤ 0 — saqlanmaydi; kalit — r:<agregat>; lineSum — summa (2 xona)', () => {
    const { items, dropped } = resourceItems(
      [agg({ key: 'a', qty: '2', sum: '10.005', avgPrice: '5', code: '009219' }), agg({ key: 'b', qty: '-1', sum: '-2' })],
      3,
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: 'r:a', rowNumber: 4, qty: '2', price: '5', code: '009219', type: null })
    expect(cmp(items[0]?.lineSum ?? '0', '10.01')).toBe(0)
    expect(dropped.map((d) => d.key)).toEqual(['b'])
  })

  it('standart ulush — 95 %; soni va foiz (Dec)', () => {
    expect(DEFAULT_SHARE).toBe('95')
    const list = aggregateMaterials(parse(RESOURCE_LRV).resources)
    const main = selectMainMaterials(list, DEFAULT_SHARE)
    const s = shareStats(list, main)
    expect(s.count).toBe(main.size)
    expect(Number(s.pct)).toBeGreaterThanOrEqual(95)
    const all = shareStats(list, selectMainMaterials(list, '100'))
    expect(all.pct).toBe('100')
  })
})

describe('classifyResources', () => {
  const items = [
    agg({ key: '009219', code: '009219', name: 'ВОДА', sum: '100' }),
    agg({ key: '043101', code: '043101', name: 'БЕТОН', sum: '90' }),
    agg({ key: '011001', code: '011001', name: 'КИРПИЧ', sum: '80' }),
    agg({ key: '033001', code: '033001', name: 'ГВОЗДИ', sum: '1' }),
    agg({ key: 'КRJ-45', code: 'КRJ-45', name: 'КОННЕКТОР', sum: '70' }),
    agg({ key: '040101', code: '040101', name: 'РАСТВОР', sum: '60' }),
  ]
  const suv = makeMaterial('m-suv', 'Suv', 'm³', { aliases: [makeAlias('a1', 'm-suv', '009219', 'code')] })
  const beton = makeMaterial('m-bet', 'Beton', 'm³', { aliases: [makeAlias('a2', 'm-bet', 'Бетон')] })
  const off = makeMaterial('m-off', 'Qorishma', 'm³', { is_active: false, aliases: [makeAlias('a3', 'm-off', '040101', 'code')] })
  const offDup = makeMaterial('m-off2', 'Suv eski', 'm³', { is_active: false, aliases: [makeAlias('a4', 'm-off2', '009219', 'code')] })

  it('shifr → nom → turi noma’lum / yangi (asosiy) / kam summali; nofaol ham topiladi, faol ustun', () => {
    const main = new Set(['009219', '043101', '011001', 'КRJ-45', '040101'])
    const m = classifyResources(items, [offDup, suv, beton, off], main, {}, new Set(['КRJ-45']))
    expect(m.map((x) => x.source)).toEqual(['code', 'name', 'new', 'minor', 'unknown', 'code'])
    expect(m[0]).toMatchObject({ materialId: 'm-suv', inactive: false })
    expect(m[5]).toMatchObject({ materialId: 'm-off', inactive: true })
    expect(matchCounts(m)).toEqual({ code: 2, name: 1, created: 0, new: 1, minor: 1, unknown: 1, inactive: 1 })
    const d = autoDecisions(m)
    expect(d[resourceGroupKey(items[0] as AggregatedMaterial)]).toEqual({ kind: 'material', materialId: 'm-suv', saveAlias: false })
    expect(d['r:033001']).toEqual({ kind: 'ish' })
    expect(d['r:КRJ-45']).toEqual({ kind: 'ish' })
    expect(d['r:011001']).toBeUndefined()
  })

  it('shu importda yaratilgan — katalogda bo‘lsa birinchi', () => {
    const kirpich = makeMaterial('m-new', 'Kirpich', 'dona')
    const m = classifyResources(items, [suv, beton, kirpich], new Set(), { '011001': 'm-new', '033001': 'm-missing' })
    expect(m[2]).toMatchObject({ source: 'created', materialId: 'm-new' })
    expect(m[3]?.source).toBe('minor')
  })

  it('unknownKeysOf: barcha qatorlari `unknown` bo‘lgan agregatlar', () => {
    const parsed = parse(RESOURCE_LRV)
    const list = aggregateMaterials(parsed.resources, ['material', 'equipment', 'unknown'])
    const keys = unknownKeysOf(list, parsed.resources)
    expect([...keys].map((k) => list.find((a) => a.key === k)?.name)).toEqual(['КОННЕКТОР RJ-45'])
  })
})

describe('createMaterialsPayload', () => {
  it('nom, asosiy birlik va qo‘shimcha birlik guessUnit dan; asl nom alias', () => {
    const p = createMaterialsPayload([
      agg({ key: '011001', code: '011001', name: 'КИРПИЧ  КЕРАМИЧЕСКИЙ М-150', unit: '1000ШТ' }),
      agg({ key: 'x|рул', code: '', name: 'ГИДРОИЗОЛ', unit: 'РУЛ' }),
      agg({ key: 'long', code: 'K'.repeat(101), name: 'А'.repeat(250), unit: 'Т' }),
    ])
    expect(p[0]).toEqual({
      key: '0',
      name: 'Кирпич керамический М-150',
      base_unit: 'dona',
      code: '011001',
      alias: 'КИРПИЧ КЕРАМИЧЕСКИЙ М-150',
      units: [{ unit: '1000 dona', factor: '1000', variant: null }],
    })
    expect(p[1]).toMatchObject({ key: '1', base_unit: 'рул', code: null, units: null })
    expect(Array.from(p[2]?.name ?? '')).toHaveLength(200)
    expect(Array.from(p[2]?.alias ?? '')).toHaveLength(200)
    expect(p[2]).toMatchObject({ base_unit: 't', code: null, units: null })
  })

  it('clip — belgilar bo‘yicha', () => {
    expect(clip('abc', 2)).toBe('ab')
    expect(clip('ab', 2)).toBe('ab')
  })
})

const q = (key: string, materialKey: string, unitText: string, m: ReturnType<typeof makeMaterial>): UnitQuestion => ({
  key,
  materialKey,
  materialName: m.name,
  baseUnit: m.base_unit,
  unitText,
  options: m.units.map((u) => ({ id: u.id, label: u.unit, factor: u.factor })),
  groupKeys: [],
})

describe('autoUnitAnswer(s)', () => {
  const sement = makeMaterial('m-sem', 'Sement', 'kg', { units: [makeUnit('u-qop', 'm-sem', 'qop', '50')] })
  const kirpich = makeMaterial('m-k', 'Kirpich', 'dona', { units: [makeUnit('u-1000', 'm-k', '1000 dona', '1000')] })

  it('mavjud birlik (koeffitsient bo‘yicha), t → kg, yangi birlik, noma’lum — javobsiz', () => {
    const qs = [
      q('a', 'm-k', '1000ШТ', kirpich),
      q('b', 'm-k', 'ШТ', kirpich),
      q('c', 'm-sem', 'Т', sement),
      q('d', 'm-k', '100ШТ', kirpich),
      q('e', 'm-k', 'РУЛ', kirpich),
      q('f', 'm-sem', 'М3', sement),
    ]
    const ans = autoUnitAnswers(qs, [sement, kirpich], true)
    expect(ans.a).toEqual({ kind: 'existing', unitId: 'u-1000' })
    expect(ans.b).toEqual({ kind: 'existing', unitId: 'm-k-base' })
    expect(ans.c).toEqual({ kind: 'new', unit: '1000 kg', factor: '1000', variant: '' })
    expect(ans.d).toEqual({ kind: 'new', unit: '100 dona', factor: '100', variant: '' })
    expect(ans.e).toBeUndefined()
    expect(ans.f).toBeUndefined()
    const noCatalog = autoUnitAnswers(qs, [sement, kirpich], false)
    expect(noCatalog.c).toBeUndefined()
    expect(noCatalog.a).toEqual({ kind: 'existing', unitId: 'u-1000' })
  })

  it('shu nomli birlik boshqa koeffitsient bilan bor — yangi birlik taklif qilinmaydi', () => {
    const odd = makeMaterial('m-o', 'Polosa', 'dona', { units: [makeUnit('u-100', 'm-o', '100 DONA', '50')] })
    expect(autoUnitAnswer(q('x', 'm-o', '100ШТ', odd), odd, true)).toBeNull()
  })
})

describe('buildPlan (resurs rejimi)', () => {
  const suv = makeMaterial('m-suv', 'Suv', 'm³')
  const items = resourceItems(
    [
      agg({ key: '009219', code: '009219', name: 'ВОДА', unit: 'М3', qty: '3', avgPrice: '0.33', sum: '1' }),
      agg({ key: '033001', code: '033001', name: 'ГВОЗДИ', unit: 'КГ', qty: '7', avgPrice: '0.14', sum: '1' }),
    ],
    0,
  ).items

  it('line_sum — qator summasi, jami farqi yo‘q; avtomatik birlik bitta o‘tishda; savol guruhlari', () => {
    const autoAnswer = vi.fn((qq: UnitQuestion) => autoUnitAnswer(qq, suv, true))
    const plan = buildPlan({
      items,
      materials: [suv],
      decisions: { 'r:009219': { kind: 'material', materialId: 'm-suv', saveAlias: false }, 'r:033001': { kind: 'ish' } },
      answers: {},
      canCatalog: true,
      skipMatch: true,
      autoAnswer,
    })
    expect(autoAnswer).toHaveBeenCalledTimes(1)
    expect(plan.autoAnswers['m-suv|м3']).toEqual({ kind: 'existing', unitId: 'm-suv-base' })
    expect(plan.questions[0]?.groupKeys).toEqual(['r:009219'])
    expect(plan.unresolvedQuestions).toBe(0)
    expect(cmp(plan.total, '2')).toBe(0)
    expect(totalsDiffer(plan)).toBe(false)
    const out = toImportItems(plan, { materials: {}, units: {} })
    expect(out.map((i) => i.line_sum)).toEqual(['1', '1'])
    expect(out[0]).toMatchObject({ item_type: 'material', unit_id: 'm-suv-base', code: '009219' })
  })

  it('foydalanuvchi javobi avtomatikdan ustun; skipMatch — qarorsiz guruh moslanmaydi', () => {
    const sv = makeMaterial('m-suv', 'Suv', 'm³', { units: [makeUnit('u-l', 'm-suv', 'l', '0.001')] })
    const plan = buildPlan({
      items,
      materials: [sv, makeMaterial('m-g', 'ГВОЗДИ', 'kg')],
      decisions: { 'r:009219': { kind: 'material', materialId: 'm-suv', saveAlias: false } },
      answers: { 'm-suv|м3': { kind: 'existing', unitId: 'u-l' } },
      canCatalog: true,
      skipMatch: true,
      autoAnswer: (qq) => autoUnitAnswer(qq, sv, true),
    })
    expect(plan.autoAnswers['m-suv|м3']).toEqual({ kind: 'existing', unitId: 'm-suv-base' })
    expect(plan.rows[0]?.factor).toBe('0.001')
    expect(plan.unresolvedGroups).toBe(1)
    expect(plan.decided['r:033001']).toBeUndefined()
  })
})

describe('rememberPayload', () => {
  it('material qatorlari: import_estimate ga yuborilgan aynan shifr va nom; yangi material id progress dan; takrorlarsiz', () => {
    const item = (code: string, name: string) => ({
      rowNumber: 1,
      name,
      unit: 'М3',
      qty: '1',
      price: null,
      sum: null,
      type: null,
      code,
      sumMismatch: false,
    })
    const rows = [
      { itemType: 'material' as const, materialKey: 'm-suv', item: item('009219', 'ВОДА') },
      { itemType: 'material' as const, materialKey: 'm-suv', item: item('009219', 'ВОДА') },
      { itemType: 'material' as const, materialKey: 'new:x', item: item('', '  КИРПИЧ  М-150 ') },
      { itemType: 'ish' as const, materialKey: null, item: item('033001', 'ГВОЗДИ') },
      { itemType: 'material' as const, materialKey: 'm-a', item: item('K'.repeat(101), 'A') },
    ]
    expect(rememberPayload(rows, { 'new:x': { id: 'm-new' } })).toEqual([
      { material_id: 'm-suv', code: '009219', name: 'ВОДА' },
      { material_id: 'm-new', code: null, name: '  КИРПИЧ  М-150 ' },
      { material_id: 'm-a', code: null, name: 'A' },
    ])
  })
})
