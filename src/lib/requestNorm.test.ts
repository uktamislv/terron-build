import { describe, expect, it } from 'vitest'
import type { NormUsage } from '@/data/types'
import { requestNormState } from './requestNorm'

function norm(materialId: string, extra: Partial<NormUsage> = {}): NormUsage {
  return {
    company_id: 'c',
    object_id: 'o',
    material_id: materialId,
    estimate_id: 'e',
    norm_qty_base: '100',
    allowed_qty_base: '100',
    consumed_qty_base: '0',
    delivered_qty_base: '0',
    requested_open_qty_base: '0',
    remaining_qty_base: '100',
    usage_pct: '0',
    ...extra,
  }
}

describe('requestNormState', () => {
  it('smetaga kirmaydigan material — doim "outside" (smeta yo\'q yoki ortiqcha bo\'lsa ham)', () => {
    expect(requestNormState([], 'm', '10', undefined, { outsideEstimate: true })).toEqual({ kind: 'outside' })
    expect(requestNormState([norm('m')], 'm', '500', undefined, { outsideEstimate: true })).toEqual({ kind: 'outside' })
  })
  it('oddiy material — avvalgidek', () => {
    expect(requestNormState([], 'm', '10')).toEqual({ kind: 'no_estimate' })
    expect(requestNormState([norm('x')], 'm', '10')).toEqual({ kind: 'not_in_estimate' })
    expect(requestNormState([norm('m')], 'm', '150').kind).toBe('over')
    expect(requestNormState([norm('m')], 'm', '50', undefined, { outsideEstimate: false }).kind).toBe('ok')
  })
})
