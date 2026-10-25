// Ogohlantirish `details` (JSON) → qisqa o'zbekcha matn. Kalitlar bazadagi qoida funksiyalaridan:
//  1 (xarid_qabul_farqi): purchased_qty_base, received_qty_base, diff_pct, threshold_pct, direction
//  2 (ozi_qabul_qilgan): buyer_id, receiver_id, qty_base
//  3 (narx_ogishi): avg, price, diff_pct, window
//  smeta_ozgarishi: kind (norm_increase | old_version_restored | current_deleted), version,
//    materials[] { name|material_name, pct|increase_pct, exceeded|over_old_norm }, material_count
//  Batch 8 (docs/requests-design.md):
//  normadan_oshish: allowed_qty_base, consumed_qty_base, over_pct, not_in_estimate, base_unit
//  smetadan_ortiq_sorov: requested_qty_base, available_qty_base, over_qty_base, not_in_estimate, base_unit
//  inventarizatsiya_kamomadi: items[] { material_name, base_unit, shortage, shortage_value }, total_shortage_value, more_count
//  otkazma_farqi: sent_qty_base, received_qty_base, diff_qty_base, direction (under | over | not_received), hours, sent_at,
//    base_unit, from_object_name, to_object_name
//  inventarizatsiya_kamomadi: + not_counted [{ material_id, material_name, base_unit, expected, shortage_value }],
//    not_counted_more (son), applied_at, applied_by_name
//  smeta_ozgarishi kind = waste_changed: material_id, material_name, before, after (isrof %), actor_name
//  ozi_qabul_qilgan kind = transfer — o'tkazmani yuborgan o'zi qabul qilgan
//  Avtomatik yopilgan: auto_closed, closed_reason (within_threshold | estimate_changed | ...), closed_by_actor
import type { Alert } from '@/data/types'
import { parseDec } from '@/domain/decimal'
import { t } from '@/i18n'
import { formatDate, formatQty, formatSum } from '@/lib/format'

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
  if (a.type === 'ozi_qabul_qilgan') return d.kind === 'transfer' ? td.selfTransfer : td.self
  if (a.type === 'yozuv_ochirildi') return deletedText(d)
  if (a.type === 'smeta_ozgarishi') return estimateText(d)
  if (a.type === 'normadan_oshish') return normText(d, a.base_unit)
  if (a.type === 'smetadan_ortiq_sorov') return requestText(d, a.base_unit)
  if (a.type === 'inventarizatsiya_kamomadi') return inventoryText(d)
  if (a.type === 'otkazma_farqi') return transferText(d, a.base_unit)
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

/** Avtomatik yopilish sababi o'zbekcha (`details.closed_reason`); noma'lum yoki yo'q — null. */
export function autoCloseReason(a: Pick<Alert, 'details'>): string | null {
  const key = a.details.closed_reason
  if (typeof key !== 'string') return null
  return Object.prototype.hasOwnProperty.call(t.alertsPage.closedReasons, key) ? (t.alertsPage.closedReasons[key] ?? null) : null
}

/**
 * Smeta o'zgarishi. Kalitlar: kind (norm_increase | old_version_restored | current_deleted), estimate_id,
 * version, prev_version, materials?: [{ material_id, material_name, base_unit, before, after, diff_pct,
 * consumed, exceeded_before }], more_count?, actor_name. Raqamlar son yoki satr.
 */
const SHOWN_MATERIALS = 3

function versionLabel(d: Record<string, unknown>, key: string): string {
  const v = dec(d, key)
  return v !== null ? `v${v}` : ''
}

function estimateText(d: Record<string, unknown>): string {
  const version = versionLabel(d, 'version')
  const prev = versionLabel(d, 'prev_version')
  const actor = str(d, 'actor_name')
  if (d.kind === 'old_version_restored') return td.estimateOldRestored(prev, version, actor)
  if (d.kind === 'current_deleted') return td.estimateCurrentDeleted(version, actor)
  if (d.kind === 'waste_changed') {
    const before = dec(d, 'before')
    const after = dec(d, 'after')
    return td.estimateWasteChanged(str(d, 'material_name'), before !== null ? formatQty(before, 2) : '?', after !== null ? formatQty(after, 2) : '?', actor)
  }
  if (d.kind !== 'norm_increase') return td.estimateChanged
  const materials = (Array.isArray(d.materials) ? (d.materials as unknown[]) : []).filter(
    (m): m is Record<string, unknown> => typeof m === 'object' && m !== null,
  )
  // Chiqim eski normadan oshganlar birinchi (barqaror tartib)
  const ordered = [
    ...materials.filter((m) => m.exceeded_before === true),
    ...materials.filter((m) => m.exceeded_before !== true),
  ]
  const list = ordered
    .slice(0, SHOWN_MATERIALS)
    .map((m) => {
      const before = dec(m, 'before')
      const after = dec(m, 'after')
      const pct = dec(m, 'diff_pct')
      return td.estimateMaterial(
        str(m, 'material_name'),
        before !== null ? formatQty(before) : '?',
        after !== null ? formatQty(after) : '?',
        str(m, 'base_unit'),
        pct !== null ? formatQty(pct, 2) : '?',
        m.exceeded_before === true,
      )
    })
    .join(', ')
  const moreRaw = dec(d, 'more_count')
  const extra = moreRaw !== null ? Number(moreRaw) : 0
  const more = Math.max(0, materials.length - SHOWN_MATERIALS) + extra
  return td.estimateNormIncrease(prev, version, materials.length + extra, list, more)
}

function unitOf(d: Record<string, unknown>, fallback: string | null): string | null {
  return str(d, 'base_unit') || fallback
}

/** Qoida 4: "Sarf 1 200 kg, isrof bilan norma 1 000 kg — 20% oshgan". */
function normText(d: Record<string, unknown>, baseUnit: string | null): string {
  const unit = unitOf(d, baseUnit)
  const consumed = dec(d, 'consumed_qty_base')
  if (d.not_in_estimate === true) return td.normNotInEstimate(consumed !== null ? qty(consumed, unit) : '?')
  const allowed = dec(d, 'allowed_qty_base')
  const pct = dec(d, 'over_pct')
  if (consumed === null || allowed === null) return pct !== null ? td.diff(formatQty(pct, 2)) : ''
  return td.normOver(qty(consumed, unit), qty(allowed, unit), pct !== null ? formatQty(pct, 2) : '?')
}

/** Qoida 6: "So'raldi 500 kg, smetada qolgan 300 kg — 200 kg ortiq". */
function requestText(d: Record<string, unknown>, baseUnit: string | null): string {
  const unit = unitOf(d, baseUnit)
  const requested = dec(d, 'requested_qty_base')
  if (d.not_in_estimate === true) return td.requestNotInEstimate(requested !== null ? qty(requested, unit) : '?')
  const available = dec(d, 'available_qty_base')
  const over = dec(d, 'over_qty_base')
  return td.requestOver(
    requested !== null ? qty(requested, unit) : '?',
    available !== null ? qty(available, unit) : '?',
    over !== null ? qty(over, unit) : '?',
  )
}

const SHOWN_SHORTAGES = 3

/** Qoida 5: "Kamomad: 2 ta material — Sement −50 kg, Qum −1 m³. Jami: 120 000 so'm". */
function inventoryText(d: Record<string, unknown>): string {
  const items = (Array.isArray(d.items) ? (d.items as unknown[]) : []).filter(
    (m): m is Record<string, unknown> => typeof m === 'object' && m !== null,
  )
  const list = items
    .slice(0, SHOWN_SHORTAGES)
    .map((m) => {
      const shortage = dec(m, 'shortage')
      return td.inventoryItem(str(m, 'material_name'), shortage !== null ? qty(shortage, str(m, 'base_unit') || null) : '?')
    })
    .join(', ')
  const moreRaw = dec(d, 'more_count')
  const extra = moreRaw !== null ? Number(moreRaw) : 0
  const total = dec(d, 'total_shortage_value')
  const parts = [
    items.length + extra > 0 || total !== null
      ? td.inventoryShortage(items.length + extra, list, total !== null ? formatSum(total) : '', Math.max(0, items.length - SHOWN_SHORTAGES) + extra)
      : '',
  ]
  const notCountedMore = dec(d, 'not_counted_more')
  const notCounted = (Array.isArray(d.not_counted) ? d.not_counted.length : 0) + (notCountedMore !== null ? Number(notCountedMore) : 0)
  if (notCounted > 0) parts.push(td.inventoryNotCounted(notCounted))
  const appliedAt = str(d, 'applied_at')
  if (appliedAt) parts.push(td.inventoryApplied(str(d, 'applied_by_name'), formatDate(appliedAt)))
  return parts.filter(Boolean).join('. ')
}

/** O'tkazma farqi: "Obyekt A → Obyekt B: yuborildi 100 kg, qabul qilindi 90 kg (farq -10 kg)". */
function transferText(d: Record<string, unknown>, baseUnit: string | null): string {
  const unit = unitOf(d, baseUnit)
  const sent = dec(d, 'sent_qty_base')
  const received = dec(d, 'received_qty_base')
  const diff = dec(d, 'diff_qty_base')
  const show = (v: string | null) => (v !== null ? qty(v, unit) : '?')
  if (d.direction === 'not_received') {
    const hours = dec(d, 'hours')
    return td.transferNotReceived(show(sent), hours !== null ? formatQty(hours, 0) : '')
  }
  return td.transferDiff(str(d, 'from_object_name') || '?', str(d, 'to_object_name') || '?', show(sent), show(received), show(diff))
}
