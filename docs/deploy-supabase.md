# Supabase'ni ishga tushirish

Bir martalik ish: loyiha ochish, migratsiyalar, kirish sozlamalari, Edge Functions va Telegram webhook. Sirlar (bot tokeni, parollar) faqat sizda qoladi — ularni chatga yozmang.

Quyida `<REF>` — loyiha identifikatori (Dashboard → Project Settings → General → Reference ID).

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

## 3. Kirish (Auth) sozlamalari — muhim

Dashboard → **Authentication → Sign In / Providers**:

- **Allow new users to sign up — O'CHIRING.** Foydalanuvchilarni faqat admin qo'shadi. Yoqiq qolsa, begona odam o'zi akkaunt ochishi mumkin.
- **Email** provider yoqiq qolsin; **Confirm email** — o'chirsa bo'ladi (akkauntlarni tizim tasdiqlangan holda yaratadi).
- **Phone** provider kerak emas (SMS ishlatilmaydi).

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

```bash
npx supabase functions deploy tg-auth tg-bot admin-users
```

`verify_jwt` qiymatlari `supabase/config.toml` dan olinadi — uchalasida ham `false`: `tg-auth` initData imzosini, `tg-bot` webhook sirini, `admin-users` esa chaqiruvchini `auth.getUser(jwt)` bilan o'zi tekshiradi (yangi JWT signing keys bilan ham ishlaydi).

### Birinchi deploy'dan keyin tekshiring

1. **`.invalid` domen qabul qilinadimi.** Veb paneldan sinov profiliga emailsiz login bering (Foydalanuvchilar → Login berish). Xato bo'lsa — Dashboard → Edge Functions → `admin-users` → Logs; "invalid email" kabi xato chiqsa, menga yozing (domen almashtiriladi).
2. **Telegram sessiyasi.** Mini App ochilib kirsa — `generateLink` → `verifyOtp({ type: 'magiclink' })` ishlayapti. `tg-auth` logida `verifyOtp:` xatosi bo'lsa — menga yozing.
3. **Audit.** SQL Editor: `select action, record_id, new_data, created_at from audit_log where table_name = 'auth' order by id desc limit 10;` — `SET_LOGIN`, `TG_LINK`, `TG_AUTH_USER_CREATED` yozuvlari ko'rinadi, ularda parol yo'q.

## 7. Telegram webhook

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" -H "Content-Type: application/json" -d "{\"url\":\"https://<REF>.supabase.co/functions/v1/tg-bot\",\"secret_token\":\"<TELEGRAM_WEBHOOK_SECRET>\",\"allowed_updates\":[\"message\"],\"drop_pending_updates\":true}"
```

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
- GitHub → Settings → Secrets and variables → Actions → **Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Qayta deploy: `npm run deploy` (yoki GitHub avtomatik deploy yoqilgan bo'lsa — push).

## 9. Tekshirish

1. Veb: `/login` → admin bilan kirish → **Foydalanuvchilar** → o'zingizni prorab sifatida telefon raqamingiz bilan qo'shing (boshqa raqam/ism bilan).
2. Telegram: @terron_build_bot → `/start` → **Ochish** → "Telefon raqamni ulashish" → bir necha soniyada ilova ochiladi.
3. Muammo bo'lsa: Dashboard → Edge Functions → `tg-auth` / `tg-bot` → **Logs**.
