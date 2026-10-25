// Ombor sahifasi filtrlari — sof funksiyalar.
import type { MovementFilters } from '@/data/movementsRepo'
import type { MovementKind } from '@/data/types'

/** Asia/Tashkent — doimiy UTC+5 (yozgi vaqt yo'q). */
const TASHKENT_OFFSET = '+05:00'

export interface MovementFilterForm {
  objectId: string
  materialId: string
  type: '' | MovementKind
  createdBy: string
  /** `yyyy-mm-dd` (input type="date") */
  from: string
  to: string
  includeDeleted: boolean
}

export const EMPTY_FILTERS: MovementFilterForm = {
  objectId: '',
  materialId: '',
  type: '',
  createdBy: '',
  from: '',
  to: '',
  includeDeleted: false,
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Toshkent kuni boshlanishi (ISO, UTC). */
export function dayStartIso(date: string): string | undefined {
  if (!DATE_RE.test(date)) return undefined
  const d = new Date(`${date}T00:00:00${TASHKENT_OFFSET}`)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** Toshkent bo'yicha keyingi kun boshlanishi — "shu sanagacha (kiritilgan)" uchun. */
export function nextDayStartIso(date: string): string | undefined {
  const start = dayStartIso(date)
  if (!start) return undefined
  return new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString()
}

export function toRepoFilters(form: MovementFilterForm, canSeeDeleted: boolean): MovementFilters {
  return {
    objectId: form.objectId || undefined,
    materialId: form.materialId || undefined,
    type: form.type || undefined,
    createdBy: form.createdBy || undefined,
    from: dayStartIso(form.from),
    to: nextDayStartIso(form.to),
    includeDeleted: canSeeDeleted && form.includeDeleted ? true : undefined,
  }
}
