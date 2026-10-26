// Sozlamalar → "Telegram holati" (admin): notification_health() — oxirgi yuborilgan xabar,
// tiqilib qolganlar, 7 kunlik xatolar, oxirgi xatolar va botni bloklaganlar.
import { useState } from 'react'
import { BellOff, CircleAlert, CircleCheck, RefreshCw, RotateCcw, Send, TriangleAlert } from 'lucide-react'
import { Badge, Button, Card, cx, Notice, RetryNotice, SkeletonRows, StatTile, useToast } from '@/components/ui'
import { getNotificationHealth, resetChatBlocked } from '@/data/companiesRepo'
import { isRole } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDateTime } from '@/lib/format'
import { useLoad } from '@/lib/useLoad'
import { healthLevel, kindLabel, needsSetupHint, statusLabel } from './telegramHealth'

const th = t.settings.health

export function TelegramHealthCard() {
  const health = useLoad(getNotificationHealth, 'notification-health')
  const h = health.data
  const level = h ? healthLevel(h) : null
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const recheck = async (profileId: string, name: string) => {
    setBusyId(profileId)
    try {
      const cleared = await resetChatBlocked(profileId)
      toast.show(cleared ? th.recheckDone(name) : th.recheckAlready(name), 'ok')
      health.reload()
    } catch (err) {
      toast.show(errorText(err), 'danger')
    } finally {
      setBusyId(null)
    }
  }
  return (
    <Card
      title={th.title}
      actions={
        <Button variant="ghost" icon={<RefreshCw aria-hidden className="size-4" strokeWidth={1.75} />} onClick={health.reload}>
          {th.refresh}
        </Button>
      }
      bodyClassName="flex flex-col gap-4 p-4 md:p-5"
    >
      <p className="text-sm text-muted">{th.intro}</p>
      {health.loading && <SkeletonRows rows={3} />}
      {health.error && <RetryNotice message={health.error} onRetry={health.reload} />}
      {h && level && (
        <>
          <Notice tone={level === 'ok' ? 'ok' : level}>
            <span data-testid="telegram-health" data-level={level}>
              {level === 'ok' ? th.ok : th.problem}
            </span>
            {needsSetupHint(h) && <span className="mt-1 block">{th.fixHint}</span>}
          </Notice>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              icon={<Send strokeWidth={1.75} />}
              label={th.lastSent}
              value={<span className="text-base">{h.lastSentAt ? formatDateTime(h.lastSentAt) : th.never}</span>}
            />
            <StatTile
              icon={<TriangleAlert strokeWidth={1.75} />}
              label={th.stuck}
              value={h.stuckPendingCount}
              tone={h.stuckPendingCount > 0 ? 'danger' : 'ok'}
            />
            <StatTile
              icon={<CircleAlert strokeWidth={1.75} />}
              label={th.failed7d}
              value={h.failed7dCount}
              tone={h.failed7dCount > 0 ? 'warn' : 'ok'}
            />
          </div>
          <section aria-label={th.lastErrors} className="flex flex-col gap-2">
            <h3 className="text-base font-semibold text-ink">{th.lastErrors}</h3>
            {h.lastErrors.length === 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-ok">
                <CircleCheck aria-hidden className="size-4" strokeWidth={2} />
                {th.noErrors}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
                {h.lastErrors.map((e) => (
                  <li key={e.id} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{kindLabel(e.kind)}</span>
                      <Badge tone={e.status === 'failed' ? 'danger' : 'warn'}>{statusLabel(e.status)}</Badge>
                      <span className="text-xs text-muted">{th.attempts(e.attempts)}</span>
                      {e.updatedAt && <span className="tabular text-xs text-muted">{formatDateTime(e.updatedAt)}</span>}
                    </span>
                    {e.lastError && <span className="break-words text-muted">{e.lastError}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label={th.blocked} className="flex flex-col gap-2">
            <h3 className="text-base font-semibold text-ink">{th.blocked}</h3>
            {h.blockedProfiles.length === 0 ? (
              <p className="text-sm text-muted">{th.noBlocked}</p>
            ) : (
              <>
                <ul className="flex flex-col gap-1.5">
                  {h.blockedProfiles.map((p) => (
                    <li key={p.profileId} className={cx('flex flex-wrap items-center gap-2 text-sm text-ink')}>
                      <BellOff aria-hidden className="size-4 text-warn" strokeWidth={1.75} />
                      <span className="font-medium">{p.fullName}</span>
                      {isRole(p.role) && <Badge tone="neutral">{t.roles[p.role]}</Badge>}
                      {p.blockedAt && <span className="tabular text-xs text-muted">{th.blockedAt(formatDateTime(p.blockedAt))}</span>}
                      <Button
                        variant="ghost"
                        className="ml-auto"
                        aria-label={th.recheckLabel(p.fullName)}
                        loading={busyId === p.profileId}
                        disabled={busyId !== null}
                        icon={<RotateCcw aria-hidden className="size-4" strokeWidth={1.75} />}
                        onClick={() => void recheck(p.profileId, p.fullName)}
                      >
                        {th.recheck}
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">{th.blockedHint}</p>
              </>
            )}
          </section>
        </>
      )}
    </Card>
  )
}
