// Bosh sahifa davri va obyekt filtri ↔ URL query (`?from=2026-10-01&to=2026-10-31&object=...`). Sof funksiyalar.
import { PERIOD_PRESETS, periodRange, validateRange, type PeriodPreset } from '@/domain/reports'
import { isUuid } from '@/lib/uuid'

export const DEFAULT_PRESET: PeriodPreset = 'last7'
export const MAX_RANGE_DAYS = 366

export interface DashboardQuery {
  from: string
  to: string
  objectId: string
  /** Davr tayyor davrlardan biriga to'g'ri kelsa — o'sha; aks holda null (ixtiyoriy). */
  preset: PeriodPreset | null
  /** URL'dagi davr noto'g'ri edi (standart davr ishlatildi). */
  invalid: 'invalid' | 'reversed' | 'too_long' | null
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/
const UZ_RE = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/

/** `dd.mm.yyyy` → `yyyy-mm-dd`; noto'g'ri (masalan 30.02.2026) → null. */
export function parseUzDate(input: string): string | null {
  const m = UZ_RE.exec(input)
  if (!m) return null
  const iso = `${m[3]}-${(m[2] ?? '').padStart(2, '0')}-${(m[1] ?? '').padStart(2, '0')}`
  return validateRange(iso, iso) === 'ok' ? iso : null
}

/** `yyyy-mm-dd` → `dd.mm.yyyy`. */
export function isoToUz(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export function presetOf(from: string, to: string, todayIso: string): PeriodPreset | null {
  for (const p of PERIOD_PRESETS) {
    const r = periodRange(p, todayIso)
    if (r.from === from && r.to === to) return p
  }
  return null
}

/** URL → filtr. Davr yo'q yoki noto'g'ri — standart (7 kun). */
export function readDashboardQuery(params: URLSearchParams, todayIso: string): DashboardQuery {
  // Faqat UUID; foydalanuvchi ro'yxatida yo'q obyekt sahifada tozalanadi
  const rawObject = params.get('object') ?? ''
  const objectId = isUuid(rawObject) ? rawObject : ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  if (from || to) {
    const check = ISO_RE.test(from) && ISO_RE.test(to) ? validateRange(from, to, MAX_RANGE_DAYS) : 'invalid'
    if (check === 'ok') return { from, to, objectId, preset: presetOf(from, to, todayIso), invalid: null }
    const def = periodRange(DEFAULT_PRESET, todayIso)
    return { ...def, objectId, preset: DEFAULT_PRESET, invalid: check }
  }
  const def = periodRange(DEFAULT_PRESET, todayIso)
  return { ...def, objectId, preset: DEFAULT_PRESET, invalid: null }
}

/** Filtr → URL query (bo'sh obyekt yozilmaydi). */
export function dashboardSearch(q: { from: string; to: string; objectId: string }): URLSearchParams {
  const p = new URLSearchParams()
  p.set('from', q.from)
  p.set('to', q.to)
  if (q.objectId) p.set('object', q.objectId)
  return p
}
