// tg-bot — Telegram webhook (docs/auth-design.md, "Telefon orqali bog'lash", 3-qadam).
// Sof mantiq: tashqi bog'liqliklar `deps` orqali. Webhook har doim tez 200 qaytaradi
// (sir noto'g'ri bo'lsa — 401, server sozlanmagan bo'lsa — 500), xatolar loglanadi.

import { checkWebhookSecret } from '../_shared/telegramAuth.ts'
import { normalizePhone } from '../_shared/phone.ts'
import { BOT_BUTTONS, BOT_MESSAGES } from '../_shared/botMessages.ts'
import { errMessage, isRecord, respond, type HandlerResult, type LogFn } from '../_shared/handler.ts'
import type { LogAuthEventFn } from '../_shared/authUsers.ts'

export const DEFAULT_MINI_APP_URL = 'https://terron-build.terron-build.workers.dev/tg'

/** Telegram `reply_markup` (InlineKeyboardMarkup yoki ReplyKeyboardMarkup). */
export type ReplyMarkup =
  | { inline_keyboard: { text: string; web_app: { url: string } }[][] }
  | {
      keyboard: ({ text: string; request_contact: true } | { text: string })[][]
      resize_keyboard: true
      one_time_keyboard: true
    }

export interface TgBotDeps {
  env: { webhookSecret: string | undefined; miniAppUrl: string | undefined }
  /**
   * Bog'lanadigan profillar: `phone = e164`, `is_active`, `deleted_at is null`,
   * `telegram_user_id is null`, firma `is_active` va o'chirilmagan.
   */
  findLinkableProfilesByPhone: (e164: string) => Promise<{ id: string; company_id: string }[]>
  /** `telegram_user_id` bilan bog'langan o'chirilmagan profil (holatidan qat'i nazar). */
  findProfileByTelegramId: (telegramUserId: number) => Promise<{ id: string; phone: string } | null>
  /**
   * `telegram_user_id`, `telegram_chat_id` yozadi — faqat hozir `telegram_user_id is null` va profil
   * hali ham shu telefon bilan, faol va o'chirilmagan bo'lsa.
   */
  linkTelegram: (profileId: string, telegramUserId: number, chatId: number, e164: string) => Promise<boolean>
  sendMessage: (chatId: number, text: string, replyMarkup?: ReplyMarkup) => Promise<void>
  logAuthEvent: LogAuthEventFn
  log: LogFn
}

/**
 * Telegram kontakt raqami ko'pincha `+` siz keladi (`998901234567`, `77011234567`) — u har doim
 * xalqaro formatda, shuning uchun `+` qo'shib keyin normallashtiramiz.
 */
export function contactPhone(raw: string): string | null {
  const s = raw.trim()
  if (s === '') return null
  return normalizePhone(s.startsWith('+') ? s : `+${s}`)
}

const OK = respond(200, { ok: true })

function isSafeId(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v !== 0
}

export function miniAppUrl(deps: TgBotDeps): string {
  const u = deps.env.miniAppUrl
  return typeof u === 'string' && u.startsWith('https://') ? u : DEFAULT_MINI_APP_URL
}

export function openAppMarkup(url: string): ReplyMarkup {
  return { inline_keyboard: [[{ text: BOT_BUTTONS.openApp, web_app: { url } }]] }
}

export function shareContactMarkup(): ReplyMarkup {
  return {
    keyboard: [[{ text: BOT_BUTTONS.shareContact, request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  }
}

/**
 * @param secretHeader `X-Telegram-Bot-Api-Secret-Token` sarlavhasi
 * @param update Telegram Update (JSON, yaroqsiz bo'lishi mumkin)
 */
export async function handleTgBot(
  secretHeader: string | null,
  update: unknown,
  deps: TgBotDeps,
): Promise<HandlerResult> {
  const expected = deps.env.webhookSecret
  if (typeof expected !== 'string' || expected === '') {
    deps.log('error', 'tg-bot: TELEGRAM_WEBHOOK_SECRET sozlanmagan')
    return respond(500, { error: 'server_misconfigured' })
  }
  if (!checkWebhookSecret(secretHeader, expected)) {
    deps.log('warn', 'tg-bot: webhook siri noto\'g\'ri')
    return respond(401, { error: 'unauthorized' })
  }

  if (!isRecord(update) || !isRecord(update.message)) return OK // boshqa update turlari — e'tiborsiz
  const message = update.message
  const from = message.from
  const chat = message.chat
  if (!isRecord(from) || !isRecord(chat) || !isSafeId(from.id) || !isSafeId(chat.id)) return OK
  if (chat.type !== 'private' || from.is_bot === true) return OK
  const fromId = from.id
  const chatId = chat.id
  const appUrl = miniAppUrl(deps)

  try {
    if (isRecord(message.contact)) {
      await handleContact(message.contact, fromId, chatId, appUrl, deps)
      return OK
    }

    const text = typeof message.text === 'string' ? message.text.trim() : ''
    if (text === '/start' || text.startsWith('/start ') || text.startsWith('/start@')) {
      await deps.sendMessage(chatId, BOT_MESSAGES.welcome, openAppMarkup(appUrl))
      const linked = await deps.findProfileByTelegramId(fromId)
      if (linked === null) {
        await deps.sendMessage(chatId, BOT_MESSAGES.shareContactPrompt, shareContactMarkup())
      }
      return OK
    }

    if (text !== '') {
      await deps.sendMessage(chatId, BOT_MESSAGES.help, openAppMarkup(appUrl))
    }
    return OK
  } catch (e) {
    deps.log('error', 'tg-bot: ichki xato', { error: errMessage(e), telegram_user_id: fromId })
    try {
      await deps.sendMessage(chatId, BOT_MESSAGES.tryAgain)
    } catch {
      // javob ham ketmadi — log yetarli
    }
    return OK
  }
}

async function handleContact(
  contact: Record<string, unknown>,
  fromId: number,
  chatId: number,
  appUrl: string,
  deps: TgBotDeps,
): Promise<void> {
  // Faqat o'z kontakti: Telegram "Raqamni ulashish" tugmasi user_id ni qo'yadi.
  // Boshqa birovning kontaktini forward/yuborish — user_id yo'q yoki boshqa.
  if (contact.user_id !== fromId) {
    deps.log('warn', 'tg-bot: begona kontakt rad etildi', { telegram_user_id: fromId })
    await deps.sendMessage(chatId, BOT_MESSAGES.notOwnContact, shareContactMarkup())
    return
  }

  const phone = typeof contact.phone_number === 'string' ? contactPhone(contact.phone_number) : null
  if (phone === null) {
    await deps.sendMessage(chatId, BOT_MESSAGES.invalidPhone)
    return
  }

  const existing = await deps.findProfileByTelegramId(fromId)
  if (existing !== null) {
    if (existing.phone === phone) {
      await deps.sendMessage(chatId, BOT_MESSAGES.alreadyLinked, openAppMarkup(appUrl))
    } else {
      deps.log('warn', 'tg-bot: telegram akkaunt boshqa profilga bog\'langan', { telegram_user_id: fromId })
      await deps.sendMessage(chatId, BOT_MESSAGES.alreadyLinkedOther)
    }
    return
  }

  const candidates = await deps.findLinkableProfilesByPhone(phone)
  if (candidates.length === 0) {
    await deps.sendMessage(chatId, BOT_MESSAGES.notFound)
    return
  }
  if (candidates.length > 1) {
    deps.log('warn', 'tg-bot: raqam bir nechta firmada', { telegram_user_id: fromId, count: candidates.length })
    await deps.sendMessage(chatId, BOT_MESSAGES.multipleCompanies)
    return
  }

  const target = candidates[0] as { id: string; company_id: string }
  const ok = await deps.linkTelegram(target.id, fromId, chatId, phone)
  if (!ok) {
    deps.log('warn', 'tg-bot: bog\'lash poygasi — profil allaqachon bog\'langan', { profile_id: target.id })
    await deps.sendMessage(chatId, BOT_MESSAGES.tryAgain)
    return
  }
  deps.log('info', 'tg-bot: telegram bog\'landi', { profile_id: target.id, company_id: target.company_id })
  try {
    await deps.logAuthEvent({
      company_id: target.company_id,
      actor_profile_id: target.id,
      target_profile_id: target.id,
      action: 'TG_LINK',
      details: { telegram_user_id: fromId },
    })
  } catch (e) {
    deps.log('error', 'tg-bot: audit yozilmadi', { error: errMessage(e), profile_id: target.id })
  }
  await deps.sendMessage(chatId, BOT_MESSAGES.linked, openAppMarkup(appUrl))
}
