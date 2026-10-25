// Tarix sahifasi filtrlari ↔ URL query. Sof funksiyalar.
// `?tab=deleted&from=2026-10-01&to=2026-10-31&table=movements&action=UPDATE&actor=<uuid>&device=veb&record=<uuid>`
import { AUDIT_ACTIONS, AUDIT_DEVICES, type AuditDevice, type AuditFilters } from '@/data/historyRepo'
import { HISTORY_TABLES } from '@/domain/history'
import { addDays, type PeriodPreset } from '@/domain/reports'
import { isUuid } from '@/lib/uuid'
import { readDashboardQuery } from '../dashboard/query'

export type HistoryTab = 'feed' | 'deleted'

/** Filtrdagi jadvallar: biznes jadvallari + "Kirish" (auth hodisalari). */
export const HISTORY_FILTER_TABLES: readonly string[] = [...HISTORY_TABLES, 'auth']

/** Bitta yozuv tarixi ochilganda (davr berilmagan) — oxirgi 366 kun. */
export const RECORD_LOOKBACK_DAYS = 365

export interface HistoryQuery {
  tab: HistoryTab
  from: string
  to: string
  preset: PeriodPreset | null
  invalid: 'invalid' | 'reversed' | 'too_long' | null
  table: string
  action: string
  actorId: string
  device: '' | AuditDevice
  recordId: string
}

function oneOf<T extends string>(v: string | null, list: readonly T[]): T | '' {
  return v !== null && (list as readonly string[]).includes(v) ? (v as T) : ''
}

export function readHistoryQuery(params: URLSearchParams, todayIso: string): HistoryQuery {
  const recordRaw = params.get('record') ?? ''
  const recordId = isUuid(recordRaw) ? recordRaw : ''
  const hasPeriod = Boolean(params.get('from') || params.get('to'))
  const period =
    recordId && !hasPeriod
      ? { from: addDays(todayIso, -RECORD_LOOKBACK_DAYS), to: todayIso, preset: null, invalid: null }
      : readDashboardQuery(params, todayIso)
  const actorRaw = params.get('actor') ?? ''
  return {
    tab: params.get('tab') === 'deleted' ? 'deleted' : 'feed',
    from: period.from,
    to: period.to,
    preset: period.preset,
    invalid: period.invalid,
    table: oneOf(params.get('table'), HISTORY_FILTER_TABLES),
    action: oneOf(params.get('action'), AUDIT_ACTIONS),
    actorId: isUuid(actorRaw) ? actorRaw : '',
    device: oneOf(params.get('device'), AUDIT_DEVICES),
    recordId,
  }
}

/** Filtr → URL (bo'sh qiymatlar va standart tab yozilmaydi). */
export function historySearch(q: Omit<HistoryQuery, 'preset' | 'invalid'>): URLSearchParams {
  const p = new URLSearchParams()
  if (q.tab === 'deleted') p.set('tab', 'deleted')
  p.set('from', q.from)
  p.set('to', q.to)
  if (q.table) p.set('table', q.table)
  if (q.tab === 'feed') {
    if (q.action) p.set('action', q.action)
    if (q.actorId) p.set('actor', q.actorId)
    if (q.device) p.set('device', q.device)
    if (q.recordId) p.set('record', q.recordId)
  }
  return p
}

export function toAuditFilters(q: HistoryQuery): AuditFilters {
  return {
    from: q.from,
    to: q.to,
    table: q.table || undefined,
    action: q.action || undefined,
    actorId: q.actorId || undefined,
    device: q.device || undefined,
    recordId: q.recordId || undefined,
  }
}

export { historyHref } from './historyHref'
