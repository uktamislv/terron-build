import { listIncomingTransfers, listTransfers } from './transfersRepo'

type Call = [string, ...unknown[]]

const fake = vi.hoisted(() => ({ calls: [] as [string, ...unknown[]][], results: [] as unknown[] }))

function fakeQuery(calls: Call[], result: () => unknown): unknown {
  const q: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve, reject)
        }
        return (...args: unknown[]) => {
          calls.push([prop, ...args])
          return q
        }
      },
    },
  )
  return q
}

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabase: () => ({
    from: (table: string) => {
      fake.calls.push(['from', table])
      return fakeQuery(fake.calls, () => fake.results.shift())
    },
  }),
}))

beforeEach(() => {
  fake.calls.length = 0
  fake.results.length = 0
})

describe('transfersRepo', () => {
  it('listTransfers — created_at dan keyin id tie-breaker, keyin range', async () => {
    fake.results.push({ data: [], error: null, count: 0 })
    await listTransfers({}, 1)
    const names = fake.calls.map((c) => c[0])
    const orders = fake.calls.filter((c) => c[0] === 'order').map((c) => c[1])
    expect(orders).toEqual(['created_at', 'id'])
    expect(names.indexOf('range')).toBeGreaterThan(names.lastIndexOf('order'))
    expect(fake.calls.find((c) => c[0] === 'range')?.slice(1)).toEqual([50, 99])
  })

  it('listIncomingTransfers — 250 obyekt → 3 ta .in() so‘rov, natija eskisi birinchi', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `o${i}`)
    fake.results.push(
      { data: [{ id: 't2', created_at: '2026-10-02T00:00:00Z' }], error: null },
      { data: [{ id: 't1', created_at: '2026-10-01T00:00:00Z' }], error: null },
      { data: [], error: null },
    )
    const rows = await listIncomingTransfers(ids)
    const ins = fake.calls.filter((c) => c[0] === 'in').map((c) => (c[2] as string[]).length)
    expect(ins).toEqual([100, 100, 50])
    expect(rows.map((r) => r.id)).toEqual(['t1', 't2'])
  })
})
