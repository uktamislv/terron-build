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
