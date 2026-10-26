// Diagramma qatorlarini shakllantirish — sof funksiyalar. Recharts faqat `number` bilan chizadi,
// shuning uchun har qatorda aniq qiymat (Dec satr, tooltip uchun) va chizish uchun `number` bor.
import { colors } from '@/components/ui/tokens'
import type { CashBalance, Profile } from '@/data/types'
import type { DailyRow, NormOverviewRow, SpendGroup, SpendRow } from '@/data/reportsRepo'
import { add, cmp, isNegative, sub, type Dec } from '@/domain/decimal'
import { fillDays, topN } from '@/domain/reports'
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
}

/**
 * Materiallar bo'yicha norma (isrof bilan) va sarf: obyektlar yig'iladi (asosiy birlik bir xil),
 * eng ko'p ishlatilgan `limit` tasi. `over` — obyekt darajasida: material biror obyektda normadan
 * oshgan bo'lsa (yig'indida boshqa obyektning zaxirasi bilan yashirinmasin).
 */
export function normChartRows(rows: NormOverviewRow[], limit = 10): NormPoint[] {
  const byMat = new Map<string, { name: string; unit: string; allowed: Dec; consumed: Dec; over: boolean }>()
  for (const r of rows) {
    const rowOver = cmp(r.consumed_qty_base, r.allowed_qty_base) > 0
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
      pct: usagePct(m.consumed, m.allowed),
      over: m.over,
    }))
    .filter((p) => cmp(p.consumedText, '0') > 0 || cmp(p.allowedText, '0') > 0)
    .sort((a, b) => cmp(b.consumedText, a.consumedText) || a.name.localeCompare(b.name))
    .slice(0, limit)
}

export interface SpendPoint {
  key: string
  label: string
  value: number
  valueText: Dec
  count: number
  other: boolean
}

export const OTHER_KEY = '__other__'

/** Top `n` + "Boshqa" (summa va xaridlar soni yig'indisi). */
export function spendChartRows(rows: SpendRow[], n = 8, group: SpendGroup = 'material'): SpendPoint[] {
  const totalCount = rows.reduce((s, r) => s + r.purchases_count, 0)
  const top = topN(
    rows.filter((r) => cmp(r.purchases_sum, '0') !== 0),
    n,
    (r) => r.purchases_sum,
    (sum): SpendRow => ({ key: OTHER_KEY, label: t.reports.charts.other, purchases_sum: sum, purchases_count: 0 }),
  )
  const headCount = top.filter((r) => r.key !== OTHER_KEY).reduce((s, r) => s + r.purchases_count, 0)
  return top.map((r) => {
    const other = r.key === OTHER_KEY
    return {
      key: r.key ?? `none:${r.label ?? ''}`,
      label: other ? r.label ?? tc.other : spendLabel(r, group),
      value: plot(r.purchases_sum),
      valueText: r.purchases_sum,
      count: other ? totalCount - headCount : r.purchases_count,
      other,
    }
  })
}

const tc = t.reports.charts

/** Sotuvchisiz xarid (`key` va `label` null) — "Sotuvchisiz"; nom ko‘rinmasa (RLS) — "Noma’lum". */
export function spendLabel(r: Pick<SpendRow, 'key' | 'label'>, group: SpendGroup): string {
  const label = r.label?.trim()
  if (label) return label
  if (r.key === null && group === 'supplier') return tc.noSupplier
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
