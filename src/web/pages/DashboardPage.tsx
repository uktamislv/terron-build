// Veb bosh sahifa (docs/reports-design.md): davr va obyekt filtri (URL bilan), kartochkalar,
// 4 diagramma (Recharts — lazy chunk), oxirgi ogohlantirishlar, Excel eksport. Hammasi RLS orqali.
// Taqdimot qismlari — ../dashboard/DashboardView.tsx (ko'rgazma ham shularni ishlatadi).
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ClipboardCheck, LayoutDashboard } from 'lucide-react'
import { useAuth } from '@/auth/authContext'
import { EmptyState, Notice, PageHeader, Spinner } from '@/components/ui'
import { listRecentAlerts } from '@/data/alertsRepo'
import { listBalances } from '@/data/cashRepo'
import { listObjects } from '@/data/objectsRepo'
import { listDirectory } from '@/data/profileDirectory'
import {
  getDashboardDaily,
  getDashboardSummary,
  getEstimateVsSpend,
  getNormOverview,
  getSpendBreakdown,
  type DailyRow,
  type DashboardSummary,
  type SpendGroup,
} from '@/data/reportsRepo'
import type { ObjectRow } from '@/data/types'
import { can, type Role } from '@/domain/roles'
import { t } from '@/i18n'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { tashkentIsoDate } from '@/lib/format'
import { useLoad, type Loaded } from '@/lib/useLoad'
import { buildCards, dashboardSections, summaryExportRows, type DashCard } from '../dashboard/cards'
import { cashChartRows, dailyChartRows } from '../dashboard/chartData'
import { CashCard, DailyCard, DashboardLayout, ExpenseCategoryCard, NormCard, RecentAlertsCard, SpendCard, SummaryCards } from '../dashboard/DashboardView'
import { PeriodBar } from '../dashboard/PeriodBar'
import { dashboardSearch, isoToUz, readDashboardQuery, type DashboardQuery } from '../dashboard/query'
import { ExportButton } from '../ExportButton'
import { InspectorCounts } from '../dashboard/InspectorCounts'

const tr = t.reports

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

  if (sections.size === 0 || waitObject)
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={tr.title} icon={<LayoutDashboard strokeWidth={1.75} />} />
        {sections.size > 0 ? (
          <Spinner />
        ) : role === 'tekshiruvchi' ? (
          // Tekshiruvchi: oxirgi sanashlari holati bilan (bo'sh sahifa emas)
          <InspectorCounts profileId={profile.id} />
        ) : (
          <EmptyState icon={<ClipboardCheck strokeWidth={1.5} />} title={tr.inspectorNote} />
        )}
      </div>
    )

  return <Dashboard role={role} query={query} todayIso={todayIso} objects={objects.data ?? []} onQuery={setQuery} />
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
  const cards: Loaded<DashCard[]> = { ...summary, data: summary.data ? buildCards(summary.data, role, query) : null }

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
    <DashboardLayout
      periodText={periodText}
      actions={<ExportButton run={runExport} />}
      periodBar={<PeriodBar key={`${query.from}|${query.to}`} query={query} todayIso={todayIso} objects={objects} onChange={onQuery} />}
      invalid={query.invalid ? tr.rangeErrors[query.invalid] : null}
      cards={
        <>
          {/* Foydalanuvchining o'zi botni bloklagan — Telegram xabarlari unga bormaydi */}
          {summary.data?.telegram_me_blocked && <Notice tone="warn">{tr.meBlocked}</Notice>}
          <SummaryCards state={cards} objectFiltered={Boolean(query.objectId)} />
        </>
      }
      daily={showDaily && <DailyCard state={daily} from={query.from} to={query.to} />}
      norm={sections.has('norm') && <NormSection objectId={query.objectId} range={range} rangeKey={rangeKey} />}
      spend={sections.has('purchases') && <SpendSection range={range} rangeKey={rangeKey} />}
      expenses={sections.has('purchases') && <ExpenseCategoryCard state={{ ...summary, error: null, data: summary.data ? summary.data.expense_by_category : null }} />}
      cash={sections.has('cash') && <CashSection />}
      alerts={can(role, 'view_alerts') && <RecentAlerts objectId={query.objectId} />}
    />
  )
}

function NormSection({
  objectId,
  range,
  rangeKey,
}: {
  objectId: string
  range: { from: string; to: string; objectId: string | null }
  rangeKey: string
}) {
  const norms = useLoad(() => getNormOverview(objectId || null), `norm|${objectId}`)
  // Pul diagrammasi (smeta jami va davrdagi xaridlar); repo topilmasa ham (eski mock) — xato holati
  const money = useLoad(() => Promise.resolve().then(() => getEstimateVsSpend(range)), `money|${rangeKey}`)
  return <NormCard state={norms} money={money} objectId={objectId} />
}

function SpendSection({ range, rangeKey }: { range: { from: string; to: string; objectId: string | null }; rangeKey: string }) {
  const [group, setGroup] = useState<SpendGroup>('material')
  const spend = useLoad(() => getSpendBreakdown(range, group), `${rangeKey}|${group}`)
  return <SpendCard state={spend} group={group} onGroup={setGroup} />
}

function CashSection() {
  const cash = useLoad(async () => {
    const [balances, profiles] = await Promise.all([listBalances(), listDirectory().catch(() => [])])
    return cashChartRows(balances, profiles)
  }, 'cash')
  return <CashCard state={cash} />
}

function RecentAlerts({ objectId }: { objectId: string }) {
  const alerts = useLoad(
    () => listRecentAlerts({ statuses: ['yangi', 'korildi'], objectId: objectId || undefined }, 5),
    `alerts|${objectId}`,
  )
  return <RecentAlertsCard state={alerts} />
}
