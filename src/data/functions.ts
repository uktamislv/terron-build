import { FunctionsHttpError } from '@supabase/supabase-js'
import { getSupabase } from './supabaseClient'

export type InvokeResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; body: { error?: string } | null; network: boolean }

async function readJson(response: Response): Promise<{ error?: string } | null> {
  try {
    return (await response.json()) as { error?: string }
  } catch {
    return null
  }
}

/**
 * Edge Function chaqiruvi. 2xx bo'lmagan javobda status va JSON tanasi qaytariladi
 * (supabase-js ularni FunctionsHttpError.context ichida beradi).
 */
export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<InvokeResult<T>> {
  const { data, error } = await getSupabase().functions.invoke<T>(name, { body })
  if (!error) return { ok: true, data: data as T }
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response
    return { ok: false, status: response.status, body: await readJson(response), network: false }
  }
  return { ok: false, status: 0, body: null, network: true }
}

/** `photo-hash` Edge Function javobi: 200 `{ sha256, duplicate? }`. */
export interface PhotoHashResult {
  sha256: string
  duplicate?: boolean
}

export type PhotoHashTable = 'movements' | 'purchases' | 'expenses'

/**
 * Saqlangan yozuv rasmi xeshini serverda hisoblatish (`photo-hash`: Storage'dan o'qiydi va
 * `svc_set_photo_hash` bilan yozadi — takroriy rasm qoidasi shu yerda ishlaydi). Klient xeshi
 * yuborilmaydi (server e'tiborsiz qoldiradi).
 *
 * "Yubor va unut": hech qachon xato tashlamaydi va foydalanuvchini kutdirmaydi — natija faqat
 * test/diagnostika uchun (`null` — xato yoki tarmoq).
 */
export function requestPhotoHash(table: PhotoHashTable, id: string): Promise<PhotoHashResult | null> {
  return invokeFunction<PhotoHashResult>('photo-hash', { table, id })
    .then((res) => (res.ok ? res.data : null))
    .catch(() => null)
}
