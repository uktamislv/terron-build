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
const MAX_BODY_BYTES = 64 * 1024

/** JSON body'ni o'qiydi. Bo'sh / juda katta / noto'g'ri JSON → `null` (logic.ts 400 qaytaradi). */
export async function readJson(req: Request): Promise<unknown> {
  try {
    const text = await req.text()
    if (text.length === 0 || text.length > MAX_BODY_BYTES) return null
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Server tomonidagi log — sirlar (token, parol, initData) hech qachon uzatilmaydi. */
export function log(level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>): void {
  const line = JSON.stringify({ level, message, ...(extra ?? {}) })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}
