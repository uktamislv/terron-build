import { describe, expect, it } from 'vitest'
import { draftFingerprint, nextDraftId } from './useDraftId'

describe('nextDraftId', () => {
  let n = 0
  const make = () => `id-${++n}`

  it('birinchi urinish — o\'sha id, iz yoziladi', () => {
    expect(nextDraftId({ id: 'a', fingerprint: null }, 'x', make)).toEqual({ id: 'a', fingerprint: 'x' })
  })
  it('xatodan keyin aynan shu yozuv — o\'sha id (idempotent)', () => {
    expect(nextDraftId({ id: 'a', fingerprint: 'x' }, 'x', make)).toEqual({ id: 'a', fingerprint: 'x' })
  })
  it('xatodan keyin miqdor/material o\'zgardi — yangi id', () => {
    const next = nextDraftId({ id: 'a', fingerprint: 'x' }, 'y', make)
    expect(next.id).not.toBe('a')
    expect(next.fingerprint).toBe('y')
  })
  it('iz — tartibli, bo\'sh qiymatlar barqaror', () => {
    expect(draftFingerprint(['kirim', 'o1', null])).toBe(draftFingerprint(['kirim', 'o1', undefined]))
    expect(draftFingerprint(['kirim', 'o1', '3'])).not.toBe(draftFingerprint(['kirim', 'o1', '30']))
  })
})
