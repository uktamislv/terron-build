// Xarajatlar (20261111000001_expenses.sql) ogohlantirishlari: `details.table = 'expenses'`, `details.record_id`
// (= expense_id), category_name, amount | total_amount; obyekt — `alerts.object_name` (null — "Umumiy").
// xarajat_limiti — category_id, category_name, month ('YYYY-MM'), limit, spent, over.
import type { Alert } from '@/data/types'
import { parseDec } from '@/domain/decimal'
import { t } from '@/i18n'
import { formatSum } from '@/lib/format'

function dec(d: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = d[k]
    if (typeof v === 'number' || typeof v === 'string') {
      const x = parseDec(String(v))
      if (x !== null) return x
    }
  }
  return null
}

function str(d: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = d[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isExpenseAlert(a: Pick<Alert, 'details'>): boolean {
  return a.details.table === 'expenses'
}

/** "Xarajat: Oziq-ovqat · 41 000 so'm · Obyekt A" (obyektsiz — "Umumiy"). */
export function expenseAlertLine(a: Pick<Alert, 'details'> & { object_name?: string | null }): string {
  const d = a.details
  const amount = dec(d, 'amount', 'total_amount')
  const object = a.object_name || str(d, 'object_name') || t.expenses.general
  return t.expenses.alertLine(str(d, 'category_name'), amount !== null ? formatSum(amount) : '', object)
}

/** "Oziq-ovqat: 11.2026 oyida 5 200 000 so'm sarflandi, limit 5 000 000 so'm — 200 000 so'm oshgan". */
export function expenseLimitText(d: Record<string, unknown>): string {
  const spent = dec(d, 'spent')
  const limit = dec(d, 'limit')
  const over = dec(d, 'over')
  const month = str(d, 'month')
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  const positive = over !== null && !over.startsWith('-') && parseDec(over) !== '0'
  return t.expenses.limitText(
    str(d, 'category_name'),
    m ? `${m[2]}.${m[1]}` : month,
    spent !== null ? formatSum(spent) : '?',
    limit !== null ? formatSum(limit) : '?',
    positive && over !== null ? formatSum(over) : '',
  )
}

/**
 * Veb havola: xarajat yozuvi — `/purchases?tab=expenses&expense=<id>`; oylik limit — shu tur, shu oy ro'yxati.
 * Bog'lanmagan — null.
 */
export function expenseAlertHref(a: Pick<Alert, 'type' | 'details'>): string | null {
  const d = a.details
  const id = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null)
  if (a.type === 'xarajat_limiti') {
    const category = id(d.category_id)
    const m = /^(\d{4})-(\d{2})$/.exec(str(d, 'month'))
    if (!category || !m) return null
    const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate()
    const q = new URLSearchParams({
      tab: 'expenses',
      category,
      from: `${m[1]}-${m[2]}-01`,
      to: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}`,
    })
    return `/purchases?${q.toString()}`
  }
  if (!isExpenseAlert(a)) return null
  const record = id(d.record_id) ?? id(d.expense_id)
  return record ? `/purchases?tab=expenses&expense=${record}` : null
}
