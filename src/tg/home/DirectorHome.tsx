// Mini App direktor bosh ekrani (faqat ko'rish): bugun / 7 kun, kartochkalar, smeta ishlatilishi,
// oxirgi 10 ogohlantirish. Ma'lumot — veb bilan umumiy repo'lar (RLS).
import { useCallback, useMemo, useState } from 'react'
import { StatusBadge } from '@/components/StatusBadge'
import { Spinner } from '@/components/ui'
import { listRecentAlerts } from '@/data/alertsRepo'
import { getDashboardSummary, getNormOverview } from '@/data/reportsRepo'
import { periodRange } from '@/domain/reports'
import { t } from '@/i18n'
import { formatDate, formatDateTime, formatQty, formatSum, tashkentIsoDate } from '@/lib/format'
import { useLoad } from '@/lib/useLoad'
import { alertDetailText } from '@/web/alerts/alertDetails'
import { SEVERITY_TONE } from '@/web/alerts/alertTones'
import { RetryNotice } from '@/web/fields'
import { NormProgress } from '@/web/norms/NormProgress'
import { haptic } from '../telegram'
import { useBackButton } from '../useTelegramButtons'
import { objectUsage } from './usage'

const tt = t.reports.tg
type Period = 'today' | 'last7'

export function DirectorHome({ name }: { name: string | null }) {
  const todayIso = useMemo(() => tashkentIsoDate(), [])
  const [period, setPeriod] = useState<Period>('today')
  const [objectId, setObjectId] = useState<string | null>(null)
  const range = periodRange(period, todayIso)

  const summary = useLoad(() => getDashboardSummary(range), `${range.from}|${range.to}`)
  const norms = useLoad(() => getNormOverview(null), 'norms')
  const alerts = useLoad(() => listRecentAlerts({}, 10), 'alerts')
  const usage = useMemo(() => objectUsage(norms.data ?? []), [norms.data])
  const selected = usage.find((u) => u.objectId === objectId) ?? null

  const back = useCallback(() => setObjectId(null), [])
  useBackButton(selected ? back : null)

  const pick = (p: Period) => {
    haptic.select()
    setPeriod(p)
  }

  if (selected) {
    return (
      <div className="flex flex-col gap-4">
        <button type="button" onClick={back} className="inline-flex min-h-11 items-center self-start text-sm font-medium text-brand">
          ← {tt.backToObjects}
        </button>
        <div>
          <h1 className="text-lg font-semibold text-brand-dark">{selected.name}</h1>
          <p className="text-sm text-slate-600">
            {selected.avgPct !== null && tt.avgUsage(formatQty(selected.avgPct, 1))} · {tt.overCount(selected.overCount)}
          </p>
        </div>
        <ul className="flex flex-col gap-2" aria-label={tt.usage}>
          {selected.materials.map((m) => (
            <li
              key={m.material_id}
              data-testid="tg-material-usage"
              className={`flex flex-col gap-2 rounded-2xl border p-3 ${m.over ? 'border-danger/40' : 'border-slate-200'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className={`font-medium ${m.over ? 'text-danger' : 'text-slate-900'}`}>{m.material_name ?? '—'}</p>
                <p className="text-right text-xs text-slate-600">
                  {formatQty(m.consumed_qty_base)} / {formatQty(m.allowed_qty_base)} {m.base_unit ?? ''}
                </p>
              </div>
              <NormProgress pct={m.pct} label={m.material_name ?? undefined} />
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const s = summary.data

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl bg-brand p-4 text-white">
        <p className="text-sm opacity-80">{formatDate(new Date())}</p>
        <h1 className="mt-1 text-xl font-semibold">
          {t.tg.hello}
          {name ? `, ${name}` : ''}!
        </h1>
      </div>

      <div role="group" aria-label={tt.title} className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        {(['today', 'last7'] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={period === p}
            onClick={() => pick(p)}
            className={`min-h-11 rounded-lg text-sm font-medium ${period === p ? 'bg-white text-brand shadow-sm' : 'text-slate-600'}`}
          >
            {tt.periods[p]}
          </button>
        ))}
      </div>

      {summary.error && <RetryNotice message={summary.error} onRetry={summary.reload} />}
      {summary.loading && <Spinner />}
      {s && (
        <div className="grid grid-cols-2 gap-2">
          <Stat testId="tg-kirim" label={tt.kirim} value={formatQty(String(s.kirim_count))} />
          <Stat testId="tg-chiqim" label={tt.chiqim} value={formatQty(String(s.chiqim_count))} />
          <Stat testId="tg-purchases" label={tt.purchasesSum} value={formatSum(s.purchases_sum)} />
          <Stat
            testId="tg-alerts"
            label={tt.alertsOpen}
            value={formatQty(String(s.alerts_open))}
            sub={tt.serious(formatQty(String(s.alerts_serious_open)))}
            danger={s.alerts_serious_open > 0}
          />
        </div>
      )}

      <section aria-label={tt.usage} className="flex flex-col gap-2">
        <h2 className="font-semibold text-slate-900">{tt.usage}</h2>
        {norms.error && <RetryNotice message={norms.error} onRetry={norms.reload} />}
        {norms.loading && <Spinner />}
        {norms.data && usage.length === 0 && <p className="text-sm text-slate-500">{tt.usageEmpty}</p>}
        {usage.map((u) => (
          <button
            key={u.objectId}
            type="button"
            data-testid="tg-object-usage"
            onClick={() => {
              haptic.select()
              setObjectId(u.objectId)
            }}
            className={`flex min-h-11 flex-col gap-2 rounded-2xl border p-3 text-left ${u.overCount > 0 ? 'border-danger/40' : 'border-slate-200'}`}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="font-medium text-slate-900">{u.name}</span>
              {u.overCount > 0 && <StatusBadge tone="danger">{tt.overCount(u.overCount)}</StatusBadge>}
            </div>
            <div className="w-full">
              <NormProgress pct={u.avgPct} label={u.name} />
            </div>
          </button>
        ))}
      </section>

      <section aria-label={tt.alerts} className="flex flex-col gap-2">
        <h2 className="font-semibold text-slate-900">{tt.alerts}</h2>
        {alerts.error && <RetryNotice message={alerts.error} onRetry={alerts.reload} />}
        {alerts.loading && <Spinner />}
        {alerts.data && alerts.data.length === 0 && <p className="text-sm text-slate-500">{tt.noAlerts}</p>}
        {alerts.data && alerts.data.length > 0 && (
          <ul className="flex flex-col gap-2">
            {alerts.data.map((a) => (
              <li key={a.id} data-testid="tg-alert" className="flex flex-col gap-1 rounded-2xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge tone={SEVERITY_TONE[a.severity]}>{t.alertTexts.types[a.type]}</StatusBadge>
                  <span className="text-xs text-slate-500">{formatDateTime(a.created_at)}</span>
                </div>
                {a.object_name && <p className="text-xs font-medium text-slate-700">{a.object_name}</p>}
                <p className="text-sm text-slate-800">{alertDetailText(a)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, sub, danger, testId }: { label: string; value: string; sub?: string; danger?: boolean; testId: string }) {
  return (
    <div data-testid={testId} className={`flex flex-col gap-1 rounded-2xl border p-3 ${danger ? 'border-danger/30 bg-danger/5' : 'border-slate-200'}`}>
      <span className="text-xs text-slate-600">{label}</span>
      <span className={`text-lg font-bold break-words ${danger ? 'text-danger' : 'text-slate-900'}`}>{value}</span>
      {sub && <span className={`text-xs ${danger ? 'font-semibold text-danger' : 'text-slate-500'}`}>{sub}</span>}
    </div>
  )
}
