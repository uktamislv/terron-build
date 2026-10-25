// Fiskal chek QR kodi (O'zbekiston, soliq.uz OFD) — sof parser (docs/automation-design.md, G bo'lim).
//
// QR ichidagi havola formati (rasmiy spetsifikatsiya ochiq e'lon qilinmagan; quyidagi integratsiya
// hujjatlaridagi haqiqiy namunalar va maydon nomlari bo'yicha aniqlandi, 26.10.2026):
//
//   https://ofd.soliq.uz/check?t=UZ170703100189&r=643&c=20200518221403&s=248429044289
//   https://ofd.soliq.uz/epi?t=EZ000000000102&r=2121&c=20220929013159&s=420808230750
//
//   t — fiskal modul (terminal) ID: TerminalID, 2 lotin harf + 12 raqam (UZ…, LG…, EZ…);
//   r — chek tartib raqami: ReceiptSeq / receipt_count (terminal ichida o'suvchi butun son);
//   c — chek sana-vaqti: DateTime, `yyyyMMddHHmmss`, mahalliy vaqt (Asia/Tashkent, UTC+5);
//   s — fiskal belgi: FiscalSign, 12 raqam.
//   Yo'l: `/check` (onlayn NKM, OFD) yoki `/epi` (virtual kassa / to'lov tizimlari) — parametrlar bir xil.
//   Summa havolada YO'Q — `total` har doim null; summa `receipt-lookup` orqali sahifadan olinadi.
//
// Manbalar:
//   - https://github.com/abdullo211/fiscal_document/blob/master/Order.md
//     (qr_url = …/check?t=UZ170703100189&r=643&c=20200518221403&s=248429044289; yonida terminal_id,
//      receipt_count, date_time, fiscal_sign maydonlari — t/r/c/s moslig'i shu yerdan)
//   - https://docs.bmms.uz/ofd/getting-qr-code (…/epi?t=EZ000000000031&r=1&c=20230321151526&s=311010881435)
//   - https://help.octo.uz/fiscal-data.html (…/epi?t=EZ000000000102&r=2121&c=20220929013159&s=420808230750)
//   - https://buxgalter.uz/ru/publish/doc/text188544_pochemu_chek_mojet_ne_soderjat_nalogovoy_informacii
//     (fiskal chek QR havolasi https://ofd.soliq.uz bilan boshlanadi; boshqa domen — soliq ma'lumoti yo'q)
//
// Xavfsizlik: faqat `RECEIPT_HOSTS` dagi host qabul qilinadi; normallashtirilgan `url` faqat
// tekshirilgan maydonlardan qayta quriladi (asl satrdagi boshqa parametrlar, port, login tashlanadi) —
// Edge Function shu `url` ni xavfsiz so'rashi mumkin.

import type { Dec } from '../decimal'

/** Ruxsat etilgan hostlar (kichik harfda, aniq moslik; subdomen/o'xshash domen rad). */
export const RECEIPT_HOSTS: readonly string[] = ['ofd.soliq.uz']

/** Ruxsat etilgan yo'llar (kichik harfda, oxirgi `/` siz). */
export const RECEIPT_PATHS: readonly string[] = ['/check', '/epi']

/** Kirish satrining eng katta uzunligi (QR matni). */
export const RECEIPT_QR_MAX_LENGTH = 2048

export interface ReceiptQr {
  /** Normallashtirilgan havola: `https://ofd.soliq.uz/<check|epi>?t=…&r=…[&c=…]&s=…`. */
  url: string
  host: string
  /** Fiskal modul ID, katta harflarda ("UZ170703100189"). */
  terminalId: string
  /** Chek raqami, boshidagi nollarsiz ("643"). */
  receiptNo: string
  /** Fiskal belgi, raqamlar ("248429044289"). */
  fiscalSign: string
  /** `c` dan: "2020-05-18T22:14:03+05:00" (Asia/Tashkent); yo'q yoki noto'g'ri → null. */
  datetime: string | null
  /** QR havolada summa yo'q — har doim null (kelajakdagi formatlar uchun maydon saqlanadi). */
  total: Dec | null
}

const TERMINAL_RE = /^[A-Z]{2,4}\d{8,16}$/
const RECEIPT_NO_RE = /^\d{1,12}$/
const FISCAL_SIGN_RE = /^\d{6,20}$/
const DATETIME_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/

/** `c` → ISO (Toshkent, +05:00); kalendarda yo'q sana yoki vaqt → null. */
function parseReceiptDatetime(c: string): string | null {
  const m = DATETIME_RE.exec(c)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m as unknown as [string, string, string, string, string, string, string]
  const yn = Number(y)
  const mon = Number(mo)
  const dn = Number(d)
  if (yn < 2000 || mon < 1 || mon > 12 || dn < 1) return null
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null
  const dt = new Date(0)
  dt.setUTCFullYear(yn, mon - 1, dn)
  if (dt.getUTCFullYear() !== yn || dt.getUTCMonth() !== mon - 1 || dt.getUTCDate() !== dn) return null
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+05:00`
}

/** Parametr qiymati (kalit katta-kichik harfga sezgir emas). Bir xil kalit turli qiymat bilan → 'conflict'. */
function param(params: URLSearchParams, key: string): string | null | 'conflict' {
  let found: string | null = null
  for (const [k, v] of params) {
    if (k.toLowerCase() !== key) continue
    const val = v.trim()
    if (found !== null && found !== val) return 'conflict'
    found = val
  }
  return found
}

/**
 * QR matnini o'qiydi. Qabul qiladi: http/https yoki sxemasiz ("ofd.soliq.uz/check?…"), host va
 * parametr nomlari istalgan registrda, `/check` yoki `/epi` (oxirida `/` bo'lishi mumkin),
 * qo'shimcha parametrlar va `#…` (tashlanadi), atrofidagi bo'sh joylar.
 * null: boshqa host/yo'l, port yoki login bor, t/r/s yo'q yoki formati noto'g'ri, takroriy
 * parametr turli qiymat bilan, 2048 belgidan uzun.
 * `c` ixtiyoriy: noto'g'ri bo'lsa ham chek qabul qilinadi, faqat `datetime = null` va `url` da `c` bo'lmaydi.
 */
export function parseReceiptQr(text: string): ReceiptQr | null {
  if (typeof text !== 'string' || text.length > RECEIPT_QR_MAX_LENGTH) return null
  let s = text.trim()
  if (s === '') return null
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username !== '' || u.password !== '' || u.port !== '') return null
  const host = u.hostname.toLowerCase()
  if (!RECEIPT_HOSTS.includes(host)) return null
  const path = u.pathname.toLowerCase().replace(/\/+$/, '')
  if (!RECEIPT_PATHS.includes(path)) return null

  const t = param(u.searchParams, 't')
  const r = param(u.searchParams, 'r')
  const sign = param(u.searchParams, 's')
  const c = param(u.searchParams, 'c')
  if (t === null || r === null || sign === null) return null
  if (t === 'conflict' || r === 'conflict' || sign === 'conflict' || c === 'conflict') return null

  const terminalId = t.toUpperCase()
  if (!TERMINAL_RE.test(terminalId)) return null
  if (!RECEIPT_NO_RE.test(r)) return null
  const receiptNo = r.replace(/^0+(?=\d)/, '')
  if (receiptNo === '0') return null
  if (!FISCAL_SIGN_RE.test(sign)) return null

  const datetime = c === null ? null : parseReceiptDatetime(c)
  const query = [`t=${terminalId}`, `r=${receiptNo}`]
  if (datetime !== null && c !== null) query.push(`c=${c}`)
  query.push(`s=${sign}`)

  return {
    url: `https://${host}${path}?${query.join('&')}`,
    host,
    terminalId,
    receiptNo,
    fiscalSign: sign,
    datetime,
    total: null,
  }
}

/**
 * Takrorni aniqlash kaliti — fiskal belgi. Bazadagi unique indeks bilan aynan:
 * `(company_id, receipt_fiscal_sign) where deleted_at is null` (docs/automation-design.md, C bo'lim).
 */
export function receiptKey(qr: Pick<ReceiptQr, 'fiscalSign'>): string {
  return qr.fiscalSign
}
