import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { listCompanies, type CompanyRow } from '@/data/companiesRepo'
import { setCompanyScope } from '@/data/companyScope'
import { useAuth } from './authContext'
import {
  ActiveCompanyContext,
  readStoredCompany,
  resolveActiveCompany,
  writeStoredCompany,
  type ActiveCompanyState,
} from './activeCompany'

/**
 * Veb panel: faol firma. super_admin — tanlangan firma (localStorage'da saqlanadi, standart — o'z firmasi),
 * ro'yxat so'rovlari shu firma bo'yicha filtrlanadi (`setCompanyScope`). Boshqa rollar — o'z firmasi, filtr yo'q.
 */
export function ActiveCompanyProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const isSuper = profile?.role === 'super_admin'
  const profileId = profile?.id ?? null
  const own = profile?.company_id ?? ''
  const [stored, setStored] = useState<{ profileId: string | null; companyId: string | null }>(() => ({
    profileId,
    companyId: isSuper && profileId ? readStoredCompany(profileId) : null,
  }))
  const [companies, setCompanies] = useState<CompanyRow[] | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Boshqa foydalanuvchi kirdi — uning saqlangan tanlovi
  const current = stored.profileId === profileId ? stored.companyId : isSuper && profileId ? readStoredCompany(profileId) : null
  const companyId = isSuper ? resolveActiveCompany(current, own, companies) : own

  // Render paytida (bolalar effektlaridan oldin): ro'yxat so'rovlari birinchi yuklanishdayoq to'g'ri firma
  // bo'yicha. Qiymat idempotent — qayta render xavfsiz. Effekt cleanup'ida tozalanmaydi: React avval barcha
  // cleanup'larni, keyin bolalar effektlarini ishga tushiradi — oraliqda so'rov filtrsiz ketib qolardi.
  // Keyingi kirishda (boshqa foydalanuvchi) provider qiymatni qayta o'rnatadi.
  setCompanyScope(isSuper && companyId ? companyId : null)

  useEffect(() => {
    if (!isSuper) return
    let alive = true
    listCompanies()
      .then((list) => alive && setCompanies(list))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [isSuper, reloadKey])

  const setCompanyId = useCallback(
    (id: string) => {
      if (!isSuper || !profileId) return
      writeStoredCompany(profileId, id)
      setStored({ profileId, companyId: id })
    },
    [isSuper, profileId],
  )
  const reloadCompanies = useCallback(() => setReloadKey((k) => k + 1), [])

  const value = useMemo<ActiveCompanyState>(
    () => ({ companyId, canSwitch: isSuper, companies: companies ?? [], setCompanyId, reloadCompanies }),
    [companyId, isSuper, companies, setCompanyId, reloadCompanies],
  )

  return <ActiveCompanyContext.Provider value={value}>{children}</ActiveCompanyContext.Provider>
}
