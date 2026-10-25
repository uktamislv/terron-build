// Ogohlantirish `details` (JSON) → qisqa o'zbekcha matn. Kalitlar bazadagi qoida funksiyalaridan:
//  1 (xarid_qabul_farqi): purchased_qty_base, received_qty_base, diff_pct, threshold_pct, direction
//  2 (ozi_qabul_qilgan): buyer_id, receiver_id, qty_base
//  3 (narx_ogishi): avg, price, diff_pct, window
import type { Alert } from '@/data/types'
import { parseDec } from '@/domain/decimal'
import { t } from '@/i18n'
import { formatQty, formatSum } from '@/lib/format'

const td = t.alertsPage.details

function dec(details: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = details[key]
    if (typeof v === 'number' || typeof v === 'string') {
      const d = parseDec(String(v))
      if (d !== null) return d
    }
  }
  return null
}

function qty(value: string, unit: string | null): string {
  return `${formatQty(value)} ${unit ?? ''}`.trim()
}

export function alertDetailText(a: Pick<Alert, 'type' | 'details' | 'base_unit'>): string {
  const d = a.details
  const pct = dec(d, 'diff_pct')
  if (a.type === 'ozi_qabul_qilgan') return td.self
  if (a.type === 'yozuv_ochirildi') return deletedText(d)
  if (a.type === 'narx_ogishi') {
    const avg = dec(d, 'avg')
    if (avg !== null && pct !== null) {
      // diff_pct pastga og'ishda manfiy bo'lishi mumkin — matnda mutlaq qiymat
      const absPct = pct.startsWith('-') ? pct.slice(1) : pct
      const low = d.direction === 'low'
      return (low ? td.priceLow : td.price)(formatQty(absPct, 2), formatSum(avg))
    }
  }
  if (a.type === 'xarid_qabul_farqi') {
    const purchased = dec(d, 'purchased_qty_base')
    const received = dec(d, 'received_qty_base')
    if (purchased !== null && received !== null) {
      return td.receipt(qty(purchased, a.base_unit), qty(received, a.base_unit), formatQty(pct ?? '0', 2))
    }
  }
  return pct !== null ? td.diff(formatQty(pct, 2)) : ''
}

function str(details: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = details[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/**
 * `yozuv_ochirildi`: "Xarid o'chirildi: Sement · 1 250 000 so'm (Ali)". Kalitlar: `table`
 * (purchases | cash_advances | movements), ixtiyoriy `summary` yoki `material_name` + `amount`/`total_amount`,
 * `deleted_by_name`.
 */
function deletedText(d: Record<string, unknown>): string {
  const kinds = td.deletedKinds
  const table = str(d, 'table', 'table_name')
  const what = table === 'purchases' || table === 'cash_advances' || table === 'movements' ? kinds[table] : kinds.other
  const amount = dec(d, 'amount', 'total_amount')
  const parts = [str(d, 'summary'), str(d, 'material_name', 'recipient_name'), amount !== null ? formatSum(amount) : '']
  const summary = parts.filter(Boolean).join(' · ')
  return td.deleted(what, summary, str(d, 'deleted_by_name', 'actor_name'))
}

export function isAutoClosed(a: Pick<Alert, 'details'>): boolean {
  return a.details.auto_closed === true
}
