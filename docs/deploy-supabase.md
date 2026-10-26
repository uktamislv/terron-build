# Supabase'ni ishga tushirish

Bir martalik ish: loyiha ochish, migratsiyalar, kirish sozlamalari, Edge Functions va Telegram webhook. Sirlar (bot tokeni, parollar) faqat sizda qoladi — ularni chatga yozmang.

Quyida `<REF>` — loyiha identifikatori (Dashboard → Project Settings → General → Reference ID).

> **Free reja cheklovi.** Supabase Free rejasidagi loyiha **7 kun faollik bo'lmasa to'xtatiladi (pause)** — sayt va Mini App ishlamay qoladi, cron va Telegram xabarlari ham to'xtaydi. Qayta yoqish: Dashboard → loyiha → **Restore project** (bir necha daqiqa). Free'da avtomatik zaxira nusxa ham yo'q — haftalik qo'lda zaxira: `docs/backup.md`. Haqiqiy foydalanishdan (production) oldin **Pro** rejaga o'tish tavsiya etiladi.

## 1. Loyiha

1. https://supabase.com/dashboard → **New project** → nom `TERRON Build`, region **South Asia (Mumbai)**, kuchli database paroli (o'zingizda saqlang).
2. Kompyuterda loyiha papkasida:
   ```bash
   npx supabase login
   ```
   ```bash
   npx supabase link --project-ref <REF>
   ```

## 2. Migratsiyalar

```bash
npx supabase db push
```

`supabase/seed.sql` (namuna firma) production'ga **qo'llanmaydi**. Sinov uchun kerak bo'lsa — SQL Editor'da qo'lda ishga tushiring.

### Demo ma'lumotlar (ixtiyoriy) — `supabase/seed/demo.sql`

Alohida **"Demo qurilish"** firmasi: 3 obyekt, 10 xodim, smetalar, 30 kunlik kirim/chiqim/xarid/podotchet/so'rov/o'tkazma/inventarizatsiya va bir nechta ogohlantirish. Haqiqiy firmalarga tegmaydi, avtomatik qo'llanmaydi, qayta ishga tushirsa takrorlamaydi (firma bor bo'lsa — hech narsa qilmaydi). Faqat barcha migratsiyalardan keyin.

1. **SQL Editor:** Dashboard → SQL Editor → New query → `supabase/seed/demo.sql` ning butun matnini qo'ying → **Run**. Natijada `Demo qurilish yaratildi: … harakat, … xarid, … ogohlantirish` xabari chiqadi (takroriy ishga tushirishda — `allaqachon bor`).
   yoki **psql** (Dashboard → Connect → connection string, parol — o'zingizda):
   ```bash
   psql "<connection string>" -v ON_ERROR_STOP=1 -f supabase/seed/demo.sql
   ```
2. Tekshirish:
   ```sql
   select type, severity, count(*) from public.alerts
    where company_id = 'de300000-0000-4000-8000-000000000001' group by 1, 2 order by 1;
   ```
3. Demo xodimlarda login yo'q. Ko'rish uchun: super_admin sifatida kiring (barcha firmalarni ko'radi) yoki Foydalanuvchilar sahifasida demo xodimga login bering.
4. Demo firma ogohlantirishlari Telegram navbatiga ham tushadi; demo xodimlarda Telegram ulanmagan — xabar hech kimga ketmaydi (`sent_count = 0`).
5. Olib tashlash: hech narsa butunlay o'chirilmaydi — kerak bo'lmasa super_admin firmani nofaol qiladi: `update public.companies set is_active = false where id = 'de300000-0000-4000-8000-000000000001';`

Seed ichida vaqtinchalik 4 ta `auth.users` qatori (`*@demo-seed.invalid`) yaratiladi va shu tranzaksiya oxirida o'chiriladi — ular faqat sessiya talab qiladigan funksiyalar (o'tkazma, inventarizatsiya) uchun kerak.

## 3. Kirish (Auth) sozlamalari — muhim

Dashboard → **Authentication → Sign In / Providers**:

- **Allow new users to sign up — O'CHIRING.** Foydalanuvchilarni faqat admin qo'shadi. Yoqiq qolsa, begona odam o'zi akkaunt ochishi mumkin.
- **Email** provider yoqiq qolsin. **Confirm email — YOQIQ qolsin** (tizim akkauntlarni `email_confirm: true` bilan o'zi tasdiqlangan holda yaratadi, shuning uchun bu bizga xalaqit bermaydi; o'chirilsa — tasdiqlanmagan email bilan kirish ochilib qoladi).
- **Secure email change — YOQIQ** (email o'zgartirish ikkala manzildan tasdiqlanadi).
- **Phone** provider kerak emas (SMS ishlatilmaydi).

Authentication → **Policies / Passwords** (Dashboard'da "Password security"):

- **Minimum password length: 10.** (Admin parol berishda ham shu qoidaga tushadi; qisqa parol `weak_password` bilan rad etiladi.)
- **Leaked password protection — YOQING** (HaveIBeenPwned ro'yxatidagi parollar rad etiladi; Pro rejada mavjud — Free'da ko'rinmasa, Pro'ga o'tganda yoqing).
- **Secure password change — YOQING** (parolni almashtirish uchun yaqinda kirgan bo'lish talab qilinadi).

Authentication → **Rate Limits** — standart qiymatlarni ko'rib chiqing: sign-in/sign-up va token refresh chegaralari bitta firma uchun yetarli; "email sent" chegarasi bizga ta'sir qilmaydi (xat yuborilmaydi). Ko'p xodim bir IP (ofis NAT) orqali kirsa va "rate limit" xatosi chiqsa — sign-in chegarasini oshiring.

Authentication → **Emails → SMTP Settings**:

- **Custom SMTP ULAMANG.** Tizim telefon va Telegram foydalanuvchilariga sintetik email beradi (`…@phone.terron-build.invalid`, `…@tg.terron-build.invalid`). Supabase'ning standart SMTP'si faqat loyiha jamoasi a'zolariga xat yuboradi — sintetik manzillarga hech narsa ketmaydi. Agar keyinchalik custom SMTP kerak bo'lsa — avval **Auth Hooks → Send Email** hook bilan `.invalid` domenlarga xat yuborishni to'xtating.

Authentication → **URL Configuration** → Site URL: `https://terron-build.terron-build.workers.dev`

## 4. Birinchi admin

Admin boshqa foydalanuvchilarni veb paneldan qo'shadi, lekin birinchisini qo'lda yaratish kerak.

1. Authentication → **Users → Add user → Create new user**: email va parol, **Auto Confirm User** belgilangan.
2. SQL Editor'da (email va ma'lumotlarni o'zingiznikiga almashtiring):
   ```sql
   with c as (
     insert into public.companies (name) values ('Firma nomi') returning id
   ), t as (
     select private.apply_material_template(c.id) from c
   )
   insert into public.profiles (company_id, role, full_name, phone, auth_user_id, login_kind)
   select c.id, 'admin', 'Ism Familiya', '+998901234567',
          (select id from auth.users where email = 'admin@example.com'), 'web'
   from c;
   ```
3. `https://terron-build.terron-build.workers.dev/login` → shu email va parol bilan kiring.

## 5. Edge Functions sirlari

Webhook siri uchun tasodifiy satr yarating (faqat harf, raqam, `_`, `-`; masalan parol generatoridan 40 belgi).

```bash
npx supabase secrets set TELEGRAM_BOT_TOKEN=<BotFather bergan token> TELEGRAM_WEBHOOK_SECRET=<tasodifiy satr> MINI_APP_URL=https://terron-build.terron-build.workers.dev/tg
```

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` — Supabase o'zi beradi.

## 6. Edge Functions deploy

Oltala funksiya:

```bash
npx supabase functions deploy tg-auth tg-bot admin-users tg-dispatch receipt-lookup photo-hash --project-ref <REF>
```

`verify_jwt` qiymatlari `supabase/config.toml` dan olinadi — hammasida `false`, har biri chaqiruvchini o'zi tekshiradi:

| Funksiya | Ishonch |
|---|---|
| `tg-auth` | initData HMAC imzosi (15 daqiqa muddat, takroriy ishlatishdan himoya) |
| `tg-bot` | `X-Telegram-Bot-Api-Secret-Token` (webhook siri) |
| `admin-users`, `receipt-lookup`, `photo-hash` | foydalanuvchi JWT'si — `auth.getUser(jwt)` (anon kalit → 401) |
| `tg-dispatch` | `x-dispatch-secret` = Vault'dagi `tg_dispatch_secret` (faqat baza chaqiradi) |

### Yangi loyihada: `dispatch_url`

Migratsiya production loyiha (`srriiiugmxgrdnuvhgix`) URL'ini yozadi. **Boshqa loyiha** (yangi production, staging) uchun SQL Editor'da o'z URL'ingizni qo'ying — aks holda bildirishnomalar boshqa loyihaning funksiyasini uyg'otadi:

```sql
update private.app_settings
   set value = 'https://<REF>.supabase.co/functions/v1/tg-dispatch'
 where key = 'dispatch_url';
```

Lokal / sinov bazasida uyg'otishni o'chirish: `value = ''` (cron baribir har daqiqada chaqiradi — u ham shu URL'dan foydalanadi).

### Bildirishnomalar ishlayaptimi (tekshirish)

SQL Editor'da ketma-ket:

```sql
-- 1. Cron vazifalari (dispatch har daqiqada, kunlik hisobot, eslatmalar va h.k.)
select jobname, schedule, active from cron.job order by jobname;

-- 2. Dispatch siri Vault'da bor (qiymati ko'rsatilmaydi)
select count(*) as secret_bor from vault.secrets where name = 'tg_dispatch_secret';   -- 1

-- 3. URL to'g'ri loyihaga qaraydi
select value from private.app_settings where key = 'dispatch_url';

-- 4. Qo'lda uyg'otish va javob
select private.wake_dispatch();
select status_code, content, created from net._http_response order by id desc limit 1;
```

4-qadam natijasi: **`202 {"accepted":true}`** — funksiya darhol javob beradi, yuborish fonda davom etadi (pg_net 5 s da uziladi, shuning uchun kutmaydi). `401` — Vault siri va funksiya mos emas (funksiyani qayta deploy qiling, 5 daqiqa kesh); `404` — `dispatch_url` noto'g'ri yoki `tg-dispatch` deploy qilinmagan.

Natijani navbatdan ko'rish: `select kind, status, attempts, last_error, sent_count, updated_at from public.notification_outbox order by created_at desc limit 20;`

### Birinchi deploy'dan keyin tekshiring

1. **`.invalid` domen qabul qilinadimi.** Veb paneldan sinov profiliga emailsiz login bering (Foydalanuvchilar → Login berish). Xato bo'lsa — Dashboard → Edge Functions → `admin-users` → Logs; "invalid email" kabi xato chiqsa, menga yozing (domen almashtiriladi).
2. **Telegram sessiyasi.** Mini App ochilib kirsa — `generateLink` → `verifyOtp({ type: 'magiclink' })` ishlayapti. `tg-auth` logida `verifyOtp:` xatosi bo'lsa — menga yozing.
3. **Audit.** SQL Editor: `select action, record_id, new_data, created_at from audit_log where table_name = 'auth' order by id desc limit 10;` — `SET_LOGIN`, `TG_LINK`, `TG_AUTH_USER_CREATED` yozuvlari ko'rinadi, ularda parol yo'q.

## 7. Telegram webhook

Tavsiya: skript (secrets, webhook, `/start` buyrug'i va menu tugmasini birga sozlaydi, tokenni ekranga chiqarmaydi):

```bash
node scripts/setup-telegram.mjs --project-ref <REF> --app-url https://<domen>
```

Qo'lda (skriptsiz):

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" -H "Content-Type: application/json" -d "{\"url\":\"https://<REF>.supabase.co/functions/v1/tg-bot\",\"secret_token\":\"<TELEGRAM_WEBHOOK_SECRET>\",\"allowed_updates\":[\"message\",\"callback_query\",\"my_chat_member\"],\"drop_pending_updates\":true}"
```

`callback_query` — alert xabaridagi **Ko'rildi** tugmasi; `my_chat_member` — foydalanuvchi botni bloklaganini bilish (bloklanganlarga xabar yuborish to'xtatiladi).

Tekshirish:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

`url` to'g'ri va `last_error_message` bo'sh bo'lishi kerak.

## 8. Frontendni ulash

Dashboard → Project Settings → **API**: Project URL va **anon / publishable** kalit (service_role EMAS).

- Lokal `.env`:
  ```
  VITE_SUPABASE_URL=https://<REF>.supabase.co
  VITE_SUPABASE_ANON_KEY=<anon kalit>
  ```
- GitHub → Settings → Secrets and variables → Actions → **Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TELEGRAM_BOT_USERNAME` (hammasi majburiy — biri bo'sh bo'lsa CI deploy qadami to'xtaydi). `VITE_APP_VERSION` ni CI o'zi beradi (commit SHA).
- Qayta deploy: `npm run deploy` (yoki GitHub avtomatik deploy yoqilgan bo'lsa — push).

## 9. Tekshirish

1. Veb: `/login` → admin bilan kirish → **Foydalanuvchilar** → o'zingizni prorab sifatida telefon raqamingiz bilan qo'shing (boshqa raqam/ism bilan).
2. Telegram: @terron_build_bot → `/start` → **Ochish** → "Telefon raqamni ulashish" → bir necha soniyada ilova ochiladi.
3. Muammo bo'lsa: Dashboard → Edge Functions → `tg-auth` / `tg-bot` → **Logs**.
