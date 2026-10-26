// photo-hash — Deno Edge Function. Mantiq: ./logic.ts (testlar: ./logic.test.ts).
// verify_jwt = false (supabase/config.toml): chaqiruvchini funksiyaning o'zi auth.getUser(jwt)
// bilan tekshiradi; JWT yo'q / yaroqsiz / anon kalit → 401.
// Yozuv va rasm service client bilan o'qiladi — huquq (firma, muallif / admin) logic.ts da.

import {
  MAX_PHOTO_BYTES,
  handlePhotoHash,
  type DownloadResult,
  type PhotoHashDeps,
  type PhotoTable,
} from './logic.ts'
import { json, log, preflight, readJson } from '../_shared/http.ts'
import { activeProfileByAuthUserId, getAdminClient, getAuthUserIdFromJwt } from '../_shared/supabaseAdmin.ts'

const PHOTO_BUCKET = 'photos'
const PATH_COLUMN: Record<PhotoTable, string> = { movements: 'photo_path', purchases: 'receipt_photo_path' }
const SHA_COLUMN: Record<PhotoTable, string> = { movements: 'photo_sha256', purchases: 'receipt_photo_sha256' }

async function downloadPhoto(path: string): Promise<DownloadResult> {
  const { data, error } = await getAdminClient().storage.from(PHOTO_BUCKET).download(path)
  if (error) {
    const status = (error as { status?: number; statusCode?: string | number }).status ??
      Number((error as { statusCode?: string | number }).statusCode ?? NaN)
    if (status === 404 || status === 400 || /not.?found/i.test(error.message)) return { ok: false, reason: 'not_found' }
    throw new Error(`storage download: ${error.message}`)
  }
  if (data.size > MAX_PHOTO_BYTES) return { ok: false, reason: 'too_large' }
  return { ok: true, bytes: new Uint8Array(await data.arrayBuffer()) }
}

/** Shu firmada shu xesh boshqa tirik yozuvda (ikkala jadvalda). */
async function hasDuplicate(companyId: string, table: PhotoTable, id: string, sha256: string): Promise<boolean> {
  for (const t of ['movements', 'purchases'] as const) {
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

const deps: PhotoHashDeps = {
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
  setPhotoHash: async (table, id, sha256) => {
    const { data, error } = await getAdminClient().rpc('svc_set_photo_hash', {
      p_table: table,
      p_id: id,
      p_sha256: sha256,
    })
    if (error) {
      if (error.hint === 'photo_hash_invalid' || error.hint === 'photo_sha256_invalid') return { ok: false, reason: 'invalid' }
      throw new Error(`svc_set_photo_hash: ${error.message}`)
    }
    return { ok: true, stored: data === true }
  },
  hasDuplicate,
  log,
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  try {
    const body = await readJson(req)
    const result = await handlePhotoHash(req.headers.get('Authorization'), body, deps)
    return json(result.status, result.body)
  } catch (e) {
    log('error', 'photo-hash: kutilmagan xato', { error: e instanceof Error ? e.message : String(e) })
    return json(500, { error: 'internal' })
  }
})
