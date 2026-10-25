import { uuid } from './uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuid', () => {
  it('randomUUID bor bo‘lsa — undan, kichik harf', () => {
    expect(uuid({ randomUUID: () => 'ABCDEF00-0000-4000-8000-000000000000', getRandomValues: (a) => a })).toBe(
      'abcdef00-0000-4000-8000-000000000000',
    )
  })

  it('randomUUID yo‘q — getRandomValues asosida v4', () => {
    const id = uuid({
      getRandomValues: <T extends ArrayBufferView | null>(a: T): T => {
        if (a instanceof Uint8Array) a.fill(0xff)
        return a
      },
    })
    expect(id).toMatch(V4)
    expect(id).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })

  it('standart crypto bilan', () => {
    expect(uuid()).toMatch(V4)
  })
})

describe('isUuid', () => {
  it('faqat UUID shaklini qabul qiladi', async () => {
    const { isUuid } = await import('./uuid')
    expect(isUuid('3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e')).toBe(true)
    expect(isUuid('o-a')).toBe(false)
    expect(isUuid('3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e,to_object_id.neq.x')).toBe(false)
    expect(isUuid(null)).toBe(false)
  })
})
