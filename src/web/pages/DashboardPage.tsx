// Veb bosh sahifa (docs/reports-design.md): davr va obyekt filtri (URL bilan), kartochkalar,
// 4 diagramma (Recharts — lazy chunk), oxirgi ogohlantirishlar, Excel eksport. Hammasi RLS orqali.
import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { StatusBadge } from '@/components/StatusBadge'
import { Spinner } from '@/components/ui'
import { listRecentAlerts } from '@/data/alertsRepo'
import { listBalances } from '@/data/cashRepo'
import { listObjects } from '@/data/objectsRepo'
import { listProfiles } from '@/data/profilesRepo'
import {
  getDashboardDaily,
  getDashboardSummary,
  getNormOverview,
  getSpendBreakdown,
  SPEND_GROUPS,
  type DailyRow,
  type DashboardSummary,
  type SpendGroup,
} from '@/data/reportsRepo'
import type { ObjectRow } from '@/data/types'
import { can, type Role } from '@/domain/roles'
import { t } from '@/i18n'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { formatDateTime, formatQty, formatSum, tashkentIsoDate } from '@/lib/format'
import { useLoad } from '@/lib/useLoad'
import { alertDetailText } from '../alerts/alertDetails'
import { SEVERITY_TONE } from '../alerts/alertTones'
import { buildCards, dashboardSections, summaryExportRows, type DashCard } from '../dashboard/cards'
import { cashChartRows, dailyChartRows, normChartRows, spendChartRows } from '../dashboard/chartData'
import { PeriodBar } from '../dashboard/PeriodBar'
import { dashboardSearch, isoToUz, readDashboardQuery, type DashboardQuery } from '../dashboard/query'
import { ExportButton } from '../ExportButton'
import { RetryNotice } from '../fields'

// Recharts faqat shu chunk'da
const charts = () => import('../dashboard/Charts')
const DailyChart = lazy(() => charts().then((m) => ({ default: m.DailyChart })))
const NormChart = lazy(() => charts().then((m) => ({ default: m.NormChart })))
const SpendChart = lazy(() => charts().then((m) => ({ default: m.SpendChart })))
const CashChart = lazy(() => charts().then((m) => ({ default: m.CashChart })))

const tr = t.reports
const tc = tr.charts

export function DashboardPage() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const todayIso = useMemo(() => tashkentIsoDate(), [])
  const parsed = useMemo(() => readDashboardQuery(params, todayIso), [params, todayIso])
  const objects = useLoad<ObjectRow[]>(listObjects, 'objects', Boolean(profile))
  // URL'dagi obyekt foydalanuvchining ro'yxatida bo'lmasa — "Hammasi"
  const query = useMemo(
    () =>
      parsed.objectId && objects.data && !objects.data.some((o) => o.id === parsed.objectId)
        ? { ...parsed, objectId: '' }
        : parsed,
    [parsed, objects.data],
  )
  // Obyekt ro'yxati kelmaguncha URL'dagi obyekt bilan so'rov yuborilmaydi
  const waitObject = Boolean(parsed.objectId) && !objects.data && !objects.error

  const setQuery = useCallback(
    (next: { from: string; to: string; objectId: string }) => setParams(dashboardSearch(next), { replace: true }),
    [setParams],
  )

  if (!profile) return null
  const role = profile.role
  const sections = dashboardSections(role)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <h1 className="text-2xl font-bold text-brand-dark">{tr.title}</h1>
      {sections.size === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-600">{tr.inspectorNote}</p>
      ) : waitObject ? (
        <Spinner />
      ) : (
        <Dashboard role={role} query={query} todayIso={todayIso} objects={objects.data ?? []} onQuery={setQuery} />
      )}
    </div>
  )
}

function Dashboard({
  role,
  query,
  todayIso,
  objects,
  onQuery,
}: {
  role: Role
  query: DashboardQuery
  todayIso: string
  objects: ObjectRow[]
  onQuery: (next: { from: string; to: string; objectId: string }) => void
}) {
  const sections = dashboardSections(role)
  const range = { from: query.from, to: query.to, objectId: query.objectId || null }
  const rangeKey = `${query.from}|${query.to}|${query.objectId}`
  const summary = useLoad<DashboardSummary>(() => getDashboardSummary(range), rangeKey)
  const showDaily = sections.has('movements') || sections.has('purchases')
  const daily = useLoad<DailyRow[]>(() => getDashboardDaily(range), rangeKey, showDaily)
  const periodText = tr.rangeLabel(isoToUz(query.from), isoToUz(query.to))

  const runExport = async (signal: AbortSignal) => {
    const [s, d] = await Promise.all([
      summary.data ?? getDashboardSummary(range),
      showDaily ? (daily.data ?? getDashboardDaily(range)) : Promise.resolve([] as DailyRow[]),
    ])
    const objectName = objects.find((o) => o.id === query.objectId)?.name ?? tr.allObjects
    const ce = t.excel.cols
    await exportWorkbook({
      fileName: exportFileName(tr.exportSection),
      signal,
      sheets: [
        {
          sheetName: t.excel.sheets.summary,
          columns: [
            { header: tr.exportColIndicator, key: 'indicator', type: 'text' },
            { header: tr.exportColValue, key: 'value', type: 'money' },
          ],
          rows: [
            { indicator: tr.exportPeriodRow, value: periodText },
            { indicator: tr.exportObjectRow, value: objectName },
            ...summaryExportRows(s, role),
          ],
        },
        ...(showDaily
          ? [
              {
                sheetName: t.excel.sheets.daily,
                columns: [
                  { header: ce.date, key: 'day', type: 'date' as const },
                  { header: ce.kirimCount, key: 'kirim_count', type: 'number' as const },
                  { header: ce.chiqimCount, key: 'chiqim_count', type: 'number' as const },
                  { header: ce.purchasesSum, key: 'purchases_sum', type: 'money' as const },
                  { header: ce.alertsCount, key: 'alerts_count', type: 'number' as const },
                ],
                rows: dailyChartRows(d, query.from, query.to).map((p) => ({
                  day: p.day,
                  kirim_count: p.kirim,
                  chiqim_count: p.chiqim,
                  purchases_sum: p.sumText,
                  alerts_count: p.alerts,
                })),
              },
            ]
          : []),
      ],
    })
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-slate-600">{periodText}</p>
        <ExportButton run={runExport} />
      </div>
      <PeriodBar
        key={`${query.from}|${query.to}`}
        query={query}
        todayIso={todayIso}
        objects={objects}
        onChange={onQuery}
      />
      {query.invalid && <p className="text-sm text-warn">{tr.rangeErrors[query.invalid]}</p>}

      {summary.error && <RetryNotice message={summary.error} onRetry={summary.reload} />}
      {summary.loading && <Spinner />}
      {summary.data && <Cards cards={buildCards(summary.data, role, query)} objectFiltered={Boolean(query.objectId)} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {showDaily && (
          <ChartCard title={tc.daily} wide>
            {daily.error && <RetryNotice message={daily.error} onRetry={daily.reload} />}
            {daily.loading && <Spinner />}
            {daily.data && <DailySection rows={daily.data} from={query.from} to={query.to} />}
          </ChartCard>
        )}
        {sections.has('norm') && <NormSection objectId={query.objectId} />}
        {sections.has('purchases') && <SpendSection range={range} rangeKey={rangeKey} />}
        {sections.has('cash') && <CashSection />}
      </div>

      {can(role, 'view_alerts') && <RecentAlerts objectId={query.objectId} />}
    </>
  )
}

const CARD_TONE: Record<DashCard['tone'], string> = {
  default: 'border-slate-200 bg-white',
  warn: 'border-warn/30 bg-warn/5',
  danger: 'border-danger/30 bg-danger/5',
}

const VALUE_TONE: Record<DashCard['tone'], string> = {
  default: 'text-slate-900',
  warn: 'text-warn',
  danger: 'text-danger',
}

function Cards({ cards, objectFiltered }: { cards: DashCard[]; objectFiltered: boolean }) {
  if (cards.length === 0) return null
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label={tr.title}>
      {cards.map((c) => {
        const body = (
          <>
            <span className="flex items-start justify-between gap-2 text-sm text-slate-600">
              {c.label}
              {c.current && (
                <span title={tr.nowHint} className="shrink-0 rounded-full bg-brand-light px-2 py-0.5 text-xs font-medium text-brand-dark">
                  {tr.now}
                </span>
              )}
            </span>
            <span className={`text-xl font-bold break-words ${VALUE_TONE[c.tone]}`}>{c.value}</span>
            {c.sub && <span className="text-xs text-slate-500">{c.sub}</span>}
            {c.companyWide && objectFiltered && <span className="text-xs text-slate-500">{tr.allObjectsNote}</span>}
          </>
        )
        const cls = `flex h-full min-h-24 flex-col gap-1 rounded-2xl border p-4 ${CARD_TONE[c.tone]}`
        return (
          <li key={c.key} data-testid={`card-${c.key}`} data-tone={c.tone}>
            {c.to ? (
              <Link to={c.to} className={`${cls} hover:border-brand focus-visible:outline-2 focus-visible:outline-brand`}>
                {body}
              </Link>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function ChartCard({ title, wide, actions, children }: { title: string; wide?: boolean; actions?: ReactNode; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className={`flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 ${wide ? 'lg:col-span-2' : ''}`}
    >
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {actions}
      {children}
    </section>
  )
}

function NoData() {
  return <p className="py-6 text-center text-sm text-slate-500">{tr.noData}</p>
}

/** Ekran o'quvchilar uchun jadval (diagramma ma'lumoti matn ko'rinishida). */
function SrTable({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Diagramma o'z chegarasida: Recharts chunk'i yoki chizish yiqilsa — faqat shu kartochkada xabar. */
function ChartSuspense({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={() => (
        <p role="alert" className="py-6 text-center text-sm text-danger">
          {t.appError.chart}
        </p>
      )}
    >
      <Suspense fallback={<Spinner />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

function DailySection({ rows, from, to }: { rows: DailyRow[]; from: string; to: string }) {
  const data = useMemo(() => dailyChartRows(rows, from, to), [rows, from, to])
  const empty = data.every((p) => p.kirim === 0 && p.chiqim === 0 && p.sum === 0)
  if (empty) return <NoData />
  return (
    <>
      <ChartSuspense>
        <DailyChart data={data} />
      </ChartSuspense>
      <SrTable
        caption={tc.daily}
        head={[t.excel.cols.date, tc.dailyKirim, tc.dailyChiqim, tc.dailySum]}
        rows={data.map((p) => [p.date, formatQty(String(p.kirim)), formatQty(String(p.chiqim)), formatSum(p.sumText)])}
      />
    </>
  )
}

function NormSection({ objectId }: { objectId: string }) {
  const norms = useLoad(() => getNormOverview(objectId || null), `norm|${objectId}`)
  const data = useMemo(() => normChartRows(norms.data ?? []), [norms.data])
  return (
    <ChartCard title={tc.norm}>
      <p className="-mt-2 text-xs text-slate-500">
        {tc.normHint}
        {!objectId && `. ${tc.normAllObjects}`}
      </p>
      {norms.error && <RetryNotice message={norms.error} onRetry={norms.reload} />}
      {norms.loading && <Spinner />}
      {norms.data && data.length === 0 && <NoData />}
      {data.length > 0 && (
        <>
          <ChartSuspense>
            <NormChart data={data} />
          </ChartSuspense>
          <SrTable
            caption={tc.norm}
            head={[t.excel.cols.material, tc.normAllowed, tc.normConsumed]}
            rows={data.map((p) => [
              p.name,
              `${formatQty(p.allowedText)} ${p.unit}`.trim(),
              `${formatQty(p.consumedText)} ${p.unit}`.trim(),
            ])}
          />
        </>
      )}
    </ChartCard>
  )
}

function SpendSection({ range, rangeKey }: { range: { from: string; to: string; objectId: string | null }; rangeKey: string }) {
  const [group, setGroup] = useState<SpendGroup>('material')
  const spend = useLoad(() => getSpendBreakdown(range, group), `${rangeKey}|${group}`)
  const data = useMemo(() => spendChartRows(spend.data ?? [], 8, group), [spend.data, group])
  return (
    <ChartCard
      title={tc.spend}
      actions={
        <div role="group" aria-label={tc.spend} className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:grid-cols-4">
          {SPEND_GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
              className={`min-h-11 rounded-lg px-2 text-sm font-medium ${group === g ? 'bg-white text-brand shadow-sm' : 'text-slate-600'}`}
            >
              {tc.spendGroups[g]}
            </button>
          ))}
        </div>
      }
    >
      {spend.error && <RetryNotice message={spend.error} onRetry={spend.reload} />}
      {spend.loading && <Spinner />}
      {spend.data && data.length === 0 && <NoData />}
      {data.length > 0 && (
        <>
          <ChartSuspense>
            <SpendChart data={data} />
          </ChartSuspense>
          <SrTable
            caption={tc.spend}
            head={[tc.spendGroups[group], tc.dailySum]}
            rows={data.map((p) => [p.label, formatSum(p.valueText)])}
          />
        </>
      )}
    </ChartCard>
  )
}

function CashSection() {
  const cash = useLoad(async () => {
    const [balances, profiles] = await Promise.all([listBalances(), listProfiles().catch(() => [])])
    return cashChartRows(balances, profiles)
  }, 'cash')
  const data = cash.data ?? []
  return (
    <ChartCard title={tc.cash}>
      {cash.error && <RetryNotice message={cash.error} onRetry={cash.reload} />}
      {cash.loading && <Spinner />}
      {cash.data && data.length === 0 && <NoData />}
      {data.length > 0 && (
        <>
          <ChartSuspense>
            <CashChart data={data} />
          </ChartSuspense>
          <SrTable caption={tc.cash} head={[t.excel.cols.person, tc.cashBalance]} rows={data.map((p) => [p.name, formatSum(p.valueText)])} />
        </>
      )}
    </ChartCard>
  )
}

function RecentAlerts({ objectId }: { objectId: string }) {
  const alerts = useLoad(
    () => listRecentAlerts({ statuses: ['yangi', 'korildi'], objectId: objectId || undefined }, 5),
    `alerts|${objectId}`,
  )
  return (
    <section aria-label={tr.recentAlerts} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">{tr.recentAlerts}</h2>
        <Link to="/alerts" className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-brand hover:underline">
          {tr.allAlerts}
        </Link>
      </div>
      {alerts.error && <RetryNotice message={alerts.error} onRetry={alerts.reload} />}
      {alerts.loading && <Spinner />}
      {alerts.data && alerts.data.length === 0 && <p className="text-sm text-slate-500">{tr.noAlerts}</p>}
      {alerts.data && alerts.data.length > 0 && (
        <ul className="flex flex-col divide-y divide-slate-100">
          {alerts.data.map((a) => (
            <li key={a.id} data-testid="recent-alert" className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:gap-3">
              <div className="flex shrink-0 flex-wrap gap-1">
                <StatusBadge tone={SEVERITY_TONE[a.severity]}>{t.alertTexts.types[a.type]}</StatusBadge>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-900">{alertDetailText(a)}</p>
                <p className="text-xs text-slate-500">
                  {[a.object_name, a.material_name, formatDateTime(a.created_at)].filter(Boolean).join(' · ')}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
