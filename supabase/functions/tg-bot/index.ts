// tg-bot — Telegram webhook, Deno Edge Function. Mantiq: ./logic.ts (testlar: ./logic.test.ts).
// verify_jwt = false (supabase/config.toml): Telegram JWT yubormaydi; ishonch
// X-Telegram-Bot-Api-Secret-Token sarlavhasiga (TELEGRAM_WEBHOOK_SECRET) tayanadi.

import { handleTgBot, type MarkSeenResult, type TgBotDeps } from './logic.ts'
import { json, log, readJson } from '../_shared/http.ts'
import {
  getAdminClient,
  linkableProfilesByPhone,
  linkTelegram,
  logAuthEvent,
  profileByTelegramId,
  telegramCall,
  telegramSendMessage,
} from '../_shared/supabaseAdmin.ts'

const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''

/** Bot API chaqiruvi; 200 + ok bo'lmasa — xato (token xabarga tushmaydi). */
async function botCall(method: string, payload: Record<string, unknown>): Promise<void> {
  const r = await telegramCall(botToken, method, payload)
  if (r.status === null) throw new Error(r.error)
  const body = r.body as { ok?: boolean; description?: string } | null
  if (r.status !== 200 || body?.ok !== true) {
    const description = typeof body?.description === 'string' ? body.description.slice(0, 200) : ''
    // "message is not modified" — ikkinchi bosish / bir xil holat, xato emas
    if (/message is not modified/i.test(description)) return
    throw new Error(`telegram ${method} ${r.status} ${description}`)
  }
}

/** Batch 12: `svc_mark_alert_seen` — hint bo'yicha natija (docs/automation-design.md). */
async function markAlertSeen(telegramUserId: number, alertId: string): Promise<MarkSeenResult> {
  const { data, error } = await getAdminClient().rpc('svc_mark_alert_seen', {
    p_telegram_user_id: telegramUserId,
    p_alert_id: alertId,
  })
  if (error) {
    const hint = error.hint ?? ''
    if (hint === 'alert_action_forbidden' || error.code === '42501') return { ok: false, reason: 'forbidden' }
    if (hint === 'alert_not_found' || error.code === 'P0002') return { ok: false, reason: 'not_found' }
    throw new Error(`svc_mark_alert_seen: ${error.message}`)
  }
  return { ok: true, name: typeof data === 'string' ? data : '' }
}

const deps: TgBotDeps = {
  env: {
    webhookSecret: Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? undefined,
    miniAppUrl: Deno.env.get('MINI_APP_URL') ?? undefined,
  },
  findLinkableProfilesByPhone: linkableProfilesByPhone,
  findProfileByTelegramId: async (telegramUserId: number) => {
    const p = await profileByTelegramId(telegramUserId)
    return p === null ? null : { id: p.id, phone: p.phone }
  },
  linkTelegram,
  sendMessage: (chatId, text, replyMarkup) => telegramSendMessage(botToken, chatId, text, replyMarkup),
  markAlertSeen,
  markChatBlocked: async (chatId, blocked) => {
    const { error } = await getAdminClient().rpc('svc_mark_chat_blocked', { p_chat_id: chatId, p_blocked: blocked })
    if (!error) return
    // RPC hali qo'shilmagan (PGRST202) — faqat log, webhook ishlashda davom etadi.
    if (error.code === 'PGRST202') {
      log('warn', "tg-bot: svc_mark_chat_blocked hali yo'q — bloklash holati yozilmadi", { blocked })
      return
    }
    throw new Error(`svc_mark_chat_blocked: ${error.message}`)
  },
  touchChat: async (chatId) => {
    const { error } = await getAdminClient().rpc('svc_touch_chat', { p_chat_id: chatId })
    if (!error) return
    if (error.code === 'PGRST202') {
      log('warn', "tg-bot: svc_touch_chat hali yo'q — faollik yozilmadi")
      return
    }
    throw new Error(`svc_touch_chat: ${error.message}`)
  },
  answerCallbackQuery: (callbackQueryId, text, showAlert) =>
    botCall('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text !== '' ? { text } : {}),
      ...(showAlert ? { show_alert: true } : {}),
    }),
  editMessage: (chatId, messageId, edit, replyMarkup) =>
    edit === null
      ? botCall('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup })
      : botCall('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: edit.text,
          entities: edit.entities,
          link_preview_options: { is_disabled: true },
          reply_markup: replyMarkup,
        }),
  logAuthEvent,
  log,
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (botToken === '') {
    log('error', 'tg-bot: TELEGRAM_BOT_TOKEN sozlanmagan')
    return json(500, { error: 'server_misconfigured' })
  }
  try {
    const update = await readJson(req)
    const result = await handleTgBot(req.headers.get('X-Telegram-Bot-Api-Secret-Token'), update, deps)
    return json(result.status, result.body)
  } catch (e) {
    // Telegram qayta yubormasligi uchun baribir 200.
    log('error', 'tg-bot: kutilmagan xato', { error: e instanceof Error ? e.message : String(e) })
    return json(200, { ok: true })
  }
})
