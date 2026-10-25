/* eslint-disable react-refresh/only-export-components -- ko'rgazma: ekranlar ro'yxati va ularning kichik o'ramlari bitta faylda */
// Ko'rgazma: veb Bosh sahifa va Smeta import ustasining "Ustunlar" bosqichi (faqat DEV).
// Haqiqiy taqdimot komponentlari fixture bilan — repo chaqirilmaydi.
import { useState } from 'react'
import type { Cell, ColumnMapping, EstimateField } from '@/domain/estimate'
import type { DailyRow, DashboardSummary, NormOverviewRow, SpendGroup, SpendRow } from '@/data/reportsRepo'
import type { Alert } from '@/data/types'
import { tashkentIsoDate } from '@/lib/format'
import type { Loaded } from '@/lib/useLoad'
import { buildCards } from '@/web/dashboard/cards'
import type { CashPoint } from '@/web/dashboard/chartData'
import { CashCard, DailyCard, DashboardLayout, NormCard, RecentAlertsCard, SpendCard, SummaryCards } from '@/web/dashboard/DashboardView'
import { PeriodBar } from '@/web/dashboard/PeriodBar'
import { isoToUz, readDashboardQuery } from '@/web/dashboard/query'
import { ExportButton } from '@/web/ExportButton'
import { STEPS } from '@/web/estimates/wizardModel'
import { WizardFrame } from '@/web/estimates/wizardChrome'
import { ColumnsStep } from '@/web/estimates/wizardSteps'
import { t } from '@/i18n'
import { hoursAgo, previewObjects, PREVIEW_COMPANY } from '../fixtures'
import type { PreviewView } from '../types'

function loaded<T>(data: T): Loaded<T> {
  return { data, error: null, loading: false, reload: () => undefined }
}

const summary: DashboardSummary = {
  kirim_count: 48,
  chiqim_count: 36,
  purchases_count: 14,
  purchases_sum: '86450000',
  cash_issued_sum: '40000000',
  cash_returned_sum: '0',
  cash_on_hand_total: '6250000',
  alerts_open: 5,
  alerts_serious_open: 2,
  alerts_new_in_period: 3,
  unreceived_purchases_count: 2,
  pending_transfers_count: 1,
  pending_requests_count: 4,
  objects_over_norm_count: 1,
}

function dailyRows(from: string): DailyRow[] {
  const base = new Date(`${from}T00:00:00Z`).getTime()
  const kirim = [6, 9, 4, 8, 7, 5, 9]
  const chiqim = [4, 6, 5, 7, 3, 6, 5]
  const sums = ['12500000', '18200000', '6400000', '15800000', '9900000', '7300000', '16350000']
  return kirim.map((k, i) => ({
    day: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    kirim_count: k,
    chiqim_count: chiqim[i] ?? 0,
    purchases_sum: sums[i] ?? '0',
    alerts_count: i % 3 === 0 ? 1 : 0,
  }))
}

function norm(id: string, name: string, unit: string, allowed: string, consumed: string, pct: string): NormOverviewRow {
  return {
    object_id: 'o-1',
    object_name: previewObjects[0]?.name ?? null,
    material_id: id,
    material_name: name,
    base_unit: unit,
    norm_qty_base: allowed,
    allowed_qty_base: allowed,
    consumed_qty_base: consumed,
    usage_pct: pct,
  }
}

const norms: NormOverviewRow[] = [
  norm('m-1', 'Sement M400', 'kg', '42000', '27300', '65'),
  norm('m-5', 'Armatura Ø12', 'kg', '18000', '16740', '93'),
  norm('m-2', 'G‘isht (pishiq)', 'dona', '60000', '68400', '114'),
  norm('m-3', 'Qum', 'm³', '120', '54', '45'),
  norm('m-6', 'Beton B25', 'm³', '310', '201', '65'),
]

const spend: SpendRow[] = [
  { key: 'm-1', label: 'Sement M400', purchases_sum: '28400000', purchases_count: 5 },
  { key: 'm-5', label: 'Armatura Ø12', purchases_sum: '24100000', purchases_count: 3 },
  { key: 'm-2', label: 'G‘isht (pishiq)', purchases_sum: '16800000', purchases_count: 2 },
  { key: 'm-6', label: 'Beton B25', purchases_sum: '11250000', purchases_count: 2 },
  { key: 'm-3', label: 'Qum', purchases_sum: '5900000', purchases_count: 2 },
]

const cash: CashPoint[] = [
  { profileId: 'p1', name: 'Bekzod Yo‘ldoshev', value: 3200000, valueText: '3200000', negative: false },
  { profileId: 'p2', name: 'Sardor Rahimov', value: 2450000, valueText: '2450000', negative: false },
  { profileId: 'p3', name: 'Jamshid Aliyev', value: 1100000, valueText: '1100000', negative: false },
  { profileId: 'p4', name: 'Otabek Qodirov', value: -500000, valueText: '-500000', negative: true },
]

function alert(id: string, type: Alert['type'], severity: Alert['severity'], details: Record<string, unknown>, hours: number, material: string | null, unit: string | null): Alert {
  return {
    id,
    company_id: PREVIEW_COMPANY,
    type,
    status: 'yangi',
    severity,
    object_id: 'o-1',
    material_id: null,
    purchase_id: null,
    movement_id: null,
    details,
    closed_by: null,
    closed_at: null,
    close_note: null,
    created_at: hoursAgo(hours),
    deleted_at: null,
    object_name: previewObjects[0]?.name ?? null,
    material_name: material,
    base_unit: unit,
  }
}

const alerts: Alert[] = [
  alert('a1', 'normadan_oshish', 'jiddiy', { allowed_qty_base: '60000', consumed_qty_base: '68400', over_pct: '14', base_unit: 'dona' }, 2, 'G‘isht (pishiq)', 'dona'),
  alert('a2', 'narx_ogishi', 'ogohlantirish', { avg: '1250000', price: '1390000', diff_pct: '11.2', window: 5 }, 6, 'Sement M400', 'kg'),
  alert('a3', 'xarid_qabul_farqi', 'ogohlantirish', { purchased_qty_base: '5000', received_qty_base: '4600', diff_pct: '8', threshold_pct: '2', direction: 'under' }, 20, 'Armatura Ø12', 'kg'),
]

function DashboardPreview() {
  const todayIso = tashkentIsoDate()
  const [query, setQuery] = useState(() => readDashboardQuery(new URLSearchParams(), todayIso))
  const [group, setGroup] = useState<SpendGroup>('material')
  const cards = loaded(buildCards(summary, 'admin', query))
  return (
    <DashboardLayout
      periodText={t.reports.rangeLabel(isoToUz(query.from), isoToUz(query.to))}
      actions={<ExportButton run={async () => undefined} />}
      periodBar={
        <PeriodBar
          key={`${query.from}|${query.to}`}
          query={query}
          todayIso={todayIso}
          objects={previewObjects}
          onChange={(next) => setQuery((q) => ({ ...q, ...next, preset: q.preset }))}
        />
      }
      invalid={null}
      cards={<SummaryCards state={cards} objectFiltered={Boolean(query.objectId)} />}
      daily={<DailyCard state={loaded(dailyRows(query.from))} from={query.from} to={query.to} />}
      norm={<NormCard state={loaded(norms)} objectId={query.objectId} />}
      spend={<SpendCard state={loaded(spend)} group={group} onGroup={setGroup} />}
      cash={<CashCard state={loaded(cash)} />}
      alerts={<RecentAlertsCard state={loaded(alerts)} />}
    />
  )
}

const sheetRows: Cell[][] = [
  ['ЛОКАЛЬНАЯ СМЕТА № 12', null, null, null, null, null],
  ['Объект: Chilonzor 12-uy', null, null, null, null, null],
  ['№', 'Шифр', 'Наименование работ и затрат', 'Ед. изм.', 'Кол-во', 'Цена', 'Сумма'],
  [1, 'Е06-01', 'Цемент М400', 'т', 42, 1250000, 52500000],
  [2, 'Е08-02', 'Кирпич керамический', 'шт', 60000, 1450, 87000000],
  [3, 'С-101', 'Песок мытый', 'м3', 120, 180000, 21600000],
  [4, 'Е04-11', 'Арматура A500 Ø12', 'т', 18, 11800000, 212400000],
  [5, 'Р-07', 'Штукатурные работы', 'м2', 840, 45000, 37800000],
]

function ColumnsPreview() {
  const [mapping, setMapping] = useState<ColumnMapping>({ code: 1, name: 2, unit: 3, qty: 4, price: 5, sum: 6 })
  const step = STEPS.indexOf('columns')
  const missing = (['name', 'unit', 'qty'] as EstimateField[]).filter((f) => mapping[f] === undefined)
  return (
    <WizardFrame stepKey="columns" step={step} maxStep={step} saving={false} onStep={() => undefined} onCancel={() => undefined}>
      <ColumnsStep
        rows={sheetRows}
        headerRow={2}
        mapping={mapping}
        source="auto"
        template={null}
        onTemplate={() => undefined}
        missing={missing}
        onMapping={(field, col) =>
          setMapping((m) => {
            const next = { ...m }
            if (col === undefined) delete next[field]
            else next[field] = col
            return next
          })
        }
      />
    </WizardFrame>
  )
}

export const views: PreviewView[] = [
  { id: 'web-dashboard', title: 'Bosh sahifa', surface: 'web', role: 'admin', render: () => <DashboardPreview /> },
  { id: 'web-estimate-import', title: 'Smeta importi — ustunlar', surface: 'web', role: 'admin', render: () => <ColumnsPreview /> },
]
