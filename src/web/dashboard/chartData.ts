// Diagramma qatorlarini shakllantirish — sof funksiyalar. Recharts faqat `number` bilan chizadi,
// shuning uchun har qatorda aniq qiymat (Dec satr, tooltip uchun) va chizish uchun `number` bor.
import { colors } from '@/components/ui/tokens'
import type { CashBalance, Profile } from '@/data/types'
import type { DailyRow, EstimateSpendRow, NormOverviewRow, SpendGroup, SpendRow } from '@/data/reportsRepo'
import { add, cmp, isNegative, sub, type Dec } from '@/domain/decimal'
import { fillDays } from '@/domain/reports'
import { usagePct } from '@/domain/norms'
import { t } from '@/i18n'
import { formatDate, formatQty } from '@/lib/format'

/** Diagramma ranglari — dizayn tokenlaridan (src/components/ui/tokens.ts). */
export const PALETTE = {
  brand: colors.brand,
  dark: colors.navy,
  light: colors.ice,
  danger: colors.danger,
  warn: colors.warn,
  ok: colors.ok,
  grid: colors.line,
  muted: colors.muted300,
  /** Boshqa xarajat bo'lagi (material — navy). */
  expense: colors.transfer,
} as const

/** Chizish uchun taxminiy son (faqat geometriya; matn — aniq Dec dan). */
export function plot(dec: Dec): number {
  const n = Number(dec)
  return Number.isFinite(n) ? n : 0
}

/** O'q yozuvi: o'zbekcha guruhlash, katta sonlar qisqa ("12,5 mln"). */
export function axisNumber(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${formatQty(String(Math.round(n / 1e8) / 10))} ${t.reports.units.bln}`
  if (abs >= 1e6) return `${formatQty(String(Math.round(n / 1e5) / 10))} ${t.reports.units.mln}`
  if (abs >= 1e4) return `${formatQty(String(Math.round(n / 100) / 10))} ${t.reports.units.thousand}`
  return formatQty(String(Math.round(n * 100) / 100))
}

export interface DailyPoint {
  day: string
  /** `dd.mm` — o'q uchun */
  label: string
  /** `dd.mm.yyyy` — tooltip uchun */
  date: string
  kirim: number
  chiqim: number
  sum: number
  sumText: Dec
  alerts: number
}

export function dailyChartRows(rows: DailyRow[], from: string, to: string): DailyPoint[] {
  return fillDays(rows, from, to, (day) => ({ day, kirim_count: 0, chiqim_count: 0, purchases_sum: '0', alerts_count: 0 })).map(
    (r) => {
      const date = formatDate(`${r.day}T12:00:00+05:00`)
      return {
        day: r.day,
        label: date.slice(0, 5),
        date,
        kirim: r.kirim_count,
        chiqim: r.chiqim_count,
        sum: plot(r.purchases_sum),
        sumText: r.purchases_sum,
        alerts: r.alerts_count,
      }
    },
  )
}

export interface NormPoint {
  materialId: string
  name: string
  unit: string
  allowed: number
  consumed: number
  allowedText: Dec
  consumedText: Dec
  pct: Dec | null
  over: boolean
  /** Material "smetaga kirmaydi" — sarf ko'rinadi, oshish belgisi yo'q. */
  outside: boolean
}

/**
 * Materiallar bo'yicha norma (isrof bilan) va sarf: obyektlar yig'iladi (asosiy birlik bir xil),
 * eng ko'p ishlatilgan `limit` tasi. `over` — obyekt darajasida: material biror obyektda normadan
 * oshgan bo'lsa (yig'indida boshqa obyektning zaxirasi bilan yashirinmasin).
 */
export function normChartRows(rows: NormOverviewRow[], limit = 10): NormPoint[] {
  const byMat = new Map<string, { name: string; unit: string; allowed: Dec; consumed: Dec; over: boolean; outside: boolean }>()
  for (const r of rows) {
    const outside = r.outside_estimate === true
    const rowOver = !outside && cmp(r.consumed_qty_base, r.allowed_qty_base) > 0
    const cur = byMat.get(r.material_id)
    if (cur) {
      cur.allowed = add(cur.allowed, r.allowed_qty_base)
      cur.consumed = add(cur.consumed, r.consumed_qty_base)
      cur.over ||= rowOver
    } else {
      byMat.set(r.material_id, {
        name: r.material_name ?? t.reports.charts.noName,
        unit: r.base_unit ?? '',
        allowed: r.allowed_qty_base,
        consumed: r.consumed_qty_base,
        over: rowOver,
        outside,
      })
    }
  }
  return [...byMat.entries()]
    .map(([materialId, m]) => ({
      materialId,
      name: m.name,
      unit: m.unit,
      allowed: plot(m.allowed),
      consumed: plot(m.consumed),
      allowedText: m.allowed,
      consumedText: m.consumed,
      pct: m.outside ? null : usagePct(m.consumed, m.allowed),
      over: m.over,
      outside: m.outside,
    }))
    .filter((p) => cmp(p.consumedText, '0') > 0 || cmp(p.allowedText, '0') > 0)
    .sort((a, b) => cmp(b.consumedText, a.consumedText) || a.name.localeCompare(b.name))
    .slice(0, limit)
}

export interface SpendPoint {
  key: string
  label: string
  /** Jami (material + boshqa xarajat) — chizish uchun. */
  value: number
  valueText: Dec
  /** Material xaridlari. */
  material: number
  materialText: Dec
  /** Boshqa xarajatlar (oziq-ovqat, yoqilg'i …). */
  expense: number
  expenseText: Dec
  /** Xaridlar + xarajatlar soni. */
  count: number
  other: boolean
}

export const OTHER_KEY = '__other__'

/** Top `n` (jami summa bo'yicha) + "Boshqa" (material, xarajat va soni yig'indisi). */
export function spendChartRows(rows: SpendRow[], n = 8, group: SpendGroup = 'material'): SpendPoint[] {
  const countOf = (r: SpendRow) => r.purchases_count + r.expenses_count
  const totalCount = rows.reduce((s, r) => s + countOf(r), 0)
  const sorted = rows
    .map((r, i) => ({ r, i }))
    .filter((x) => cmp(x.r.total_sum, '0') !== 0)
    .sort((a, b) => cmp(b.r.total_sum, a.r.total_sum) || a.i - b.i)
    .map((x) => x.r)
  const k = Math.max(0, Math.floor(n))
  const head = sorted.slice(0, k)
  const rest = sorted.slice(k)
  const point = (r: SpendRow, other: boolean, count: number): SpendPoint => ({
    key: other ? OTHER_KEY : (r.key ?? `none:${r.label ?? ''}`),
    label: other ? tc.other : spendLabel(r, group),
    value: plot(r.total_sum),
    valueText: r.total_sum,
    material: plot(r.purchases_sum),
    materialText: r.purchases_sum,
    expense: plot(r.expenses_sum),
    expenseText: r.expenses_sum,
    count,
    other,
  })
  const points = head.map((r) => point(r, false, countOf(r)))
  if (rest.length > 0) {
    const sum = (f: (r: SpendRow) => Dec) => rest.reduce<Dec>((s, r) => add(s, f(r)), '0')
    const headCount = head.reduce((s, r) => s + countOf(r), 0)
    points.push(
      point(
        {
          key: OTHER_KEY,
          label: tc.other,
          purchases_sum: sum((r) => r.purchases_sum),
          purchases_count: 0,
          expenses_sum: sum((r) => r.expenses_sum),
          expenses_count: 0,
          total_sum: sum((r) => r.total_sum),
        },
        true,
        totalCount - headCount,
      ),
    )
  }
  return points
}

/** Taqsimotda boshqa xarajat bormi — bo'lsa, diagramma ikki bo'lakli (material / boshqa). */
export function hasExpenseSegment(points: readonly SpendPoint[]): boolean {
  return points.some((p) => cmp(p.expenseText, '0') !== 0)
}

const tc = t.reports.charts

/** Sotuvchisiz xarid (`key` va `label` null) — "Sotuvchisiz"; obyektsiz xarajat — "Umumiy"; nom ko‘rinmasa (RLS) — "Noma’lum". */
export function spendLabel(r: Pick<SpendRow, 'key' | 'label'>, group: SpendGroup): string {
  const label = r.label?.trim()
  if (label) return label
  if (r.key === null && group === 'supplier') return tc.noSupplier
  if (r.key === null && group === 'object') return t.expenses.general
  return tc.unknown
}

export interface CashPoint {
  profileId: string
  name: string
  value: number
  valueText: Dec
  negative: boolean
}

/** Odamlar bo'yicha qo'ldagi pul (nol balanslar tashlanadi), kattasi birinchi; manfiy — qizil. */
export function cashChartRows(balances: CashBalance[], profiles: Pick<Profile, 'id' | 'full_name'>[]): CashPoint[] {
  const names = new Map(profiles.map((p) => [p.id, p.full_name]))
  return balances
    .filter((b) => cmp(b.balance, '0') !== 0)
    .map((b) => ({
      profileId: b.profile_id,
      name: names.get(b.profile_id) ?? t.reports.charts.noName,
      value: plot(b.balance),
      valueText: b.balance,
      negative: isNegative(b.balance),
    }))
    .sort((a, b) => cmp(b.valueText, a.valueText) || a.name.localeCompare(b.name))
}

/** Normadan oshgan miqdor (ko'rsatish uchun). */
export function overBy(p: Pick<NormPoint, 'consumedText' | 'allowedText'>): Dec {
  return sub(p.consumedText, p.allowedText)
}

export interface EstimateSpendPoint {
  objectId: string
  name: string
  estimate: number
  /** Jami (material + boshqa xarajat). */
  spent: number
  /** Ustma-ust bo'laklar: material xaridi va boshqa xarajat. */
  material: number
  expense: number
  estimateText: Dec | null
  spentText: Dec
  materialText: Dec
  expenseText: Dec
  /** Jami xarajat smeta jamidan oshgan. */
  over: boolean
}

/**
 * "Smeta va haqiqiy" diagrammasi — obyekt bo'yicha PUL: smeta jami va davrdagi xarajat (material xaridi +
 * boshqa xarajat, ustma-ust; bitta o'q, so'm). Smeta bo'yicha kamayish tartibida, eng katta `limit` ta.
 */
export function estimateSpendRows(rows: EstimateSpendRow[], limit = 10): EstimateSpendPoint[] {
  return rows
    .map((r) => {
      const materialText = r.material_sum ?? r.spent_sum
      const expenseText = r.expense_sum ?? '0'
      return {
        objectId: r.object_id,
        name: r.object_name ?? t.reports.charts.noName,
        estimate: r.estimate_sum === null ? 0 : plot(r.estimate_sum),
        spent: plot(r.spent_sum),
        material: plot(materialText),
        expense: plot(expenseText),
        estimateText: r.estimate_sum,
        spentText: r.spent_sum,
        materialText,
        expenseText,
        over: r.estimate_sum !== null && cmp(r.spent_sum, r.estimate_sum) > 0,
      }
    })
    .sort((a, b) => b.estimate - a.estimate || b.spent - a.spent || a.name.localeCompare(b.name, 'uz'))
    .slice(0, limit)
}
