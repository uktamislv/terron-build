// @vitest-environment node
// 2-tur (20261109) shablonlari: yangi ish oqimi turlari, dayjest, yangi alert turlari, o'zgargan details,
// deep link havolalari (docs/audit-fixes.md, "2-tur").
import { describe, expect, it } from 'vitest'
import {
  type AlertPayload,
  type TransferWorkflowPayload,
  TELEGRAM_MAX_LENGTH,
  formatAlertDigest,
  formatAlertMessage,
  formatAlertsDigest,
  formatInventoryApplied,
  formatLoginChanged,
  formatPurchaseDeleted,
  formatPurchaseOnYourName,
  formatTransferCancelled,
  formatTransferReceived,
  workflowOpenUrl,
} from './notifyMessages.ts'

const SOM = 'so‘m'
const WHEN = '29.10.2026 14:32'
const T = '2026-10-29T09:32:00Z'
const UUID = '11111111-2222-4333-8444-555555555555'

function alert(type: string, details: Record<string, unknown>, over: Partial<AlertPayload> = {}): AlertPayload {
  return {
    alert_id: UUID,
    type,
    severity: 'ogohlantirish',
    object_name: 'Obyekt A',
    material_name: 'Sement',
    base_unit: 'kg',
    details,
    created_at: T,
    ...over,
  }
}

const TR: TransferWorkflowPayload = {
  transfer_id: UUID, company_name: 'F', status: 'qabul_qilindi', from_object_name: 'A', to_object_name: 'B',
  material_name: 'Sement', qty_input: 3, unit_input: 'qop', qty_base: 150, received_qty_base: 145, base_unit: 'kg',
  note: null, cancel_reason: null, sent_by_name: 'Ali', received_by_name: 'Vali', created_at: T, received_at: T,
}

describe('transfer_cancelled / transfer_received', () => {
  it('bekor qilindi — sabab va kim', () => {
    expect(
      formatTransferCancelled({ ...TR, status: 'bekor', cancel_reason: 'Xato <obyekt>', cancelled_by_name: 'Ali', cancelled_at: T }),
    ).toBe("🚫 <b>O'tkazma bekor qilindi</b>\nSement: A → B\n3 qop (150 kg)\nSabab: Xato &lt;obyekt&gt;\nBekor qildi: Ali\n" + WHEN)
  })
  it('qabul qilindi — kam qabul farqi bilan', () => {
    expect(formatTransferReceived(TR)).toBe(
      "📦 <b>O'tkazma qabul qilindi</b>\nSement: A → B\nYuborildi: 3 qop (150 kg), qabul: 145 kg (−5 kg)\nQabul qildi: Vali\n" + WHEN,
    )
  })
  it("to'liq / ko'p qabul, kasr", () => {
    expect(formatTransferReceived({ ...TR, received_qty_base: 150 })).toContain('qabul: 150 kg\n')
    expect(formatTransferReceived({ ...TR, qty_base: '150.5', received_qty_base: '151.25' })).toContain('qabul: 151,25 kg (+0,75 kg)')
  })
})

describe('purchase_deleted / purchase_on_your_name / inventory_applied', () => {
  const PU = {
    purchase_id: UUID, company_name: 'F', object_name: 'A', material_name: 'Sement', qty_input: 10, unit_input: 'qop',
    qty_base: 500, base_unit: 'kg', buyer_id: 'b', buyer_name: 'Sobir', supplier_name: null, purchased_at: T,
  }
  it('xarid bekor qilindi', () => {
    expect(formatPurchaseDeleted({ ...PU, deleted_at: T, deleted_by_name: 'Sobir', reason: 'Xato kiritilgan' })).toBe(
      "🗑 <b>Xarid bekor qilindi — obyektga kelmaydi</b>\nSement · A\n10 qop (500 kg)\nXaridor: Sobir\nO'chirdi: Sobir\nSabab: Xato kiritilgan\n" + WHEN,
    )
  })
  it('sizning nomingizga xarid — ogohlantirish matni', () => {
    expect(
      formatPurchaseOnYourName({
        purchase_id: UUID, company_name: 'F', buyer_name: 'Sobir', actor_name: 'Admin', object_name: 'A', material_name: 'Sement',
        qty_input: 2, unit_input: 'qop', qty_base: 100, base_unit: 'kg', total_amount: 250000, payment_source: 'podotchet', purchased_at: T,
      }),
    ).toBe(
      `⚠️ <b>Sizning nomingizga xarid kiritildi</b>\nSement · A\n2 qop (100 kg) · 250 000 ${SOM}\nTo'lov: podotchet (qo'lingizdagi puldan)\n` +
        `Kiritdi: Admin\n${WHEN}\nAgar siz qilmagan bo'lsangiz — adminga ayting.`,
    )
  })
  it('inventarizatsiya qo‘llandi — miqdorlarsiz', () => {
    expect(
      formatInventoryApplied({
        count_id: 'c', company_name: 'F', object_name: 'Obyekt A', counted_at: T, submitted_at: T, applied_at: T,
        applied_by_name: 'Admin', items_count: 12, adjusted_count: 3,
      }),
    ).toBe("📋 <b>Inventarizatsiya natijasi qo'llandi</b>\nObyekt A\nMateriallar: 12, tuzatildi: 3\nQo'lladi: Admin\n" + WHEN)
  })
})

describe('alerts_digest', () => {
  const items = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ alert_id: `a${i}`, object_name: 'A', material_name: `M${i}`, over_qty_base: 120.5, base_unit: 'kg' }))
  it('sarlavha tur bo‘yicha, ro‘yxat, +N ta', () => {
    expect(
      formatAlertsDigest({ company_name: 'F', alert_type: 'smetadan_ortiq_sorov', count: 7, items: items(2), more_count: 5, created_at: T }),
    ).toBe("📝 <b>7 ta: Smetadan ortiq so'rov</b>\nF\n• M0 · A — ortiqcha 120,5 kg\n• M1 · A — ortiqcha 120,5 kg\n+5 ta\n" + WHEN)
  })
  it('juda ko‘p / uzun — 4096 ga sig‘adi, +N qayta hisoblanadi', () => {
    const long = Array.from({ length: 20 }, (_, i) => ({ material_name: 'Z'.repeat(300) + i, object_name: 'O'.repeat(300) }))
    const t = formatAlertsDigest({ company_name: 'F', alert_type: 'smetadan_ortiq_sorov', count: 40, items: long, more_count: 20, created_at: T })
    expect(t.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH)
    expect(t).toMatch(/\n\+\d+ ta\n/)
  })
  it('noma’lum tur / yaroqsiz items — xato yo‘q', () => {
    expect(() =>
      formatAlertsDigest({ company_name: null, alert_type: 'x', count: 'a', items: null as unknown as [], more_count: null, created_at: null }),
    ).not.toThrow()
  })
})

describe('yangi alert turlari', () => {
  it('xarid_boshqa_nomidan', () => {
    expect(
      formatAlertMessage(
        alert('xarid_boshqa_nomidan', {
          buyer_name: 'Sobir', actor_name: 'Admin', amount: 250000, qty_base: 100, base_unit: 'kg',
          purchased_at: '2026-10-29T05:00:00Z', payment_source: 'firma', via: 'insert',
        }),
      ),
    ).toBe(
      `👤 <b>Boshqa odam nomidan xarid</b>\nSement · Obyekt A\nXaridor: Sobir · kiritdi: Admin\n100 kg · 250 000 ${SOM}\n` +
        `To'lov: firma hisobidan\nSana: 29.10.2026 10:00\n` +
        WHEN,
    )
  })
  it("xarid_boshqa_nomidan — via update", () => {
    expect(formatAlertMessage(alert('xarid_boshqa_nomidan', { buyer_name: 'S', actor_name: 'A', via: 'update' }))).toContain(
      "Xaridor: S · kiritdi: A (xaridor keyin o'zgartirildi)",
    )
  })
  it('sotuvchi_birlashtirildi', () => {
    expect(
      formatAlertMessage(
        alert(
          'sotuvchi_birlashtirildi',
          { keep_name: 'Baraka MChJ', merged_name: 'Baraka', moved_count: 5, moved_deleted_count: 1, filled: ['tin', 'phone'], actor_name: 'Admin' },
          { severity: 'belgi', object_name: null, material_name: null },
        ),
      ),
    ).toBe(
      "🔗 <b>Sotuvchilar birlashtirildi</b>\nBaraka → Baraka MChJ\nKo'chirilgan xaridlar: 5 (o'chirilganlar: 1)\nTo'ldirildi: STIR, telefon\nBajardi: Admin\n" +
        WHEN,
    )
  })
})

describe("o'zgargan details", () => {
  it('login_ozgardi first_login', () => {
    const t = formatAlertMessage(alert('login_ozgardi', { first_login: true, target_name: 'Vali', target_role: 'direktor', actor_name: 'Bek', actor_role: 'admin' }))
    expect(t).toContain("🔐 <b>Login o'zgartirildi</b>\nBirinchi marta login berildi\nKimning: Vali · Direktor")
  })
  it('login_changed first_login — sarlavha', () => {
    expect(
      formatLoginChanged({ alert_id: 'a', profile_id: 'p', profile_name: 'Vali', company_name: 'F', actor_name: 'Bek', changed_at: T, first_login: true }),
    ).toMatch(/^🔐 <b>Sizga login berildi<\/b>/)
  })
  it('yozuv_ozgartirildi reason → "Sabab: …"', () => {
    const t = formatAlertMessage(
      alert('yozuv_ozgartirildi', {
        table: 'movements', movement_type: 'chiqim', changed: ['qty_input'], before: { qty_input: 5, unit_input: 'qop' },
        after: { qty_input: 4, unit_input: 'qop' }, reason: 'Xato <sanaldi>', actor_name: 'Admin', author_name: 'Ali',
      }),
    )
    expect(t).toContain('• Miqdor: 5 qop → 4 qop\nSabab: Xato &lt;sanaldi&gt;\n')
  })
  it('cancel_own_entry — "Muallif yozuvni bekor qildi", deleted_at satri yo‘q', () => {
    const t = formatAlertMessage(
      alert(
        'yozuv_tuzatildi',
        {
          via: 'cancel_own_entry', changed: ['deleted_at'], table: 'purchases', reason: 'Ikki marta kiritilgan',
          qty_base: 100, base_unit: 'kg', amount: 250000, actor_profile_id: 'p1', author_id: 'p1', actor_name: 'Ali', author_name: 'Ali',
        },
        { severity: 'belgi' },
      ),
    )
    expect(t).toBe(
      `✏️ <b>Muallif yozuvni bekor qildi</b>\nSement · Obyekt A\n100 kg · 250 000 ${SOM}\nSabab: Ikki marta kiritilgan\nBekor qildi: Ali\n` +
        WHEN,
    )
    expect(t).not.toContain('deleted_at')
  })
  it('digest: yangi turlar qisqa nomi', () => {
    expect(formatAlertDigest([alert('xarid_boshqa_nomidan', {}), alert('sotuvchi_birlashtirildi', {})])).toContain(
      'boshqa nomidan xarid — 1, sotuvchi birlashtirildi — 1',
    )
  })
})

describe('workflowOpenUrl (deep link)', () => {
  const base = 'https://app.example.uz/tg'
  it.each([
    ['request_created', { request_id: UUID }, `${base}?request=${UUID}`],
    ['request_decided', { request_id: UUID.toUpperCase() }, `${base}?request=${UUID}`],
    ['request_approved', { request_id: UUID }, `${base}?request=${UUID}`],
    ['transfer_sent', { transfer_id: UUID }, `${base}?transfer=${UUID}`],
    ['transfer_cancelled', { transfer_id: UUID }, `${base}?transfer=${UUID}`],
    ['transfer_received', { transfer_id: UUID }, `${base}?transfer=${UUID}`],
    ['purchase_for_object', { purchase_id: UUID }, `${base}?purchase=${UUID}`],
    ['purchase_deleted', { purchase_id: UUID }, `${base}?purchase=${UUID}`],
    ['purchase_on_your_name', { purchase_id: UUID }, `${base}?purchase=${UUID}`],
    ['expense_on_your_name', { expense_id: UUID }, `${base}?expense=${UUID}`],
    ['expense_on_your_name', { expense_id: 'x' }, base],
    ['login_changed', { alert_id: UUID }, base],
    ['inventory_applied', { count_id: UUID }, base],
    ['alerts_digest', {}, base],
    ['request_created', { request_id: 'not-uuid' }, base],
    ['transfer_sent', null, base],
  ])('%s → %s', (kind, payload, url) => {
    expect(workflowOpenUrl(base, kind, payload)).toBe(url)
  })
})
