// Eksport uchun "hamma qatorlar": 1000 tadan bo'lib yuklash, jami 50 000 dan oshsa — xato.
import { RepoError } from './errors'

export const EXPORT_CHUNK = 1000
export const EXPORT_MAX_ROWS = 50_000

export interface ChunkRequest {
  /** PostgREST `range` (ikkalasi ham kiradi). */
  from: number
  to: number
  /** Birinchi bo'lak — faqat unda `count: 'exact'` so'raladi. */
  first: boolean
  /**
   * Eksport boshlangan vaqt (ISO). `created_at` ustuni bor jadvallarda `created_at <= before` —
   * eksport paytida qo'shilgan yozuvlar bo'laklarni siljitmasin.
   */
  before: string
  signal?: AbortSignal
}

/** Bitta bo'lak. `total` — birinchi bo'lakda `count` (keyingilarida null). */
export type ChunkLoader<T> = (req: ChunkRequest) => Promise<{ rows: T[]; total: number | null }>

export interface FetchAllOptions<T> {
  signal?: AbortSignal
  max?: number
  /** Dublikatni aniqlash kaliti; berilmasa — `id` maydoni (bo'lmasa — tozalanmaydi). */
  keyOf?: (row: T) => string | null
  /** Test uchun: hozirgi vaqt. */
  now?: () => Date
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

function defaultKey(row: unknown): string | null {
  const id = (row as { id?: unknown } | null)?.id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}

/**
 * Barcha qatorlarni bo'laklab yuklaydi. Birinchi bo'lakdagi `total` chegaradan oshsa —
 * `export_too_large` (keyingi bo'laklar so'ralmaydi). Takror qatorlar (`id` bo'yicha) tashlanadi.
 * Bekor qilinsa — `AbortError`.
 */
export async function fetchAll<T>(load: ChunkLoader<T>, opts: FetchAllOptions<T> = {}): Promise<T[]> {
  const { signal, max = EXPORT_MAX_ROWS, keyOf = defaultKey, now = () => new Date() } = opts
  const before = now().toISOString()
  const out: T[] = []
  const seen = new Set<string>()
  for (let start = 0; ; start += EXPORT_CHUNK) {
    throwIfAborted(signal)
    let chunk: { rows: T[]; total: number | null }
    try {
      chunk = await load({ from: start, to: start + EXPORT_CHUNK - 1, first: start === 0, before, signal })
    } catch (err) {
      // Bekor qilingan so'rov xatosi (fetch abort) — tarmoq xatosi emas
      throwIfAborted(signal)
      throw err
    }
    throwIfAborted(signal)
    const { rows, total } = chunk
    if (start === 0 && total !== null && total > max) throw new RepoError('export_too_large')
    for (const r of rows) {
      const key = keyOf(r)
      if (key !== null) {
        if (seen.has(key)) continue
        seen.add(key)
      }
      out.push(r)
    }
    if (out.length > max) throw new RepoError('export_too_large')
    if (rows.length < EXPORT_CHUNK) return out
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError')
  )
}

export const IN_CHUNK = 100

/**
 * `.in(ids)` so'rovlari uchun: id'lar (takrorsiz) `size` talik bo'laklarga bo'linadi va ketma-ket
 * so'raladi — URL juda uzun bo'lmasin. Natijalar birlashtiriladi.
 */
export async function inChunks<T>(
  ids: readonly string[],
  fn: (chunk: string[]) => Promise<T[]>,
  size = IN_CHUNK,
): Promise<T[]> {
  const unique = [...new Set(ids)]
  const out: T[] = []
  for (let i = 0; i < unique.length; i += size) {
    out.push(...(await fn(unique.slice(i, i + size))))
  }
  return out
}

/** Repo yuklovchilari uchun: sahifalangan ro'yxat — `{ count: true }`, eksport bo'lagi — `chunkOpts(req)`. */
export interface ChunkOpts {
  count?: boolean
  before?: string
  signal?: AbortSignal
}

export function chunkOpts(req: ChunkRequest): ChunkOpts {
  return { count: req.first, before: req.before, signal: req.signal }
}
