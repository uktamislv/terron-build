// Recharts diagrammalari — alohida (lazy) chunk: bosh bundle'ga Recharts tushmaydi.
// Ranglar dizayn tokenlaridan (PALETTE). Matnlar (tooltip) aniq Dec qiymatdan `formatSum` / `formatQty` bilan.
import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { colors } from '@/components/ui/tokens'
import { t } from '@/i18n'
import { formatQty, formatSum } from '@/lib/format'
import { axisNumber, PALETTE, type CashPoint, type DailyPoint, type EstimateSpendPoint, type NormPoint, type SpendPoint } from './chartData'


const tc = t.reports.charts
const te = t.expenses
const AXIS = { fontSize: 12, fill: colors.muted }

interface TipProps<T> {
  active?: boolean
  payload?: { payload: T }[]
}

function TipBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-paper px-3 py-2 text-xs shadow-float">
      <p className="mb-1 font-semibold text-ink">{title}</p>
      {children}
    </div>
  )
}

function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <p className="flex items-center gap-2 text-muted">
      <span className="inline-block size-2.5 rounded-sm" style={{ background: color }} aria-hidden />
      {label}: <span className="font-medium text-ink">{value}</span>
    </p>
  )
}

function DailyTip({ active, payload }: TipProps<DailyPoint>) {
  const p = active ? payload?.[0]?.payload : undefined
  if (!p) return null
  return (
    <TipBox title={p.date}>
      <TipRow color={PALETTE.ok} label={tc.dailyKirim} value={formatQty(String(p.kirim))} />
      <TipRow color={PALETTE.brand} label={tc.dailyChiqim} value={formatQty(String(p.chiqim))} />
      <TipRow color={PALETTE.dark} label={tc.dailySum} value={formatSum(p.sumText)} />
    </TipBox>
  )
}

/** Kunlik dinamika: kirim (yashil) / chiqim (ko'k) soni — ustun, xarid summasi — navy chiziq (o'ng o'q). Ranglar EntryRow bilan bir xil. */
export function DailyChart({ data }: { data: DailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={PALETTE.grid} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: PALETTE.grid }} minTickGap={12} />
        <YAxis yAxisId="count" allowDecimals={false} tick={AXIS} tickFormatter={axisNumber} width={40} axisLine={false} tickLine={false} />
        <YAxis yAxisId="sum" orientation="right" tick={AXIS} tickFormatter={axisNumber} width={64} axisLine={false} tickLine={false} />
        <Tooltip content={<DailyTip />} cursor={{ fill: PALETTE.light }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="count" dataKey="kirim" name={tc.dailyKirim} fill={PALETTE.ok} radius={[3, 3, 0, 0]} maxBarSize={24} />
        <Bar yAxisId="count" dataKey="chiqim" name={tc.dailyChiqim} fill={PALETTE.brand} radius={[3, 3, 0, 0]} maxBarSize={24} />
        <Line yAxisId="sum" type="monotone" dataKey="sum" name={tc.dailySum} stroke={PALETTE.dark} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function barHeight(rows: number): number {
  return Math.max(160, rows * 40 + 48)
}

function NormTip({ active, payload }: TipProps<NormPoint>) {
  const p = active ? payload?.[0]?.payload : undefined
  if (!p) return null
  return (
    <TipBox title={p.name}>
      <TipRow color={PALETTE.light} label={tc.normAllowed} value={`${formatQty(p.allowedText)} ${p.unit}`.trim()} />
      <TipRow
        color={p.over ? PALETTE.danger : PALETTE.brand}
        label={tc.normConsumed}
        value={`${formatQty(p.consumedText)} ${p.unit}`.trim()}
      />
      {p.pct !== null && <p className={p.over ? 'font-semibold text-danger' : 'text-muted'}>{formatQty(p.pct, 1)}%</p>}
    </TipBox>
  )
}

/** Smeta va haqiqiy: norma (isrof bilan) va sarf, gorizontal; oshganlar qizil. */
export function NormChart({ data }: { data: NormPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={barHeight(data.length)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }} barGap={2}>
        <CartesianGrid stroke={PALETTE.grid} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickFormatter={axisNumber} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={AXIS} width={110} axisLine={false} tickLine={false} />
        <Tooltip content={<NormTip />} cursor={{ fill: PALETTE.light }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="allowed" name={tc.normAllowed} fill={PALETTE.light} stroke={PALETTE.brand} maxBarSize={14} />
        <Bar dataKey="consumed" name={tc.normConsumed} fill={PALETTE.brand} maxBarSize={14}>
          {data.map((p) => (
            <Cell key={p.materialId} fill={p.over ? PALETTE.danger : PALETTE.brand} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function SpendTip({ active, payload }: TipProps<SpendPoint>) {
  const p = active ? payload?.[0]?.payload : undefined
  if (!p) return null
  const split = p.expense !== 0
  return (
    <TipBox title={p.label}>
      {split && <TipRow color={p.other ? PALETTE.muted : PALETTE.dark} label={te.segmentMaterial} value={formatSum(p.materialText)} />}
      {split && <TipRow color={PALETTE.expense} label={te.segmentExpense} value={formatSum(p.expenseText)} />}
      <TipRow color={p.other ? PALETTE.muted : PALETTE.dark} label={split ? te.spendTotalCard : tc.dailySum} value={formatSum(p.valueText)} />
      <p className="text-muted">{t.reports.countUnit(formatQty(String(p.count)))}</p>
    </TipBox>
  )
}

/** Xarajat taqsimoti: top 8 + "Boshqa". Boshqa xarajat bo'lsa — ustma-ust: material xaridi (navy) va boshqa xarajat. */
export function SpendChart({ data }: { data: SpendPoint[] }) {
  const split = data.some((p) => p.expense !== 0)
  return (
    <ResponsiveContainer width="100%" height={barHeight(data.length)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={PALETTE.grid} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickFormatter={axisNumber} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" tick={AXIS} width={110} axisLine={false} tickLine={false} />
        <Tooltip content={<SpendTip />} cursor={{ fill: PALETTE.light }} />
        {split && <Legend wrapperStyle={{ fontSize: 12 }} />}
        <Bar dataKey={split ? 'material' : 'value'} name={split ? te.segmentMaterial : tc.dailySum} stackId="spend" fill={PALETTE.dark} maxBarSize={22}>
          {data.map((p) => (
            <Cell key={p.key} fill={p.other ? PALETTE.muted : PALETTE.dark} />
          ))}
        </Bar>
        {split && <Bar dataKey="expense" name={te.segmentExpense} stackId="spend" fill={PALETTE.expense} maxBarSize={22} radius={[0, 3, 3, 0]} />}
      </BarChart>
    </ResponsiveContainer>
  )
}

function CashTip({ active, payload }: TipProps<CashPoint>) {
  const p = active ? payload?.[0]?.payload : undefined
  if (!p) return null
  return (
    <TipBox title={p.name}>
      <TipRow color={p.negative ? PALETTE.danger : PALETTE.ok} label={tc.cashBalance} value={formatSum(p.valueText)} />
    </TipBox>
  )
}

/** Manfiy ustun yonidagi yozuv: "−1,2 mln" (U+2212). Musbat ustunlar uchun hech narsa. */
function NegativeLabel(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: number | string }) {
  const value = Number(props.value)
  if (!Number.isFinite(value) || value >= 0) return null
  // Ustunning o'ng uchi (nol chizig'i) yonida — ustun manfiy kenglik bilan kelsa ham
  const x = Number(props.x ?? 0) + Math.max(0, Number(props.width ?? 0))
  const y = Number(props.y ?? 0) + Number(props.height ?? 0) / 2
  return (
    <text x={x + 6} y={y} dy="0.35em" fontSize={12} fontWeight={600} fill={colors.danger}>
      {axisNumber(value)}
    </text>
  )
}

/** Podotchet: odamlar bo'yicha qo'ldagi pul; manfiy — qizil va qiymati yozilgan. */
export function CashChart({ data }: { data: CashPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={barHeight(data.length)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={PALETTE.grid} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickFormatter={axisNumber} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={AXIS} width={110} axisLine={false} tickLine={false} />
        <Tooltip content={<CashTip />} cursor={{ fill: PALETTE.light }} />
        <Bar dataKey="value" name={tc.cashBalance} maxBarSize={22}>
          {data.map((p) => (
            <Cell key={p.profileId} fill={p.negative ? PALETTE.danger : PALETTE.ok} />
          ))}
          {/* Manfiy ustun — rang yagona belgi bo'lmasin: qiymat minus bilan yoziladi */}
          <LabelList dataKey="value" content={NegativeLabel} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function EstimateSpendTip({ active, payload }: TipProps<EstimateSpendPoint>) {
  const p = active ? payload?.[0]?.payload : undefined
  if (!p) return null
  return (
    <TipBox title={p.name}>
      <TipRow color={PALETTE.light} label={tc.estimateSum} value={p.estimateText === null ? tc.noEstimate : formatSum(p.estimateText)} />
      <TipRow color={PALETTE.dark} label={te.segmentMaterial} value={formatSum(p.materialText)} />
      <TipRow color={PALETTE.expense} label={te.segmentExpense} value={formatSum(p.expenseText)} />
      <TipRow color={p.over ? PALETTE.danger : PALETTE.dark} label={tc.spentSum} value={formatSum(p.spentText)} />
    </TipBox>
  )
}

/**
 * Smeta va haqiqiy — obyekt bo'yicha pul: smeta jami (och) va davrdagi xarajat — material xaridi (navy; jami
 * smetadan oshsa — qizil) va boshqa xarajat ustma-ust.
 */
export function EstimateSpendChart({ data }: { data: EstimateSpendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={barHeight(data.length)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }} barGap={2}>
        <CartesianGrid stroke={PALETTE.grid} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickFormatter={axisNumber} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={AXIS} width={110} axisLine={false} tickLine={false} />
        <Tooltip content={<EstimateSpendTip />} cursor={{ fill: PALETTE.light }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="estimate" name={tc.estimateSum} fill={PALETTE.light} stroke={PALETTE.brand} maxBarSize={14} />
        <Bar dataKey="material" name={te.segmentMaterial} stackId="spent" fill={PALETTE.dark} maxBarSize={14}>
          {data.map((p) => (
            <Cell key={p.objectId} fill={p.over ? PALETTE.danger : PALETTE.dark} />
          ))}
        </Bar>
        <Bar dataKey="expense" name={te.segmentExpense} stackId="spent" fill={PALETTE.expense} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  )
}
