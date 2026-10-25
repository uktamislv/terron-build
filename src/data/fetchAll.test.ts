import { RepoError } from './errors'
import { EXPORT_CHUNK, fetchAll, inChunks, isAbortError, type ChunkRequest } from './fetchAll'

const NOW = new Date('2026-10-25T07:00:00Z')

describe('fetchAll', () => {
  it('1000 tadan; count faqat birinchi bo‘lakda; before — boshlanish vaqti', async () => {
    const reqs: ChunkRequest[] = []
    const rows = await fetchAll(
      async (req) => {
        reqs.push(req)
        const n = req.first ? EXPORT_CHUNK : 5
        return { rows: Array.from({ length: n }, (_, i) => ({ id: `r${req.from + i}` })), total: req.first ? 1005 : null }
      },
      { now: () => NOW },
    )
    expect(reqs.map((r) => [r.from, r.to, r.first])).toEqual([
      [0, 999, true],
      [1000, 1999, false],
    ])
    expect(reqs.every((r) => r.before === NOW.toISOString())).toBe(true)
    expect(rows).toHaveLength(1005)
  })

  it('takror qatorlar (id bo‘yicha) tashlanadi', async () => {
    let call = 0
    const rows = await fetchAll(async () => {
      call++
      // 1-bo'lak to'liq, 2-bo'lakda siljish tufayli oldingi oxirgi qator yana keldi
      if (call === 1) return { rows: Array.from({ length: EXPORT_CHUNK }, (_, i) => ({ id: i })), total: null }
      return { rows: [{ id: EXPORT_CHUNK - 1 }, { id: EXPORT_CHUNK }], total: null }
    })
    expect(rows).toHaveLength(EXPORT_CHUNK + 1)
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
  })

  it('keyOf — id’siz qatorlar uchun kalit', async () => {
    const rows = await fetchAll(async () => ({ rows: [{ a: 1 }, { a: 1 }, { a: 2 }], total: 3 }), { keyOf: (r) => String(r.a) })
    expect(rows).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('jami chegaradan ko‘p — export_too_large, keyingi bo‘lak so‘ralmaydi', async () => {
    const load = vi.fn(async () => ({ rows: [{ id: 1 }], total: 50_001 }))
    await expect(fetchAll(load)).rejects.toMatchObject({ code: 'export_too_large' })
    expect(load).toHaveBeenCalledTimes(1)
    await expect(fetchAll(load)).rejects.toBeInstanceOf(RepoError)
  })

  it('bekor qilinsa — AbortError', async () => {
    const ctrl = new AbortController()
    const p = fetchAll(
      async () => {
        ctrl.abort()
        throw new Error('fetch aborted')
      },
      { signal: ctrl.signal },
    )
    await expect(p).rejects.toSatisfy(isAbortError)
  })
})

describe('inChunks', () => {
  it('1000 id → 10 ta ketma-ket so‘rov (100 tadan), takrorsiz', async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `id${i}`)
    let active = 0
    let maxActive = 0
    const fn = vi.fn(async (chunk: string[]) => {
      active++
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active--
      return chunk.map((x) => x.toUpperCase())
    })
    const out = await inChunks([...ids, 'id1'], fn)
    expect(fn).toHaveBeenCalledTimes(10)
    expect(fn.mock.calls.every(([c]) => c.length === 100)).toBe(true)
    expect(maxActive).toBe(1)
    expect(out).toHaveLength(1000)
  })

  it('bo‘sh ro‘yxat — so‘rov yo‘q', async () => {
    const fn = vi.fn(async () => [])
    expect(await inChunks([], fn)).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })
})
