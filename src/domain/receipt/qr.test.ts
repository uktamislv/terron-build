import { describe, expect, it } from 'vitest'
import { RECEIPT_QR_MAX_LENGTH, parseReceiptQr, receiptKey } from './qr'

// Haqiqiy namunalar (manbalar — qr.ts sarlavhasida)
const CHECK = 'https://ofd.soliq.uz/check?t=UZ170703100189&r=643&c=20200518221403&s=248429044289'
const EPI = 'https://ofd.soliq.uz/epi?t=EZ000000000102&r=2121&c=20220929013159&s=420808230750'
const LG = 'https://ofd.soliq.uz/check?t=LG230110007813&r=2478&c=20260415104006&s=322032313241'

describe('parseReceiptQr — haqiqiy namunalar', () => {
  it('/check', () => {
    expect(parseReceiptQr(CHECK)).toEqual({
      url: CHECK,
      host: 'ofd.soliq.uz',
      terminalId: 'UZ170703100189',
      receiptNo: '643',
      fiscalSign: '248429044289',
      datetime: '2020-05-18T22:14:03+05:00',
      total: null,
    })
  })
  it('/epi', () => {
    const q = parseReceiptQr(EPI)
    expect(q?.url).toBe(EPI)
    expect(q?.terminalId).toBe('EZ000000000102')
    expect(q?.receiptNo).toBe('2121')
    expect(q?.fiscalSign).toBe('420808230750')
    expect(q?.datetime).toBe('2022-09-29T01:31:59+05:00')
  })
  it('LG terminal', () => {
    expect(parseReceiptQr(LG)?.datetime).toBe('2026-04-15T10:40:06+05:00')
  })
  it('datetime Toshkent vaqti — UTC ga to\'g\'ri o\'tadi', () => {
    const iso = parseReceiptQr(CHECK)?.datetime ?? ''
    expect(new Date(iso).toISOString()).toBe('2020-05-18T17:14:03.000Z')
  })
})

describe('parseReceiptQr — normallashtirish', () => {
  it('http → https', () => {
    expect(parseReceiptQr(CHECK.replace('https', 'http'))?.url).toBe(CHECK)
  })
  it('sxemasiz', () => {
    expect(parseReceiptQr(CHECK.replace('https://', ''))?.url).toBe(CHECK)
  })
  it('katta harflar: host, yo\'l, kalitlar, terminal', () => {
    const q = parseReceiptQr('HTTPS://OFD.SOLIQ.UZ/CHECK?T=uz170703100189&R=643&C=20200518221403&S=248429044289')
    expect(q?.url).toBe(CHECK)
    expect(q?.terminalId).toBe('UZ170703100189')
  })
  it('qo\'shimcha parametrlar, fragment, oxirgi slash, bo\'sh joylar tashlanadi', () => {
    const q = parseReceiptQr(`  https://ofd.soliq.uz/check/?utm=x&t=UZ170703100189&r=643&c=20200518221403&s=248429044289&lang=ru#top \n`)
    expect(q?.url).toBe(CHECK)
  })
  it('parametr tartibi muhim emas', () => {
    expect(parseReceiptQr('https://ofd.soliq.uz/check?s=248429044289&c=20200518221403&r=643&t=UZ170703100189')?.url).toBe(CHECK)
  })
  it('chek raqamidagi boshlang\'ich nollar olib tashlanadi', () => {
    expect(parseReceiptQr(CHECK.replace('r=643', 'r=000643'))?.receiptNo).toBe('643')
  })
  it('bir xil qiymatli takroriy parametr — qabul', () => {
    expect(parseReceiptQr(`${CHECK}&s=248429044289`)?.fiscalSign).toBe('248429044289')
  })
  it('c yo\'q → datetime null, url da c yo\'q', () => {
    const q = parseReceiptQr('https://ofd.soliq.uz/check?t=UZ170703100189&r=643&s=248429044289')
    expect(q?.datetime).toBeNull()
    expect(q?.url).toBe('https://ofd.soliq.uz/check?t=UZ170703100189&r=643&s=248429044289')
  })
  it('c noto\'g\'ri (30-fevral, 25-soat, qisqa, harf) → datetime null, chek qabul', () => {
    for (const c of ['20230230120000', '20230101250000', '20230101126000', '202301011200', 'abc', '']) {
      const q = parseReceiptQr(CHECK.replace('c=20200518221403', `c=${c}`))
      expect(q?.datetime, c).toBeNull()
      expect(q?.url, c).toBe('https://ofd.soliq.uz/check?t=UZ170703100189&r=643&s=248429044289')
    }
  })
  it('kabisa yili 29-fevral — to\'g\'ri', () => {
    expect(parseReceiptQr(CHECK.replace('c=20200518221403', 'c=20240229235959'))?.datetime).toBe('2024-02-29T23:59:59+05:00')
  })
  it('url kodlangan qiymatlar va bo\'sh joy', () => {
    expect(parseReceiptQr(CHECK.replace('s=248429044289', 's=%20248429044289'))?.fiscalSign).toBe('248429044289')
  })
})

describe('parseReceiptQr — rad etiladi (null)', () => {
  it.each([
    ['bo\'sh', ''],
    ['faqat bo\'sh joy', '   '],
    ['oddiy matn', 'salom'],
    ['boshqa domen', CHECK.replace('ofd.soliq.uz', 'evil.uz')],
    ['o\'xshash domen', CHECK.replace('ofd.soliq.uz', 'ofd.soliq.uz.evil.com')],
    ['subdomen', CHECK.replace('ofd.soliq.uz', 'x.ofd.soliq.uz')],
    ['soliq.uz o\'zi', CHECK.replace('ofd.soliq.uz', 'soliq.uz')],
    ['login bilan', CHECK.replace('ofd.soliq.uz', 'user@ofd.soliq.uz')],
    ['port bilan', CHECK.replace('ofd.soliq.uz', 'ofd.soliq.uz:8443')],
    ['ftp', CHECK.replace('https', 'ftp')],
    ['javascript:', `javascript:alert(1)//${CHECK}`],
    ['boshqa yo\'l', CHECK.replace('/check', '/admin')],
    ['ichki yo\'l', CHECK.replace('/check', '/check/x')],
    ['t yo\'q', 'https://ofd.soliq.uz/check?r=643&c=20200518221403&s=248429044289'],
    ['r yo\'q', 'https://ofd.soliq.uz/check?t=UZ170703100189&c=20200518221403&s=248429044289'],
    ['s yo\'q', 'https://ofd.soliq.uz/check?t=UZ170703100189&r=643&c=20200518221403'],
    ['t noto\'g\'ri', CHECK.replace('UZ170703100189', 'UZ-1707')],
    ['t faqat raqam', CHECK.replace('UZ170703100189', '170703100189')],
    ['r harf', CHECK.replace('r=643', 'r=64a')],
    ['r = 0', CHECK.replace('r=643', 'r=000')],
    ['r manfiy', CHECK.replace('r=643', 'r=-643')],
    ['s harf', CHECK.replace('s=248429044289', 's=24842904428X')],
    ['s juda qisqa', CHECK.replace('s=248429044289', 's=123')],
    ['s bo\'sh', CHECK.replace('s=248429044289', 's=')],
    ['takroriy s turli qiymat', `${CHECK}&s=111111111111`],
    ['takroriy t turli registr ham bitta qiymat emas', `${CHECK}&T=UZ000000000001`],
    ['juda uzun', `${CHECK}&x=${'a'.repeat(RECEIPT_QR_MAX_LENGTH)}`],
  ])('%s', (_name, input) => {
    expect(parseReceiptQr(input)).toBeNull()
  })
  it('satr bo\'lmagan qiymat', () => {
    expect(parseReceiptQr(undefined as unknown as string)).toBeNull()
  })
})

describe('receiptKey', () => {
  it('fiskal belgi', () => {
    const q = parseReceiptQr(CHECK)
    expect(q && receiptKey(q)).toBe('248429044289')
  })
  it('http/https va c farqi kalitga ta\'sir qilmaydi', () => {
    const a = parseReceiptQr(CHECK)
    const b = parseReceiptQr('http://OFD.soliq.uz/check?t=uz170703100189&r=0643&s=248429044289')
    expect(a && b && receiptKey(a) === receiptKey(b)).toBe(true)
  })
})
