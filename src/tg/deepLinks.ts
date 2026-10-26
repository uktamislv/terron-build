// Telegram ish xabarlaridagi havolalar: `/tg?request=<id>` va `/tg?transfer=<id>` (sof).
// Id — faqat UUID; noto'g'ri yoki rolga tegishli bo'lmasa — jimgina oddiy ekran (xato ko'rsatilmaydi).
// Ruxsat — RLS'da: havola faqat qaysi ekranni ochishni tanlaydi.
import { can, type Role } from '@/domain/roles'
import { isUuid } from '@/lib/uuid'

/** `?key=<uuid>` — to'g'ri UUID bo'lsa, aks holda null. */
export function readUuidParam(params: URLSearchParams, key: string): string | null {
  const v = params.get(key)
  return isUuid(v) ? v : null
}

/**
 * Bosh havoladan qaysi ekranga o'tish:
 * - so'rov → admin: "So'rovlarni tasdiqlash" (shu so'rov varag'i); ta'minotchi: xarid ekrani (so'rov tanlangan);
 *   so'rov yuborgan (prorab): "Yozuvlar" → so'rov tafsiloti;
 * - xarid → o'z xaridi "Yozuvlar" da (boshqalar — bosh ekran);
 * - o'tkazma → kirim/chiqim ekrani, kelgan o'tkazmani qabul qilish varag'i.
 * Mos kelmasa — null.
 */
export function deepLinkTarget(role: Role, params: URLSearchParams): string | null {
  const request = readUuidParam(params, 'request')
  if (request) {
    if (can(role, 'approve_request')) return `/tg/approvals?request=${request}`
    if (role === 'taminotchi') return `/tg/purchase?request=${request}`
    if (can(role, 'create_request')) return `/tg/mine?request=${request}`
    return null
  }
  // Xarid (masalan "sizning nomingizdan xarid") — o'z xaridi "Yozuvlar" da ochiladi; topilmasa — jim
  const purchase = readUuidParam(params, 'purchase')
  if (purchase) return can(role, 'create_purchase') ? `/tg/mine?purchase=${purchase}` : null
  const transfer = readUuidParam(params, 'transfer')
  if (transfer && can(role, 'create_movement')) return `/tg/movement?transfer=${transfer}`
  return null
}
