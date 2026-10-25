import { describe, expect, it } from 'vitest'
import { fieldKind, fieldOrder, HISTORY_TABLES, tableColumns, type FieldKind } from './fields'

// Migratsiyalardan ustunlar ro'yxati: create table + alter table ... add column.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

type Col = { table: string; column: string; sqlType: string }

function parseColumns(): Col[] {
  const cols: Col[] = []
  const files = Object.keys(MIGRATIONS).sort()
  for (const file of files) {
    const sql = (MIGRATIONS[file] ?? '').replace(/\r\n/g, '\n').replace(/--[^\n]*/g, '')
    for (const m of sql.matchAll(/create table public\.(\w+) \(([\s\S]*?)\n\);/g)) {
      const table = m[1] as string
      for (const line of (m[2] as string).split('\n')) {
        // Ustun ta'rifi — aynan 2 bo'shliq bilan boshlanadi (davom qatorlari chuqurroq)
        const c = /^ {2}([a-z_][a-z0-9_]*)\s+(uuid|text|integer|bigint|boolean|timestamptz|date|jsonb|numeric\(\d+,\d+\)|public\.\w+)(?![\w.])/.exec(line)
        if (!c || c[1] === 'constraint') continue
        cols.push({ table, column: c[1] as string, sqlType: c[2] as string })
      }
    }
    for (const m of sql.matchAll(/alter table public\.(\w+)\s([\s\S]*?);/g)) {
      const table = m[1] as string
      for (const a of (m[2] as string).matchAll(/add column (\w+)\s+([a-z_.]+(?:\(\d+,\d+\))?)/g)) {
        cols.push({ table, column: a[1] as string, sqlType: a[2] as string })
      }
    }
  }
  return cols
}

/** SQL turi → ruxsat etilgan FieldKind'lar. */
function allowedKinds(sqlType: string): FieldKind[] {
  if (sqlType === 'numeric(18,2)' || sqlType === 'numeric(18,4)') return ['money']
  if (sqlType === 'numeric(20,6)' || sqlType === 'numeric(20,10)') return ['qty']
  if (sqlType === 'numeric(6,2)') return ['pct']
  if (sqlType === 'numeric(9,6)') return ['text'] // koordinatalar
  if (sqlType === 'timestamptz') return ['datetime']
  if (sqlType === 'date') return ['date']
  if (sqlType === 'boolean') return ['bool']
  if (sqlType === 'jsonb') return ['json']
  if (sqlType.startsWith('public.')) return ['enum']
  if (sqlType === 'uuid') {
    return ['text', 'ref_object', 'ref_material', 'ref_profile', 'ref_unit', 'ref_supplier', 'ref_purchase']
  }
  if (sqlType === 'integer') return ['qty', 'text']
  if (sqlType === 'bigint') return ['text']
  if (sqlType === 'text') return ['text', 'enum']
  return []
}

describe('migratsiyalar bilan xarita', () => {
  const cols = parseColumns().filter((c) => HISTORY_TABLES.includes(c.table))

  it('parser barcha tarix jadvallarini topadi', () => {
    const found = new Set(cols.map((c) => c.table))
    expect([...found].sort()).toEqual([...HISTORY_TABLES].sort())
    expect(cols.length).toBeGreaterThan(150)
  })

  it("har ustun xaritada aniq ko'rsatilgan (tableColumns)", () => {
    const missing = cols.filter((c) => !tableColumns(c.table).includes(c.column)).map((c) => `${c.table}.${c.column}`)
    expect(missing).toEqual([])
  })

  it("xaritada migratsiyada yo'q ustun yo'q", () => {
    for (const table of HISTORY_TABLES) {
      const sqlCols = new Set(cols.filter((c) => c.table === table).map((c) => c.column))
      expect(
        tableColumns(table).filter((c) => !sqlCols.has(c)),
        table,
      ).toEqual([])
    }
  })

  it('fieldKind SQL turiga mos', () => {
    const bad = cols
      .filter((c) => !allowedKinds(c.sqlType).includes(fieldKind(c.table, c.column)))
      .map((c) => `${c.table}.${c.column}:${c.sqlType}→${fieldKind(c.table, c.column)}`)
    expect(bad).toEqual([])
  })

  it('*_id uuid ustunlari — tegishli ref turi', () => {
    const refs: Record<string, FieldKind> = {
      object_id: 'ref_object',
      from_object_id: 'ref_object',
      to_object_id: 'ref_object',
      material_id: 'ref_material',
      unit_id: 'ref_unit',
      supplier_id: 'ref_supplier',
      purchase_id: 'ref_purchase',
      profile_id: 'ref_profile',
      recipient_id: 'ref_profile',
      buyer_id: 'ref_profile',
    }
    for (const c of cols) {
      const want = refs[c.column]
      if (want) expect(fieldKind(c.table, c.column), `${c.table}.${c.column}`).toBe(want)
    }
  })
})

describe('fieldKind', () => {
  it('namunalar', () => {
    expect(fieldKind('purchases', 'total_amount')).toBe('money')
    expect(fieldKind('purchases', 'unit_price')).toBe('money')
    expect(fieldKind('purchases', 'supplier_id')).toBe('ref_supplier')
    expect(fieldKind('purchases', 'buyer_id')).toBe('ref_profile')
    expect(fieldKind('movements', 'qty_base')).toBe('qty')
    expect(fieldKind('movements', 'object_id')).toBe('ref_object')
    expect(fieldKind('movements', 'purchase_id')).toBe('ref_purchase')
    expect(fieldKind('movements', 'type')).toBe('enum')
    expect(fieldKind('movements', 'unit_id')).toBe('ref_unit')
    expect(fieldKind('profiles', 'role')).toBe('enum')
    expect(fieldKind('profiles', 'login_kind')).toBe('enum')
    expect(fieldKind('materials', 'waste_pct')).toBe('pct')
    expect(fieldKind('materials', 'is_active')).toBe('bool')
    expect(fieldKind('material_requests', 'needed_by')).toBe('date')
    expect(fieldKind('material_requests', 'decided_by')).toBe('ref_profile')
    expect(fieldKind('estimates', 'estimate_date')).toBe('date')
    expect(fieldKind('alerts', 'details')).toBe('json')
    expect(fieldKind('cash_advances', 'amount')).toBe('money')
    expect(fieldKind('companies', 'price_deviation_pct')).toBe('pct')
  })

  it('umumiy ustunlar', () => {
    expect(fieldKind('movements', 'deleted_at')).toBe('datetime')
    expect(fieldKind('movements', 'created_by')).toBe('ref_profile')
    expect(fieldKind('movements', 'id')).toBe('text')
  })

  it("*_at → datetime (noma'lum jadvalda ham)", () => {
    expect(fieldKind('nomalum', 'something_at')).toBe('datetime')
    expect(fieldKind('purchases', 'purchased_at')).toBe('datetime')
  })

  it("noma'lum jadval/maydon → text", () => {
    expect(fieldKind('nomalum', 'foo')).toBe('text')
    expect(fieldKind('purchases', 'foo')).toBe('text')
    expect(fieldKind('', '')).toBe('text')
    expect(fieldKind('purchases', 'constructor')).toBe('text')
    expect(fieldKind('__proto__', 'toString')).toBe('text')
  })
})

describe('fieldOrder', () => {
  it('asosiy maydonlar avval, qolganlari alifbo tartibida', () => {
    const order = fieldOrder('purchases')
    expect(order.slice(0, 6)).toEqual(['material_id', 'qty_input', 'unit_input', 'unit_variant', 'qty_base', 'total_amount'])
    const primaryCount = order.indexOf('supplier_id') + 1
    const rest = order.slice(primaryCount)
    expect(rest).toEqual([...rest].sort())
  })

  it('nom birinchi', () => {
    expect(fieldOrder('materials')[0]).toBe('name')
    expect(fieldOrder('profiles')[0]).toBe('full_name')
    expect(fieldOrder('objects')[0]).toBe('name')
  })

  it("takrorsiz va barcha ustunlarni o'z ichiga oladi", () => {
    for (const t of HISTORY_TABLES) {
      const order = fieldOrder(t)
      expect(new Set(order).size, t).toBe(order.length)
      expect([...order].sort(), t).toEqual([...tableColumns(t)].sort())
    }
  })

  it('barqaror (ikki chaqiruv bir xil, nusxa qaytadi)', () => {
    const a = fieldOrder('movements')
    a.push('x')
    expect(fieldOrder('movements')).not.toContain('x')
    expect(fieldOrder('movements')).toEqual(fieldOrder('movements'))
  })

  it("noma'lum jadval → []", () => {
    expect(fieldOrder('nomalum')).toEqual([])
    expect(tableColumns('nomalum')).toEqual([])
  })
})

describe('HISTORY_TABLES', () => {
  it('audit_log va notification_outbox kirmaydi', () => {
    expect(HISTORY_TABLES).not.toContain('audit_log')
    expect(HISTORY_TABLES).not.toContain('notification_outbox')
    expect(HISTORY_TABLES).toContain('movements')
    expect(HISTORY_TABLES).toContain('estimate_import_templates')
    expect(HISTORY_TABLES).toHaveLength(19)
  })
})
