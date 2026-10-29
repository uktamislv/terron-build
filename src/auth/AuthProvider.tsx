import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as authRepo from '@/data/authRepo'
import { setCompanyScope } from '@/data/companyScope'
import { isConfigured } from '@/data/systemRepo'
import type { AuthSession, Profile } from '@/data/types'
import { AuthContext, type AuthNotice, type AuthState } from './authContext'

interface ProfileState {
  /** Qaysi foydalanuvchi uchun yuklangan */
  userId: string | null
  /** Qaysi so'rov natijasi (reloadProfile uchun) */
  version: number
  profile: Profile | null
  /** Tarmoq/server xatosi — "profil yo'q" emas, sessiya yopilmaydi */
  failed: boolean
}

function sameSession(a: AuthSession | null, b: AuthSession | null): boolean {
  return a?.userId === b?.userId && a?.mustChangePassword === b?.mustChangePassword
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isConfigured()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [sessionReady, setSessionReady] = useState(!configured)
  const [profileState, setProfileState] = useState<ProfileState>({
    userId: null,
    version: -1,
    profile: null,
    failed: false,
  })
  const [version, setVersion] = useState(0)
  const [notice, setNotice] = useState<AuthNotice>(null)

  const applySession = useCallback((next: AuthSession | null) => {
    // Bir xil holat uchun obyektni almashtirmaymiz — profil qayta yuklanmasin
    setSession((prev) => (sameSession(prev, next) ? prev : next))
    setSessionReady(true)
  }, [])

  // 1. Sessiya: boshlang'ich holat + o'zgarishlar
  useEffect(() => {
    if (!configured) return
    let active = true
    const apply = (next: AuthSession | null) => {
      if (active) applySession(next)
    }
    authRepo
      .getSession()
      .then(apply)
      .catch(() => apply(null))
    const unsubscribe = authRepo.onAuthChange(apply)
    return () => {
      active = false
      unsubscribe()
    }
  }, [configured, applySession])

  // 2. Profil: har yangi foydalanuvchi uchun RLS orqali o'qiladi
  const userId = session?.userId ?? null
  useEffect(() => {
    if (!userId) return
    let active = true
    authRepo
      .getMyProfile()
      .then((profile) => {
        if (!active) return
        setProfileState({ userId, version, profile, failed: false })
        if (!profile) {
          // Aniq "profil topilmadi" (nofaol / o'chirilgan / firma nofaol) — sessiyani yopamiz
          setNotice('noAccess')
          void authRepo.signOut().catch(() => undefined)
        }
      })
      .catch(() => {
        // Tarmoq xatosi — sessiya saqlanadi, foydalanuvchi qayta urinadi
        if (active) setProfileState({ userId, version, profile: null, failed: true })
      })
    return () => {
      active = false
    }
  }, [userId, version])

  const profileLoaded = profileState.userId === userId && profileState.version === version
  const profile = userId && profileLoaded ? profileState.profile : null
  const profileError = userId !== null && profileLoaded && profileState.failed ? 'network' : null
  const loading = !sessionReady || (userId !== null && !profileLoaded)

  const signOut = useCallback(async () => {
    setNotice(null)
    // Faol firma filtri (super_admin) keyingi foydalanuvchiga o'tmasin
    setCompanyScope(null)
    await authRepo.signOut()
    setSession(null)
  }, [])
  const clearNotice = useCallback(() => setNotice(null), [])
  const reloadProfile = useCallback(() => setVersion((v) => v + 1), [])
  const refreshSession = useCallback(async () => {
    if (!configured) return
    applySession(await authRepo.getSession().catch(() => null))
  }, [configured, applySession])

  const value = useMemo<AuthState>(
    () => ({
      configured,
      loading,
      // Profili yo'q sessiya tashqariga ko'rsatilmaydi — u yopilmoqda yoki xato holatida
      session: profile ? session : null,
      profile,
      profileError,
      notice,
      clearNotice,
      signOut,
      reloadProfile,
      refreshSession,
    }),
    [configured, loading, session, profile, profileError, notice, clearNotice, signOut, reloadProfile, refreshSession],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
