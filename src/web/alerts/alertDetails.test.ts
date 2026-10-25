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
