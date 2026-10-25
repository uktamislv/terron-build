import { alertDetailText } from './alertDetails'

const base = { type: 'smeta_ozgarishi' as const, base_unit: null }

const mat = (name: string, before: string | number, after: string | number, pct: string | number, exceeded = false) => ({
  material_id: `m-${name}`,
  material_name: name,
  base_unit: 'kg',
  before,
  after,
  diff_pct: pct,
  consumed: '0',
  exceeded_before: exceeded,
})

describe('alertDetailText — smeta_ozgarishi', () => {
  it('norm_increase: eski normadan oshganlar birinchi, ko‘pi 3 ta, qolgani soni', () => {
    const text = alertDetailText({
      ...base,
      details: {
        kind: 'norm_increase',
        estimate_id: 'e3',
        version: 3,
        prev_version: '2',
        materials: [mat('Qum', '100', '110.5', '10.5'), mat('Sement', 1000, 1250, 25, true), mat('G‘isht', 10, 11, '10'), mat('Armatura', 5, 6, 20)],
        more_count: 2,
        actor_name: 'Ali',
      },
    })
    expect(text).toBe(
      'Smeta v2 → v3: 6 ta material normasi oshdi — Sement 1 000 → 1 250 kg (+25%) ⚠️ chiqim eski normadan oshgan, ' +
        'Qum 100 → 110,5 kg (+10,5%), G‘isht 10 → 11 kg (+10%) va yana 3 ta',
    )
  })

  it('old_version_restored va current_deleted', () => {
    expect(
      alertDetailText({ ...base, details: { kind: 'old_version_restored', version: 1, prev_version: 3, actor_name: 'Vali' } }),
    ).toBe('Eski versiya joriy qilindi: v3 → v1 (Vali)')
    expect(alertDetailText({ ...base, details: { kind: 'current_deleted', version: '2', actor_name: 'Vali' } })).toBe(
      'Joriy smeta o‘chirildi: v2 (Vali)',
    )
  })
})

describe('alertDetailText — Batch 8 turlari', () => {
  it('normadan_oshish: sarf, isrof bilan norma va foiz', () => {
    expect(
      alertDetailText({
        type: 'normadan_oshish',
        base_unit: 'kg',
        details: { norm_qty_base: '1000', allowed_qty_base: '1050.000000', consumed_qty_base: '1312.5', over_pct: '25.00', base_unit: 'kg' },
      }),
    ).toBe('Sarf 1 312,5 kg, isrof bilan norma 1 050 kg — 25% oshgan')
  })

  it('normadan_oshish: smetada yo‘q', () => {
    expect(
      alertDetailText({
        type: 'normadan_oshish',
        base_unit: null,
        details: { consumed_qty_base: '20', not_in_estimate: true, base_unit: 'm³' },
      }),
    ).toBe('Smetada yo‘q material sarflandi: 20 m³')
  })

  it('smetadan_ortiq_sorov: so‘ralgan, qolgan, ortiqcha', () => {
    expect(
      alertDetailText({
        type: 'smetadan_ortiq_sorov',
        base_unit: 'kg',
        details: { requested_qty_base: '500', available_qty_base: '300', over_qty_base: '200' },
      }),
    ).toBe('So‘raldi 500 kg, smetada qolgan 300 kg — 200 kg ortiq')
    expect(
      alertDetailText({ type: 'smetadan_ortiq_sorov', base_unit: 'dona', details: { requested_qty_base: 10, not_in_estimate: true } }),
    ).toBe('Smetada yo‘q material so‘raldi: 10 dona')
  })

  it('inventarizatsiya_kamomadi: ro‘yxat (3 tagacha), qolgani va jami qiymat', () => {
    const item = (name: string, shortage: string) => ({ material_name: name, base_unit: 'kg', shortage, shortage_value: null })
    expect(
      alertDetailText({
        type: 'inventarizatsiya_kamomadi',
        base_unit: null,
        details: {
          items: [item('Sement', '50'), item('Qum', '1.5'), item('Gips', '2'), item('Bo‘yoq', '1')],
          more_count: 1,
          total_shortage_value: '1250000.00',
        },
      }),
    ).toBe('Kamomad: 5 ta material — Sement −50 kg, Qum −1,5 kg, Gips −2 kg va yana 2 ta. Jami: 1 250 000 so‘m')
  })

  it('otkazma_farqi: qayerdan → qayerga, yuborilgan/qabul/farq', () => {
    expect(
      alertDetailText({
        type: 'otkazma_farqi',
        base_unit: 'kg',
        details: {
          sent_qty_base: '100',
          received_qty_base: '90',
          diff_qty_base: '-10',
          base_unit: 'kg',
          from_object_name: 'Obyekt A',
          to_object_name: 'Obyekt B',
        },
      }),
    ).toBe('Obyekt A → Obyekt B: yuborildi 100 kg, qabul qilindi 90 kg (farq -10 kg)')
  })
})

describe('alertDetailText — reviewer tuzatishlari', () => {
  it('otkazma_farqi direction=not_received: "Qabul qilinmadi: 100 kg, 52 soat"', () => {
    expect(
      alertDetailText({
        type: 'otkazma_farqi',
        base_unit: 'kg',
        details: { direction: 'not_received', sent_qty_base: '100', hours: 52, base_unit: 'kg' },
      }),
    ).toBe('Qabul qilinmadi: 100 kg, 52 soat')
  })

  it('smeta_ozgarishi kind=waste_changed', () => {
    expect(
      alertDetailText({
        type: 'smeta_ozgarishi',
        base_unit: null,
        details: { kind: 'waste_changed', material_name: 'Sement', material_id: 'm-sem', before: '3', after: '5.5', actor_name: 'Ali' },
      }),
    ).toBe('Isrof foizi o‘zgardi: Sement 3% → 5,5% (Ali)')
  })

  it('inventarizatsiya_kamomadi: sanalmaganlar va tuzatilgani', () => {
    expect(
      alertDetailText({
        type: 'inventarizatsiya_kamomadi',
        base_unit: null,
        details: {
          items: [{ material_name: 'Sement', base_unit: 'kg', shortage: '20' }],
          not_counted: [
            { material_id: 'm-g', material_name: 'Gips', base_unit: 'dona', expected: '4', shortage_value: null },
            { material_id: 'm-q', material_name: 'Qum', base_unit: 'm³', expected: '2', shortage_value: '240000.00' },
          ],
          not_counted_more: 3,
          applied_at: '2026-11-01T07:00:00Z',
          applied_by_name: 'Ali',
        },
      }),
    ).toBe('Kamomad: 1 ta material — Sement −20 kg. Sanalmagan: 5 ta material. Qoldiq tuzatildi: Ali, 01.11.2026')
  })

  it('ozi_qabul_qilgan kind=transfer', () => {
    expect(alertDetailText({ type: 'ozi_qabul_qilgan', base_unit: null, details: { kind: 'transfer' } })).toBe(
      'O‘tkazmani yuborgan o‘zi qabul qilgan',
    )
  })

  it('avtomatik yopilish sababi o‘zbekcha', async () => {
    const { autoCloseReason } = await import('./alertDetails')
    expect(autoCloseReason({ details: { auto_closed: true, closed_reason: 'estimate_changed' } })).toBe('Smeta o‘zgardi')
    expect(autoCloseReason({ details: { auto_closed: true, closed_reason: 'no_current_estimate' } })).toBe('Smeta yo‘q')
    expect(autoCloseReason({ details: { auto_closed: true, closed_reason: 'within_threshold' } })).toBe('Chegara ichida')
    expect(autoCloseReason({ details: { auto_closed: true, closed_reason: 'request_rejected' } })).toBe('So‘rov rad etildi')
    expect(autoCloseReason({ details: { closed_reason: 'toString' } })).toBeNull()
    expect(autoCloseReason({ details: {} })).toBeNull()
  })
})
