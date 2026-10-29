import { useSearchParams } from 'react-router'
import { Bug, Building2, Receipt, Send, Settings } from 'lucide-react'
import { useActiveCompany, useCompanyId } from '@/auth/activeCompany'
import { useAuth } from '@/auth/authContext'
import { PageHeader, Tabs, type TabItem } from '@/components/ui'
import { t } from '@/i18n'
import { BugReportsList } from '../settings/BugReportsList'
import { CompanyNameForm } from '../settings/CompanyNameForm'
import { CompanySettingsForm } from '../settings/CompanySettingsForm'
import { ExpenseCategoriesTab } from '../settings/ExpenseCategoriesTab'
import { TelegramHealthCard } from '../settings/TelegramHealthCard'

type SettingsTab = 'company' | 'expenses' | 'telegram' | 'bugs'

const TABS: readonly SettingsTab[] = ['company', 'expenses', 'telegram', 'bugs']

function isTab(v: string | null): v is SettingsTab {
  return v !== null && (TABS as readonly string[]).includes(v)
}

const ts = t.settings
const icon = { className: 'size-5', strokeWidth: 1.75, 'aria-hidden': true } as const

/**
 * Sozlamalar sahifasi (`/settings`, admin va super_admin — Batch 11): firma sozlamalari va
 * xatolik xabarlari. Bo'lim URL'da (`?tab=bugs`) — havola orqali to'g'ridan-to'g'ri ochiladi.
 */
export function SettingsPage() {
  const { profile } = useAuth()
  // super_admin — faol firma sozlamalari (yon menyudagi tanlagich)
  const companyId = useCompanyId()
  const active = useActiveCompany()
  const [params, setParams] = useSearchParams()
  if (!profile || !companyId) return null
  const canEdit = profile.role === 'admin' || profile.role === 'super_admin'
  const raw = params.get('tab')
  const tab: SettingsTab = isTab(raw) ? raw : 'company'
  const items: TabItem<SettingsTab>[] = [
    { key: 'company', label: ts.tabCompany, icon: <Building2 {...icon} /> },
    { key: 'expenses', label: t.expenses.categories.tab, icon: <Receipt {...icon} /> },
    { key: 'telegram', label: ts.tabTelegram, icon: <Send {...icon} /> },
    { key: 'bugs', label: ts.tabBugs, icon: <Bug {...icon} /> },
  ]
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title={ts.title} icon={<Settings strokeWidth={1.75} />} />
      <Tabs
        label={ts.tabsLabel}
        items={items}
        value={tab}
        onChange={(next) => setParams(next === 'company' ? {} : { tab: next }, { replace: true })}
      />
      {tab === 'company' && (
        <>
          <CompanyNameForm companyId={companyId} canEdit={canEdit} onSaved={active?.reloadCompanies} />
          <CompanySettingsForm companyId={companyId} canEdit={canEdit} />
        </>
      )}
      {tab === 'expenses' && <ExpenseCategoriesTab companyId={companyId} canEdit={canEdit} />}
      {tab === 'telegram' && <TelegramHealthCard />}
      {tab === 'bugs' && <BugReportsList />}
    </div>
  )
}
