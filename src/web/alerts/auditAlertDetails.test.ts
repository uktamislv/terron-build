// Audit tuzatishlari: yangi alert turlari matni (docs/audit-fixes.md "Yangi alert turlari") — aniq kalitlar bilan.
import type { AlertType } from '@/data/types'
import { ALERT_TYPES } from '@/data/types'
import { t } from '@/i18n'
import { plain } from '@/test/text'
import { alertDetailText as raw, entryChanges } from './alertDetails'

const text = (type: AlertType, details: Record<string, unknown>, base_unit: string | null = null) => plain(raw({ type, details, base_unit }))

describe('yangi alert turlari', () => {
  it('har bir turning nomi bor (ikonka — AlertTypeIcon switch, tsc tekshiradi)', () => {
    for (const type of ['yozuv_ozgartirildi', 'yozuv_tuzatildi', 'sozlama_ozgardi', 'login_ozgardi', 'podotchet_belgisi', 'sotuvchi_stir_farqi'] as const) {
      expect(ALERT_TYPES).toContain(type)
      expect(t.alertTexts.types[type]).toBeTruthy()
    }
  })

  it('yozuv_ozgartirildi: oldin → keyin (miqdor birligi bilan), muallif alohida', () => {
    const s = text('yozuv_ozgartirildi', {
      table: 'movements',
      movement_type: 'kirim',
      material_name: 'Sement',
      base_unit: 'kg',
      changed: ['qty_base', 'qty_input'],
      before: { qty_input: 3, qty_base: 150, unit_input: 'qop' },
      after: { qty_input: 5, qty_base: 250, unit_input: 'qop' },
      via: 'direct',
      actor_name: 'Admin',
      author_name: 'Prorab Ali',
    })
    expect(s).toBe('Kirim o‘zgartirildi: Sement — Miqdor: 3 qop → 5 qop (Admin; muallif: Prorab Ali)')
  })

  it('xarid: summa va sana; id ustunlari — "o‘zgardi"', () => {
    const changes = entryChanges({
      table: 'purchases',
      changed: ['buyer_id', 'purchased_at', 'total_amount'],
      before: { total_amount: '100000', purchased_at: '2026-10-25T05:00:00Z', buyer_id: 'a', unit_input: 'qop' },
      after: { total_amount: '120000', purchased_at: '2026-10-26T05:00:00Z', buyer_id: 'b', unit_input: 'qop' },
    }).map(plain)
    expect(changes).toEqual(['Xaridor o‘zgardi', 'Xarid sanasi: 25.10.2026 10:00 → 26.10.2026 10:00', 'Summa: 100 000 so‘m → 120 000 so‘m'])
  })

  it('faqat birlik o‘zgarsa — unit_input bo‘yicha', () => {
    expect(entryChanges({ changed: ['qty_base', 'unit_id'], before: { unit_input: 'qop' }, after: { unit_input: 'kg' } })).toEqual(['Birlik: qop → kg'])
  })

  it('yozuv_tuzatildi: muallif tuzatishi (belgi)', () => {
    const s = text('yozuv_tuzatildi', {
      table: 'purchases',
      material_name: 'Qum',
      changed: ['total_amount'],
      before: { total_amount: 50000 },
      after: { total_amount: 55000 },
      via: 'correct_entry',
      actor_name: 'Ali',
      author_name: 'Ali',
    })
    expect(s).toBe('Ali o‘z xaridini tuzatdi: Qum — Summa: 50 000 so‘m → 55 000 so‘m')
  })

  it('sozlama_ozgardi: kalit yorlig‘i, tinch soatlar vaqti, o‘chiq', () => {
    const s = text('sozlama_ozgardi', {
      changes: [
        { key: 'price_deviation_pct', before: 8, after: 15 },
        { key: 'quiet_hours_start', before: '22:00:00', after: null },
        { key: 'noma_lum', before: 1, after: 2 },
      ],
      actor_name: 'Admin',
    })
    expect(s).toBe(`Sozlama o‘zgardi: ${t.settings.priceDeviationPct}: 8 → 15; Tinch soatlar boshlanishi: 22:00 → o‘chiq; noma_lum: 1 → 2 (Admin)`)
  })

  it('sozlama_ozgardi (material / xarajat turi nazorati): qaysi yozuv — target_name', () => {
    expect(
      text('sozlama_ozgardi', {
        kind: 'material_control',
        target_name: 'Sement M400',
        changes: [{ key: 'material_photo_required', before: false, after: true }],
        actor_name: 'Admin',
      }),
    ).toMatch(/^“Sement M400” nazorati o‘zgardi: Material: rasm majburiy: .+ → .+ \(Admin\)$/)
    expect(
      text('sozlama_ozgardi', {
        kind: 'expense_category_control',
        target_name: 'Yoqilg‘i',
        changes: [{ key: 'category_monthly_limit', before: null, after: '5000000.00' }],
        actor_name: null,
      }),
    ).toMatch(/^“Yoqilg‘i” nazorati o‘zgardi: Xarajat turi: oylik limit: /)
  })

  it('login_ozgardi: kim uchun, rol, kim o‘zgartirdi', () => {
    expect(text('login_ozgardi', { target_name: 'Vali', target_role: 'prorab', actor_name: 'Admin', changed_at: '2026-10-26T10:00:00Z' })).toBe(
      'Vali (Prorab) uchun veb login o‘zgartirildi — Admin',
    )
    expect(text('login_ozgardi', { target_name: 'Vali', target_role: null, actor_name: null })).toBe('Vali uchun veb login o‘zgartirildi')
  })

  it('podotchet_belgisi: qaytarish va oynadan tashqari sana', () => {
    const s = text('podotchet_belgisi', {
      table: 'cash_advances',
      reasons: ['qaytarildi', 'issued_at_outside_window'],
      cash_kind: 'qaytarildi',
      amount: '500000',
      issued_at: '2026-10-10T07:00:00Z',
      recipient_name: 'Ali',
      actor_name: 'Buxgalter',
    })
    expect(s).toBe('Ali: 500 000 so‘m qaytarildi — pul qaytarildi, sana 3 kundan oldingi (10.10.2026)')
  })

  it('sotuvchi_stir_farqi: chekdagi va tanlangan STIR', () => {
    expect(text('sotuvchi_stir_farqi', { seller_tin: '123456789', supplier_name: 'Bozor', supplier_tin: '987654321' })).toBe(
      'Chekdagi sotuvchi STIR 123456789, tanlangan sotuvchi “Bozor”: 987654321',
    )
    expect(text('sotuvchi_stir_farqi', { seller_tin: '123456789', supplier_name: 'Bozor', supplier_tin: null })).toContain('STIR kiritilmagan')
  })
})

describe('o‘zgargan detail kalitlari', () => {
  it('manfiy_qoldiq.movement_deleted — sabab: kirim o‘chirildi', () => {
    const s = text('manfiy_qoldiq', { stock_after: '-50', qty_base: '100', unit: 'kg', movement_type: 'kirim', movement_deleted: true })
    expect(s).toBe('Qoldiq manfiy: −50 kg (Kirim 100 kg o‘chirildi)')
  })

  it('manfiy_qoldiq — oddiy chiqim avvalgidek', () => {
    expect(text('manfiy_qoldiq', { stock_after: '-5', qty_base: '20', unit: 'kg', movement_type: 'chiqim' })).toBe('Qoldiq manfiy: −5 kg (oxirgi chiqim 20 kg)')
  })

  it('inventarizatsiya_kamomadi.movements_during_count — sanash paytidagi harakatlar', () => {
    const s = text('inventarizatsiya_kamomadi', {
      items: [{ material_name: 'Sement', base_unit: 'kg', shortage: '10' }],
      movements_during_count: [
        { material_id: 'm1', material_name: 'Sement', count: 2 },
        { material_id: 'm2', material_name: 'Qum', count: 1 },
      ],
      movements_during_count_total: 3,
    })
    expect(s).toContain('Sanash paytida 3 ta harakat kiritilgan: Sement (2), Qum (1) — natijani tekshiring')
  })
})
