// Fiskal chek QR havolasi — umumiy test vektorlari. Ikkala tomon ham shu ro'yxat bilan tekshiriladi:
//   - klient: src/domain/receipt/qr.ts → parseReceiptQr (Mini App skaneri);
//   - server: supabase/functions/receipt-lookup/logic.ts → validateReceiptUrl (Edge Function).
// Klient normallashtirgan `url` ni serverga yuboradi — shuning uchun qabul/rad va t/r/s/c maydonlari
// ikkala tomonda bir xil bo'lishi shart (supabase/functions/receipt-lookup/logic.test.ts → "QR parity").
// Faqat test kodi import qiladi.

export interface QrVectorExpect {
  /** Terminal (fiskal modul) ID, katta harflarda. */
  t: string
  /** Chek raqami, boshidagi nollarsiz. */
  r: string
  /** Fiskal belgi. */
  s: string
  /** `c` dan ISO vaqt (+05:00) yoki null (yo'q / noto'g'ri). */
  c: string | null
  /** Normallashtirilgan havola. */
  url: string
}

export interface QrVector {
  name: string
  input: string
  /**
   * `false` — sxemasiz yoki http: klient https'ga normallashtiradi, server faqat https qabul qiladi
   * (bunday satr serverga to'g'ridan-to'g'ri hech qachon bormaydi — klient `url` ini yuboradi).
   */
  https: boolean
  /** null — rad etiladi. */
  expect: QrVectorExpect | null
}

const BASE = 'https://ofd.soliq.uz'

export const QR_VECTORS: readonly QrVector[] = [
  // --- qabul qilinadi -------------------------------------------------------
  {
    name: 'rasmiy namuna (check)',
    input: `${BASE}/check?t=UZ170703100189&r=643&c=20200518221403&s=248429044289`,
    https: true,
    expect: {
      t: 'UZ170703100189',
      r: '643',
      s: '248429044289',
      c: '2020-05-18T22:14:03+05:00',
      url: `${BASE}/check?t=UZ170703100189&r=643&c=20200518221403&s=248429044289`,
    },
  },
  {
    name: 'rasmiy namuna (epi)',
    input: `${BASE}/epi?t=EZ000000000102&r=2121&c=20220929013159&s=420808230750`,
    https: true,
    expect: {
      t: 'EZ000000000102',
      r: '2121',
      s: '420808230750',
      c: '2022-09-29T01:31:59+05:00',
      url: `${BASE}/epi?t=EZ000000000102&r=2121&c=20220929013159&s=420808230750`,
    },
  },
  {
    name: 'c yo`q',
    input: `${BASE}/check?t=UZ000000000001&r=1&s=111122223333`,
    https: true,
    expect: { t: 'UZ000000000001', r: '1', s: '111122223333', c: null, url: `${BASE}/check?t=UZ000000000001&r=1&s=111122223333` },
  },
  {
    name: 'parametrlar tartibi boshqa, kichik harfli terminal, oxirida /',
    input: `${BASE}/check/?s=111122223333&c=20261020143005&r=0007&t=uz000000000001`,
    https: true,
    expect: {
      t: 'UZ000000000001',
      r: '7',
      s: '111122223333',
      c: '2026-10-20T14:30:05+05:00',
      url: `${BASE}/check?t=UZ000000000001&r=7&c=20261020143005&s=111122223333`,
    },
  },
  {
    name: 'host va parametr nomlari katta harfda, # va qo`shimcha parametr',
    input: `HTTPS://OFD.SOLIQ.UZ/CHECK?T=UZ000000000001&R=12&S=111122223333&utm=x#frag`,
    https: true,
    expect: { t: 'UZ000000000001', r: '12', s: '111122223333', c: null, url: `${BASE}/check?t=UZ000000000001&r=12&s=111122223333` },
  },
  {
    name: 'atrofida bo`sh joy',
    input: `  ${BASE}/check?t=UZ000000000001&r=5&s=123456  `,
    https: true,
    expect: { t: 'UZ000000000001', r: '5', s: '123456', c: null, url: `${BASE}/check?t=UZ000000000001&r=5&s=123456` },
  },
  {
    name: 'takroriy parametr bir xil qiymat bilan',
    input: `${BASE}/check?t=UZ000000000001&r=5&r=5&s=123456`,
    https: true,
    expect: { t: 'UZ000000000001', r: '5', s: '123456', c: null, url: `${BASE}/check?t=UZ000000000001&r=5&s=123456` },
  },
  {
    name: 'noto`g`ri c (kalendarda yo`q sana) — chek qabul, vaqt null',
    input: `${BASE}/check?t=UZ000000000001&r=5&c=20260230120000&s=123456`,
    https: true,
    expect: { t: 'UZ000000000001', r: '5', s: '123456', c: null, url: `${BASE}/check?t=UZ000000000001&r=5&s=123456` },
  },
  {
    name: 'c — 24-soat',
    input: `${BASE}/check?t=UZ000000000001&r=5&c=20261020240000&s=123456`,
    https: true,
    expect: { t: 'UZ000000000001', r: '5', s: '123456', c: null, url: `${BASE}/check?t=UZ000000000001&r=5&s=123456` },
  },
  {
    name: 'c — 2000 yildan oldin (yaroqsiz deb hisoblanadi)',
    input: `${BASE}/check?t=UZ000000000001&r=5&c=19991231235959&s=123456`,
    https: true,
    expect: { t: 'UZ000000000001', r: '5', s: '123456', c: null, url: `${BASE}/check?t=UZ000000000001&r=5&s=123456` },
  },
  {
    name: 'c — kabisa yili 29-fevral',
    input: `${BASE}/check?t=UZ000000000001&r=5&c=20240229000000&s=123456`,
    https: true,
    expect: {
      t: 'UZ000000000001',
      r: '5',
      s: '123456',
      c: '2024-02-29T00:00:00+05:00',
      url: `${BASE}/check?t=UZ000000000001&r=5&c=20240229000000&s=123456`,
    },
  },
  {
    name: 'terminal — 3 harf + 10 raqam',
    input: `${BASE}/check?t=LGX0000000001&r=5&s=123456`,
    https: true,
    expect: { t: 'LGX0000000001', r: '5', s: '123456', c: null, url: `${BASE}/check?t=LGX0000000001&r=5&s=123456` },
  },
  {
    name: 'fiskal belgi — 20 raqam (chegara)',
    input: `${BASE}/check?t=UZ000000000001&r=5&s=12345678901234567890`,
    https: true,
    expect: {
      t: 'UZ000000000001',
      r: '5',
      s: '12345678901234567890',
      c: null,
      url: `${BASE}/check?t=UZ000000000001&r=5&s=12345678901234567890`,
    },
  },
  {
    name: 'sxemasiz (klient https qo`shadi)',
    input: `ofd.soliq.uz/check?t=UZ000000000001&r=5&s=123456`,
    https: false,
    expect: { t: 'UZ000000000001', r: '5', s: '123456', c: null, url: `${BASE}/check?t=UZ000000000001&r=5&s=123456` },
  },
  {
    name: 'http (klient https ga normallashtiradi)',
    input: `http://ofd.soliq.uz/epi?t=EZ000000000031&r=1&c=20230321151526&s=311010881435`,
    https: false,
    expect: {
      t: 'EZ000000000031',
      r: '1',
      s: '311010881435',
      c: '2023-03-21T15:15:26+05:00',
      url: `${BASE}/epi?t=EZ000000000031&r=1&c=20230321151526&s=311010881435`,
    },
  },

  // --- rad etiladi ----------------------------------------------------------
  { name: 'bo`sh satr', input: '', https: true, expect: null },
  { name: 'boshqa host', input: `https://ofd.soliq.uz.evil.com/check?t=UZ000000000001&r=5&s=123456`, https: true, expect: null },
  { name: 'subdomen', input: `https://x.ofd.soliq.uz/check?t=UZ000000000001&r=5&s=123456`, https: true, expect: null },
  { name: 'port', input: `https://ofd.soliq.uz:8443/check?t=UZ000000000001&r=5&s=123456`, https: true, expect: null },
  { name: 'login', input: `https://user:pw@ofd.soliq.uz/check?t=UZ000000000001&r=5&s=123456`, https: true, expect: null },
  { name: 'boshqa yo`l', input: `${BASE}/receipt?t=UZ000000000001&r=5&s=123456`, https: true, expect: null },
  { name: 'boshqa sxema', input: `ftp://ofd.soliq.uz/check?t=UZ000000000001&r=5&s=123456`, https: true, expect: null },
  { name: 't yo`q', input: `${BASE}/check?r=5&s=123456`, https: true, expect: null },
  { name: 'r yo`q', input: `${BASE}/check?t=UZ000000000001&s=123456`, https: true, expect: null },
  { name: 's yo`q', input: `${BASE}/check?t=UZ000000000001&r=5`, https: true, expect: null },
  { name: 'terminal — raqamsiz', input: `${BASE}/check?t=UZABCDEFGHIJKL&r=5&s=123456`, https: true, expect: null },
  { name: 'terminal — 1 harf', input: `${BASE}/check?t=U0000000000001&r=5&s=123456`, https: true, expect: null },
  { name: 'terminal — 5 harf', input: `${BASE}/check?t=UZABC000000001&r=5&s=123456`, https: true, expect: null },
  { name: 'terminal — 7 raqam', input: `${BASE}/check?t=UZ0000001&r=5&s=123456`, https: true, expect: null },
  { name: 'r — harf', input: `${BASE}/check?t=UZ000000000001&r=5a&s=123456`, https: true, expect: null },
  { name: 'r — 13 raqam', input: `${BASE}/check?t=UZ000000000001&r=1234567890123&s=123456`, https: true, expect: null },
  { name: 'r = 0', input: `${BASE}/check?t=UZ000000000001&r=0&s=123456`, https: true, expect: null },
  { name: 'r = 000', input: `${BASE}/check?t=UZ000000000001&r=000&s=123456`, https: true, expect: null },
  { name: 's — 5 raqam', input: `${BASE}/check?t=UZ000000000001&r=5&s=12345`, https: true, expect: null },
  { name: 's — 21 raqam', input: `${BASE}/check?t=UZ000000000001&r=5&s=123456789012345678901`, https: true, expect: null },
  { name: 's — harf', input: `${BASE}/check?t=UZ000000000001&r=5&s=12345a`, https: true, expect: null },
  { name: 'takroriy t — turli qiymat', input: `${BASE}/check?t=UZ000000000001&t=UZ000000000002&r=5&s=123456`, https: true, expect: null },
  { name: 'takroriy s — registri boshqa kalit', input: `${BASE}/check?t=UZ000000000001&r=5&s=123456&S=654321`, https: true, expect: null },
  { name: 'takroriy c — turli qiymat', input: `${BASE}/check?t=UZ000000000001&r=5&c=20261020143005&c=20261020143006&s=123456`, https: true, expect: null },
  { name: '2048 belgidan uzun', input: `${BASE}/check?t=UZ000000000001&r=5&s=123456&x=${'a'.repeat(2048)}`, https: true, expect: null },
  { name: 'URL emas', input: 'salom dunyo', https: true, expect: null },
]
