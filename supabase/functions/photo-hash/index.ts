// photo-hash — Deno Edge Function. Mantiq: ./logic.ts (testlar: ./logic.test.ts).
// verify_jwt = false (supabase/config.toml):
//  - foydalanuvchi rejimi: chaqiruvchini funksiyaning o'zi auth.getUser(jwt) bilan tekshiradi
//    (JWT yo'q / yaroqsiz / anon kalit → 401);
//  - sweep rejimi (`{"mode":"sweep"}`): faqat baza (pg_net) — `x-photo-secret` = Vault `photo_hash_secret`.
// Yozuv va rasm service client bilan o'qiladi — huquq (firma, muallif / admin) logic.ts da.

import {
  MAX_PHOTO_BYTES,
  PHOTO_TABLES,
  authorizeSweep,
  createUserLimiter,
  handlePhotoHash,
  isSweepRequest,
  runSweep,
  type DownloadResult,
  type PhotoHashDeps,
  type PhotoJob,
  type PhotoTable,
  type SweepDeps,
} from './logic.ts'
import { json, log, preflight, readJson } from '../_shared/http.ts'
import { activeProfileByAuthUserId, getAdminClient, getAuthUserIdFromJwt } from '../_shared/supabaseAdmin.ts'

const PHOTO_BUCKET = 'photos'
const PATH_COLUMN: Record<PhotoTable, string> = { movements: 'photo_path', purchases: 'receipt_photo_path', expenses: 'receipt_photo_path' }
const SHA_COLUMN: Record<PhotoTable, string> = { movements: 'photo_sha256', purchases: 'receipt_photo_sha256', expenses: 'receipt_photo_sha256' }

async function downloadPhoto(path: string): Promise<DownloadResult> {
  const { data, error } = await getAdminClient().storage.from(PHOTO_BUCKET).download(path)
  if (error) {
    const e = error as { status?: number; statusCode?: string | number }
    const status = e.status ?? Number(e.statusCode ?? NaN)
    if (status === 401 || status === 403) return { ok: false, reason: 'forbidden' }
    if (status === 404 || status === 400 || /not.?found/i.test(error.message)) return { ok: false, reason: 'not_found' }
    throw new Error(`storage download: ${error.message}`)
  }
  if (data.size > MAX_PHOTO_BYTES) return { ok: false, reason: 'too_large' }
  return { ok: true, bytes: new Uint8Array(await data.arrayBuffer()) }
}

/** Shu firmada shu xesh boshqa tirik yozuvda (ikkala jadvalda). */
async function hasDuplicate(companyId: string, table: PhotoTable, id: string, sha256: string): Promise<boolean> {
  for (const t of PHOTO_TABLES) {
    let q = getAdminClient()
      .from(t)
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq(SHA_COLUMN[t], sha256)
      .is('deleted_at', null)
    if (t === table) q = q.neq('id', id)
    const { count, error } = await q
    if (error) throw new Error(`${t}(sha): ${error.message}`)
    if ((count ?? 0) > 0) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Sweep siri: RPC `svc_photo_hash_secret()` (Vault, tg-dispatch'dagi `svc_dispatch_secret` kabi);
// RPC hali yo'q bo'lsa (PGRST202) — `PHOTO_HASH_SECRET` secret'i (docs/audit-fixes.md, 2-tur).
// Kesh 5 daqiqa; mos kelmasa yangilash — ko'pi bilan 30 s da bir marta.
// ---------------------------------------------------------------------------

const SECRET_TTL_MS = 5 * 60_000
const SECRET_REFRESH_MIN_MS = 30_000
let cachedSecret: { value: string | null; at: number } | null = null
let secretRpcMissing = false

async function readSweepSecret(): Promise<string | null> {
  if (!secretRpcMissing) {
    const { data, error } = await getAdminClient().rpc('svc_photo_hash_secret')
    if (!error) return typeof data === 'string' && data !== '' ? data : null
    if (error.code !== 'PGRST202') throw new Error(`svc_photo_hash_secret: ${error.message}`)
    secretRpcMissing = true
    log('warn', "photo-hash: svc_photo_hash_secret yo'q — PHOTO_HASH_SECRET ishlatiladi")
  }
  const env = Deno.env.get('PHOTO_HASH_SECRET') ?? ''
  return env !== '' ? env : null
}

async function getSweepSecret(refresh: boolean): Promise<string | null> {
  const age = cachedSecret === null ? Infinity : Date.now() - cachedSecret.at
  const stale = age >= SECRET_TTL_MS || (refresh && age >= SECRET_REFRESH_MIN_MS)
  if (cachedSecret !== null && !stale) return cachedSecret.value
  const value = await readSweepSecret()
  cachedSecret = { value, at: Date.now() }
  return value
}

const sweepDeps: SweepDeps = {
  getSweepSecret,
  claimJobs: async (limit) => {
    const { data, error } = await getAdminClient().rpc('svc_claim_photo_hash_jobs', { p_limit: limit })
    if (error) throw new Error(`svc_claim_photo_hash_jobs: ${error.message}`)
    return (data ?? []) as PhotoJob[]
  },
  downloadPhoto,
  completeJob: async (jobId, sha256, error, final) => {
    const { data, error: rpcError } = await getAdminClient().rpc('svc_complete_photo_hash_job', {
      p_job_id: jobId,
      p_sha256: sha256,
      p_error: error,
      p_final: final,
    })
    if (rpcError) throw new Error(`svc_complete_photo_hash_job: ${rpcError.message}`)
    return typeof data === 'string' ? data : null
  },
  now: () => Date.now(),
  log,
}

const userDeps: PhotoHashDeps = {
  getAuthUserIdFromJwt,
  getActiveProfile: async (authUserId) => {
    const p = await activeProfileByAuthUserId(authUserId)
    return p === null ? null : { id: p.id, company_id: p.company_id, role: p.role }
  },
  loadRow: async (table, id) => {
    const col = PATH_COLUMN[table]
    const { data, error } = await getAdminClient()
      .from(table)
      .select(`company_id, created_by, deleted_at, ${col}`)
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(`${table}: ${error.message}`)
    if (data === null) return null
    const row = data as Record<string, unknown>
    return {
      company_id: String(row.company_id),
      created_by: typeof row.created_by === 'string' ? row.created_by : null,
      path: typeof row[col] === 'string' ? (row[col] as string) : null,
      deleted: row.deleted_at !== null && row.deleted_at !== undefined,
    }
  },
  downloadPhoto,
  setPhotoHash: async (table, id, sha256, expectedPath) => {
    const { data, error } = await getAdminClient().rpc('svc_set_photo_hash', {
      p_table: table,
      p_id: id,
      p_sha256: sha256,
      p_expected_path: expectedPath,
    })
    if (error) {
      if (error.hint === 'photo_hash_invalid' || error.hint === 'photo_sha256_invalid') return { ok: false, reason: 'invalid' }
      throw new Error(`svc_set_photo_hash: ${error.message}`)
    }
    return { ok: true, stored: data === true }
  },
  hasDuplicate,
  // Profil bo'yicha 30 / 10 daqiqa (izolyat xotirasida — cheklov: izolyatlar o'rtasida umumiy emas).
  limiter: createUserLimiter(),
  now: () => Date.now(),
  log,
}

/** Supabase Edge Runtime: javobdan keyin ham fon vazifasini davom ettirish. */
type EdgeRuntimeLike = { waitUntil: (p: Promise<unknown>) => void }
function edgeRuntime(): EdgeRuntimeLike | null {
  const er = (globalThis as { EdgeRuntime?: Partial<EdgeRuntimeLike> }).EdgeRuntime
  return er && typeof er.waitUntil === 'function' ? (er as EdgeRuntimeLike) : null
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  try {
    const body = await readJson(req)

    if (isSweepRequest(body)) {
      const auth = await authorizeSweep(req.headers.get('x-photo-secret'), sweepDeps)
      if (!auth.ok) return json(auth.result.status, auth.result.body)
      const er = edgeRuntime()
      if (er !== null) {
        // pg_net kutib qolmasin — darhol 202, ishlar fonda (≤ ~40 s byudjet).
        er.waitUntil(
          runSweep(sweepDeps).catch((e) => {
            log('error', 'photo-hash: sweep fon vazifasi xatosi', { error: e instanceof Error ? e.name : 'unknown' })
          }),
        )
        return json(202, { accepted: true })
      }
      return json(200, await runSweep(sweepDeps))
    }

    const result = await handlePhotoHash(req.headers.get('Authorization'), body, userDeps)
    return json(result.status, result.body)
  } catch (e) {
    log('error', 'photo-hash: kutilmagan xato', { error: e instanceof Error ? e.message : String(e) })
    return json(500, { error: 'internal' })
  }
})
