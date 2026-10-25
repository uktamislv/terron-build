// tg-dispatch — bildirishnomalar navbatini Telegram'ga yuboradi. Deno Edge Function.
// Mantiq: ./logic.ts (testlar: ./logic.test.ts). Shartnoma: docs/bot-design.md.
// verify_jwt = false (supabase/config.toml): chaqiruvchi — baza (pg_net), ishonch
// `x-dispatch-secret` sarlavhasida (Vault: tg_dispatch_secret, svc_dispatch_secret orqali).

import { handleDispatch, classifyTelegramResponse, type DispatchDeps, type OutboxRow, type Recipient } from './logic.ts'
import { json, log } from '../_shared/http.ts'
import { getAdminClient, telegramCall } from '../_shared/supabaseAdmin.ts'

const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''

/**
 * Sir keshi: odatda 5 daqiqa. Sarlavha mos kelmasa (sir almashtirilgan bo'lishi mumkin)
 * logic.ts `refresh = true` so'raydi — bazaga ko'pi bilan 30 s da bir marta boriladi
 * (noto'g'ri sirli so'rovlar bazani yuklamasin).
 */
const SECRET_TTL_MS = 5 * 60_000
const SECRET_REFRESH_MIN_MS = 30_000
let cachedSecret: { value: string | null; at: number } | null = null

async function getDispatchSecret(refresh: boolean): Promise<string | null> {
  const age = cachedSecret === null ? Infinity : Date.now() - cachedSecret.at
  const stale = age >= SECRET_TTL_MS || (refresh && age >= SECRET_REFRESH_MIN_MS)
  if (cachedSecret !== null && !stale) return cachedSecret.value
  const { data, error } = await getAdminClient().rpc('svc_dispatch_secret')
  if (error) throw new Error(`svc_dispatch_secret: ${error.message}`)
  const value = typeof data === 'string' && data !== '' ? data : null
  cachedSecret = { value, at: Date.now() }
  return value
}

const deps: DispatchDeps = {
  env: { miniAppUrl: Deno.env.get('MINI_APP_URL') ?? undefined },
  getDispatchSecret,
  claim: async (limit) => {
    const { data, error } = await getAdminClient().rpc('svc_claim_notifications', { p_limit: limit })
    if (error) throw new Error(`svc_claim_notifications: ${error.message}`)
    return (data ?? []) as OutboxRow[]
  },
  recipients: async (companyId) => {
    const { data, error } = await getAdminClient().rpc('svc_notification_recipients', { p_company_id: companyId })
    if (error) throw new Error(`svc_notification_recipients: ${error.message}`)
    return ((data ?? []) as { profile_id: string; chat_id: number | string; role: string }[]).map(
      (r): Recipient => ({ profile_id: r.profile_id, chat_id: Number(r.chat_id), role: r.role }),
    )
  },
  sendMessage: async (chatId, text, replyMarkup) => {
    const r = await telegramCall(botToken, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: replyMarkup,
    })
    if (r.status === null) return { ok: false, kind: 'error', error: r.error }
    return classifyTelegramResponse(r.status, r.body)
  },
  complete: async (id, args) => {
    const { error } = await getAdminClient().rpc('svc_complete_notification', {
      p_id: id,
      p_ok: args.ok,
      p_delivered: args.delivered,
      p_error: args.error,
      p_retry_after_sec: args.retryAfterSec ?? null,
      p_final: args.final ?? false,
    })
    if (error) throw new Error(`svc_complete_notification: ${error.message}`)
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log,
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (botToken === '') {
    log('error', 'tg-dispatch: TELEGRAM_BOT_TOKEN sozlanmagan')
    return json(500, { error: 'server_misconfigured' })
  }
  try {
    // Body ishlatilmaydi (pg_net '{}' yuboradi) — o'qilmaydi.
    const result = await handleDispatch(req.headers.get('x-dispatch-secret'), deps)
    return json(result.status, result.body)
  } catch (e) {
    log('error', 'tg-dispatch: kutilmagan xato', { error: e instanceof Error ? e.name : 'unknown' })
    return json(500, { error: 'server_error' })
  }
})
