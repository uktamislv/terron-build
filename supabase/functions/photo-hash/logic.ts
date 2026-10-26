// photo-hash — yuklangan rasmning SHA-256 xeshini server tomonida hisoblab yozadi
// (docs/audit-fixes.md, B5: klient yuborgan xesh e'tiborsiz, xeshni faqat `svc_set_photo_hash` yozadi).
// Sof mantiq: tashqi bog'liqliklar `deps` orqali (testlar: ./logic.test.ts).
//
// Oqim: JWT → faol profil → yozuv (service client) → firma va huquq (muallif yoki admin) →
// rasm yo'li `{company_id}/yyyy/mm/{uuid}.{ext}` → `photos` bucket'dan o'qish (≤ 5 MB) →
// SHA-256 → `svc_set_photo_hash(p_table, p_id, p_sha256)` (takroriy rasm qoidasi shu UPDATE'da
// ishlaydi) → shu firmada shu xesh boshqa tirik yozuvda bormi (`duplicate`).

import { errMessage, isRecord, isUuid, respond, type HandlerResult, type LogFn } from '../_shared/handler.ts'

export const PHOTO_TABLES = ['movements', 'purchases'] as const
export type PhotoTable = (typeof PHOTO_TABLES)[number]

/** Bucket chegarasi bilan bir xil (`storage.buckets.photos.file_size_limit`). */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024

/** Rasm yo'li formati — `photos_insert` siyosati va `b_photo_path` trigger bilan bir xil. */
const PHOTO_PATH_RE = /^([0-9a-f-]{36})\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/

/** Yozuvni o'zgartira oladigan (xeshni so'ray oladigan) rollar — muallifdan tashqari. */
export const PHOTO_HASH_ADMIN_ROLES: readonly string[] = ['admin', 'super_admin']

export interface PhotoCaller {
  id: string
  company_id: string
  role: string
}

export interface PhotoRow {
  company_id: string
  created_by: string | null
  /** `movements.photo_path` yoki `purchases.receipt_photo_path`. */
  path: string | null
  deleted: boolean
}

export type DownloadResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'not_found' | 'too_large' }

export type SetHashResult = { ok: true; stored: boolean } | { ok: false; reason: 'invalid' }

export interface PhotoHashDeps {
  /** JWT → auth user id (`auth.getUser`). Anon / yaroqsiz → null. */
  getAuthUserIdFromJwt: (jwt: string) => Promise<string | null>
  /** Faol (o'chirilmagan, `is_active`, firma faol) profil. */
  getActiveProfile: (authUserId: string) => Promise<PhotoCaller | null>
  /** Yozuv (service client, RLS'siz). Yo'q bo'lsa null. */
  loadRow: (table: PhotoTable, id: string) => Promise<PhotoRow | null>
  /** `photos` bucket'dan o'qish (service client), `MAX_PHOTO_BYTES` dan katta — too_large. */
  downloadPhoto: (path: string) => Promise<DownloadResult>
  /** `svc_set_photo_hash` — hint `photo_hash_invalid` / `photo_sha256_invalid` → invalid. */
  setPhotoHash: (table: PhotoTable, id: string, sha256: string) => Promise<SetHashResult>
  /** Shu firmada shu xesh boshqa tirik yozuvda (movements yoki purchases) bormi. */
  hasDuplicate: (companyId: string, table: PhotoTable, id: string, sha256: string) => Promise<boolean>
  log: LogFn
}

/** SHA-256 hex (WebCrypto — Deno va Node'da bir xil). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Rasm yo'li shu firmaniki va to'g'ri formatdami. */
export function photoPathAllowed(path: string, companyId: string): boolean {
  const m = PHOTO_PATH_RE.exec(path)
  return m !== null && m[1] === companyId.toLowerCase()
}

function bearer(authHeader: string | null): string | null {
  if (typeof authHeader !== 'string') return null
  const m = /^Bearer\s+(\S+)$/i.exec(authHeader.trim())
  return m ? (m[1] as string) : null
}

const err = (status: number, error: string): HandlerResult => respond(status, { error })

/**
 * So'rov: `POST { table: 'movements' | 'purchases', id: uuid }`, `Authorization: Bearer <user JWT>`.
 * Javoblar:
 * - 200 `{ sha256, duplicate }` — xesh yozildi; `duplicate` — shu firmada shu rasm boshqa yozuvda bor
 *   (baza `takroriy_yozuv` alertini o'zi yaratadi)
 * - 400 `invalid_request` (body), `photo_path_invalid` (yo'l formati / boshqa firma papkasi),
 *   `photo_too_large` (> 5 MB), `photo_hash_invalid` (RPC rad etdi)
 * - 401 `unauthorized`; 403 `forbidden` (faol profil yo'q, boshqa firma, muallif ham admin ham emas)
 * - 404 `not_found` (yozuv yo'q / o'chirilgan), `photo_not_found` (yozuvda rasm yo'q yoki faylning o'zi yo'q)
 * - 500 `internal`
 */
export async function handlePhotoHash(
  authHeader: string | null,
  body: unknown,
  deps: PhotoHashDeps,
): Promise<HandlerResult> {
  const jwt = bearer(authHeader)
  if (jwt === null) return err(401, 'unauthorized')
  if (!isRecord(body) || typeof body.table !== 'string' || !isUuid(body.id)) return err(400, 'invalid_request')
  if (!(PHOTO_TABLES as readonly string[]).includes(body.table)) return err(400, 'invalid_request')
  const table = body.table as PhotoTable
  const id = body.id.toLowerCase()

  try {
    const authId = await deps.getAuthUserIdFromJwt(jwt)
    if (authId === null) return err(401, 'unauthorized')
    const caller = await deps.getActiveProfile(authId)
    if (caller === null) return err(403, 'forbidden')

    const row = await deps.loadRow(table, id)
    if (row === null || row.deleted) return err(404, 'not_found')
    if (caller.role !== 'super_admin' && row.company_id !== caller.company_id) return err(403, 'forbidden')
    const isAuthor = row.created_by !== null && row.created_by === caller.id
    if (!isAuthor && !PHOTO_HASH_ADMIN_ROLES.includes(caller.role)) return err(403, 'forbidden')

    if (row.path === null || row.path === '') return err(404, 'photo_not_found')
    if (!photoPathAllowed(row.path, row.company_id)) {
      deps.log('warn', "photo-hash: rasm yo'li formati / firmasi mos emas", { table, id })
      return err(400, 'photo_path_invalid')
    }

    const file = await deps.downloadPhoto(row.path)
    if (!file.ok) return err(file.reason === 'too_large' ? 400 : 404, file.reason === 'too_large' ? 'photo_too_large' : 'photo_not_found')
    if (file.bytes.byteLength > MAX_PHOTO_BYTES) return err(400, 'photo_too_large')

    const sha256 = await sha256Hex(file.bytes)
    const set = await deps.setPhotoHash(table, id, sha256)
    if (!set.ok) return err(400, 'photo_hash_invalid')
    // stored = false: shu orada yozuv o'chirildi yoki rasm olib tashlandi
    if (!set.stored) return err(404, 'not_found')

    let duplicate = false
    try {
      duplicate = await deps.hasDuplicate(row.company_id, table, id, sha256)
    } catch (e) {
      // Xesh yozildi — takroriy qoida bazada ishladi; faqat UI belgisi yo'qoladi.
      deps.log('warn', 'photo-hash: takroriylik tekshirilmadi', { error: errMessage(e), table, id })
    }
    deps.log('info', 'photo-hash: xesh yozildi', { table, id, duplicate })
    return respond(200, { sha256, duplicate })
  } catch (e) {
    deps.log('error', 'photo-hash: ichki xato', { error: errMessage(e), table, id })
    return err(500, 'internal')
  }
}
