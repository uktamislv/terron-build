// @vitest-environment node
// Audit (20261108) shablonlari: yangi alert turlari, manfiy_qoldiq sababi, inventarizatsiya
// paytidagi harakatlar, kunlik hisobot yangi kalitlari, ish oqimi xabarlari (docs/audit-fixes.md).
import { describe, expect, it } from 'vitest'
import {
  type AlertPayload,
  type DailyReportPayload,
  type RequestWorkflowPayload,
  TELEGRAM_MAX_LENGTH,
  formatAlertDigest,
  formatAlertMessage,
  formatDailyReport,
  formatLoginChanged,
  formatPurchaseForObject,
  formatRequestApproved,
  formatRequestCreated,
  formatRequestDecided,
  formatTransferSent,
} from './notifyMessages.ts'

const SOM = 'so‘m'
const WHEN = '29.10.2026 14:32'

function alert(type: string, details: Record<string, unknown>, over: Partial<AlertPayload> = {}): AlertPayload {
  return {
    alert_id: '11111111-2222-3333-4444-555555555555',
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

describe('yozuv_ozgartirildi', () => {
  const base = {
    table: 'movements',
    record_id: 'r1',
    movement_type: 'kirim',
    changed: ['occurred_at', 'qty_base', 'qty_input', 'unit_id'],
    before: { qty_input: 10, unit_input: 'qop', qty_base: 500, occurred_at: '2026-10-28T05:00:00Z', unit_id: 'u1' },
    after: { qty_input: 8, unit_input: 'qop', qty_base: 400, occurred_at: '2026-10-27T05:00:00Z', unit_id: 'u1' },
    via: 'direct',
    actor_profile_id: 'p-admin',
    actor_name: 'Admin <Bek>',
    author_id: 'p-ali',
    author_name: 'Ali',
    material_name: 'Sement M400',
    base_unit: 'kg',
  }
  it('kirim: before → after, birlik miqdor bilan, aktyor va muallif', () => {
    expect(formatAlertMessage(alert('yozuv_ozgartirildi', base))).toBe(
      "✏️ <b>Kirim o'zgartirildi</b>\nSement M400 · Obyekt A\n" +
        '• Sana: 28.10.2026 10:00 → 27.10.2026 10:00\n' +
        '• Miqdor (asosiy birlikda): 500 kg → 400 kg\n' +
        '• Miqdor: 10 qop → 8 qop\n' +
        "O'zgartirdi: Admin &lt;Bek&gt; (muallif: Ali)\n" +
        WHEN,
    )
  })
  it('xarid: summa, narx, id ustunlari — qiymatsiz "o‘zgardi", tuzatish orqali', () => {
    const t = formatAlertMessage(
      alert('yozuv_ozgartirildi', {
        table: 'purchases',
        changed: ['object_id', 'total_amount', 'unit_id'],
        before: { total_amount: 1250000, unit_input: 'qop' },
        after: { total_amount: '1300000.50', unit_input: 'kg' },
        via: 'correct_entry',
        actor_name: 'Admin',
        author_name: 'Ali',
      }),
    )
    expect(t).toContain("✏️ <b>Xarid o'zgartirildi</b>")
    expect(t).toContain("• Obyekt o'zgardi")
    expect(t).toContain(`• Summa: 1 250 000 ${SOM} → 1 300 000,5 ${SOM}`)
    expect(t).toContain('• Birlik: qop → kg')
    expect(t).toContain("O'zgartirdi: Admin (muallif: Ali) (tuzatish orqali)")
  })
  it('aktyor = muallif — "muallif" ko‘rsatilmaydi', () => {
    const t = formatAlertMessage(alert('yozuv_ozgartirildi', { ...base, actor_profile_id: 'p-ali', actor_name: 'Ali' }))
    expect(t).toContain("O'zgartirdi: Ali\n")
  })
  it('yozuv_tuzatildi (belgi) — sarlavha', () => {
    const t = formatAlertMessage(alert('yozuv_tuzatildi', { ...base, via: 'correct_entry' }, { severity: 'belgi' }))
    expect(t.startsWith('✏️ <b>Muallif yozuvni tuzatdi</b>')).toBe(true)
  })
  it('ko‘p ustun — 12 tadan keyin "… va yana N ta"; bo‘sh / yaroqsiz details — xato yo‘q', () => {
    const changed = Array.from({ length: 15 }, (_, i) => `col_${String(i).padStart(2, '0')}`)
    const t = formatAlertMessage(alert('yozuv_ozgartirildi', { table: 'movements', changed, before: {}, after: {} }))
    expect(t).toContain('… va yana 3 ta')
    for (const d of [{}, { changed: 'x', before: null }, null as unknown as Record<string, unknown>]) {
      expect(() => formatAlertMessage(alert('yozuv_ozgartirildi', d))).not.toThrow()
    }
  })
})

describe('sozlama_ozgardi', () => {
  it('o‘zgarishlar ro‘yxati, vaqt, bo‘sh qiymat, noma’lum kalit', () => {
    expect(
      formatAlertMessage(
        alert(
          'sozlama_ozgardi',
          {
            changes: [
              { key: 'price_deviation_pct', before: 8, after: 15 },
              { key: 'quiet_hours_start', before: '22:00:00', after: null },
              { key: 'photo_required_amount', before: null, after: '5000000.00' },
              { key: 'yangi_<x>', before: true, after: false },
            ],
            actor_name: 'Admin',
          },
          { object_name: null, material_name: null, base_unit: null },
        ),
      ),
    ).toBe(
      "⚙️ <b>Firma sozlamasi o'zgartirildi</b>\n" +
        "• Narx og'ishi chegarasi, %: 8 → 15\n" +
        '• Tinch soatlar boshi: 22:00 → —\n' +
        '• Rasm majburiy bo‘lgan summa: — → 5 000 000\n' +
        "• yangi_&lt;x&gt;: ha → yo'q\n" +
        "O'zgartirdi: Admin\n" +
        WHEN,
    )
  })
})

describe('login_ozgardi', () => {
  it('kimning va kim o‘zgartirgani, rollar', () => {
    expect(
      formatAlertMessage(
        alert(
          'login_ozgardi',
          { target_name: 'Vali', target_role: 'prorab', actor_name: 'Bek', actor_role: 'admin', changed_at: '2026-10-29T09:30:00Z' },
          { object_name: null, material_name: null },
        ),
      ),
    ).toBe("🔐 <b>Login o'zgartirildi</b>\nKimning: Vali · Prorab\nO'zgartirdi: Bek · Admin\n" + WHEN)
  })
  it('aktyor boshqa firmaniki (actor_role null) — tizim egasi', () => {
    const t = formatAlertMessage(alert('login_ozgardi', { target_name: 'Vali', target_role: 'direktor', actor_name: 'Sardor', actor_role: null }))
    expect(t).toContain("O'zgartirdi: Sardor (Tizim egasi (boshqa firma))")
  })
})

describe('podotchet_belgisi', () => {
  it('sabablar, kimga, summa, sana, kiritdi', () => {
    expect(
      formatAlertMessage(
        alert(
          'podotchet_belgisi',
          {
            table: 'cash_advances',
            reasons: ['qaytarildi', 'issued_at_outside_window'],
            cash_kind: 'qaytarildi',
            amount: 500000,
            issued_at: '2026-10-20T05:00:00Z',
            recipient_name: 'Ali',
            actor_name: 'Buxgalter',
          },
          { severity: 'belgi', object_name: null, material_name: null },
        ),
      ),
    ).toBe(
      '💵 <b>Podotchet belgisi</b>\nPul qaytarildi deb kiritildi\nSana odatiy oynadan tashqarida\n' +
        `Kimga: Ali\nSumma: 500 000 ${SOM}\nSana: 20.10.2026 10:00\nKiritdi: Buxgalter\n` +
        WHEN,
    )
  })
})

describe('sotuvchi_stir_farqi', () => {
  it('chek STIR va tanlangan sotuvchi', () => {
    expect(
      formatAlertMessage(
        alert('sotuvchi_stir_farqi', { seller_tin: '301234567', supplier_name: 'Qurilish MChJ', supplier_tin: '309999999', receipt_fiscal_sign: '1234' }, { severity: 'belgi' }),
      ),
    ).toBe(
      '🧾 <b>Sotuvchi STIR farqi</b>\nSement M400 · Obyekt A\nChekda STIR: 301234567\n' +
        'Tanlangan sotuvchi: Qurilish MChJ (STIR 309999999)\nFiskal belgi: 1234\n' +
        WHEN,
    )
  })
  it("sotuvchida STIR yo'q", () => {
    expect(formatAlertMessage(alert('sotuvchi_stir_farqi', { seller_tin: '301234567', supplier_name: 'X', supplier_tin: null }))).toContain(
      "Tanlangan sotuvchi: X (STIR yo'q)",
    )
  })
})

describe('manfiy_qoldiq — sabab (audit A2)', () => {
  it("kirim o'chirildi", () => {
    expect(
      formatAlertMessage(alert('manfiy_qoldiq', { stock_after: -20, qty_base: 100, unit: 'kg', movement_type: 'kirim', movement_deleted: true })),
    ).toBe("➖ <b>Manfiy qoldiq</b>\nSement M400 · Obyekt A\nQoldiq: −20 kg\nSabab: kirim o'chirildi (100 kg)\n" + WHEN)
  })
  it("o'tkazma qabuli kamaytirildi", () => {
    expect(
      formatAlertMessage(alert('manfiy_qoldiq', { stock_after: -5, qty_base: 30, unit: 'kg', movement_type: 'transfer_in', movement_deleted: false })),
    ).toContain("Sabab: o'tkazma (kirim) o'zgartirildi (30 kg)")
  })
  it('chiqim (eski ko‘rinish) o‘zgarmagan', () => {
    expect(
      formatAlertMessage(alert('manfiy_qoldiq', { stock_after: -5, qty_base: 30, unit: 'kg', movement_type: 'chiqim', movement_deleted: false })),
    ).toContain('Oxirgi chiqim: 30 kg')
  })
})

describe('inventarizatsiya — sanash paytidagi harakatlar', () => {
  it('jami va materiallar ro‘yxati', () => {
    const t = formatAlertMessage(
      alert('inventarizatsiya_kamomadi', {
        items: [{ material_name: 'Sement', base_unit: 'kg', expected: 500, counted: 420, shortage: 80 }],
        movements_during_count: [
          { material_id: 'm1', material_name: 'Sement', count: 2 },
          { material_id: 'm2', material_name: 'Qum', count: 1 },
        ],
        movements_during_count_total: 3,
      }),
    )
    expect(t).toContain("⚠️ Sanash paytida 3 ta harakat bo'ldi: Sement — 2, Qum — 1")
  })
  it("0 yoki yo'q — qator chiqmaydi", () => {
    const t = formatAlertMessage(alert('inventarizatsiya_kamomadi', { items: [], movements_during_count: [], movements_during_count_total: 0 }))
    expect(t).not.toContain('Sanash paytida')
  })
})

describe('digest va kunlik hisobot', () => {
  it('digest: qisqa nomlar va kontekst', () => {
    const t = formatAlertDigest([
      alert('yozuv_ozgartirildi', { table: 'purchases' }),
      alert('login_ozgardi', { target_name: 'Vali' }, { object_name: null, material_name: null }),
      alert('podotchet_belgisi', { recipient_name: 'Ali' }, { object_name: null, material_name: null }),
    ])
    expect(t).toContain("o'zgartirish — 1, login — 1, podotchet belgisi — 1")
    expect(t).toContain("🔐 Login o'zgartirildi: Vali")
    expect(t).toContain('💵 Podotchet belgisi: Ali')
  })

  const report = (over: Partial<DailyReportPayload>): DailyReportPayload => ({
    date: '2026-10-29', period_start: '2026-10-28T15:00:00Z', period_end: '2026-10-29T15:00:00Z',
    company_name: 'F', kirim_count: 0, chiqim_count: 0, purchases_count: 0, purchases_sum: '0', requests_count: 0,
    alerts_new: 0, alerts_by_type: {}, self_received_count: 0, deleted_count: 0, restored_count: 0, failed_count: 0,
    transfers_pending_count: 0, chiqim_without_estimate_count: 0, ...over,
  })
  it('yangi kalitlar > 0 — qatorlar; stuck / failed_7d — ogohlantirish belgisi bilan', () => {
    const t = formatDailyReport(
      report({
        backdated_count: 2,
        manual_closed_count: 3,
        stuck_pending_count: 4,
        failed_7d_count: 5,
        cash_outstanding_sum: '1250000.00',
        cash_owed_to_staff_sum: '50000.00',
      }),
    )
    expect(t).toContain('Orqa sana bilan kiritilgan yozuvlar: 2')
    expect(t).toContain("Qo'lda yopilgan farqlar: 3")
    expect(t).toContain(`Xodimlar qo'lidagi pul: 1 250 000 ${SOM}`)
    expect(t).toContain(`Xodimlarga qarz (ortiqcha sarf): 50 000 ${SOM}`)
    expect(t).toContain('⚠️ Navbatda qolib ketgan xabarlar: 4')
    expect(t).toContain('⚠️ 7 kunda yuborilmagan xabarlar: 5')
  })
  it('0 / "0.00" / yo‘q — chiqmaydi', () => {
    const t = formatDailyReport(
      report({ backdated_count: 0, manual_closed_count: 0, stuck_pending_count: 0, failed_7d_count: 0, cash_outstanding_sum: '0.00', cash_owed_to_staff_sum: null }),
    )
    for (const s of ['Orqa sana', "Qo'lda yopilgan", 'Navbatda', '7 kunda', "qo'lidagi pul", 'qarz']) expect(t).not.toContain(s)
  })
})

describe('ish oqimi xabarlari', () => {
  const req = (over: Partial<RequestWorkflowPayload> = {}): RequestWorkflowPayload => ({
    request_id: 'q1',
    company_name: 'F',
    status: 'kutilmoqda',
    object_name: 'Obyekt A',
    material_name: 'Sement',
    qty_input: 5,
    unit_input: 'qop',
    qty_base: 250,
    base_unit: 'kg',
    needed_by: '2026-11-10',
    note: 'Tezroq <kerak>',
    decision_note: null,
    created_by_name: 'Ali',
    decided_by_name: null,
    created_at: '2026-10-29T09:32:00Z',
    decided_at: null,
    ...over,
  })

  it('request_created (adminlarga)', () => {
    expect(formatRequestCreated(req())).toBe(
      "📝 <b>Yangi so'rov</b>\nSement · Obyekt A\n5 qop (250 kg)\nKerak: 10.11.2026\nIzoh: Tezroq &lt;kerak&gt;\nSo'radi: Ali\n" + WHEN,
    )
  })
  it('request_decided: tasdiqlandi + izoh / rad + sabab', () => {
    const ok = formatRequestDecided(
      req({ status: 'tasdiqlandi', decision_note: 'Ertaga', decided_by_name: 'Bek', decided_at: '2026-10-29T10:00:00Z' }),
    )
    expect(ok).toBe(
      "✅ <b>So'rovingiz tasdiqlandi</b>\nSement · Obyekt A\n5 qop (250 kg)\nKerak: 10.11.2026\nIzoh: Ertaga\nQaror: Bek\n29.10.2026 15:00",
    )
    const no = formatRequestDecided(req({ status: 'rad', decision_note: 'Smetada yo‘q', decided_by_name: 'Bek' }))
    expect(no).toContain("❌ <b>So'rovingiz rad etildi</b>")
    expect(no).toContain('Sabab: Smetada yo‘q')
  })
  it('request_approved (taminotchilarga): "Sotib olish kerak"', () => {
    const t = formatRequestApproved(req({ status: 'tasdiqlandi', decided_by_name: 'Bek', needed_by: null }))
    expect(t).toBe(
      "🛒 <b>Sotib olish kerak</b>\nSement · Obyekt A\n5 qop (250 kg)\nIzoh: Tezroq &lt;kerak&gt;\nSo'radi: Ali · tasdiqladi: Bek\n" + WHEN,
    )
  })
  it('bir xil birlik — asosiy miqdor takrorlanmaydi', () => {
    expect(formatRequestCreated(req({ qty_input: 250, unit_input: 'kg' }))).toContain('\n250 kg\n')
  })
  it('transfer_sent (qabul qiluvchilarga): "Yo‘lda"', () => {
    expect(
      formatTransferSent({
        transfer_id: 't1', company_name: 'F', from_object_name: 'Obyekt A', to_object_name: 'Obyekt B',
        material_name: 'Sement', qty_input: 3, unit_input: 'qop', qty_base: 150, base_unit: 'kg',
        note: null, sent_by_name: 'Ali', created_at: '2026-10-29T09:32:00Z',
      }),
    ).toBe("🚚 <b>Yo'lda — o'tkazma keladi</b>\nSement: Obyekt A → Obyekt B\n3 qop (150 kg)\nYubordi: Ali\n" + WHEN)
  })
  it('purchase_for_object: "X sotib oldi, obyektga keladi"', () => {
    expect(
      formatPurchaseForObject({
        purchase_id: 'p1', company_name: 'F', object_name: 'Obyekt A', material_name: 'Sement',
        qty_input: 10, unit_input: 'qop', qty_base: 500, base_unit: 'kg', buyer_name: 'Haydovchi <Sobir>',
        supplier_name: 'Baraka', purchased_at: '2026-10-29T09:32:00Z',
      }),
    ).toBe(
      '🛒 <b>Haydovchi &lt;Sobir&gt; sotib oldi, obyektga keladi</b>\nSement · Obyekt A\n10 qop (500 kg)\nSotuvchi: Baraka\n' + WHEN,
    )
  })
  it('purchase_for_object: xaridor nomi yo‘q', () => {
    expect(
      formatPurchaseForObject({
        purchase_id: 'p1', company_name: null, object_name: null, material_name: null, qty_input: null, unit_input: null,
        qty_base: null, base_unit: null, buyer_name: null, supplier_name: null, purchased_at: null,
      }),
    ).toBe('🛒 <b>Xarid qilindi, obyektga keladi</b>')
  })
  it('login_changed (egasiga)', () => {
    expect(
      formatLoginChanged({ alert_id: 'a', profile_id: 'p', profile_name: 'Vali', company_name: 'F', actor_name: 'Bek', changed_at: '2026-10-29T09:32:00Z' }),
    ).toBe(
      "🔐 <b>Sizning loginingiz o'zgartirildi</b>\nVali\nO'zgartirdi: Bek\n" + WHEN + "\n⚠️ Agar bu siz bo'lmasangiz — darhol adminga ayting.",
    )
  })
  it('uzun izoh qisqartiriladi, 4096 ga sig‘adi', () => {
    const t = formatRequestCreated(req({ note: 'x'.repeat(5000) }))
    expect(t).toContain('x'.repeat(299) + '…')
    expect(t.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH)
  })
})
