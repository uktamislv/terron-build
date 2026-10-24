import { StatusBadge } from '@/components/StatusBadge'
import { getSystemStatus } from '@/data/systemRepo'
import { t } from '@/i18n'
import { formatDate } from '@/lib/format'

export function DashboardPage() {
  const status = getSystemStatus()

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">{t.web.welcome}</h1>
        <p className="mt-1 text-slate-600">
          {formatDate(new Date())} · {t.web.batchNote}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-5">
        <span className="font-medium">{t.status.supabase}</span>
        {status.supabaseConfigured ? (
          <StatusBadge tone="ok">{t.status.configured}</StatusBadge>
        ) : (
          <StatusBadge tone="warn">{t.status.notConfigured}</StatusBadge>
        )}
      </div>
    </div>
  )
}
