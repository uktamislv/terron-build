// Formada e'tibor talab qiladigan joyga aylantirish (masalan majburiy rasm maydoni) — saqlash rad etilganda.

/** `PhotoField` ildizidagi belgi. */
export const PHOTO_FIELD_ATTR = 'data-photo-field'

/** Birinchi mos elementni ekran o'rtasiga aylantiradi (jsdom / eski WebView'da scrollIntoView bo'lmasligi mumkin). */
export function scrollToField(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) return false
  el.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  return true
}

/** Majburiy rasm maydoniga aylantirish. */
export function scrollToPhotoField(): boolean {
  return scrollToField(`[${PHOTO_FIELD_ATTR}]`)
}
