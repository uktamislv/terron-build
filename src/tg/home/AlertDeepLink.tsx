// Batch 12 (J): Telegram xabaridagi "Ochish" tugmasi → Mini App `?alert=<id>` (yoki start_param
// `alert_<id>`). Bosh ekran tepasida shu ogohlantirish (faqat ko'rish) — direktor, admin.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, Package, X } from 'lucide-react'
import { Badge, Notice, SkeletonRows } from '@/components/ui'
import { getAlertById } from '@/data/alertsRepo'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { useLoad } from '@/lib/useLoad'
import { alertDetailText } from '@/web/alerts/alertDetails'
import { SEVERITY_TONE, STATUS_TONE } from '@/web/alerts/alertTones'
import { AlertTypeIcon } from '@/web/alerts/AlertTypeIcon'
import { getWebApp } from '../telegram'
import { ALERT_LINK_ROLES, alertIdFrom } from './alertLink'

const ta = t.tg.auto
const tx = t.alertTexts

function startParam(): string | null {
  // Faqat yo'naltirish uchun (initDataUnsafe — ishonchli emas; ma'lumot RLS bilan o'qiladi)
  const app = getWebApp() as unknown as { initDataUnsafe?: { start_param?: string } } | null
  return app?.initDataUnsafe?.start_param ?? null
}

export function AlertDeepLink({ role }: { role: Role }) {
  const [params, setParams] = useSearchParams()
  const [dismissed, setDismissed] = useState(false)
  const id = ALERT_LINK_ROLES.includes(role) && !dismissed ? alertIdFrom(params, startParam()) : null
  const alert = useLoad(() => getAlertById(id ?? ''), id ?? '', id !== null)
  if (!id) return null

  const close = () => {
    setDismissed(true)
    if (params.has('alert')) {
      const next = new URLSearchParams(params)
      next.delete('alert')
      setParams(next, { replace: true })
    }
  }

  const a = alert.data
  return (
    <section aria-label={ta.alertTitle} data-testid="alert-deeplink" className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-4">
      <div className="flex items-start gap-3">
        {a && (
          <span aria-hidden className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-ice text-navy">
            <AlertTypeIcon type={a.type} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-ink">{a ? tx.types[a.type] : ta.alertTitle}</p>
          {a && <p className="tabular text-xs text-muted">{formatDateTime(a.created_at)}</p>}
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={ta.alertClose}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-canvas"
        >
          <X aria-hidden className="size-5" strokeWidth={2} />
        </button>
      </div>
      {alert.loading && <SkeletonRows rows={1} />}
      {alert.error && <Notice>{alert.error}</Notice>}
      {!alert.loading && !alert.error && !a && <Notice tone="warn">{ta.alertNotFound}</Notice>}
      {a && (
        <>
          <div className="flex flex-wrap gap-2">
            <Badge tone={SEVERITY_TONE[a.severity]}>{tx.severities[a.severity]}</Badge>
            <Badge tone={STATUS_TONE[a.status]}>{tx.statuses[a.status]}</Badge>
          </div>
          <p className="text-sm text-ink">{alertDetailText(a)}</p>
          {(a.object_name || a.material_name) && (
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
              {a.object_name && (
                <span className="inline-flex items-center gap-1">
                  <Building2 aria-hidden className="size-4" strokeWidth={1.75} />
                  {a.object_name}
                </span>
              )}
              {a.material_name && (
                <span className="inline-flex items-center gap-1">
                  <Package aria-hidden className="size-4" strokeWidth={1.75} />
                  {a.material_name}
                </span>
              )}
            </p>
          )}
        </>
      )}
    </section>
  )
}
