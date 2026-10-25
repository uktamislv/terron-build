// tg-bot — Telegram webhook, Deno Edge Function. Mantiq: ./logic.ts (testlar: ./logic.test.ts).
// verify_jwt = false (supabase/config.toml): Telegram JWT yubormaydi; ishonch
// X-Telegram-Bot-Api-Secret-Token sarlavhasiga (TELEGRAM_WEBHOOK_SECRET) tayanadi.

import { handleTgBot, type TgBotDeps } from './logic.ts'
import { json, log, readJson } from '../_shared/http.ts'
import {
  linkableProfilesByPhone,
  linkTelegram,
  logAuthEvent,
  profileByTelegramId,
  telegramSendMessage,
} from '../_shared/supabaseAdmin.ts'

const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''

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
