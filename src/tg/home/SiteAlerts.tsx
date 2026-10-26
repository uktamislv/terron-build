// Prorab / omborchi bosh ekrani: a'zo obyektlardagi ochiq ogohlantirishlar (docs/audit-fixes.md D3) —
// normadan oshish, manfiy qoldiq, o'tkazma farqi, smetadan ortiq so'rov, smetasiz chiqim. Faqat ko'rish;
// bosilsa — `?alert=<id>` (AlertDeepLink kartochkasi).
import { useSearchParams } from 'react-router-dom'
import { EntryRow, RetryNotice } from '@/components/ui'
import { listSiteAlerts } from '@/data/alertsRepo'
import { t } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { useLoad } from '@/lib/useLoad'
import { alertDetailText } from '@/web/alerts/alertDetails'
import { SEVERITY_ENTRY_KIND } from '@/web/alerts/alertTones'
import { AlertTypeIcon } from '@/web/alerts/AlertTypeIcon'
import { haptic } from '../telegram'
import { SectionTitle } from '../ui'

const SITE_ALERT_LIMIT = 5

export function SiteAlerts({ profileId }: { profileId: string }) {
  const alerts = useLoad(() => listSiteAlerts(SITE_ALERT_LIMIT), profileId)
  const [params, setParams] = useSearchParams()
  // Yuklanmadi — bir qatorli xabar va "Qayta urinish" (muammo yashirilmaydi)
  if (alerts.error)
    return (
      <section aria-label={t.tg.siteAlerts.title} data-testid="site-alerts-error">
        <RetryNotice message={t.tg.siteAlerts.loadError} onRetry={alerts.reload} />
      </section>
    )
  // Bo'sh yoki hali yuklanmoqda — ko'rsatilmaydi
  if (!alerts.data || alerts.data.length === 0) return null
  return (
    <section aria-label={t.tg.siteAlerts.title} className="flex flex-col gap-2" data-testid="site-alerts">
      <SectionTitle>{t.tg.siteAlerts.title}</SectionTitle>
      <p className="text-sm text-muted">{t.tg.siteAlerts.hint}</p>
      <ul className="flex flex-col gap-2">
        {alerts.data.map((a) => (
          <EntryRow
            key={a.id}
            as="li"
            kind={SEVERITY_ENTRY_KIND[a.severity]}
            icon={<AlertTypeIcon type={a.type} />}
            title={t.alertTexts.types[a.type]}
            meta={
              <>
                <span>{alertDetailText(a)}</span>
                {a.object_name && <span>{a.object_name}</span>}
                <span className="tabular">{formatDateTime(a.created_at)}</span>
              </>
            }
            onClick={() => {
              haptic.tap()
              const next = new URLSearchParams(params)
              next.set('alert', a.id)
              setParams(next)
            }}
          />
        ))}
      </ul>
    </section>
  )
}
