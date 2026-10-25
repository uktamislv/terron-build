// Mini App direktor ekrani: obyektlar bo'yicha smeta ishlatilishi — sof funksiyalar.
import type { NormOverviewRow } from '@/data/reportsRepo'
import type { Movement } from '@/data/types'
import { add, cmp, div, type Dec } from '@/domain/decimal'
import { usagePct } from '@/domain/norms'
import { formatDate } from '@/lib/format'

export interface ObjectUsage {
  objectId: string
  name: string
  /** Materiallar `usage_pct` o'rtachasi (norma 0 bo'lganlar hisobga olinmaydi); yo'q — null. */
  avgPct: Dec | null
  /** Sarf isrof bilan normadan oshgan materiallar soni. */
  overCount: number
  /** Materiallar: oshganlari birinchi, keyin foiz kamayishi bo'yicha. */
  materials: (NormOverviewRow & { pct: Dec | null; over: boolean })[]
}

export function objectUsage(rows: NormOverviewRow[]): ObjectUsage[] {
  const byObject = new Map<string, NormOverviewRow[]>()
  for (const r of rows) {
    const list = byObject.get(r.object_id) ?? []
    list.push(r)
    byObject.set(r.object_id, list)
  }
  return [...byObject.entries()]
    .map(([objectId, list]) => {
      const materials = list
        .map((r) => ({
          ...r,
          pct: r.usage_pct ?? usagePct(r.consumed_qty_base, r.allowed_qty_base),
          over: cmp(r.consumed_qty_base, r.allowed_qty_base) > 0,
        }))
        .sort(
          (a, b) =>
            Number(b.over) - Number(a.over) ||
            cmp(b.pct ?? '-1', a.pct ?? '-1') ||
            (a.material_name ?? '').localeCompare(b.material_name ?? ''),
        )
      const pcts = materials.map((m) => m.pct).filter((p): p is Dec => p !== null)
      const avgPct = pcts.length ? div(pcts.reduce<Dec>((s, p) => add(s, p), '0'), String(pcts.length), 1) : null
      return {
        objectId,
        name: list[0]?.object_name ?? '—',
        avgPct,
        overCount: materials.filter((m) => m.over).length,
        materials,
      }
    })
    .sort((a, b) => b.overCount - a.overCount || cmp(b.avgPct ?? '-1', a.avgPct ?? '-1') || a.name.localeCompare(b.name))
}

/** Toshkent bo'yicha bugungi yozuvlar. */
export function todayOnly(rows: Movement[], now: Date = new Date()): Movement[] {
  const today = formatDate(now)
  return rows.filter((m) => formatDate(m.created_at) === today)
}
