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
