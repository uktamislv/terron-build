// tg-dispatch — bildirishnomalar navbatini (public.notification_outbox) Telegram'ga
// yuboradi (docs/bot-design.md). Chaqiruvchi — faqat baza (pg_net: alert trigger va
// pg_cron), sarlavha `x-dispatch-secret` = Vault'dagi `tg_dispatch_secret`.
// Sof mantiq: tashqi bog'liqliklar `deps` orqali (testlar: ./logic.test.ts).
//
// Yetkazish — "kamida bir marta": har qator yetkazilgan chatlarni eslab qoladi
// (`delivered_chat_ids`), qayta urinishda faqat qolganlarga yuboriladi; lekin
// sendMessage muvaffaqiyatli bo'lib, natija yozilmay qolsa — takror bo'lishi mumkin.
//
// Xavfsizlik: bot tokeni va dispatch siri hech qachon logga, javobga yoki
// `last_error` ga tushmaydi (`sanitizeError`).

import { timingSafeEqual } from '../_shared/telegramAuth.ts'
import {
  alertKeyboard,
  bugReportKeyboard,
  formatBugReport,
  type BugReportPayload,
  formatAlertDigest,
  formatAlertMessage,
  formatAlertReminder,
  formatCashStatement,
  formatDailyReport,
  formatRequestOverdue,
  miniAppKeyboard,
  type AlertPayload,
  type AlertReminderPayload,
  type CashStatementPayload,
  type DailyReportPayload,
  type RequestOverduePayload,
} from '../_shared/notifyMessages.ts'
import { errMessage, isRecord, isUuid, respond, type HandlerResult, type LogFn } from '../_shared/handler.ts'
import { DEFAULT_MINI_APP_URL } from '../tg-bot/logic.ts'

/** Bitta chaqiruvda navbatdan olinadigan qatorlar soni. */
export const CLAIM_LIMIT = 20
/** 429 javobida `retry_after` bo'lmasa — kutish (soniya). */
export const DEFAULT_RETRY_AFTER_SEC = 5
/** Bitta firmadan shundan ko'p alert qatori olinsa — bitta digest xabar. */
export const DIGEST_THRESHOLD = 5
/** Bitta chatga ketma-ket yuborishlar orasidagi minimal oraliq. */
export const SAME_CHAT_GAP_MS = 1000
/** Sikl uchun vaqt byudjeti; oshsa qolgan qatorlar keyinga qoldiriladi. */
export const TIME_BUDGET_MS = 50_000
/** Vaqt byudjeti tugaganda qaytarilgan qatorlar shuncha soniyadan keyin. */
export const BUDGET_RETRY_SEC = 1

export interface OutboxRow {
  id: string
  company_id: string
  kind: 'alert' | 'daily_report' | 'alert_reminder' | 'request_overdue' | 'cash_statement' | 'bug_report' | string
  payload: unknown
  /** Faqat `cash_statement`: xabar egasi. */
  profile_id?: string | null
  attempts: number
  /** Oldingi urinishlarda yetkazilgan chatlar. */
  delivered_chat_ids?: (number | string)[] | null
}

export interface Recipient {
  profile_id: string
  chat_id: number
  role: string
}

/** Telegram `sendMessage` natijasi (`classifyTelegramResponse`). */
export type SendResult =
  | { ok: true }
  /** Foydalanuvchi botni bloklagan / akkaunt o'chirilgan / chat yo'q — o'tkazib yuboriladi. */
  | { ok: false; kind: 'unreachable'; error: string }
  | { ok: false; kind: 'rate_limited'; retryAfterSec: number; error: string }
  /** Doimiy xato (bot tokeni noto'g'ri: 401, 404) — qatorlar darhol failed. */
  | { ok: false; kind: 'fatal'; error: string }
  | { ok: false; kind: 'error'; error: string }

export interface CompleteArgs {
  ok: boolean
  /** Shu urinishda yetkazilgan chatlar (bazada mavjudlari bilan birlashtiriladi). */
  delivered: number[]
  error: string | null
  /** 429 / vaqt byudjeti: shuncha soniyadan keyin, urinish hisoblanmaydi. */
  retryAfterSec?: number | null
  /** Doimiy xato — darhol failed. */
  final?: boolean
}

export interface DispatchDeps {
  env: { miniAppUrl: string | undefined }
  /**
   * Vault'dagi sir (`svc_dispatch_secret`). `refresh = true` — keshni yangilashga urinish
   * (index.ts ko'pi bilan 30 s da bir marta bazaga boradi). Sozlanmagan bo'lsa null.
   */
  getDispatchSecret: (refresh: boolean) => Promise<string | null>
  /** `svc_claim_notifications(limit)` */
  claim: (limit: number) => Promise<OutboxRow[]>
  /**
   * `svc_outbox_recipients(outbox_id)` — kind'ga qarab (docs/automation-design.md,
   * "Bildirishnoma payloadlari"). Digest'da birinchi qator bo'yicha (guruh bir xil qabul qiluvchili).
   */
  recipients: (row: OutboxRow) => Promise<Recipient[]>
  sendMessage: (chatId: number, text: string, replyMarkup: unknown) => Promise<SendResult>
  /** `svc_complete_notification(...)` */
  complete: (id: string, args: CompleteArgs) => Promise<void>
  /** ms (Date.now) */
  now: () => number
  sleep: (ms: number) => Promise<void>
  log: LogFn
}

export interface DispatchSummary {
  processed: number
  sent: number
  failed: number
}

// ---------------------------------------------------------------------------
// Yordamchilar (sof)
// ---------------------------------------------------------------------------

const BOT_TOKEN_RE = /\d{5,}:[A-Za-z0-9_-]{20,}/g

/**
 * Xato matnini xavfsiz holatga keltiradi: bot tokeni (`123456:ABC…`), `bot<token>` URL
 * qismi va berilgan sirlar o'chiriladi; uzunlik 300 belgigacha.
 */
export function sanitizeError(message: string, secrets: readonly string[] = []): string {
  let s = message
  for (const secret of secrets) {
    if (secret.length >= 8) s = s.split(secret).join('***')
  }
  s = s.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot***').replace(BOT_TOKEN_RE, '***')
  return s.slice(0, 300)
}

/**
 * Telegram Bot API javobini tasniflaydi.
 * - 200 + ok → yuborildi;
 * - 429 → `parameters.retry_after` (soniya);
 * - 403 (bot bloklangan, akkaunt o'chirilgan, ...) va 400 "chat not found" → qabul qiluvchi
 *   o'tkazib yuboriladi (xato emas);
 * - 401, 404 → bot tokeni noto'g'ri (doimiy xato);
 * - qolganlari → xato (qayta urinish).
 */
export function classifyTelegramResponse(status: number, body: unknown): SendResult {
  const rec = isRecord(body) ? body : {}
  const description = typeof rec.description === 'string' ? rec.description.slice(0, 200) : ''
  if (status === 200 && rec.ok === true) return { ok: true }
  const error = `telegram ${status}${description ? ` ${description}` : ''}`
  if (status === 429) {
    const params = isRecord(rec.parameters) ? rec.parameters : {}
    const ra = params.retry_after
    const retryAfterSec =
      typeof ra === 'number' && Number.isFinite(ra) && ra > 0 ? Math.min(Math.ceil(ra), 3600) : DEFAULT_RETRY_AFTER_SEC
    return { ok: false, kind: 'rate_limited', retryAfterSec, error }
  }
  if (status === 403 || (status === 400 && /chat not found|user not found/i.test(description))) {
    return { ok: false, kind: 'unreachable', error }
  }
  if (status === 401 || status === 404) return { ok: false, kind: 'fatal', error }
  return { ok: false, kind: 'error', error }
}

export function resolveMiniAppUrl(url: string | undefined): string {
  return typeof url === 'string' && url.startsWith('https://') ? url : DEFAULT_MINI_APP_URL
}

/** Navbat qatoridan xabar matni. Yaroqsiz payload / noma'lum kind — xato (doimiy). */
export function buildMessage(row: OutboxRow): string {
  if (!isRecord(row.payload)) throw new Error('payload yaroqsiz')
  switch (row.kind) {
    case 'alert':
      return formatAlertMessage(row.payload as unknown as AlertPayload)
    case 'alert_reminder':
      return formatAlertReminder(row.payload as unknown as AlertReminderPayload)
    case 'daily_report':
      return formatDailyReport(row.payload as unknown as DailyReportPayload)
    case 'request_overdue':
      return formatRequestOverdue(row.payload as unknown as RequestOverduePayload)
    case 'cash_statement':
      return formatCashStatement(row.payload as unknown as CashStatementPayload)
    case 'bug_report':
      return formatBugReport(row.payload as unknown as BugReportPayload)
    default:
      throw new Error(`noma'lum kind: ${String(row.kind).slice(0, 40)}`)
  }
}

/** Bitta alert / eslatma qatorining alert id'si (tugmalar uchun), aks holda null. */
export function rowAlertId(row: OutboxRow): string | null {
  if (row.kind !== 'alert' && row.kind !== 'alert_reminder') return null
  if (!isRecord(row.payload)) return null
  return isUuid(row.payload.alert_id) ? row.payload.alert_id.toLowerCase() : null
}

/**
 * Qo'shimcha qabul qiluvchili alert (o'tkazma qabul qilinmadi — prorablarga ham boradi):
 * digest'ga qo'shilmaydi, aks holda prorab boshqa obyektlar alertlarini ko'rib qoladi.
 */
function hasExtraRecipients(row: OutboxRow): boolean {
  if (!isRecord(row.payload)) return false
  const d = isRecord(row.payload.details) ? row.payload.details : {}
  return row.payload.type === 'otkazma_farqi' && d.direction === 'not_received'
}

/** Digest'ga guruhlanadigan qator: alert yoki eslatma (qo'shimcha qabul qiluvchisiz). */
function digestible(row: OutboxRow): boolean {
  return (row.kind === 'alert' || row.kind === 'alert_reminder') && isRecord(row.payload) && !hasExtraRecipients(row)
}

/** Faqat admin / super_admin "Ko'rildi" bosa oladi (`svc_mark_alert_seen`). */
export const SEEN_ROLES: readonly string[] = ['admin', 'super_admin']

/**
 * Alertlarni RLS bo'yicha o'qiy oladigan rollar — "Ochish" `?alert=<id>` bilan. Qolganlar
 * (masalan prorab — o'tkazma qabul qilinmadi xabari) oddiy Mini App havolasini oladi.
 */
export const ALERT_READER_ROLES: readonly string[] = ['admin', 'super_admin', 'direktor']

function deliveredSet(row: OutboxRow): Set<number> {
  const out = new Set<number>()
  for (const v of row.delivered_chat_ids ?? []) {
    const n = Number(v)
    if (Number.isSafeInteger(n)) out.add(n)
  }
  return out
}

/** Bitta xabar → bir yoki bir nechta navbat qatori (digest). */
interface Unit {
  rows: OutboxRow[]
  companyId: string
  text: string
  /** Bitta alert / eslatma bo'lsa — "Ko'rildi" / "Ochish" tugmalari uchun. */
  alertId: string | null
}

/**
 * Qatorlarni xabarlarga ajratadi: bitta firmadan DIGEST_THRESHOLD dan ko'p alert —
 * bitta digest; qolganlari — har qator alohida. Tartib — navbat tartibi (birinchi qator).
 * Matni yasalmagan qatorlar `invalid` ga.
 */
export function planUnits(rows: OutboxRow[]): { units: Unit[]; invalid: { row: OutboxRow; error: string }[] } {
  const invalid: { row: OutboxRow; error: string }[] = []
  const groupKey = (row: OutboxRow) => `${row.company_id}|${row.kind}`
  const groups = new Map<string, OutboxRow[]>()
  for (const row of rows) {
    if (digestible(row)) {
      const list = groups.get(groupKey(row)) ?? []
      list.push(row)
      groups.set(groupKey(row), list)
    }
  }

  const units: Unit[] = []
  const digested = new Set<string>()
  for (const row of rows) {
    if (digested.has(row.id)) continue
    const group = digestible(row) ? groups.get(groupKey(row)) : undefined
    if (group !== undefined && group.length > DIGEST_THRESHOLD) {
      for (const r of group) digested.add(r.id)
      try {
        units.push({
          rows: group,
          companyId: row.company_id,
          text: formatAlertDigest(
            group.map((r) => r.payload as unknown as AlertPayload),
            { reminder: row.kind === 'alert_reminder' },
          ),
          alertId: null,
        })
      } catch (e) {
        for (const r of group) invalid.push({ row: r, error: `digest: ${errMessage(e)}` })
      }
      continue
    }
    try {
      units.push({ rows: [row], companyId: row.company_id, text: buildMessage(row), alertId: rowAlertId(row) })
    } catch (e) {
      invalid.push({ row, error: errMessage(e) })
    }
  }
  return { units, invalid }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

type Stop =
  | { kind: 'rate_limited'; retryAfterSec: number; error: string }
  | { kind: 'budget' }
  | { kind: 'fatal'; error: string }

/**
 * @param secretHeader `x-dispatch-secret` sarlavhasi
 */
export async function handleDispatch(secretHeader: string | null, deps: DispatchDeps): Promise<HandlerResult> {
  if (typeof secretHeader !== 'string' || secretHeader === '') {
    deps.log('warn', 'tg-dispatch: sir sarlavhasi yo\'q')
    return respond(401, { error: 'unauthorized' })
  }

  let expected: string | null
  try {
    expected = await deps.getDispatchSecret(false)
    if (typeof expected === 'string' && expected !== '' && !timingSafeEqual(secretHeader, expected)) {
      // Sir almashtirilgan bo'lishi mumkin — keshni yangilab, yana bir bor.
      expected = await deps.getDispatchSecret(true)
    }
  } catch (e) {
    deps.log('error', 'tg-dispatch: sir o\'qilmadi', { error: sanitizeError(errMessage(e)) })
    return respond(500, { error: 'server_error' })
  }
  if (typeof expected !== 'string' || expected === '') {
    deps.log('error', 'tg-dispatch: tg_dispatch_secret sozlanmagan')
    return respond(500, { error: 'server_misconfigured' })
  }
  if (!timingSafeEqual(secretHeader, expected)) {
    deps.log('warn', 'tg-dispatch: sir noto\'g\'ri')
    return respond(401, { error: 'unauthorized' })
  }
  const secrets = [expected]
  const clean = (e: unknown): string => sanitizeError(errMessage(e), secrets)

  let rows: OutboxRow[]
  try {
    rows = await deps.claim(CLAIM_LIMIT)
  } catch (e) {
    deps.log('error', 'tg-dispatch: navbat o\'qilmadi', { error: clean(e) })
    return respond(500, { error: 'server_error' })
  }

  const startedAt = deps.now()
  const appUrl = resolveMiniAppUrl(deps.env.miniAppUrl)
  const keyboard = miniAppKeyboard(appUrl)
  const bugKeyboard = bugReportKeyboard(appUrl)
  const keyboardFor = (unit: Unit, r: Recipient): unknown =>
    unit.rows[0]?.kind === 'bug_report'
      ? bugKeyboard
      : unit.alertId === null
      ? keyboard
      : alertKeyboard(appUrl, unit.alertId, SEEN_ROLES.includes(r.role), ALERT_READER_ROLES.includes(r.role))
  const summary: DispatchSummary = { processed: rows.length, sent: 0, failed: 0 }
  const lastSentAt = new Map<number, number>()
  let stop: Stop | null = null

  const finish = async (row: OutboxRow, args: CompleteArgs): Promise<void> => {
    if (args.ok) summary.sent++
    else summary.failed++
    const error = args.error === null ? null : sanitizeError(args.error, secrets)
    try {
      await deps.complete(row.id, { ...args, error })
    } catch (e) {
      // Qator 'sending' da qoladi — 10 daqiqadan keyin qayta olinadi.
      deps.log('error', 'tg-dispatch: natija yozilmadi', { id: row.id, error: clean(e) })
    }
  }

  const finishStopped = async (row: OutboxRow, s: Stop, delivered: number[], error: string | null): Promise<void> => {
    if (s.kind === 'rate_limited') {
      await finish(row, { ok: false, delivered, error: error ?? 'rate_limited', retryAfterSec: s.retryAfterSec })
    } else if (s.kind === 'budget') {
      await finish(row, { ok: false, delivered, error: error ?? 'time_budget', retryAfterSec: BUDGET_RETRY_SEC })
    } else {
      await finish(row, { ok: false, delivered, error: error ?? s.error, final: true })
    }
  }

  const { units, invalid } = planUnits(rows)
  for (const { row, error } of invalid) {
    deps.log('error', 'tg-dispatch: xabar yasalmadi (doimiy xato)', { id: row.id, kind: row.kind, error: clean(error) })
    await finish(row, { ok: false, delivered: [], error, final: true })
  }

  for (const unit of units) {
    if (stop === null && deps.now() - startedAt > TIME_BUDGET_MS) {
      stop = { kind: 'budget' }
      deps.log('warn', 'tg-dispatch: vaqt byudjeti tugadi, qolganlari keyinga')
    }
    if (stop !== null) {
      for (const row of unit.rows) await finishStopped(row, stop, [], null)
      continue
    }

    let recipients: Recipient[]
    try {
      recipients = await deps.recipients(unit.rows[0] as OutboxRow)
    } catch (e) {
      deps.log('error', 'tg-dispatch: qabul qiluvchilar o\'qilmadi', { company_id: unit.companyId, error: clean(e) })
      for (const row of unit.rows) await finish(row, { ok: false, delivered: [], error: clean(e) })
      continue
    }

    const rowSets = unit.rows.map(deliveredSet)
    // Digest: chat har bir qatorda yetkazilgan bo'lsagina o'tkaziladi.
    const todo = recipients.filter((r) => !rowSets.every((set) => set.has(r.chat_id)))
    const deliveredNow: number[] = []
    const unreachable = new Set<number>()
    const errors: string[] = []

    for (const r of todo) {
      const last = lastSentAt.get(r.chat_id)
      if (last !== undefined) {
        const wait = SAME_CHAT_GAP_MS - (deps.now() - last)
        if (wait > 0) await deps.sleep(wait)
      }
      let res: SendResult
      try {
        res = await deps.sendMessage(r.chat_id, unit.text, keyboardFor(unit, r))
      } catch (e) {
        res = { ok: false, kind: 'error', error: clean(e) }
      }
      lastSentAt.set(r.chat_id, deps.now())

      if (res.ok) {
        deliveredNow.push(r.chat_id)
        continue
      }
      if (res.kind === 'unreachable') {
        unreachable.add(r.chat_id)
        deps.log('info', 'tg-dispatch: qabul qiluvchiga yetib bo\'lmaydi (o\'tkazildi)', {
          profile_id: r.profile_id,
          error: sanitizeError(res.error, secrets),
        })
        continue
      }
      errors.push(`${r.profile_id}: ${res.error}`)
      if (res.kind === 'rate_limited') {
        stop = { kind: 'rate_limited', retryAfterSec: res.retryAfterSec, error: res.error }
        break
      }
      if (res.kind === 'fatal') {
        stop = { kind: 'fatal', error: res.error }
        deps.log('error', 'tg-dispatch: doimiy Telegram xatosi (bot tokeni?)', { error: sanitizeError(res.error, secrets) })
        break
      }
    }

    const errorText = errors.length > 0 ? errors.join('; ') : null
    if (errorText !== null) {
      deps.log('warn', 'tg-dispatch: yuborishda xato', {
        rows: unit.rows.length,
        delivered: deliveredNow.length,
        error: sanitizeError(errorText, secrets),
      })
    }

    for (const [i, row] of unit.rows.entries()) {
      const set = new Set([...(rowSets[i] ?? []), ...deliveredNow])
      const done = recipients.every((r) => set.has(r.chat_id) || unreachable.has(r.chat_id))
      if (done) {
        await finish(row, { ok: true, delivered: deliveredNow, error: null })
      } else if (stop !== null) {
        await finishStopped(row, stop, deliveredNow, errorText)
      } else {
        await finish(row, { ok: false, delivered: deliveredNow, error: errorText ?? 'not_delivered' })
      }
    }
  }

  if (summary.processed > 0) {
    deps.log('info', 'tg-dispatch: tugadi', { ...summary })
  }
  return respond(200, summary)
}
