// Sirpanuvchi oyna bo'yicha chegara (Edge Function izolyati xotirasida) — receipt-lookup, photo-hash.
// Sof modul: Deno va Node'da bir xil.

/**
 * Sirpanuvchi oyna bo'yicha chegara (izolyat xotirasida). CHEKLOV: har Edge Function izolyati
 * o'z hisobiga ega — bir nechta izolyat bo'lsa umumiy chegara biroz yuqori bo'lishi mumkin.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>()
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Ruxsat bo'lsa hisoblaydi va `{ ok: true }`; aks holda keyingi ruxsatgacha soniyalar. */
  hit(key: string, nowMs: number): { ok: true } | { ok: false; retryAfterSec: number } {
    const from = nowMs - this.windowMs
    const list = (this.hits.get(key) ?? []).filter((t) => t > from)
    if (list.length >= this.max) {
      this.hits.set(key, list)
      const oldest = list[0] as number
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000)) }
    }
    list.push(nowMs)
    this.hits.delete(key) // LRU tartibi: oxirgi ishlatilgan — oxirida
    this.hits.set(key, list)
    if (this.hits.size > this.maxKeys) {
      for (const k of this.hits.keys()) {
        if (this.hits.size <= this.maxKeys) break
        this.hits.delete(k)
      }
    }
    return { ok: true }
  }
}
