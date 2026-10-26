// tg-bot — Telegram webhook (docs/auth-design.md, "Telefon orqali bog'lash", 3-qadam).
// Sof mantiq: tashqi bog'liqliklar `deps` orqali. Webhook har doim tez 200 qaytaradi
// (sir noto'g'ri bo'lsa — 401, server sozlanmagan bo'lsa — 500), xatolar loglanadi.

import { checkWebhookSecret } from '../_shared/telegramAuth.ts'
import { normalizePhone } from '../_shared/phone.ts'
import { BOT_BUTTONS, BOT_MESSAGES } from '../_shared/botMessages.ts'
import { errMessage, isRecord, isUuid, respond, type HandlerResult, type LogFn } from '../_shared/handler.ts'
import { SEEN_CALLBACK_PREFIX } from '../_shared/notifyMessages.ts'
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

export type MarkSeenResult = { ok: true; name: string } | { ok: false; reason: 'forbidden' | 'not_found' }

/** Tahrirlangan xabar tugmalari (Telegram'dan kelgan reply_markup ning xavfsiz nusxasi). */
export type InlineMarkup = {
  inline_keyboard: (
    | { text: string; web_app: { url: string } }
    | { text: string; url: string }
    | { text: string; callback_data: string }
  )[][]
}

/** Telegram xabar matni chegarasi. */
const TG_MAX_TEXT = 4096

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
  /**
   * Batch 12: `svc_mark_alert_seen(p_telegram_user_id, p_alert_id)` (service_role).
   * hint `alert_action_forbidden` → forbidden, `alert_not_found` → not_found; boshqa xato — throw.
   */
  markAlertSeen: (telegramUserId: number, alertId: string) => Promise<MarkSeenResult>
  /** Bot API answerCallbackQuery (xato — throw). */
  answerCallbackQuery: (callbackQueryId: string, text: string, showAlert: boolean) => Promise<void>
  /**
   * Bot API editMessageText (`edit` bor bo'lsa, `entities` bilan — parse_mode yo'q) yoki
   * editMessageReplyMarkup (`edit` = null). Xato — throw.
   */
  editMessage: (
    chatId: number,
    messageId: number,
    edit: { text: string; entities: unknown[] } | null,
    replyMarkup: InlineMarkup,
  ) => Promise<void>
  /**
   * Foydalanuvchi botni blokladi (`true`) yoki blokdan chiqardi (`false`):
   * RPC `svc_mark_chat_blocked(p_chat_id bigint, p_blocked boolean)`. RPC hali yo'q bo'lsa —
   * index.ts faqat loglaydi (xato tashlamaydi).
   */
  markChatBlocked: (chatId: number, blocked: boolean) => Promise<void>
  /**
   * Kiruvchi faollik (xabar, tugma, /start, blokdan chiqarish): `svc_touch_chat(p_chat_id)` — shu chat
   * profillarining `telegram_blocked_at` i tozalanadi. RPC yo'q bo'lsa — index.ts faqat loglaydi.
   */
  touchChat: (chatId: number) => Promise<void>
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

  if (isRecord(update) && isRecord(update.my_chat_member)) {
    await handleMyChatMember(update.my_chat_member, deps)
    return OK
  }
  if (isRecord(update) && isRecord(update.callback_query)) {
    await handleCallbackQuery(update.callback_query, deps)
    return OK
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
  // Har kiruvchi shaxsiy xabar (jumladan /start, kontakt) — foydalanuvchi botni bloklamagan
  await touchChat(deps, chatId)

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

// ---------------------------------------------------------------------------
// Batch 12: "Ko'rildi" tugmasi (callback_query `al:seen:<alert_id>`)
// ---------------------------------------------------------------------------

/** `al:seen:<uuid>` → alert id (kichik harf), aks holda null. */
export function parseSeenCallback(data: unknown): string | null {
  if (typeof data !== 'string' || !data.startsWith(SEEN_CALLBACK_PREFIX)) return null
  const id = data.slice(SEEN_CALLBACK_PREFIX.length)
  return isUuid(id) ? id.toLowerCase() : null
}

/**
 * Xabar tugmalaridan "Ko'rildi" (`al:seen:*`) ni olib tashlaydi, qolganini (Ochish — web_app,
 * url, boshqa callback) saqlaydi. Noma'lum ko'rinishdagi tugmalar tashlanadi; bo'sh qatorlar ham.
 */
export function withoutSeenButton(markup: unknown): InlineMarkup {
  const rows = isRecord(markup) && Array.isArray(markup.inline_keyboard) ? markup.inline_keyboard : []
  const out: InlineMarkup['inline_keyboard'] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const kept: InlineMarkup['inline_keyboard'][number] = []
    for (const b of row) {
      if (!isRecord(b) || typeof b.text !== 'string') continue
      if (isRecord(b.web_app) && typeof b.web_app.url === 'string') {
        kept.push({ text: b.text, web_app: { url: b.web_app.url } })
      } else if (typeof b.url === 'string') {
        kept.push({ text: b.text, url: b.url })
      } else if (typeof b.callback_data === 'string' && !b.callback_data.startsWith(SEEN_CALLBACK_PREFIX)) {
        kept.push({ text: b.text, callback_data: b.callback_data })
      }
    }
    if (kept.length > 0) out.push(kept)
  }
  return { inline_keyboard: out }
}

/**
 * Yangi matn: asl matn + bo'sh qator + "✓ Ko'rildi — <ism>" (entity offsetlari o'zgarmaydi —
 * oxiriga qo'shiladi).
 * Belgi allaqachon bor yoki 4096 dan oshsa — null (faqat tugmalar o'zgaradi).
 */
export function seenText(original: unknown, name: string): string | null {
  if (typeof original !== 'string' || original === '') return null
  if (original.includes(BOT_MESSAGES.seenMarkPrefix)) return null
  const who = name.replace(/\s+/g, ' ').trim().slice(0, 100) || '—'
  const text = `${original}\n\n${BOT_MESSAGES.seenMark(who)}`
  return text.length <= TG_MAX_TEXT ? text : null
}

async function handleCallbackQuery(cq: Record<string, unknown>, deps: TgBotDeps): Promise<void> {
  const id = typeof cq.id === 'string' && cq.id !== '' ? cq.id : null
  const from = cq.from
  if (id === null || !isRecord(from) || !isSafeId(from.id) || from.is_bot === true) return
  const fromId = from.id
  // Tugma bosildi — foydalanuvchi faol (shaxsiy chat id = foydalanuvchi id)
  await touchChat(deps, fromId)

  const answer = async (text: string, showAlert = false): Promise<void> => {
    try {
      await deps.answerCallbackQuery(id, text, showAlert)
    } catch (e) {
      deps.log('warn', 'tg-bot: answerCallbackQuery xatosi', { error: errMessage(e) })
    }
  }

  const alertId = parseSeenCallback(cq.data)
  if (alertId === null) {
    await answer('') // noma'lum tugma — faqat "soat"ni to'xtatamiz
    return
  }

  let result: MarkSeenResult
  try {
    result = await deps.markAlertSeen(fromId, alertId)
  } catch (e) {
    deps.log('error', 'tg-bot: svc_mark_alert_seen xatosi', { error: errMessage(e), alert_id: alertId })
    await answer(BOT_MESSAGES.seenError, true)
    return
  }
  if (!result.ok) {
    deps.log('info', "tg-bot: ko'rildi rad etildi", { reason: result.reason, alert_id: alertId, telegram_user_id: fromId })
    await answer(result.reason === 'forbidden' ? BOT_MESSAGES.seenForbidden : BOT_MESSAGES.seenNotFound, true)
    return
  }
  await answer(BOT_MESSAGES.seenOk)

  // Xabarni tahrirlash: "✓ Ko'rildi — <ism>" va "Ko'rildi" tugmasisiz. Xato — faqat log.
  const msg = cq.message
  if (!isRecord(msg) || !isRecord(msg.chat) || !isSafeId(msg.chat.id) || !isSafeId(msg.message_id)) return
  if (msg.date === 0) return // InaccessibleMessage
  const markup = withoutSeenButton(msg.reply_markup)
  const text = seenText(msg.text, result.name)
  const entities = Array.isArray(msg.entities) ? msg.entities.filter(isRecord) : []
  try {
    await deps.editMessage(msg.chat.id, msg.message_id, text === null ? null : { text, entities }, markup)
  } catch (e) {
    deps.log('warn', 'tg-bot: xabar tahrirlanmadi', { error: errMessage(e), alert_id: alertId })
  }
}

// ---------------------------------------------------------------------------
// Audit: botni bloklash / blokdan chiqarish (my_chat_member, faqat shaxsiy chat)
// ---------------------------------------------------------------------------

/** Bot holati shu statusga o'tsa — foydalanuvchi botni bloklagan / chatni o'chirgan. */
const BLOCKED_STATUSES = ['kicked', 'left']
const ACTIVE_STATUSES = ['member', 'administrator', 'creator', 'restricted']

/**
 * `my_chat_member` → bloklandi (`true`), blokdan chiqdi (`false`) yoki o'zgarish yo'q (`null`).
 * Faqat shaxsiy chat (guruhga qo'shish/chiqarish e'tiborsiz).
 */
export function chatBlockedChange(m: Record<string, unknown>): { chatId: number; blocked: boolean } | null {
  const chat = m.chat
  if (!isRecord(chat) || chat.type !== 'private' || !isSafeId(chat.id)) return null
  const oldStatus = isRecord(m.old_chat_member) ? m.old_chat_member.status : undefined
  const newStatus = isRecord(m.new_chat_member) ? m.new_chat_member.status : undefined
  if (typeof newStatus !== 'string' || newStatus === oldStatus) return null
  if (BLOCKED_STATUSES.includes(newStatus)) return { chatId: chat.id, blocked: true }
  if (ACTIVE_STATUSES.includes(newStatus)) return { chatId: chat.id, blocked: false }
  return null
}

/** `svc_touch_chat` — xato bo'lsa faqat log (webhook ishlashda davom etadi). */
async function touchChat(deps: TgBotDeps, chatId: number): Promise<void> {
  try {
    await deps.touchChat(chatId)
  } catch (e) {
    deps.log('warn', 'tg-bot: svc_touch_chat xatosi', { error: errMessage(e), chat_id: chatId })
  }
}

async function handleMyChatMember(m: Record<string, unknown>, deps: TgBotDeps): Promise<void> {
  const change = chatBlockedChange(m)
  if (change === null) return
  if (!change.blocked) await touchChat(deps, change.chatId)
  try {
    await deps.markChatBlocked(change.chatId, change.blocked)
    deps.log('info', change.blocked ? 'tg-bot: bot bloklandi' : 'tg-bot: bot blokdan chiqarildi', {
      chat_id: change.chatId,
    })
  } catch (e) {
    deps.log('warn', 'tg-bot: svc_mark_chat_blocked xatosi', { error: errMessage(e), chat_id: change.chatId })
  }
}
