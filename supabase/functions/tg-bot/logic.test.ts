// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  contactPhone,
  DEFAULT_MINI_APP_URL,
  handleTgBot,
  chatBlockedChange,
  parseSeenCallback,
  seenText,
  withoutSeenButton,
  type InlineMarkup,
  type MarkSeenResult,
  type ReplyMarkup,
  type TgBotDeps,
} from './logic.ts'
import type { AuthEvent } from '../_shared/authUsers.ts'
import { BOT_MESSAGES } from '../_shared/botMessages.ts'

const SECRET = 'webhook-secret-for-tests-0123456789'
const FROM = 424242
const CHAT = 424242

interface Sent {
  chatId: number
  text: string
  markup?: ReplyMarkup
}

function fake(opts: {
  linkable?: { id: string; company_id: string }[]
  byTg?: { id: string; phone: string } | null
  linkResult?: boolean
  secret?: string | undefined
  miniAppUrl?: string
  throwOnFind?: boolean
  auditThrows?: boolean
  seen?: MarkSeenResult | 'throw'
  editThrows?: boolean
  answerThrows?: boolean
  blockThrows?: boolean
} = {}) {
  const blockCalls: { chatId: number; blocked: boolean }[] = []
  const seenCalls: { tg: number; alertId: string }[] = []
  const answers: { id: string; text: string; showAlert: boolean }[] = []
  const edits: {
    chatId: number
    messageId: number
    edit: { text: string; entities: unknown[] } | null
    markup: InlineMarkup
  }[] = []
  const sent: Sent[] = []
  const links: { profileId: string; tg: number; chat: number; phone: string }[] = []
  const audit: AuthEvent[] = []
  const phonesQueried: string[] = []
  const logs: { level: string; message: string }[] = []
  const deps: TgBotDeps = {
    env: { webhookSecret: 'secret' in opts ? opts.secret : SECRET, miniAppUrl: opts.miniAppUrl },
    findLinkableProfilesByPhone: async (phone) => {
      if (opts.throwOnFind) throw new Error('db down')
      phonesQueried.push(phone)
      return opts.linkable ?? []
    },
    findProfileByTelegramId: async () => opts.byTg ?? null,
    linkTelegram: async (profileId, tg, chat, phone) => {
      links.push({ profileId, tg, chat, phone })
      return opts.linkResult ?? true
    },
    sendMessage: async (chatId, text, markup) => {
      sent.push({ chatId, text, ...(markup ? { markup } : {}) })
    },
    markAlertSeen: async (tg, alertId) => {
      seenCalls.push({ tg, alertId })
      if (opts.seen === 'throw') throw new Error('db down')
      return opts.seen ?? { ok: true, name: 'Ali Valiyev' }
    },
    markChatBlocked: async (chatId, blocked) => {
      blockCalls.push({ chatId, blocked })
      if (opts.blockThrows) throw new Error('rpc down')
    },
    answerCallbackQuery: async (id, text, showAlert) => {
      answers.push({ id, text, showAlert })
      if (opts.answerThrows) throw new Error('tg down')
    },
    editMessage: async (chatId, messageId, edit, markup) => {
      edits.push({ chatId, messageId, edit, markup })
      if (opts.editThrows) throw new Error('tg down')
    },
    logAuthEvent: async (e) => {
      if (opts.auditThrows) throw new Error('audit down')
      audit.push(e)
    },
    log: (level, message) => logs.push({ level, message }),
  }
  return { deps, sent, links, phonesQueried, logs, audit, seenCalls, answers, edits, blockCalls }
}

function msg(message: Record<string, unknown>) {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 1,
      from: { id: FROM, is_bot: false, first_name: 'Ali' },
      chat: { id: CHAT, type: 'private' },
      ...message,
    },
  }
}

const contact = (phone: string, userId: number | null = FROM) =>
  msg({ contact: { phone_number: phone, first_name: 'Ali', ...(userId !== null ? { user_id: userId } : {}) } })

function webAppUrlOf(markup: ReplyMarkup | undefined): string | undefined {
  if (markup && 'inline_keyboard' in markup) return markup.inline_keyboard[0]?.[0]?.web_app.url
  return undefined
}

describe('tg-bot: webhook siri', () => {
  it('sir noto\'g\'ri → 401, hech narsa qilinmaydi', async () => {
    const f = fake({ linkable: [{ id: 'p1', company_id: 'c1' }] })
    const r = await handleTgBot('wrong', contact('+998901234567'), f.deps)
    expect(r.status).toBe(401)
    expect(f.links).toHaveLength(0)
    expect(f.sent).toHaveLength(0)
  })

  it('sarlavha yo\'q → 401', async () => {
    const r = await handleTgBot(null, msg({ text: '/start' }), fake().deps)
    expect(r.status).toBe(401)
  })

  it('sir sozlanmagan → 500 (har qanday sarlavha bilan)', async () => {
    const f = fake({ secret: undefined })
    const r = await handleTgBot('', msg({ text: '/start' }), f.deps)
    expect(r.status).toBe(500)
    expect(f.logs.some((l) => l.level === 'error')).toBe(true)
  })
})

describe('tg-bot: update shakli', () => {
  it.each([null, 'x', [], {}, { update_id: 1 }, { message: { text: 'hi' } }, { callback_query: {} }])(
    'tanilmagan update → 200, javob yuborilmaydi (%#)',
    async (u) => {
      const f = fake()
      const r = await handleTgBot(SECRET, u, f.deps)
      expect(r.status).toBe(200)
      expect(f.sent).toHaveLength(0)
    },
  )

  it('guruh chati e\'tiborsiz', async () => {
    const f = fake()
    const r = await handleTgBot(SECRET, msg({ chat: { id: -100, type: 'group' }, text: '/start' }), f.deps)
    expect(r.status).toBe(200)
    expect(f.sent).toHaveLength(0)
  })
})

describe('tg-bot: /start', () => {
  it('bog\'lanmagan foydalanuvchi → salom + Mini App tugmasi, keyin request_contact klaviaturasi', async () => {
    const f = fake()
    const r = await handleTgBot(SECRET, msg({ text: '/start' }), f.deps)
    expect(r.status).toBe(200)
    expect(f.sent).toHaveLength(2)
    expect(f.sent[0]?.text).toBe(BOT_MESSAGES.welcome)
    expect(webAppUrlOf(f.sent[0]?.markup)).toBe(DEFAULT_MINI_APP_URL)
    const kb = f.sent[1]?.markup
    expect(kb && 'keyboard' in kb ? kb.keyboard[0]?.[0] : undefined).toMatchObject({ request_contact: true })
  })

  it('bog\'langan foydalanuvchiga kontakt so\'ralmaydi; MINI_APP_URL env ishlatiladi', async () => {
    const f = fake({ byTg: { id: 'p1', phone: '+998901234567' }, miniAppUrl: 'https://example.test/tg' })
    await handleTgBot(SECRET, msg({ text: '/start' }), f.deps)
    expect(f.sent).toHaveLength(1)
    expect(webAppUrlOf(f.sent[0]?.markup)).toBe('https://example.test/tg')
  })

  it('https bo\'lmagan MINI_APP_URL → standart URL', async () => {
    const f = fake({ miniAppUrl: 'http://insecure/tg' })
    await handleTgBot(SECRET, msg({ text: '/start' }), f.deps)
    expect(webAppUrlOf(f.sent[0]?.markup)).toBe(DEFAULT_MINI_APP_URL)
  })

  it('boshqa matn → yordam xabari', async () => {
    const f = fake()
    await handleTgBot(SECRET, msg({ text: 'salom' }), f.deps)
    expect(f.sent.map((s) => s.text)).toEqual([BOT_MESSAGES.help])
  })
})

describe('tg-bot: kontakt orqali bog\'lash', () => {
  it('aniq 1 profil → bog\'lanadi (telegram_user_id, chat_id) va Mini App tugmasi', async () => {
    const f = fake({ linkable: [{ id: 'p1', company_id: 'c1' }] })
    const r = await handleTgBot(SECRET, contact('998901234567'), f.deps)
    expect(r.status).toBe(200)
    expect(f.phonesQueried).toEqual(['+998901234567']) // normalizePhone
    expect(f.links).toEqual([{ profileId: 'p1', tg: FROM, chat: CHAT, phone: '+998901234567' }])
    expect(f.audit).toEqual([
      {
        company_id: 'c1',
        actor_profile_id: 'p1',
        target_profile_id: 'p1',
        action: 'TG_LINK',
        details: { telegram_user_id: FROM },
      },
    ])
    expect(f.sent).toHaveLength(1)
    expect(f.sent[0]?.text).toBe(BOT_MESSAGES.linked)
    expect(webAppUrlOf(f.sent[0]?.markup)).toBe(DEFAULT_MINI_APP_URL)
  })

  it('0 profil → "topilmadi", bog\'lanmaydi', async () => {
    const f = fake({ linkable: [] })
    await handleTgBot(SECRET, contact('+998901234567'), f.deps)
    expect(f.links).toHaveLength(0)
    expect(f.sent.map((s) => s.text)).toEqual([BOT_MESSAGES.notFound])
  })

  it('2+ profil (bir nechta firma) → bog\'lanmaydi', async () => {
    const f = fake({
      linkable: [
        { id: 'p1', company_id: 'c1' },
        { id: 'p2', company_id: 'c2' },
      ],
    })
    await handleTgBot(SECRET, contact('+998901234567'), f.deps)
    expect(f.links).toHaveLength(0)
    expect(f.sent.map((s) => s.text)).toEqual([BOT_MESSAGES.multipleCompanies])
  })

  it('boshqa birovning kontakti (user_id ≠ from.id) → rad', async () => {
    const f = fake({ linkable: [{ id: 'p1', company_id: 'c1' }] })
    await handleTgBot(SECRET, contact('+998901234567', 999), f.deps)
    expect(f.links).toHaveLength(0)
    expect(f.phonesQueried).toHaveLength(0)
    expect(f.sent[0]?.text).toBe(BOT_MESSAGES.notOwnContact)
  })

  it('user_id siz kontakt (qo\'lda yuborilgan) → rad', async () => {
    const f = fake({ linkable: [{ id: 'p1', company_id: 'c1' }] })
    await handleTgBot(SECRET, contact('+998901234567', null), f.deps)
    expect(f.links).toHaveLength(0)
    expect(f.sent[0]?.text).toBe(BOT_MESSAGES.notOwnContact)
  })

  it('telegram akkaunt allaqachon boshqa profilga (boshqa raqam) bog\'langan → rad', async () => {
    const f = fake({ byTg: { id: 'p9', phone: '+998935555555' }, linkable: [{ id: 'p1', company_id: 'c1' }] })
    await handleTgBot(SECRET, contact('+998901234567'), f.deps)
    expect(f.links).toHaveLength(0)
    expect(f.sent.map((s) => s.text)).toEqual([BOT_MESSAGES.alreadyLinkedOther])
  })

  it('allaqachon shu raqam bilan bog\'langan → "allaqachon bog\'langansiz" + Mini App', async () => {
    const f = fake({ byTg: { id: 'p1', phone: '+998901234567' } })
    await handleTgBot(SECRET, contact('+998 90 123 45 67'), f.deps)
    expect(f.links).toHaveLength(0)
    expect(f.sent[0]?.text).toBe(BOT_MESSAGES.alreadyLinked)
    expect(webAppUrlOf(f.sent[0]?.markup)).toBe(DEFAULT_MINI_APP_URL)
  })

  it('noto\'g\'ri raqam → xabar, qidirilmaydi', async () => {
    const f = fake()
    await handleTgBot(SECRET, contact('12'), f.deps)
    expect(f.phonesQueried).toHaveLength(0)
    expect(f.sent[0]?.text).toBe(BOT_MESSAGES.invalidPhone)
  })

  it('bog\'lash poygasi (link false) → qayta urinish xabari', async () => {
    const f = fake({ linkable: [{ id: 'p1', company_id: 'c1' }], linkResult: false })
    await handleTgBot(SECRET, contact('+998901234567'), f.deps)
    expect(f.sent[0]?.text).toBe(BOT_MESSAGES.tryAgain)
  })

  it('bazada xato → baribir 200, xato loglanadi', async () => {
    const f = fake({ throwOnFind: true })
    const r = await handleTgBot(SECRET, contact('+998901234567'), f.deps)
    expect(r.status).toBe(200)
    expect(f.logs.some((l) => l.level === 'error')).toBe(true)
    expect(f.sent[0]?.text).toBe(BOT_MESSAGES.tryAgain)
  })
})

describe('tg-bot: kontakt raqami formatlari', () => {
  it.each([
    ['998901234567', '+998901234567'],
    ['+998901234567', '+998901234567'],
    [' 998 90 123 45 67 ', '+998901234567'],
    ['77011234567', '+77011234567'],
    ['+77011234567', '+77011234567'],
    ['', null],
    ['abc', null],
  ])('%s → %s', (raw, expected) => {
    expect(contactPhone(raw)).toBe(expected)
  })

  it("Qozog'iston raqami (+ siz) bilan qidiriladi", async () => {
    const f = fake({ linkable: [{ id: 'p1', company_id: 'c1' }] })
    await handleTgBot(SECRET, contact('77011234567'), f.deps)
    expect(f.phonesQueried).toEqual(['+77011234567'])
    expect(f.links[0]?.phone).toBe('+77011234567')
  })

  it("audit xatosi bog'lashni buzmaydi", async () => {
    const f = fake({ linkable: [{ id: 'p1', company_id: 'c1' }], auditThrows: true })
    const r = await handleTgBot(SECRET, contact('+998901234567'), f.deps)
    expect(r.status).toBe(200)
    expect(f.sent[0]?.text).toBe(BOT_MESSAGES.linked)
    expect(f.logs.some((l) => l.level === 'error')).toBe(true)
  })
})

describe("tg-bot: \"Ko'rildi\" tugmasi (callback_query)", () => {
  const ALERT = '11111111-2222-3333-4444-555555555555'
  const TEXT = '⚠️ Narx odatdagidan yuqori\nSement · Obyekt A\n29.10.2026 14:32'
  const ENTITIES = [{ type: 'bold', offset: 3, length: 23 }]
  const OPEN = { text: 'Ochish', web_app: { url: `https://app.example.uz/tg?alert=${ALERT}` } }
  const MARKUP = { inline_keyboard: [[{ text: "✓ Ko'rildi", callback_data: `al:seen:${ALERT}` }, OPEN]] }
  const cb = (over: Record<string, unknown> = {}, msgOver: Record<string, unknown> = {}) => ({
    update_id: 2,
    callback_query: {
      id: 'cbq-1',
      from: { id: FROM, is_bot: false, first_name: 'Ali' },
      data: `al:seen:${ALERT}`,
      chat_instance: 'x',
      message: {
        message_id: 77,
        date: 1700000000,
        chat: { id: CHAT, type: 'private' },
        text: TEXT,
        entities: ENTITIES,
        reply_markup: MARKUP,
        ...msgOver,
      },
      ...over,
    },
  })

  it('muvaffaqiyat: RPC, javob, xabar tahrirlanadi (matn + Ochish qoladi)', async () => {
    const f = fake()
    const r = await handleTgBot(SECRET, cb(), f.deps)
    expect(r).toEqual({ status: 200, body: { ok: true } })
    expect(f.seenCalls).toEqual([{ tg: FROM, alertId: ALERT }])
    expect(f.answers).toEqual([{ id: 'cbq-1', text: BOT_MESSAGES.seenOk, showAlert: false }])
    expect(f.edits).toEqual([
      {
        chatId: CHAT,
        messageId: 77,
        edit: { text: `${TEXT}\n\n✓ Ko'rildi — Ali Valiyev`, entities: ENTITIES },
        markup: { inline_keyboard: [[OPEN]] },
      },
    ])
    expect(f.sent).toEqual([])
  })

  it("sir noto'g'ri → 401, RPC chaqirilmaydi", async () => {
    const f = fake()
    expect((await handleTgBot('wrong', cb(), f.deps)).status).toBe(401)
    expect(f.seenCalls).toEqual([])
  })

  it('admin emas / boshqa firma → "Faqat admin" (alert oynasi), tahrir yo\'q', async () => {
    const f = fake({ seen: { ok: false, reason: 'forbidden' } })
    await handleTgBot(SECRET, cb(), f.deps)
    expect(f.answers).toEqual([{ id: 'cbq-1', text: BOT_MESSAGES.seenForbidden, showAlert: true }])
    expect(f.edits).toEqual([])
  })

  it('alert topilmadi', async () => {
    const f = fake({ seen: { ok: false, reason: 'not_found' } })
    await handleTgBot(SECRET, cb(), f.deps)
    expect(f.answers[0]?.text).toBe(BOT_MESSAGES.seenNotFound)
    expect(f.edits).toEqual([])
  })

  it('RPC xatosi → xato javobi, 200', async () => {
    const f = fake({ seen: 'throw' })
    expect((await handleTgBot(SECRET, cb(), f.deps)).status).toBe(200)
    expect(f.answers[0]).toMatchObject({ text: BOT_MESSAGES.seenError, showAlert: true })
    expect(f.edits).toEqual([])
  })

  it("noma'lum / yaroqsiz data → faqat bo'sh javob, RPC yo'q", async () => {
    for (const data of ['boshqa', 'al:seen:not-a-uuid', `al:seen:${ALERT}x`, 42, undefined]) {
      const f = fake()
      await handleTgBot(SECRET, cb({ data }), f.deps)
      expect(f.seenCalls).toEqual([])
      expect(f.answers).toEqual([{ id: 'cbq-1', text: '', showAlert: false }])
    }
  })

  it("id yoki from yo'q / bot → e'tiborsiz", async () => {
    for (const over of [{ id: '' }, { from: null }, { from: { id: 'x' } }, { from: { id: FROM, is_bot: true } }]) {
      const f = fake()
      expect((await handleTgBot(SECRET, cb(over), f.deps)).status).toBe(200)
      expect(f.seenCalls).toEqual([])
      expect(f.answers).toEqual([])
    }
  })

  it("xabar yo'q yoki InaccessibleMessage (date 0) → belgilanadi, tahrir yo'q", async () => {
    const f1 = fake()
    await handleTgBot(SECRET, cb({ message: undefined }), f1.deps)
    expect(f1.seenCalls.length).toBe(1)
    expect(f1.edits).toEqual([])
    const f2 = fake()
    await handleTgBot(SECRET, cb({}, { date: 0 }), f2.deps)
    expect(f2.edits).toEqual([])
  })

  it('belgi allaqachon bor (ikkinchi bosish) → faqat tugmalar', async () => {
    const f = fake()
    await handleTgBot(SECRET, cb({}, { text: `${TEXT}\n\n✓ Ko'rildi — Vali` }), f.deps)
    expect(f.edits[0]?.edit).toBeNull()
  })

  it('tahrir / javob xatosi — 200, log', async () => {
    const f = fake({ editThrows: true, answerThrows: true })
    expect((await handleTgBot(SECRET, cb(), f.deps)).status).toBe(200)
    expect(f.logs.some((l) => l.message.includes('tahrirlanmadi'))).toBe(true)
  })

  it('parseSeenCallback', () => {
    expect(parseSeenCallback(`al:seen:${ALERT.toUpperCase()}`)).toBe(ALERT)
    expect(parseSeenCallback('al:seen:')).toBeNull()
    expect(parseSeenCallback(null)).toBeNull()
  })

  it('withoutSeenButton: faqat al:seen olib tashlanadi; url, boshqa callback qoladi; yaroqsizlar tashlanadi', () => {
    expect(
      withoutSeenButton({
        inline_keyboard: [
          [{ text: "✓ Ko'rildi", callback_data: 'al:seen:x' }],
          [{ text: 'Sayt', url: 'https://a.uz' }, { text: 'Boshqa', callback_data: 'x:y' }, { bad: 1 }, 'str'],
          'not-a-row',
        ],
      }),
    ).toEqual({ inline_keyboard: [[{ text: 'Sayt', url: 'https://a.uz' }, { text: 'Boshqa', callback_data: 'x:y' }]] })
    expect(withoutSeenButton(undefined)).toEqual({ inline_keyboard: [] })
  })

  it("seenText: 4096 chegarasi, bo'sh matn, ism normallashtiriladi", () => {
    expect(seenText('x'.repeat(4090), 'Ali')).toBeNull()
    expect(seenText('', 'Ali')).toBeNull()
    expect(seenText(undefined, 'Ali')).toBeNull()
    expect(seenText('A', '  Ali \n Valiyev ')).toBe("A\n\n✓ Ko'rildi — Ali Valiyev")
    expect(seenText('A', '   ')).toBe("A\n\n✓ Ko'rildi — —")
  })
})

describe('tg-bot: my_chat_member (botni bloklash)', () => {
  const upd = (oldS: string, newS: string, chat: Record<string, unknown> = { id: CHAT, type: 'private' }) => ({
    update_id: 3,
    my_chat_member: {
      chat,
      from: { id: FROM, is_bot: false, first_name: 'Ali' },
      date: 1700000000,
      old_chat_member: { status: oldS, user: { id: 1, is_bot: true } },
      new_chat_member: { status: newS, user: { id: 1, is_bot: true } },
    },
  })

  it('kicked → svc_mark_chat_blocked(chat, true)', async () => {
    const f = fake()
    expect((await handleTgBot(SECRET, upd('member', 'kicked'), f.deps)).status).toBe(200)
    expect(f.blockCalls).toEqual([{ chatId: CHAT, blocked: true }])
    expect(f.sent).toEqual([])
  })

  it('member (blokdan chiqdi) → false', async () => {
    const f = fake()
    await handleTgBot(SECRET, upd('kicked', 'member'), f.deps)
    expect(f.blockCalls).toEqual([{ chatId: CHAT, blocked: false }])
  })

  it("guruh chat / o'zgarishsiz / noma'lum status → chaqirilmaydi", async () => {
    for (const u of [
      upd('member', 'kicked', { id: -100, type: 'group' }),
      upd('member', 'member'),
      upd('member', 'weird'),
      { update_id: 4, my_chat_member: { chat: null } },
    ]) {
      const f = fake()
      expect((await handleTgBot(SECRET, u, f.deps)).status).toBe(200)
      expect(f.blockCalls).toEqual([])
    }
  })

  it('RPC xatosi — 200, faqat log', async () => {
    const f = fake({ blockThrows: true })
    expect((await handleTgBot(SECRET, upd('member', 'kicked'), f.deps)).status).toBe(200)
    expect(f.logs.some((l) => l.message.includes('svc_mark_chat_blocked'))).toBe(true)
  })

  it("sir noto'g'ri → 401, RPC chaqirilmaydi", async () => {
    const f = fake()
    expect((await handleTgBot('wrong', upd('member', 'kicked'), f.deps)).status).toBe(401)
    expect(f.blockCalls).toEqual([])
  })

  it('chatBlockedChange', () => {
    expect(chatBlockedChange(upd('member', 'left').my_chat_member)).toEqual({ chatId: CHAT, blocked: true })
  })
})
