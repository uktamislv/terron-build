# Telegram bot va Mini App'ni ulash

Bu yo'riqnoma bir marta bajariladi. Oldin Cloudflare'ga deploy qilingan bo'lishi kerak (Mini App faqat HTTPS manzildan ochiladi) — `docs/deploy-cloudflare.md` ga qarang.

Quyida `https://terron-build.SUBDOMEN.workers.dev` o'rniga o'zingizning manzilingizni qo'ying (deploy oxirida chiqadi).

## 1. Bot yaratish

1. Telegram'da **@BotFather** ni oching → `/start`.
2. `/newbot` yuboring.
3. Bot nomi (ko'rinadigan): masalan `TERRON Build`.
4. Username (oxiri `bot` bilan tugashi shart): masalan `terron_build_bot`.
5. BotFather **token** beradi (`123456789:AA...` ko'rinishida).
   - **Tokenni hech kimga yubormang, kodga, chatga yoki `.env` ga yozmang.** U keyinroq (Batch 2) faqat Supabase secrets'ga qo'yiladi:
     ```bash
     supabase secrets set TELEGRAM_BOT_TOKEN=...
     ```
   - Token tasodifan oshkor bo'lsa: BotFather → `/revoke` → yangi token.

## 2. Bot ma'lumotlari

BotFather'da `/mybots` → botingizni tanlang → **Edit Bot**:

- **Edit Description** — "Qurilish firmasi uchun material va pul nazorati. Kirish uchun pastdagi tugmani bosing."
- **Edit About** — "TERRON Build"
- **Edit Botpic** — logotip (ixtiyoriy)

## 3. Mini App'ni ulash

**A. Menyu tugmasi (asosiy usul)**

1. `/mybots` → bot → **Bot Settings** → **Menu Button** → **Configure menu button**.
2. URL: `https://terron-build.SUBDOMEN.workers.dev/tg`
3. Tugma matni: `Ochish`.

Endi botdagi chap pastki tugma Mini App'ni ochadi.

**B. Asosiy Mini App (profil va havola uchun)**

1. `/mybots` → bot → **Bot Settings** → **Configure Mini App** → **Enable Mini App**.
2. URL: `https://terron-build.SUBDOMEN.workers.dev/tg`
3. Shundan keyin `https://t.me/terron_build_bot?startapp` havolasi to'g'ridan-to'g'ri Mini App'ni ochadi (kunlik hisobotdagi tugma uchun kerak bo'ladi).

## 4. `.env` ga qo'shish

Faqat bot **username** (token emas!):

```
VITE_TELEGRAM_BOT_USERNAME=terron_build_bot
```

GitHub'da ham: **Settings → Secrets and variables → Actions → Variables** → `VITE_TELEGRAM_BOT_USERNAME` qo'shing.

## 5. Tekshirish

1. Telefonda botni oching → **Ochish** tugmasi.
2. Mini App ochiladi, bosh ekranda **"Telegram ichida ochilgan"** yashil belgisi ko'rinadi.
3. Brauzerda `https://terron-build.SUBDOMEN.workers.dev/tg` ochsangiz — sariq **"Brauzerda ochilgan"** belgisi chiqadi. Bu to'g'ri.

Kirish (telefon raqami orqali bog'lash, `tg-auth`) Batch 2 da qo'shiladi.

## 6. Webhook'ni qayta ulash ("Ko'rildi" tugmasi uchun, Batch 12)

Webhook uch xil update'ni qabul qilishi kerak: `message` (kontakt, /start), `callback_query` (**Ko'rildi** tugmasi) va `my_chat_member` (foydalanuvchi botni bloklasa / blokdan chiqarsa — `svc_mark_chat_blocked`). Bir marta qayta ishga tushiring:

1. BotFather'dan bot tokenini nusxalang (clipboard'ga).
2. Loyiha papkasida:
   ```bash
   node scripts/setup-telegram.mjs
   ```
   Token clipboard'dan o'qiladi, ekranga chiqmaydi va **bufer darhol tozalanadi**. Skript: Supabase secrets'ni yozadi, webhook'ni (`message`, `callback_query`, `my_chat_member`), `/start — Boshlash` buyrug'ini va **Ochish** menu tugmasini ulaydi; har qadam natijasini tekshiradi.
   Boshqa loyiha / domen uchun: `node scripts/setup-telegram.mjs --project-ref <REF> --app-url https://<domen>` (`--app-url` — domen yoki `…/tg`; standart — hozirgi production qiymatlari).
3. Tekshirish: yangi ogohlantirish kelganda admin **Ko'rildi** ni bossa, xabar oxirida "✓ Ko'rildi — <ism>" paydo bo'ladi.

## 7. Sinovdan oldin: bot tokenini almashtirish

Token 25.10.2026 da terminalda ochiq ko'ringan. Haqiqiy foydalanishdan oldin:

1. BotFather → `/revoke` → **@terron_build_bot** → yangi token.
2. Yangi tokenni nusxalab, `node scripts/setup-telegram.mjs` ni qayta ishga tushiring (6-bo'lim) — Supabase secrets va webhook yangilanadi.

**Token bekor qilingan paytdagi xabarlar yo'qolmaydi.** `/revoke` dan keyin, yangi token secrets'ga yozilgunicha, Telegram `401 Unauthorized` qaytaradi. `tg-dispatch` bunday qatorlarni `failed` qilmaydi: ~10 daqiqadan keyin qayta urinadi va bu urinish hisoblanmaydi (`TOKEN_RETRY_SEC = 600`). Token almashgach kutmasdan darhol yuborish uchun SQL Editor'da:

```sql
-- Token muammosi tufayli kutayotgan qatorlarni darhol navbatga
update public.notification_outbox
   set next_attempt_at = now()
 where status = 'pending'
   and last_error ~* 'telegram (401|404)';

-- Eski versiya (audit tuzatishidan oldin) 401/404 da qatorlarni failed qilgan — oxirgi 7 kundagilarini qaytarish
update public.notification_outbox
   set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
 where status = 'failed'
   and last_error ~* 'telegram (401|404)'
   and updated_at > now() - interval '7 days';

select private.wake_dispatch();  -- darhol yuborish (aks holda cron 1 daqiqada)
```

Allaqachon yetkazilgan chatlar (`delivered_chat_ids`) qayta xabar olmaydi.
