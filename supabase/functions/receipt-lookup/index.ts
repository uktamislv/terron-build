// receipt-lookup — fiskal chek (ofd.soliq.uz QR) ma'lumotlari. Deno Edge Function.
// Mantiq: ./logic.ts (testlar: ./logic.test.ts). Shartnoma: docs/automation-design.md (G).
// verify_jwt = false (supabase/config.toml): chaqiruvchini funksiyaning o'zi auth.getUser(jwt)
// bilan tekshiradi; JWT yo'q / yaroqsiz / anon kalit → 401.
//
// Tashqi so'rov: faqat logic.ts `validateReceiptUrl` qayta qurgan kanonik
// `https://ofd.soliq.uz/(check|epi)?...` ga GET; redirect kuzatilmaydi, 5 s, ≤ 1 MB.
// Kesh: o'qish — chaqiruvchi JWT'si bilan (RLS: o'z firmasi), yozish — service_role RPC
// `svc_upsert_receipt_lookup` (firma va profil shu yerda aniqlangan).

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  FETCH_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  coerceReceiptData,
  handleReceiptLookup,
  readCapped,
  type FetchResult,
  type ReceiptLookupDeps,
} from './logic.ts'
import { json, log, preflight, readJson } from '../_shared/http.ts'
import { activeProfileByAuthUserId, getAdminClient, getAuthUserIdFromJwt } from '../_shared/supabaseAdmin.ts'

const CLIENT_OPTS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const

/** Chaqiruvchi JWT'si bilan klient (RLS amal qiladi). Har so'rovda yangi — hech qayerda saqlanmaydi. */
function userClient(jwt: string) {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (url === '' || anon === '') throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY sozlanmagan')
  return createClient(url, anon, { ...CLIENT_OPTS, global: { headers: { Authorization: `Bearer ${jwt}` } } })
}

async function fetchPage(url: string): Promise<FetchResult> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'text/html,application/json;q=0.9,*/*;q=0.1', 'User-Agent': 'TERRON-Build/1.0 receipt-lookup' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' }
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => undefined)
    return { ok: false, reason: 'redirect', status: res.status }
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => undefined)
    return { ok: false, reason: 'http_status', status: res.status }
  }
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await res.body?.cancel().catch(() => undefined)
    return { ok: false, reason: 'too_large' }
  }
  try {
    const body = await readCapped(res.body, MAX_RESPONSE_BYTES)
    if (body === null) return { ok: false, reason: 'too_large' }
    return { ok: true, body, contentType: res.headers.get('content-type') }
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' }
  }
}

const deps: ReceiptLookupDeps = {
  getAuthUserIdFromJwt,
  getActiveProfile: async (authUserId) => {
    const p = await activeProfileByAuthUserId(authUserId)
    return p === null ? null : { profileId: p.id, companyId: p.company_id }
  },
  cacheGet: async (jwt, caller, qr) => {
    const { data, error } = await userClient(jwt)
      .from('receipt_lookups')
      .select('payload')
      .eq('company_id', caller.companyId)
      .eq('fiscal_sign', qr.fiscalSign)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`receipt_lookups: ${error.message}`)
    return data === null ? null : coerceReceiptData((data as { payload: unknown }).payload)
  },
  cachePut: async (_jwt, caller, qr, receipt) => {
    const { error } = await getAdminClient().rpc('svc_upsert_receipt_lookup', {
      p_company_id: caller.companyId,
      p_created_by: caller.profileId,
      p_fiscal_sign: qr.fiscalSign,
      p_terminal_id: receipt.terminalId ?? qr.terminalId,
      p_receipt_no: receipt.receiptNo ?? qr.receiptNo,
      p_payload: receipt,
      // numeric — satr sifatida (float'ga aylantirilmaydi)
      p_total: receipt.total,
      p_seller_tin: receipt.sellerTin,
      p_seller_name: receipt.sellerName,
      p_receipt_at: receipt.datetime,
    })
    if (error) throw new Error(`svc_upsert_receipt_lookup: ${error.message}`)
  },
  fetchPage,
  log,
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  try {
    const body = await readJson(req)
    const result = await handleReceiptLookup(req.headers.get('Authorization'), body, deps)
    return json(result.status, result.body)
  } catch (e) {
    log('error', 'receipt-lookup: kutilmagan xato', { error: e instanceof Error ? e.message : String(e) })
    return json(500, { error: 'internal' })
  }
})
