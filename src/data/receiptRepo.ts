import { RepoError } from './errors'
import { invokeFunction } from './functions'

/** Soliq cheki sahifasidan o'qilgan qator. Raqamlar — satr (Dec). */
export interface ReceiptLine {
  name: string
  qty: string
  price: string
  sum: string
  /** Chekdagi birlik ("kg", "dona"), bo'lmasa null — "ta" deb taxmin qilinmaydi. */
  unit: string | null
}

/** `receipt-lookup` Edge Function natijasi. */
export interface ReceiptLookup {
  sellerName: string | null
  sellerTin: string | null
  /** ISO sana-vaqt yoki null. */
  datetime: string | null
  /** Chek jami (so'm), Dec satr yoki null. */
  total: string | null
  items: ReceiptLine[]
  fiscalSign: string | null
  terminalId: string | null
  receiptNo: string | null
  /**
   * Audit 3 (E6): server javobidagi `verified` — sahifadagi fiskal belgi QR bilan mos (keshdan — true).
   * false — chek o'qildi, lekin tasdiqlanmadi: rasmdan ozod emas, "tasdiqlangan" deb ko'rsatilmaydi.
   */
  verified: boolean
}

function str(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

export function normalizeReceipt(raw: unknown, verified = false): ReceiptLookup {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const items = (Array.isArray(r.items) ? r.items : [])
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({ name: str(x.name) ?? '', qty: str(x.qty) ?? '0', price: str(x.price) ?? '0', sum: str(x.sum) ?? '0', unit: str(x.unit) ?? str(x.unitName) ?? null }))
    .filter((x) => x.name !== '')
  return {
    sellerName: str(r.sellerName),
    sellerTin: str(r.sellerTin),
    datetime: str(r.datetime),
    total: str(r.total),
    items,
    fiscalSign: str(r.fiscalSign),
    terminalId: str(r.terminalId),
    receiptNo: str(r.receiptNo),
    verified,
  }
}

/**
 * Chek QR havolasi bo'yicha soliq sahifasini o'qish (Edge Function `receipt-lookup`, JWT bilan).
 * 200 → `{ receipt, cached }`. Xatolar: 400 `receipt_url_not_allowed` / `invalid_request` →
 * `receipt_url_invalid`; 401 → `session_expired`; 403 → `forbidden`; 422 `receipt_unparseable`,
 * 502 `receipt_fetch_failed`, 500 → `receipt_unreadable` (amalda odatiy holat: soliq.uz imzolangan
 * so'rov talab qiladi — UI QR maydonlari bilan qo'lda davom etadi); tarmoq — `network`.
 */
export async function receiptLookup(url: string): Promise<ReceiptLookup> {
  const res = await invokeFunction<unknown>('receipt-lookup', { url })
  if (res.ok) {
    const body = (res.data ?? {}) as { receipt?: unknown; verified?: unknown }
    return normalizeReceipt(body.receipt ?? res.data, body.verified === true)
  }
  if (res.network) throw new RepoError('network')
  if (res.status === 400) throw new RepoError('receipt_url_invalid', res.body?.error)
  if (res.status === 401) throw new RepoError('session_expired', res.body?.error)
  if (res.status === 403) throw new RepoError('forbidden', res.body?.error)
  // 10 daqiqada 20 tadan ko'p so'rov — qo'lda davom etish mumkin
  if (res.status === 429 || res.body?.error === 'rate_limited') throw new RepoError('rate_limited', res.body?.error)
  throw new RepoError('receipt_unreadable', res.body?.error)
}
