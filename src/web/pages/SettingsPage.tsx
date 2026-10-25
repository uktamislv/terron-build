import { Settings } from 'lucide-react'
import { useAuth } from '@/auth/authContext'
import { PageHeader } from '@/components/ui'
import { t } from '@/i18n'
import { CompanySettingsForm } from '../settings/CompanySettingsForm'

/**
 * Firma sozlamalari sahifasi (admin). Hozircha yon menyudagi "Sozlamalar" tugmasi orqali modal
 * sifatida ochiladi; `/settings` marshruti qo'shilsa — shu komponent ishlatiladi.
 */
export function SettingsPage() {
  const { profile } = useAuth()
  if (!profile) return null
  const canEdit = profile.role === 'admin' || profile.role === 'super_admin'
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title={t.settings.title} icon={<Settings strokeWidth={1.75} />} />
      <CompanySettingsForm companyId={profile.company_id} canEdit={canEdit} />
    </div>
  )
}
