// Ombor ko'rinishi uchun sof yordamchilar (qoldiq nomlari, harakat turi rangi).
import type { EntryKind } from '@/components/ui'
import type { Material, MovementKind, ObjectRow, StockBalance } from '@/data/types'
import { isNegative } from '@/domain/decimal'

/** Harakat turi → "yuk xati" chizig'i rangi. */
export const MOVEMENT_ENTRY_KIND: Record<MovementKind, EntryKind> = {
  kirim: 'kirim',
  chiqim: 'chiqim',
  transfer_out: 'transfer',
  transfer_in: 'transfer',
  inventory_adjust: 'warn',
}

export interface StockRow extends StockBalance {
  objectName: string
  materialName: string
  baseUnit: string
  negative: boolean
}

export function nameStock(rows: StockBalance[], objects: ObjectRow[], materials: Material[]): StockRow[] {
  const objName = new Map(objects.map((o) => [o.id, o.name]))
  const mat = new Map(materials.map((m) => [m.id, m]))
  return rows
    .map((r) => ({
      ...r,
      objectName: objName.get(r.object_id) ?? '—',
      materialName: mat.get(r.material_id)?.name ?? '—',
      baseUnit: mat.get(r.material_id)?.base_unit ?? '',
      negative: isNegative(r.qty_base),
    }))
    .sort((a, b) => a.objectName.localeCompare(b.objectName) || a.materialName.localeCompare(b.materialName))
}

