// @vitest-environment node
// Batch 12 shablonlari: 9 ta yangi alert turi, eslatma, muddati o'tgan so'rovlar,
// haftalik podotchet, kunlik hisobot yangi qatorlari, "Ko'rildi" / "Ochish" tugmalari.
import { describe, expect, it } from 'vitest'
import {
  type AlertPayload,
  type BugReportPayload,
  bugReportKeyboard,
  formatBugReport,
  webBugsUrl,
  type CashStatementPayload,
  type DailyReportPayload,
  type RequestOverduePayload,
  SEEN_CALLBACK_PREFIX,
  TELEGRAM_MAX_LENGTH,
  alertKeyboard,
  alertOpenUrl,
  formatAlertDigest,
  formatAlertMessage,
  formatAlertReminder,
  formatCashStatement,
  formatDailyReport,
  formatRequestOverdue,
} from './notifyMessages.ts'

const SOM = 'so‘m'
const ID = '11111111-2222-3333-4444-555555555555'

function alert(type: string, details: Record<string, unknown>, over: Partial<AlertPayload> = {}): AlertPayload {
  return {
    alert_id: ID,
    type,
    severity: 'ogohlantirish',
    object_name: 'Obyekt A',
    material_name: 'Sement M400',
    base_unit: 'kg',
    details,
    created_at: '2026-10-29T09:32:00Z',
    ...over,
  }
}

describe('kirim_manbasiz', () => {
  it('open_purchase', () => {
    expect(
      formatAlertMessage(
        alert('kirim_manbasiz', { reason: 'open_purchase', qty_base: 1000, base_unit: 'kg', occurred_at: '2026-10-29T08:00:00Z', open_purchase_ids: ['x'] }, { severity: 'belgi' }),
      ),
    ).toBe(
      "❓ <b>Kirim manbasiz</b>\nSement M400 · Obyekt A\nOchiq xarid bor edi, lekin kirim unga bog'lanmagan\nMiqdor: 1 000 kg\nSana: 29.10.2026 13:00\n29.10.2026 14:32",
    )
  })
  it('no_source va unlinked_candidate', () => {
    expect(formatAlertMessage(alert('kirim_manbasiz', { reason: 'no_source', qty_base: 5.5 }))).toContain(
      "Oxirgi 7 kunda bu material uchun xarid yoki o'tkazma yo'q\nMiqdor: 5,5 kg",
    )
    expect(formatAlertMessage(alert('kirim_manbasiz', { reason: 'unlinked_candidate' }))).toContain('farqini yopadi')
  })
  it('noma\'lum reason / bo\'sh details — sarlavha va kontekst', () => {
    expect(formatAlertMessage(alert('kirim_manbasiz', { reason: 'boshqa' }))).toBe(
      '❓ <b>Kirim manbasiz</b>\nSement M400 · Obyekt A\n29.10.2026 14:32',
    )
  })
})

describe('manfiy_qoldiq', () => {
  it('chiqim', () => {
    expect(
      formatAlertMessage(alert('manfiy_qoldiq', { stock_after: -50.5, qty_base: 200, unit: 'kg', movement_type: 'chiqim' })),
    ).toBe('➖ <b>Manfiy qoldiq</b>\nSement M400 · Obyekt A\nQoldiq: −50,5 kg\nOxirgi chiqim: 200 kg\n29.10.2026 14:32')
  })
  it('transfer_out, details.unit ustun', () => {
    const t = formatAlertMessage(
      alert('manfiy_qoldiq', { stock_after: '-3', qty_base: '10', unit: 'm³', movement_type: 'transfer_out' }, { base_unit: 'kg' }),
    )
    expect(t).toContain("Qoldiq: −3 m³\nOxirgi o'tkazma: 10 m³")
  })
})

describe('takroriy_yozuv', () => {
  it('record (xarid)', () => {
    expect(
      formatAlertMessage(
        alert('takroriy_yozuv', { kind: 'record', table: 'purchases', record_id: 'r', first_id: 'f', window_minutes: 10, qty_base: 100, total_amount: 1250000 }, { severity: 'belgi' }),
      ),
    ).toBe(
      `🔁 <b>Takroriy yozuv</b>\nSement M400 · Obyekt A\n10 daqiqa ichida xuddi shunday yozuv kiritildi (Xarid)\nMiqdor: 100 kg · Summa: 1 250 000 ${SOM}\n29.10.2026 14:32`,
    )
  })
  it('record (harakat, summasiz, oynasiz)', () => {
    const t = formatAlertMessage(alert('takroriy_yozuv', { kind: 'record', table: 'movements', qty_base: 5, total_amount: null }))
    expect(t).toContain('Qisqa vaqt ichida xuddi shunday yozuv kiritildi (Ombor harakati)\nMiqdor: 5 kg\n')
  })
  it('photo', () => {
    expect(
      formatAlertMessage(alert('takroriy_yozuv', { kind: 'photo', table: 'purchases', first_table: 'movements', sha256: 'ab' })),
    ).toBe(
      '🖼 <b>Bir xil rasm qayta ishlatildi</b>\nSement M400 · Obyekt A\nBu rasm boshqa yozuvda ham ishlatilgan (Xarid → Ombor harakati)\n29.10.2026 14:32',
    )
  })
})

describe('joylashuv_farqi', () => {
  it('masofa, radius, aniqlik', () => {
    expect(
      formatAlertMessage(alert('joylashuv_farqi', { distance_m: 850, radius_m: 300, accuracy_m: 25, movement_type: 'kirim' }, { severity: 'belgi' })),
    ).toBe('📍 <b>Joylashuv farqi</b>\nSement M400 · Obyekt A\nKirim · Obyektdan 850 m uzoqda (ruxsat 300 m, aniqlik ±25 m)\n29.10.2026 14:32')
  })
  it('aniqlik null, masofa 1 200', () => {
    expect(formatAlertMessage(alert('joylashuv_farqi', { distance_m: 1200, radius_m: 300, accuracy_m: null, movement_type: 'chiqim' }))).toContain(
      'Chiqim · Obyektdan 1 200 m uzoqda (ruxsat 300 m)',
    )
  })
})

describe('smetasiz_chiqim', () => {
  it('materiallar ro\'yxati', () => {
    expect(
      formatAlertMessage(
        alert(
          'smetasiz_chiqim',
          {
            day: '2026-10-29',
            count: 3,
            materials: [
              { material_id: 'm1', material_name: 'Qum', qty_base: 2.5, base_unit: 'm³' },
              { material_id: 'm2', material_name: 'Sement <M500>', qty_base: 400, base_unit: 'kg' },
            ],
          },
          { material_name: null },
        ),
      ),
    ).toBe(
      "📋 <b>Smetasiz chiqim</b>\nObyekt A\n3 ta chiqim, obyektda joriy smeta yo'q\nSana: 29.10.2026\n• Qum: 2,5 m³\n• Sement &lt;M500&gt;: 400 kg\n29.10.2026 14:32",
    )
  })
  it('10 tadan ko\'p material — "… va yana N ta"', () => {
    const materials = Array.from({ length: 13 }, (_, i) => ({ material_name: `M${i}`, qty_base: 1, base_unit: 'kg' }))
    const t = formatAlertMessage(alert('smetasiz_chiqim', { day: '2026-10-29', count: 13, materials }))
    expect(t).toContain('• M9: 1 kg\n… va yana 3 ta')
    expect(t).not.toContain('M10')
  })
  it('juda uzun ro\'yxat ham 4096 ga sig\'adi', () => {
    const materials = Array.from({ length: 10 }, () => ({ material_name: 'X'.repeat(500), qty_base: 1 }))
    expect(formatAlertMessage(alert('smetasiz_chiqim', { count: 10, materials })).length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH)
  })
})

describe('chek_farqi', () => {
  it('kiritilgan chekdan ko\'p', () => {
    expect(
      formatAlertMessage(alert('chek_farqi', { receipt_total: 1450000, total_amount: 1500000, diff: 50000, receipt_fiscal_sign: '248429044289', receipt_verified: true })),
    ).toBe(
      `🧾 <b>Chek summasi farq qiladi</b>\nSement M400 · Obyekt A\nChek: 1 450 000 ${SOM}, kiritilgan: 1 500 000 ${SOM} (+50 000 ${SOM})\nFiskal belgi: 248429044289\n29.10.2026 14:32`,
    )
  })
  it('kiritilgan kam (manfiy farq), kasr', () => {
    expect(formatAlertMessage(alert('chek_farqi', { receipt_total: '1000.50', total_amount: '990', diff: '-10.5' }))).toContain(
      `Chek: 1 000,5 ${SOM}, kiritilgan: 990 ${SOM} (−10,5 ${SOM})`,
    )
  })
})

describe('sorovdan_ortiq_xarid', () => {
  it('foiz, chegara, xaridlar soni', () => {
    expect(
      formatAlertMessage(
        alert('sorovdan_ortiq_xarid', { request_qty_base: 100, purchased_qty_base: 130, over_pct: 30, threshold_pct: 20, base_unit: 'kg', purchase_count: 2 }, { severity: 'belgi' }),
      ),
    ).toBe(
      "🛒 <b>So'rovdan ortiq xarid</b>\nSement M400 · Obyekt A\nSo'raldi: 100 kg, xarid: 130 kg (+30 %) · 2 ta xarid\nChegara: 20 %\n29.10.2026 14:32",
    )
  })
  it('bitta xarid — soni ko\'rsatilmaydi', () => {
    const t = formatAlertMessage(alert('sorovdan_ortiq_xarid', { request_qty_base: 10, purchased_qty_base: 12.5, over_pct: 25, purchase_count: 1 }))
    expect(t).toContain("So'raldi: 10 kg, xarid: 12,5 kg (+25 %)\n")
    expect(t).not.toContain('ta xarid')
  })
})

describe('podotchet', () => {
  it('podotchet_muddati', () => {
    expect(
      formatAlertMessage(
        alert(
          'podotchet_muddati',
          { profile_id: 'p', profile_name: 'Ali <Valiyev>', balance: 700000, oldest_open_at: '2026-10-09T05:00:00Z', days_open: 20, max_days: 14 },
          { object_name: null, material_name: null, base_unit: null },
        ),
      ),
    ).toBe(
      `💵 <b>Podotchet muddati o'tdi</b>\nKimda: Ali &lt;Valiyev&gt;\nQo'lida: 700 000 ${SOM}\n20 kundan beri (chegara 14 kun)\nEng eski qoldiq: 09.10.2026\n29.10.2026 14:32`,
    )
  })
  it('podotchet_manfiy', () => {
    expect(
      formatAlertMessage(
        alert('podotchet_manfiy', { profile_id: 'p', profile_name: 'Ali', balance: -50000 }, { severity: 'belgi', object_name: null, material_name: null }),
      ),
    ).toBe(
      `💵 <b>Podotchet manfiy</b>\nKimda: Ali\nBalans: −50 000 ${SOM}\nSarf berilgan puldan ko'p — pul berish kiritilmagan bo'lishi mumkin\n29.10.2026 14:32`,
    )
  })
})

describe('yangi turlar — umumiy', () => {
  const TYPES = [
    'kirim_manbasiz', 'manfiy_qoldiq', 'takroriy_yozuv', 'joylashuv_farqi', 'smetasiz_chiqim',
    'chek_farqi', 'sorovdan_ortiq_xarid', 'podotchet_muddati', 'podotchet_manfiy',
  ]
  it.each(TYPES)('%s: details bo\'sh / yaroqsiz — xato yo\'q, umumiy sarlavha emas', (type) => {
    for (const details of [{}, { qty_base: 'abc', materials: 'x', distance_m: null }, null as unknown as Record<string, unknown>]) {
      const t = formatAlertMessage(alert(type, details))
      expect(t).not.toContain('Yangi ogohlantirish')
      expect(t.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH)
    }
  })
  it('digest: qisqa nomlar va podotchet konteksti', () => {
    const t = formatAlertDigest([
      alert('manfiy_qoldiq', {}),
      alert('chek_farqi', {}),
      alert('podotchet_muddati', { profile_name: 'Ali' }, { object_name: null, material_name: null }),
    ])
    expect(t).toContain('manfiy qoldiq — 1, chek — 1, podotchet muddati — 1')
    expect(t).toContain("💵 Podotchet muddati o'tdi: Ali")
  })
  it('digest (eslatma) sarlavhasi', () => {
    expect(formatAlertDigest([alert('chek_farqi', {})], { reminder: true })).toMatch(/^⏰ <b>1 ta ko'rilmagan ogohlantirish \(eslatma\)<\/b>/)
  })
})

describe('formatAlertReminder', () => {
  it('soat bilan + asl xabar', () => {
    const p = { ...alert('manfiy_qoldiq', { stock_after: -5, qty_base: 5, unit: 'kg' }), hours_open: 49, reminded_at: '2026-10-31T10:00:00Z' }
    expect(formatAlertReminder(p)).toBe(`⏰ <i>Eslatma · 49 soatdan beri ko'rilmagan</i>\n${formatAlertMessage(p)}`)
  })
  it('soat yo\'q', () => {
    expect(formatAlertReminder({ ...alert('chek_farqi', {}), hours_open: null })).toMatch(/^⏰ <i>Eslatma · hali ko'rilmagan<\/i>\n🧾/)
  })
  it('4096 ga sig\'adi', () => {
    const materials = Array.from({ length: 10 }, () => ({ material_name: 'Y'.repeat(400), qty_base: 1 }))
    const t = formatAlertReminder({ ...alert('smetasiz_chiqim', { materials, count: 10 }), hours_open: 50 })
    expect(t.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH)
    expect(t.startsWith('⏰')).toBe(true)
  })
})

describe('formatRequestOverdue', () => {
  const base: RequestOverduePayload = {
    date: '2026-11-06',
    company_name: 'Namuna & Co',
    count: 2,
    requests: [
      {
        request_id: 'q1', object_name: 'Obyekt A', material_name: 'Sement', qty_input: 2.5, unit_input: 'qop',
        qty_base: 125, base_unit: 'kg', needed_by: '2026-11-04', days_overdue: 2, created_by_name: 'Ali',
      },
      {
        request_id: 'q2', object_name: 'Obyekt B', material_name: 'Qum', qty_input: 3, unit_input: 'm³',
        qty_base: 3, base_unit: 'm³', needed_by: '2026-11-05', days_overdue: 1, created_by_name: null,
      },
    ],
  }
  it('ro\'yxat', () => {
    expect(formatRequestOverdue(base)).toBe(
      "⏰ <b>Muddati o'tgan so'rovlar · 06.11.2026</b>\nNamuna &amp; Co\n2 ta tasdiqlangan so'rov hali xarid qilinmagan:\n" +
        "• Sement — 2,5 qop (125 kg) · Obyekt A · muddat 04.11.2026 (2 kun o'tdi) · Ali\n" +
        "• Qum — 3 m³ · Obyekt B · muddat 05.11.2026 (1 kun o'tdi)",
    )
  })
  it('count > ko\'rsatilgan → "… va yana N ta"', () => {
    expect(formatRequestOverdue({ ...base, count: 25 })).toContain('25 ta tasdiqlangan')
    expect(formatRequestOverdue({ ...base, count: 25 })).toMatch(/… va yana 23 ta$/)
  })
  it('juda uzun — 4096 ga sig\'adi, qolgani qayta hisoblanadi', () => {
    // nomlar 120 belgigacha qisqartiriladi — uchta uzun nom bilan har qator ~400 belgi
    const long = 'Z'.repeat(300)
    const requests = Array.from({ length: 20 }, (_, i) => ({
      ...base.requests[0]!,
      request_id: `q${i}`,
      material_name: long,
      object_name: long,
      created_by_name: long,
    }))
    const t = formatRequestOverdue({ ...base, count: 20, requests })
    expect(t.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH)
    expect(t).toMatch(/… va yana \d+ ta$/)
  })
  it('yaroqsiz requests — xato yo\'q', () => {
    expect(() => formatRequestOverdue({ ...base, requests: null as unknown as [] })).not.toThrow()
  })
})

describe('formatCashStatement', () => {
  const base: CashStatementPayload = {
    date: '2026-11-09', period_start: '2026-11-02', period_end: '2026-11-08', company_name: 'Firma',
    profile_id: 'p', profile_name: 'Vali', issued_week: '1000000.00', spent_week: '350000.00', returned_week: '0.00',
    issued_total: '5000000.00', returned_total: '100000.00', spent_total: '4200000.00',
    balance: '700000.00', oldest_open_date: '2026-10-20', days_open: 20,
  }
  it('musbat balans', () => {
    expect(formatCashStatement(base)).toBe(
      `💵 <b>Podotchet hisoboti · 02.11.2026 – 08.11.2026</b>\nVali\nFirma\nShu hafta:\nBerildi: 1 000 000 ${SOM}\nSarflandi: 350 000 ${SOM}\nQaytarildi: 0 ${SOM}\nQo'lingizda: <b>700 000 ${SOM}</b>\nEng eski qoldiq: 20.10.2026 (20 kun)`,
    )
  })
  it('manfiy balans — ortiqcha sarf, eng eski qoldiq yo\'q', () => {
    const t = formatCashStatement({ ...base, balance: '-50000.00', oldest_open_date: null, days_open: null })
    expect(t).toContain(`Ortiqcha sarf (sizga qaytarilishi kerak): 50 000 ${SOM}`)
    expect(t).not.toContain('Eng eski')
  })
  it('null qiymatlar → 0', () => {
    const t = formatCashStatement({ ...base, issued_week: null, spent_week: null, returned_week: null, balance: null })
    expect(t).toContain(`Berildi: 0 ${SOM}`)
    expect(t).toContain(`Qo'lingizda: <b>0 ${SOM}</b>`)
  })
})

describe('formatDailyReport — Batch 12', () => {
  const report = (over: Partial<DailyReportPayload>): DailyReportPayload => ({
    date: '2026-10-29', period_start: '2026-10-28T15:00:00Z', period_end: '2026-10-29T15:00:00Z',
    company_name: 'F', kirim_count: 0, chiqim_count: 0, purchases_count: 0, purchases_sum: '0', requests_count: 0,
    alerts_new: 0, alerts_by_type: {}, self_received_count: 0, deleted_count: 0, restored_count: 0, failed_count: 0,
    transfers_pending_count: 0, chiqim_without_estimate_count: 0, ...over,
  })
  it('low_stock_count, geo_denied_count, geo_unavailable_count > 0 — qatorlar (yonma-yon)', () => {
    const t = formatDailyReport(
      report({ low_stock_count: 4, geo_denied_count: 2, geo_unavailable_count: 5, alerts_by_type: { chek_farqi: 1, manfiy_qoldiq: 2 } }),
    )
    expect(t).toContain('📉 Tugayotgan materiallar: 4')
    expect(t).toContain('Joylashuvga ruxsat berilmagan: 2\nJoylashuvsiz yozuvlar: 5')
    expect(t).toContain('manfiy qoldiq — 2, chek — 1')
  })
  it('faqat geo_unavailable_count', () => {
    const t = formatDailyReport(report({ geo_unavailable_count: 1 }))
    expect(t).toContain('Joylashuvsiz yozuvlar: 1')
    expect(t).not.toContain('ruxsat berilmagan')
  })
  it('0 / yo\'q — qatorlar chiqmaydi (eski payload ham ishlaydi)', () => {
    const t = formatDailyReport(report({ low_stock_count: 0, geo_denied_count: 0, geo_unavailable_count: 0 }))
    expect(t).not.toContain('Tugayotgan')
    expect(t).not.toContain('Joylashuv')
  })
})

describe('tugmalar', () => {
  it('admin: Ko\'rildi + Ochish (alert havolasi)', () => {
    expect(alertKeyboard('https://app.example.uz/tg', ID, true)).toEqual({
      inline_keyboard: [
        [
          { text: "✓ Ko'rildi", callback_data: `al:seen:${ID}` },
          { text: 'Ochish', web_app: { url: `https://app.example.uz/tg?alert=${ID}` } },
        ],
      ],
    })
    expect(new TextEncoder().encode(`${SEEN_CALLBACK_PREFIX}${ID}`).length).toBeLessThanOrEqual(64)
  })
  it('deepLink = false (prorab): Ochish oddiy havola', () => {
    expect(alertKeyboard('https://app.example.uz/tg', ID, false, false)).toEqual({
      inline_keyboard: [[{ text: 'Ochish', web_app: { url: 'https://app.example.uz/tg' } }]],
    })
  })
  it('boshqalar: faqat Ochish', () => {
    expect(alertKeyboard('https://app.example.uz/tg', ID, false).inline_keyboard).toEqual([
      [{ text: 'Ochish', web_app: { url: `https://app.example.uz/tg?alert=${ID}` } }],
    ])
  })
  it('alertOpenUrl mavjud query bilan; noto\'g\'ri URL — o\'zgarmaydi', () => {
    expect(alertOpenUrl('https://a.uz/tg?x=1', ID)).toBe(`https://a.uz/tg?x=1&alert=${ID}`)
    expect(alertOpenUrl('not a url', ID)).toBe('not a url')
  })
})

describe('formatBugReport (Batch 11)', () => {
  const bug = (over: Partial<BugReportPayload> = {}): BugReportPayload => ({
    bug_report_id: 'b1',
    company_id: 'c1',
    company_name: 'Demo qurilish',
    reporter_id: 'p1',
    reporter_name: 'Sherzod Aliyev',
    reporter_role: 'prorab',
    screen: '/tg/movement',
    message: 'Saqlash tugmasi <ishlamayapti> & qotib qoldi',
    message_truncated: false,
    client: 'tg 8.0 · android',
    app_version: '0.11.0',
    has_photo: true,
    created_at: '2026-10-29T09:32:00Z',
    ...over,
  })
  it("to'liq xabar", () => {
    expect(formatBugReport(bug())).toBe(
      '🐞 <b>Xatolik haqida xabar</b>\nSherzod Aliyev · Prorab\nFirma: Demo qurilish\nEkran: /tg/movement\n' +
        '<blockquote>Saqlash tugmasi &lt;ishlamayapti&gt; &amp; qotib qoldi</blockquote>\n' +
        "<i>tg 8.0 · android · v0.11.0</i>\n📎 Rasm ilova qilingan — veb panelda ko'ring\n29.10.2026 14:32",
    )
  })
  it('kesilgan — "…", rasmsiz, rol tarjimasi (super_admin, taminotchi)', () => {
    const t = formatBugReport(bug({ message_truncated: true, has_photo: false, reporter_role: 'taminotchi' }))
    expect(t).toContain('qotib qoldi…</blockquote>')
    expect(t).toContain('Sherzod Aliyev · Ta’minotchi')
    expect(t).not.toContain('Rasm ilova')
    expect(formatBugReport(bug({ reporter_role: 'super_admin' }))).toContain('· Tizim egasi')
  })
  it("null maydonlar — noma'lum foydalanuvchi, matn yo'q, qurilma qatori yo'q", () => {
    const t = formatBugReport(
      bug({ reporter_name: null, reporter_role: null, company_name: null, screen: null, message: null, client: null, app_version: null, has_photo: null }),
    )
    expect(t).toBe("🐞 <b>Xatolik haqida xabar</b>\nNoma'lum foydalanuvchi\n<i>(matn yo‘q)</i>\n29.10.2026 14:32")
  })
  it("noma'lum rol escape qilinadi; nomlar va ekran escape", () => {
    const t = formatBugReport(bug({ reporter_role: '<x>', reporter_name: 'A<b>', screen: '/tg?a=1&b=2' }))
    expect(t).toContain('A&lt;b&gt; · &lt;x&gt;')
    expect(t).toContain('Ekran: /tg?a=1&amp;b=2')
  })
  it("juda uzun matn (himoya) — 1000 belgigacha, '…', 4096 ga sig'adi", () => {
    const t = formatBugReport(bug({ message: 'x'.repeat(5000) }))
    expect(t).toContain(`${'x'.repeat(1000)}…</blockquote>`)
    expect(t.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH)
  })
  it('webBugsUrl va tugma (url, web_app emas)', () => {
    expect(webBugsUrl('https://app.example.uz/tg')).toBe('https://app.example.uz/settings?tab=bugs')
    expect(webBugsUrl('https://app.example.uz/tg/')).toBe('https://app.example.uz/settings?tab=bugs')
    expect(webBugsUrl('https://x.uz/app/tg')).toBe('https://x.uz/app/settings?tab=bugs')
    expect(webBugsUrl('https://x.uz')).toBe('https://x.uz/settings?tab=bugs')
    expect(bugReportKeyboard('https://app.example.uz/tg')).toEqual({
      inline_keyboard: [[{ text: 'Ochish', url: 'https://app.example.uz/settings?tab=bugs' }]],
    })
  })
})
