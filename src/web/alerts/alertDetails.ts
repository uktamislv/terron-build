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
//  yozuv_tiklandi (Batch 10): table, actor_name, material_name, amount, qty_base, base_unit, buyer_name,
//    recipient_name, movement_type, occurred_at, deleted_at_before, days_since
//  Avtomatik yopilgan: auto_closed, closed_reason (within_threshold | estimate_changed | ...), closed_by_actor
import type { Alert } from '@/data/types'
import { parseDec } from '@/domain/decimal'
import { t } from '@/i18n'
import { formatDate, formatDateTime, formatQty, formatQtyUnit, formatSum } from '@/lib/format'
import { expenseAlertLine, expenseLimitText, isExpenseAlert } from './expenseAlerts'

export { expenseAlertHref, expenseAlertLine } from './expenseAlerts'

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
  return formatQtyUnit(value, unit)
}

export function alertDetailText(a: Pick<Alert, 'type' | 'details' | 'base_unit'> & { object_name?: string | null }): string {
  const d = a.details
  if (a.type === 'xarajat_limiti') return expenseLimitText(d)
  if (isExpenseAlert(a)) return expenseAlertText(a)
  const pct = dec(d, 'diff_pct')
  if (a.type === 'ozi_qabul_qilgan') return d.kind === 'transfer' ? td.selfTransfer : td.self
  if (a.type === 'yozuv_ochirildi') return deletedText(d)
  if (a.type === 'yozuv_tiklandi') return restoredText(d)
  if (a.type === 'smeta_ozgarishi') return estimateText(d)
  if (a.type === 'normadan_oshish') return normText(d, a.base_unit)
  if (a.type === 'smetadan_ortiq_sorov') return requestText(d, a.base_unit)
  if (a.type === 'inventarizatsiya_kamomadi') return inventoryText(d)
  if (a.type === 'otkazma_farqi') return transferText(d, a.base_unit)
  const batch12 = automationText(a)
  if (batch12 !== null) return batch12
  const audit = auditText(a)
  if (audit !== null) return audit
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

/**
 * `yozuv_tiklandi`: "Kirim tiklandi: Sement · 1 500 kg · yozuv sanasi 01.09.2026 · 12 kun o'chirilgan edi (Ali)".
 */
function restoredText(d: Record<string, unknown>): string {
  const kinds = td.deletedKinds
  const table = str(d, 'table', 'table_name')
  const movementType = str(d, 'movement_type')
  const what =
    table === 'movements' && Object.hasOwn(t.movements.types, movementType)
      ? t.movements.types[movementType as keyof typeof t.movements.types]
      : table === 'purchases' || table === 'cash_advances' || table === 'movements'
        ? kinds[table]
        : kinds.other
  const qtyBase = dec(d, 'qty_base')
  const amount = dec(d, 'amount', 'total_amount')
  const days = dec(d, 'days_since')
  const date = str(d, 'occurred_at')
  const dateOk = date && !Number.isNaN(new Date(date).getTime())
  const parts = [
    str(d, 'material_name'),
    str(d, 'recipient_name', 'buyer_name'),
    qtyBase !== null ? qty(qtyBase, str(d, 'base_unit') || null) : '',
    amount !== null ? formatSum(amount) : '',
    dateOk ? td.restoredDate(formatDate(date)) : '',
    days !== null ? td.restoredAfter(formatQty(days, 0)) : '',
  ]
  return td.restored(what, parts.filter(Boolean).join(' · '), str(d, 'actor_name'))
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
  const during = movementsDuringCountText(d)
  if (during) parts.push(during)
  const appliedAt = str(d, 'applied_at')
  if (appliedAt) parts.push(td.inventoryApplied(str(d, 'applied_by_name'), formatDate(appliedAt)))
  return parts.filter(Boolean).join('. ')
}

/** Audit (A3): sanash paytida kiritilgan harakatlar — `movements_during_count`, `movements_during_count_total`. */
function movementsDuringCountText(d: Record<string, unknown>): string {
  const items = (Array.isArray(d.movements_during_count) ? (d.movements_during_count as unknown[]) : []).filter(
    (m): m is Record<string, unknown> => typeof m === 'object' && m !== null,
  )
  const totalRaw = dec(d, 'movements_during_count_total')
  const total = totalRaw !== null ? Number(totalRaw) : items.reduce((s, m) => s + (Number(dec(m, 'count') ?? 0) || 0), 0)
  if (!total) return ''
  const list = items
    .slice(0, SHOWN_SHORTAGES)
    .map((m) => td.movementsDuringItem(str(m, 'material_name'), formatQty(dec(m, 'count') ?? '0', 0)))
    .join(', ')
  return td.movementsDuringCount(total, list + (items.length > SHOWN_SHORTAGES ? '…' : ''))
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


// ---------------------------------------------------------------------------
// Batch 12 — `details` kalitlari docs/automation-design.md "Bildirishnoma payloadlari" bo'yicha:
//  kirim_manbasiz: reason (open_purchase | no_source | unlinked_candidate), qty_base, base_unit,
//    occurred_at, open_purchase_ids[], candidate_purchase_id
//  manfiy_qoldiq: stock_after, qty_base, unit, movement_type
//  takroriy_yozuv: kind (record | photo), table (movements | purchases), record_id, first_id;
//    record: window_minutes, qty_base, total_amount, movement_type; photo: first_table, sha256
//  joylashuv_farqi: distance_m, radius_m, accuracy_m, geo_lat, geo_lng, object_lat, object_lng, movement_type
//  smetasiz_chiqim: day, count, materials[{ material_id, material_name, qty_base, base_unit }]
//  chek_farqi: receipt_total, total_amount, diff, receipt_fiscal_sign, receipt_verified
//  sorovdan_ortiq_xarid: request_qty_base, purchased_qty_base, over_pct, threshold_pct, base_unit, purchase_count
//  podotchet_muddati: profile_id, profile_name, balance, oldest_open_at, days_open, max_days
//  podotchet_manfiy: profile_id, profile_name, balance
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Audit tuzatishlari — `details` kalitlari docs/audit-fixes.md "Yangi alert turlari" bo'yicha:
//  yozuv_ozgartirildi / yozuv_tuzatildi: table, record_id, changed[], before{}, after{} (o'zgargan
//    ustunlar + unit_input), via (direct | correct_entry), actor_profile_id, actor_name, author_id,
//    author_name, material_name, base_unit, movement_type (faqat harakat)
//  sozlama_ozgardi: changes[{ key, before, after }], actor_profile_id, actor_name
//  login_ozgardi: target_profile_id, target_name, target_role, actor_profile_id, actor_name, actor_role, changed_at
//  podotchet_belgisi: table, record_id, reasons[] (qaytarildi | issued_at_outside_window), cash_kind, amount,
//    issued_at, recipient_id, recipient_name, actor_profile_id, actor_name
//  sotuvchi_stir_farqi: seller_tin, supplier_id, supplier_name, supplier_tin, receipt_fiscal_sign
// ---------------------------------------------------------------------------

const ID_FIELDS = new Set(['object_id', 'material_id', 'purchase_id', 'buyer_id'])
const SUM_FIELDS = new Set(['total_amount', 'unit_price', 'price_per_base'])
const DATE_FIELDS = new Set(['occurred_at', 'purchased_at'])

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function shown(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : null
}

/** Bitta ustun qiymati matnda (birlik, summa, sana bilan). */
function fieldValue(key: string, side: Record<string, unknown>, baseUnit: string | null): string {
  const raw = shown(side[key])
  if (raw === null) return td.emptyValue
  if (key === 'qty_input') {
    const unit = shown(side.unit_input)
    const d = parseDec(raw)
    return d !== null ? qty(d, unit) : raw
  }
  if (key === 'qty_base') {
    const d = parseDec(raw)
    return d !== null ? qty(d, baseUnit) : raw
  }
  if (SUM_FIELDS.has(key)) {
    const d = parseDec(raw)
    return d !== null ? formatSum(d) : raw
  }
  if (DATE_FIELDS.has(key)) return Number.isNaN(new Date(raw).getTime()) ? raw : formatDateTime(raw)
  if (key === 'type' && Object.hasOwn(t.movements.types, raw)) return t.movements.types[raw as keyof typeof t.movements.types]
  return raw
}

/**
 * "Miqdor: 10 qop → 12 qop; Summa: 100 000 so'm → 120 000 so'm". Id ustunlari (obyekt, material, xaridor) —
 * faqat "o'zgardi". Birlik — `unit_input` bo'yicha; miqdor ko'rsatilsa asosiy birlikdagi qiymat takrorlanmaydi.
 */
export function entryChanges(d: Record<string, unknown>): string[] {
  const before = obj(d.before)
  const after = obj(d.after)
  const changed = (Array.isArray(d.changed) ? (d.changed as unknown[]) : Object.keys(after)).filter(
    (k): k is string => typeof k === 'string' && k !== 'unit_input',
  )
  const baseUnit = str(d, 'base_unit') || null
  const labels = td.changeFields
  const hasQty = changed.includes('qty_input') || changed.includes('unit_id')
  const out: string[] = []
  for (const key of changed) {
    if (key === 'qty_base' && hasQty) continue
    const label = labels[key] ?? key
    if (key === 'unit_id') {
      if (changed.includes('qty_input')) continue
      const b = shown(before.unit_input)
      const a = shown(after.unit_input)
      out.push(b !== null && a !== null ? td.change(label, b, a) : td.changeOnly(label))
      continue
    }
    if (ID_FIELDS.has(key)) {
      out.push(td.changeOnly(label))
      continue
    }
    out.push(td.change(label, fieldValue(key, before, baseUnit), fieldValue(key, after, baseUnit)))
  }
  return out
}

function entryWhat(d: Record<string, unknown>): string {
  const table = str(d, 'table')
  const type = str(d, 'movement_type')
  if (table === 'movements' && Object.hasOwn(t.movements.types, type)) return t.movements.types[type as keyof typeof t.movements.types]
  return table === 'purchases' || table === 'movements' ? td.deletedKinds[table] : td.deletedKinds.other
}

function settingValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return td.settingsOff
  const s = shown(v)
  if (s === null) return '?'
  // Vaqt ("22:00:00") — "22:00"
  const time = /^(\d{2}:\d{2}):\d{2}$/.exec(s)
  return time ? (time[1] ?? s) : s
}

/** Sozlama kaliti → yorliq (sozlamalar sahifasidagi nom), noma'lum — kalitning o'zi. */
function settingLabel(key: string): string {
  const s = t.settings
  const known: Record<string, string> = {
    receipt_mismatch_pct: s.receiptMismatchPct,
    price_deviation_pct: s.priceDeviationPct,
    price_avg_window: s.priceAvgWindow,
    photo_required_amount: s.photoRequiredAmount,
    cash_max_days: s.cashMaxDays,
    duplicate_window_minutes: s.duplicateWindowMinutes,
    request_overbuy_pct: s.requestOverbuyPct,
    alert_remind_hours: s.alertRemindHours,
    forecast_days_warn: s.forecastDaysWarn,
  }
  return known[key] ?? td.settingsKeys[key] ?? key
}

function auditText(a: Pick<Alert, 'type' | 'details' | 'base_unit'>): string | null {
  const d = a.details
  switch (a.type) {
    case 'yozuv_ozgartirildi':
    case 'yozuv_tuzatildi': {
      const changes = entryChanges(d).join('; ')
      const actor = str(d, 'actor_name')
      const author = str(d, 'author_name')
      // Sabab (correct_entry / cancel_own_entry) — oxirida
      const reason = str(d, 'reason')
      const why = reason ? td.reasonPart(reason) : ''
      if (a.type === 'yozuv_tuzatildi' && d.via === 'cancel_own_entry')
        return td.entryCancelled(entryWhat(d), str(d, 'material_name'), author || actor) + why
      if (a.type === 'yozuv_tuzatildi') return td.entryCorrected(entryWhat(d), str(d, 'material_name'), changes, author || actor) + why
      const who = [actor, author && author !== actor ? td.entryAuthor(author) : ''].filter(Boolean).join('; ')
      return td.entryChanged(entryWhat(d), str(d, 'material_name'), changes, who) + why
    }
    case 'sozlama_ozgardi': {
      const changes = (Array.isArray(d.changes) ? (d.changes as unknown[]) : [])
        .map(obj)
        .filter((c) => typeof c.key === 'string')
        .map((c) => td.change(settingLabel(String(c.key)), settingValue(c.before), settingValue(c.after)))
        .join('; ')
      const target = d.kind === 'material_control' || d.kind === 'expense_category_control' ? str(d, 'target_name') : ''
      if (target) return td.controlChanged(target, changes, str(d, 'actor_name'))
      return td.settingsChanged(changes, str(d, 'actor_name'))
    }
    case 'login_ozgardi': {
      const role = str(d, 'target_role')
      const roleLabel = Object.hasOwn(t.roles, role) ? t.roles[role as keyof typeof t.roles] : ''
      if (d.first_login === true) return td.loginFirst(str(d, 'target_name'), roleLabel, str(d, 'actor_name'))
      return td.loginChanged(str(d, 'target_name'), roleLabel, str(d, 'actor_name'))
    }
    case 'podotchet_belgisi': {
      const amount = dec(d, 'amount')
      const reasons = (Array.isArray(d.reasons) ? (d.reasons as unknown[]) : [])
        .filter((r): r is string => typeof r === 'string')
        .map((r) => td.cashFlagReasons[r] ?? r)
        .join(', ')
      const kind = td.cashFlagKinds[str(d, 'cash_kind')] ?? td.cashFlagKinds.berildi ?? ''
      const issued = str(d, 'issued_at')
      const date = issued && !Number.isNaN(new Date(issued).getTime()) ? formatDate(issued) : ''
      return td.cashFlag(str(d, 'recipient_name'), amount !== null ? formatSum(amount) : '?', kind, reasons, date)
    }
    case 'sotuvchi_stir_farqi':
      return td.sellerTin(str(d, 'seller_tin'), str(d, 'supplier_name'), str(d, 'supplier_tin'))
    case 'xarid_boshqa_nomidan': {
      const amount = dec(d, 'amount')
      const sum = amount !== null ? formatSum(amount) : ''
      const firma = d.payment_source === 'firma' ? ` (${td.purchaseOnBehalfFirma})` : ''
      return td.purchaseOnBehalf(str(d, 'actor_name'), str(d, 'buyer_name'), str(d, 'material_name'), sum) + firma
    }
    case 'sotuvchi_birlashtirildi': {
      const moved = dec(d, 'moved_count')
      return td.supplierMerged(str(d, 'merged_name'), str(d, 'keep_name'), moved !== null ? Number(moved) : 0, str(d, 'actor_name'))
    }
    default:
      return null
  }
}

function automationText(a: Pick<Alert, 'type' | 'details' | 'base_unit'>): string | null {
  const d = a.details
  const unit = unitOf(d, a.base_unit)
  const show = (v: string | null) => (v !== null ? qty(v, unit) : '?')
  switch (a.type) {
    case 'kirim_manbasiz': {
      const q = show(dec(d, 'qty_base'))
      if (d.reason === 'no_source') return td.unsourcedNoSource(q)
      if (d.reason === 'unlinked_candidate') return td.unsourcedCandidate(q)
      return td.unsourcedOpenPurchase(q)
    }
    case 'manfiy_qoldiq': {
      const u = str(d, 'unit') || a.base_unit
      const after = dec(d, 'stock_after')
      const q = dec(d, 'qty_base')
      const type = str(d, 'movement_type')
      const deleted = d.movement_deleted === true
      // Audit (A2): sabab istalgan tur bo'lishi mumkin (kirim o'chirildi, o'tkazma va h.k.)
      if (deleted || (type && type !== 'chiqim')) {
        const typeLabel = Object.hasOwn(t.movements.types, type)
          ? t.movements.types[type as keyof typeof t.movements.types]
          : td.deletedKinds.movements
        const cause = td.negativeCause(typeLabel, q !== null ? qty(q, u) : '', deleted)
        return `${td.negativeStock(after !== null ? qty(after, u) : '?', '')} (${cause})`
      }
      const reopenN = dec(d, 'reopen_count')
      const reopenAt = str(d, 'reopened_at')
      const reopened =
        reopenN !== null && Number(reopenN) > 0
          ? td.negativeReopened(formatQty(reopenN, 0), reopenAt && !Number.isNaN(Date.parse(reopenAt)) ? formatDateTime(reopenAt) : '')
          : ''
      return td.negativeStock(after !== null ? qty(after, u) : '?', q !== null ? qty(q, u) : '') + reopened
    }
    case 'takroriy_yozuv': {
      const table = str(d, 'table')
      const what = td.duplicateKinds[table] ?? td.duplicateKinds.other ?? ''
      if (d.kind === 'photo') return td.duplicatePhoto(what)
      const minutes = dec(d, 'window_minutes')
      return minutes !== null ? td.duplicateEntryWindow(what, formatQty(minutes, 0)) : td.duplicateEntry(what)
    }
    case 'joylashuv_farqi': {
      const distance = dec(d, 'distance_m')
      const radius = dec(d, 'radius_m')
      if (distance === null || radius === null) return td.locationFarShort
      const accuracy = dec(d, 'accuracy_m')
      const base = td.locationFar(formatQty(distance, 0), formatQty(radius, 0))
      return accuracy !== null ? `${base}${td.locationAccuracy(formatQty(accuracy, 0))}` : base
    }
    case 'smetasiz_chiqim': {
      const materials = (Array.isArray(d.materials) ? (d.materials as unknown[]) : []).filter(
        (m): m is Record<string, unknown> => typeof m === 'object' && m !== null,
      )
      const names = materials.map((m) => {
        const q = dec(m, 'qty_base')
        const name = str(m, 'material_name')
        return q !== null ? `${name} ${qty(q, str(m, 'base_unit') || null)}` : name
      })
      const count = dec(d, 'count')
      const list = names.slice(0, SHOWN_MATERIALS).join(', ') + (names.length > SHOWN_MATERIALS ? '…' : '')
      return td.noEstimateOut(count !== null ? Number(count) : materials.length, list)
    }
    case 'chek_farqi': {
      const receipt = dec(d, 'receipt_total')
      const entered = dec(d, 'total_amount')
      return td.receiptTotal(receipt !== null ? formatSum(receipt) : '?', entered !== null ? formatSum(entered) : '?')
    }
    case 'sorovdan_ortiq_xarid': {
      const pct = dec(d, 'over_pct')
      return td.requestOverbuy(
        show(dec(d, 'request_qty_base')),
        show(dec(d, 'purchased_qty_base')),
        pct !== null ? formatQty(pct, 2) : '',
      )
    }
    case 'podotchet_muddati': {
      const balance = dec(d, 'balance')
      const days = dec(d, 'days_open')
      return td.cashOverdue(str(d, 'profile_name'), balance !== null ? formatSum(balance) : '?', days !== null ? formatQty(days, 0) : '')
    }
    case 'podotchet_manfiy': {
      const balance = dec(d, 'balance')
      return td.cashNegative(str(d, 'profile_name'), balance !== null ? formatSum(balance) : '?')
    }
    default:
      return null
  }
}

/** Xarajat ogohlantirishi: "Xarajat: tur · summa · obyekt|Umumiy" + tur bo'yicha izoh. */
function expenseAlertText(a: Pick<Alert, 'type' | 'details' | 'base_unit'> & { object_name?: string | null }): string {
  const d = a.details
  const line = expenseAlertLine(a)
  const what = td.deletedKinds.expenses ?? ''
  let extra: string
  switch (a.type) {
    case 'xarid_boshqa_nomidan':
      extra = t.expenses.onBehalf(str(d, 'actor_name'), str(d, 'payer_name', 'buyer_name'))
      break
    case 'chek_farqi': {
      const receipt = dec(d, 'receipt_total')
      const entered = dec(d, 'total_amount', 'amount')
      extra = td.receiptTotal(receipt !== null ? formatSum(receipt) : '?', entered !== null ? formatSum(entered) : '?')
      break
    }
    case 'sotuvchi_stir_farqi':
      extra = td.sellerTin(str(d, 'seller_tin'), str(d, 'supplier_name'), str(d, 'supplier_tin'))
      break
    case 'takroriy_yozuv': {
      const minutes = dec(d, 'window_minutes')
      extra =
        d.kind === 'photo'
          ? td.duplicatePhoto(what)
          : minutes !== null
            ? td.duplicateEntryWindow(what, formatQty(minutes, 0))
            : td.duplicateEntry(what)
      break
    }
    case 'yozuv_ochirildi':
      extra = td.deleted(what, '', str(d, 'deleted_by_name', 'actor_name'))
      break
    case 'yozuv_tiklandi':
      extra = td.restored(what, '', str(d, 'actor_name'))
      break
    case 'yozuv_ozgartirildi':
    case 'yozuv_tuzatildi': {
      const reason = str(d, 'reason')
      const why = reason ? td.reasonPart(reason) : ''
      const changes = entryChanges(d).join('; ')
      if (a.type === 'yozuv_tuzatildi' && d.via === 'cancel_own_entry') extra = td.entryCancelled(what, '', str(d, 'author_name', 'actor_name')) + why
      else if (a.type === 'yozuv_tuzatildi') extra = td.entryCorrected(what, '', changes, str(d, 'author_name', 'actor_name')) + why
      else extra = td.entryChanged(what, '', changes, str(d, 'actor_name')) + why
      break
    }
    default:
      extra = ''
  }
  return extra ? `${line}. ${extra}` : line
}
