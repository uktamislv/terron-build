// Baza ↔ TypeScript shartnomasi: migratsiyalar matn sifatida o'qiladi (src/domain/history/fields.test.ts
// uslubida) va TS tomonidagi ro'yxatlar / tiplar / select satrlari bilan solishtiriladi:
//   - alert_type enum ↔ AlertType (ALERT_TYPES) ↔ i18n alert nomlari;
//   - user_role ↔ ROLES;
//   - notification_outbox kind check ↔ tg-dispatch buildMessage case'lari ↔ i18n xabar turi nomlari;
//   - private.history_tables() ↔ RESTORABLE_TABLES;
//   - asosiy jadvallar ustunlari ↔ repo select satrlari ↔ src/data/types.ts interfeyslari (nullability bilan).
import { ALERT_TYPES } from './types'
import { ROLES } from '@/domain/roles'
import { t } from '@/i18n'
import { RESTORABLE_TABLES } from '@/web/history/historyFormat'
import { buildMessage, type OutboxRow } from '@shared/../tg-dispatch/logic'
import { getMovementById } from './movementsRepo'
import { getPurchaseById } from './purchasesRepo'
import { listMyAdvances } from './cashRepo'
import { listProfiles } from './profilesRepo'
import { getAlertById } from './alertsRepo'
import { listObjects } from './objectsRepo'

const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>
const TYPES_SRC = import.meta.glob('/src/data/types.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const DISPATCH_SRC = import.meta.glob('/supabase/functions/tg-dispatch/logic.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

// ----------------------------------------------------------------------------
// Migratsiyalarni o'qish
// ----------------------------------------------------------------------------

/** Nom tartibida, izohlarsiz (`-- ...`), LF. */
const SQL: string[] = Object.keys(MIGRATIONS)
  .sort()
  .map((f) => (MIGRATIONS[f] ?? '').replace(/\r\n/g, '\n').replace(/--[^\n]*/g, ''))

/** Yuqori darajadagi vergullar bo'yicha bo'lish (qavslar va satrlar ichida emas). */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = false
  let cur = ''
  for (const ch of s) {
    if (ch === "'") quote = !quote
    if (!quote) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) {
        out.push(cur.trim())
        cur = ''
        continue
      }
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function enumValues(name: string): string[] {
  const values: string[] = []
  for (const sql of SQL) {
    const c = new RegExp(`create type public\\.${name} as enum \\(([^)]*)\\)`).exec(sql)
    if (c) values.push(...[...(c[1] as string).matchAll(/'([^']+)'/g)].map((m) => m[1] as string))
    for (const m of sql.matchAll(new RegExp(`alter type public\\.${name} add value (?:if not exists )?'([^']+)'`, 'g'))) {
      if (!values.includes(m[1] as string)) values.push(m[1] as string)
    }
  }
  return values
}

interface SqlColumn {
  nullable: boolean
}

/** Jadval ustunlari (create table + alter table add/alter/drop column), oxirgi holat. */
function tableColumns(table: string): Map<string, SqlColumn> {
  const cols = new Map<string, SqlColumn>()
  const isConstraint = (c: string): boolean => /^(constraint|unique|primary key|foreign key|check|exclude)\b/i.test(c)
  for (const sql of SQL) {
    for (const m of sql.matchAll(new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, 'g'))) {
      for (const clause of splitTop(m[1] as string)) {
        if (isConstraint(clause)) continue
        const c = /^([a-z_][a-z0-9_]*)\s+([\s\S]*)$/.exec(clause)
        if (!c) continue
        cols.set(c[1] as string, { nullable: !/\bnot null\b|\bprimary key\b/i.test(c[2] as string) })
      }
    }
    for (const m of sql.matchAll(new RegExp(`alter table (?:only )?public\\.${table}\\s([\\s\\S]*?);`, 'g'))) {
      for (const clause of splitTop(m[1] as string)) {
        const add = /^add column (?:if not exists )?([a-z_][a-z0-9_]*)\s+([\s\S]*)$/.exec(clause)
        if (add) {
          cols.set(add[1] as string, { nullable: !/\bnot null\b|\bprimary key\b/i.test(add[2] as string) })
          continue
        }
        const alt = /^alter column ([a-z_][a-z0-9_]*) (set|drop) not null/.exec(clause)
        if (alt && cols.has(alt[1] as string)) {
          cols.set(alt[1] as string, { nullable: alt[2] === 'drop' })
          continue
        }
        const drop = /^drop column (?:if exists )?([a-z_][a-z0-9_]*)/.exec(clause)
        if (drop) cols.delete(drop[1] as string)
      }
    }
  }
  return cols
}

/** Oxirgi `notification_outbox_kind_check` dagi kind'lar. */
function outboxKinds(): string[] {
  let last: string[] = []
  for (const sql of SQL) {
    for (const m of sql.matchAll(/constraint notification_outbox_kind_check\s+check \(kind in \(([^)]*)\)\)/g)) {
      last = [...(m[1] as string).matchAll(/'([^']+)'/g)].map((x) => x[1] as string)
    }
  }
  return last
}

/** Oxirgi `private.history_tables()` ta'rifidagi massiv. */
function historyTables(): string[] {
  let last: string[] = []
  for (const sql of SQL) {
    for (const m of sql.matchAll(/function private\.history_tables\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/g)) {
      last = [...(m[1] as string).matchAll(/'([^']+)'/g)].map((x) => x[1] as string)
    }
  }
  return last
}

// ----------------------------------------------------------------------------
// TS tomoni: types.ts interfeyslari va repo select satrlari
// ----------------------------------------------------------------------------

interface TsField {
  optional: boolean
  nullable: boolean
  type: string
}

const TYPES_TEXT = (Object.values(TYPES_SRC)[0] ?? '').replace(/\r\n/g, '\n')

function tsInterface(name: string): Map<string, TsField> {
  const m = new RegExp(`export interface ${name}(?: extends ([A-Za-z, ]+))? \\{\\n([\\s\\S]*?)\\n\\}`).exec(TYPES_TEXT)
  if (!m) throw new Error(`types.ts: interface ${name} topilmadi`)
  const fields = new Map<string, TsField>()
  for (const base of (m[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    for (const [k, v] of tsInterface(base)) fields.set(k, v)
  }
  for (const line of (m[2] as string).split('\n')) {
    const f = /^ {2}([a-z_][a-z0-9_]*)(\?)?: (.+)$/.exec(line)
    if (!f) continue
    const type = (f[3] as string).trim()
    fields.set(f[1] as string, { optional: f[2] === '?', nullable: /\bnull\b/.test(type), type })
  }
  return fields
}

/** Select satridan to'g'ridan-to'g'ri ustunlar (embed'lar va `::text` siz). */
function selectColumns(select: string): string[] {
  return splitTop(select)
    .filter((c) => !c.includes(':') || /::/.test(c))
    .filter((c) => !c.includes('('))
    .map((c) => c.replace(/::\w+$/, '').trim())
}

const fake = vi.hoisted(() => ({ selects: [] as { table: string; select: string }[] }))

vi.mock('./supabaseClient', () => {
  const builder = (table: string): unknown => {
    const q: unknown = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, count: 0 }).then(resolve)
          }
          return (...args: unknown[]) => {
            if (prop === 'select' && typeof args[0] === 'string') fake.selects.push({ table, select: args[0] })
            return q
          }
        },
      },
    )
    return q
  }
  return {
    isSupabaseConfigured: () => true,
    getSupabase: () => ({ from: builder, rpc: () => Promise.resolve({ data: null, error: null }) }),
  }
})

/** Repo funksiyasi chaqiriladi (natija muhim emas) — jadvalga yuborilgan birinchi select olinadi. */
async function selectOf(table: string, call: () => Promise<unknown>): Promise<string> {
  fake.selects.length = 0
  await call().catch(() => undefined)
  const s = fake.selects.find((x) => x.table === table)
  if (!s) throw new Error(`${table}: select chaqirilmadi`)
  return s.select
}

// ----------------------------------------------------------------------------
// Enumlar va ro'yxatlar
// ----------------------------------------------------------------------------

describe('enumlar', () => {
  it('alert_type ↔ ALERT_TYPES (tartib bilan) ↔ i18n alert nomlari', () => {
    const db = enumValues('alert_type')
    expect(db.length).toBeGreaterThan(20)
    expect([...ALERT_TYPES]).toEqual(db)
    const labels = t.alertTexts.types as Record<string, string>
    expect(Object.keys(labels).sort()).toEqual([...db].sort())
    for (const k of db) expect(labels[k]?.trim(), k).toBeTruthy()
  })

  it('user_role ↔ ROLES (tartib bilan)', () => {
    expect([...ROLES]).toEqual(enumValues('user_role'))
  })
})

describe('notification_outbox.kind ↔ tg-dispatch buildMessage', () => {
  const kinds = outboxKinds()
  const src = (Object.values(DISPATCH_SRC)[0] ?? '').replace(/\r\n/g, '\n')
  const body = /export function buildMessage\([\s\S]*?\n\}/.exec(src)?.[0] ?? ''
  const cases = [...body.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1] as string)

  it('kind check va buildMessage case`lari aynan bir xil', () => {
    expect(kinds.length).toBeGreaterThan(10)
    expect([...cases].sort()).toEqual([...kinds].sort())
  })

  it.each(kinds)('%s: buildMessage "noma`lum kind" demaydi', (kind) => {
    const row: OutboxRow = { id: 'x', company_id: 'c', kind, payload: {}, attempts: 0 }
    let err: unknown = null
    try {
      buildMessage(row)
    } catch (e) {
      err = e
    }
    expect(String(err ?? '')).not.toMatch(/noma'lum kind/)
  })

  it('noma`lum kind — xato', () => {
    expect(() => buildMessage({ id: 'x', company_id: 'c', kind: 'yoq_tur', payload: {}, attempts: 0 })).toThrow(/noma'lum kind/)
  })

  it('har kind uchun veb paneldagi (Telegram holati) nom bor', () => {
    const labels = t.settings.health.kinds
    for (const k of kinds) expect(labels[k]?.trim(), k).toBeTruthy()
  })
})

describe('private.history_tables() ↔ RESTORABLE_TABLES', () => {
  it('aynan bir xil (tartib bilan)', () => {
    const db = historyTables()
    expect(db.length).toBeGreaterThan(10)
    expect([...RESTORABLE_TABLES]).toEqual(db)
  })
})

// ----------------------------------------------------------------------------
// Ustunlar: SQL ↔ select ↔ types.ts
// ----------------------------------------------------------------------------

interface TableCase {
  table: string
  iface: string
  call: () => Promise<unknown>
}

const TABLES: TableCase[] = [
  { table: 'movements', iface: 'Movement', call: () => getMovementById('id') },
  { table: 'purchases', iface: 'Purchase', call: () => getPurchaseById('id') },
  { table: 'cash_advances', iface: 'CashAdvance', call: () => listMyAdvances('p', 'recipient') },
  { table: 'profiles', iface: 'Profile', call: () => listProfiles() },
  { table: 'alerts', iface: 'Alert', call: () => getAlertById('id') },
  { table: 'objects', iface: 'ObjectRow', call: () => listObjects() },
]

describe('asosiy jadvallar: select ustunlari bazada va TS tipida bor, nullability mos', () => {
  it.each(TABLES.map((c) => [c.table, c] as const))('%s', async (_name, c) => {
    const sqlCols = tableColumns(c.table)
    expect(sqlCols.size, `${c.table}: migratsiyada ustunlar topilmadi`).toBeGreaterThan(5)
    const ts = tsInterface(c.iface)
    const cols = selectColumns(await selectOf(c.table, c.call))
    expect(cols.length).toBeGreaterThan(5)

    const notInDb = cols.filter((col) => !sqlCols.has(col))
    const notInTs = cols.filter((col) => !ts.has(col))
    expect(notInDb, `${c.table}: select'dagi, bazada yo'q ustunlar`).toEqual([])
    expect(notInTs, `${c.iface}: select'dagi, tipda yo'q maydonlar`).toEqual([])

    // NOT NULL ustun — tipda `null` bo'lmasin; nullable ustun — tipda `null` bo'lsin
    const nullMismatch = cols
      .filter((col) => sqlCols.has(col) && ts.has(col))
      .filter((col) => sqlCols.get(col)!.nullable !== ts.get(col)!.nullable)
      .map((col) => `${col}: baza ${sqlCols.get(col)!.nullable ? 'NULL' : 'NOT NULL'}, tip "${ts.get(col)!.type}"`)
    expect(nullMismatch, `${c.iface}: nullability`).toEqual([])
  })

  it('objects.radius_m NOT NULL (standart 300) → ObjectRow.radius_m: number', () => {
    expect(tableColumns('objects').get('radius_m')).toEqual({ nullable: false })
    expect(tsInterface('ObjectRow').get('radius_m')).toMatchObject({ nullable: false, type: 'number' })
    expectTypeOf<NonNullable<import('./types').ObjectRow['radius_m']>>().toEqualTypeOf<number>()
  })

  it('parser o`zi: ma`lum NOT NULL / NULL ustunlar to`g`ri o`qiladi', () => {
    const p = tableColumns('purchases')
    expect(p.get('payment_source')).toEqual({ nullable: false }) // add column ... ; keyin alter column set not null
    expect(p.get('supplier_id')).toEqual({ nullable: true })
    expect(p.get('id')).toEqual({ nullable: false })
    expect(tableColumns('profiles').get('notify_workflow')).toEqual({ nullable: false })
    expect(tableColumns('profiles').get('telegram_blocked_at')).toEqual({ nullable: true })
  })
})
