// Batch 12 (J): Telegram xabaridagi "Ochish" tugmasi → Mini App `?alert=<id>` (yoki start_param
// `alert_<id>`). Bosh ekran tepasida shu ogohlantirish (faqat ko'rish) — direktor, admin.
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Building2, Package, X } from 'lucide-react'
import { Badge, Notice, RetryNotice, SkeletonRows } from '@/components/ui'
import { getAlertById } from '@/data/alertsRepo'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { useLoad } from '@/lib/useLoad'
import { alertDetailText } from '@/web/alerts/alertDetails'
import { SEVERITY_TONE, STATUS_TONE } from '@/web/alerts/alertTones'
import { AlertTypeIcon } from '@/web/alerts/AlertTypeIcon'
import { getWebApp } from '../telegram'
import { alertIdFrom, alertLinkMode } from './alertLink'

const ta = t.tg.auto
const tx = t.alertTexts

function startParam(): string | null {
  // Faqat yo'naltirish uchun (initDataUnsafe — ishonchli emas; ma'lumot RLS bilan o'qiladi)
  const app = getWebApp() as unknown as { initDataUnsafe?: { start_param?: string } } | null
  return app?.initDataUnsafe?.start_param ?? null
}

export function AlertDeepLink({ role }: { role: Role }) {
  const [params, setParams] = useSearchParams()
  // Yopilgan ogohlantirish id'si — boshqa ogohlantirish ochilsa yana ko'rinadi
  const [dismissedId, setDismissedId] = useState<string | null>(null)
  const mode = alertLinkMode(role)
  const linked = mode ? alertIdFrom(params, startParam()) : null
  const id = linked !== dismissedId ? linked : null
  const alert = useLoad(() => getAlertById(id ?? ''), id ?? '', id !== null)
  const ref = useRef<HTMLElement>(null)
  // Ro'yxatdan bosilganda — kartochka ko'rinadigan joyga (ekran tepasi)
  useEffect(() => {
    if (id) ref.current?.scrollIntoView?.({ block: 'start' })
  }, [id])
  if (!id) return null
  // Obyekt a'zosi: RLS ko'rsatmagan yoki xato — jimgina (oddiy bosh ekran)
  if (mode === 'site' && (alert.loading || alert.error || !alert.data)) return null

  const close = () => {
    setDismissedId(id)
    if (params.has('alert')) {
      const next = new URLSearchParams(params)
      next.delete('alert')
      setParams(next, { replace: true })
    }
  }

  const a = alert.data
  return (
    <section ref={ref} aria-label={ta.alertTitle} data-testid="alert-deeplink" className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-4">
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
      {alert.error && <RetryNotice message={alert.error} onRetry={alert.reload} />}
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
