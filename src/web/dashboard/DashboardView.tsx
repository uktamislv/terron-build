// Bosh sahifa taqdimot komponentlari (ma'lumot props orqali) — DashboardPage va ko'rgazma (/__preview) uchun umumiy.
import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  ClipboardList,
  Gauge,
  HandCoins,
  LayoutDashboard,
  PackageOpen,
  ShoppingCart,
  TriangleAlert,
  Wallet,
} from 'lucide-react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Badge, EmptyState, EntryRow, Notice, PageHeader, RetryNotice, SegmentedControl, SkeletonRows, SkeletonTiles, StatTile, cx } from '@/components/ui'
import type { DailyRow, NormOverviewRow, SpendGroup, SpendRow } from '@/data/reportsRepo'
import { SPEND_GROUPS } from '@/data/reportsRepo'
import type { Alert } from '@/data/types'
import { t } from '@/i18n'
import { formatDateTime, formatQty, formatSum } from '@/lib/format'
import type { Loaded } from '@/lib/useLoad'
import { alertDetailText } from '../alerts/alertDetails'
import { SEVERITY_TONE } from '../alerts/alertTones'
import type { CardKey, DashCard } from './cards'
import { dailyChartRows, normChartRows, spendChartRows, type CashPoint } from './chartData'

// Recharts faqat shu chunk'da
const charts = () => import('./Charts')
const DailyChart = lazy(() => charts().then((m) => ({ default: m.DailyChart })))
const NormChart = lazy(() => charts().then((m) => ({ default: m.NormChart })))
const SpendChart = lazy(() => charts().then((m) => ({ default: m.SpendChart })))
const CashChart = lazy(() => charts().then((m) => ({ default: m.CashChart })))

const tr = t.reports
const tc = tr.charts

/** Sahifa skeleti: sarlavha, davr paneli, kartochkalar, diagrammalar to'ri, ogohlantirishlar. */
export function DashboardLayout({
  periodText,
  actions,
  periodBar,
  invalid,
  cards,
  daily,
  norm,
  spend,
  cash,
  alerts,
}: {
  periodText: string
  actions?: ReactNode
  periodBar: ReactNode
  invalid: string | null
  cards: ReactNode
  daily?: ReactNode
  norm?: ReactNode
  spend?: ReactNode
  cash?: ReactNode
  alerts?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={tr.title} description={periodText} icon={<LayoutDashboard strokeWidth={1.75} />} actions={actions} />
      {periodBar}
      {invalid && <Notice tone="warn">{invalid}</Notice>}
      {cards}
      <div className="grid gap-4 lg:grid-cols-2">
        {daily}
        {norm}
        {spend}
        {cash}
      </div>
      {alerts}
    </div>
  )
}

const ic = { strokeWidth: 1.75, 'aria-hidden': true } as const
const CARD_ICON: Record<CardKey, ReactNode> = {
  kirim: <ArrowDownLeft {...ic} />,
  chiqim: <ArrowUpRight {...ic} />,
  purchases: <ShoppingCart {...ic} />,
  cashIssued: <Wallet {...ic} />,
  cashOnHand: <HandCoins {...ic} />,
  alertsOpen: <TriangleAlert {...ic} />,
  unreceived: <PackageOpen {...ic} />,
  pendingTransfers: <ArrowLeftRight {...ic} />,
  pendingRequests: <ClipboardList {...ic} />,
  overNorm: <Gauge {...ic} />,
}

/** Raqamli kartochkalar: davr ko'rsatkichlari, so'ng "hozir" (joriy holat) kartochkalari. */
export function DashboardCards({ cards, objectFiltered }: { cards: DashCard[]; objectFiltered: boolean }) {
  if (cards.length === 0) return null
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label={tr.title}>
      {cards.map((c) => (
        <li key={c.key} data-testid={`card-${c.key}`} data-tone={c.tone}>
          <StatTile
            icon={CARD_ICON[c.key]}
            label={c.label}
            value={c.value}
            tone={c.tone}
            live={c.current}
            to={c.to ?? undefined}
            hint={
              c.sub || (c.companyWide && objectFiltered) ? (
                <span className="flex flex-col gap-0.5">
                  {c.sub && <span>{c.sub}</span>}
                  {c.companyWide && objectFiltered && <span>{tr.allObjectsNote}</span>}
                </span>
              ) : undefined
            }
          />
        </li>
      ))}
    </ul>
  )
}

export function ChartCard({ title, wide, actions, children }: { title: string; wide?: boolean; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className={cx('flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-paper p-4 md:p-5', wide && 'lg:col-span-2')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink md:text-lg">{title}</h2>
      </div>
      {actions}
      {children}
    </section>
  )
}

function NoData() {
  return <EmptyState compact icon={<BarChart3 strokeWidth={1.5} />} title={tr.noData} className="border-0" />
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
      <Suspense fallback={<SkeletonRows rows={2} />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

function LoadStatus<T>({ state }: { state: Loaded<T> }) {
  return (
    <>
      {state.error && <RetryNotice message={state.error} onRetry={state.reload} />}
      {state.loading && <SkeletonRows rows={2} />}
    </>
  )
}

export function SummaryCards({ state, objectFiltered }: { state: Loaded<DashCard[]>; objectFiltered: boolean }) {
  return (
    <>
      {state.error && <RetryNotice message={state.error} onRetry={state.reload} />}
      {state.loading && <SkeletonTiles count={5} />}
      {state.data && <DashboardCards cards={state.data} objectFiltered={objectFiltered} />}
    </>
  )
}

export function DailyCard({ state, from, to }: { state: Loaded<DailyRow[]>; from: string; to: string }) {
  return (
    <ChartCard title={tc.daily} wide>
      <LoadStatus state={state} />
      {state.data && <DailySection rows={state.data} from={from} to={to} />}
    </ChartCard>
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

export function NormCard({ state, objectId }: { state: Loaded<NormOverviewRow[]>; objectId: string }) {
  const data = useMemo(() => normChartRows(state.data ?? []), [state.data])
  return (
    <ChartCard title={tc.norm}>
      <p className="-mt-2 text-xs text-muted">
        {tc.normHint}
        {!objectId && `. ${tc.normAllObjects}`}
      </p>
      <LoadStatus state={state} />
      {state.data && data.length === 0 && <NoData />}
      {data.length > 0 && (
        <>
          <ChartSuspense>
            <NormChart data={data} />
          </ChartSuspense>
          <SrTable
            caption={tc.norm}
            head={[t.excel.cols.material, tc.normAllowed, tc.normConsumed]}
            rows={data.map((p) => [p.name, `${formatQty(p.allowedText)} ${p.unit}`.trim(), `${formatQty(p.consumedText)} ${p.unit}`.trim()])}
          />
        </>
      )}
    </ChartCard>
  )
}

export function SpendCard({ state, group, onGroup }: { state: Loaded<SpendRow[]>; group: SpendGroup; onGroup: (g: SpendGroup) => void }) {
  const data = useMemo(() => spendChartRows(state.data ?? [], 8, group), [state.data, group])
  return (
    <ChartCard
      title={tc.spend}
      actions={
        <SegmentedControl
          label={tc.spend}
          value={group}
          onChange={onGroup}
          className="grid-cols-2! sm:grid-cols-4!"
          options={SPEND_GROUPS.map((g) => ({ value: g, label: tc.spendGroups[g] }))}
        />
      }
    >
      <LoadStatus state={state} />
      {state.data && data.length === 0 && <NoData />}
      {data.length > 0 && (
        <>
          <ChartSuspense>
            <SpendChart data={data} />
          </ChartSuspense>
          <SrTable caption={tc.spend} head={[tc.spendGroups[group], tc.dailySum]} rows={data.map((p) => [p.label, formatSum(p.valueText)])} />
        </>
      )}
    </ChartCard>
  )
}

export function CashCard({ state }: { state: Loaded<CashPoint[]> }) {
  const data = state.data ?? []
  return (
    <ChartCard title={tc.cash}>
      <LoadStatus state={state} />
      {state.data && data.length === 0 && <NoData />}
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

const SEVERITY_KIND = { belgi: 'neutral', ogohlantirish: 'warn', jiddiy: 'danger' } as const

export function RecentAlertsCard({ state }: { state: Loaded<Alert[]> }) {
  return (
    <section aria-label={tr.recentAlerts} className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-4 md:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink md:text-lg">{tr.recentAlerts}</h2>
        <Link to="/alerts" className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-brand hover:bg-ice">
          {tr.allAlerts}
          <ChevronRight aria-hidden className="size-4" strokeWidth={1.75} />
        </Link>
      </div>
      <LoadStatus state={state} />
      {state.data && state.data.length === 0 && (
        <EmptyState compact icon={<TriangleAlert strokeWidth={1.5} />} title={tr.noAlerts} className="border-0" />
      )}
      {state.data && state.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {state.data.map((a) => (
            <EntryRow
              key={a.id}
              as="li"
              testId="recent-alert"
              kind={SEVERITY_KIND[a.severity]}
              icon={<TriangleAlert className="size-[18px]" strokeWidth={1.75} />}
              title={t.alertTexts.types[a.type]}
              badge={<Badge tone={SEVERITY_TONE[a.severity]}>{t.alertTexts.severities[a.severity]}</Badge>}
              meta={
                <>
                  <span className="text-sm text-ink">{alertDetailText(a)}</span>
                  {a.object_name && <span>{a.object_name}</span>}
                  {a.material_name && <span>{a.material_name}</span>}
                  <span className="tabular">{formatDateTime(a.created_at)}</span>
                </>
              }
            />
          ))}
        </ul>
      )}
    </section>
  )
}
