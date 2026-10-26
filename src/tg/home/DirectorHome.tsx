// Mini App direktor bosh ekrani (faqat ko'rish): bugun / 7 kun, kartochkalar, smeta ishlatilishi,
// oxirgi 10 ogohlantirish. Ma'lumot — veb bilan umumiy repo'lar (RLS).
import { useCallback, useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, ShoppingCart, TriangleAlert } from 'lucide-react'
import {
  Badge,
  cx,
  EntryRow,
  type EntryKind,
  LevelBar,
  Money,
  RetryNotice,
  SegmentedControl,
  SkeletonRows,
  SkeletonTiles,
  StatTile,
} from '@/components/ui'
import { listRecentAlerts } from '@/data/alertsRepo'
import { getDashboardSummary, getNormOverview, type DashboardSummary } from '@/data/reportsRepo'
import type { Alert, AlertSeverity } from '@/data/types'
import { periodRange } from '@/domain/reports'
import { t } from '@/i18n'
import { formatDateTime, formatQty, tashkentIsoDate } from '@/lib/format'
import { useLoad, type Loaded } from '@/lib/useLoad'
import { alertDetailText } from '@/web/alerts/alertDetails'
import { SEVERITY_TONE } from '@/web/alerts/alertTones'
import { haptic } from '../telegram'
import { BackLink, SectionTitle } from '../ui'
import { useBackButton } from '../useTelegramButtons'
import { Greeting } from './Greeting'
import { objectUsage, type ObjectUsage } from './usage'

const tt = t.reports.tg
export type DirectorPeriod = 'today' | 'last7'

const SEVERITY_KIND: Record<AlertSeverity, EntryKind> = {
  belgi: 'neutral',
  ogohlantirish: 'warn',
  jiddiy: 'danger',
}

/** Foiz (Dec) — faqat chiziq uchun son. */
function pctNumber(pct: string | null): number {
  return pct === null ? 0 : Number(pct)
}

export function DirectorHome({ name }: { name: string | null }) {
  const todayIso = useMemo(() => tashkentIsoDate(), [])
  const [period, setPeriod] = useState<DirectorPeriod>('today')
  const [objectId, setObjectId] = useState<string | null>(null)
  const range = periodRange(period, todayIso)

  const summary = useLoad(() => getDashboardSummary(range), `${range.from}|${range.to}`)
  const norms = useLoad(() => getNormOverview(null), 'norms')
  const alerts = useLoad(() => listRecentAlerts({}, 10), 'alerts')
  const usage = useMemo(() => (norms.data ? objectUsage(norms.data) : null), [norms.data])
  const selected = usage?.find((u) => u.objectId === objectId) ?? null

  const back = useCallback(() => setObjectId(null), [])
  useBackButton(selected ? back : null)

  if (selected) return <ObjectUsageDetail usage={selected} onBack={back} />

  return (
    <DirectorHomeView
      name={name}
      period={period}
      onPeriod={(p) => {
        haptic.select()
        setPeriod(p)
      }}
      summary={summary}
      usage={{ ...norms, data: usage }}
      alerts={alerts}
      onPickObject={(id) => {
        haptic.select()
        setObjectId(id)
      }}
    />
  )
}

/** Obyekt tanlanganda: materiallar bo'yicha smeta ishlatilishi (oshganlari birinchi). */
export function ObjectUsageDetail({ usage, onBack }: { usage: ObjectUsage; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <BackLink label={tt.backToObjects} onClick={onBack} />
      <div>
        <h1 className="text-2xl leading-tight font-semibold text-ink">{usage.name}</h1>
        {usage.avgPct !== null && <p className="text-sm text-muted">{tt.avgUsage(formatQty(usage.avgPct, 1))}</p>}
        <p className={cx('text-sm', usage.overCount > 0 ? 'font-semibold text-danger' : 'text-muted')}>{tt.overCount(usage.overCount)}</p>
      </div>
      <ul className="flex flex-col gap-2" aria-label={tt.usage}>
        {usage.materials.map((m) => (
          <li
            key={m.material_id}
            data-testid="tg-material-usage"
            className={cx('flex flex-col gap-2 rounded-xl border bg-paper p-3', m.over ? 'border-danger/35' : 'border-line')}
          >
            <div className="flex items-start justify-between gap-2">
              <p className={cx('font-semibold', m.over ? 'text-danger' : 'text-ink')}>{m.material_name ?? '—'}</p>
              <p className="tabular text-right text-xs text-muted">
                {formatQty(m.consumed_qty_base)} / {formatQty(m.allowed_qty_base)} {m.base_unit ?? ''}
              </p>
            </div>
            {m.pct !== null && <LevelBar label={m.material_name ?? usage.name} value={pctNumber(m.pct)} max={100} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Direktor bosh ekrani (taqdimot): ma'lumotlar `Loaded` holatlari bilan keladi. */
export function DirectorHomeView({
  name,
  period,
  onPeriod,
  summary,
  usage,
  alerts,
  onPickObject,
}: {
  name: string | null
  period: DirectorPeriod
  onPeriod: (p: DirectorPeriod) => void
  summary: Loaded<DashboardSummary>
  usage: Loaded<ObjectUsage[]>
  alerts: Loaded<Alert[]>
  onPickObject: (objectId: string) => void
}) {
  const s = summary.data
  return (
    <div className="flex flex-col gap-5">
      <Greeting name={name} />

      <SegmentedControl
        label={tt.title}
        value={period}
        onChange={onPeriod}
        options={[
          { value: 'today', label: tt.periods.today },
          { value: 'last7', label: tt.periods.last7 },
        ]}
      />

      {summary.error && <RetryNotice message={summary.error} onRetry={summary.reload} />}
      {summary.loading && <SkeletonTiles count={4} />}
      {s && (
        <div className="grid grid-cols-2 gap-3">
          <StatTile testId="tg-kirim" icon={<ArrowDownLeft strokeWidth={2} />} tone="ok" label={tt.kirim} value={formatQty(String(s.kirim_count))} />
          <StatTile testId="tg-chiqim" icon={<ArrowUpRight strokeWidth={2} />} label={tt.chiqim} value={formatQty(String(s.chiqim_count))} />
          <StatTile
            testId="tg-purchases"
            icon={<ShoppingCart strokeWidth={1.75} />}
            label={tt.purchasesSum}
            value={<Money value={s.purchases_sum} size="lg" />}
          />
          <StatTile
            testId="tg-alerts"
            icon={<TriangleAlert strokeWidth={1.75} />}
            tone={s.alerts_serious_open > 0 ? 'danger' : s.alerts_open > 0 ? 'warn' : 'ok'}
            live
            label={tt.alertsOpen}
            value={formatQty(String(s.alerts_open))}
            hint={
              <span className={s.alerts_serious_open > 0 ? 'font-semibold text-danger' : undefined}>
                {tt.serious(formatQty(String(s.alerts_serious_open)))}
              </span>
            }
          />
        </div>
      )}

      <section aria-label={tt.usage} className="flex flex-col gap-2">
        <SectionTitle>{tt.usage}</SectionTitle>
        {usage.error && <RetryNotice message={usage.error} onRetry={usage.reload} />}
        {usage.loading && <SkeletonRows rows={2} />}
        {usage.data && usage.data.length === 0 && <p className="text-sm text-muted">{tt.usageEmpty}</p>}
        {usage.data?.map((u) => (
          <button
            key={u.objectId}
            type="button"
            data-testid="tg-object-usage"
            onClick={() => onPickObject(u.objectId)}
            className={cx(
              'flex min-h-11 flex-col gap-2 rounded-xl border bg-paper p-3 text-left transition-colors active:bg-ice',
              u.overCount > 0 ? 'border-danger/35' : 'border-line',
            )}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="font-semibold text-ink">{u.name}</span>
              <span className="flex items-center gap-1">
                {u.overCount > 0 && <Badge tone="danger">{tt.overCount(u.overCount)}</Badge>}
                <ChevronRight aria-hidden className="size-5 text-muted" strokeWidth={1.75} />
              </span>
            </span>
            {u.avgPct !== null && <LevelBar label={u.name} value={pctNumber(u.avgPct)} max={100} className="w-full" />}
          </button>
        ))}
      </section>

      <section aria-label={tt.alerts} className="flex flex-col gap-2">
        <SectionTitle>{tt.alerts}</SectionTitle>
        {alerts.error && <RetryNotice message={alerts.error} onRetry={alerts.reload} />}
        {alerts.loading && <SkeletonRows rows={2} />}
        {alerts.data && alerts.data.length === 0 && <p className="text-sm text-muted">{tt.noAlerts}</p>}
        {alerts.data && alerts.data.length > 0 && (
          <ul className="flex flex-col gap-2">
            {alerts.data.map((a) => (
              <EntryRow
                key={a.id}
                as="li"
                testId="tg-alert"
                // Bosilganda — shu ogohlantirish bosh ekran tepasida (AlertDeepLink)
                to={`/tg?alert=${a.id}`}
                kind={SEVERITY_KIND[a.severity]}
                icon={<TriangleAlert className="size-[18px]" strokeWidth={1.75} />}
                title={t.alertTexts.types[a.type]}
                badge={<Badge tone={SEVERITY_TONE[a.severity]}>{t.alertTexts.severities[a.severity]}</Badge>}
                meta={
                  <>
                    <span className="text-ink">{alertDetailText(a)}</span>
                    {a.object_name && <span>{a.object_name}</span>}
                    <span className="tabular">{formatDateTime(a.created_at)}</span>
                  </>
                }
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
