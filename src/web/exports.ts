// Jadval sahifalari uchun Excel ustunlari va qatorlari (sof). Fayl yaratish — `src/lib/excelExport.ts`.
import type { CashHistoryEntry } from '@/data/cashRepo'
import type { Alert, CashBalance, MaterialRequest, Movement, NormUsage, Purchase, StockBalance } from '@/data/types'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import type { ExportColumn, ExportRow, ExportSheetSpec } from '@/lib/excelExport'
import { alertDetailText } from './alerts/alertDetails'

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
        note: p.note,
        deleted: yesNo(p.deleted_at),
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
        { header: c.amount, key: 'amount', type: 'money' },
        { header: c.material, key: 'material', type: 'text' },
        { header: c.object, key: 'object', type: 'text' },
        { header: c.note, key: 'note', type: 'text' },
        { header: c.deleted, key: 'deleted', type: 'text' },
      ],
      rows: history.map(
        (h): ExportRow => ({
          at: h.at,
          person: h.profileName,
          kind: t.excel.cashKinds[h.kind],
          amount: h.amount,
          material: h.kind === 'spent' ? h.materialName : null,
          object: h.kind === 'spent' ? h.objectName : null,
          note: h.note,
          deleted: yesNo(h.deletedAt),
        }),
      ),
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
