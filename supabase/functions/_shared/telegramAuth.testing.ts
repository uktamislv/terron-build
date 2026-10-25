// FAQAT TESTLAR UCHUN. Ishlab chiqarish kodi (Edge Function, frontend) buni import qilmaydi.
// Berilgan maydonlarni Telegram algoritmi bo'yicha imzolab, `initData` query satrini qaytaradi.

import { buildDataCheckString, computeInitDataHash } from './telegramAuth.ts'

/**
 * `fields` (URL-decode qilingan qiymatlar) → `key=value&...&hash=<hex>`.
 * `hash` va `signature` hisobga olinmaydi (`signature` bo'lsa, satrga o'zgarmay qo'shiladi).
 */
export async function signInitDataForTest(fields: Record<string, string>, botToken: string): Promise<string> {
  const rest: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) if (k !== 'hash') rest[k] = v
  const hash = await computeInitDataHash(buildDataCheckString(rest, ['hash', 'signature']), botToken)
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(rest)) params.append(k, v)
  params.append('hash', hash)
  return params.toString()
}
