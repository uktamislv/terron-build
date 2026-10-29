// Xarid formasi uchun eslab qolinadigan tanlovlar (faqat qulaylik). localStorage yopiq bo'lishi mumkin.
const SUPPLIERS_KEY = 'terron.purchase.suppliers'
const MAX_RECENT = 8

/** Oxirgi ishlatilgan sotuvchilar id'lari (yangisi birinchi). */
export function loadRecentSuppliers(): string[] {
  try {
    const raw = window.localStorage.getItem(SUPPLIERS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

export function rememberSupplier(id: string): void {
  try {
    const next = [id, ...loadRecentSuppliers().filter((x) => x !== id)].slice(0, MAX_RECENT)
    window.localStorage.setItem(SUPPLIERS_KEY, JSON.stringify(next))
  } catch {
    // e'tiborsiz — eslab qolinmasa ham forma ishlaydi
  }
}

/** "Xarid" ekrani almashtirgichi: material xaridi yoki boshqa xarajat (oxirgi tanlov). */
export type PurchaseMode = 'material' | 'expense'

const MODE_KEY = 'terron.purchase.mode'
const EXPENSE_OBJECT_KEY = 'terron.expense.object'
/** Xarajat obyekti "Umumiy" (obyektsiz) — saqlangan qiymat. */
export const GENERAL_OBJECT = 'none'

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeKey(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // e'tiborsiz — eslab qolinmasa ham forma ishlaydi
  }
}

export function loadPurchaseMode(): PurchaseMode {
  return readKey(MODE_KEY) === 'expense' ? 'expense' : 'material'
}

export function savePurchaseMode(mode: PurchaseMode): void {
  writeKey(MODE_KEY, mode)
}

/** Oxirgi xarajat obyekti: id, `GENERAL_OBJECT` ("Umumiy") yoki null (hali tanlanmagan). */
export function loadLastExpenseObject(): string | null {
  return readKey(EXPENSE_OBJECT_KEY)
}

export function saveLastExpenseObject(objectId: string | null): void {
  writeKey(EXPENSE_OBJECT_KEY, objectId ?? GENERAL_OBJECT)
}

const PURCHASE_OBJECT_KEY = 'terron.purchase.object'

/** Xarid uchun oxirgi obyekt — kirim/chiqimnikidan alohida (ta'minotchi boshqa obyektga xarid qiladi). */
export function loadLastPurchaseObject(): string | null {
  return readKey(PURCHASE_OBJECT_KEY)
}

export function saveLastPurchaseObject(objectId: string): void {
  writeKey(PURCHASE_OBJECT_KEY, objectId)
}
