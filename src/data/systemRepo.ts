import { isSupabaseConfigured } from './supabaseClient'

export interface SystemStatus {
  supabaseConfigured: boolean
}

export function getSystemStatus(): SystemStatus {
  return { supabaseConfigured: isSupabaseConfigured() }
}

/** Supabase URL va kalit .env da berilganmi (berilmagan bo'lsa ilova yiqilmaydi). */
export function isConfigured(): boolean {
  return isSupabaseConfigured()
}
