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

  it('catalog_material_has_stock — server message (obyekt nomi bilan) ko‘rsatiladi', () => {
    const msg = 'Materialning “Chilonzor 5” obyektida qoldig‘i bor — o‘chirib bo‘lmaydi.'
    const err = toRepoError({ code: 'P0001', hint: 'catalog_material_has_stock', message: msg })
    expect(errorText(err)).toBe(msg)
  })

  it('catalog_material_has_stock, message bo‘sh — i18n matni', () => {
    const err = toRepoError({ code: 'P0001', hint: 'catalog_material_has_stock', message: ' ' })
    expect(errorText(err)).toBe(t.errors.catalog_material_has_stock)
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
    expect(err.userMessage).toBeNull()
  })

  it('42501 + restore_admin_only → shu kod', () => {
    expect(toRepoError({ code: '42501', hint: 'restore_admin_only' }).code).toBe('restore_admin_only')
  })

  it('noma’lum hint → errcode bo‘yicha', () => {
    expect(toRepoError({ code: '42501', hint: 'boshqa_narsa' }).code).toBe('forbidden')
  })
})
