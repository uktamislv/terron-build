// Bir martalik sozlash: bot tokenini va webhook sirini Supabase secrets'ga yozadi, Telegram webhook'ini ulaydi.
// Token yashirin kiritiladi, ekranga va diskka (vaqtinchalik fayl o'chiriladi) chiqmaydi.
// Ishga tushirish: node scripts/setup-telegram.mjs

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PROJECT_REF = 'srriiiugmxgrdnuvhgix'
const MINI_APP_URL = 'https://terron-build.terron-build.workers.dev/tg'
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/tg-bot`

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question)
    const stdin = process.stdin
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode?.(false)
        stdin.pause()
        stdin.off('data', onData)
        process.stdout.write('\n')
        resolve(value.trim())
      } else if (ch === '\u0003') {
        process.stdout.write('\nBekor qilindi.\n')
        process.exit(1)
      } else if (ch === '\u0008' || ch === '\u007f') {
        value = value.slice(0, -1)
      } else {
        value += ch
      }
    }
    stdin.on('data', onData)
  })
}

const token = await askHidden('BotFather bergan bot tokenini kiriting (yozganingiz ko‘rinmaydi), keyin Enter: ')
if (!/^\d+:[\w-]{30,}$/.test(token)) {
  console.error('Token formati noto‘g‘ri (123456789:AA... ko‘rinishida bo‘lishi kerak).')
  process.exit(1)
}

// Telegram: token haqiqiyligini tekshirish
const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()).catch(() => null)
if (!me?.ok) {
  console.error('Telegram tokenni qabul qilmadi. BotFather’dan tokenni qayta nusxalang.')
  process.exit(1)
}
console.log(`Bot topildi: @${me.result.username}`)

const webhookSecret = randomBytes(32).toString('base64url')

// Supabase secrets — vaqtinchalik env fayl orqali (buyruq qatorida sir ko'rinmasin), keyin o'chiriladi
const dir = mkdtempSync(join(tmpdir(), 'tb-'))
const envFile = join(dir, 'secrets.env')
try {
  writeFileSync(
    envFile,
    `TELEGRAM_BOT_TOKEN=${token}\nTELEGRAM_WEBHOOK_SECRET=${webhookSecret}\nMINI_APP_URL=${MINI_APP_URL}\n`,
    { mode: 0o600 },
  )
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const res = spawnSync(npx, ['supabase', 'secrets', 'set', '--project-ref', PROJECT_REF, '--env-file', envFile], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (res.status !== 0) {
    console.error('Supabase secrets yozilmadi.')
    process.exit(1)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log('Supabase secrets yozildi.')

const set = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: WEBHOOK_URL,
    secret_token: webhookSecret,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  }),
}).then((r) => r.json())
if (!set.ok) {
  console.error(`Webhook ulanmadi: ${set.description ?? 'noma’lum xato'}`)
  process.exit(1)
}

const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((r) => r.json())
console.log(`Webhook: ${info.result?.url}`)
console.log(`Oxirgi xato: ${info.result?.last_error_message ?? 'yo‘q'}`)

// Menu tugmasi (Mini App)
await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ menu_button: { type: 'web_app', text: 'Ochish', web_app: { url: MINI_APP_URL } } }),
})
console.log('Menu tugmasi "Ochish" ulandi. Tayyor!')
