import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Faqat anon (public) kalit. service_role kaliti frontendga hech qachon tushmaydi.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

let client: SupabaseClient | null = null

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey)
}

/** Audit log uchun qurilma: Mini App (`/tg`) — `mobil`, veb panel — `veb`. */
export function clientDevice(pathname: string = window.location.pathname): 'mobil' | 'veb' {
  return pathname === '/tg' || pathname.startsWith('/tg/') ? 'mobil' : 'veb'
}

/**
 * So'rov vaqti chegarasi: oddiy so'rov — 20 s; rasm yuklash (Storage, POST/PUT) va Edge Functions — 60 s;
 * og'ir RPC'lar (smeta importi, katalogga qo'shish, hisobot va tarix) — 120 s.
 */
export const REQUEST_TIMEOUT_MS = 20_000
export const UPLOAD_TIMEOUT_MS = 60_000
export const FUNCTION_TIMEOUT_MS = 60_000
export const HEAVY_RPC_TIMEOUT_MS = 120_000

/**
 * Server minglab qatorni bitta tranzaksiyada qayta ishlaydigan RPC'lar: 20 s da uzilsa server ishni
 * tugatadi, UI esa noto'g'ri "Internet aloqasini tekshiring" ko'rsatadi.
 */
const HEAVY_RPCS: readonly string[] = [
  'import_estimate',
  'estimate_create_materials',
  'remember_estimate_aliases',
  'dashboard_summary',
  'dashboard_daily',
  'spend_breakdown',
  'norm_overview',
  'audit_feed',
  'deleted_records',
]

/** Shu so'rov uchun chegara (ms). */
export function timeoutFor(input: RequestInfo | URL, init?: RequestInit): number {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
  const path = url.split('?')[0] ?? url
  const upload = path.includes('/storage/v1/object/') && method !== 'GET' && method !== 'HEAD'
  if (upload) return UPLOAD_TIMEOUT_MS
  const rpc = /\/rest\/v1\/rpc\/([A-Za-z0-9_]+)$/.exec(path)
  if (rpc && HEAVY_RPCS.includes(rpc[1] as string)) return HEAVY_RPC_TIMEOUT_MS
  if (path.includes('/functions/v1/')) return FUNCTION_TIMEOUT_MS
  return REQUEST_TIMEOUT_MS
}

/**
 * `fetch` o'rami: javob chegaradan kechiksa so'rov bekor qilinadi va `TypeError('Failed to fetch: timeout')`
 * tashlanadi — supabase-js uni tarmoq xatosi sifatida qaytaradi, `toRepoError` → `network` ("Internet
 * aloqasini tekshiring"). Aks holda zaif internetda "Saqlanmoqda…" cheksiz aylanib qolardi.
 * Chaqiruvchining o'z `signal` i (masalan eksportni bekor qilish) ham ishlaydi — u holda asl AbortError.
 */
export function fetchWithTimeout(
  base: typeof fetch = (input, init) => globalThis.fetch(input, init),
  pickTimeout: (input: RequestInfo | URL, init?: RequestInit) => number = timeoutFor,
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, pickTimeout(input, init))
    const outer = init?.signal ?? null
    const onOuterAbort = () => controller.abort(outer?.reason)
    if (outer) {
      if (outer.aborted) controller.abort(outer.reason)
      else outer.addEventListener('abort', onOuterAbort, { once: true })
    }
    try {
      return await base(input, { ...init, signal: controller.signal })
    } catch (err) {
      if (timedOut) throw new TypeError('Failed to fetch: timeout', { cause: err })
      throw err
    } finally {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onOuterAbort)
    }
  }
}

/** Supabase klienti. Faqat src/data/ ichidagi repository fayllari chaqiradi. */
export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error('VITE_SUPABASE_URL va VITE_SUPABASE_ANON_KEY .env faylida berilmagan')
  }
  client ??= createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
    // Ilova bir marta yuklanadi: /tg yoki / — sarlavha butun sessiya davomida o'zgarmaydi
    // Har bir so'rovda vaqt chegarasi (auth, PostgREST, Storage, Edge Functions)
    global: { headers: { 'x-client-device': clientDevice() }, fetch: fetchWithTimeout() },
  })
  return client
}
