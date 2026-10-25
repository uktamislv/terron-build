import { createContext, useContext } from 'react'
import type { AuthSession, Profile } from '@/data/types'

/** Kirish sahifasida ko'rsatiladigan xabar (masalan profil topilmagani uchun chiqarildi). */
export type AuthNotice = 'noAccess' | null

export interface AuthState {
  /** Supabase .env da sozlanganmi */
  configured: boolean
  /** Sessiya yoki profil hali aniqlanmoqda */
  loading: boolean
  session: AuthSession | null
  /** Faol profil; sessiya bo'lsa ham profil topilmasa — null (va sessiya yopiladi) */
  profile: Profile | null
  /** Profilni yuklashda tarmoq/server xatosi (sessiya saqlangan) — reloadProfile bilan qayta */
  profileError: 'network' | null
  notice: AuthNotice
  clearNotice(): void
  signOut(): Promise<void>
  reloadProfile(): void
  /** Sessiyani qayta o'qiydi (masalan Mini App'da tg-auth sessiya o'rnatgandan keyin) */
  refreshSession(): Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth AuthProvider ichida ishlatiladi')
  return value
}
