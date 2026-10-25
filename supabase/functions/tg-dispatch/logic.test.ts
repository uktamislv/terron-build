// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  BUDGET_RETRY_SEC,
  CLAIM_LIMIT,
  DEFAULT_RETRY_AFTER_SEC,
  DIGEST_THRESHOLD,
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
    recipients: async (companyId) => {
      if (opts.recipientsThrow) throw new Error('recipients down')
      return opts.recipients?.[companyId] ?? []
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
  return { deps, sent, completed, logs, claims, secretCalls, sleeps }
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

  it('alert va hisobot: shablon matni, Mini App tugmasi, har qabul qiluvchiga; sent + delivered', async () => {
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
    expect(f.sent.map(({ chatId, text, markup }) => ({ chatId, text, markup }))).toEqual([
      { chatId: 1, text: formatAlertMessage(a.payload as AlertPayload), markup: kb },
      { chatId: 2, text: formatAlertMessage(a.payload as AlertPayload), markup: kb },
      { chatId: 3, text: formatDailyReport(REPORT_PAYLOAD), markup: kb },
    ])
    expect(f.completed).toEqual([done('a1', [1, 2]), done('d1', [3])])
  })

  it('MINI_APP_URL yo`q yoki https emas → standart URL', async () => {
    expect(resolveMiniAppUrl(undefined)).toBe(DEFAULT_MINI_APP_URL)
    expect(resolveMiniAppUrl('http://insecure/tg')).toBe(DEFAULT_MINI_APP_URL)
    const f = fake({ rows: [row('alert')], recipients: { c1: [R(1)] } })
    await handleDispatch(SECRET, f.deps)
    expect(f.sent[0]?.markup).toEqual(miniAppKeyboard(DEFAULT_MINI_APP_URL))
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
    expect(f.completed).toEqual([done('a1', [2])])
  })

  it('hamma qabul qiluvchi bloklagan → sent (0)', async () => {
    const f = fake({ rows: [row('alert', { id: 'a1' })], recipients: { c1: [R(1), R(2)] }, send: () => BLOCKED })
    await handleDispatch(SECRET, f.deps)
    expect(f.completed).toEqual([done('a1', [])])
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

  it('401 (bot tokeni noto`g`ri) → darhol failed (final), qolgan qatorlar ham, yuborish to`xtaydi', async () => {
    const f = fake({
      rows: [row('alert', { id: 'a1' }), row('daily_report', { id: 'd1' })],
      recipients: { c1: [R(1), R(2)] },
      send: () => classifyTelegramResponse(401, { ok: false, description: 'Unauthorized' }),
    })
    const r = await handleDispatch(SECRET, f.deps)
    expect(r.body).toEqual({ processed: 2, sent: 0, failed: 2 })
    expect(f.sent).toHaveLength(1)
    expect(f.completed).toEqual([
      { id: 'a1', ok: false, delivered: [], error: 'p1: telegram 401 Unauthorized', final: true },
      { id: 'd1', ok: false, delivered: [], error: 'telegram 401 Unauthorized', final: true },
    ])
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
  it('401, 404 → fatal', () => {
    expect(classifyTelegramResponse(401, { description: 'Unauthorized' })).toMatchObject({ kind: 'fatal' })
    expect(classifyTelegramResponse(404, { description: 'Not Found' })).toMatchObject({ kind: 'fatal' })
  })
  it('400 (boshqa), 500, 200 ok=false → error', () => {
    expect(classifyTelegramResponse(400, { description: "Bad Request: can't parse entities" })).toMatchObject({ kind: 'error' })
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
