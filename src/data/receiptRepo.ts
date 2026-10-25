import { RepoError } from './errors'
import { invokeFunction } from './functions'

/** Soliq cheki sahifasidan o'qilgan qator. Raqamlar — satr (Dec). */
export interface ReceiptLine {
  name: string
  qty: string
  price: string
  sum: string
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
}

function str(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

export function normalizeReceipt(raw: unknown): ReceiptLookup {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const items = (Array.isArray(r.items) ? r.items : [])
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({ name: str(x.name) ?? '', qty: str(x.qty) ?? '0', price: str(x.price) ?? '0', sum: str(x.sum) ?? '0' }))
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
    const body = (res.data ?? {}) as { receipt?: unknown }
    return normalizeReceipt(body.receipt ?? res.data)
  }
  if (res.network) throw new RepoError('network')
  if (res.status === 400) throw new RepoError('receipt_url_invalid', res.body?.error)
  if (res.status === 401) throw new RepoError('session_expired', res.body?.error)
  if (res.status === 403) throw new RepoError('forbidden', res.body?.error)
  throw new RepoError('receipt_unreadable', res.body?.error)
}
