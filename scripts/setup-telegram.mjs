// Bir martalik sozlash: bot tokenini va webhook sirini Supabase secrets'ga yozadi, Telegram webhook'ini,
// buyruqlar ro'yxatini va menu tugmasini ulaydi.
// Token yashirin kiritiladi, ekranga va diskka (vaqtinchalik fayl o'chiriladi) chiqmaydi; buferdan
// olingan bo'lsa — bufer darhol tozalanadi.
//
// Ishga tushirish:
//   node scripts/setup-telegram.mjs [--project-ref <ref>] [--app-url <https://domen>]
//   --project-ref  Supabase loyiha ref'i (standart: hozirgi production loyiha)
//   --app-url      Frontend domeni yoki Mini App URL'i (…/tg). Standart: hozirgi workers.dev domeni.

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_PROJECT_REF = 'srriiiugmxgrdnuvhgix'
const DEFAULT_APP_URL = 'https://terron-build.terron-build.workers.dev'

/** Webhook qabul qiladigan update turlari (tg-bot: xabar, tugma bosilishi, botni bloklash). */
const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member']

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const m = /^--(project-ref|app-url)(?:=(.*))?$/.exec(a)
    if (!m) {
      console.error(`Noma'lum argument: ${a}`)
      process.exit(1)
    }
    const value = m[2] !== undefined ? m[2] : argv[++i]
    if (value === undefined || value === '') {
      console.error(`--${m[1]} uchun qiymat kerak`)
      process.exit(1)
    }
    out[m[1]] = value
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const PROJECT_REF = args['project-ref'] ?? DEFAULT_PROJECT_REF
if (!/^[a-z0-9]{20}$/.test(PROJECT_REF)) {
  console.error('--project-ref noto‘g‘ri (20 ta kichik harf/raqam bo‘lishi kerak).')
  process.exit(1)
}

/** --app-url: domen (https://x) yoki Mini App URL (https://x/tg). Mini App — har doim …/tg. */
function miniAppUrlFrom(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.search !== '' || u.hash !== '') return null
  const path = u.pathname.replace(/\/+$/, '')
  return `${u.origin}${path.endsWith('/tg') ? path : `${path}/tg`}`
}
const MINI_APP_URL = miniAppUrlFrom(args['app-url'] ?? DEFAULT_APP_URL)
if (MINI_APP_URL === null) {
  console.error('--app-url noto‘g‘ri (https:// bilan, so‘rov parametrlarisiz).')
  process.exit(1)
}
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/tg-bot`
console.log(`Loyiha: ${PROJECT_REF}\nMini App: ${MINI_APP_URL}`)

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

function readClipboard() {
  if (process.platform !== 'win32') return ''
  const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard'], { encoding: 'utf8' })
  return (res.stdout ?? '').trim()
}

/** Buferni tozalaydi (token boshqa dasturga qo'yib yuborilmasin). */
function clearClipboard() {
  if (process.platform !== 'win32') return
  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-STA', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()'],
    { encoding: 'utf8' },
  )
  if (res.status === 0) console.log('Bufer tozalandi.')
  else console.warn('Diqqat: buferni tozalab bo‘lmadi — uni qo‘lda tozalang (boshqa matn nusxalang).')
}

/** Bot API chaqiruvi; javob `ok` bo'lmasa — xabar bilan to'xtaydi. Token hech qachon chiqarilmaydi. */
async function bot(token, method, payload) {
  let body
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    })
    body = await res.json()
  } catch {
    body = null
  }
  if (!body?.ok) {
    console.error(`${method} bajarilmadi: ${body?.description ?? 'tarmoq xatosi'}`)
    process.exit(1)
  }
  return body.result
}

// Avval buferdan (ichki terminallar yashirin kiritishni qo'llamasligi mumkin); bo'lmasa — so'raladi.
// Token hech qachon ekranga chiqarilmaydi.
let token = readClipboard()
if (/^\d+:[\w-]{30,}$/.test(token)) {
  console.log('Token buferdan olindi.')
  clearClipboard()
} else if (process.stdin.isTTY) {
  token = await askHidden('Buferda token topilmadi. Tokenni kiriting (ko‘rinmaydi), keyin Enter: ')
} else {
  console.error('Buferda token topilmadi. BotFather’dan tokenni nusxalang (Copy) va skriptni qayta ishga tushiring.')
  process.exit(1)
}
if (!/^\d+:[\w-]{30,}$/.test(token)) {
  console.error('Token formati noto‘g‘ri (123456789:AA... ko‘rinishida bo‘lishi kerak).')
  process.exit(1)
}

// Telegram: token haqiqiyligini tekshirish
const me = await bot(token, 'getMe')
console.log(`Bot topildi: @${me.username}`)

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

await bot(token, 'setWebhook', {
  url: WEBHOOK_URL,
  secret_token: webhookSecret,
  allowed_updates: ALLOWED_UPDATES,
  drop_pending_updates: true,
})
const info = await bot(token, 'getWebhookInfo')
console.log(`Webhook: ${info.url}`)
console.log(`Update turlari: ${(info.allowed_updates ?? ALLOWED_UPDATES).join(', ')}`)
console.log(`Oxirgi xato: ${info.last_error_message ?? 'yo‘q'}`)

// Buyruqlar ro'yxati
await bot(token, 'setMyCommands', { commands: [{ command: 'start', description: 'Boshlash' }] })
console.log('Buyruqlar: /start — Boshlash.')

// Menu tugmasi (Mini App)
await bot(token, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Ochish', web_app: { url: MINI_APP_URL } } })
console.log('Menu tugmasi "Ochish" ulandi. Tayyor!')
