import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { RepoError, SERVER_HINTS, toRepoError, type ServerHintCode } from './errors'

const HINTS = Object.keys(SERVER_HINTS) as ServerHintCode[]

describe('toRepoError / errorText — server hint kalitlari', () => {
  it.each(HINTS)('P0001 + hint %s → shu kod; i18n matni bor', (hint) => {
    const err = toRepoError({ code: 'P0001', hint, message: 'Server matni' })
    expect(err).toBeInstanceOf(RepoError)
    expect(err.code).toBe(hint)
    expect(t.errors[hint]).toBeTruthy()
  })

  it('showServerMessage: false — i18n matni (server message ko‘rsatilmaydi)', () => {
    const err = toRepoError({ code: 'P0001', hint: 'catalog_unit_in_use', message: 'Server matni' })
    expect(errorText(err)).toBe(t.errors.catalog_unit_in_use)
  })

  it('server message hech qachon xom ko‘rsatilmaydi (barcha kalitlar showServerMessage: false)', () => {
    expect(Object.values(SERVER_HINTS).every((h) => !h.showServerMessage)).toBe(true)
  })

  it('catalog_material_has_stock — obyekt nomi xabardan ajratiladi, matn uz.ts shablonidan', () => {
    const msg = 'Materialni o\'chirib bo\'lmaydi: "Chilonzor 5" obyektida qoldig\'i bor. Uni nofaol qiling.'
    const err = toRepoError({ code: 'P0001', hint: 'catalog_material_has_stock', message: msg })
    expect(err.params).toEqual(['Chilonzor 5'])
    expect(errorText(err)).toBe(t.errorsWith.catalog_material_has_stock('Chilonzor 5'))
  })

  it('catalog_material_has_stock, xabar shablonga mos emas — oddiy i18n matni', () => {
    const err = toRepoError({ code: 'P0001', hint: 'catalog_material_has_stock', message: ' ' })
    expect(err.params).toBeNull()
    expect(errorText(err)).toBe(t.errors.catalog_material_has_stock)
  })

  it('estimate_*_invalid — qator raqami details dan (bo‘lmasa xabardan)', () => {
    const a = toRepoError({ code: '22023', hint: 'estimate_item_invalid', message: 'Qator 12: miqdor 0', details: '12' })
    expect(errorText(a)).toBe(t.errorsWith.estimate_item_invalid('12'))
    const b = toRepoError({ code: '22023', hint: 'estimate_aliases_invalid', message: 'Qator 2: x' })
    expect(errorText(b)).toBe(t.errorsWith.estimate_aliases_invalid('2'))
    const c = toRepoError({ code: '22023', hint: 'estimate_materials_invalid', message: 'Materiallar ro‘yxati bo‘sh' })
    expect(errorText(c)).toBe(t.errors.estimate_materials_invalid)
  })

  it('transfer_insufficient_stock — miqdor details dan, birlik xabardan; manfiy — 0', () => {
    const err = toRepoError({ code: '22023', hint: 'transfer_insufficient_stock', message: 'Manba obyektda qoldiq yetarli emas: mavjud 120 kg', details: '120.5' })
    expect(errorText(err)).toBe(t.errorsWith.transfer_insufficient_stock('120,5', 'kg'))
    const neg = toRepoError({ code: '22023', hint: 'transfer_insufficient_stock', message: 'mavjud 0 kg', details: '-3' })
    expect(errorText(neg)).toBe(t.errorsWith.transfer_insufficient_stock('0', 'kg'))
    expect(errorText(toRepoError({ code: '22023', hint: 'transfer_insufficient_stock', message: 'x' }))).toBe(t.errors.transfer_insufficient_stock)
  })

  it('ops_occurred_at_range — detail (UTC ISO) Toshkent vaqtida', () => {
    const err = toRepoError({ code: '23514', hint: 'ops_occurred_at_range', message: 'x', details: '2026-10-23T05:30:00Z' })
    expect(errorText(err)).toBe(t.errorsWith.ops_occurred_at_range('23.10.2026 10:30'))
    expect(errorText(toRepoError({ code: '23514', hint: 'ops_occurred_at_range', message: 'x' }))).toBe(t.errors.ops_occurred_at_range)
  })

  it('yangi kalitlar: purchase_buyer_invalid, rate_limited (54000), alert_close_note_locked', () => {
    expect(toRepoError({ code: '23514', hint: 'purchase_buyer_invalid' }).code).toBe('purchase_buyer_invalid')
    expect(toRepoError({ code: '54000', hint: 'rate_limited' }).code).toBe('rate_limited')
    expect(errorText(toRepoError({ code: 'P0001', hint: 'alert_close_note_locked' }))).toBe(t.errors.alert_close_note_locked)
  })

  it('receipt_already_used — ism va vaqt xabardan', () => {
    const err = toRepoError({ code: '23505', hint: 'receipt_already_used', message: 'Bu chek allaqachon ishlatilgan: Ali Valiyev, 24.10.2026 14:00' })
    expect(errorText(err)).toBe(t.errorsWith.receipt_already_used('Ali Valiyev', '24.10.2026 14:00'))
  })

  it('noma’lum hint yoki hint’siz P0001 — server message hech qachon ko‘rsatilmaydi', () => {
    const msg = 'Bu amalni bajarib bo‘lmaydi.'
    expect(errorText(toRepoError({ code: 'P0001', hint: 'boshqa_kalit', message: msg }))).toBe(t.errors.invalid_value)
    expect(errorText(toRepoError({ code: 'P0001', message: msg }))).toBe(t.errors.invalid_value)
  })

  it('23514 — o‘zbekcha message bo‘lsa ham i18n matni', () => {
    expect(errorText(toRepoError({ code: '23514', message: 'Qoldig‘i bor.' }))).toBe(t.errors.invalid_value)
  })

  it('PGRST116 (qator qaytmadi) → not_found', () => {
    expect(toRepoError({ code: 'PGRST116', message: '0 rows' }).code).toBe('not_found')
  })
})

describe('toRepoError — hint P0001 dan boshqa errcode bilan', () => {
  it('23505 + catalog_unit_duplicate → shu kod (jadval override emas)', () => {
    const err = toRepoError(
      { code: '23505', hint: 'catalog_unit_duplicate', message: 'duplicate' },
      { '23505': 'unit_taken' },
    )
    expect(err.code).toBe('catalog_unit_duplicate')
    expect(err.params).toBeNull()
  })

  it('42501 + restore_admin_only → shu kod', () => {
    expect(toRepoError({ code: '42501', hint: 'restore_admin_only' }).code).toBe('restore_admin_only')
  })

  it('noma’lum hint → errcode bo‘yicha', () => {
    expect(toRepoError({ code: '42501', hint: 'boshqa_narsa' }).code).toBe('forbidden')
  })
})
