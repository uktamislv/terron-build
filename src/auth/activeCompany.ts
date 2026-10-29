// Faol firma (veb panel): super_admin firmalar orasida almashadi, boshqalar uchun — doim o'z firmasi.
// Ro'yxat so'rovlari `src/data/companyScope.ts` orqali shu firma bo'yicha filtrlanadi; yangi yozuvlar
// (`company_id`) ham shu firmaga yoziladi. Xavfsizlik emas — himoya RLS'da.
import { createContext, useContext } from 'react'
import type { CompanyRow } from '@/data/companiesRepo'
import { useAuth } from './authContext'

export interface ActiveCompanyState {
  /** Faol firma id'si (super_admin — tanlangan, boshqalar — o'z firmasi). */
  companyId: string
  /** Faqat super_admin: tanlash mumkin. */
  canSwitch: boolean
  /** super_admin uchun firmalar ro'yxati (yuklanmagan yoki boshqa rol — bo'sh). */
  companies: CompanyRow[]
  setCompanyId(id: string): void
  /** Firma qo'shilgandan / nomi o'zgargandan keyin ro'yxatni yangilash. */
  reloadCompanies(): void
}

export const ActiveCompanyContext = createContext<ActiveCompanyState | null>(null)

/** Faol firma holati; provider tashqarisida (masalan Telegram ilovasi) — o'z firmasi, almashtirib bo'lmaydi. */
export function useActiveCompany(): ActiveCompanyState | null {
  return useContext(ActiveCompanyContext)
}

/** Yangi yozuv va firma sozlamalari uchun firma id'si: faol firma, bo'lmasa — profil firmasi. */
export function useCompanyId(): string | undefined {
  const ctx = useContext(ActiveCompanyContext)
  const { profile } = useAuth()
  return ctx?.companyId ?? profile?.company_id
}

const STORAGE_PREFIX = 'terron.activeCompany:'

/** localStorage kaliti — har bir profil uchun alohida. */
export function activeCompanyStorageKey(profileId: string): string {
  return STORAGE_PREFIX + profileId
}

export function readStoredCompany(profileId: string): string | null {
  try {
    return window.localStorage.getItem(activeCompanyStorageKey(profileId))
  } catch {
    return null
  }
}

export function writeStoredCompany(profileId: string, companyId: string): void {
  try {
    window.localStorage.setItem(activeCompanyStorageKey(profileId), companyId)
  } catch {
    // Saqlab bo'lmadi (maxfiy rejim) — faqat shu sessiya uchun
  }
}

/**
 * Tanlangan firmani tekshirish: ro'yxat yuklangan bo'lsa va tanlangan firma unda yo'q bo'lsa — o'z firmasi.
 * Ro'yxat hali yuklanmagan (null) — saqlangan qiymatga ishoniladi (RLS baribir himoya qiladi).
 */
export function resolveActiveCompany(stored: string | null, own: string, companies: readonly CompanyRow[] | null): string {
  if (!stored) return own
  if (companies && !companies.some((c) => c.id === stored)) return own
  return stored
}
