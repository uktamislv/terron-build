// Ogohlantirish `details` (JSON) → qisqa o'zbekcha matn. Kalitlar bazadagi qoida funksiyalaridan:
//  1 (xarid_qabul_farqi): purchased_qty_base, received_qty_base, diff_pct, threshold_pct, direction
//  2 (ozi_qabul_qilgan): buyer_id, receiver_id, qty_base
//  3 (narx_ogishi): avg, price, diff_pct, window
//  smeta_ozgarishi: kind (norm_increase | old_version_restored | current_deleted), version,
//    materials[] { name|material_name, pct|increase_pct, exceeded|over_old_norm }, material_count
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
  if (a.type === 'smeta_ozgarishi') return estimateText(d)
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
