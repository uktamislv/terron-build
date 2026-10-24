import { isSupabaseConfigured } from './supabaseClient'

export interface SystemStatus {
  supabaseConfigured: boolean
}

export function getSystemStatus(): SystemStatus {
  return { supabaseConfigured: isSupabaseConfigured() }
}
