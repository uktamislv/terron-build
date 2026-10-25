import { useEffect, useState } from 'react'
import { DEFAULT_COMPANY_SETTINGS, getCompanySettings, type CompanySettings } from '@/data/companiesRepo'

function stripUndefined(s: Partial<CompanySettings>): Partial<CompanySettings> {
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as Partial<CompanySettings>
}

/** Firma sozlamalari (o'qilmasa — standart qiymatlar; server baribir tekshiradi). */
export function useCompanySettings(companyId: string | undefined): CompanySettings {
  const [settings, setSettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS)
  useEffect(() => {
    if (!companyId) return
    let alive = true
    Promise.resolve()
      .then(() => getCompanySettings(companyId))
      .then((s) => {
        // Yetishmagan maydon (eski javob) — standart qiymat
        if (alive && s) setSettings({ ...DEFAULT_COMPANY_SETTINGS, ...stripUndefined(s) })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [companyId])
  return settings
}
