// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MAX_BODY_BYTES, readBodyCapped, readJson } from './http.ts'

/** Bo'laklab beriladigan oqim; nechta bo'lak o'qilganini sanaydi. */
function chunked(parts: string[]) {
  const enc = new TextEncoder()
  let pulled = 0
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      const p = parts[pulled]
      if (p === undefined) {
        ctrl.close()
        return
      }
      pulled++
      ctrl.enqueue(enc.encode(p))
    },
    cancel() {
      cancelled = true
    },
  })
  return { stream, pulled: () => pulled, cancelled: () => cancelled }
}

describe('readJson (audit 3, E4)', () => {
  it('oddiy JSON', async () => {
    const req = new Request('https://x/', { method: 'POST', body: '{"a":1}' })
    expect(await readJson(req)).toEqual({ a: 1 })
  })
  it('bo‘sh / noto‘g‘ri JSON → null', async () => {
    expect(await readJson(new Request('https://x/', { method: 'POST', body: '' }))).toBeNull()
    expect(await readJson(new Request('https://x/', { method: 'POST', body: '{' }))).toBeNull()
    expect(await readJson(new Request('https://x/', { method: 'POST' }))).toBeNull()
  })
  it('Content-Length chegaradan katta → body o‘qilmaydi', async () => {
    const s = chunked(['{"a":1}'])
    const req = new Request('https://x/', {
      method: 'POST',
      body: s.stream,
      headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
      duplex: 'half',
    } as RequestInit)
    expect(await readJson(req)).toBeNull()
    expect(s.pulled()).toBe(0)
  })
  it('Content-Length yo‘q, oqim chegaradan oshadi → null, o‘qish to‘xtatiladi', async () => {
    const big = 'x'.repeat(1024)
    const s = chunked(Array.from({ length: 1000 }, () => big))
    expect(await readBodyCapped(s.stream, 4096)).toBeNull()
    expect(s.pulled()).toBeLessThan(10)
    expect(s.cancelled()).toBe(true)
  })
  it('bayt bo‘yicha hisoblanadi (ko‘p baytli UTF-8)', async () => {
    const s = chunked(['"', 'ў'.repeat(10), '"']) // ў — 2 bayt
    expect(await readBodyCapped(s.stream, 15)).toBeNull()
    const ok = chunked(['"', 'ў'.repeat(10), '"'])
    expect(await readBodyCapped(ok.stream, 22)).toBe(`"${'ў'.repeat(10)}"`)
  })
})
