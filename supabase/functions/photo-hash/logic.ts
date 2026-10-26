// photo-hash — yuklangan rasmning SHA-256 xeshini server tomonida hisoblab yozadi
// (docs/audit-fixes.md, B5 va 2-tur S1: klient yuborgan xesh e'tiborsiz, xeshni faqat
// `svc_set_photo_hash` yozadi). Sof mantiq: tashqi bog'liqliklar `deps` orqali (testlar: ./logic.test.ts).
//
// Ikki rejim:
//  1. Foydalanuvchi: `POST { table, id }` + user JWT. Oqim: JWT → faol profil → chegara (30 / 10 daqiqa)
//     → yozuv (service client) → firma va huquq (muallif yoki admin) → rasm yo'li
//     `{company_id}/yyyy/mm/{uuid}.{ext}` → `photos` bucket'dan o'qish (≤ 5 MB) → SHA-256 →
//     `svc_set_photo_hash(p_table, p_id, p_sha256, p_expected_path)` (yo'l o'zgargan bo'lsa yozilmaydi)
//     → shu firmada shu xesh boshqa tirik yozuvda bormi (`duplicate`).
//  2. Sweep (baza uyg'otadi): `POST {"mode":"sweep"}` + `x-photo-secret`. `svc_claim_photo_hash_jobs(20)`
//     → har ish: o'qish → SHA-256 → `svc_complete_photo_hash_job(job_id, sha)`; xato — `(job_id, null,
//     xato, p_final)`. Vaqt byudjeti ~40 s.

import { timingSafeEqual } from '../_shared/telegramAuth.ts'
import { SlidingWindowLimiter } from '../_shared/rateLimit.ts'
import { errMessage, isRecord, isUuid, respond, type HandlerResult, type LogFn } from '../_shared/handler.ts'

export const PHOTO_TABLES = ['movements', 'purchases'] as const
export type PhotoTable = (typeof PHOTO_TABLES)[number]

/** Bucket chegarasi bilan bir xil (`storage.buckets.photos.file_size_limit`). */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024

/** Rasm yo'li formati — `photos_insert` siyosati va `b_photo_path` trigger bilan bir xil. */
const PHOTO_PATH_RE = /^([0-9a-f-]{36})\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/

/** Yozuvni o'zgartira oladigan (xeshni so'ray oladigan) rollar — muallifdan tashqari. */
export const PHOTO_HASH_ADMIN_ROLES: readonly string[] = ['admin', 'super_admin']

/** Foydalanuvchi rejimi chegarasi: profil bo'yicha 10 daqiqada 30 ta. */
export const USER_RATE_LIMIT_MAX = 30
export const USER_RATE_LIMIT_WINDOW_MS = 10 * 60_000

/** Sweep: bitta claim'dagi ishlar soni va umumiy vaqt byudjeti. */
export const SWEEP_CLAIM_LIMIT = 20
export const SWEEP_TIME_BUDGET_MS = 40_000
/** Sweep: bitta chaqiruvda ko'pi bilan shuncha claim (cheksiz sikl bo'lmasin). */
export const SWEEP_MAX_ROUNDS = 10

export function createUserLimiter(): SlidingWindowLimiter {
  return new SlidingWindowLimiter(USER_RATE_LIMIT_MAX, USER_RATE_LIMIT_WINDOW_MS)
}

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

export type DownloadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'not_found' | 'too_large' | 'forbidden' }

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
  /**
   * `svc_set_photo_hash(p_table, p_id, p_sha256, p_expected_path)` — yo'l o'zgargan / yozuv o'chirilgan
   * bo'lsa `stored: false`. hint `photo_hash_invalid` / `photo_sha256_invalid` → invalid.
   */
  setPhotoHash: (table: PhotoTable, id: string, sha256: string, expectedPath: string) => Promise<SetHashResult>
  /** Shu firmada shu xesh boshqa tirik yozuvda (movements yoki purchases) bormi. */
  hasDuplicate: (companyId: string, table: PhotoTable, id: string, sha256: string) => Promise<boolean>
  /** Profil bo'yicha chegara (index.ts — izolyat bo'yicha bitta nusxa). Yo'q — chegarasiz. */
  limiter?: SlidingWindowLimiter
  /** ms (Date.now). */
  now?: () => number
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

const err = (status: number, error: string, extra: Record<string, unknown> = {}): HandlerResult =>
  respond(status, { error, ...extra })

/** So'rov sweep rejimidami (`{"mode":"sweep"}`). */
export function isSweepRequest(body: unknown): boolean {
  return isRecord(body) && body.mode === 'sweep'
}

/**
 * Foydalanuvchi rejimi. So'rov: `POST { table: 'movements' | 'purchases', id: uuid }`,
 * `Authorization: Bearer <user JWT>`. Javoblar:
 * - 200 `{ sha256, duplicate }` — xesh yozildi; `duplicate` — shu firmada shu rasm boshqa yozuvda bor
 *   (baza `takroriy_yozuv` alertini o'zi yaratadi)
 * - 400 `invalid_request` (body), `photo_path_invalid` (yo'l formati / boshqa firma papkasi),
 *   `photo_too_large` (> 5 MB), `photo_hash_invalid` (RPC rad etdi)
 * - 401 `unauthorized`; 403 `forbidden` (faol profil yo'q, boshqa firma, muallif ham admin ham emas)
 * - 404 `not_found` (yozuv yo'q / o'chirilgan / shu orada rasm almashtirildi),
 *   `photo_not_found` (yozuvda rasm yo'q yoki faylning o'zi yo'q)
 * - 429 `rate_limited` + `retry_after_sec` — profil 10 daqiqada 30 tadan ko'p so'radi
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

    if (deps.limiter !== undefined) {
      const lim = deps.limiter.hit(caller.id, (deps.now ?? Date.now)())
      if (!lim.ok) {
        deps.log('warn', 'photo-hash: chegara oshdi', { profile_id: caller.id })
        return err(429, 'rate_limited', { retry_after_sec: lim.retryAfterSec })
      }
    }

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
    if (!file.ok) {
      if (file.reason === 'too_large') return err(400, 'photo_too_large')
      return err(404, 'photo_not_found')
    }
    if (file.bytes.byteLength > MAX_PHOTO_BYTES) return err(400, 'photo_too_large')

    const sha256 = await sha256Hex(file.bytes)
    // p_expected_path: o'qilgan yo'l — shu orada rasm almashtirilgan bo'lsa eski xesh yangi rasmga yozilmaydi
    const set = await deps.setPhotoHash(table, id, sha256, row.path)
    if (!set.ok) return err(400, 'photo_hash_invalid')
    // stored = false: shu orada yozuv o'chirildi yoki rasm almashtirildi / olib tashlandi
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

// ---------------------------------------------------------------------------
// Sweep rejimi (baza uyg'otadi: pg_net + x-photo-secret)
// ---------------------------------------------------------------------------

export interface PhotoJob {
  job_id: string
  company_id: string
  table_name: string
  record_id: string
  photo_path: string
  attempts: number
}

export interface SweepDeps {
  /**
   * Kutilgan sir (Vault `photo_hash_secret`). `refresh = true` — keshni yangilashga urinish
   * (index.ts ko'pi bilan 30 s da bir marta). Sozlanmagan bo'lsa null.
   */
  getSweepSecret: (refresh: boolean) => Promise<string | null>
  /** `svc_claim_photo_hash_jobs(limit)` */
  claimJobs: (limit: number) => Promise<PhotoJob[]>
  /** `photos` bucket'dan o'qish. Vaqtinchalik xato — throw. */
  downloadPhoto: (path: string) => Promise<DownloadResult>
  /** `svc_complete_photo_hash_job(p_job_id, p_sha256, p_error, p_final)` → done | stale | pending | failed | null */
  completeJob: (jobId: string, sha256: string | null, error: string | null, final: boolean) => Promise<string | null>
  now: () => number
  log: LogFn
}

export interface SweepSummary {
  claimed: number
  done: number
  stale: number
  retry: number
  failed: number
}

export type SweepAuth = { ok: false; result: HandlerResult } | { ok: true }

/** `x-photo-secret` ni doimiy vaqtda tekshiradi (tg-dispatch kabi: mos kelmasa keshni bir marta yangilaydi). */
export async function authorizeSweep(secretHeader: string | null, deps: SweepDeps): Promise<SweepAuth> {
  if (typeof secretHeader !== 'string' || secretHeader === '') {
    deps.log('warn', "photo-hash: sweep siri yo'q")
    return { ok: false, result: err(401, 'unauthorized') }
  }
  let expected: string | null
  try {
    expected = await deps.getSweepSecret(false)
    if (typeof expected === 'string' && expected !== '' && !timingSafeEqual(secretHeader, expected)) {
      expected = await deps.getSweepSecret(true)
    }
  } catch (e) {
    deps.log('error', "photo-hash: sweep siri o'qilmadi", { error: errMessage(e) })
    return { ok: false, result: err(500, 'server_error') }
  }
  if (typeof expected !== 'string' || expected === '') {
    deps.log('error', 'photo-hash: photo_hash_secret sozlanmagan')
    return { ok: false, result: err(500, 'server_misconfigured') }
  }
  if (!timingSafeEqual(secretHeader, expected)) {
    deps.log('warn', "photo-hash: sweep siri noto'g'ri")
    return { ok: false, result: err(401, 'unauthorized') }
  }
  return { ok: true }
}

/** Yuklab olish natijasi → (xato matni, doimiymi). Fayl yo'q / ruxsat yo'q / katta — doimiy. */
export function classifyDownloadError(r: Exclude<DownloadResult, { ok: true }>): { error: string; final: boolean } {
  return { error: `photo_${r.reason}`, final: true }
}

/** Ishlarni navbatdan olib bajaradi (byudjet ichida). Natija — log va sinxron javob uchun. */
export async function runSweep(deps: SweepDeps): Promise<SweepSummary> {
  const startedAt = deps.now()
  const summary: SweepSummary = { claimed: 0, done: 0, stale: 0, retry: 0, failed: 0 }
  const overBudget = () => deps.now() - startedAt > SWEEP_TIME_BUDGET_MS

  const complete = async (job: PhotoJob, sha: string | null, error: string | null, final: boolean) => {
    let status: string | null
    try {
      status = await deps.completeJob(job.job_id, sha, error, final)
    } catch (e) {
      // Ish 'sending' da qoladi — 10 daqiqadan keyin qayta olinadi.
      deps.log('error', 'photo-hash: ish yakunlanmadi', { job_id: job.job_id, error: errMessage(e) })
      summary.retry++
      return
    }
    if (status === 'done') summary.done++
    else if (status === 'stale') summary.stale++
    else if (status === 'failed') summary.failed++
    else summary.retry++
  }

  for (let round = 0; round < SWEEP_MAX_ROUNDS && !overBudget(); round++) {
    let jobs: PhotoJob[]
    try {
      jobs = await deps.claimJobs(SWEEP_CLAIM_LIMIT)
    } catch (e) {
      deps.log('error', "photo-hash: navbat o'qilmadi", { error: errMessage(e) })
      break
    }
    if (jobs.length === 0) break
    summary.claimed += jobs.length

    for (const job of jobs) {
      if (overBudget()) {
        // Byudjet tugadi — vaqtinchalik xato sifatida qaytariladi (2^attempts daqiqadan keyin).
        await complete(job, null, 'time_budget', false)
        continue
      }
      if (!photoPathAllowed(job.photo_path, job.company_id)) {
        await complete(job, null, 'photo_path_invalid', true)
        continue
      }
      let file: DownloadResult
      try {
        file = await deps.downloadPhoto(job.photo_path)
      } catch (e) {
        await complete(job, null, `download: ${errMessage(e)}`.slice(0, 300), false)
        continue
      }
      if (!file.ok) {
        const c = classifyDownloadError(file)
        await complete(job, null, c.error, c.final)
        continue
      }
      if (file.bytes.byteLength > MAX_PHOTO_BYTES) {
        await complete(job, null, 'photo_too_large', true)
        continue
      }
      let sha: string
      try {
        sha = await sha256Hex(file.bytes)
      } catch (e) {
        await complete(job, null, `sha256: ${errMessage(e)}`.slice(0, 300), false)
        continue
      }
      await complete(job, sha, null, false)
    }
  }

  if (summary.claimed > 0) deps.log('info', 'photo-hash: sweep tugadi', { ...summary })
  return summary
}
