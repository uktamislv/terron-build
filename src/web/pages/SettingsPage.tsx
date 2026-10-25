import { useSearchParams } from 'react-router-dom'
import { Bug, Building2, Settings } from 'lucide-react'
import { useAuth } from '@/auth/authContext'
import { PageHeader, Tabs, type TabItem } from '@/components/ui'
import { t } from '@/i18n'
import { BugReportsList } from '../settings/BugReportsList'
import { CompanySettingsForm } from '../settings/CompanySettingsForm'

type SettingsTab = 'company' | 'bugs'

const ts = t.settings
const icon = { className: 'size-[18px]', strokeWidth: 1.75, 'aria-hidden': true } as const

/**
 * Sozlamalar sahifasi (`/settings`, admin va super_admin — Batch 11): firma sozlamalari va
 * xatolik xabarlari. Bo'lim URL'da (`?tab=bugs`) — havola orqali to'g'ridan-to'g'ri ochiladi.
 */
export function SettingsPage() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  if (!profile) return null
  const canEdit = profile.role === 'admin' || profile.role === 'super_admin'
  const tab: SettingsTab = params.get('tab') === 'bugs' ? 'bugs' : 'company'
  const items: TabItem<SettingsTab>[] = [
    { key: 'company', label: ts.tabCompany, icon: <Building2 {...icon} /> },
    { key: 'bugs', label: ts.tabBugs, icon: <Bug {...icon} /> },
  ]
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title={ts.title} icon={<Settings strokeWidth={1.75} />} />
      <Tabs
        label={ts.tabsLabel}
        items={items}
        value={tab}
        onChange={(next) => setParams(next === 'bugs' ? { tab: 'bugs' } : {}, { replace: true })}
      />
      {tab === 'company' ? <CompanySettingsForm companyId={profile.company_id} canEdit={canEdit} /> : <BugReportsList />}
    </div>
  )
}
