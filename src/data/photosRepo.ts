import { uuid } from '@/lib/uuid'
import { RepoError, toRepoError, type RepoErrorCode } from './errors'
import { getSupabase } from './supabaseClient'

export const PHOTOS_BUCKET = 'photos'
/** Signed URL amal qilish muddati (soniya) — qisqa: rasm faqat ilova ichida ko'rsatiladi. */
export const SIGNED_URL_TTL = 600

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * Rasm bilan bog'liq xatolar: foydalanuvchiga "Qayta urinish" va "Rasmsiz saqlash" taklif qilinadi.
 * Storage (`photo_*`) va yozuvdagi `photo_path` tekshiruvlari (`ops_photo_*`).
 */
const PHOTO_ERROR_CODES: readonly RepoErrorCode[] = [
  'photo_too_large',
  'photo_type',
  'photo_upload_failed',
  'ops_photo_path_company',
  'ops_photo_path_format',
  'ops_photo_not_owned',
  'ops_photo_reused',
]

export function isPhotoError(error: unknown): boolean {
  return error instanceof RepoError && PHOTO_ERROR_CODES.includes(error.code)
}

/** `{company_id}/{yyyy}/{mm}/{uuid}.{ext}` — kichik harf, oy Asia/Tashkent bo'yicha. */
export function photoPath(companyId: string, contentType: string, now: Date = new Date()): string {
  const p: Record<string, string> = {}
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' }).formatToParts(now)) {
    p[x.type] = x.value
  }
  const ext = EXT_BY_TYPE[contentType] ?? 'jpg'
  return `${companyId.toLowerCase()}/${p.year}/${p.month}/${uuid()}.${ext}`
}

interface StorageLikeError {
  statusCode?: string | number
  status?: number
  message?: string
}

/** Storage xatosi → aniq kod. RLS rad etishi — `forbidden`. */
export function toPhotoError(error: unknown): RepoError {
  const e = (error ?? {}) as StorageLikeError
  const status = Number(e.statusCode ?? e.status)
  const msg = e.message ?? ''
  if (status === 413 || /exceed|too large|maximum allowed size|payload/i.test(msg)) {
    return new RepoError('photo_too_large', msg)
  }
  if (status === 415 || /mime|content type|not supported/i.test(msg)) return new RepoError('photo_type', msg)
  if (status === 403 || /row-level security|policy/i.test(msg)) return new RepoError('forbidden', msg)
  return new RepoError('photo_upload_failed', msg)
}

/** Rasmni private `photos` bucket'ga yuklaydi (har safar yangi yo'l, `upsert: false`). */
export async function uploadPhoto(file: Blob, companyId: string): Promise<string> {
  // contentType — faqat haqiqiy tur; ruxsat etilmagan tur yuborilmaydi
  if (!EXT_BY_TYPE[file.type]) throw new RepoError('photo_type')
  const path = photoPath(companyId, file.type)
  let result: { error: unknown }
  try {
    result = await getSupabase().storage.from(PHOTOS_BUCKET).upload(path, file, { upsert: false, contentType: file.type })
  } catch (err) {
    throw toPhotoError(err)
  }
  if (result.error) throw toPhotoError(result.error)
  return path
}

/** Ko'rsatish uchun vaqtinchalik havola. */
export async function signedPhotoUrl(path: string): Promise<string> {
  const { data, error } = await getSupabase().storage.from(PHOTOS_BUCKET).createSignedUrl(path, SIGNED_URL_TTL)
  if (error || !data) throw toRepoError(error)
  return data.signedUrl
}
