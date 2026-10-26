// Veb "Xarid qo'shish" formasi — sof tekshiruv (React'siz). Narx, rasm va takroriy yozuv qoidalari —
// umumiy domain funksiyalari (purchasePrices, photoRequired, findDuplicateEntry).
import { parseSumInput } from '@/domain/cash'
import { cmp, type Dec } from '@/domain/decimal'
import { entryDateToIso } from '@/domain/entryDate'
import { validateQtyInput, type QtyError } from '@/domain/units'

export type SupplierMode = 'none' | 'existing' | 'new'

export interface AddPurchaseForm {
  objectId: string
  materialId: string
  unitId: string
  qty: string
  /** "1 250 000" */
  total: string
  supplierMode: SupplierMode
  supplierId: string
  supplierName: string
  /** `yyyy-mm-dd` (Toshkent); bugun — server `now()`. */
  date: string
  requestId: string
  /** Faqat admin: xaridor (bo'sh — o'zi). */
  buyerId: string
  note: string
}

export function emptyPurchaseForm(today: string): AddPurchaseForm {
  return {
    objectId: '',
    materialId: '',
    unitId: '',
    qty: '',
    total: '',
    supplierMode: 'none',
    supplierId: '',
    supplierName: '',
    date: today,
    requestId: '',
    buyerId: '',
    note: '',
  }
}

export type AddPurchaseField = 'object' | 'material' | 'unit' | 'qty' | 'total' | 'supplier' | 'date'
export type AddPurchaseError = QtyError | 'required' | 'invalid'

export interface AddPurchaseValue {
  qtyInput: Dec
  totalAmount: Dec
  /** ISO yoki null (bugun — server now()). */
  purchasedAt: string | null
}

export function validateAddPurchase(
  f: AddPurchaseForm,
  opts: { nowIso: string; isAdmin: boolean },
): { ok: true; value: AddPurchaseValue } | { ok: false; errors: Partial<Record<AddPurchaseField, AddPurchaseError>> } {
  const errors: Partial<Record<AddPurchaseField, AddPurchaseError>> = {}
  if (!f.objectId) errors.object = 'required'
  if (!f.materialId) errors.material = 'required'
  if (!f.unitId) errors.unit = 'required'
  const qty = validateQtyInput(f.qty)
  if (!qty.ok) errors.qty = qty.reason === 'empty' ? 'required' : qty.reason
  let total: Dec | null = null
  if (f.total.trim() === '') errors.total = 'required'
  else {
    total = parseSumInput(f.total)
    if (total === null || cmp(total, '0') <= 0) errors.total = 'invalid'
  }
  if (f.supplierMode === 'existing' && !f.supplierId) errors.supplier = 'required'
  if (f.supplierMode === 'new' && !f.supplierName.trim()) errors.supplier = 'required'
  let purchasedAt: string | null | undefined = null
  if (!f.date) errors.date = 'required'
  else {
    purchasedAt = entryDateToIso(f.date, opts.nowIso, opts.isAdmin)
    if (purchasedAt === undefined) errors.date = 'invalid'
  }
  if (!qty.ok || total === null || purchasedAt === undefined || Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { qtyInput: qty.value, totalAmount: total, purchasedAt } }
}
