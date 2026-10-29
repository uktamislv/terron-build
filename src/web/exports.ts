// Jadval sahifalari uchun Excel ustunlari va qatorlari (sof). Fayl yaratish — `src/lib/excelExport.ts`.
import type { CashHistoryEntry } from '@/data/cashRepo'
import type { AuditEntry, RefNames } from '@/data/historyRepo'
import type {
  Alert,
  CashBalance,
  EstimateItem,
  Expense,
  InventoryDetailRow,
  Material,
  MaterialRequest,
  Movement,
  NormUsage,
  Purchase,
  StockBalance,
  Transfer,
} from '@/data/types'
import { cmp, sub } from '@/domain/decimal'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import type { ExportColumn, ExportRow, ExportSheetSpec } from '@/lib/excelExport'
import { alertDetailText } from './alerts/alertDetails'
import { actionLabel, changesText, entryChanges, entryTitle, tableLabel } from './history/historyFormat'

const c = t.excel.cols
const s = t.excel.sheets

function yesNo(v: unknown): string {
  return v ? t.common.yes : ''
}

export function movementsSheet(rows: Movement[]): ExportSheetSpec {
  const columns: ExportColumn[] = [
    { header: c.date, key: 'occurred_at', type: 'datetime' },
    { header: c.type, key: 'type', type: 'text' },
    { header: c.object, key: 'object', type: 'text' },
    { header: c.material, key: 'material', type: 'text' },
    { header: c.qtyInput, key: 'qty_input', type: 'qty' },
    { header: c.unitInput, key: 'unit', type: 'text' },
    { header: c.qtyBase, key: 'qty_base', type: 'qty' },
    { header: c.baseUnit, key: 'base_unit', type: 'text' },
    { header: c.user, key: 'user', type: 'text' },
    { header: c.note, key: 'note', type: 'text' },
    { header: c.deleted, key: 'deleted', type: 'text' },
  ]
  return {
    sheetName: s.movements,
    columns,
    rows: rows.map(
      (m): ExportRow => ({
        occurred_at: m.occurred_at,
        type: t.movements.types[m.type],
        object: m.object_name,
        material: m.material_name,
        qty_input: m.qty_input,
        unit: unitLabel({ unit: m.unit_input, variant: m.unit_variant }),
        qty_base: m.qty_base,
        base_unit: m.base_unit,
        user: m.created_by_name,
        note: m.note,
        deleted: yesNo(m.deleted_at),
      }),
    ),
  }
}

export interface NamedStock extends StockBalance {
  objectName: string
  materialName: string
  baseUnit: string
}

export function stockSheet(rows: NamedStock[]): ExportSheetSpec {
  return {
    sheetName: s.stock,
    columns: [
      { header: c.object, key: 'objectName', type: 'text' },
      { header: c.material, key: 'materialName', type: 'text' },
      { header: c.stock, key: 'qty_base', type: 'qty' },
      { header: c.baseUnit, key: 'baseUnit', type: 'text' },
      { header: c.lastMovement, key: 'last_movement_at', type: 'datetime' },
    ],
    rows: rows.map((r): ExportRow => ({ ...r })),
  }
}

export function purchasesSheet(rows: Purchase[]): ExportSheetSpec {
  return {
    sheetName: s.purchases,
    columns: [
      { header: c.date, key: 'purchased_at', type: 'datetime' },
      { header: c.object, key: 'object', type: 'text' },
      { header: c.material, key: 'material', type: 'text' },
      { header: c.qtyInput, key: 'qty_input', type: 'qty' },
      { header: c.unitInput, key: 'unit', type: 'text' },
      { header: c.qtyBase, key: 'qty_base', type: 'qty' },
      { header: c.baseUnit, key: 'base_unit', type: 'text' },
      { header: c.total, key: 'total_amount', type: 'money' },
      { header: c.unitPrice, key: 'unit_price', type: 'money' },
      { header: c.received, key: 'received', type: 'qty' },
      { header: c.remaining, key: 'remaining', type: 'qty' },
      { header: c.buyer, key: 'buyer', type: 'text' },
      { header: c.supplier, key: 'supplier', type: 'text' },
      { header: c.paymentSource, key: 'payment_source', type: 'text' },
      { header: c.note, key: 'note', type: 'text' },
      { header: c.deleted, key: 'deleted', type: 'text' },
    ],
    rows: rows.map(
      (p): ExportRow => ({
        purchased_at: p.purchased_at,
        object: p.object_name,
        material: p.material_name,
        qty_input: p.qty_input,
        unit: unitLabel({ unit: p.unit_input, variant: p.unit_variant }),
        qty_base: p.qty_base,
        base_unit: p.base_unit,
        total_amount: p.total_amount,
        unit_price: p.unit_price,
        received: p.receipt?.received_qty_base ?? null,
        remaining: p.receipt?.remaining_qty_base ?? null,
        buyer: p.buyer_name,
        supplier: p.supplier_name,
        payment_source: p.payment_source ? t.purchases.paymentSources[p.payment_source] : null,
        note: p.note,
        deleted: yesNo(p.deleted_at),
      }),
    ),
  }
}

/** O'tkazmalar: yuborilgan, qabul qilingan, farq (asosiy birlikda), holat. */
export function transfersSheet(rows: Transfer[]): ExportSheetSpec {
  return {
    sheetName: s.transfers,
    columns: [
      { header: c.date, key: 'created_at', type: 'datetime' },
      { header: c.from, key: 'from', type: 'text' },
      { header: c.to, key: 'to', type: 'text' },
      { header: c.material, key: 'material', type: 'text' },
      { header: c.qtyInput, key: 'qty_input', type: 'qty' },
      { header: c.unitInput, key: 'unit', type: 'text' },
      { header: c.sent, key: 'qty_base', type: 'qty' },
      { header: c.received, key: 'received', type: 'qty' },
      { header: c.diff, key: 'diff', type: 'qty' },
      { header: c.baseUnit, key: 'base_unit', type: 'text' },
      { header: c.status, key: 'status', type: 'text' },
      { header: c.receivedAt, key: 'received_at', type: 'datetime' },
      { header: c.user, key: 'user', type: 'text' },
      { header: c.cancelReason, key: 'cancel_reason', type: 'text' },
      { header: c.note, key: 'note', type: 'text' },
    ],
    rows: rows.map(
      (r): ExportRow => ({
        created_at: r.created_at,
        from: r.from_object_name,
        to: r.to_object_name,
        material: r.material_name,
        qty_input: r.qty_input,
        unit: unitLabel({ unit: r.unit_input, variant: r.unit_variant }),
        qty_base: r.qty_base,
        received: r.received_qty_base,
        diff: r.received_qty_base !== null ? sub(r.received_qty_base, r.qty_base) : null,
        base_unit: r.base_unit,
        status: t.transfers.statuses[r.status],
        received_at: r.received_at,
        user: r.created_by_name,
        cancel_reason: r.cancel_reason,
        note: r.note,
      }),
    ),
  }
}

/**
 * Inventarizatsiya natijasi: kamomadlar birinchi (qiymati bilan), keyin ortiqcha va farqsizlar.
 * Sanalmagan material — sanalgan bo'sh.
 */
export function inventorySheet(rows: InventoryDetailRow[], meta: { objectName: string | null; countedAt: string }): ExportSheetSpec {
  const shortage = (r: InventoryDetailRow) => r.diff !== null && cmp(r.diff, '0') < 0
  const ordered = [...rows.filter(shortage), ...rows.filter((r) => !shortage(r))]
  return {
    sheetName: s.inventory,
    columns: [
      { header: c.date, key: 'counted_at', type: 'datetime' },
      { header: c.object, key: 'object', type: 'text' },
      { header: c.material, key: 'material', type: 'text' },
      { header: c.expected, key: 'expected', type: 'qty' },
      { header: c.counted, key: 'counted', type: 'qty' },
      { header: c.diff, key: 'diff', type: 'qty' },
      { header: c.baseUnit, key: 'base_unit', type: 'text' },
      { header: c.shortageValue, key: 'shortage_value', type: 'money' },
    ],
    rows: ordered.map(
      (r): ExportRow => ({
        counted_at: meta.countedAt,
        object: meta.objectName,
        material: r.material_name,
        expected: r.qty_expected,
        counted: r.qty_counted,
        diff: r.diff,
        base_unit: r.base_unit,
        shortage_value: r.shortage_value,
      }),
    ),
  }
}

/** Katalog: materiallar va (ikkinchi varaq) birliklar koeffitsientlari bilan. */
export function materialsSheets(materials: Material[]): ExportSheetSpec[] {
  return [
    {
      sheetName: s.materials,
      columns: [
        { header: c.name, key: 'name', type: 'text' },
        { header: c.baseUnit, key: 'base_unit', type: 'text' },
        { header: c.category, key: 'category', type: 'text' },
        { header: c.wastePct, key: 'waste_pct', type: 'qty' },
        { header: c.active, key: 'active', type: 'text' },
        { header: c.photoRequired, key: 'photo_required', type: 'text' },
        { header: c.outsideEstimate, key: 'outside_estimate', type: 'text' },
        { header: c.aliases, key: 'aliases', type: 'text' },
      ],
      rows: materials.map(
        (m): ExportRow => ({
          name: m.name,
          base_unit: m.base_unit,
          category: m.category,
          waste_pct: m.waste_pct,
          active: yesNo(m.is_active),
          photo_required: yesNo(m.photo_required),
          outside_estimate: yesNo(m.outside_estimate),
          aliases: m.aliases.map((a) => a.alias).join(', '),
        }),
      ),
    },
    {
      sheetName: s.units,
      columns: [
        { header: c.material, key: 'material', type: 'text' },
        { header: c.unit, key: 'unit', type: 'text' },
        { header: c.variant, key: 'variant', type: 'text' },
        { header: c.factor, key: 'factor', type: 'qty' },
        { header: c.baseUnit, key: 'base_unit', type: 'text' },
      ],
      rows: materials.flatMap((m) =>
        m.units.map(
          (u): ExportRow => ({ material: m.name, unit: u.unit, variant: u.variant, factor: u.factor, base_unit: m.base_unit }),
        ),
      ),
    },
  ]
}

/** Smeta qatorlari (joriy versiya): shifr, nom, birlik, miqdor, narx, summa, norma. */
export function estimateItemsSheet(rows: EstimateItem[]): ExportSheetSpec {
  return {
    sheetName: s.estimate,
    columns: [
      { header: c.rowNumber, key: 'row_number', type: 'number' },
      { header: c.code, key: 'code', type: 'text' },
      { header: c.itemType, key: 'item_type', type: 'text' },
      { header: c.name, key: 'name', type: 'text' },
      { header: c.material, key: 'material', type: 'text' },
      { header: c.unit, key: 'unit', type: 'text' },
      { header: c.qty, key: 'qty', type: 'qty' },
      { header: c.price, key: 'unit_price', type: 'money' },
      { header: c.lineSum, key: 'line_sum', type: 'money' },
      { header: c.normBase, key: 'norm_qty_base', type: 'qty' },
      { header: c.baseUnit, key: 'base_unit', type: 'text' },
    ],
    rows: rows.map(
      (r): ExportRow => ({
        row_number: r.row_number,
        code: r.code,
        item_type: t.excel.itemTypes[r.item_type],
        name: r.name,
        material: r.material_name,
        unit: r.unit,
        qty: r.qty,
        unit_price: r.unit_price,
        line_sum: r.line_sum,
        norm_qty_base: r.norm_qty_base,
        base_unit: r.base_unit,
      }),
    ),
  }
}

export function cashSheets(
  balances: (CashBalance & { name: string })[],
  history: CashHistoryEntry[],
): ExportSheetSpec[] {
  return [
    {
      sheetName: s.cashBalances,
      columns: [
        { header: c.person, key: 'name', type: 'text' },
        { header: c.issued, key: 'issued_total', type: 'money' },
        { header: c.returned, key: 'returned_total', type: 'money' },
        { header: c.spent, key: 'spent_total', type: 'money' },
        { header: c.balance, key: 'balance', type: 'money' },
      ],
      rows: balances.map((b): ExportRow => ({ ...b })),
    },
    {
      sheetName: s.cashHistory,
      columns: [
        { header: c.date, key: 'at', type: 'datetime' },
        { header: c.person, key: 'person', type: 'text' },
        { header: c.kind, key: 'kind', type: 'text' },
        { header: c.source, key: 'source', type: 'text' },
        { header: c.amount, key: 'amount', type: 'money' },
        { header: c.material, key: 'material', type: 'text' },
        { header: c.expenseCategory, key: 'category', type: 'text' },
        { header: c.object, key: 'object', type: 'text' },
        { header: c.note, key: 'note', type: 'text' },
        { header: c.deleted, key: 'deleted', type: 'text' },
      ],
      rows: history.map((h): ExportRow => {
        // Sarf: xarid (material) yoki xarajat (xarajat turi; obyektsiz — "Umumiy")
        const expense = h.kind === 'spent' && h.source === 'expense'
        return {
          at: h.at,
          person: h.profileName,
          kind: expense ? t.excel.cashKinds.spentExpense : t.excel.cashKinds[h.kind],
          source: h.kind === 'spent' ? t.excel.sources[expense ? 'expense' : 'purchase'] : null,
          amount: h.amount,
          material: h.kind === 'spent' && !expense ? h.materialName : null,
          category: expense ? h.materialName : null,
          object: h.kind === 'spent' ? (expense ? (h.objectName ?? t.expenses.general) : h.objectName) : null,
          note: h.note,
          deleted: yesNo(h.deletedAt),
        }
      }),
    },
  ]
}

export function requestsSheet(rows: MaterialRequest[]): ExportSheetSpec {
  return {
    sheetName: s.requests,
    columns: [
      { header: c.date, key: 'created_at', type: 'datetime' },
      { header: c.object, key: 'object', type: 'text' },
      { header: c.material, key: 'material', type: 'text' },
      { header: c.qtyInput, key: 'qty_input', type: 'qty' },
      { header: c.unitInput, key: 'unit', type: 'text' },
      { header: c.qtyBase, key: 'qty_base', type: 'qty' },
      { header: c.baseUnit, key: 'base_unit', type: 'text' },
      { header: c.status, key: 'status', type: 'text' },
      { header: c.neededBy, key: 'needed_by', type: 'date' },
      { header: c.user, key: 'user', type: 'text' },
      { header: c.decidedBy, key: 'decided_by', type: 'text' },
      { header: c.note, key: 'note', type: 'text' },
    ],
    rows: rows.map(
      (r): ExportRow => ({
        created_at: r.created_at,
        object: r.object_name,
        material: r.material_name,
        qty_input: r.qty_input,
        unit: unitLabel({ unit: r.unit_input, variant: r.unit_variant }),
        qty_base: r.qty_base,
        base_unit: r.base_unit,
        status: t.requests.statuses[r.status],
        needed_by: r.needed_by,
        user: r.created_by_name,
        decided_by: r.decided_by_name,
        note: [r.note, r.decision_note].filter(Boolean).join(' · '),
      }),
    ),
  }
}

export function alertsSheet(rows: Alert[]): ExportSheetSpec {
  return {
    sheetName: s.alerts,
    columns: [
      { header: c.date, key: 'created_at', type: 'datetime' },
      { header: c.type, key: 'type', type: 'text' },
      { header: c.severity, key: 'severity', type: 'text' },
      { header: c.status, key: 'status', type: 'text' },
      { header: c.object, key: 'object', type: 'text' },
      { header: c.material, key: 'material', type: 'text' },
      { header: c.details, key: 'details', type: 'text', width: 60 },
    ],
    rows: rows.map(
      (a): ExportRow => ({
        created_at: a.created_at,
        type: t.alertTexts.types[a.type],
        severity: t.alertTexts.severities[a.severity],
        status: t.alertTexts.statuses[a.status],
        object: a.object_name,
        material: a.material_name,
        details: alertDetailText(a),
      }),
    ),
  }
}

export function normsSheet(rows: (NormUsage & { name: string; unit: string })[]): ExportSheetSpec {
  return {
    sheetName: s.norms,
    columns: [
      { header: c.material, key: 'name', type: 'text' },
      { header: c.baseUnit, key: 'unit', type: 'text' },
      { header: c.norm, key: 'norm_qty_base', type: 'qty' },
      { header: c.allowed, key: 'allowed_qty_base', type: 'qty' },
      { header: c.consumed, key: 'consumed_qty_base', type: 'qty' },
      { header: c.remaining, key: 'remaining_qty_base', type: 'qty' },
      { header: c.usagePct, key: 'usage_pct', type: 'number' },
    ],
    rows: rows.map((r): ExportRow => ({ ...r })),
  }
}

/** Tarix (Batch 10): har audit yozuvi — bitta qator, o'zgarishlar "Maydon: oldin → keyin" matnida. */
export function historySheet(rows: AuditEntry[], names: RefNames): ExportSheetSpec {
  const th = t.history
  return {
    sheetName: th.exportSheet,
    columns: [
      { header: th.colWhen, key: 'created_at', type: 'datetime' },
      { header: th.colTable, key: 'table', type: 'text' },
      { header: th.colRecord, key: 'record', type: 'text', width: 36 },
      { header: th.colAction, key: 'action', type: 'text' },
      { header: th.colWho, key: 'actor', type: 'text' },
      { header: th.colDevice, key: 'device', type: 'text' },
      { header: th.exportChanges, key: 'changes', type: 'text', width: 80 },
    ],
    rows: rows.map(
      (e): ExportRow => ({
        created_at: e.created_at,
        table: tableLabel(e.table_name),
        record: entryTitle(e),
        action: actionLabel(e.action),
        actor: e.actor_name ?? (e.device === 'tizim' ? th.system : th.noActor),
        device: e.device ? th.devices[e.device] : '',
        changes: changesText(e.table_name, entryChanges(e), names),
      }),
    ),
  }
}

/** Xarajatlar (ombordan tashqari): har xarajat — bitta qator; summa raqam katakchasi. */
export function expensesSheet(rows: Expense[]): ExportSheetSpec {
  const te = t.expenses
  return {
    sheetName: te.exportSheet,
    columns: [
      { header: te.colDate, key: 'spent_at', type: 'datetime' },
      { header: te.colCategory, key: 'category', type: 'text' },
      { header: te.colObject, key: 'object', type: 'text' },
      { header: te.colAmount, key: 'amount', type: 'money' },
      { header: te.colPayer, key: 'payer', type: 'text' },
      { header: te.colPaymentSource, key: 'payment_source', type: 'text' },
      { header: c.supplier, key: 'supplier', type: 'text' },
      { header: te.colNote, key: 'note', type: 'text' },
      { header: te.colReceipt, key: 'receipt', type: 'text' },
      { header: c.deleted, key: 'deleted', type: 'text' },
    ],
    rows: rows.map(
      (e): ExportRow => ({
        spent_at: e.spent_at,
        category: e.category_name,
        object: e.object_name ?? te.general,
        amount: e.amount,
        payer: e.payer_name,
        payment_source: t.purchases.paymentSources[e.payment_source],
        supplier: e.supplier_name,
        note: e.note,
        receipt: yesNo(e.receipt_photo_path),
        deleted: yesNo(e.deleted_at),
      }),
    ),
  }
}
