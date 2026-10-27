// @vitest-environment node
// Xarajatlar (20261111): expense_on_your_name, xarajat_limiti, xarajat yozuvlari uchun alert shablonlari,
// kunlik hisobot va haftalik podotchet yangi kalitlari, bug_report (super_admin uchun firma nomi).
import { describe, expect, it } from 'vitest'
import {
  type AlertPayload,
  type BugReportPayload,
  type CashStatementPayload,
  type DailyReportPayload,
  formatAlertDigest,
  formatAlertMessage,
  formatBugReport,
  formatCashStatement,
  formatDailyReport,
  formatExpenseOnYourName,
} from './notifyMessages.ts'

const SOM = 'so‘m'
const WHEN = '29.10.2026 14:32'
const T = '2026-10-29T09:32:00Z'

/** Xarajat alerti: material yo'q, details.table = 'expenses'. */
function expenseAlert(type: string, details: Record<string, unknown>, over: Partial<AlertPayload> = {}): AlertPayload {
  return {
    alert_id: 'a1',
    type,
    severity: 'ogohlantirish',
    object_name: 'Obyekt A',
    material_name: null,
    base_unit: null,
    details: { table: 'expenses', record_id: 'e1', expense_id: 'e1', category_name: 'Oziq-ovqat', amount: 41000, ...details },
    created_at: T,
    ...over,
  }
}

describe('expense_on_your_name', () => {
  const base = {
    expense_id: 'e1', alert_id: 'a1', company_name: 'F', payer_id: 'p', payer_name: 'Sobir', actor_name: 'Admin',
    object_id: 'o', object_name: 'Obyekt A', category_id: 'c', category_name: 'Yoqilg‘i', amount: 350000,
    payment_source: 'podotchet', note: 'Benzin <AI-92>', spent_at: T,
  }
  it("to'liq matn", () => {
    expect(formatExpenseOnYourName(base)).toBe(
      `⚠️ <b>Sizning nomingizga xarajat kiritildi</b>\nXarajat: Yoqilg‘i · 350 000 ${SOM} · Obyekt A\n` +
        "Izoh: Benzin &lt;AI-92&gt;\nTo'lov: podotchet (qo'lingizdagi puldan)\nKiritdi: Admin\n" +
        WHEN +
        "\nAgar siz qilmagan bo'lsangiz — adminga ayting.",
    )
  })
  it('obyektsiz — "Umumiy", izohsiz', () => {
    const t = formatExpenseOnYourName({ ...base, object_name: null, note: null, payment_source: 'firma' })
    expect(t).toContain(`Xarajat: Yoqilg‘i · 350 000 ${SOM} · Umumiy`)
    expect(t).toContain("To'lov: firma hisobidan")
    expect(t).not.toContain('Izoh:')
  })
})

describe('xarajat_limiti', () => {
  it('limit, sarf, foiz, oshgan summa', () => {
    expect(
      formatAlertMessage(
        expenseAlert(
          'xarajat_limiti',
          {
            table: undefined, category_id: 'c', category_name: 'Oziq-ovqat', month: '2026-10', limit: 5000000,
            spent: '5200000.00', over: 200000, over_pct: 4, expense_count: 12, last_expense_id: 'e9',
          },
          { object_name: null },
        ),
      ),
    ).toBe(
      `💸 <b>Xarajat limiti oshdi</b>\nOziq-ovqat, 10.2026: 5 200 000 / 5 000 000 ${SOM} (+4 %)\nOshdi: 200 000 ${SOM} · 12 ta xarajat\n` +
        WHEN,
    )
  })
  it('details bo‘sh — xato yo‘q, umumiy sarlavha emas', () => {
    const t = formatAlertMessage(expenseAlert('xarajat_limiti', { table: undefined, category_name: null }, { object_name: null }))
    expect(t).toContain('💸 <b>Xarajat limiti oshdi</b>')
  })
})

describe('xarajat yozuvlari uchun mavjud alertlar', () => {
  it('xarid_boshqa_nomidan — to‘lovchi (payer_*), sana spent_at, "Xarajat:" qatori', () => {
    expect(
      formatAlertMessage(
        expenseAlert('xarid_boshqa_nomidan', {
          payer_name: 'Sobir', buyer_name: 'Sobir (alias)', actor_name: 'Admin', amount: 350000,
          category_name: 'Yoqilg‘i', spent_at: '2026-10-29T05:00:00Z', payment_source: 'firma', via: 'insert',
        }),
      ),
    ).toBe(
      `👤 <b>Boshqa odam nomidan xarid</b>\nXarajat: Yoqilg‘i · 350 000 ${SOM} · Obyekt A\nTo'lovchi: Sobir · kiritdi: Admin\n` +
        "To'lov: firma hisobidan\nSana: 29.10.2026 10:00\n" +
        WHEN,
    )
  })
  it('xarid_boshqa_nomidan — payer_name yo‘q bo‘lsa buyer_name', () => {
    expect(formatAlertMessage(expenseAlert('xarid_boshqa_nomidan', { buyer_name: 'Vali', actor_name: 'A' }))).toContain("To'lovchi: Vali")
  })
  it('chek_farqi', () => {
    const t = formatAlertMessage(
      expenseAlert('chek_farqi', { receipt_total: 40000, total_amount: 41000, diff: 1000, receipt_fiscal_sign: '123' }),
    )
    expect(t).toContain(`Xarajat: Oziq-ovqat · 41 000 ${SOM} · Obyekt A\nChek: 40 000 ${SOM}, kiritilgan: 41 000 ${SOM} (+1 000 ${SOM})`)
    expect(t).not.toContain('null')
  })
  it('sotuvchi_stir_farqi', () => {
    const t = formatAlertMessage(
      expenseAlert('sotuvchi_stir_farqi', { seller_tin: '301234567', supplier_name: 'Baraka', supplier_tin: null }, { severity: 'belgi' }),
    )
    expect(t).toContain(`Xarajat: Oziq-ovqat · 41 000 ${SOM} · Obyekt A\nChekda STIR: 301234567`)
  })
  it('takroriy_yozuv (record) — jadval "Xarajat", obyektsiz — Umumiy', () => {
    const t = formatAlertMessage(
      expenseAlert('takroriy_yozuv', { kind: 'record', category_id: 'c', window_minutes: 10, total_amount: null }, { severity: 'belgi', object_name: null }),
    )
    expect(t).toContain(`Xarajat: Oziq-ovqat · 41 000 ${SOM} · Umumiy\n10 daqiqa ichida xuddi shunday yozuv kiritildi (Xarajat)`)
  })
  it('yozuv_ozgartirildi — sarlavha, summa / tur / sana / to‘lov manbai / STIR o‘zgarishi', () => {
    const t = formatAlertMessage(
      expenseAlert('yozuv_ozgartirildi', {
        changed: ['amount', 'category_id', 'payment_source', 'seller_tin', 'spent_at'],
        before: { amount: 41000, payment_source: 'podotchet', seller_tin: '301234567', spent_at: '2026-10-28T05:00:00Z' },
        after: { amount: '45000.00', payment_source: 'firma', seller_tin: '309999999', spent_at: '2026-10-27T05:00:00Z' },
        via: 'direct', actor_name: 'Admin', author_name: 'Sobir', payer_name: 'Sobir', spent_at: '2026-10-27T05:00:00Z',
      }),
    )
    expect(t).toBe(
      `✏️ <b>Xarajat o'zgartirildi</b>\nXarajat: Oziq-ovqat · 41 000 ${SOM} · Obyekt A\n` +
        `• Summa: 41 000 ${SOM} → 45 000 ${SOM}\n• Xarajat turi o'zgardi\n` +
        "• To'lov manbai: podotchet (qo'lingizdagi puldan) → firma hisobidan\n• Sotuvchi STIR: 301234567 → 309999999\n" +
        '• Sana: 28.10.2026 10:00 → 27.10.2026 10:00\n' +
        "O'zgartirdi: Admin (muallif: Sobir)\n" +
        WHEN,
    )
  })
  it('yozuv_tuzatildi cancel_own_entry — summa takrorlanmaydi', () => {
    const t = formatAlertMessage(
      expenseAlert('yozuv_tuzatildi', { via: 'cancel_own_entry', changed: ['deleted_at'], reason: 'Xato', actor_name: 'Sobir' }, { severity: 'belgi' }),
    )
    expect(t).toBe(`✏️ <b>Muallif yozuvni bekor qildi</b>\nXarajat: Oziq-ovqat · 41 000 ${SOM} · Obyekt A\nSabab: Xato\nBekor qildi: Sobir\n` + WHEN)
  })
  it("yozuv_ochirildi / yozuv_tiklandi — sarlavha, obyekt bir marta", () => {
    const del = formatAlertMessage(expenseAlert('yozuv_ochirildi', { actor_name: 'Admin' }))
    expect(del).toBe(`🗑 <b>Xarajat o'chirildi</b>\nXarajat: Oziq-ovqat · 41 000 ${SOM} · Obyekt A\nO'chirdi: Admin\n` + WHEN)
    const res = formatAlertMessage(expenseAlert('yozuv_tiklandi', { actor_name: 'Admin', spent_at: '2026-10-20T05:00:00Z', days_since: 2 }))
    expect(res).toContain('♻️ <b>Xarajat tiklandi</b>')
    expect(res).toContain("Yozuv sanasi: 20.10.2026 (o'chirilganiga 2 kun)")
    expect(res.match(/Obyekt A/g)).toHaveLength(1)
  })
  it('digest — xarajat konteksti', () => {
    const t = formatAlertDigest([expenseAlert('yozuv_ochirildi', {}), expenseAlert('chek_farqi', {})])
    expect(t).toContain(`🗑 Xarajat o'chirildi: Xarajat: Oziq-ovqat · 41 000 ${SOM} · Obyekt A`)
  })
})

describe('kunlik hisobot va haftalik podotchet', () => {
  const report = (over: Partial<DailyReportPayload>): DailyReportPayload => ({
    date: '2026-10-29', period_start: '2026-10-28T15:00:00Z', period_end: '2026-10-29T15:00:00Z',
    company_name: 'F', kirim_count: 0, chiqim_count: 0, purchases_count: 0, purchases_sum: '0', requests_count: 0,
    alerts_new: 0, alerts_by_type: {}, self_received_count: 0, deleted_count: 0, restored_count: 0, failed_count: 0,
    transfers_pending_count: 0, chiqim_without_estimate_count: 0, ...over,
  })
  it('xarajatlar soni / summasi / limit alertlari', () => {
    const t = formatDailyReport(report({ expenses_count: 4, expenses_sum: '1250000.00', expense_limit_alerts: 1 }))
    expect(t).toContain(`Xaridlar: 0 ta, 0 ${SOM}\nXarajatlar: 4 ta, 1 250 000 ${SOM}\n💸 Limiti oshgan xarajat turlari: 1`)
  })
  it('0 / yo‘q — chiqmaydi', () => {
    const t = formatDailyReport(report({ expenses_count: 0, expenses_sum: '0.00', expense_limit_alerts: 0 }))
    expect(t).not.toContain('Xarajatlar')
    expect(t).not.toContain('Limiti oshgan')
  })

  const cash: CashStatementPayload = {
    date: '2026-11-09', period_start: '2026-11-02', period_end: '2026-11-08', company_name: 'F', profile_id: 'p',
    profile_name: 'Vali', issued_week: '1000000.00', spent_week: '400000.00', returned_week: '0.00', balance: '600000.00',
    oldest_open_date: null, days_open: null,
  }
  it('cash_statement: expenses_week > 0 — sarf ichida qator', () => {
    expect(formatCashStatement({ ...cash, expenses_week: '150000.00' })).toContain(
      `Sarflandi: 400 000 ${SOM}\nXarajatlar (sarf ichida): 150 000 ${SOM}\nQaytarildi`,
    )
  })
  it('cash_statement: 0 / yo‘q — chiqmaydi', () => {
    expect(formatCashStatement({ ...cash, expenses_week: '0.00' })).not.toContain('Xarajatlar')
    expect(formatCashStatement(cash)).not.toContain('Xarajatlar')
  })
})

describe('bug_report — super_admin uchun firma nomi', () => {
  it('firma nomi doim ko‘rinadi', () => {
    const p: BugReportPayload = {
      bug_report_id: 'b', company_id: 'c', company_name: 'Demo qurilish', reporter_id: 'r', reporter_name: 'Ali',
      reporter_role: 'prorab', screen: '/tg', message: 'x', message_truncated: false, client: null, app_version: null,
      has_photo: false, created_at: T,
    }
    expect(formatBugReport(p)).toContain('\nFirma: Demo qurilish\n')
  })
})
