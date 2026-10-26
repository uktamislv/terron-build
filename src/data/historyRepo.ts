// O'zgarishlar tarixi (Batch 10, docs/history-design.md): audit_feed, deleted_records, restore_record.
// Hammasi `security invoker` — audit_log va jadvallar RLS'i chaqiruvchi huquqida ishlaydi.
import { unitLabel } from '@/domain/units'
import { RepoError, toRepoError } from './errors'
import { EXPORT_MAX_ROWS, inChunks } from './fetchAll'
import { getSupabase } from './supabaseClient'

export type AuditDevice = 'veb' | 'mobil' | 'tizim'
export const AUDIT_DEVICES: readonly AuditDevice[] = ['veb', 'mobil', 'tizim']

/** Filtrdagi amallar (`TG_AUTH_USER_CREATED` — texnik, filtrda yo'q). */
export const AUDIT_ACTIONS = ['INSERT', 'UPDATE', 'SOFT_DELETE', 'RESTORE', 'SET_LOGIN', 'TG_LINK'] as const
export type AuditActionFilter = (typeof AUDIT_ACTIONS)[number]

export interface AuditEntry {
  id: number
  created_at: string
  table_name: string
  record_id: string
  action: string
  actor_profile_id: string | null
  actor_name: string | null
  device: AuditDevice | null
  changed_fields: string[] | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  record_label: string | null
}

export interface AuditFilters {
  /** `yyyy-mm-dd` (Toshkent kuni, ikkalasi ham kiradi) */
  from: string
  to: string
  table?: string
  action?: string
  actorId?: string
  device?: AuditDevice
  recordId?: string
}

export const AUDIT_PAGE_SIZE = 50
/** Eksportda bitta so'rov (server chegarasi — 200). */
export const AUDIT_EXPORT_CHUNK = 200

export interface AuditPage {
  rows: AuditEntry[]
  /** Yana yozuv bor ("Yana yuklash"). */
  hasMore: boolean
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v)
}

function device(v: unknown): AuditDevice | null {
  return v === 'veb' || v === 'mobil' || v === 'tizim' ? v : null
}

export function normalizeAuditEntry(raw: Record<string, unknown>): AuditEntry {
  return {
    id: Number(raw.id),
    created_at: String(raw.created_at ?? ''),
    table_name: String(raw.table_name ?? ''),
    record_id: String(raw.record_id ?? ''),
    action: String(raw.action ?? ''),
    actor_profile_id: str(raw.actor_profile_id),
    actor_name: str(raw.actor_name),
    device: device(raw.device),
    changed_fields: Array.isArray(raw.changed_fields) ? raw.changed_fields.map(String) : null,
    old_data: obj(raw.old_data),
    new_data: obj(raw.new_data),
    record_label: str(raw.record_label),
  }
}

function feedArgs(f: AuditFilters, beforeId: number | null, limit: number) {
  return {
    p_from: f.from,
    p_to: f.to,
    p_table: f.table || null,
    p_action: f.action || null,
    p_actor: f.actorId || null,
    p_device: f.device || null,
    p_record_id: f.recordId || null,
    p_before_id: beforeId,
    p_limit: limit,
  }
}

async function feedChunk(f: AuditFilters, beforeId: number | null, limit: number, signal?: AbortSignal): Promise<AuditEntry[]> {
  let req = getSupabase().rpc('audit_feed', feedArgs(f, beforeId, limit))
  if (signal) req = req.abortSignal(signal)
  const { data, error } = await req
  if (error) throw toRepoError(error)
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeAuditEntry)
}

/**
 * Tarix sahifasi (eng yangisi birinchi). Keyset: `beforeId` — oldingi sahifaning oxirgi `id` si.
 * Bitta ortiqcha qator so'raladi — "Yana yuklash" kerakligini bilish uchun.
 */
export async function listAuditFeed(f: AuditFilters, beforeId: number | null = null, pageSize = AUDIT_PAGE_SIZE): Promise<AuditPage> {
  const rows = await feedChunk(f, beforeId, pageSize + 1)
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize }
}

/** Eksport: joriy filtr bo'yicha hamma yozuvlar (keyset bilan 200 tadan); 50 000 dan oshsa — xato. */
export async function listAllAuditFeed(f: AuditFilters, signal?: AbortSignal, max = EXPORT_MAX_ROWS): Promise<AuditEntry[]> {
  const out: AuditEntry[] = []
  let beforeId: number | null = null
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const rows = await feedChunk(f, beforeId, AUDIT_EXPORT_CHUNK, signal)
    out.push(...rows)
    if (out.length > max) throw new RepoError('export_too_large')
    const last = rows[rows.length - 1]
    if (rows.length < AUDIT_EXPORT_CHUNK || !last) return out
    beforeId = last.id
  }
}

export interface DeletedRecord {
  table_name: string
  record_id: string
  record_label: string | null
  deleted_at: string
  deleted_by_name: string | null
}

export interface DeletedFilters {
  from: string
  to: string
  table?: string
}

export const DELETED_PAGE_SIZE = 100

export interface DeletedPage {
  rows: DeletedRecord[]
  hasMore: boolean
}

/** O'chirilgan yozuvlar (barcha oq ro'yxatdagi jadvallar), offset bilan. */
export async function listDeletedRecords(f: DeletedFilters, offset = 0, pageSize = DELETED_PAGE_SIZE): Promise<DeletedPage> {
  const { data, error } = await getSupabase().rpc('deleted_records', {
    p_from: f.from,
    p_to: f.to,
    p_table: f.table || null,
    p_limit: pageSize + 1,
    p_offset: offset,
  })
  if (error) throw toRepoError(error)
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    table_name: String(r.table_name ?? ''),
    record_id: String(r.record_id ?? ''),
    record_label: str(r.record_label),
    deleted_at: String(r.deleted_at ?? ''),
    deleted_by_name: str(r.deleted_by_name),
  }))
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize }
}

/** Soft delete qilingan yozuvni tiklash (faqat admin — RLS va trigger). */
export async function restoreRecord(table: string, id: string): Promise<void> {
  const { error } = await getSupabase().rpc('restore_record', { p_table: table, p_id: id })
  if (error) throw toRepoError(error)
}

/** Diff'dagi bog'langan yozuvlar id'lari. */
export interface RefIds {
  objects: readonly string[]
  materials: readonly string[]
  profiles: readonly string[]
  units: readonly string[]
  suppliers: readonly string[]
}

export type RefKind = keyof RefIds
export type RefNames = Record<RefKind, Record<string, string>>

export function emptyRefNames(): RefNames {
  return { objects: {}, materials: {}, profiles: {}, units: {}, suppliers: {} }
}

const REF_SOURCES: Record<RefKind, { table: string; columns: string; label: (r: Record<string, unknown>) => string }> = {
  objects: { table: 'objects', columns: 'id, name', label: (r) => String(r.name ?? '') },
  materials: { table: 'materials', columns: 'id, name', label: (r) => String(r.name ?? '') },
  // `profile_directory` (view): direktor va boshqa admin bo'lmaganlar ham firma xodimlari ismini ko'radi
  // (`profiles` RLS faqat o'zini ko'rsatadi — tarix diff'ida "—" chiqardi)
  profiles: { table: 'profile_directory', columns: 'id, full_name', label: (r) => String(r.full_name ?? '') },
  units: {
    table: 'material_units',
    columns: 'id, unit, variant',
    label: (r) => unitLabel({ unit: String(r.unit ?? ''), variant: r.variant ? String(r.variant) : null }),
  },
  suppliers: { table: 'suppliers', columns: 'id, name', label: (r) => String(r.name ?? '') },
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Bog'langan yozuvlar nomlari — har tur uchun bitta `.in()` so'rov (`inChunks` bilan bo'linadi).
 * O'chirilganlar ham olinadi (tarixda nomi ko'rinsin). RLS ko'rsatmagan yozuv — xaritada yo'q ("—").
 */
export async function loadRefNames(ids: RefIds): Promise<RefNames> {
  const out = emptyRefNames()
  await Promise.all(
    (Object.keys(REF_SOURCES) as RefKind[]).map(async (kind) => {
      const list = ids[kind].filter((id) => UUID_RE.test(id))
      if (list.length === 0) return
      const src = REF_SOURCES[kind]
      const rows = await inChunks(list, async (chunk) => {
        const { data, error } = await getSupabase().from(src.table).select(src.columns).in('id', chunk)
        if (error) throw toRepoError(error)
        return (data ?? []) as unknown as Record<string, unknown>[]
      })
      for (const r of rows) out[kind][String(r.id)] = src.label(r)
    }),
  )
  return out
}

/** Hisobot davriga ta'sir qiladigan jadvallar va ularning yozuv sanasi ustuni. */
export const RECORD_DATE_COLUMNS: Readonly<Record<string, string>> = {
  purchases: 'purchased_at',
  cash_advances: 'issued_at',
  movements: 'occurred_at',
}

/** Yozuv sanasi (tiklash tasdig'i uchun). Sanasiz jadval yoki topilmasa — null. */
export async function getRecordDate(table: string, id: string): Promise<string | null> {
  const column = Object.hasOwn(RECORD_DATE_COLUMNS, table) ? RECORD_DATE_COLUMNS[table] : undefined
  if (!column) return null
  const { data, error } = await getSupabase().from(table).select(column).eq('id', id).maybeSingle()
  if (error) throw toRepoError(error)
  const v = (data as Record<string, unknown> | null)?.[column]
  return typeof v === 'string' ? v : null
}
