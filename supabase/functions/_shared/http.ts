// Deno Edge Function'lar uchun umumiy HTTP yordamchilar (CORS, JSON javob, body o'qish).
// Deno'ga xos emas, lekin faqat index.ts lardan ishlatiladi; typecheck'dan tashqarida.

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-client-device',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

export function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  })
}

/** CORS preflight. OPTIONS bo'lsa javob, aks holda null. */
export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  return null
}

/** Body hajmi chegarasi — initData ~ bir necha KB, webhook update ham kichik. */
export const MAX_BODY_BYTES = 64 * 1024

/**
 * JSON body'ni o'qiydi. Bo'sh / juda katta / noto'g'ri JSON → `null` (logic.ts 400 qaytaradi).
 * Audit 3 (E4): avval Content-Length, keyin oqim `maxBytes` baytgacha o'qiladi — katta body
 * to'liq xotiraga olinmaydi (Content-Length yo'q yoki yolg'on bo'lsa ham).
 */
export async function readJson(req: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  try {
    const declared = req.headers.get('content-length')
    if (declared !== null && declared.trim() !== '') {
      const n = Number(declared)
      if (!Number.isFinite(n) || n < 0 || n > maxBytes) {
        await req.body?.cancel().catch(() => undefined)
        return null
      }
    }
    const text = await readBodyCapped(req.body, maxBytes)
    if (text === null || text.length === 0) return null
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Oqimni `maxBytes` baytgacha o'qiydi; oshsa — null (o'qish to'xtatiladi). UTF-8 matn. */
export async function readBodyCapped(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | null> {
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

/** Server tomonidagi log — sirlar (token, parol, initData) hech qachon uzatilmaydi. */
export function log(level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>): void {
  const line = JSON.stringify({ level, message, ...(extra ?? {}) })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}
