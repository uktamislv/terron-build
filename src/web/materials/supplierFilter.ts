// Sotuvchilar ro'yxatini qidirish — sof funksiya.
import { supplierKey } from '@/data/suppliersRepo'
import type { Supplier } from '@/data/types'

/** Qidiruv: nom (katta-kichik harf, bo'sh joy farqsiz), telefon yoki STIR raqamlari bo'yicha. */
export function filterSuppliers(list: readonly Supplier[], query: string): Supplier[] {
  const q = supplierKey(query)
  const digits = query.replace(/\D/g, '')
  if (!q) return [...list]
  return list.filter(
    (s) =>
      supplierKey(s.name).includes(q) ||
      (digits.length > 0 && ((s.tin ?? '').includes(digits) || (s.phone ?? '').replace(/\D/g, '').includes(digits))),
  )
}
