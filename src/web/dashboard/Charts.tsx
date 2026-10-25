// Recharts diagrammalari — alohida (lazy) chunk: bosh bundle'ga Recharts tushmaydi.
// Ranglar CLAUDE.md palitrasidan. Matnlar (tooltip) aniq Dec qiymatdan `formatSum` / `formatQty` bilan.
import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { t } from '@/i18n'
import { formatQty, formatSum } from '@/lib/format'
import { axisNumber, PALETTE, type CashPoint, type DailyPoint, type NormPoint, type SpendPoint } from './chartData'


const tc = t.reports.charts
const AXIS = { fontSize: 12, fill: '#475569' }

interface TipProps<T> {
  active?: boolean
  payload?: { payload: T }[]
}

function TipBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-slate-900">{title}</p>
      {children}
    </div>
  )
}

function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <p className="flex items-center gap-2 text-slate-700">
      <span className="inline-block size-2.5 rounded-sm" style={{ background: color }} aria-hidden />
      {label}: <span className="font-medium text-slate-900">{value}</span>
    </p>
  )
}

function DailyTip({ active, payload }: TipProps<DailyPoint>) {
  const p = active ? payload?.[0]?.payload : undefined
  if (!p) return null
  return (
    <TipBox title={p.date}>
      <TipRow color={PALETTE.brand} label={tc.dailyKirim} value={formatQty(String(p.kirim))} />
      <TipRow color={PALETTE.dark} label={tc.dailyChiqim} value={formatQty(String(p.chiqim))} />
      <TipRow color={PALETTE.warn} label={tc.dailySum} value={formatSum(p.sumText)} />
    </TipBox>
  )
}

/** Kunlik dinamika: kirim/chiqim soni (ustun) + xarid summasi (chiziq, o'ng o'q). */
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
        <Bar yAxisId="count" dataKey="kirim" name={tc.dailyKirim} fill={PALETTE.brand} radius={[3, 3, 0, 0]} maxBarSize={24} />
        <Bar yAxisId="count" dataKey="chiqim" name={tc.dailyChiqim} fill={PALETTE.dark} radius={[3, 3, 0, 0]} maxBarSize={24} />
        <Line yAxisId="sum" type="monotone" dataKey="sum" name={tc.dailySum} stroke={PALETTE.warn} strokeWidth={2} dot={false} />
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
      {p.pct !== null && <p className={p.over ? 'font-semibold text-danger' : 'text-slate-600'}>{formatQty(p.pct, 1)}%</p>}
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
  return (
    <TipBox title={p.label}>
      <TipRow color={p.other ? PALETTE.muted : PALETTE.dark} label={tc.dailySum} value={formatSum(p.valueText)} />
      <p className="text-slate-600">{t.reports.countUnit(formatQty(String(p.count)))}</p>
    </TipBox>
  )
}

/** Xarajat taqsimoti: top 8 + "Boshqa". */
export function SpendChart({ data }: { data: SpendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={barHeight(data.length)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={PALETTE.grid} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickFormatter={axisNumber} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" tick={AXIS} width={110} axisLine={false} tickLine={false} />
        <Tooltip content={<SpendTip />} cursor={{ fill: PALETTE.light }} />
        <Bar dataKey="value" name={tc.dailySum} maxBarSize={22} radius={[0, 3, 3, 0]}>
          {data.map((p) => (
            <Cell key={p.key} fill={p.other ? PALETTE.muted : PALETTE.dark} />
          ))}
        </Bar>
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

/** Podotchet: odamlar bo'yicha qo'ldagi pul; manfiy — qizil. */
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
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
