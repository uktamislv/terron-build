// Xatolik xabari uchun diagnostika: ilova versiyasi va qurilma (platforma, Telegram versiyasi, qisqa UA).
// Faqat ma'lumot uchun — hech qanday ruxsat shu qiymatlarga tayanmaydi.

/** Build versiyasi: `VITE_APP_VERSION` (CI'da berilishi mumkin), aks holda '1'. */
export const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION ?? '').trim().slice(0, 50) || '1'

const UA_MAX = 300
const CLIENT_MAX = 500

/** User agent'ni qisqartiradi: "Mozilla/5.0" va "(KHTML, like Gecko)" kabi shovqinsiz, ≤ 300 belgi. */
export function shortUserAgent(ua: string | null | undefined): string {
  return (ua ?? '')
    .replace(/^Mozilla\/5\.0\s*/i, '')
    .replace(/\(KHTML, like Gecko\)\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, UA_MAX)
}

/**
 * `client` ustuni: "telegram android 8.0 · <UA>" yoki "web · <UA>".
 * `telegram` — Mini App ichida bo'lsa platforma va SDK versiyasi.
 */
export function describeClient(input: {
  telegram?: { platform?: string | null; version?: string | null } | null
  userAgent?: string | null
}): string {
  const tg = input.telegram
  const head = tg ? ['telegram', tg.platform?.trim() || '?', tg.version?.trim() || '?'].join(' ') : 'web'
  const ua = shortUserAgent(input.userAgent)
  return (ua ? `${head} · ${ua}` : head).slice(0, CLIENT_MAX)
}
