// @vitest-environment node
// Fixture'lar sintetik: tuzilma ofd.soliq.uz chek komponentidan (26.10.2026), qiymatlar o'ylab topilgan.
import { describe, expect, it } from 'vitest'
import {
  coerceReceiptData,
  decAdd,
  decDiv,
  handleReceiptLookup,
  matchesQr,
  MAX_RESPONSE_BYTES,
  parseReceiptDateTime,
  parseReceiptDocument,
  qrDateTime,
  readCapped,
  SlidingWindowLimiter,
  toDecimal,
  validateReceiptUrl,
  type Caller,
  type FetchResult,
  type ReceiptData,
  type ReceiptLookupDeps,
  type ReceiptQrParams,
} from './logic.ts'

const URL_CHECK = 'https://ofd.soliq.uz/check?t=UZ000000000001&r=643&c=20261020143005&s=111122223333'
const QR = validateReceiptUrl(URL_CHECK) as ReceiptQrParams

/** Hozirgi haqiqiy javob ko'rinishi: SPA qobig'i, ma'lumotsiz. */
const SPA_SHELL = `<!doctype html>
<html lang="uz"><head><meta charset="UTF-8" /><title>Soliq OFD</title>
<script type="module" crossorigin src="/assets/index-XXXX.js"></script></head>
<body><div id="root"></div></body></html>`

/** API javobi (`POST /api/payment`) — maydon nomlari sayt JS'idan. */
const API_JSON = JSON.stringify({
  success: true,
  data: {
    tin: '301234567',
    paymentDate: '2026-10-20 14:30:05',
    isRefund: 0,
    receiptType: 0,
    cashTotal: 150000,
    cardTotal: 1350000.5,
    vatTotal: 160714.34,
    kkmName: 'Test NKM',
    extraInfo: { companyName: '"QURILISH MOLLARI" MCHJ', address: 'Toshkent sh., Test ko‘chasi 1', paymentType: 4 },
    paymentDetails: [
      { id: 1, name: 'Sement M400 50 kg', amount: 20, price: 1300000, vat: 139285.71, vatPercent: 12 },
      { id: 2, name: 'Mix 100 mm', amount: '2.5', price: '200000.50' },
      { id: 3, name: '', amount: 1, price: 1 },
      'yaroqsiz',
    ],
  },
})

/** Chizilgan chek DOM'i (komponent tuzilmasi bo'yicha). */
const RENDERED_HTML = `<!doctype html><html><body><div id="root"><main class="_page_x"><section class="_card_x">
<div class="_actionsBar_x"><button aria-label="PDF yuklab olish"></button></div>
<div><div class="_cardBody_x">
<p class="_mdCenter_x">Savdo cheki/Sotuv</p>
<p class="_mdCenter_x" style="font-weight: bold;">&quot;QURILISH MOLLARI&quot; MCHJ</p>
<p class="_mdCenter_x">Toshkent sh., Test ko&#8216;chasi 1 301234567</p>
<p>UZ000000000001</p>
<p>Chek raqami: 643</p>
<p>2026-10-20 14:30:05</p>
<table style="border-top:none"><thead><tr><th style="font-weight:bold" class="_colNomi_x">Nomi</th><th>Soni</th><th>Narxi</th></tr></thead>
<tbody>
<tr><td>Sement M400 50 kg</td><td class="_productAmountCell_x">20</td><td style="font-weight:bold">1,300,000.00</td></tr>
<tr class="_rowTextSm_x"><td>QQS qiymati</td><td colspan="2">139285.71</td></tr>
<tr class="_rowTextSm_x"><td>QQS foizi</td><td colspan="2">12 %</td></tr>
<tr class="_rowTextSm_x"><td>MXIK kodi</td><td colspan="2">02523001001000000</td></tr>
<tr><td>Mix 100 mm</td><td>2.5</td><td>200,000.50</td></tr>
<tr class="_summaryRow_x"><td colspan="2">Naqd pul</td><td>150,000.00</td></tr>
<tr class="_summaryRow_x"><td colspan="2">Bank kartalari</td><td>1,350,000.50</td></tr>
<tr class="_summaryRow_x"><td style="font-size:22px">Jami to&#39;lov</td><td colspan="2">1,500,000.50</td></tr>
</tbody></table></div></div></section></main></div>
<script>window.x = "<tr><td>Nomi</td><td>Soni</td></tr>"</script></body></html>`

/** Eski uslubdagi server sahifasi: yorliq: qiymat, ruscha ustunlar. */
const LEGACY_HTML = `<html><body>
<h3>ООО TEST STROY</h3>
<div>ИНН: 301 234 567</div>
<div>ФМ: UZ000000000001</div>
<div>ФП: 111122223333</div>
<div>Номер чека: 0643</div>
<div>20.10.2026 14:30</div>
<table><tr><th>Наименование</th><th>Кол-во</th><th>Сумма</th></tr>
<tr><td>Кирпич</td><td>1 000</td><td>1 200 000,00</td></tr>
<tr><td>Итого</td><td></td><td>1 200 000,00</td></tr></table>
</body></html>`

describe('validateReceiptUrl', () => {
  it('/check — kanonik URL va maydonlar', () => {
    expect(QR).toEqual({
      url: URL_CHECK,
      kind: 'check',
      terminalId: 'UZ000000000001',
      receiptNo: '643',
      fiscalSign: '111122223333',
      datetime: '2026-10-20T14:30:05+05:00',
    })
  })
  it('/epi, katta harflar, ortiqcha parametr va fragment, boshlang\'ich nollar', () => {
    const q = validateReceiptUrl('https://OFD.SOLIQ.UZ/EPI/?T=ez000000000102&R=002121&c=20220929013159&s=420808230750&utm=x#top')
    expect(q?.url).toBe('https://ofd.soliq.uz/epi?t=EZ000000000102&r=2121&c=20220929013159&s=420808230750')
    expect(q?.kind).toBe('epi')
  })
  it('c noto\'g\'ri yoki yo\'q — qabul, datetime null, URL da c yo\'q', () => {
    expect(validateReceiptUrl(URL_CHECK.replace('20261020143005', '20260230120000'))?.url).toBe(
      'https://ofd.soliq.uz/check?t=UZ000000000001&r=643&s=111122223333',
    )
    expect(validateReceiptUrl('https://ofd.soliq.uz/check?t=UZ000000000001&r=643&s=111122223333')?.datetime).toBeNull()
  })
  it.each([
    ['http', URL_CHECK.replace('https:', 'http:')],
    ['boshqa host', URL_CHECK.replace('ofd.soliq.uz', 'ofd.soliq.uz.evil.com')],
    ['subdomen', URL_CHECK.replace('ofd.soliq.uz', 'x.ofd.soliq.uz')],
    ['new-ofd host', URL_CHECK.replace('ofd.soliq.uz', 'new-ofd.soliq.uz')],
    ['port', URL_CHECK.replace('ofd.soliq.uz', 'ofd.soliq.uz:8443')],
    ['login', URL_CHECK.replace('https://', 'https://a:b@')],
    ['boshqa yo\'l', URL_CHECK.replace('/check', '/api/payment')],
    ['t yo\'q', 'https://ofd.soliq.uz/check?r=643&s=111122223333'],
    ['s yo\'q', 'https://ofd.soliq.uz/check?t=UZ000000000001&r=643'],
    ['t format', URL_CHECK.replace('UZ000000000001', 'UZ1')],
    ['r harf', URL_CHECK.replace('r=643', 'r=64a')],
    ['takroriy har xil s', `${URL_CHECK}&s=999999999999`],
    ['javascript:', 'javascript:alert(1)'],
    ['bo\'sh', ''],
    ['juda uzun', `${URL_CHECK}&x=${'a'.repeat(3000)}`],
  ])('rad: %s', (_n, u) => {
    expect(validateReceiptUrl(u)).toBeNull()
  })
  it('satr emas → null', () => {
    expect(validateReceiptUrl(123)).toBeNull()
    expect(validateReceiptUrl(null)).toBeNull()
  })
})

describe('o\'nlik yordamchilar', () => {
  it.each([
    ['1,300,000.00', '1300000'],
    ['1 300 000,50', '1300000.5'],
    ['1 300 000,50 so‘m', '1300000.5'],
    ['1234567', '1234567'],
    ['2.5', '2.5'],
    ['30,5', '30.5'],
    ['0,125', '0.125'],
    ['1,234', '1234'],
    ['-150.00', '-150'],
    [1350000.5, '1350000.5'],
    [20, '20'],
  ])('toDecimal(%j) = %s', (v, out) => {
    expect(toDecimal(v)).toBe(out)
  })
  it.each([['abc'], [''], ['1.2.3'], ['1,23,4'], [Number.NaN], [Infinity], [null], [{}], [1e21]])('toDecimal(%j) = null', (v) => {
    expect(toDecimal(v)).toBeNull()
  })
  it('decAdd aniq (float xatosiz)', () => {
    expect(decAdd('0.1', '0.2')).toBe('0.3')
    expect(decAdd('150000', '1350000.5')).toBe('1500000.5')
    expect(decAdd('-5', '2.25')).toBe('-2.75')
  })
  it('decDiv yaxlitlash va 0 ga bo\'lish', () => {
    expect(decDiv('1300000', '20')).toBe('65000')
    expect(decDiv('200000.5', '2.5')).toBe('80000.2')
    expect(decDiv('10', '3')).toBe('3.33')
    expect(decDiv('20', '3')).toBe('6.67')
    expect(decDiv('1', '0')).toBeNull()
  })
})

describe('sana-vaqt', () => {
  it('qrDateTime', () => {
    expect(qrDateTime('20240229235959')).toBe('2024-02-29T23:59:59+05:00')
    expect(qrDateTime('20230229120000')).toBeNull()
    expect(qrDateTime('20230101246000')).toBeNull()
  })
  it('parseReceiptDateTime ko\'rinishlari', () => {
    expect(parseReceiptDateTime('2026-10-20 14:30:05')).toBe('2026-10-20T14:30:05+05:00')
    expect(parseReceiptDateTime('2026-10-20T14:30')).toBe('2026-10-20T14:30:00+05:00')
    expect(parseReceiptDateTime('20.10.2026 9:05')).toBe('2026-10-20T09:05:00+05:00')
    expect(parseReceiptDateTime('20261020143005')).toBe('2026-10-20T14:30:05+05:00')
    expect(parseReceiptDateTime('kecha')).toBeNull()
    expect(parseReceiptDateTime(null)).toBeNull()
  })
})

const EXPECTED_ITEMS = [
  { name: 'Sement M400 50 kg', qty: '20', price: '65000', sum: '1300000' },
  { name: 'Mix 100 mm', qty: '2.5', price: '80000.2', sum: '200000.5' },
]

describe('parseReceiptDocument', () => {
  it('SPA qobig\'i → null', () => {
    expect(parseReceiptDocument(SPA_SHELL, 'text/html', QR)).toBeNull()
  })
  it('API JSON', () => {
    const r = parseReceiptDocument(API_JSON, 'application/json', QR)
    expect(r).toEqual<ReceiptData>({
      sellerName: '"QURILISH MOLLARI" MCHJ',
      sellerTin: '301234567',
      datetime: '2026-10-20T14:30:05+05:00',
      total: '1500000.5',
      items: EXPECTED_ITEMS,
      fiscalSign: '111122223333',
      terminalId: 'UZ000000000001',
      receiptNo: '643',
    })
  })
  it('API xato javobi → null', () => {
    expect(parseReceiptDocument('{"success":false,"message":"Imzo topilmadi","data":null,"status":401}', 'application/json', QR)).toBeNull()
  })
  it('chizilgan chek HTML', () => {
    const r = parseReceiptDocument(RENDERED_HTML, 'text/html; charset=utf-8', QR)
    expect(r).toEqual<ReceiptData>({
      sellerName: '"QURILISH MOLLARI" MCHJ',
      sellerTin: '301234567',
      datetime: '2026-10-20T14:30:05+05:00',
      total: '1500000.5',
      items: EXPECTED_ITEMS,
      fiscalSign: '111122223333',
      terminalId: 'UZ000000000001',
      receiptNo: '643',
    })
  })
  it('jami qatori yo\'q — naqd + karta yig\'indisi', () => {
    const html = RENDERED_HTML.replace(/<tr class="_summaryRow_x"><td style[\s\S]*?<\/tr>/, '')
    expect(parseReceiptDocument(html, 'text/html', QR)?.total).toBe('1500000.5')
  })
  it('eski uslub (ruscha yorliqlar)', () => {
    const r = parseReceiptDocument(LEGACY_HTML, 'text/html', QR)
    expect(r?.sellerName).toBe('ООО TEST STROY')
    expect(r?.sellerTin).toBe('301234567')
    expect(r?.terminalId).toBe('UZ000000000001')
    expect(r?.fiscalSign).toBe('111122223333')
    expect(r?.receiptNo).toBe('643')
    expect(r?.datetime).toBe('2026-10-20T14:30:00+05:00')
    expect(r?.total).toBe('1200000')
    expect(r?.items).toEqual([{ name: 'Кирпич', qty: '1000', price: '1200', sum: '1200000' }])
  })
  it('qisman: faqat jami — qolganlari null, QR maydonlari to\'ldiriladi', () => {
    const r = parseReceiptDocument('<table><tr><td>Jami to‘lov</td><td>5 000,00</td></tr></table>', null, QR)
    expect(r).toEqual<ReceiptData>({
      sellerName: null,
      sellerTin: null,
      datetime: QR.datetime,
      total: '5000',
      items: [],
      fiscalSign: QR.fiscalSign,
      terminalId: QR.terminalId,
      receiptNo: QR.receiptNo,
    })
  })
  it('nom HTML entity bilan dekodlanadi, teglar olib tashlanadi', () => {
    const html = RENDERED_HTML.replace('Mix 100 mm', 'Mix &lt;100&gt; <i>mm</i> &amp; &#x41;')
    expect(parseReceiptDocument(html, 'text/html', QR)?.items[1]?.name).toBe('Mix <100> mm & A')
  })
  it.each([
    ['bo\'sh', ''],
    ['matn', 'salom'],
    ['buzilgan JSON', '{"data": {'],
    ['JSON massiv', '[1,2,3]'],
    ['yopilmagan teglar', '<table><tr><td>Nomi<td>Soni<tr><td>x'],
    ['chuqur ichma-ich', '<div>'.repeat(5000) + 'x' + '</div>'.repeat(5000)],
    ['g\'alati entity', '<p>&#xFFFFFFF; &#55296; &bogus;</p>'],
    ['katta tasodifiy', '<'.repeat(100000)],
  ])('xato tashlamaydi: %s', (_n, body) => {
    expect(() => parseReceiptDocument(body, 'text/html', QR)).not.toThrow()
    expect(parseReceiptDocument(body, 'text/html', QR)).toBeNull()
  })
  it.each([
    ['<tr>', '<tr>'],
    ['<td>', '<td>'],
    ['<span>', '<span>'],
    ['<p>', '<p>'],
    ['<div>', '<div>'],
    ['<script', '<script'],
    ['<!--', '<!--'],
    ['<a ', '<a '],
  ])('1 MB yovuz kirish tez ishlaydi (chiziqli): %s', (_n, unit) => {
    const body = '<html>' + unit.repeat(Math.floor(MAX_RESPONSE_BYTES / unit.length))
    const t0 = performance.now()
    expect(() => parseReceiptDocument(body, 'text/html', QR)).not.toThrow()
    expect(performance.now() - t0).toBeLessThan(1500)
  })
  it('script ichidagi jadval va izoh hisobga olinmaydi', () => {
    const html = '<!-- <table><tr><td>Jami to‘lov</td><td>9</td></tr></table> --><script>"<tr><td>Jami to‘lov</td><td>8</td></tr>"</script><table><tr><td>Jami to‘lov</td><td>7</td></tr></table>'
    expect(parseReceiptDocument(html, 'text/html', QR)?.total).toBe('7')
  })
  it('qatorlar soni cheklangan (500)', () => {
    const rows = Array.from({ length: 700 }, (_, i) => `<tr><td>M${i}</td><td>1</td><td>10.00</td></tr>`).join('')
    const html = `<table><tr><th>Nomi</th><th>Soni</th><th>Narxi</th></tr>${rows}</table>`
    expect(parseReceiptDocument(html, 'text/html', QR)?.items.length).toBe(500)
  })
})

describe('QR bilan moslik (fiskal belgi, terminal)', () => {
  const apiWith = (over: Record<string, unknown>) => {
    const j = JSON.parse(API_JSON) as { data: Record<string, unknown> }
    return JSON.stringify({ ...j, data: { ...j.data, ...over } })
  }
  it('bir xil (bo\'sh joy / registr farqi bilan ham) — qabul', () => {
    const r = parseReceiptDocument(apiWith({ fiscalSign: ' 111122223333 ', terminalId: 'uz000000000001' }), 'application/json', QR)
    expect(r?.total).toBe('1500000.5')
  })
  it('fiskal belgi boshqa → null', () => {
    expect(parseReceiptDocument(apiWith({ fiscalSign: '999999999999' }), 'application/json', QR)).toBeNull()
  })
  it('terminal boshqa → null (JSON va HTML)', () => {
    expect(parseReceiptDocument(apiWith({ terminalId: 'UZ000000000002' }), 'application/json', QR)).toBeNull()
    expect(parseReceiptDocument(RENDERED_HTML.replace('<p>UZ000000000001</p>', '<p>UZ000000000009</p>'), 'text/html', QR)).toBeNull()
    expect(parseReceiptDocument(LEGACY_HTML.replace('ФП: 111122223333', 'ФП: 123456789012'), 'text/html', QR)).toBeNull()
  })
  it('matchesQr: null maydonlar tekshirilmaydi', () => {
    expect(matchesQr({ fiscalSign: null, terminalId: null }, QR)).toBe(true)
    expect(matchesQr({ fiscalSign: '111122223333', terminalId: null }, QR)).toBe(true)
    expect(matchesQr({ fiscalSign: null, terminalId: 'EZ000000000001' }, QR)).toBe(false)
  })
})

describe('coerceReceiptData (kesh)', () => {
  it('to\'g\'ri qiymat — o\'zgarmaydi (round-trip)', () => {
    const r = parseReceiptDocument(API_JSON, 'application/json', QR) as ReceiptData
    expect(coerceReceiptData(JSON.parse(JSON.stringify(r)))).toEqual(r)
  })
  it('noto\'g\'ri shakl → null; noto\'g\'ri sonlar → null maydon', () => {
    expect(coerceReceiptData(null)).toBeNull()
    expect(coerceReceiptData({ items: 'x' })).toBeNull()
    expect(coerceReceiptData({ items: [], total: 'abc' })).toBeNull()
    const r = coerceReceiptData({ items: [{ name: 'A', qty: 'x', price: 1, sum: '2.50' }, { bad: 1 }], total: '2.5', sellerTin: '12' })
    expect(r?.items).toEqual([{ name: 'A', qty: null, price: '1', sum: '2.5' }])
    expect(r?.sellerTin).toBeNull()
  })
})

describe('readCapped', () => {
  const streamOf = (parts: string[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(new TextEncoder().encode(p))
        c.close()
      },
    })
  it('chegaragacha o\'qiydi (UTF-8)', async () => {
    expect(await readCapped(streamOf(['Sement ', 'ko‘k']), 1000)).toBe('Sement ko‘k')
  })
  it('oshsa null', async () => {
    expect(await readCapped(streamOf(['a'.repeat(600), 'b'.repeat(600)]), 1000)).toBeNull()
    expect(MAX_RESPONSE_BYTES).toBe(1048576)
  })
  it('body yo\'q → bo\'sh satr', async () => {
    expect(await readCapped(null, 10)).toBe('')
  })
})

describe('handleReceiptLookup', () => {
  const CALLER: Caller = { profileId: 'p1', companyId: 'c1' }
  function fake(
    opts: {
      authId?: string | null
      caller?: Caller | null
      cache?: ReceiptData | null
      cacheThrows?: boolean
      page?: FetchResult
      fetchThrows?: boolean
    } = {},
  ) {
    const fetched: string[] = []
    const puts: ReceiptData[] = []
    const deps: ReceiptLookupDeps = {
      getAuthUserIdFromJwt: async () => ('authId' in opts ? (opts.authId ?? null) : 'auth-1'),
      getActiveProfile: async () => ('caller' in opts ? (opts.caller ?? null) : CALLER),
      cacheGet: async () => {
        if (opts.cacheThrows) throw new Error('cache down')
        return opts.cache ?? null
      },
      cachePut: async (_jwt, _c, _qr, data) => {
        if (opts.cacheThrows) throw new Error('cache down')
        puts.push(data)
      },
      fetchPage: async (url) => {
        fetched.push(url)
        if (opts.fetchThrows) throw new Error('boom')
        return opts.page ?? { ok: true, body: API_JSON, contentType: 'application/json' }
      },
      log: () => undefined,
    }
    return { deps, fetched, puts }
  }
  const AUTH = 'Bearer user.jwt.token'

  it('JWT yo\'q → 401', async () => {
    const { deps } = fake()
    expect((await handleReceiptLookup(null, { url: URL_CHECK }, deps)).status).toBe(401)
    expect((await handleReceiptLookup('Basic x', { url: URL_CHECK }, deps)).status).toBe(401)
  })
  it('anon / yaroqsiz JWT → 401', async () => {
    const { deps, fetched } = fake({ authId: null })
    const r = await handleReceiptLookup(AUTH, { url: URL_CHECK }, deps)
    expect(r).toEqual({ status: 401, body: { error: 'unauthorized' } })
    expect(fetched).toEqual([])
  })
  it('faol profil yo\'q → 403', async () => {
    const { deps } = fake({ caller: null })
    expect((await handleReceiptLookup(AUTH, { url: URL_CHECK }, deps)).status).toBe(403)
  })
  it('body yaroqsiz → 400 invalid_request', async () => {
    const { deps } = fake()
    expect(await handleReceiptLookup(AUTH, null, deps)).toEqual({ status: 400, body: { error: 'invalid_request' } })
    expect((await handleReceiptLookup(AUTH, { url: 5 }, deps)).status).toBe(400)
  })
  it('ruxsatsiz URL → 400 receipt_url_not_allowed, so\'rov yuborilmaydi', async () => {
    const { deps, fetched } = fake()
    const r = await handleReceiptLookup(AUTH, { url: 'https://evil.example/check?t=UZ000000000001&r=1&s=111111' }, deps)
    expect(r).toEqual({ status: 400, body: { error: 'receipt_url_not_allowed' } })
    expect(fetched).toEqual([])
  })
  it('muvaffaqiyat: kanonik URL so\'raladi, keshga yoziladi', async () => {
    const { deps, fetched, puts } = fake()
    const r = await handleReceiptLookup(AUTH, { url: `${URL_CHECK}&utm=1` }, deps)
    expect(r.status).toBe(200)
    expect(fetched).toEqual([URL_CHECK])
    expect((r.body as { cached: boolean }).cached).toBe(false)
    expect((r.body as { receipt: ReceiptData }).receipt.total).toBe('1500000.5')
    expect(puts.length).toBe(1)
  })
  it('kesh topilsa — so\'rov yo\'q', async () => {
    const cached = parseReceiptDocument(API_JSON, 'application/json', QR) as ReceiptData
    const { deps, fetched } = fake({ cache: cached })
    const r = await handleReceiptLookup(AUTH, { url: URL_CHECK }, deps)
    expect(r).toEqual({ status: 200, body: { receipt: cached, cached: true } })
    expect(fetched).toEqual([])
  })
  it('kesh xatosi — baribir ishlaydi', async () => {
    const { deps } = fake({ cacheThrows: true })
    expect((await handleReceiptLookup(AUTH, { url: URL_CHECK }, deps)).status).toBe(200)
  })
  it('SPA qobig\'i → 422 receipt_unparseable + qr', async () => {
    const { deps, puts } = fake({ page: { ok: true, body: SPA_SHELL, contentType: 'text/html' } })
    const r = await handleReceiptLookup(AUTH, { url: URL_CHECK }, deps)
    expect(r).toEqual({
      status: 422,
      body: {
        error: 'receipt_unparseable',
        qr: {
          url: URL_CHECK,
          fiscalSign: '111122223333',
          terminalId: 'UZ000000000001',
          receiptNo: '643',
          datetime: '2026-10-20T14:30:05+05:00',
        },
      },
    })
    expect(puts).toEqual([])
  })
  it('sahifadagi fiskal belgi / terminal QR\'dan farq qilsa → 422, keshga yozilmaydi', async () => {
    for (const over of [{ fiscalSign: '999999999999' }, { terminalId: 'UZ000000000002' }]) {
      const j = JSON.parse(API_JSON) as { data: Record<string, unknown> }
      const body = JSON.stringify({ ...j, data: { ...j.data, ...over } })
      const { deps, puts } = fake({ page: { ok: true, body, contentType: 'application/json' } })
      const r = await handleReceiptLookup(AUTH, { url: URL_CHECK }, deps)
      expect(r.status).toBe(422)
      expect(r.body).toMatchObject({ error: 'receipt_unparseable', qr: { fiscalSign: '111122223333' } })
      expect(puts).toEqual([])
    }
  })
  it('chegara: 20 ta / 10 daqiqa profil bo\'yicha → 21-chisi 429 rate_limited, retry_after_sec; boshqa profil ta\'sirlanmaydi', async () => {
    const limiter = new SlidingWindowLimiter()
    let now = 1_000_000
    const { deps, fetched } = fake()
    deps.limiter = limiter
    deps.now = () => now
    for (let i = 0; i < 20; i++) {
      expect((await handleReceiptLookup(AUTH, { url: URL_CHECK }, deps)).status).toBe(200)
      now += 1000
    }
    const r = await handleReceiptLookup(AUTH, { url: URL_CHECK }, deps)
    expect(r).toEqual({ status: 429, body: { error: 'rate_limited', retry_after_sec: 580 } })
    expect(fetched).toHaveLength(20)
    // boshqa profil
    deps.getActiveProfile = async () => ({ profileId: 'p2', companyId: 'c1' })
    expect((await handleReceiptLookup(AUTH, { url: URL_CHECK }, deps)).status).toBe(200)
    // oyna o'tgach — yana ruxsat
    deps.getActiveProfile = async () => ({ profileId: 'p1', companyId: 'c1' })
    now += 600_000
    expect((await handleReceiptLookup(AUTH, { url: URL_CHECK }, deps)).status).toBe(200)
  })
  it('SlidingWindowLimiter: kalitlar soni cheklangan', () => {
    const l = new SlidingWindowLimiter(1, 1000, 2)
    expect(l.hit('a', 0)).toEqual({ ok: true })
    expect(l.hit('a', 10)).toEqual({ ok: false, retryAfterSec: 1 })
    l.hit('b', 0)
    l.hit('c', 0) // 'a' chiqarib yuboriladi
    expect(l.hit('a', 20)).toEqual({ ok: true })
  })
  it.each(['timeout', 'redirect', 'too_large', 'http_status', 'network'] as const)('olinmadi (%s) → 502', async (reason) => {
    const { deps } = fake({ page: { ok: false, reason } })
    const r = await handleReceiptLookup(AUTH, { url: URL_CHECK }, deps)
    expect(r.status).toBe(502)
    expect(r.body).toMatchObject({ error: 'receipt_fetch_failed', reason, qr: { fiscalSign: '111122223333' } })
  })
  it('fetchPage xato tashlasa → 502 network', async () => {
    const { deps } = fake({ fetchThrows: true })
    expect((await handleReceiptLookup(AUTH, { url: URL_CHECK }, deps)).body).toMatchObject({ reason: 'network' })
  })
})
