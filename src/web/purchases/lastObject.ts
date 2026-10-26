// Veb "Xarid qo'shish": oxirgi tanlangan obyekt (faqat qulaylik). localStorage yopiq bo'lishi mumkin — try/catch.
const LAST_OBJECT_KEY = 'terron.web.purchase.object'

export function loadLastPurchaseObject(): string | null {
  try {
    return window.localStorage.getItem(LAST_OBJECT_KEY)
  } catch {
    return null
  }
}

export function saveLastPurchaseObject(objectId: string): void {
  try {
    window.localStorage.setItem(LAST_OBJECT_KEY, objectId)
  } catch {
    // e'tiborsiz — eslab qolinmasa ham forma ishlaydi
  }
}
