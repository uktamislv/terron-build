// Batch 6 — Telegram bot xabar shablonlari: darhol yuboriladigan ogohlantirishlar,
// ogohlantirishlar to'plami (digest) va kunlik hisobot. Bitta joyda (CLAUDE.md "Telegram bot"),
// `tg-dispatch` import qiladi. Barcha matnlar `NOTIFY_TEXTS` da (keyin rus tili uchun).
// Sof modul: Deno va Node'da bir xil ishlaydi (faqat standart JS + Intl).
// Telegram `parse_mode: 'HTML'` — barcha foydalanuvchi matnlari `escapeHtml` dan o'tadi.
// Raqamlar float'ga aylantirilmaydi: satr asosida yaxlitlanadi va guruhlanadi.

export interface AlertPayload {
  alert_id: string
  type: string
  severity: string
  object_name: string | null
  material_name: string | null
  base_unit: string | null
  details: Record<string, unknown>
  created_at: string
  /** Kuchayish darajasi (1/2/3) — masalan normadan oshish +50 % / +100 % ga yetdi. */
  escalation?: number | null
}

export interface DailyReportPayload {
  date: string
  period_start: string
  period_end: string
  company_name: string
  kirim_count: number
  chiqim_count: number
  purchases_count: number
  purchases_sum: string
  requests_count: number
  alerts_new: number
  alerts_by_type: Record<string, number>
  self_received_count: number
  deleted_count: number
  restored_count: number
  failed_count: number
  transfers_pending_count: number
  chiqim_without_estimate_count: number
}

/** Telegram xabar matni chegarasi (belgilar). */
export const TELEGRAM_MAX_LENGTH = 4096
/** Bitta nom (material, obyekt, odam) uchun maksimal uzunlik — escape'dan oldin. */
const MAX_NAME_LENGTH = 120
/** Digest'da alohida qator bilan ko'rsatiladigan ogohlantirishlar soni. */
const DIGEST_MAX_ITEMS = 10

const MINUS = '−'
const TIME_ZONE = 'Asia/Tashkent'

/** Barcha bot xabar matnlari — bitta obyekt (rus tili keyin shu tuzilmada qo'shiladi). */
export const NOTIFY_TEXTS = {
  currency: 'so‘m',
  percent: '%',
  ellipsis: '…',
  openMiniApp: "Mini App'ni ochish",
  genericAlert: 'Yangi ogohlantirish',
  alertTitles: {
    xarid_qabul_farqi: 'Xarid va qabul farqi',
    ozi_qabul_qilgan: "O'zi qabul qilgan",
    narx_high: 'Narx odatdagidan yuqori',
    narx_low: 'Narx odatdagidan juda past',
    narx_ogishi: "Narx og'ishi",
    normadan_oshish: 'Normadan oshish',
    inventarizatsiya_kamomadi: 'Inventarizatsiya kamomadi',
    smetadan_ortiq_sorov: "Smetadan ortiq so'rov",
    otkazma_farqi: "O'tkazmada farq",
    otkazma_not_received: "O'tkazma qabul qilinmadi",
    smeta_waste_changed: "Isrof foizi o'zgartirildi",
    smeta_ozgarishi: "Smeta o'zgarishi",
    smeta_norm_increase: 'Smeta normasi oshirildi',
    smeta_old_version_restored: 'Smetaning eski versiyasi joriy qilindi',
    smeta_current_deleted: "Joriy smeta o'chirildi",
  },
  deletedTitles: {
    purchases: "Xarid o'chirildi",
    cash_advances: "Podotchet o'chirildi",
    kirim: "Kirim o'chirildi",
    chiqim: "Chiqim o'chirildi",
    movements: "Ombor harakati o'chirildi",
    other: "Yozuv o'chirildi",
  },
  restoredTitles: {
    purchases: 'Xarid tiklandi',
    cash_advances: 'Podotchet tiklandi',
    kirim: 'Kirim tiklandi',
    chiqim: 'Chiqim tiklandi',
    movements: 'Ombor harakati tiklandi',
    other: 'Yozuv tiklandi',
  },
  restored: {
    recordDate: 'Yozuv sanasi: ',
    /** "o'chirilganiga 12 kun" */
    daysSince: (n: string) => `o'chirilganiga ${n} kun`,
    actor: 'Tikladi: ',
    pastReportsChange: "⚠️ O'tgan davr hisobotlari o'zgaradi",
  },
  /** Kunlik hisobot va digest'dagi qisqa nomlar. */
  alertShort: {
    xarid_qabul_farqi: 'xarid/qabul',
    narx_ogishi: 'narx',
    ozi_qabul_qilgan: "o'zi qabul",
    yozuv_ochirildi: "o'chirish",
    yozuv_tiklandi: 'tiklandi',
    normadan_oshish: 'norma',
    inventarizatsiya_kamomadi: 'kamomad',
    smetadan_ortiq_sorov: 'smetadan ortiq',
    otkazma_farqi: "o'tkazma",
    smeta_ozgarishi: 'smeta',
  } as Record<string, string>,
  receipt: {
    purchased: 'Xarid: ',
    received: 'qabul: ',
    over: "Xariddan ko'p qabul qilingan",
    under: 'Xariddan kam qabul qilingan',
    threshold: 'Chegara: ',
  },
  selfReceived: {
    samePerson: 'Xarid qilgan va qabul qilgan — bitta odam',
    transferSamePerson: "O'tkazmani yuboruvchining o'zi qabul qildi",
    qty: 'Miqdor: ',
    notLinked: "Kirim xaridga bog'lanmagan",
  },
  price: {
    price: 'Narx: ',
    avgPrice: "O'rtacha narx: ",
    avg: "o'rtacha ",
    avg90: "90 kunlik o'rtacha: ",
  },
  estimate: {
    /** "v3" */
    version: (v: string) => `v${v}`,
    /** "⚠️ chiqim eski normadan oshgan (1 100 kg)" */
    exceededBefore: (consumed: string | null) =>
      `⚠️ chiqim eski normadan oshgan${consumed ? ` (${consumed})` : ''}`,
    /** "… va yana 3 ta" */
    more: (n: string) => `… va yana ${n} ta`,
  },
  norm: {
    consumed: 'Sarf: ',
    allowed: 'norma (isrof bilan): ',
    notInEstimate: "Material smetada yo'q, sarf: ",
  },
  request: {
    requested: "So'raldi: ",
    available: 'smetada qolgan: ',
    /** "ortiqcha 180 kg" */
    over: (qty: string) => `ortiqcha ${qty}`,
    notInEstimate: "Material smetada yo'q, so'raldi: ",
  },
  transfer: {
    sent: 'Yuborildi: ',
    received: 'qabul: ',
    /** "52 soat oldin" */
    hoursAgo: (h: string) => `${h} soat oldin`,
  },
  inventory: {
    /** "hisobda 2 400 kg" */
    expected: (q: string) => `hisobda ${q}`,
    notCounted: 'Sanalmagan:',
    /** "hisobda 500, sanaldi 420 kg" */
    expectedCounted: (expected: string, counted: string) => `hisobda ${expected}, sanaldi ${counted}`,
    total: 'Jami kamomad: ',
  },
  /** Kuchaygan ogohlantirish sarlavhasi oldidan. */
  escalated: '📈 Kuchaydi: ',
  /** "Smeta v3" */
  estimateVersion: (v: string) => `Smeta v${v}`,
  deleted: {
    object: 'Obyekt: ',
    actor: "O'chirdi: ",
  },
  report: {
    title: 'Kunlik hisobot',
    kirim: 'Kirim: ',
    chiqim: 'Chiqim: ',
    purchases: 'Xaridlar: ',
    pieces: ' ta',
    requests: "So'rovlar: ",
    alertsNew: 'Yangi farqlar: ',
    selfReceived: "O'zi qabul qilgan: ",
    deleted: "O'chirilgan yozuvlar: ",
    restored: 'Tiklangan yozuvlar: ',
    failed: 'Yuborilmagan xabarlar: ',
    transfersPending: "Qabul qilinmagan o'tkazmalar: ",
    chiqimWithoutEstimate: 'Smetasiz obyektlarda chiqim: ',
  },
  digest: {
    /** "12 ta yangi ogohlantirish" */
    title: (n: string) => `${n} ta yangi ogohlantirish`,
    /** "… va yana 15 ta" */
    more: (n: string) => `… va yana ${n} ta`,
    empty: "formatAlertDigest: bo'sh ro'yxat",
  },
} as const

// ---------------------------------------------------------------------------
// Yordamchilar
// ---------------------------------------------------------------------------

/** HTML-escape: `& < > "`. */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Nomni qisqartiradi (kerak bo'lsa "…") va escape qiladi. Bo'sh/yo'q → null. */
function nameHtml(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (s === '') return null
  const chars = Array.from(s)
  const clipped =
    chars.length > MAX_NAME_LENGTH ? chars.slice(0, MAX_NAME_LENGTH - 1).join('') + NOTIFY_TEXTS.ellipsis : s
  return escapeHtml(clipped)
}

const DEC_RE = /^([+-]?)(\d*)(?:\.(\d*))?$/

/** `numeric` qiymatini (JSON'da son yoki satr) o'nlik satrga keltiradi. Noto'g'ri → null. */
export function toDecString(v: unknown): string | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    const s = String(v)
    if (!/e/i.test(s)) return s
    if (Math.abs(v) >= 1) return BigInt(Math.round(v)).toString()
    return v.toFixed(12)
  }
  if (typeof v === 'bigint') return v.toString()
  if (typeof v !== 'string') return null
  const s = v.trim()
  const m = DEC_RE.exec(s)
  if (!m || ((m[2] ?? '') === '' && (m[3] ?? '') === '')) return null
  return s
}

/**
 * O'nlik satrni o'zbek formatida chiqaradi: minglik — bo'sh joy, kasr — vergul,
 * `maxFrac` xonagacha yaxlitlanadi (half away from zero), oxirgi nollar olib tashlanadi.
 * "1250000.00" → "1 250 000", "1450.5" → "1 450,5". Noto'g'ri qiymat → null.
 */
export function formatDecimal(v: unknown, maxFrac = 2): string | null {
  const s = toDecString(v)
  if (s === null) return null
  const m = DEC_RE.exec(s)
  if (!m) return null
  const negative = m[1] === '-'
  let intPart = m[2] === '' || m[2] === undefined ? '0' : m[2]
  let frac = m[3] ?? ''
  if (frac.length > maxFrac) {
    const roundUp = frac.charCodeAt(maxFrac) - 48 >= 5
    let digits = BigInt(intPart + frac.slice(0, maxFrac))
    if (roundUp) digits += 1n
    const str = digits.toString().padStart(maxFrac + 1, '0')
    intPart = str.slice(0, str.length - maxFrac)
    frac = str.slice(str.length - maxFrac)
  }
  frac = frac.replace(/0+$/, '')
  intPart = intPart.replace(/^0+(?=\d)/, '')
  const isZero = /^0*$/.test(intPart) && frac === ''
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${negative && !isZero ? '-' : ''}${grouped}${frac ? ',' + frac : ''}`
}

/** Summa: "1 250 000 so‘m". */
function moneyText(v: unknown): string | null {
  const n = formatDecimal(v, 2)
  return n === null ? null : `${n} ${NOTIFY_TEXTS.currency}`
}

/** Miqdor + asosiy birlik: "100 kg". */
function qtyText(v: unknown, unit: string | null): string | null {
  const n = formatDecimal(v, 3)
  if (n === null) return null
  const u = nameHtml(unit)
  return u ? `${n} ${u}` : n
}

/** Ishorali foiz: "+11,5 %", "−15 %". `sign` berilsa, qiymat moduli shu ishora bilan. */
function percentText(v: unknown, sign?: '+' | '-'): string | null {
  const n = formatDecimal(v, 2)
  if (n === null) return null
  const abs = n.replace(/^-/, '')
  if (abs === '0') return `0 ${NOTIFY_TEXTS.percent}`
  const s = sign ?? (n.startsWith('-') ? '-' : '+')
  return `${s === '-' ? MINUS : '+'}${abs} ${NOTIFY_TEXTS.percent}`
}

/** Soni (butun): "1 234"; noto'g'ri → "0". */
function count(v: unknown): string {
  return formatDecimal(v, 0) ?? '0'
}

const dtFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function tashkentParts(iso: string): Record<string, string> | null {
  if (typeof iso !== 'string' || iso.trim() === '') return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const parts: Record<string, string> = {}
  for (const p of dtFormatter.formatToParts(d)) parts[p.type] = p.value
  return parts
}

/** ISO vaqt → "dd.mm.yyyy HH:mm" (Asia/Tashkent). Noto'g'ri → null. */
export function formatDateTimeTashkent(iso: string): string | null {
  const p = tashkentParts(iso)
  return p ? `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}` : null
}

/** ISO vaqt → "dd.mm HH:mm" (Asia/Tashkent). Noto'g'ri → null. */
function formatShortDateTime(iso: string): string | null {
  const p = tashkentParts(iso)
  return p ? `${p.day}.${p.month} ${p.hour}:${p.minute}` : null
}

/** Hisobot oralig'i: "28.10 20:00 – 29.10 20:00" (Toshkent). Biror chegara noto'g'ri → null. */
export function formatPeriod(start: string, end: string): string | null {
  const a = formatShortDateTime(start)
  const b = formatShortDateTime(end)
  return a && b ? `${a} – ${b}` : null
}

/** "2026-10-29" → "29.10.2026". Boshqa ko'rinish — escape qilinib o'zi qaytadi. */
export function formatDateIso(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date))
  return m ? `${m[3]}.${m[2]}.${m[1]}` : escapeHtml(String(date))
}

/**
 * Qatorlarni birlashtiradi va Telegram chegarasiga sig'diradi: oxiridan butun qatorlar
 * olib tashlanadi (HTML teglar har qator ichida yopiq), o'rniga "…".
 */
function fitLines(lines: string[], max = TELEGRAM_MAX_LENGTH): string {
  const kept = lines.filter((l) => l !== '')
  let text = kept.join('\n')
  if (text.length <= max) return text
  while (kept.length > 1) {
    kept.pop()
    text = kept.join('\n') + '\n' + NOTIFY_TEXTS.ellipsis
    if (text.length <= max) return text
  }
  return (kept[0] ?? '').slice(0, max - 1) + NOTIFY_TEXTS.ellipsis
}

function contextLine(p: AlertPayload): string {
  return [nameHtml(p.material_name), nameHtml(p.object_name)].filter((x) => x).join(' · ')
}

function safeDetails(p: AlertPayload): Record<string, unknown> {
  return p.details && typeof p.details === 'object' ? p.details : {}
}

// ---------------------------------------------------------------------------
// Ogohlantirish xabari
// ---------------------------------------------------------------------------

function alertEmoji(type: string, severity: string, details: Record<string, unknown> = {}): string {
  if (type === 'yozuv_ochirildi') return '🗑'
  if (type === 'yozuv_tiklandi') return severity === 'jiddiy' ? '🔴' : '♻️'
  if (type === 'smeta_ozgarishi') {
    if (details.kind === 'old_version_restored') return '↩️'
    if (details.kind === 'current_deleted') return '🗑'
    if (details.kind === 'waste_changed') return '🧮'
    return severity === 'jiddiy' ? '🔴' : '📈'
  }
  if (type === 'ozi_qabul_qilgan') return '🔖'
  if (type === 'otkazma_farqi' && details.direction === 'not_received') return '⏳'
  if (severity === 'jiddiy') return '🔴'
  if (type === 'normadan_oshish') return '📉'
  if (type === 'smetadan_ortiq_sorov') return '📝'
  if (type === 'otkazma_farqi') return '🔄'
  if (type === 'inventarizatsiya_kamomadi') return '📦'
  return '⚠️'
}

function receiptLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.receipt
  const d = p.details
  const purchased = qtyText(d.purchased_qty_base, p.base_unit)
  const received = qtyText(d.received_qty_base, p.base_unit)
  const sign = d.direction === 'over' ? '+' : d.direction === 'under' ? '-' : undefined
  const pct = sign ? percentText(d.diff_pct, sign) : null
  const lines: string[] = []
  if (purchased || received) {
    const main = [purchased ? t.purchased + purchased : null, received ? t.received + received : null]
      .filter((x) => x)
      .join(', ')
    lines.push(pct ? `${main} (${pct})` : main)
  }
  if (d.direction === 'over') lines.push(t.over)
  else if (d.direction === 'under') lines.push(t.under)
  const thr = formatDecimal(d.threshold_pct, 2)
  if (thr !== null) lines.push(`${t.threshold}${thr} ${NOTIFY_TEXTS.percent}`)
  return lines
}

function selfReceivedLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.selfReceived
  const d = p.details
  const lines: string[] = [d.kind === 'transfer' ? t.transferSamePerson : t.samePerson]
  const qty = qtyText(d.qty_base, p.base_unit)
  if (qty) lines.push(t.qty + qty)
  if (d.linked === false) lines.push(t.notLinked)
  return lines
}

function priceLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.price
  const cur = NOTIFY_TEXTS.currency
  const d = p.details
  const unit = nameHtml(p.base_unit)
  const per = unit ? `/${unit}` : ''
  const price = formatDecimal(d.price, 2)
  const avgN = formatDecimal(d.avg_n, 2)
  const avg90 = formatDecimal(d.avg_90, 2)
  const diffN = percentText(d.diff_n)
  const diff90 = percentText(d.diff_90)
  const lines: string[] = []
  const useN = avgN !== null
  const avg = useN ? avgN : avg90
  const diff = useN ? diffN : diff90
  if (price !== null) {
    const extra = avg !== null ? ` (${t.avg}${avg}${diff ? `, ${diff}` : ''})` : ''
    lines.push(`${t.price}${price} ${cur}${per}${extra}`)
  } else if (avg !== null) {
    lines.push(`${t.avgPrice}${avg} ${cur}${per}${diff ? ` (${diff})` : ''}`)
  }
  if (useN && avg90 !== null) {
    lines.push(`${t.avg90}${avg90}${diff90 ? ` (${diff90})` : ''}`)
  }
  return lines
}

function deletedTitle(d: Record<string, unknown>): string {
  const t = NOTIFY_TEXTS.deletedTitles
  if (d.table === 'purchases') return t.purchases
  if (d.table === 'cash_advances') return t.cash_advances
  if (d.table === 'movements') {
    if (d.movement_type === 'kirim') return t.kirim
    if (d.movement_type === 'chiqim') return t.chiqim
    return t.movements
  }
  return t.other
}

/** O'chirilgan/tiklangan yozuv qisqa tavsifi: "Sement M400 · 1 000 kg · 1 250 000 so‘m · Ali". */
function recordSummary(p: AlertPayload): string {
  const d = p.details
  const material = nameHtml(d.material_name) ?? nameHtml(p.material_name)
  const unit = typeof d.base_unit === 'string' && d.base_unit.trim() !== '' ? d.base_unit : p.base_unit
  const parts: (string | null)[] = []
  if (d.table === 'cash_advances') {
    parts.push(moneyText(d.amount), nameHtml(d.recipient_name))
  } else if (d.table === 'purchases') {
    parts.push(material, qtyText(d.qty_base, unit), moneyText(d.amount), nameHtml(d.buyer_name))
  } else {
    parts.push(material, qtyText(d.qty_base, unit), moneyText(d.amount))
  }
  return parts.filter((x) => x).join(' · ')
}

function restoredTitle(d: Record<string, unknown>): string {
  const t = NOTIFY_TEXTS.restoredTitles
  if (d.table === 'purchases') return t.purchases
  if (d.table === 'cash_advances') return t.cash_advances
  if (d.table === 'movements') {
    if (d.movement_type === 'kirim') return t.kirim
    if (d.movement_type === 'chiqim') return t.chiqim
    return t.movements
  }
  return t.other
}

/** Sana: ISO vaqt → Toshkent sanasi, "yyyy-mm-dd" → "dd.mm.yyyy". Noto'g'ri → null. */
function dateOnly(v: unknown): string | null {
  if (typeof v !== 'string' || v.trim() === '') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return formatDateIso(v.trim())
  const dt = formatDateTimeTashkent(v)
  return dt ? dt.slice(0, 10) : null
}

/** Batch 10: "Yozuv sanasi: 03.10.2026 (o'chirilganiga 12 kun)", "Tikladi: Admin", jiddiy ogohlantirish. */
function restoredLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.restored
  const d = p.details
  const lines = [recordSummary(p)]
  const object = nameHtml(p.object_name)
  if (object) lines.push(NOTIFY_TEXTS.deleted.object + object)
  const date = dateOnly(d.occurred_at)
  const days = formatDecimal(d.days_since, 0)
  const since = days !== null && !days.startsWith('-') ? t.daysSince(days) : null
  if (date) lines.push(`${t.recordDate}${date}${since ? ` (${since})` : ''}`)
  else if (since) lines.push(since)
  const actor = nameHtml(d.actor_name)
  if (actor) lines.push(t.actor + actor)
  if (p.severity === 'jiddiy') lines.push(t.pastReportsChange)
  return lines
}

function deletedLines(p: AlertPayload): { main: string; extra: string[] } {
  const t = NOTIFY_TEXTS.deleted
  const d = p.details
  const object = nameHtml(p.object_name)
  const parts = [recordSummary(p)]
  const extra: string[] = []
  if (object) extra.push(t.object + object)
  const actor = nameHtml(d.actor_name)
  if (actor) extra.push(t.actor + actor)
  return { main: parts.join(''), extra }
}

/** "Obyekt A · v2 → v3 (Ali)" — smeta o'zgarishi konteksti. */
function estimateContext(p: AlertPayload): string {
  const d = p.details
  if (d.kind === 'waste_changed') return wasteChangedLine(p)
  const t = NOTIFY_TEXTS.estimate
  const v = formatDecimal(d.version, 0)
  const prev = formatDecimal(d.prev_version, 0)
  let versions = ''
  if (d.kind === 'current_deleted') versions = v ? t.version(v) : ''
  else if (prev && v) versions = `${t.version(prev)} → ${t.version(v)}`
  else if (v) versions = t.version(v)
  const main = [nameHtml(p.object_name), versions || null].filter((x) => x).join(' · ')
  const actor = nameHtml(d.actor_name)
  return actor ? (main ? `${main} (${actor})` : `(${actor})`) : main
}

/** "Sement M400: 3 % → 15 % (Ali)" — isrof foizi o'zgarishi. */
function wasteChangedLine(p: AlertPayload): string {
  const d = p.details
  const pct = NOTIFY_TEXTS.percent
  const material = nameHtml(d.material_name) ?? nameHtml(p.material_name)
  const before = formatDecimal(d.before, 2)
  const after = formatDecimal(d.after, 2)
  let change = ''
  if (before !== null && after !== null) change = `${before} ${pct} → ${after} ${pct}`
  else if (after !== null) change = `${after} ${pct}`
  const main = material && change ? `${material}: ${change}` : (material ?? change)
  const actor = nameHtml(d.actor_name)
  return actor ? (main ? `${main} (${actor})` : `(${actor})`) : main
}

/** "• Sement: 1 000 → 1 250 kg (+25 %) ⚠️ chiqim eski normadan oshgan (1 100 kg)" */
function estimateMaterialLines(p: AlertPayload): string[] {
  const raw = p.details.materials
  if (!Array.isArray(raw)) return []
  const items = raw.filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
  // exceeded_before = true — birinchi (barqaror tartib)
  const sorted = [...items.filter((m) => m.exceeded_before === true), ...items.filter((m) => m.exceeded_before !== true)]
  return sorted.map((m) => {
    const unit = nameHtml(m.base_unit) ?? nameHtml(p.base_unit)
    const before = formatDecimal(m.before, 3)
    const after = formatDecimal(m.after, 3)
    const name = nameHtml(m.material_name) ?? '?'
    let qty = before !== null && after !== null ? `${before} → ${after}` : (after ?? before ?? '')
    if (qty && unit) qty += ` ${unit}`
    const pct = percentText(m.diff_pct)
    let line = `• ${name}${qty ? `: ${qty}` : ''}${pct ? ` (${pct})` : ''}`
    if (m.exceeded_before === true) {
      const consumed = formatDecimal(m.consumed, 3)
      line += ' ' + NOTIFY_TEXTS.estimate.exceededBefore(consumed === null ? null : unit ? `${consumed} ${unit}` : consumed)
    }
    return line
  })
}

/** `more_count` → manfiy bo'lmagan butun son. */
function moreCount(v: unknown): number {
  const mc = formatDecimal(v, 0)
  return mc !== null && !mc.startsWith('-') ? Number(mc.replace(/ /g, '')) : 0
}

/**
 * Ro'yxatli xabar: `before` qatorlari, `items` (sig'maguncha oxiridan qisqartiriladi,
 * "… va yana N ta" qayta hisoblanadi), `after` qatorlari. ≤ 4096 belgi.
 */
function fitWithList(before: string[], items: string[], baseMore: number, after: string[]): string {
  const build = (kept: string[], more: number) =>
    [...before, ...kept, more > 0 ? NOTIFY_TEXTS.estimate.more(count(more)) : '', ...after]
      .filter((l) => l !== '')
      .join('\n')
  const kept = [...items]
  let text = build(kept, baseMore)
  while (text.length > TELEGRAM_MAX_LENGTH && kept.length > 0) {
    kept.pop()
    text = build(kept, baseMore + items.length - kept.length)
  }
  return text.length <= TELEGRAM_MAX_LENGTH ? text : fitLines([...before, ...after])
}

/** Smeta o'zgarishi xabari — materiallar ro'yxati 4096 ga sig'maguncha qisqartiriladi. */
function formatEstimateMessage(p: AlertPayload, head: string, when: string | null): string {
  const materials = p.details.kind === 'norm_increase' ? estimateMaterialLines(p) : []
  return fitWithList([head, estimateContext(p)], materials, moreCount(p.details.more_count), [when ?? ''])
}

/** details.base_unit (bo'lsa) yoki payload.base_unit. */
function unitOf(p: AlertPayload): string | null {
  return typeof p.details.base_unit === 'string' && p.details.base_unit.trim() !== ''
    ? p.details.base_unit
    : p.base_unit
}

function estimateVersionLine(d: Record<string, unknown>): string {
  const v = formatDecimal(d.estimate_version, 0)
  return v ? NOTIFY_TEXTS.estimateVersion(v) : ''
}

/** 4-qoida: "Sarf: 1 250 kg, norma (isrof bilan): 1 050 kg (+19,05 %)", "Smeta v3". */
function normLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.norm
  const d = p.details
  const unit = unitOf(p)
  const consumed = qtyText(d.consumed_qty_base, unit)
  if (d.not_in_estimate === true) return consumed ? [t.notInEstimate + consumed] : []
  const allowed = qtyText(d.allowed_qty_base ?? d.norm_qty_base, unit)
  const pct = percentText(d.over_pct)
  const parts = [consumed ? t.consumed + consumed : null, allowed ? t.allowed + allowed : null].filter((x) => x)
  const lines: string[] = []
  if (parts.length) lines.push(parts.join(', ') + (pct && allowed ? ` (${pct})` : ''))
  lines.push(estimateVersionLine(d))
  return lines
}

/** 6-qoida: "So'raldi: 500 kg, smetada qolgan: 320 kg (ortiqcha 180 kg)", "Smeta v3". */
function requestLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.request
  const d = p.details
  const unit = unitOf(p)
  const requested = qtyText(d.requested_qty_base, unit)
  if (d.not_in_estimate === true) return requested ? [t.notInEstimate + requested] : []
  const available = qtyText(d.available_qty_base, unit)
  const over = qtyText(d.over_qty_base, unit)
  const parts = [requested ? t.requested + requested : null, available ? t.available + available : null].filter(
    (x) => x,
  )
  const lines: string[] = []
  if (parts.length) lines.push(parts.join(', ') + (over ? ` (${t.over(over)})` : ''))
  lines.push(estimateVersionLine(d))
  return lines
}

/** O'tkazma: "Sement M400: Obyekt A → Obyekt B", "Yuborildi: 100 kg, qabul: 90 kg (−10 kg)". */
function transferLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.transfer
  const d = p.details
  const unit = unitOf(p)
  const from = nameHtml(d.from_object_name)
  const to = nameHtml(d.to_object_name)
  const material = nameHtml(p.material_name)
  const first =
    from || to
      ? `${material ? `${material}: ` : ''}${from ?? '?'} → ${to ?? '?'}`
      : contextLine(p)
  const sent = qtyText(d.sent_qty_base, unit)
  if (d.direction === 'not_received') {
    const h = formatDecimal(d.hours, 0)
    const parts = [sent ? t.sent + sent : null, h !== null ? t.hoursAgo(h) : null].filter((x) => x)
    return [first, parts.join(', ')]
  }
  const received = qtyText(d.received_qty_base, unit)
  const diffRaw = formatDecimal(d.diff_qty_base, 3)
  let diff: string | null = null
  if (diffRaw !== null && diffRaw !== '0') {
    const abs = diffRaw.replace(/^-/, '')
    const sign =
      d.direction === 'over' ? '+' : d.direction === 'under' ? MINUS : diffRaw.startsWith('-') ? MINUS : '+'
    const u = nameHtml(unit)
    diff = `${sign}${abs}${u ? ` ${u}` : ''}`
  }
  const parts = [sent ? t.sent + sent : null, received ? t.received + received : null].filter((x) => x)
  return [first, parts.length ? parts.join(', ') + (diff ? ` (${diff})` : '') : '']
}

/** "• Sement: hisobda 500, sanaldi 420 kg (−80 kg, 104 000 so‘m)" */
function inventoryItemLines(p: AlertPayload): string[] {
  const raw = p.details.items
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => {
      const unit = nameHtml(m.base_unit)
      const name = nameHtml(m.material_name) ?? '?'
      const expected = formatDecimal(m.expected, 3)
      const counted = formatDecimal(m.counted, 3)
      const shortage = formatDecimal(m.shortage, 3)
      const value = moneyText(m.shortage_value)
      let main = ''
      if (expected !== null && counted !== null) {
        main = NOTIFY_TEXTS.inventory.expectedCounted(expected, counted) + (unit ? ` ${unit}` : '')
      }
      const extra = [
        shortage !== null && shortage !== '0' ? `${MINUS}${shortage.replace(/^-/, '')}${unit ? ` ${unit}` : ''}` : null,
        value,
      ].filter((x) => x)
      return `• ${name}${main ? `: ${main}` : ''}${extra.length ? ` (${extra.join(', ')})` : ''}`
    })
}

/** "• Armatura: hisobda 2 400 kg, 3 120 000 so‘m" — sanalmagan materiallar. */
function notCountedLines(p: AlertPayload): string[] {
  const raw = p.details.not_counted
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => {
      const name = nameHtml(m.material_name) ?? '?'
      const q = qtyText(m.expected, typeof m.base_unit === 'string' ? m.base_unit : null)
      const parts = [q !== null ? NOTIFY_TEXTS.inventory.expected(q) : null, moneyText(m.shortage_value)].filter(
        (x) => x,
      )
      return `• ${name}${parts.length ? `: ${parts.join(', ')}` : ''}`
    })
}

/**
 * Inventarizatsiya: kamomad ro'yxati, "Sanalmagan:" bo'limi, jami. 4096 dan oshsa, avval
 * sanalmaganlar, keyin kamomad qatorlari oxiridan olib tashlanadi ("… va yana N ta" qayta hisoblanadi).
 */
function formatInventoryMessage(p: AlertPayload, head: string, when: string | null): string {
  const d = p.details
  const t = NOTIFY_TEXTS.inventory
  const more = NOTIFY_TEXTS.estimate.more
  const items = inventoryItemLines(p)
  const missing = notCountedLines(p)
  const itemsMore = moreCount(d.more_count)
  const missingMore = moreCount(d.not_counted_more)
  const total = moneyText(d.total_shortage_value)
  const hasMissing = missing.length > 0 || missingMore > 0
  const build = (a: string[], b: string[]) => {
    const restA = itemsMore + items.length - a.length
    const restB = missingMore + missing.length - b.length
    return [
      head,
      contextLine(p),
      ...a,
      restA > 0 ? more(count(restA)) : '',
      hasMissing ? t.notCounted : '',
      ...b,
      restB > 0 ? more(count(restB)) : '',
      total ? t.total + total : '',
      when ?? '',
    ]
      .filter((l) => l !== '')
      .join('\n')
  }
  const a = [...items]
  const b = [...missing]
  let text = build(a, b)
  while (text.length > TELEGRAM_MAX_LENGTH && (a.length > 0 || b.length > 0)) {
    if (b.length > 0) b.pop()
    else a.pop()
    text = build(a, b)
  }
  return text.length <= TELEGRAM_MAX_LENGTH ? text : fitLines([head, contextLine(p), when ?? ''])
}

/** Tur sarlavhasi (escape kerak emas — bizning matnimiz). */
function alertTitle(type: string, details: Record<string, unknown>): string {
  const titles = NOTIFY_TEXTS.alertTitles
  switch (type) {
    case 'xarid_qabul_farqi':
      return titles.xarid_qabul_farqi
    case 'ozi_qabul_qilgan':
      return titles.ozi_qabul_qilgan
    case 'narx_ogishi':
      return details.direction === 'high'
        ? titles.narx_high
        : details.direction === 'low'
          ? titles.narx_low
          : titles.narx_ogishi
    case 'yozuv_ochirildi':
      return deletedTitle(details)
    case 'yozuv_tiklandi':
      return restoredTitle(details)
    case 'normadan_oshish':
      return titles.normadan_oshish
    case 'inventarizatsiya_kamomadi':
      return titles.inventarizatsiya_kamomadi
    case 'smetadan_ortiq_sorov':
      return titles.smetadan_ortiq_sorov
    case 'otkazma_farqi':
      return details.direction === 'not_received' ? titles.otkazma_not_received : titles.otkazma_farqi
    case 'smeta_ozgarishi':
      if (details.kind === 'waste_changed') return titles.smeta_waste_changed
      return details.kind === 'norm_increase'
        ? titles.smeta_norm_increase
        : details.kind === 'old_version_restored'
          ? titles.smeta_old_version_restored
          : details.kind === 'current_deleted'
            ? titles.smeta_current_deleted
            : titles.smeta_ozgarishi
    default:
      return NOTIFY_TEXTS.genericAlert
  }
}

/** `escalation` 1–3 bo'lsa (payload yoki details'da) — "📈 Kuchaydi: ". */
function escalationPrefix(p: AlertPayload): string {
  const raw = p.escalation ?? (p.details && typeof p.details === 'object' ? p.details.escalation : undefined)
  const e = formatDecimal(raw, 0)
  return e === '1' || e === '2' || e === '3' ? NOTIFY_TEXTS.escalated : ''
}

/** Ogohlantirish uchun Telegram HTML xabari (≤ 4096 belgi). */
export function formatAlertMessage(p: AlertPayload): string {
  const details = safeDetails(p)
  const payload: AlertPayload = { ...p, details }
  const lines: string[] = []
  const ctx = contextLine(payload)
  const head = `${escalationPrefix(payload)}${alertEmoji(payload.type, payload.severity, details)} <b>${alertTitle(payload.type, details)}</b>`
  const when = formatDateTimeTashkent(payload.created_at)
  if (payload.type === 'smeta_ozgarishi') return formatEstimateMessage(payload, head, when)
  if (payload.type === 'inventarizatsiya_kamomadi') return formatInventoryMessage(payload, head, when)

  switch (payload.type) {
    case 'normadan_oshish':
      lines.push(ctx, ...normLines(payload))
      break
    case 'smetadan_ortiq_sorov':
      lines.push(ctx, ...requestLines(payload))
      break
    case 'otkazma_farqi':
      lines.push(...transferLines(payload))
      break
    case 'xarid_qabul_farqi':
      lines.push(ctx, ...receiptLines(payload))
      break
    case 'ozi_qabul_qilgan':
      lines.push(ctx, ...selfReceivedLines(payload))
      break
    case 'narx_ogishi':
      lines.push(ctx, ...priceLines(payload))
      break
    case 'yozuv_tiklandi':
      lines.push(...restoredLines(payload))
      break
    case 'yozuv_ochirildi': {
      const { main, extra } = deletedLines(payload)
      lines.push(main, ...extra)
      break
    }
    default:
      lines.push(ctx)
  }

  return fitLines([head, ...lines, when ?? ''])
}

// ---------------------------------------------------------------------------
// Tur bo'yicha sanoq (hisobot va digest uchun umumiy)
// ---------------------------------------------------------------------------

const ALERT_TYPE_ORDER = [
  'xarid_qabul_farqi',
  'narx_ogishi',
  'yozuv_ochirildi',
  'yozuv_tiklandi',
  'normadan_oshish',
  'inventarizatsiya_kamomadi',
  'smetadan_ortiq_sorov',
  'otkazma_farqi',
  'smeta_ozgarishi',
  'ozi_qabul_qilgan',
]

function typeRank(t: string): number {
  const i = ALERT_TYPE_ORDER.indexOf(t)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

/** "xarid/qabul — 2, narx — 1" (noldan katta turlar, qat'iy tartibda). */
function typeBreakdown(byType: Record<string, unknown>): string {
  const entries = Object.entries(byType && typeof byType === 'object' ? byType : {}).filter(([, n]) => {
    const c = formatDecimal(n, 0)
    return c !== null && c !== '0' && !c.startsWith('-')
  })
  entries.sort(([a], [b]) => typeRank(a) - typeRank(b) || (a < b ? -1 : a > b ? 1 : 0))
  return entries
    .map(([type, n]) => `${nameHtml(NOTIFY_TEXTS.alertShort[type] ?? type) ?? '?'} — ${count(n)}`)
    .join(', ')
}

// ---------------------------------------------------------------------------
// Digest — bir nechta ogohlantirish bitta xabarda
// ---------------------------------------------------------------------------

/**
 * Bir nechta ogohlantirish bitta xabarda: sarlavha, tur bo'yicha sanoq,
 * eng ko'pi 10 tasining bir qatorlik tavsifi, qolgani "… va yana N ta". ≤ 4096 belgi.
 * Bo'sh massiv — xato (chaqiruvchi bunday holatda xabar yubormasligi kerak).
 */
export function formatAlertDigest(payloads: AlertPayload[]): string {
  if (!Array.isArray(payloads) || payloads.length === 0) throw new Error(NOTIFY_TEXTS.digest.empty)
  const byType: Record<string, number> = {}
  for (const p of payloads) byType[p.type] = (byType[p.type] ?? 0) + 1

  const shown = payloads.slice(0, DIGEST_MAX_ITEMS)
  const items = shown.map((p) => {
    const details = safeDetails(p)
    const ctx =
      p.type === 'yozuv_ochirildi' || p.type === 'yozuv_tiklandi'
        ? [nameHtml(details.material_name) ?? nameHtml(p.material_name), nameHtml(p.object_name)]
            .filter((x) => x)
            .join(' · ')
        : p.type === 'smeta_ozgarishi'
          ? estimateContext({ ...p, details })
          : p.type === 'otkazma_farqi'
            ? (transferLines({ ...p, details })[0] ?? '')
            : contextLine(p)
    const head = `${escalationPrefix(p)}${alertEmoji(p.type, p.severity, details)} ${alertTitle(p.type, details)}`
    return ctx ? `${head}: ${ctx}` : head
  })
  const rest = payloads.length - shown.length

  const lines = [
    `⚠️ <b>${NOTIFY_TEXTS.digest.title(count(payloads.length))}</b>`,
    typeBreakdown(byType),
    ...items,
  ]
  if (rest > 0) lines.push(NOTIFY_TEXTS.digest.more(count(rest)))
  const text = lines.filter((l) => l !== '').join('\n')
  if (text.length <= TELEGRAM_MAX_LENGTH) return text
  // Sig'masa: oxirgi tavsiflarni olib tashlab, "… va yana N ta" ni qayta hisoblaymiz.
  const fixed = lines.slice(0, 2).filter((l) => l !== '')
  const kept = [...items]
  while (kept.length > 0) {
    kept.pop()
    const more = NOTIFY_TEXTS.digest.more(count(payloads.length - kept.length))
    const t = [...fixed, ...kept, more].join('\n')
    if (t.length <= TELEGRAM_MAX_LENGTH) return t
  }
  return fitLines([...fixed, NOTIFY_TEXTS.digest.more(count(payloads.length))])
}

// ---------------------------------------------------------------------------
// Kunlik hisobot
// ---------------------------------------------------------------------------

/** Kunlik hisobot (direktor uchun) — Telegram HTML (≤ 4096 belgi). */
export function formatDailyReport(p: DailyReportPayload): string {
  const t = NOTIFY_TEXTS.report
  const company = nameHtml(p.company_name)
  const period = formatPeriod(p.period_start, p.period_end)
  const breakdown = typeBreakdown(p.alerts_by_type)
  const sum = moneyText(p.purchases_sum) ?? `0 ${NOTIFY_TEXTS.currency}`
  const failed = count(p.failed_count)
  const positive = (v: unknown): string | null => {
    const c = count(v)
    return c !== '0' && !c.startsWith('-') ? c : null
  }
  const pending = positive(p.transfers_pending_count)
  const restored = positive(p.restored_count)
  const noEstimate = positive(p.chiqim_without_estimate_count)
  return fitLines([
    `📊 <b>${t.title} · ${formatDateIso(p.date)}</b>`,
    period ?? '',
    company ?? '',
    `${t.kirim}${count(p.kirim_count)} · ${t.chiqim}${count(p.chiqim_count)}`,
    noEstimate ? t.chiqimWithoutEstimate + noEstimate : '',
    `${t.purchases}${count(p.purchases_count)}${t.pieces}, ${sum}`,
    `${t.requests}${count(p.requests_count)}`,
    pending ? t.transfersPending + pending : '',
    `${t.alertsNew}${count(p.alerts_new)}${breakdown ? ` (${breakdown})` : ''}`,
    `${t.selfReceived}${count(p.self_received_count)}`,
    `${t.deleted}${count(p.deleted_count)}`,
    restored ? t.restored + restored : '',
    failed !== '0' && !failed.startsWith('-') ? `⚠️ ${t.failed}${failed}` : '',
  ])
}

// ---------------------------------------------------------------------------
// Inline tugma
// ---------------------------------------------------------------------------

/** Xabar ostidagi `web_app` tugmasi. */
export function miniAppKeyboard(
  url: string,
  text: string = NOTIFY_TEXTS.openMiniApp,
): { inline_keyboard: { text: string; web_app: { url: string } }[][] } {
  return { inline_keyboard: [[{ text, web_app: { url } }]] }
}
