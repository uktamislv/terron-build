import { StatusBadge } from '@/components/StatusBadge'
import { t } from '@/i18n'
import { formatDate } from '@/lib/format'
import { getWebApp } from '../telegram'

export function TgHomePage() {
  const app = getWebApp()
  // Faqat salomlashish uchun — bu qiymatga hech qachon ishonilmaydi
  const firstName = app?.initDataUnsafe.user?.first_name

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl bg-brand p-5 text-white">
        <p className="text-sm opacity-80">{formatDate(new Date())}</p>
        <h1 className="mt-1 text-xl font-semibold">
          {t.tg.hello}
          {firstName ? `, ${firstName}` : ''}!
        </h1>
        <p className="mt-1 text-sm opacity-90">{t.app.tagline}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 p-4">
        <span className="text-sm font-medium">{t.status.telegram}</span>
        {app ? (
          <StatusBadge tone="ok">{t.status.insideTelegram}</StatusBadge>
        ) : (
          <StatusBadge tone="warn">{t.status.outsideTelegram}</StatusBadge>
        )}
      </div>
    </div>
  )
}
