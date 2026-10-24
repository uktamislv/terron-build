import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Faqat anon (public) kalit. service_role kaliti frontendga hech qachon tushmaydi.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

let client: SupabaseClient | null = null

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey)
}

/** Supabase klienti. Faqat src/data/ ichidagi repository fayllari chaqiradi. */
export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error('VITE_SUPABASE_URL va VITE_SUPABASE_ANON_KEY .env faylida berilmagan')
  }
  client ??= createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  })
  return client
}
