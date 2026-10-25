// receipt-lookup — fiskal chek (ofd.soliq.uz QR havolasi) ma'lumotlarini olish
// (docs/automation-design.md, G bo'lim). Sof mantiq: tashqi bog'liqliklar `deps` orqali
// (testlar: ./logic.test.ts).
//
// Manba holati (26.10.2026 tekshirildi):
//   - `https://ofd.soliq.uz/check?...` hozir klientda chiziladigan SPA: HTML'da faqat
//     `<div id="root"></div>`, chek ma'lumoti yo'q.
//   - Sahifa ma'lumotni `POST https://new-ofd.soliq.uz/api/payment` dan
//     `{terminalId, paymentNo, paymentDate, paymentType: "CHECK", fiscalSign}` bilan oladi;
//     API `X-Signature` (sayt JS'iga joylangan kalit bilan HMAC) talab qiladi, imzosiz → 401
//     "Imzo topilmadi". Biz bu kalitni ishlatmaymiz (rasmiy ruxsat bo'lmaguncha).
//   Shuning uchun parser ikki ko'rinishni tushunadi: (1) API JSON javobi (`data` obyekti —
//   maydon nomlari sayt JS'idan), (2) chizilgan chek HTML'i (o'sha komponentning DOM tuzilmasi
//   va yorliqlari: "Chek raqami:", "Nomi/Soni/Narxi", "Naqd pul", "Bank kartalari",
//   "Jami to'lov"). SPA qobig'i → null → 422 `receipt_unparseable` (QR maydonlari javobda,
//   foydalanuvchi qo'lda to'ldiradi).
//
// Pul va miqdor — o'nlik satr; float arifmetika yo'q (qo'shish/bo'lish BigInt bilan).

import { errMessage, isRecord, respond, type HandlerResult, type LogFn } from '../_shared/handler.ts'

/** Ruxsat etilgan hostlar (aniq moslik). `src/domain/receipt/qr.ts` RECEIPT_HOSTS bilan bir xil. */
export const RECEIPT_HOSTS: readonly string[] = ['ofd.soliq.uz']
/** Ruxsat etilgan yo'llar. `src/domain/receipt/qr.ts` RECEIPT_PATHS bilan bir xil. */
export const RECEIPT_PATHS: readonly string[] = ['/check', '/epi']
export const MAX_URL_LENGTH = 2048
export const FETCH_TIMEOUT_MS = 5000
export const MAX_RESPONSE_BYTES = 1024 * 1024

export interface ReceiptQrParams {
  /** Kanonik havola — faqat tekshirilgan maydonlardan qayta qurilgan. */
  url: string
  kind: 'check' | 'epi'
  terminalId: string
  receiptNo: string
  fiscalSign: string
  /** `c` dan, ISO +05:00; yo'q/noto'g'ri → null. */
  datetime: string | null
}

export interface ReceiptItem {
  name: string
  qty: string | null
  /** Birlik narxi (sum / qty, 2 xona) — chekda alohida berilmasa hisoblanadi. */
  price: string | null
  /** Qator summasi (chekdagi "Narxi" ustuni — qator jami). */
  sum: string | null
}

export interface ReceiptData {
  sellerName: string | null
  sellerTin: string | null
  datetime: string | null
  total: string | null
  items: ReceiptItem[]
  fiscalSign: string | null
  terminalId: string | null
  receiptNo: string | null
}

export type FetchResult =
  | { ok: true; body: string; contentType: string | null }
  | { ok: false; reason: 'timeout' | 'network' | 'redirect' | 'http_status' | 'too_large'; status?: number }

export interface Caller {
  profileId: string
  companyId: string
}

export interface ReceiptLookupDeps {
  /** JWT → auth user id; anon kalit / yaroqsiz → null. */
  getAuthUserIdFromJwt: (jwt: string) => Promise<string | null>
  /** Faol profil (faol firma) yoki null. */
  getActiveProfile: (authUserId: string) => Promise<Caller | null>
  /** Kesh (firma bo'yicha, chaqiruvchi JWT'si bilan — RLS). Yo'q bo'lsa null. */
  cacheGet: (jwt: string, caller: Caller, qr: ReceiptQrParams) => Promise<ReceiptData | null>
  cachePut: (jwt: string, caller: Caller, qr: ReceiptQrParams, data: ReceiptData) => Promise<void>
  fetchPage: (url: string) => Promise<FetchResult>
  log: LogFn
}

// ---------------------------------------------------------------------------
// URL tekshiruvi
// ---------------------------------------------------------------------------

const TERMINAL_RE = /^[A-Z]{2}\d{12}$/
const RECEIPT_NO_RE = /^\d{1,12}$/
const FISCAL_RE = /^\d{6,20}$/
const DT_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** `yyyyMMddHHmmss` (Toshkent) → `yyyy-mm-ddTHH:mm:ss+05:00`; kalendar bo'yicha noto'g'ri → null. */
export function qrDateTime(c: string): string | null {
  const m = DT_RE.exec(c)
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number]
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  if (d > dim) return null
  return `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}:${pad2(s)}+05:00`
}

function singleParam(params: URLSearchParams, key: string): string | null | undefined {
  const all = params.getAll(key).map((v) => v.trim())
  if (all.length === 0) return undefined
  const first = all[0] as string
  return all.every((v) => v === first) ? first : null
}

/**
 * Faqat `https://ofd.soliq.uz/(check|epi)?t=..&r=..&s=..[&c=..]` qabul qilinadi.
 * Port, login/parol, boshqa host/sxema — rad. Kanonik URL qayta quriladi.
 */
export function validateReceiptUrl(raw: unknown): ReceiptQrParams | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (s === '' || s.length > MAX_URL_LENGTH) return null
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (u.username !== '' || u.password !== '' || u.port !== '') return null
  const host = u.hostname.toLowerCase()
  if (!RECEIPT_HOSTS.includes(host)) return null
  const path = u.pathname.toLowerCase().replace(/\/+$/, '')
  if (!RECEIPT_PATHS.includes(path)) return null

  const lower = new URLSearchParams()
  for (const [k, v] of u.searchParams) lower.append(k.toLowerCase(), v)
  const t = singleParam(lower, 't')
  const r = singleParam(lower, 'r')
  const sign = singleParam(lower, 's')
  const c = singleParam(lower, 'c')
  if (typeof t !== 'string' || typeof r !== 'string' || typeof sign !== 'string') return null
  const terminalId = t.toUpperCase()
  if (!TERMINAL_RE.test(terminalId) || !RECEIPT_NO_RE.test(r) || !FISCAL_RE.test(sign)) return null
  const receiptNo = r.replace(/^0+(?=\d)/, '')
  const datetime = typeof c === 'string' ? qrDateTime(c) : null

  const kind = path === '/epi' ? 'epi' : 'check'
  const query = new URLSearchParams({ t: terminalId, r: receiptNo })
  if (datetime !== null && typeof c === 'string') query.set('c', c)
  query.set('s', sign)
  return {
    url: `https://${host}${path}?${query.toString()}`,
    kind,
    terminalId,
    receiptNo,
    fiscalSign: sign,
    datetime,
  }
}

// ---------------------------------------------------------------------------
// O'nlik satrlar (float'siz)
// ---------------------------------------------------------------------------

const PLAIN_DEC_RE = /^-?\d+(?:\.\d+)?$/

/**
 * Pul/miqdor qiymatini o'nlik satrga: son (JSON) yoki satr — "1,234,567.00" (en-US),
 * "1 234 567,50", "1234567", "15 000 so'm". Noto'g'ri / noaniq → null.
 */
export function toDecimal(v: unknown): string | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    const s = String(v)
    return PLAIN_DEC_RE.test(s) ? normalizeDec(s) : null
  }
  if (typeof v !== 'string') return null
  let s = v
    .replace(/[\u00a0\u202f\u2009]/g, ' ')
    .replace(/so[''ʻʼ`‘’]?m|сум|uzs/gi, '')
    .trim()
  if (s === '') return null
  const neg = /^[-−]/.test(s)
  s = s.replace(/^[-−]\s*/, '')
  if (!/^[\d\s.,]+$/.test(s) || !/\d/.test(s)) return null
  s = s.replace(/\s+/g, '')
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot !== -1 && lastComma !== -1) {
    // Oxirgisi — kasr ajratgich, boshqasi — minglik
    const decSep = lastDot > lastComma ? '.' : ','
    const thouSep = decSep === '.' ? ',' : '.'
    s = s.split(thouSep).join('')
    if (s.split(decSep).length !== 2) return null
    s = s.replace(decSep, '.')
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? ',' : '.'
    const parts = s.split(sep)
    if (parts.length > 2) {
      // faqat minglik: "1,234,567"
      if (!parts.slice(1).every((p) => p.length === 3)) return null
      s = parts.join('')
    } else if (sep === ',' && (parts[1] as string).length === 3 && (parts[0] as string).length <= 3 && parts[0] !== '0') {
      // "1,234" — en-US minglik (pul chekda 2 xona bilan chiqadi, shuning uchun minglik deb olamiz)
      s = parts.join('')
    } else {
      s = parts.join('.')
    }
  }
  if (!PLAIN_DEC_RE.test(s)) return null
  return normalizeDec((neg ? '-' : '') + s)
}

function normalizeDec(s: string): string {
  const neg = s.startsWith('-')
  const body = neg ? s.slice(1) : s
  let [int = '0', frac = ''] = body.split('.')
  int = int.replace(/^0+(?=\d)/, '')
  frac = frac.replace(/0+$/, '')
  const out = frac ? `${int}.${frac}` : int
  return neg && out !== '0' ? `-${out}` : out
}

function toScaled(s: string, scale: number): bigint {
  const neg = s.startsWith('-')
  const [int = '0', frac = ''] = (neg ? s.slice(1) : s).split('.')
  const f = (frac + '0'.repeat(scale)).slice(0, scale)
  const v = BigInt(int + f)
  return neg ? -v : v
}

function fromScaled(v: bigint, scale: number): string {
  const neg = v < 0n
  const abs = (neg ? -v : v).toString().padStart(scale + 1, '0')
  const int = abs.slice(0, abs.length - scale)
  const frac = abs.slice(abs.length - scale)
  return normalizeDec(`${neg ? '-' : ''}${int}${scale > 0 ? '.' + frac : ''}`)
}

function maxScale(...vals: string[]): number {
  return Math.max(0, ...vals.map((s) => (s.split('.')[1] ?? '').length))
}

/** O'nlik satrlar yig'indisi (aniq). */
export function decAdd(a: string, b: string): string {
  const sc = maxScale(a, b)
  return fromScaled(toScaled(a, sc) + toScaled(b, sc), sc)
}

/** a / b, `places` xonagacha (half away from zero). b = 0 → null. */
export function decDiv(a: string, b: string, places = 2): string | null {
  const sc = maxScale(a, b)
  const bi = toScaled(b, sc)
  if (bi === 0n) return null
  const num = toScaled(a, sc) * 10n ** BigInt(places + 1)
  let q = num / bi // places+1 xona
  const neg = q < 0n
  if (neg) q = -q
  q = (q + 5n) / 10n
  return fromScaled(neg ? -q : q, places)
}

// ---------------------------------------------------------------------------
// Sana-vaqt
// ---------------------------------------------------------------------------

/** Chekdagi sana-vaqt → ISO (+05:00). "2020-05-18 22:14:03", "18.05.2020 22:14", "20200518221403". */
export function parseReceiptDateTime(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).trim()
  let m = /^(\d{14})$/.exec(s)
  if (m) return qrDateTime(m[1] as string)
  m = /(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s)
  if (m) return qrDateTime(`${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6] ?? '00'}`)
  m = /(\d{2})[./](\d{2})[./](\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s)
  if (m) return qrDateTime(`${m[3]}${m[2]}${m[1]}${(m[4] as string).padStart(2, '0')}${m[5]}${m[6] ?? '00'}`)
  return null
}

// ---------------------------------------------------------------------------
// Parser: JSON (API javobi)
// ---------------------------------------------------------------------------

function str(v: unknown, max = 300): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s === '' ? null : s.slice(0, max)
}

function tinOf(v: unknown): string | null {
  const s = str(v)
  if (s === null) return null
  const digits = s.replace(/\s/g, '')
  return /^\d{9}$|^\d{14}$/.test(digits) ? digits : null
}

function itemFrom(name: string, qtyRaw: unknown, sumRaw: unknown, unitPriceRaw?: unknown): ReceiptItem {
  const qty = toDecimal(qtyRaw)
  const sum = toDecimal(sumRaw)
  let price = unitPriceRaw === undefined ? null : toDecimal(unitPriceRaw)
  if (price === null && qty !== null && sum !== null && !qty.startsWith('-')) price = decDiv(sum, qty, 2)
  return { name: name.slice(0, 300), qty, price, sum }
}

function parseJsonReceipt(root: unknown): ReceiptData | null {
  if (!isRecord(root)) return null
  const data = isRecord(root.data) ? root.data : Array.isArray(root.paymentDetails) ? root : null
  if (data === null) return null
  const extra = isRecord(data.extraInfo) ? data.extraInfo : {}
  const details = Array.isArray(data.paymentDetails) ? data.paymentDetails : []
  const items: ReceiptItem[] = []
  for (const d of details.slice(0, 500)) {
    if (!isRecord(d)) continue
    const name = str(d.name) ?? str(d.productName)
    if (name === null) continue
    items.push(itemFrom(name, d.amount, d.price, d.unitPrice))
  }
  const cash = toDecimal(data.cashTotal)
  const card = toDecimal(data.cardTotal)
  let total = toDecimal(data.total) ?? toDecimal(data.totalSum)
  if (total === null && (cash !== null || card !== null)) total = decAdd(cash ?? '0', card ?? '0')
  const result: ReceiptData = {
    sellerName: str(extra.companyName) ?? str(data.companyName),
    sellerTin: tinOf(data.tin) ?? tinOf(extra.tin),
    datetime: parseReceiptDateTime(data.paymentDate),
    total,
    items,
    fiscalSign: str(data.fiscalSign, 40),
    terminalId: str(data.terminalId, 40),
    receiptNo: str(data.paymentNo, 40) ?? str(data.receiptSeq, 40),
  }
  return hasContent(result) ? result : null
}

// ---------------------------------------------------------------------------
// Parser: HTML (chizilgan chek)
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z0-9]{2,8});/gi, (m, e: string) => {
    const k = e.toLowerCase()
    if (k in ENTITIES) return ENTITIES[k] as string
    let cp: number | null = null
    if (k.startsWith('#x')) cp = parseInt(k.slice(2), 16)
    else if (k.startsWith('#')) cp = parseInt(k.slice(1), 10)
    if (cp === null || !Number.isFinite(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return m
    return String.fromCodePoint(cp)
  })
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Apostrof variantlari va registrni birxillashtirish (yorliq solishtirish uchun). */
function labelKey(s: string): string {
  return s.toLowerCase().replace(/[‘’ʻʼ`´]/g, "'").replace(/\s+/g, ' ').replace(/:$/, '').trim()
}

const TOTAL_LABELS = ["jami to'lov", 'jami', 'итого', 'всего', "jami to'lov summasi"]
const CASH_LABELS = ['naqd pul', 'naqd', 'наличные']
const CARD_LABELS = ['bank kartalari', 'bank kartasi', 'karta', 'безналичные', 'карта']
const TIN_LABELS = ['stir', 'inn', 'инн', 'стир', "stir/jshshir"]
const FISCAL_LABELS = ['fp', 'фп', 'fiskal belgi', 'фискальный признак']
const TERMINAL_LABELS = ['fm', 'фм', 'fiskal modul', 'фискальный модуль']
/** Mahsulot ostidagi tafsilot qatorlari — mahsulot emas. */
const DETAIL_LABELS = [
  'qqs qiymati', 'qqs foizi', 'chegirma/boshqa', 'shtrix kodi', 'mxik kodi', 'mxik nomi', "o'lchov birligi",
  'markirovka kodi', 'komitent stir/jshshir', 'voucher(chegirma)', 'bank kartasi turi', "to'lov turi",
  'karta raqami', 'rrn kodi', 'umumiy qqs qiymati', 'jami voucher(chegirma)',
]

function isHeaderRow(cells: string[]): boolean {
  const k = cells.map(labelKey)
  const has = (opts: string[]) => k.some((c) => opts.includes(c))
  return has(['nomi', 'наименование', 'mahsulot']) && has(['soni', 'кол-во', 'miqdori', 'количество'])
}

/**
 * Izohlar va script/style/noscript/template ichini olib tashlaydi — chiziqli (indexOf),
 * yopilmagan blok hujjat oxirigacha tashlanadi.
 */
function stripRaw(html: string): string {
  const lower = html.toLowerCase()
  const startRe = /<!--|<(script|style|noscript|template)\b/g
  let out = ''
  let pos = 0
  let m: RegExpExecArray | null
  while ((m = startRe.exec(lower)) !== null) {
    out += html.slice(pos, m.index) + ' '
    const closer = m[1] === undefined ? '-->' : `</${m[1]}`
    const end = lower.indexOf(closer, m.index + m[0].length)
    if (end === -1) return out
    const gt = m[1] === undefined ? end + 3 : lower.indexOf('>', end)
    pos = gt === -1 ? html.length : m[1] === undefined ? gt : gt + 1
    startRe.lastIndex = pos
  }
  return out + html.slice(pos)
}

interface Scanned {
  rows: string[][]
  blocks: { text: string; bold: boolean }[]
}

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const MAX_DEPTH = 512
const MAX_ITEMS = 2000

/**
 * HTML'ni bir marta, chiziqli o'tishda skanerlaydi (regex backtracking yo'q):
 * jadval qatorlari (td/th matnlari) va eng ichki matn bloklari (p/div/h*).
 * Yopilmagan / noto'g'ri teglar xato emas — mos kelmagan yopuvchi e'tiborsiz.
 */
function scanHtml(html: string): Scanned {
  const rows: string[][] = []
  const blocks: { text: string; bold: boolean }[] = []
  let row: string[] | null = null
  let cell: string | null = null
  const stack: { name: string; text: string; hasChild: boolean; bold: boolean; sawTag: boolean }[] = []
  const tokenRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>|([^<]+)|</g
  let m: RegExpExecArray | null
  const addText = (t: string) => {
    if (cell !== null) cell += t
    const top = stack[stack.length - 1]
    if (top !== undefined) top.text += t
  }
  while ((m = tokenRe.exec(html)) !== null) {
    if (m[4] !== undefined || m[2] === undefined) {
      addText(m[4] ?? '<')
      continue
    }
    const closing = m[1] === '/'
    const name = m[2].toLowerCase()
    const attrs = m[3] ?? ''
    const top = stack[stack.length - 1]
    if (!closing && top !== undefined && !top.sawTag) {
      top.sawTag = true
      if ((name === 'b' || name === 'strong') && top.text.trim() === '') top.bold = true
    }
    if (name === 'br') {
      addText(' ')
    } else if (name === 'tr') {
      if (row !== null && row.length > 0 && rows.length < MAX_ITEMS) rows.push(row)
      row = closing ? null : []
      cell = null
    } else if (name === 'td' || name === 'th') {
      if (cell !== null && row !== null) row.push(textOf(cell))
      cell = closing ? null : ''
    } else if (name === 'table') {
      if (row !== null && row.length > 0 && rows.length < MAX_ITEMS) rows.push(row)
      row = null
      cell = null
      if (!closing && top !== undefined) top.hasChild = true
    } else if (BLOCK_TAGS.has(name)) {
      if (!closing) {
        if (top !== undefined) top.hasChild = true
        if (stack.length < MAX_DEPTH) {
          const bold = /font-weight\s*:\s*(bold|[6-9]00)/i.test(attrs) || name.startsWith('h')
          stack.push({ name, text: '', hasChild: false, bold, sawTag: false })
        }
      } else {
        let idx = -1
        for (let i = stack.length - 1; i >= 0 && i >= stack.length - 16; i--) {
          if (stack[i]?.name === name) {
            idx = i
            break
          }
        }
        if (idx !== -1) {
          const popped = stack.splice(idx)
          const b = popped[0] as (typeof popped)[number]
          const text = textOf(b.text)
          if (!b.hasChild && text !== '' && blocks.length < MAX_ITEMS) blocks.push({ text, bold: b.bold })
          // ichki (yopilmagan) bloklar matni tashqariga o'tadi
          const parent = stack[stack.length - 1]
          if (parent !== undefined) parent.text += ' ' + popped.map((p) => p.text).join(' ')
        }
      }
    }
  }
  if (cell !== null && row !== null) row.push(textOf(cell))
  if (row !== null && row.length > 0 && rows.length < MAX_ITEMS) rows.push(row)
  return { rows, blocks }
}

/** "Yorliq: qiymat" ko'rinishidagi qiymat. */
function labeled(text: string, labels: string[]): string | null {
  const m = /^([^:]{1,40}):\s*(.+)$/.exec(text)
  if (!m) return null
  return labels.includes(labelKey(m[1] as string)) ? (m[2] as string).trim() : null
}

function parseHtmlReceipt(html: string): ReceiptData | null {
  const clean = stripRaw(html)
  const { rows, blocks } = scanHtml(clean)

  const items: ReceiptItem[] = []
  let total: string | null = null
  let cash: string | null = null
  let card: string | null = null
  let inItems = false
  for (const cells of rows) {
    if (isHeaderRow(cells)) {
      inItems = true
      continue
    }
    const first = labelKey(cells[0] ?? '')
    const last = cells[cells.length - 1] ?? ''
    if (TOTAL_LABELS.includes(first)) {
      total = toDecimal(last) ?? total
      inItems = false
      continue
    }
    if (CASH_LABELS.includes(first)) {
      cash = toDecimal(last)
      inItems = false
      continue
    }
    if (CARD_LABELS.includes(first)) {
      card = toDecimal(last)
      inItems = false
      continue
    }
    if (!inItems || DETAIL_LABELS.includes(first) || cells.length < 3) continue
    const name = (cells[0] ?? '').trim()
    if (name === '') continue
    const qty = toDecimal(cells[1])
    const sum = toDecimal(cells[cells.length - 1])
    if (qty === null && sum === null) continue
    items.push(itemFrom(name, cells[1], cells[cells.length - 1]))
    if (items.length >= 500) break
  }
  if (total === null && (cash !== null || card !== null)) total = decAdd(cash ?? '0', card ?? '0')

  let sellerName: string | null = null
  let sellerTin: string | null = null
  let receiptNo: string | null = null
  let fiscalSign: string | null = null
  let terminalId: string | null = null
  let datetime: string | null = null
  let afterTitle = false
  for (const { text, bold } of blocks) {
    const key = labelKey(text)
    if (/^(savdo|avans|kredit) cheki/.test(key) || /^кассовый чек/.test(key)) {
      afterTitle = true
      continue
    }
    const no = labeled(text, ['chek raqami', 'номер чека', 'chek №'])
    if (no !== null) {
      receiptNo = /^\d+$/.test(no) ? no.replace(/^0+(?=\d)/, '') : receiptNo
      continue
    }
    const tin = labeled(text, TIN_LABELS)
    if (tin !== null) {
      sellerTin = tinOf(tin) ?? sellerTin
      continue
    }
    const fp = labeled(text, FISCAL_LABELS)
    if (fp !== null) {
      fiscalSign = /^\d{6,20}$/.test(fp) ? fp : fiscalSign
      continue
    }
    const fm = labeled(text, TERMINAL_LABELS)
    if (fm !== null) {
      terminalId = TERMINAL_RE.test(fm.toUpperCase()) ? fm.toUpperCase() : terminalId
      continue
    }
    if (terminalId === null && TERMINAL_RE.test(text)) {
      terminalId = text
      continue
    }
    if (datetime === null) {
      const dt = parseReceiptDateTime(text)
      if (dt !== null && text.length <= 40) {
        datetime = dt
        continue
      }
    }
    if (sellerName === null && bold && (afterTitle || blocks.length < 50) && text.length <= 200 && !/^\d/.test(text)) {
      sellerName = text
      continue
    }
    // Manzil + STIR ("Toshkent sh., ... 123456789") — sotuvchi nomidan keyingi blok
    if (sellerTin === null && sellerName !== null) {
      const m = /(?:^|\D)(\d{9}|\d{14})\s*$/.exec(text)
      if (m) sellerTin = m[1] as string
    }
  }

  const result: ReceiptData = { sellerName, sellerTin, datetime, total, items, fiscalSign, terminalId, receiptNo }
  return hasContent(result) ? result : null
}

/** Foydali ma'lumot bormi: jami summa, kamida bitta qator yoki sotuvchi + STIR. */
function hasContent(r: ReceiptData): boolean {
  return r.total !== null || r.items.length > 0 || (r.sellerName !== null && r.sellerTin !== null)
}

/**
 * Sahifadan olingan fiskal belgi va terminal (bo'lsa) QR'dagi bilan bir xilmi.
 * Yo'q (null) maydon — tekshirilmaydi (QR qiymati qo'yiladi).
 */
export function matchesQr(parsed: Pick<ReceiptData, 'fiscalSign' | 'terminalId'>, qr: ReceiptQrParams): boolean {
  const norm = (v: string) => v.replace(/\s+/g, '').toUpperCase()
  if (parsed.fiscalSign !== null && norm(parsed.fiscalSign) !== norm(qr.fiscalSign)) return false
  if (parsed.terminalId !== null && norm(parsed.terminalId) !== norm(qr.terminalId)) return false
  return true
}

/**
 * Javob matnidan chek ma'lumotlari. Hech qachon xato tashlamaydi; tushunarsiz → null.
 * Topilmagan maydonlar QR qiymatlari bilan to'ldiriladi (fiskal belgi, terminal, raqam, vaqt).
 */
export function parseReceiptDocument(body: string, contentType: string | null, qr: ReceiptQrParams): ReceiptData | null {
  try {
    if (typeof body !== 'string' || body.trim() === '') return null
    let parsed: ReceiptData | null = null
    const trimmed = body.trimStart()
    if ((contentType ?? '').toLowerCase().includes('json') || trimmed.startsWith('{')) {
      try {
        parsed = parseJsonReceipt(JSON.parse(body) as unknown)
      } catch {
        parsed = null
      }
    }
    if (parsed === null && trimmed.startsWith('<')) parsed = parseHtmlReceipt(body)
    if (parsed === null) return null
    // Sahifa boshqa chekni ko'rsatsa (fiskal belgi / terminal QR'dagidan farq qiladi) — ishonilmaydi,
    // keshga yozilmaydi (handler 422 qaytaradi).
    if (!matchesQr(parsed, qr)) return null
    return {
      ...parsed,
      fiscalSign: parsed.fiscalSign ?? qr.fiscalSign,
      terminalId: parsed.terminalId ?? qr.terminalId,
      receiptNo: parsed.receiptNo ?? qr.receiptNo,
      datetime: parsed.datetime ?? qr.datetime,
    }
  } catch {
    return null
  }
}

/**
 * Keshdan (jsonb) o'qilgan qiymatni `ReceiptData` ga keltiradi; shakli noto'g'ri bo'lsa null
 * (kesh "topilmadi" deb hisoblanadi). Pul/miqdor yana o'nlik satr sifatida tekshiriladi.
 */
export function coerceReceiptData(v: unknown): ReceiptData | null {
  if (!isRecord(v) || !Array.isArray(v.items)) return null
  const s = (x: unknown, max = 300): string | null => (typeof x === 'string' && x !== '' ? x.slice(0, max) : null)
  const items: ReceiptItem[] = []
  for (const it of v.items.slice(0, 500)) {
    if (!isRecord(it) || typeof it.name !== 'string') continue
    items.push({ name: it.name.slice(0, 300), qty: toDecimal(it.qty), price: toDecimal(it.price), sum: toDecimal(it.sum) })
  }
  const r: ReceiptData = {
    sellerName: s(v.sellerName),
    sellerTin: tinOf(v.sellerTin),
    datetime: parseReceiptDateTime(v.datetime) ?? (typeof v.datetime === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:00$/.test(v.datetime) ? v.datetime : null),
    total: toDecimal(v.total),
    items,
    fiscalSign: s(v.fiscalSign, 40),
    terminalId: s(v.terminalId, 40),
    receiptNo: s(v.receiptNo, 40),
  }
  return hasContent(r) ? r : null
}

/** QR'dan ma'lum maydonlar (sahifa o'qilmaganda javobda qaytadi). */
export function qrFields(qr: ReceiptQrParams): Pick<ReceiptData, 'fiscalSign' | 'terminalId' | 'receiptNo' | 'datetime'> & { url: string } {
  return { url: qr.url, fiscalSign: qr.fiscalSign, terminalId: qr.terminalId, receiptNo: qr.receiptNo, datetime: qr.datetime }
}

// ---------------------------------------------------------------------------
// Javobni o'qish (hajm chegarasi)
// ---------------------------------------------------------------------------

/** Oqimni `maxBytes` gacha o'qiydi; oshsa — null (o'qish to'xtatiladi). UTF-8 matn. */
export async function readCapped(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | null> {
  if (stream === null) return ''
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const all = new Uint8Array(size)
  let off = 0
  for (const c of chunks) {
    all.set(c, off)
    off += c.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(all)
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function bearer(authHeader: string | null): string | null {
  if (typeof authHeader !== 'string') return null
  const m = /^Bearer\s+(\S+)$/i.exec(authHeader.trim())
  return m ? (m[1] as string) : null
}

const err = (status: number, error: string, extra: Record<string, unknown> = {}): HandlerResult =>
  respond(status, { error, ...extra })

/**
 * Javoblar:
 * - 200 `{ receipt: ReceiptData, cached: boolean }`
 * - 400 `invalid_request` (body yaroqsiz) / `receipt_url_not_allowed` (host, sxema, yo'l, parametrlar)
 * - 401 `unauthorized` (JWT yo'q, yaroqsiz, anon); 403 `forbidden` (faol profil yo'q)
 * - 422 `receipt_unparseable` + `qr` — sahifa ochildi, lekin chek ma'lumoti topilmadi
 * - 502 `receipt_fetch_failed` + `qr` + `reason` — timeout, redirect, status, > 1 MB, tarmoq
 * - 500 `internal`
 */
export async function handleReceiptLookup(
  authHeader: string | null,
  body: unknown,
  deps: ReceiptLookupDeps,
): Promise<HandlerResult> {
  const jwt = bearer(authHeader)
  if (jwt === null) return err(401, 'unauthorized')
  if (!isRecord(body) || typeof body.url !== 'string') return err(400, 'invalid_request')
  const qr = validateReceiptUrl(body.url)
  if (qr === null) return err(400, 'receipt_url_not_allowed')

  let caller: Caller | null
  try {
    const authId = await deps.getAuthUserIdFromJwt(jwt)
    if (authId === null) return err(401, 'unauthorized')
    caller = await deps.getActiveProfile(authId)
  } catch (e) {
    deps.log('error', 'receipt-lookup: chaqiruvchi tekshirilmadi', { error: errMessage(e) })
    return err(500, 'internal')
  }
  if (caller === null) return err(403, 'forbidden')

  try {
    const hit = await deps.cacheGet(jwt, caller, qr)
    if (hit !== null) return respond(200, { receipt: hit, cached: true })
  } catch (e) {
    // Kesh — ixtiyoriy; xato bo'lsa davom etamiz.
    deps.log('warn', 'receipt-lookup: kesh o\'qilmadi', { error: errMessage(e), company_id: caller.companyId })
  }

  let page: FetchResult
  try {
    page = await deps.fetchPage(qr.url)
  } catch (e) {
    deps.log('warn', 'receipt-lookup: so\'rov xatosi', { error: errMessage(e) })
    page = { ok: false, reason: 'network' }
  }
  if (!page.ok) {
    deps.log('info', 'receipt-lookup: sahifa olinmadi', { reason: page.reason, status: page.status ?? null })
    return err(502, 'receipt_fetch_failed', { reason: page.reason, qr: qrFields(qr) })
  }

  const receipt = parseReceiptDocument(page.body, page.contentType, qr)
  if (receipt === null) {
    deps.log('info', 'receipt-lookup: chek ajratilmadi', { bytes: page.body.length, kind: qr.kind })
    return err(422, 'receipt_unparseable', { qr: qrFields(qr) })
  }

  try {
    await deps.cachePut(jwt, caller, qr, receipt)
  } catch (e) {
    deps.log('warn', 'receipt-lookup: kesh yozilmadi', { error: errMessage(e), company_id: caller.companyId })
  }
  return respond(200, { receipt, cached: false })
}
