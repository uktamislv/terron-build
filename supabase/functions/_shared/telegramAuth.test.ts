// @vitest-environment node
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildDataCheckString,
  checkWebhookSecret,
  computeInitDataHash,
  timingSafeEqual,
  verifyInitData,
} from './telegramAuth.ts'
import { signInitDataForTest } from './telegramAuth.testing.ts'

const TOKEN = '123456789:AAFakeBotTokenForTests_xyz'
const NOW = 1_760_000_000
const USER = { id: 279058397, first_name: 'Vladislav', last_name: 'Kibenko', username: 'vdkfrost', language_code: 'ru' }

function baseFields(over: Record<string, string> = {}): Record<string, string> {
  return {
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify(USER),
    auth_date: String(NOW - 60),
    ...over,
  }
}

/** Mustaqil (Node crypto) realizatsiya: Telegram hujjatidagi algoritm. */
function nodeHash(fields: Record<string, string>, exclude: string[] = ['hash', 'signature']): string {
  const dcs = Object.keys(fields)
    .filter((k) => !exclude.includes(k))
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest()
  return createHmac('sha256', secret).update(dcs).digest('hex')
}

/** Query satrini qo'lda yig'ish (encodeURIComponent — Telegram klienti kabi `%20`). */
function rawQuery(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

describe('WebCrypto realizatsiyasi Node crypto bilan mos', () => {
  it('computeInitDataHash === Node createHmac', async () => {
    const f = baseFields()
    const ours = await computeInitDataHash(buildDataCheckString(f, ['hash']), TOKEN)
    expect(ours).toBe(nodeHash(f))
  })

  it('unicode qiymatlar bilan ham mos', async () => {
    const f = baseFields({ user: JSON.stringify({ id: 1, first_name: "O'tkir 🚧 Ўткир", last_name: 'Тошматов' }) })
    const ours = await computeInitDataHash(buildDataCheckString(f, ['hash']), TOKEN)
    expect(ours).toBe(nodeHash(f))
  })

  it('Node bilan imzolangan initData qabul qilinadi', async () => {
    const f = baseFields()
    const initData = rawQuery({ ...f, hash: nodeHash(f) })
    const r = await verifyInitData(initData, TOKEN, { nowSec: NOW })
    expect(r.ok).toBe(true)
  })
})

describe('verifyInitData', () => {
  it("to'g'ri imzo → ok, user va authDate", async () => {
    const initData = await signInitDataForTest(baseFields(), TOKEN)
    const r = await verifyInitData(initData, TOKEN, { nowSec: NOW })
    expect(r).toEqual({
      ok: true,
      user: USER,
      authDate: NOW - 60,
      fields: baseFields(),
    })
  })

  it("bitta maydon o'zgartirilgan → bad_hash", async () => {
    const initData = await signInitDataForTest(baseFields(), TOKEN)
    const tampered = initData.replace('AAHdF6IQAAAAAN0XohDhrOrc', 'AAHdF6IQAAAAAN0XohDhrOrd')
    expect(tampered).not.toBe(initData)
    expect(await verifyInitData(tampered, TOKEN, { nowSec: NOW })).toEqual({ ok: false, reason: 'bad_hash' })
  })

  it("user id o'zgartirilgan → bad_hash", async () => {
    const f = baseFields()
    const hash = nodeHash(f)
    const forged = rawQuery({ ...f, user: JSON.stringify({ ...USER, id: 1 }), hash })
    expect(await verifyInitData(forged, TOKEN, { nowSec: NOW })).toEqual({ ok: false, reason: 'bad_hash' })
  })

  it("maydon qo'shilgan → bad_hash", async () => {
    const initData = (await signInitDataForTest(baseFields(), TOKEN)) + '&start_param=x'
    expect(await verifyInitData(initData, TOKEN, { nowSec: NOW })).toEqual({ ok: false, reason: 'bad_hash' })
  })

  it("hash yo'q → missing_hash", async () => {
    expect(await verifyInitData(rawQuery(baseFields()), TOKEN, { nowSec: NOW })).toEqual({
      ok: false,
      reason: 'missing_hash',
    })
    expect(await verifyInitData(rawQuery({ ...baseFields(), hash: '' }), TOKEN, { nowSec: NOW })).toEqual({
      ok: false,
      reason: 'missing_hash',
    })
  })

  it("hash hex emas yoki uzunligi noto'g'ri → bad_hash", async () => {
    for (const hash of ['zz', 'a'.repeat(63), 'g'.repeat(64), 'a'.repeat(65)]) {
      const r = await verifyInitData(rawQuery({ ...baseFields(), hash }), TOKEN, { nowSec: NOW })
      expect(r).toEqual({ ok: false, reason: 'bad_hash' })
    }
  })

  it('hash katta harflarda ham qabul qilinadi', async () => {
    const f = baseFields()
    const r = await verifyInitData(rawQuery({ ...f, hash: nodeHash(f).toUpperCase() }), TOKEN, { nowSec: NOW })
    expect(r.ok).toBe(true)
  })

  it("signature maydoni bor — hash hisobida e'tiborga olinmaydi", async () => {
    const f = baseFields({ signature: 'SomeBase64UrlEd25519Signature_-' })
    const initData = rawQuery({ ...f, hash: nodeHash(f, ['hash', 'signature']) })
    const r = await verifyInitData(initData, TOKEN, { nowSec: NOW })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.fields.signature).toBe('SomeBase64UrlEd25519Signature_-')
  })

  it('signature hash hisobiga kiritilgan variant ham qabul qilinadi (Telegram amaliyoti)', async () => {
    const f = baseFields({ signature: 'abc' })
    const initData = rawQuery({ ...f, hash: nodeHash(f, ['hash']) })
    expect((await verifyInitData(initData, TOKEN, { nowSec: NOW })).ok).toBe(true)
  })

  it("signature o'zgartirilsa ham hash buzilmaydi, lekin boshqa maydon o'zgarsa — bad_hash", async () => {
    const f = baseFields({ signature: 'abc' })
    const hash = nodeHash(f, ['hash', 'signature'])
    expect((await verifyInitData(rawQuery({ ...f, signature: 'xyz', hash }), TOKEN, { nowSec: NOW })).ok).toBe(true)
    const r = await verifyInitData(rawQuery({ ...f, auth_date: String(NOW), hash }), TOKEN, { nowSec: NOW })
    expect(r).toEqual({ ok: false, reason: 'bad_hash' })
  })

  it("noto'g'ri token → bad_hash", async () => {
    const initData = await signInitDataForTest(baseFields(), TOKEN)
    expect(await verifyInitData(initData, TOKEN + 'x', { nowSec: NOW })).toEqual({ ok: false, reason: 'bad_hash' })
    expect(await verifyInitData(initData, '', { nowSec: NOW })).toEqual({ ok: false, reason: 'bad_hash' })
  })

  it("muddati o'tgan → expired (standart 24 soat, chegarada hali ok)", async () => {
    const atLimit = await signInitDataForTest(baseFields({ auth_date: String(NOW - 86400) }), TOKEN)
    expect((await verifyInitData(atLimit, TOKEN, { nowSec: NOW })).ok).toBe(true)
    const old = await signInitDataForTest(baseFields({ auth_date: String(NOW - 86401) }), TOKEN)
    expect(await verifyInitData(old, TOKEN, { nowSec: NOW })).toEqual({ ok: false, reason: 'expired' })
  })

  it('maxAgeSec parametri', async () => {
    const initData = await signInitDataForTest(baseFields({ auth_date: String(NOW - 120) }), TOKEN)
    expect(await verifyInitData(initData, TOKEN, { nowSec: NOW, maxAgeSec: 60 })).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect((await verifyInitData(initData, TOKEN, { nowSec: NOW, maxAgeSec: 120 })).ok).toBe(true)
  })

  it('kelajakdagi auth_date → future (5 daqiqa tolerans)', async () => {
    const ok = await signInitDataForTest(baseFields({ auth_date: String(NOW + 300) }), TOKEN)
    expect((await verifyInitData(ok, TOKEN, { nowSec: NOW })).ok).toBe(true)
    const fut = await signInitDataForTest(baseFields({ auth_date: String(NOW + 301) }), TOKEN)
    expect(await verifyInitData(fut, TOKEN, { nowSec: NOW })).toEqual({ ok: false, reason: 'future' })
    expect(await verifyInitData(fut, TOKEN, { nowSec: NOW, futureToleranceSec: 301 })).toMatchObject({ ok: true })
  })

  it("auth_date yo'q yoki son emas → malformed", async () => {
    const f = baseFields()
    delete f.auth_date
    expect(await verifyInitData(await signInitDataForTest(f, TOKEN), TOKEN, { nowSec: NOW })).toEqual({
      ok: false,
      reason: 'malformed',
    })
    const bad = await signInitDataForTest(baseFields({ auth_date: '17e8' }), TOKEN)
    expect(await verifyInitData(bad, TOKEN, { nowSec: NOW })).toEqual({ ok: false, reason: 'malformed' })
  })

  it('URL-encode qilingan user JSON (Telegram klienti formati) decode qilinib tekshiriladi', async () => {
    const f = baseFields()
    const initData = rawQuery({ ...f, hash: nodeHash(f) })
    expect(initData).toContain('user=%7B%22id%22%3A279058397')
    const r = await verifyInitData(initData, TOKEN, { nowSec: NOW })
    expect(r.ok && r.user.id).toBe(279058397)
  })

  it("bo'sh satr → malformed", async () => {
    expect(await verifyInitData('', TOKEN, { nowSec: NOW })).toEqual({ ok: false, reason: 'malformed' })
    expect(await verifyInitData('   ', TOKEN, { nowSec: NOW })).toEqual({ ok: false, reason: 'malformed' })
  })

  it('takroriy kalit → malformed', async () => {
    const initData = await signInitDataForTest(baseFields(), TOKEN)
    expect(await verifyInitData(initData + '&auth_date=1', TOKEN, { nowSec: NOW })).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('maydonlar boshqa tartibda kelsa ham ok', async () => {
    const f = baseFields({ chat_instance: '-123', chat_type: 'sender' })
    const hash = nodeHash(f)
    const shuffled = rawQuery({
      hash,
      user: f.user as string,
      chat_type: 'sender',
      auth_date: f.auth_date as string,
      chat_instance: '-123',
      query_id: f.query_id as string,
    })
    const r = await verifyInitData(shuffled, TOKEN, { nowSec: NOW })
    expect(r.ok).toBe(true)
  })

  it('unicode ism (kirill, emoji, apostrof) bilan ok', async () => {
    const user = { id: 42, first_name: "G'ayrat 🚧", last_name: 'Тошматов', username: 'gayrat' }
    const initData = await signInitDataForTest(baseFields({ user: JSON.stringify(user) }), TOKEN)
    const r = await verifyInitData(initData, TOKEN, { nowSec: NOW })
    expect(r.ok && r.user).toEqual(user)
  })

  it("user yo'q, JSON emas yoki id yo'q → no_user (imzo to'g'ri bo'lsa ham)", async () => {
    const noUser = baseFields()
    delete noUser.user
    for (const f of [
      noUser,
      baseFields({ user: '{not json' }),
      baseFields({ user: JSON.stringify({ first_name: 'A' }) }),
      baseFields({ user: JSON.stringify({ id: '42' }) }),
      baseFields({ user: JSON.stringify({ id: 0 }) }),
      baseFields({ user: JSON.stringify({ id: 1.5 }) }),
      baseFields({ user: JSON.stringify([1]) }),
      baseFields({ user: 'null' }),
    ]) {
      const r = await verifyInitData(await signInitDataForTest(f, TOKEN), TOKEN, { nowSec: NOW })
      expect(r).toEqual({ ok: false, reason: 'no_user' })
    }
  })

  it("imzosiz soxta user qabul qilinmaydi (imzo user'dan oldin tekshiriladi)", async () => {
    const r = await verifyInitData(rawQuery({ ...baseFields(), hash: '0'.repeat(64) }), TOKEN, { nowSec: NOW })
    expect(r).toEqual({ ok: false, reason: 'bad_hash' })
  })
})

describe('timingSafeEqual', () => {
  it('teng va teng emas', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('', '')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'ab')).toBe(false)
    expect(timingSafeEqual('ab', 'abc')).toBe(false)
    expect(timingSafeEqual('', 'a')).toBe(false)
    expect(timingSafeEqual('abc\u0000', 'abc')).toBe(false)
    expect(timingSafeEqual('ё', 'ё')).toBe(true)
  })
})

describe('checkWebhookSecret', () => {
  it('mos kelsa true', () => {
    expect(checkWebhookSecret('s3cr3t', 's3cr3t')).toBe(true)
  })
  it('mos kelmasa, null yoki uzunligi boshqa → false', () => {
    expect(checkWebhookSecret('s3cr3T', 's3cr3t')).toBe(false)
    expect(checkWebhookSecret(null, 's3cr3t')).toBe(false)
    expect(checkWebhookSecret('', 's3cr3t')).toBe(false)
    expect(checkWebhookSecret('s3cr3t-extra', 's3cr3t')).toBe(false)
  })
  it("expected bo'sh bo'lsa doim false", () => {
    expect(checkWebhookSecret('', '')).toBe(false)
    expect(checkWebhookSecret(null, '')).toBe(false)
    expect(checkWebhookSecret('anything', '')).toBe(false)
  })
})
