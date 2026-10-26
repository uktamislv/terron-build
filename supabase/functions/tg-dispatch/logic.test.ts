// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  BUDGET_RETRY_SEC,
  CLAIM_LIMIT,
  DEFAULT_RETRY_AFTER_SEC,
  DIGEST_THRESHOLD,
  TOKEN_RETRY_SEC,
  COMPLETE_SENDS_BLOCKED_CHAT_IDS,
  authorizeDispatch,
  runDispatch,
  SAME_CHAT_GAP_MS,
  TIME_BUDGET_MS,
  classifyTelegramResponse,
  handleDispatch,
  resolveMiniAppUrl,
  sanitizeError,
  type CompleteArgs,
  type DispatchDeps,
  type OutboxRow,
  type Recipient,
  type SendResult,
} from './logic.ts'
import { DEFAULT_MINI_APP_URL } from '../tg-bot/logic.ts'
import {
  formatAlertDigest,
  formatAlertMessage,
  formatDailyReport,
  alertKeyboard,
  formatBugReport,
  formatAlertReminder,
  formatCashStatement,
  formatRequestOverdue,
  miniAppKeyboard,
  type AlertPayload,
} from '../_shared/notifyMessages.ts'

const SECRET = 'a'.repeat(64)
const NEW_SECRET = 'c'.repeat(64)
const BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'

const alertPayload = (n = 1): AlertPayload => ({
  alert_id: `11111111-1111-1111-1111-${String(n).padStart(12, '0')}`,
  type: 'narx_ogishi',
  severity: 'ogohlantirish',
  object_name: 'Obyekt <A>',
  material_name: `Sement ${n}`,
  base_unit: 'kg',
  details: { price: 1450, avg_n: 1300, diff_n: 11.54, direction: 'high' },
  created_at: '2026-10-29T09:32:00+00:00',
})

const REPORT_PAYLOAD = {
  date: '2026-10-29',
  period_start: '2026-10-28T15:00:00Z',
  period_end: '2026-10-29T15:00:00Z',
  company_name: 'Firma',
  kirim_count: 12,
  chiqim_count: 7,
  purchases_count: 5,
  purchases_sum: '12500000.00',
  requests_count: 0,
  alerts_new: 3,
  alerts_by_type: { narx_ogishi: 1, xarid_qabul_farqi: 2 },
  self_received_count: 1,
  deleted_count: 0,
  failed_count: 0,
  transfers_pending_count: 0,
  chiqim_without_estimate_count: 0,
  restored_count: 0,
}

let seq = 0
const row = (
  kind: 'alert' | 'daily_report',
  opts: { id?: string; company?: string; delivered?: number[]; payload?: unknown } = {},
): OutboxRow => {
  seq++
  return {
    id: opts.id ?? `r${seq}`,
    company_id: opts.company ?? 'c1',
    kind,
    payload: 'payload' in opts ? opts.payload : kind === 'alert' ? alertPayload(seq) : REPORT_PAYLOAD,
    attempts: 1,
    delivered_chat_ids: opts.delivered ?? [],
  }
}

const R = (chat: number, role = 'direktor'): Recipient => ({ profile_id: `p${chat}`, chat_id: chat, role })

const BLOCKED = classifyTelegramResponse(403, { ok: false, description: 'Forbidden: bot was blocked by the user' })
const RATE = (sec: number): SendResult => classifyTelegramResponse(429, { ok: false, parameters: { retry_after: sec } })

function fake(opts: {
  secret?: string | null
  /** refresh = true bo'lganda qaytadigan sir (rotatsiya) */
  refreshedSecret?: string | null
  rows?: OutboxRow[]
  recipients?: Record<string, Recipient[]>
  send?: (chatId: number, text: string) => SendResult | Promise<SendResult>
  /** har sendMessage soatni shuncha ms ga suradi */
  sendCostMs?: number
  miniAppUrl?: string
  claimThrows?: boolean
  recipientsThrow?: boolean
  completeThrows?: boolean
} = {}) {
  let clock = 1_000_000
  const sent: { chatId: number; text: string; markup: unknown; at: number }[] = []
  const completed: ({ id: string } & CompleteArgs)[] = []
  const logs: { level: string; message: string; extra?: Record<string, unknown> }[] = []
  const claims: number[] = []
  const secretCalls: boolean[] = []
  const sleeps: number[] = []
  const recipientCalls: string[] = []
  const deps: DispatchDeps = {
    env: { miniAppUrl: opts.miniAppUrl },
    getDispatchSecret: async (refresh) => {
      secretCalls.push(refresh)
      if (refresh && 'refreshedSecret' in opts) return opts.refreshedSecret ?? null
      return 'secret' in opts ? (opts.secret ?? null) : SECRET
    },
    claim: async (limit) => {
      claims.push(limit)
      if (opts.claimThrows) throw new Error(`db down https://api.telegram.org/bot${BOT_TOKEN}/x`)
      return opts.rows ?? []
    },
    recipients: async (r) => {
      if (opts.recipientsThrow) throw new Error('recipients down')
      recipientCalls.push(r.id)
      return opts.recipients?.[r.company_id] ?? []
    },
    sendMessage: async (chatId, text, markup) => {
      sent.push({ chatId, text, markup, at: clock })
      clock += opts.sendCostMs ?? 10
      return opts.send ? opts.send(chatId, text) : { ok: true }
    },
    complete: async (id, args) => {
      if (opts.completeThrows) throw new Error('complete down')
      completed.push({ id, ...args })
    },
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
    log: (level, message, extra) => logs.push({ level, message, ...(extra ? { extra } : {}) }),
  }
  return { deps, sent, completed, logs, claims, secretCalls, sleeps, recipientCalls }
}

const done = (id: string, delivered: number[]) => ({ id, ok: true, delivered, error: null })

describe('handleDispatch — autentifikatsiya', () => {
  it('sarlavha yo`q → 401, baza chaqirilmaydi', async () => {
    const f = fake()
    const r = await handleDispatch(null, f.deps)
    expect(r).toEqual({ status: 401, body: { error: 'unauthorized' } })
    expect(f.claims).toEqual([])
    expect(f.secretCalls).toEqual([])
  })

  it('noto`g`ri sir → keshni yangilashga urinadi, baribir mos emas → 401', async () => {
    for (const h of ['b'.repeat(64), 'a'.repeat(63), `${SECRET}x`]) {
      const f = fake()
      expect((await handleDispatch(h, f.deps)).status).toBe(401)
      expect(f.secretCalls).toEqual([false, true])
      expect(f.claims).toEqual([])
    }
  })

  it('to`g`ri sir — yangilash so`ralmaydi', async () => {
    const f = fake()
    expect((await handleDispatch(SECRET, f.deps)).status).toBe(200)
    expect(f.secretCalls).toEqual([false])
  })

  it('rotatsiya: keshdagi eski sir, yangisi kelgan — yangilangandan keyin 200', async () => {
    const f = fake({ refreshedSecret: NEW_SECRET })
    expect((await handleDispatch(NEW_SECRET, f.deps)).status).toBe(200)
    expect(f.secretCalls).toEqual([false, true])
  })

  it('Vault`da sir yo`q → 500 server_misconfigured', async () => {
    const f = fake({ secret: null })
    expect(await handleDispatch(SECRET, f.deps)).toEqual({ status: 500, body: { error: 'server_misconfigured' } })
  })

  it('navbat o`qilmasa → 500, xatoda token yo`q', async () => {
    const f = fake({ claimThrows: true })
    expect((await handleDispatch(SECRET, f.deps)).status).toBe(500)
    expect(JSON.stringify(f.logs)).not.toContain(BOT_TOKEN)
  })
})

describe('handleDispatch — yuborish', () => {
  it('bo`sh navbat → { processed: 0, sent: 0, failed: 0 }, limit 20', async () => {
    const f = fake()
    expect(await handleDispatch(SECRET, f.deps)).toEqual({ status: 200, body: { processed: 0, sent: 0, failed: 0 } })
    expect(f.claims).toEqual([CLAIM_LIMIT])
    expect(CLAIM_LIMIT).toBe(20)
  })

  it('alert va hisobot: shablon matni, tugmalar (admin — Ko\x27rildi + Ochish), har qabul qiluvchiga', async () => {
    const a = row('alert', { id: 'a1', company: 'c1' })
    const d = row('daily_report', { id: 'd1', company: 'c2' })
    const f = fake({
      rows: [a, d],
      recipients: { c1: [R(1), R(2, 'admin')], c2: [R(3)] },
      miniAppUrl: 'https://app.example.uz/tg',
    })
    const r = await handleDispatch(SECRET, f.deps)
    expect(r).toEqual({ status: 200, body: { processed: 2, sent: 2, failed: 0 } })
    const kb = miniAppKeyboard('https://app.example.uz/tg')
    const id = (a.payload as AlertPayload).alert_id
    expect(f.sent.map(({ chatId, text, markup }) => ({ chatId, text, markup }))).toEqual([
      { chatId: 1, text: formatAlertMessage(a.payload as AlertPayload), markup: alertKeyboard('https://app.example.uz/tg', id, false) },
      { chatId: 2, text: formatAlertMessage(a.payload as AlertPayload), markup: alertKeyboard('https://app.example.uz/tg', id, true) },
      { chatId: 3, text: formatDailyReport(REPORT_PAYLOAD), markup: kb },
    ])
    expect(f.completed).toEqual([done('a1', [1, 2]), done('d1', [3])])
  })

  it('MINI_APP_URL yo`q yoki https emas → standart URL', async () => {
    expect(resolveMiniAppUrl(undefined)).toBe(DEFAULT_MINI_APP_URL)
    expect(resolveMiniAppUrl('http://insecure/tg')).toBe(DEFAULT_MINI_APP_URL)
    const f = fake({ rows: [row('alert')], recipients: { c1: [R(1)] } })
    await handleDispatch(SECRET, f.deps)
    const p = f.sent[0]?.markup as { inline_keyboard: { web_app?: { url: string } }[][] }
    expect(p.inline_keyboard[0]?.[0]?.web_app?.url.startsWith(DEFAULT_MINI_APP_URL + '?alert=')).toBe(true)
  })

  it('qabul qiluvchi yo`q → sent (0), Telegram chaqirilmaydi', async () => {
    const f = fake({ rows: [row('alert', { id: 'a1' })] })
    expect((await handleDispatch(SECRET, f.deps)).body).toEqual({ processed: 1, sent: 1, failed: 0 })
    expect(f.sent).toEqual([])
    expect(f.completed).toEqual([done('a1', [])])
  })

  it('qayta urinish: avval yetkazilgan chatlarga yuborilmaydi', async () => {
    const f = fake({ rows: [row('alert', { id: 'a1', delivered: [1] })], recipients: { c1: [R(1), R(2)] } })
    await handleDispatch(SECRET, f.deps)
    expect(f.sent.map((s) => s.chatId)).toEqual([2])
    expect(f.completed).toEqual([done('a1', [2])])
  })

  it('qisman xato → pending (ok = false), yetkazilganlar yoziladi', async () => {
    const f = fake({
      rows: [row('alert', { id: 'a1' })],
      recipients: { c1: [R(1), R(2), R(3)] },
      send: (chat) => (chat === 2 ? { ok: false, kind: 'error', error: 'telegram 500 Internal' } : { ok: true }),
    })
    const r = await handleDispatch(SECRET, f.deps)
    expect(r.body).toEqual({ processed: 1, sent: 0, failed: 1 })
    expect(f.completed).toEqual([
      { id: 'a1', ok: false, delivered: [1, 3], error: 'p2: telegram 500 Internal' },
    ])
  })

  it('ikki qabul qiluvchidan biri 429 → retry_after bilan; qayta urinishda faqat ikkinchisiga', async () => {
    const first = fake({
      rows: [row('alert', { id: 'a1' })],
      recipients: { c1: [R(1), R(2)] },
      send: (chat) => (chat === 2 ? RATE(17) : { ok: true }),
    })
    await handleDispatch(SECRET, first.deps)
    expect(first.completed).toEqual([
      { id: 'a1', ok: false, delivered: [1], error: 'p2: telegram 429', retryAfterSec: 17 },
    ])
    // baza delivered_chat_ids = [1] saqladi
    const second = fake({ rows: [row('alert', { id: 'a1', delivered: [1] })], recipients: { c1: [R(1), R(2)] } })
    await handleDispatch(SECRET, second.deps)
    expect(second.sent.map((s) => s.chatId)).toEqual([2])
    expect(second.completed).toEqual([done('a1', [2])])
  })

  it('429: qolgan qatorlar yuborilmaydi, ular ham retry_after bilan keyinga', async () => {
    const f = fake({
      rows: [row('alert', { id: 'a1' }), row('daily_report', { id: 'd1' })],
      recipients: { c1: [R(1)] },
      send: () => RATE(3),
    })
    const r = await handleDispatch(SECRET, f.deps)
    expect(r.body).toEqual({ processed: 2, sent: 0, failed: 2 })
    expect(f.sent).toHaveLength(1)
    expect(f.completed).toEqual([
      { id: 'a1', ok: false, delivered: [], error: 'p1: telegram 429', retryAfterSec: 3 },
      { id: 'd1', ok: false, delivered: [], error: 'rate_limited', retryAfterSec: 3 },
    ])
  })

  it('bot bloklangan (403) — o`tkazib yuboriladi; qolganlar yetkazilsa sent', async () => {
    const f = fake({
      rows: [row('alert', { id: 'a1' })],
      recipients: { c1: [R(1), R(2)] },
      send: (chat) => (chat === 1 ? BLOCKED : { ok: true }),
    })
    expect((await handleDispatch(SECRET, f.deps)).body).toEqual({ processed: 1, sent: 1, failed: 0 })
    // yetib bo'lmaydigan chat — blocked ro'yxatida (index.ts p_blocked_chat_ids sifatida yuboradi)
    expect(f.completed).toEqual([{ ...done('a1', [2]), blocked: [1] }])
  })

  it('hamma qabul qiluvchi bloklagan → sent (0)', async () => {
    const f = fake({ rows: [row('alert', { id: 'a1' })], recipients: { c1: [R(1), R(2)] }, send: () => BLOCKED })
    await handleDispatch(SECRET, f.deps)
    expect(f.completed).toEqual([{ ...done('a1', []), blocked: [1, 2] }])
  })

  it('hammasi xato → qayta urinish; keyingi qatorlar davom etadi', async () => {
    const f = fake({
      rows: [row('alert', { id: 'a1', company: 'c1' }), row('daily_report', { id: 'd1', company: 'c2' })],
      recipients: { c1: [R(1), R(2)], c2: [R(3)] },
      send: (chat) =>
        chat === 3 ? { ok: true } : { ok: false, kind: 'error', error: 'telegram sendMessage: tarmoq xatosi (TimeoutError)' },
    })
    expect((await handleDispatch(SECRET, f.deps)).body).toEqual({ processed: 2, sent: 1, failed: 1 })
    expect(f.completed[0]).toMatchObject({ id: 'a1', ok: false, delivered: [] })
    expect(f.completed[0]?.final).toBeUndefined()
    expect(f.completed[0]?.retryAfterSec).toBeUndefined()
    expect(f.completed[1]).toMatchObject(done('d1', [3]))
  })

  it('401 (bot tokeni bekor qilingan) → failed EMAS: hamma qatorlar TOKEN_RETRY_SEC bilan keyinga, yuborish to`xtaydi', async () => {
    const f = fake({
      rows: [row('alert', { id: 'a1' }), row('daily_report', { id: 'd1' })],
      recipients: { c1: [R(1), R(2)] },
      send: () => classifyTelegramResponse(401, { ok: false, description: 'Unauthorized' }),
    })
    const r = await handleDispatch(SECRET, f.deps)
    expect(r.body).toEqual({ processed: 2, sent: 0, failed: 2 })
    expect(f.sent).toHaveLength(1)
    expect(f.completed).toEqual([
      { id: 'a1', ok: false, delivered: [], error: 'p1: telegram 401 Unauthorized', retryAfterSec: TOKEN_RETRY_SEC },
      { id: 'd1', ok: false, delivered: [], error: 'telegram 401 Unauthorized', retryAfterSec: TOKEN_RETRY_SEC },
    ])
    expect(f.completed.every((c) => c.final === undefined)).toBe(true)
    expect(TOKEN_RETRY_SEC).toBe(600)
  })

  it('yaroqsiz payload / noma`lum kind → darhol failed (final), Telegram chaqirilmaydi', async () => {
    const f = fake({
      rows: [row('alert', { id: 'a1', payload: null }), row('daily_report', { id: 'x1', payload: 'abc' })],
      recipients: { c1: [R(1)] },
    })
    const r = await handleDispatch(SECRET, f.deps)
    expect(r.body).toEqual({ processed: 2, sent: 0, failed: 2 })
    expect(f.sent).toEqual([])
    expect(f.completed.map((c) => [c.id, c.ok, c.final])).toEqual([
      ['a1', false, true],
      ['x1', false, true],
    ])
  })

  it('sendMessage tashlasa — vaqtinchalik xato (token tozalanadi)', async () => {
    const f = fake({
      rows: [row('alert', { id: 'a1' })],
      recipients: { c1: [R(1)] },
      send: () => {
        throw new Error(`fetch failed https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`)
      },
    })
    await handleDispatch(SECRET, f.deps)
    expect(f.completed[0]).toMatchObject({ ok: false })
    expect(f.completed[0]?.final).toBeUndefined()
    expect(f.completed[0]?.error).not.toContain(BOT_TOKEN)
    expect(f.completed[0]?.error).toContain('bot***')
  })

  it('qabul qiluvchilarni o`qish xatosi → qayta urinish', async () => {
    const f = fake({ rows: [row('alert', { id: 'a1' })], recipientsThrow: true })
    expect((await handleDispatch(SECRET, f.deps)).body).toEqual({ processed: 1, sent: 0, failed: 1 })
    expect(f.completed[0]).toMatchObject({ id: 'a1', ok: false, error: 'recipients down' })
  })

  it('complete xatosi — log, javob baribir 200', async () => {
    const f = fake({ rows: [row('alert')], recipients: { c1: [R(1)] }, completeThrows: true })
    expect((await handleDispatch(SECRET, f.deps)).status).toBe(200)
    expect(f.logs.some((l) => l.level === 'error' && l.message.includes('natija yozilmadi'))).toBe(true)
  })

  it('sir va token logga ham, natijaga ham tushmaydi', async () => {
    const f = fake({
      rows: [row('alert')],
      recipients: { c1: [R(1)] },
      send: () => ({ ok: false, kind: 'error', error: `boom ${SECRET} bot${BOT_TOKEN}` }),
    })
    const r = await handleDispatch(SECRET, f.deps)
    const all = JSON.stringify([r, f.logs, f.completed])
    expect(all).not.toContain(SECRET)
    expect(all).not.toContain(BOT_TOKEN)
  })
})

describe('digest (spam himoyasi)', () => {
  it(`bitta firmadan ${DIGEST_THRESHOLD + 2} ta alert → har qabul qiluvchiga bitta digest, hammasi birga yakunlanadi`, async () => {
    const alerts = Array.from({ length: DIGEST_THRESHOLD + 2 }, (_, i) => row('alert', { id: `a${i}`, company: 'c1' }))
    const other = row('alert', { id: 'b1', company: 'c2' })
    const f = fake({ rows: [...alerts, other], recipients: { c1: [R(1), R(2)], c2: [R(3)] } })
    const r = await handleDispatch(SECRET, f.deps)
    expect(r.body).toEqual({ processed: 8, sent: 8, failed: 0 })
    const digest = formatAlertDigest(alerts.map((a) => a.payload as AlertPayload))
    expect(f.sent.map((s) => [s.chatId, s.text])).toEqual([
      [1, digest],
      [2, digest],
      [3, formatAlertMessage(other.payload as AlertPayload)],
    ])
    expect(f.completed).toEqual([...alerts.map((a) => done(a.id, [1, 2])), done('b1', [3])])
  })

  it(`${DIGEST_THRESHOLD} ta alert — alohida xabarlar; bitta chatga ketma-ket ~1 s oraliq`, async () => {
    const alerts = Array.from({ length: DIGEST_THRESHOLD }, (_, i) => row('alert', { id: `a${i}` }))
    const f = fake({ rows: alerts, recipients: { c1: [R(1)] } })
    await handleDispatch(SECRET, f.deps)
    expect(f.sent).toHaveLength(DIGEST_THRESHOLD)
    for (let i = 1; i < f.sent.length; i++) {
      expect((f.sent[i]?.at ?? 0) - (f.sent[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(SAME_CHAT_GAP_MS)
    }
    expect(f.sleeps.length).toBe(DIGEST_THRESHOLD - 1)
  })

  it('digest qisman yetkazilgan: faqat hamma qatorda yetkazilgan chat o`tkaziladi', async () => {
    const alerts = Array.from({ length: DIGEST_THRESHOLD + 1 }, (_, i) =>
      row('alert', { id: `a${i}`, delivered: i === 0 ? [] : [1] }),
    )
    const f = fake({ rows: alerts, recipients: { c1: [R(1), R(2)] } })
    await handleDispatch(SECRET, f.deps)
    expect(f.sent.map((s) => s.chatId)).toEqual([1, 2])
  })
})

describe('vaqt byudjeti', () => {
  it(`${TIME_BUDGET_MS / 1000} s dan oshsa — qolgan qatorlar retry_after = ${BUDGET_RETRY_SEC} bilan, yuborilmaydi`, async () => {
    const rows = [row('daily_report', { id: 'd1', company: 'c1' }), row('daily_report', { id: 'd2', company: 'c2' }), row('daily_report', { id: 'd3', company: 'c3' })]
    const f = fake({
      rows,
      recipients: { c1: [R(1)], c2: [R(2)], c3: [R(3)] },
      sendCostMs: 30_000,
    })
    const r = await handleDispatch(SECRET, f.deps)
    expect(f.sent.map((s) => s.chatId)).toEqual([1, 2])
    expect(r.body).toEqual({ processed: 3, sent: 2, failed: 1 })
    expect(f.completed[2]).toEqual({ id: 'd3', ok: false, delivered: [], error: 'time_budget', retryAfterSec: BUDGET_RETRY_SEC })
  })
})

describe('classifyTelegramResponse', () => {
  it('200 ok', () => {
    expect(classifyTelegramResponse(200, { ok: true, result: {} })).toEqual({ ok: true })
  })
  it('429: retry_after; yo`q bo`lsa — standart', () => {
    expect(classifyTelegramResponse(429, { ok: false, parameters: { retry_after: 2.2 } })).toMatchObject({
      kind: 'rate_limited',
      retryAfterSec: 3,
    })
    expect(classifyTelegramResponse(429, null)).toMatchObject({ kind: 'rate_limited', retryAfterSec: DEFAULT_RETRY_AFTER_SEC })
  })
  it('403 (bloklangan, deaktiv) va 400 chat not found → unreachable', () => {
    expect(BLOCKED).toMatchObject({ kind: 'unreachable' })
    expect(classifyTelegramResponse(403, { description: 'Forbidden: user is deactivated' })).toMatchObject({ kind: 'unreachable' })
    expect(classifyTelegramResponse(400, { description: 'Bad Request: chat not found' })).toMatchObject({ kind: 'unreachable' })
  })
  it('401, 404 → token_invalid', () => {
    expect(classifyTelegramResponse(401, { description: 'Unauthorized' })).toMatchObject({ kind: 'token_invalid' })
    expect(classifyTelegramResponse(404, { description: 'Not Found' })).toMatchObject({ kind: 'token_invalid' })
  })
  it("400 — chatga bog'liq → unreachable; boshqasi → invalid_message", () => {
    expect(classifyTelegramResponse(400, { description: 'Bad Request: PEER_ID_INVALID' })).toMatchObject({ kind: 'unreachable' })
    expect(classifyTelegramResponse(400, { description: "Bad Request: can't parse entities: Unsupported start tag" })).toMatchObject({
      kind: 'invalid_message',
    })
    expect(classifyTelegramResponse(400, { description: 'Bad Request: message is too long' })).toMatchObject({ kind: 'invalid_message' })
  })
  it('500, 200 ok=false → error', () => {
    expect(classifyTelegramResponse(502, null)).toEqual({ ok: false, kind: 'error', error: 'telegram 502' })
    expect(classifyTelegramResponse(200, { ok: false })).toMatchObject({ kind: 'error' })
  })
})

describe('sanitizeError', () => {
  it('bot tokeni, URL qismi va sirlar o`chiriladi; 300 belgigacha', () => {
    expect(sanitizeError(`GET https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`)).toBe(
      'GET https://api.telegram.org/bot***/sendMessage',
    )
    expect(sanitizeError(`token ${BOT_TOKEN}`)).toBe('token ***')
    expect(sanitizeError(`x ${SECRET} y`, [SECRET])).toBe('x *** y')
    expect(sanitizeError('Forbidden: bot was blocked by the user')).toBe('Forbidden: bot was blocked by the user')
    expect(sanitizeError('z'.repeat(1000))).toHaveLength(300)
  })
})

describe('Batch 12 — yangi kind\'lar, qabul qiluvchilar, tugmalar', () => {
  const REMINDER = { ...alertPayload(1), status: 'yangi', reminded_at: '2026-10-31T10:00:00Z', hours_open: 49 }
  const OVERDUE = {
    date: '2026-11-06',
    company_name: 'Firma',
    count: 1,
    requests: [
      {
        request_id: 'q1', object_name: 'Obyekt A', material_name: 'Sement', qty_input: 2.5, unit_input: 'qop',
        qty_base: 125, base_unit: 'kg', needed_by: '2026-11-04', days_overdue: 2, created_by_name: 'Ali',
      },
    ],
  }
  const CASH = {
    date: '2026-11-09', period_start: '2026-11-02', period_end: '2026-11-08', company_name: 'Firma',
    profile_id: 'p9', profile_name: 'Vali', issued_week: '1000000.00', spent_week: '350000.00', returned_week: '0.00',
    balance: '650000.00', oldest_open_date: '2026-10-20', days_open: 20,
  }
  const k = (kind: string, id: string, payload: unknown, company = 'c1'): OutboxRow => ({
    id, company_id: company, kind, payload, attempts: 1, delivered_chat_ids: [],
  })

  it('alert_reminder / request_overdue / cash_statement — shablon, Ochish tugmasi; qabul qiluvchilar qator bo\'yicha', async () => {
    const rows = [k('alert_reminder', 'm1', REMINDER), k('request_overdue', 'o1', OVERDUE), k('cash_statement', 's1', CASH)]
    const f = fake({ rows, recipients: { c1: [R(1, 'admin')] }, miniAppUrl: 'https://app.example.uz/tg' })
    const r = await handleDispatch(SECRET, f.deps)
    expect(r.body).toEqual({ processed: 3, sent: 3, failed: 0 })
    expect(f.recipientCalls).toEqual(['m1', 'o1', 's1'])
    expect(f.sent.map((s) => s.text)).toEqual([
      formatAlertReminder(REMINDER),
      formatRequestOverdue(OVERDUE),
      formatCashStatement(CASH),
    ])
    expect(f.sent[0]?.markup).toEqual(alertKeyboard('https://app.example.uz/tg', REMINDER.alert_id, true))
    expect(f.sent[1]?.markup).toEqual(miniAppKeyboard('https://app.example.uz/tg'))
    expect(f.sent[2]?.markup).toEqual(miniAppKeyboard('https://app.example.uz/tg'))
  })

  it('"Ko\'rildi" faqat admin/super_admin ga; direktor va prorab — faqat Ochish', async () => {
    const a = row('alert', { id: 'a1' })
    const f = fake({ rows: [a], recipients: { c1: [R(1, 'direktor'), R(2, 'super_admin'), R(3, 'prorab')] } })
    await handleDispatch(SECRET, f.deps)
    const id = (a.payload as AlertPayload).alert_id
    expect(f.sent.map((s) => s.markup)).toEqual([
      alertKeyboard(DEFAULT_MINI_APP_URL, id, false),
      alertKeyboard(DEFAULT_MINI_APP_URL, id, true),
      // prorab alertlarni RLS bo'yicha o'qiy olmaydi — "Ochish" ?alert= siz
      { inline_keyboard: [[{ text: 'Ochish', web_app: { url: DEFAULT_MINI_APP_URL } }]] },
    ])
    const kb = alertKeyboard(DEFAULT_MINI_APP_URL, id, true).inline_keyboard[0]
    expect(kb?.[0]).toEqual({ text: "✓ Ko'rildi", callback_data: `al:seen:${id}` })
  })

  it('o\'tkazma qabul qilinmadi: admin/direktor — ?alert=<id>, prorab — oddiy Mini App havolasi', async () => {
    const nr = row('alert', {
      id: 'nr',
      payload: { ...alertPayload(7), type: 'otkazma_farqi', details: { direction: 'not_received', hours: 52 } },
    })
    const url = 'https://app.example.uz/tg'
    const f = fake({ rows: [nr], recipients: { c1: [R(1, 'admin'), R(2, 'direktor'), R(3, 'prorab'), R(4, 'prorab')] }, miniAppUrl: url })
    await handleDispatch(SECRET, f.deps)
    const id = (nr.payload as AlertPayload).alert_id
    const urls = f.sent.map((s) => {
      const kb = s.markup as { inline_keyboard: { web_app?: { url: string } }[][] }
      return kb.inline_keyboard[0]?.find((b) => b.web_app)?.web_app?.url
    })
    expect(urls).toEqual([`${url}?alert=${id}`, `${url}?alert=${id}`, url, url])
    expect(f.sent[2]?.markup).toEqual(alertKeyboard(url, id, false, false))
  })

  it('alert_id uuid bo\'lmasa — tugmasiz alert emas, oddiy Mini App tugmasi', async () => {
    const f = fake({ rows: [row('alert', { payload: { ...alertPayload(1), alert_id: 'x' } })], recipients: { c1: [R(1, 'admin')] } })
    await handleDispatch(SECRET, f.deps)
    expect(f.sent[0]?.markup).toEqual(miniAppKeyboard(DEFAULT_MINI_APP_URL))
  })

  it('eslatmalar ko\'p bo\'lsa — alohida "eslatma" digest; alertlar bilan aralashmaydi', async () => {
    const reminders = Array.from({ length: DIGEST_THRESHOLD + 1 }, (_, i) =>
      k('alert_reminder', `m${i}`, { ...alertPayload(i + 1), hours_open: 50 }),
    )
    const alert = row('alert', { id: 'a1' })
    const f = fake({ rows: [...reminders, alert], recipients: { c1: [R(1, 'admin')] } })
    await handleDispatch(SECRET, f.deps)
    expect(f.sent).toHaveLength(2)
    expect(f.sent[0]?.text).toBe(formatAlertDigest(reminders.map((r) => r.payload as AlertPayload), { reminder: true }))
    expect(f.sent[0]?.text).toContain('eslatma')
    expect(f.sent[0]?.markup).toEqual(miniAppKeyboard(DEFAULT_MINI_APP_URL))
    expect(f.sent[1]?.text).toBe(formatAlertMessage(alert.payload as AlertPayload))
  })

  it('o\'tkazma qabul qilinmadi (prorablarga ham) digest\'ga qo\'shilmaydi', async () => {
    const notReceived = row('alert', {
      id: 'nr',
      payload: { ...alertPayload(99), type: 'otkazma_farqi', details: { direction: 'not_received', hours: 52 } },
    })
    const alerts = Array.from({ length: DIGEST_THRESHOLD + 1 }, (_, i) => row('alert', { id: `a${i}` }))
    const f = fake({ rows: [notReceived, ...alerts], recipients: { c1: [R(1, 'admin')] } })
    await handleDispatch(SECRET, f.deps)
    expect(f.sent).toHaveLength(2)
    expect(f.sent[0]?.text).toBe(formatAlertMessage(notReceived.payload as AlertPayload))
    expect(f.recipientCalls[0]).toBe('nr')
  })

  it('noma\'lum kind → darhol failed', async () => {
    const f = fake({ rows: [k('mystery', 'x1', {})], recipients: { c1: [R(1)] } })
    await handleDispatch(SECRET, f.deps)
    expect(f.completed[0]).toMatchObject({ id: 'x1', ok: false, final: true })
    expect(f.sent).toEqual([])
  })
})

describe('Batch 11 — bug_report', () => {
  const BUG = {
    bug_report_id: 'b1', company_id: 'c1', company_name: 'Demo', reporter_id: 'p1', reporter_name: 'Ali',
    reporter_role: 'prorab', screen: '/tg', message: 'xato', message_truncated: false, client: 'tg 8.0',
    app_version: '0.11.0', has_photo: false, created_at: '2026-10-29T09:32:00Z',
  }
  const bugRow = (id: string): OutboxRow => ({ id, company_id: 'c1', kind: 'bug_report', payload: { ...BUG, bug_report_id: id }, attempts: 1, delivered_chat_ids: [] })

  it('shablon, url tugmasi (veb sozlamalar), qabul qiluvchilar qator bo\'yicha', async () => {
    const f = fake({ rows: [bugRow('b1')], recipients: { c1: [R(1, 'admin'), R(2, 'super_admin')] }, miniAppUrl: 'https://app.example.uz/tg' })
    const r = await handleDispatch(SECRET, f.deps)
    expect(r.body).toEqual({ processed: 1, sent: 1, failed: 0 })
    expect(f.recipientCalls).toEqual(['b1'])
    expect(f.sent.map((s) => s.text)).toEqual([formatBugReport(BUG), formatBugReport(BUG)])
    for (const s of f.sent) {
      expect(s.markup).toEqual({ inline_keyboard: [[{ text: 'Ochish', url: 'https://app.example.uz/settings?tab=bugs' }]] })
    }
  })

  it('ko\'p bo\'lsa ham digest qilinmaydi — har biri alohida', async () => {
    const rows = Array.from({ length: DIGEST_THRESHOLD + 3 }, (_, i) => bugRow(`b${i}`))
    const f = fake({ rows, recipients: { c1: [R(1, 'admin')] } })
    await handleDispatch(SECRET, f.deps)
    expect(f.sent).toHaveLength(rows.length)
    expect(f.sent.every((s) => s.text.startsWith('🐞'))).toBe(true)
    expect(f.completed.every((c) => c.ok)).toBe(true)
  })
})

describe('audit tuzatishlari — 400, avtorizatsiya ajratilgan', () => {
  it('400 yaroqsiz xabar → shu qator darhol failed (final), boshqa qabul qiluvchilarga yuborilmaydi; keyingi qatorlar davom', async () => {
    const f = fake({
      rows: [row('alert', { id: 'a1', company: 'c1' }), row('daily_report', { id: 'd1', company: 'c2' })],
      recipients: { c1: [R(1), R(2)], c2: [R(3)] },
      send: (chat) =>
        chat === 1 ? classifyTelegramResponse(400, { description: "Bad Request: can't parse entities" }) : { ok: true },
    })
    const r = await handleDispatch(SECRET, f.deps)
    expect(r.body).toEqual({ processed: 2, sent: 1, failed: 1 })
    expect(f.sent.map((x) => x.chatId)).toEqual([1, 3])
    expect(f.completed[0]).toMatchObject({ id: 'a1', ok: false, final: true, delivered: [] })
    expect(f.completed[1]).toMatchObject(done('d1', [3]))
  })
  it("authorizeDispatch: noto'g'ri sir → 401, navbat o'qilmaydi; to'g'ri → sir qaytadi", async () => {
    const f = fake({ rows: [row('alert')] })
    expect(await authorizeDispatch('wrong', f.deps)).toEqual({ ok: false, result: { status: 401, body: { error: 'unauthorized' } } })
    expect(f.claims).toEqual([])
    expect(await authorizeDispatch(SECRET, f.deps)).toEqual({ ok: true, secret: SECRET })
  })
  it("runDispatch: sir xatolardan o'chiriladi", async () => {
    const f = fake({ rows: [row('alert', { id: 'a1' })], recipients: { c1: [R(1)] }, send: () => ({ ok: false, kind: 'error', error: `boom ${SECRET}` }) })
    await runDispatch(f.deps, SECRET)
    expect(f.completed[0]?.error).toBe('p1: boom ***')
  })
})

describe('audit — ish oqimi kindlari (request_*, transfer_sent, purchase_for_object, login_changed)', () => {
  const REQ = {
    request_id: 'q1', company_name: 'F', status: 'tasdiqlandi', object_name: 'Obyekt A', material_name: 'Sement',
    qty_input: 5, unit_input: 'qop', qty_base: 250, base_unit: 'kg', needed_by: null, note: null,
    decision_note: 'Ertaga', created_by_name: 'Ali', decided_by_name: 'Bek', created_at: '2026-10-29T09:32:00Z',
    decided_at: '2026-10-29T10:00:00Z',
  }
  const TR = {
    transfer_id: 't1', company_name: 'F', from_object_name: 'A', to_object_name: 'B', material_name: 'Sement',
    qty_input: 3, unit_input: 'qop', qty_base: 150, base_unit: 'kg', note: null, sent_by_name: 'Ali', created_at: '2026-10-29T09:32:00Z',
  }
  const PU = {
    purchase_id: 'p1', company_name: 'F', object_name: 'A', material_name: 'Sement', qty_input: 10, unit_input: 'qop',
    qty_base: 500, base_unit: 'kg', buyer_name: 'Sobir', supplier_name: null, purchased_at: '2026-10-29T09:32:00Z',
  }
  const LG = { alert_id: 'a1', profile_id: 'p9', profile_name: 'Vali', company_name: 'F', actor_name: 'Bek', changed_at: '2026-10-29T09:32:00Z' }
  const k = (kind: string, id: string, payload: unknown): OutboxRow => ({
    id, company_id: 'c1', kind, payload, attempts: 1, delivered_chat_ids: [],
  })

  it('har kind — o‘z shabloni, oddiy "Ochish" (Mini App, deep link yo‘q), qabul qiluvchilar qator bo‘yicha', async () => {
    const rows = [
      k('request_created', 'w1', { ...REQ, status: 'kutilmoqda' }),
      k('request_decided', 'w2', REQ),
      k('request_approved', 'w3', REQ),
      k('transfer_sent', 'w4', TR),
      k('purchase_for_object', 'w5', PU),
      k('login_changed', 'w6', LG),
    ]
    const url = 'https://app.example.uz/tg'
    const f = fake({ rows, recipients: { c1: [R(1, 'prorab')] }, miniAppUrl: url })
    const r = await handleDispatch(SECRET, f.deps)
    expect(r.body).toEqual({ processed: 6, sent: 6, failed: 0 })
    expect(f.recipientCalls).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6'])
    expect(f.sent.map((s) => s.text.split('\n')[0])).toEqual([
      "📝 <b>Yangi so'rov</b>",
      "✅ <b>So'rovingiz tasdiqlandi</b>",
      '🛒 <b>Sotib olish kerak</b>',
      "🚚 <b>Yo'lda — o'tkazma keladi</b>",
      '🛒 <b>Sobir sotib oldi, obyektga keladi</b>',
      "🔐 <b>Sizning loginingiz o'zgartirildi</b>",
    ])
    for (const s of f.sent) expect(s.markup).toEqual(miniAppKeyboard(url, 'Ochish'))
  })

  it('ko‘p bo‘lsa ham digest qilinmaydi', async () => {
    const rows = Array.from({ length: DIGEST_THRESHOLD + 2 }, (_, i) => k('request_created', `w${i}`, REQ))
    const f = fake({ rows, recipients: { c1: [R(1, 'admin')] } })
    await handleDispatch(SECRET, f.deps)
    expect(f.sent).toHaveLength(rows.length)
  })

  it('COMPLETE_SENDS_BLOCKED_CHAT_IDS yoqilgan', () => {
    expect(COMPLETE_SENDS_BLOCKED_CHAT_IDS).toBe(true)
  })
})

describe('2-tur — yangi kindlar, deep link, sozlama 400', () => {
  const U = '11111111-2222-4333-8444-555555555555'
  const k = (kind: string, id: string, payload: unknown): OutboxRow => ({
    id, company_id: 'c1', kind, payload, attempts: 1, delivered_chat_ids: [],
  })
  const TR = {
    transfer_id: U, company_name: 'F', status: 'bekor', from_object_name: 'A', to_object_name: 'B', material_name: 'S',
    qty_input: 1, unit_input: 'kg', qty_base: 1, received_qty_base: 1, base_unit: 'kg', note: null, cancel_reason: null,
    sent_by_name: null, received_by_name: null, created_at: '2026-10-29T09:32:00Z', received_at: null,
  }
  const url = 'https://app.example.uz/tg'

  it('yangi kindlar yuboriladi (noma‘lum kind emas), deep link bilan', async () => {
    const rows = [
      k('transfer_cancelled', 'n1', TR),
      k('transfer_received', 'n2', { ...TR, status: 'qabul_qilindi' }),
      k('purchase_deleted', 'n3', { purchase_id: U, deleted_at: null }),
      k('purchase_on_your_name', 'n4', { purchase_id: U }),
      k('inventory_applied', 'n5', { count_id: U, items_count: 1, adjusted_count: 0 }),
      k('alerts_digest', 'n6', { alert_type: 'smetadan_ortiq_sorov', count: 2, items: [], more_count: 0 }),
      k('request_created', 'n7', { request_id: U }),
    ]
    const f = fake({ rows, recipients: { c1: [R(1, 'prorab')] }, miniAppUrl: url })
    const r = await handleDispatch(SECRET, f.deps)
    expect(r.body).toEqual({ processed: 7, sent: 7, failed: 0 })
    const urls = f.sent.map((s) => (s.markup as { inline_keyboard: { web_app: { url: string } }[][] }).inline_keyboard[0]?.[0]?.web_app.url)
    expect(urls).toEqual([
      `${url}?transfer=${U}`,
      `${url}?transfer=${U}`,
      `${url}?purchase=${U}`,
      `${url}?purchase=${U}`,
      url,
      url,
      `${url}?request=${U}`,
    ])
  })

  it('400 tugma / URL xatosi → failed EMAS: TOKEN_RETRY_SEC bilan keyinga, qolganlari ham', async () => {
    expect(classifyTelegramResponse(400, { description: 'Bad Request: BUTTON_URL_INVALID' })).toMatchObject({ kind: 'config_error' })
    expect(
      classifyTelegramResponse(400, { description: "Bad Request: inline keyboard button Web App URL 'x' is invalid" }),
    ).toMatchObject({ kind: 'config_error' })
    expect(classifyTelegramResponse(400, { description: "Bad Request: can't parse entities" })).toMatchObject({ kind: 'invalid_message' })
    const f = fake({
      rows: [row('alert', { id: 'a1' }), row('daily_report', { id: 'd1' })],
      recipients: { c1: [R(1)] },
      send: () => classifyTelegramResponse(400, { description: 'Bad Request: BUTTON_URL_INVALID' }),
    })
    await handleDispatch(SECRET, f.deps)
    expect(f.completed.map((c) => [c.id, c.retryAfterSec, c.final])).toEqual([
      ['a1', TOKEN_RETRY_SEC, undefined],
      ['d1', TOKEN_RETRY_SEC, undefined],
    ])
    expect(f.sent).toHaveLength(1)
  })
})
