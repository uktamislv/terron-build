// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  type AlertPayload,
  type DailyReportPayload,
  TELEGRAM_MAX_LENGTH,
  escapeHtml,
  formatAlertDigest,
  formatAlertMessage,
  formatDailyReport,
  formatDateIso,
  formatDateTimeTashkent,
  formatDecimal,
  formatPeriod,
  miniAppKeyboard,
  toDecString,
} from './notifyMessages.ts'

const SOM = 'so‘m'

function alert(over: Partial<AlertPayload> = {}): AlertPayload {
  return {
    alert_id: 'a1',
    type: 'narx_ogishi',
    severity: 'ogohlantirish',
    object_name: 'Obyekt A',
    material_name: 'Sement M400',
    base_unit: 'kg',
    details: {},
    created_at: '2026-10-29T09:32:00Z',
    ...over,
  }
}

function report(over: Partial<DailyReportPayload> = {}): DailyReportPayload {
  return {
    date: '2026-10-29',
    period_start: '2026-10-28T15:00:00Z',
    period_end: '2026-10-29T15:00:00Z',
    company_name: 'Namuna Qurilish',
    kirim_count: 0,
    chiqim_count: 0,
    purchases_count: 0,
    purchases_sum: '0',
    requests_count: 0,
    alerts_new: 0,
    alerts_by_type: {},
    self_received_count: 0,
    deleted_count: 0,
    failed_count: 0,
    ...over,
  }
}

describe('escapeHtml', () => {
  it('& < > " ni almashtiradi', () => {
    expect(escapeHtml('<script>alert("x")</script> & co')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co',
    )
  })
  it('oddiy matn o‘zgarmaydi', () => {
    expect(escapeHtml("G'isht M-100")).toBe("G'isht M-100")
  })
})

describe('toDecString / formatDecimal', () => {
  it.each([
    [1250000, '1 250 000'],
    ['1250000.00', '1 250 000'],
    ['1450.5', '1 450,5'],
    [1450.5, '1 450,5'],
    ['0', '0'],
    ['0.00', '0'],
    ['-15.25', '-15,25'],
    ['999', '999'],
    ['1000', '1 000'],
    ['12345678901234567890.12', '12 345 678 901 234 567 890,12'],
    ['1.005', '1,01'],
    ['1.004', '1'],
    ['9.999', '10'],
    ['-0.001', '0'],
    ['.5', '0,5'],
    ['  42  ', '42'],
    [0.1 + 0.2, '0,3'],
    [1e21, '1 000 000 000 000 000 000 000'],
  ])('%s → %s', (input, expected) => {
    expect(formatDecimal(input)).toBe(expected)
  })

  it('maxFrac bilan', () => {
    expect(formatDecimal('1300.1234', 4)).toBe('1 300,1234')
    expect(formatDecimal('2.5', 0)).toBe('3')
    expect(formatDecimal('-2.5', 0)).toBe('-3')
  })

  it.each([[null], [undefined], ['abc'], [''], ['1,5'], [Number.NaN], [Infinity], [{}], ['.'], ['1e5']])(
    'noto‘g‘ri: %s → null',
    (input) => {
      expect(formatDecimal(input)).toBeNull()
    },
  )

  it('kichik son (eksponentsiz)', () => {
    expect(toDecString(1e-7)).toBe('0.000000100000')
  })
})

describe('sana va vaqt', () => {
  it('Toshkent vaqtida (UTC+5)', () => {
    expect(formatDateTimeTashkent('2026-10-29T09:32:00Z')).toBe('29.10.2026 14:32')
  })
  it('UTC 20:30 → ertasi kun', () => {
    expect(formatDateTimeTashkent('2026-10-29T20:30:00Z')).toBe('30.10.2026 01:30')
  })
  it('yarim tun 00:xx', () => {
    expect(formatDateTimeTashkent('2026-12-31T19:05:00Z')).toBe('01.01.2027 00:05')
  })
  it('offsetli ISO', () => {
    expect(formatDateTimeTashkent('2026-10-29T14:32:00+05:00')).toBe('29.10.2026 14:32')
  })
  it('noto‘g‘ri → null', () => {
    expect(formatDateTimeTashkent('kecha')).toBeNull()
  })
  it('formatDateIso', () => {
    expect(formatDateIso('2026-10-29')).toBe('29.10.2026')
    expect(formatDateIso('<b>')).toBe('&lt;b&gt;')
  })
})

describe('formatAlertMessage — narx_ogishi', () => {
  const details = {
    avg_n: '1300.0000',
    diff_n: '11.54',
    avg_90: 1280,
    diff_90: 13.28,
    price: '1450.0000',
    direction: 'high',
    window_size: 5,
    threshold_pct: '8',
  }

  it('high — to‘liq', () => {
    expect(formatAlertMessage(alert({ details }))).toBe(
      '⚠️ <b>Narx odatdagidan yuqori</b>\n' +
        'Sement M400 · Obyekt A\n' +
        `Narx: 1 450 ${SOM}/kg (o'rtacha 1 300, +11,54 %)\n` +
        "90 kunlik o'rtacha: 1 280 (+13,28 %)\n" +
        '29.10.2026 14:32',
    )
  })

  it('low — manfiy foiz', () => {
    const msg = formatAlertMessage(
      alert({ details: { ...details, direction: 'low', price: 600, diff_n: '-53.85', avg_90: null, diff_90: null } }),
    )
    expect(msg).toContain('<b>Narx odatdagidan juda past</b>')
    expect(msg).toContain(`Narx: 600 ${SOM}/kg (o'rtacha 1 300, −53,85 %)`)
    expect(msg).not.toContain('90 kunlik')
  })

  it('faqat 90 kunlik o‘rtacha bo‘lsa', () => {
    const msg = formatAlertMessage(
      alert({ details: { price: '1450', avg_n: null, diff_n: null, avg_90: '1300', diff_90: '11.5', direction: 'high' } }),
    )
    expect(msg).toContain(`Narx: 1 450 ${SOM}/kg (o'rtacha 1 300, +11,5 %)`)
  })

  it('bo‘sh details — sarlavha, kontekst, sana', () => {
    expect(formatAlertMessage(alert({ details: {} }))).toBe(
      "⚠️ <b>Narx og'ishi</b>\nSement M400 · Obyekt A\n29.10.2026 14:32",
    )
  })
})

describe('formatAlertMessage — xarid_qabul_farqi', () => {
  it('under — to‘liq', () => {
    const msg = formatAlertMessage(
      alert({
        type: 'xarid_qabul_farqi',
        details: {
          purchased_qty_base: '100.000000',
          received_qty_base: '85',
          diff_pct: '15.00',
          threshold_pct: 2,
          direction: 'under',
          receipt_count: 1,
        },
      }),
    )
    expect(msg).toBe(
      '⚠️ <b>Xarid va qabul farqi</b>\n' +
        'Sement M400 · Obyekt A\n' +
        'Xarid: 100 kg, qabul: 85 kg (−15 %)\n' +
        "Xariddan kam qabul qilingan\n" +
        'Chegara: 2 %\n' +
        '29.10.2026 14:32',
    )
  })

  it('over, jiddiy — 🔴 va +', () => {
    const msg = formatAlertMessage(
      alert({
        type: 'xarid_qabul_farqi',
        severity: 'jiddiy',
        details: { purchased_qty_base: 100, received_qty_base: 130.5, diff_pct: 30.5, direction: 'over' },
      }),
    )
    expect(msg.startsWith('🔴 <b>Xarid va qabul farqi</b>')).toBe(true)
    expect(msg).toContain('Xarid: 100 kg, qabul: 130,5 kg (+30,5 %)')
    expect(msg).toContain("Xariddan ko'p qabul qilingan")
  })

  it('bo‘sh details, nomlarsiz', () => {
    expect(
      formatAlertMessage(alert({ type: 'xarid_qabul_farqi', details: {}, object_name: null, material_name: null })),
    ).toBe('⚠️ <b>Xarid va qabul farqi</b>\n29.10.2026 14:32')
  })
})

describe('formatAlertMessage — ozi_qabul_qilgan', () => {
  it('to‘liq, bog‘lanmagan', () => {
    expect(
      formatAlertMessage(
        alert({ type: 'ozi_qabul_qilgan', severity: 'belgi', details: { buyer_id: 'u', receiver_id: 'u', qty_base: '50', linked: false } }),
      ),
    ).toBe(
      "🔖 <b>O'zi qabul qilgan</b>\nSement M400 · Obyekt A\nXarid qilgan va qabul qilgan — bitta odam\n" +
        "Miqdor: 50 kg\nKirim xaridga bog'lanmagan\n29.10.2026 14:32",
    )
  })
  it('bo‘sh details', () => {
    const msg = formatAlertMessage(alert({ type: 'ozi_qabul_qilgan', severity: 'belgi', details: {} }))
    expect(msg).toContain("<b>O'zi qabul qilgan</b>")
    expect(msg).not.toContain('Miqdor')
  })
})

describe('formatAlertMessage — yozuv_ochirildi', () => {
  it('purchases', () => {
    expect(
      formatAlertMessage(
        alert({
          type: 'yozuv_ochirildi',
          details: {
            table: 'purchases',
            actor_name: 'Admin Adminov',
            material_name: 'Sement M400',
            amount: '1250000.00',
            qty_base: '1000',
            buyer_name: 'Ali Valiyev',
          },
        }),
      ),
    ).toBe(
      "🗑 <b>Xarid o'chirildi</b>\n" +
        `Sement M400 · 1 000 kg · 1 250 000 ${SOM} · Ali Valiyev\n` +
        'Obyekt: Obyekt A\n' +
        "O'chirdi: Admin Adminov\n" +
        '29.10.2026 14:32',
    )
  })

  it('cash_advances', () => {
    const msg = formatAlertMessage(
      alert({
        type: 'yozuv_ochirildi',
        object_name: null,
        material_name: null,
        base_unit: null,
        details: { table: 'cash_advances', amount: 5000000, recipient_name: 'Haydovchi Hasan', actor_name: 'Buxgalter' },
      }),
    )
    expect(msg).toBe(
      "🗑 <b>Podotchet o'chirildi</b>\n" +
        `5 000 000 ${SOM} · Haydovchi Hasan\n` +
        "O'chirdi: Buxgalter\n" +
        '29.10.2026 14:32',
    )
  })

  it.each([
    ['kirim', "Kirim o'chirildi"],
    ['chiqim', "Chiqim o'chirildi"],
    ['transfer_in', "Ombor harakati o'chirildi"],
  ])('movements %s', (movement_type, title) => {
    const msg = formatAlertMessage(
      alert({
        type: 'yozuv_ochirildi',
        details: { table: 'movements', movement_type, qty_base: '12.5', material_name: 'Qum', actor_name: 'Prorab' },
      }),
    )
    expect(msg).toContain(`🗑 <b>${title}</b>`)
    expect(msg).toContain('Qum · 12,5 kg')
    expect(msg).toContain("O'chirdi: Prorab")
  })

  it('bo‘sh details — umumiy sarlavha, payload material nomi', () => {
    expect(formatAlertMessage(alert({ type: 'yozuv_ochirildi', details: {} }))).toBe(
      "🗑 <b>Yozuv o'chirildi</b>\nSement M400\nObyekt: Obyekt A\n29.10.2026 14:32",
    )
  })
})

describe('formatAlertMessage — boshqa turlar', () => {
  it.each([
    ['normadan_oshish', 'Normadan oshish'],
    ['inventarizatsiya_kamomadi', 'Inventarizatsiya kamomadi'],
    ['smetadan_ortiq_sorov', "Smetadan ortiq so'rov"],
  ])('%s', (type, title) => {
    expect(formatAlertMessage(alert({ type, details: { anything: 1 } }))).toBe(
      `⚠️ <b>${title}</b>\nSement M400 · Obyekt A\n29.10.2026 14:32`,
    )
  })

  it('noma’lum tur — umumiy sarlavha', () => {
    expect(formatAlertMessage(alert({ type: 'yangi_tur', details: {} }))).toBe(
      '⚠️ <b>Yangi ogohlantirish</b>\nSement M400 · Obyekt A\n29.10.2026 14:32',
    )
  })

  it('noto‘g‘ri created_at — sana qatori tushiriladi', () => {
    expect(formatAlertMessage(alert({ type: 'normadan_oshish', created_at: '' }))).toBe(
      '⚠️ <b>Normadan oshish</b>\nSement M400 · Obyekt A',
    )
  })

  it('details null kelsa ham yiqilmaydi', () => {
    const p = alert({ details: null as unknown as Record<string, unknown> })
    expect(formatAlertMessage(p)).toContain("<b>Narx og'ishi</b>")
  })
})

describe('HTML injection', () => {
  it('alert nomlari escape qilinadi', () => {
    const msg = formatAlertMessage(
      alert({
        type: 'yozuv_ochirildi',
        object_name: '<script>x</script>',
        material_name: 'A & B',
        base_unit: '<u>',
        details: { table: 'purchases', buyer_name: '"Ali" <b>', actor_name: '</b><a href="x">', qty_base: 1 },
      }),
    )
    expect(msg).not.toContain('<script>')
    expect(msg).not.toContain('<a ')
    expect(msg).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(msg).toContain('A &amp; B')
    expect(msg).toContain('1 &lt;u&gt;')
    expect(msg).toContain('&quot;Ali&quot; &lt;b&gt;')
    // Faqat bizning <b> tegimiz qoladi
    expect(msg.match(/<[^>]*>/g)).toEqual(['<b>', '</b>'])
  })

  it('kunlik hisobotda firma nomi va noma’lum tur escape', () => {
    const msg = formatDailyReport(
      report({ company_name: '<i>Firma</i> & Co', alerts_new: 1, alerts_by_type: { '<x>': 1 } }),
    )
    expect(msg).toContain('&lt;i&gt;Firma&lt;/i&gt; &amp; Co')
    expect(msg).toContain('&lt;x&gt; — 1')
    expect(msg.match(/<[^>]*>/g)).toEqual(['<b>', '</b>'])
  })
})

describe('formatDailyReport', () => {
  it('nollar ham ko‘rsatiladi', () => {
    expect(formatDailyReport(report())).toBe(
      '📊 <b>Kunlik hisobot · 29.10.2026</b>\n' +
        '28.10 20:00 – 29.10 20:00\n' +
        'Namuna Qurilish\n' +
        'Kirim: 0 · Chiqim: 0\n' +
        `Xaridlar: 0 ta, 0 ${SOM}\n` +
        "So'rovlar: 0\n" +
        'Yangi farqlar: 0\n' +
        "O'zi qabul qilgan: 0\n" +
        "O'chirilgan yozuvlar: 0",
    )
  })

  it('bir nechta tur, tartib va katta summa', () => {
    expect(
      formatDailyReport(
        report({
          kirim_count: 12,
          chiqim_count: 7,
          purchases_count: 5,
          purchases_sum: '12500000.00',
          alerts_new: 4,
          alerts_by_type: { yozuv_ochirildi: 1, xarid_qabul_farqi: 2, narx_ogishi: 1, ozi_qabul_qilgan: 0 },
          self_received_count: 1,
          deleted_count: 1,
        }),
      ),
    ).toBe(
      '📊 <b>Kunlik hisobot · 29.10.2026</b>\n' +
        '28.10 20:00 – 29.10 20:00\n' +
        'Namuna Qurilish\n' +
        'Kirim: 12 · Chiqim: 7\n' +
        `Xaridlar: 5 ta, 12 500 000 ${SOM}\n` +
        "So'rovlar: 0\n" +
        "Yangi farqlar: 4 (xarid/qabul — 2, narx — 1, o'chirish — 1)\n" +
        "O'zi qabul qilgan: 1\n" +
        "O'chirilgan yozuvlar: 1",
    )
  })

  it('kasrli summa va noto‘g‘ri summa', () => {
    expect(formatDailyReport(report({ purchases_sum: '1234567.5' }))).toContain(`1 234 567,5 ${SOM}`)
    expect(formatDailyReport(report({ purchases_sum: 'xato' }))).toContain(`Xaridlar: 0 ta, 0 ${SOM}`)
  })
})

describe('4096 chegarasi', () => {
  it('uzun nomlar qisqartiriladi', () => {
    const long = '<'.repeat(5000)
    const msg = formatAlertMessage(
      alert({
        type: 'yozuv_ochirildi',
        object_name: long,
        material_name: long,
        details: { table: 'purchases', buyer_name: long, actor_name: long, material_name: long, amount: 1 },
      }),
    )
    expect(msg.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH)
    expect(msg).toContain('…')
    expect(msg.startsWith("🗑 <b>Xarid o'chirildi</b>")).toBe(true)
  })

  it('juda ko‘p tur — hisobot ham chegarada', () => {
    const byType: Record<string, number> = {}
    for (let i = 0; i < 400; i++) byType[`tur_${'z'.repeat(50)}_${i}`] = i + 1
    const msg = formatDailyReport(report({ alerts_new: 400, alerts_by_type: byType }))
    expect(msg.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH)
    expect(msg.startsWith('📊 <b>Kunlik hisobot · 29.10.2026</b>')).toBe(true)
    expect(msg.endsWith('…')).toBe(true)
  })

  it('oddiy xabar qisqartirilmaydi', () => {
    expect(formatAlertMessage(alert())).not.toContain('…')
  })
})

describe('miniAppKeyboard', () => {
  it('standart matn', () => {
    expect(miniAppKeyboard('https://terron.example/tg')).toEqual({
      inline_keyboard: [[{ text: "Mini App'ni ochish", web_app: { url: 'https://terron.example/tg' } }]],
    })
  })
  it('boshqa matn', () => {
    expect(miniAppKeyboard('https://x/tg', 'Ochish').inline_keyboard[0]?.[0]?.text).toBe('Ochish')
  })
})

describe('formatDailyReport — oraliq va yuborilmaganlar', () => {
  it('oraliq Toshkent vaqtida (UTC 15:00 → 20:00)', () => {
    expect(formatPeriod('2026-10-28T15:00:00Z', '2026-10-29T15:00:00Z')).toBe('28.10 20:00 – 29.10 20:00')
  })
  it('oraliq yil chegarasida', () => {
    expect(formatPeriod('2026-12-31T15:00:00Z', '2027-01-01T15:00:00Z')).toBe('31.12 20:00 – 01.01 20:00')
  })
  it('noto‘g‘ri oraliq — qator tushiriladi', () => {
    expect(formatPeriod('', '2026-10-29T15:00:00Z')).toBeNull()
    const msg = formatDailyReport(report({ period_start: 'xato' }))
    expect(msg.split('\n')[1]).toBe('Namuna Qurilish')
  })
  it('failed_count = 0 — ko‘rsatilmaydi', () => {
    expect(formatDailyReport(report())).not.toContain('Yuborilmagan')
  })
  it('failed_count > 0 — oxirgi qator', () => {
    const msg = formatDailyReport(report({ failed_count: 3 }))
    expect(msg.endsWith('\n⚠️ Yuborilmagan xabarlar: 3')).toBe(true)
  })
})

describe('formatAlertDigest', () => {
  const kinds: Partial<AlertPayload>[] = [
    { type: 'xarid_qabul_farqi', material_name: 'Sement', object_name: 'Obyekt A' },
    { type: 'narx_ogishi', details: { direction: 'high' }, material_name: 'Qum', object_name: 'Obyekt B' },
    { type: 'yozuv_ochirildi', details: { table: 'purchases', material_name: 'Shag‘al' }, material_name: null },
    { type: 'normadan_oshish', material_name: 'Beton', object_name: null },
    { type: 'smetadan_ortiq_sorov', material_name: null, object_name: null },
    { type: 'xarid_qabul_farqi', severity: 'jiddiy', material_name: 'Armatura', object_name: 'Obyekt C' },
    { type: 'boshqa_tur', material_name: 'Kafel', object_name: 'Obyekt A' },
  ]

  it('bo‘sh massiv — xato', () => {
    expect(() => formatAlertDigest([])).toThrow()
  })

  it('1 ta', () => {
    expect(formatAlertDigest([alert({ type: 'xarid_qabul_farqi' })])).toBe(
      '⚠️ <b>1 ta yangi ogohlantirish</b>\n' +
        'xarid/qabul — 1\n' +
        '⚠️ Xarid va qabul farqi: Sement M400 · Obyekt A',
    )
  })

  it('7 ta — hammasi ro‘yxatda, sanoq tartibda', () => {
    const msg = formatAlertDigest(kinds.map((k) => alert(k)))
    expect(msg).toBe(
      '⚠️ <b>7 ta yangi ogohlantirish</b>\n' +
        "xarid/qabul — 2, narx — 1, o'chirish — 1, norma — 1, smetadan ortiq — 1, boshqa_tur — 1\n" +
        '⚠️ Xarid va qabul farqi: Sement · Obyekt A\n' +
        '⚠️ Narx odatdagidan yuqori: Qum · Obyekt B\n' +
        "🗑 Xarid o'chirildi: Shag‘al · Obyekt A\n" +
        '⚠️ Normadan oshish: Beton\n' +
        "⚠️ Smetadan ortiq so'rov\n" +
        '🔴 Xarid va qabul farqi: Armatura · Obyekt C\n' +
        '⚠️ Yangi ogohlantirish: Kafel · Obyekt A',
    )
  })

  it('25 ta — 10 tasi va "… va yana 15 ta"', () => {
    const list = Array.from({ length: 25 }, (_, i) => alert({ type: 'narx_ogishi', material_name: `M${i}` }))
    const lines = formatAlertDigest(list).split('\n')
    expect(lines[0]).toBe('⚠️ <b>25 ta yangi ogohlantirish</b>')
    expect(lines[1]).toBe('narx — 25')
    expect(lines).toHaveLength(2 + 10 + 1)
    expect(lines[2]).toContain('M0 · Obyekt A')
    expect(lines[11]).toContain('M9 ·')
    expect(lines[12]).toBe('… va yana 15 ta')
  })

  it('HTML escape', () => {
    const msg = formatAlertDigest([
      alert({ type: '<b>x</b>', material_name: '<script>', object_name: 'A & "B"' }),
    ])
    expect(msg).toContain('&lt;script&gt; · A &amp; &quot;B&quot;')
    expect(msg).toContain('&lt;b&gt;x&lt;/b&gt; — 1')
    expect(msg.match(/<[^>]*>/g)).toEqual(['<b>', '</b>'])
  })

  it('4096 chegarasi — uzun nomlar', () => {
    const long = '&'.repeat(5000)
    const list = Array.from({ length: 12 }, () => alert({ material_name: long, object_name: long }))
    const msg = formatAlertDigest(list)
    expect(msg.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH)
    expect(msg.startsWith('⚠️ <b>12 ta yangi ogohlantirish</b>')).toBe(true)
    expect(msg).toMatch(/… va yana \d+ ta$/)
  })
})
