import { afterEach, describe, expect, it, vi } from 'vitest'
import { toRepoError } from './errors'
import { fetchWithTimeout, FUNCTION_TIMEOUT_MS, HEAVY_RPC_TIMEOUT_MS, REQUEST_TIMEOUT_MS, timeoutFor, UPLOAD_TIMEOUT_MS } from './supabaseClient'

/** Hech qachon javob bermaydigan server: faqat signal bekor qilinganda rad etadi. */
function hangingFetch(): typeof fetch {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('fetchWithTimeout', () => {
  it('chegaradan oshsa — TypeError (supabase-js tarmoq xatosi) → toRepoError "network"', async () => {
    vi.useFakeTimers()
    const f = fetchWithTimeout(hangingFetch(), () => 1000)
    const p = f('https://x.supabase.co/rest/v1/movements', { method: 'POST' })
    const caught = p.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1000)
    const err = await caught
    expect(err).toBeInstanceOf(TypeError)
    // postgrest-js xatoni `${name}: ${message}` qilib qaytaradi
    expect(toRepoError({ message: `TypeError: ${(err as Error).message}` }).code).toBe('network')
  })

  it('o\'z vaqtida javob — o\'zgarishsiz qaytadi', async () => {
    const res = new Response('ok')
    const f = fetchWithTimeout(async () => res, () => 1000)
    await expect(f('https://x/rest/v1/a')).resolves.toBe(res)
  })

  it('chaqiruvchining signali bekor qilsa — asl AbortError (timeout emas)', async () => {
    const outer = new AbortController()
    const f = fetchWithTimeout(hangingFetch(), () => 60_000)
    const p = f('https://x/rest/v1/a', { signal: outer.signal })
    outer.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('chegaralar: oddiy — 20 s, Storage yuklash — 60 s', () => {
    expect(timeoutFor('https://x.supabase.co/rest/v1/movements', { method: 'POST' })).toBe(REQUEST_TIMEOUT_MS)
    expect(timeoutFor('https://x.supabase.co/storage/v1/object/photos/c/a.jpg', { method: 'POST' })).toBe(UPLOAD_TIMEOUT_MS)
    expect(timeoutFor('https://x.supabase.co/storage/v1/object/sign/photos/a.jpg', { method: 'GET' })).toBe(REQUEST_TIMEOUT_MS)
    expect(REQUEST_TIMEOUT_MS).toBe(20_000)
    expect(UPLOAD_TIMEOUT_MS).toBe(60_000)
  })

  it('og‘ir RPC (smeta importi, hisobot) — 120 s; Edge Functions — 60 s; oddiy RPC — 20 s', () => {
    for (const fn of ['import_estimate', 'estimate_create_materials', 'remember_estimate_aliases', 'dashboard_summary', 'audit_feed']) {
      expect(timeoutFor(`https://x.supabase.co/rest/v1/rpc/${fn}`, { method: 'POST' }), fn).toBe(HEAVY_RPC_TIMEOUT_MS)
    }
    expect(timeoutFor('https://x.supabase.co/rest/v1/rpc/import_estimate?select=*', { method: 'POST' })).toBe(HEAVY_RPC_TIMEOUT_MS)
    expect(timeoutFor('https://x.supabase.co/functions/v1/receipt-lookup', { method: 'POST' })).toBe(FUNCTION_TIMEOUT_MS)
    expect(timeoutFor('https://x.supabase.co/rest/v1/rpc/create_transfer', { method: 'POST' })).toBe(REQUEST_TIMEOUT_MS)
    expect(timeoutFor('https://x.supabase.co/rest/v1/rpc/import_estimate_x', { method: 'POST' })).toBe(REQUEST_TIMEOUT_MS)
    expect(HEAVY_RPC_TIMEOUT_MS).toBe(120_000)
    expect(FUNCTION_TIMEOUT_MS).toBe(60_000)
  })
})
