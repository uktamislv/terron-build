# Kirish va rollar dizayni (Batch 2)

Bu hujjat — Batch 2 shartnomasi: Edge Functions, umumiy funksiyalar va frontend shu kelishuvga tayanadi.

## Asosiy tamoyillar

- Kirish faqat Supabase Auth sessiyasi orqali. RLS `auth.uid()` → `profiles.auth_user_id` → firma va rol.
- Profilni admin oldindan yaratadi (Batch 1 RLS). Auth akkaunt va Telegram bog'lanishini **faqat Edge Function** (`service_role`) yaratadi va yozadi — `profiles.auth_user_id`, `telegram_user_id`, `telegram_chat_id` ustunlari authenticated uchun yopiq.
- `profiles.login_kind` (`none` | `tg` | `web`) — profilda qanday login borligi. Faqat `service_role` yozadi (authenticated ustun grantlarida yo'q), hamma ko'radi (SELECT jadval darajasida). Qoida: `login_kind <> 'none'` ⇒ `auth_user_id is not null` (CHECK); `auth_user_id` null bo'lsa trigger `none` qiladi (telefon o'zgarishi, auth user o'chirilishi).
- Klientdan kelgan hech qanday identifikator (`initDataUnsafe`, kontakt, telefon) imzosiz qabul qilinmaydi.
- SMS ishlatilmaydi (O'zbekistonda SMS provayder qimmat va murakkab).

## Auth akkauntlar

Har bir faol profilga ko'pi bilan bitta `auth.users` yozuvi (`profiles.auth_user_id`).

| Kim | Auth email | Parol |
|---|---|---|
| Veb foydalanuvchi, email bilan | haqiqiy email | admin beradi (vaqtinchalik) |
| Veb foydalanuvchi, telefon bilan | `p<raqamlar>@phone.terron-build.invalid` (sintetik) | admin beradi |
| Faqat Telegram foydalanuvchi | `tg<telegram_user_id>@tg.terron-build.invalid` (sintetik) | yo'q (tasodifiy ≥ 32 belgi, hech kimga berilmaydi) |

- Sintetik email'lar `email_confirm: true` bilan yaratiladi — xat yuborilmaydi.
- **Sintetik domenlar RFC 2606 rezerv TLD `.invalid` da** — hech kim egalik qila olmaydi, xat yetkazilmaydi. (Dastlabki `terron.uz` bizniki emas edi: domen egasi recovery/magiclink xatlarini olib akkauntni egallashi mumkin edi.) GoTrue `.invalid` domenni qabul qilishi birinchi deploy'da tekshiriladi (`docs/deploy-supabase.md`).
- **Custom SMTP ulanmasin** (Supabase standart SMTP faqat jamoa a'zolariga xat yuboradi). Ulansa — Send Email hook bilan sintetik domenlarga xat filtrlanadi.
- `app_metadata.kind` (`tg` | `web`), Telegram akkauntida `app_metadata.tg_user_id` — faqat service_role yozadi; begona yaratgan akkauntni ajratish uchun.
- Bitta odam ham veb, ham Telegram'dan kirishi mumkin: bitta auth akkaunt. Veb login avval yaratilgan bo'lsa, Telegram bog'langanda o'sha akkaunt ishlatiladi.
- `loginEmailFromPhone(phone)` — sof funksiya, `+998901234567` → `p998901234567@phone.terron-build.invalid`. Veb login formasida telefon kiritilsa, shu funksiya bilan email'ga aylantiriladi va `signInWithPassword({ email, password })` chaqiriladi.

## Veb kirish

1. Login formasi: "Email yoki telefon" + parol.
2. Kiritilgan qiymat telefonga o'xshasa → `normalizePhone` → `loginEmailFromPhone`; aks holda email sifatida.
3. `supabase.auth.signInWithPassword`. Muvaffaqiyatli bo'lsa — `profiles` dan o'z profili (RLS orqali). Profil topilmasa (nofaol / o'chirilgan / firma nofaol) — chiqariladi, "Kirish huquqi yo'q" xabari.
4. `user_metadata.must_change_password = true` bo'lsa (admin `set_login` qilgan) — parolni o'zgartirish so'raladi; o'zgartirilganda frontend `supabase.auth.updateUser({ password, data: { must_change_password: false } })` qiladi.

## Admin: foydalanuvchi boshqaruvi

- Profil yaratish, rol, obyektga biriktirish, nofaol qilish — to'g'ridan-to'g'ri RLS orqali (`profilesRepo`, `objectMembersRepo`).
- Veb login berish yoki parolni tiklash — Edge Function `admin-users` (`verify_jwt = false`: chaqiruvchini funksiya o'zi `auth.getUser(jwt)` bilan tekshiradi):
  - `POST { action: 'set_login', profile_id, email?: string, password: string }`, sarlavha `Authorization: Bearer <access_token>`.
  - Chaqiruvchining faol profili `admin` yoki `super_admin` bo'lishi shart. `admin` — faqat **o'z firmasi** profillari; boshqa `admin` / `super_admin` ning loginiga tega olmaydi (o'zinikiga — mumkin). `super_admin` — istalgan.
  - Email berilmasa — telefondan sintetik (`loginEmailFromPhone`). Sintetik domenlarni qo'lda berib bo'lmaydi.
  - Profilda `auth_user_id` bo'lmasa — auth user yaratiladi (`email_confirm: true`, `app_metadata.kind = 'web'`) va bog'lanadi (`login_kind = 'web'`); bog'lash poygada yutqazilsa — yaratilgan user o'chiriladi (`409 conflict`). Bo'lsa — email/parol yangilanadi, `login_kind = 'web'`.
  - Ikkala holatda `user_metadata.must_change_password = true`.
  - Email (yoki telefon-login) band bo'lsa: egasi hech bir o'chirilmagan profilga bog'lanmagan (yetim) bo'lsa — o'chirib qayta urinadi; boshqa profilga bog'langan bo'lsa — `409 login_taken`.
  - Audit: `audit_log` ga `SET_LOGIN` (aktyor — admin, details: `login`, `login_type`, `created`; parol hech qachon).
  - Javob: `200 { ok: true, login: '<email yoki telefon>', login_kind: 'web' }`. Parol javobda qaytarilmaydi va loglanmaydi.
  - Xatolar `{ error: <kod> }`:

    | Status | Kod | Qachon |
    |---|---|---|
    | 400 | `invalid_request` | JSON shakli / turlari noto'g'ri, noma'lum action, profile_id uuid emas |
    | 400 | `weak_password` | parol < 8 belgi (yoki GoTrue parol siyosati rad etdi) |
    | 400 | `password_too_long` | parol > 72 bayt (bcrypt chegarasi) |
    | 400 | `email_invalid` | email formati noto'g'ri |
    | 400 | `email_reserved` | sintetik domen (`@phone.terron-build.invalid`, `@tg.terron-build.invalid`) |
    | 401 | `unauthorized` | JWT yo'q / yaroqsiz |
    | 403 | `forbidden` | rol yetmaydi, boshqa firma, admin → boshqa admin / super_admin |
    | 404 | `not_found` | maqsad profil yo'q (yoki o'chirilgan) |
    | 409 | `login_taken` | email/telefon-login boshqa profilga bog'langan auth user'da |
    | 409 | `conflict` | poyga — qayta urinish |
    | 500 | `internal` | ichki xato (logda) |

## Telegram Mini App kirish

### 1. `initData` tekshiruvi — `verifyInitData(initData, botToken, { nowSec, maxAgeSec })`

Telegram hujjati bo'yicha:
- `secret_key = HMAC_SHA256(key = "WebAppData", message = bot_token)`
- `data_check_string` — `hash` (va `signature`) dan tashqari barcha maydonlar, kalit bo'yicha alifbo tartibida, `key=value`, `\n` bilan ulangan (qiymatlar URL-decode qilingan holda).
- `hex(HMAC_SHA256(key = secret_key, message = data_check_string)) == hash` — doimiy vaqtli taqqoslash.
- `auth_date` dan beri `maxAgeSec` o'tmagan va kelajakda emas (5 daqiqa tolerans). Funksiya standarti 24 soat, **`tg-auth` 1 soat** (`3600`) beradi — initData Mini App ochilganda olinadi.
- Natija: `{ ok: true, user: { id, first_name, ... }, authDate }` yoki `{ ok: false, reason }`.
- Sof funksiya, WebCrypto (`crypto.subtle`) — Deno va Node'da bir xil ishlaydi.

### 2. Edge Function `tg-auth`

`POST { initData: string, access_token?: string }` →
- shakl noto'g'ri → `400 { error: 'bad_request' }`
- `initData` yaroqsiz / eskirgan → `401 { error: 'invalid_init_data' }`
- `telegram_user_id` bo'yicha faol profil (firma faol) topilsa → `200 { status: 'ok', session: { access_token, refresh_token, expires_at }, profile: { id, role, company_id, full_name } }`
  - `access_token` berilgan va `auth.getUser(access_token)` foydalanuvchisi profilning `auth_user_id` siga teng bo'lsa — yangi sessiya yaratilmaydi: `200 { status: 'ok', session: null, profile }`.
- Topilmasa → `200 { status: 'need_contact' }`
- Profil bor, lekin nofaol yoki firma nofaol → `403 { error: 'inactive' }`

Sessiya berish: profilda auth user bo'lsa (masalan veb login) — o'sha akkaunt ishlatiladi. Bo'lmasa — `tg<id>@tg.terron-build.invalid` bilan yaratiladi (`email_confirm: true`, tasodifiy kuchli parol, `app_metadata: { tg_user_id, kind: 'tg' }`), `auth_user_id` va `login_kind = 'tg'` yoziladi, audit `TG_AUTH_USER_CREATED`. Keyin `auth.admin.generateLink({ type: 'magiclink', email })` → `hashed_token` → `auth.verifyOtp({ type: 'magiclink', token_hash })` (yangi vaqtinchalik klientda) → sessiya. Hech qanday xat yuborilmaydi.

**Email band bo'lsa** (akkaunt egallashdan himoya): mavjud user'ga parol almashtirib qayta ishlatilmaydi. Egasi (`public.svc_auth_user_id_by_email` orqali) shu profilga bog'langan bo'lsa — o'sha (parallel so'rov); boshqa profilga bog'langan yoki `app_metadata.tg_user_id` mos kelmasa (begona yaratgan) — `500` va log; hech kimga bog'lanmagan va `tg_user_id` mos — o'chirib (eski sessiyalari ham o'ladi) qayta yaratiladi.

### 3. Telefon orqali bog'lash (birinchi kirish)

Telegram `requestContact` callback'i **telefon raqamini bermaydi va imzolamaydi** — kontakt bot'ga oddiy xabar sifatida yuboriladi. Shuning uchun bog'lash bot webhook'ida:

1. Mini App `need_contact` oladi → "Telefon raqamingizni ulashing" ekrani → `Telegram.WebApp.requestContact()`.
2. Telegram foydalanuvchi kontaktini bot'ga xabar sifatida yuboradi.
3. Edge Function `tg-bot` (webhook):
   - `X-Telegram-Bot-Api-Secret-Token` sarlavhasi `TELEGRAM_WEBHOOK_SECRET` bilan doimiy vaqtda solishtiriladi; mos kelmasa — 401.
   - `message.contact` bo'lsa: `contact.user_id === message.from.id` (o'z kontakti) bo'lishi shart, aks holda rad.
   - `contact.phone_number` (ko'pincha `+` siz: `998901234567`) — `+` qo'shiladi → `normalizePhone` → faol, o'chirilmagan, `telegram_user_id is null` profillar (firma faol) orasidan qidiriladi:
     - aniq 1 ta → `telegram_user_id = from.id`, `telegram_chat_id = chat.id` yoziladi (shartli UPDATE: profil hali ham shu telefon bilan, faol, o'chirilmagan, `telegram_user_id is null`), audit `TG_LINK`; bot'ga "Bog'landi. Ilovani oching" + Mini App tugmasi.
     - 0 ta → "Bu raqam tizimda topilmadi. Adminingizga murojaat qiling."
     - 2+ (bir raqam bir nechta firmada) → bog'lanmaydi, "Raqam bir nechta firmada — adminingizga murojaat qiling."
     - Shu `telegram_user_id` allaqachon boshqa profilga bog'langan → rad.
   - `/start` → salom va Mini App tugmasi (bog'lanmaganlarga — `request_contact` tugmasi ham). Bot matnlari — `supabase/functions/_shared/botMessages.ts`.
   - Webhook har doim tez `200` qaytaradi (Telegram qayta yubormasligi uchun), xatolar loglanadi.
4. Mini App kontakt yuborilgach `tg-auth` ni har 2 soniyada qayta chaqiradi (eng ko'pi 30 soniya). `status: 'ok'` → kirdi.

### 4. Klient tomoni

- `src/data/authRepo.ts`: `signInWithPassword(login, password)`, `signOut()`, `getSession()`, `onAuthChange(cb)`, `telegramSignIn(initData)` (`tg-auth` ni chaqiradi — amaldagi sessiya bo'lsa `access_token` ham yuboriladi; `session` null bo'lmasa `supabase.auth.setSession`), `getMyProfile()`.
- `x-client-device` sarlavhasi: Supabase klienti `/tg` ichida `mobil`, aks holda `veb` bilan yaratiladi (`global.headers`).
- `initDataUnsafe` faqat ko'rsatish uchun.

## Rollar va menyu — `src/domain/roles.ts`

Sof funksiyalar (testlar bilan):
- `webNavFor(role)` — veb menyu bandlari (ro'yxat `src/web/nav.ts` dagi kalitlar).
- `tgNavFor(role)` — Mini App pastki menyu bandlari.
- `can(role, action)` — UI uchun (tugmani ko'rsatish/yashirish). **Xavfsizlik RLS'da** — bu faqat qulaylik.

| Rol | Veb menyu | Mini App menyu |
|---|---|---|
| super_admin, admin | hammasi + Foydalanuvchilar, Obyektlar, Sozlamalar | Bosh, Kirim/chiqim, Xarid, Inventarizatsiya, Yozuvlarim |
| direktor | Bosh, Ombor, Xaridlar, Podotchet, Smeta, So'rovlar, Ogohlantirishlar, Tarix | Bosh, Yozuvlarim |
| buxgalter | Bosh, Materiallar, Ombor, Xaridlar, Podotchet, Smeta, Ogohlantirishlar | Yozuvlarim |
| taminotchi | Bosh, Materiallar, Xaridlar, So'rovlar | Xarid, Yozuvlarim |
| prorab | Bosh, Ombor, So'rovlar | Bosh, Kirim/chiqim, Xarid, So'rov, Yozuvlarim |
| omborchi | Bosh, Ombor | Bosh, Kirim/chiqim, Yozuvlarim |
| haydovchi | — (veb kerak emas) | Xarid, Yozuvlarim |
| tekshiruvchi | Bosh | Inventarizatsiya, Yozuvlarim |

## Maxfiy kalitlar (Supabase secrets, faqat foydalanuvchi qo'yadi)

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` — tasodifiy satr, `setWebhook` da `secret_token` sifatida
- `MINI_APP_URL` — ixtiyoriy, standart `https://terron-build.terron-build.workers.dev/tg`
- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` — Supabase Edge Functions'da avtomatik mavjud

## Audit (auth hodisalari)

Migratsiya `20261026000001_auth.sql`: `private.log_auth_event(company_id, actor_profile_id, target_profile_id, action, details)` (security definer) → `audit_log` (`table_name = 'auth'`, `record_id` = maqsad profil, `device = 'tizim'`; details'dan `password` / `new_password` / `old_password` kalitlari olib tashlanadi). Action: `SET_LOGIN`, `TG_LINK`, `TG_AUTH_USER_CREATED`.

- Edge'dan `public.svc_log_auth_event` (rpc) orqali — `private` sxema PostgREST'da ochiq emas; o'ram ham faqat `service_role` uchun execute (anon/authenticated — yo'q).
- Xuddi shunday `private.auth_user_id_by_email` / `public.svc_auth_user_id_by_email` — email bo'yicha auth user (`generateLink` mavjud bo'lmagan user'ni yaratib yuborgani uchun ishlatilmaydi).
- Audit yozilmasa — asosiy amal bekor qilinmaydi, xato loglanadi (profiles o'zgarishlari baribir `z_audit` trigger orqali auditlanadi).

## Fayllar

- `supabase/functions/_shared/` — sof, Deno'ga xos bo'lmagan TS: `telegramAuth.ts`, `phone.ts`, `loginEmail.ts`, `handler.ts` (javob turi, `randomPassword`), `authUsers.ts` (umumiy `deps` turlari), `botMessages.ts` (+ `*.test.ts`, Vitest node muhitida). Frontend ham ularni `@shared/*` alias orqali import qiladi — mantiq takrorlanmaydi.
- `supabase/functions/_shared/supabaseAdmin.ts`, `http.ts` — Deno'ga xos yordamchilar (CI'da `deno check`).
- `supabase/functions/<nom>/logic.ts` — butun mantiq, bog'liqliklar `deps` orqali (Vitest: `logic.test.ts`, soxta `deps`); `index.ts` — Deno handler (`Deno.serve`, CORS, `deps` realizatsiyasi).
- `supabase/config.toml` — uchala funksiya uchun `verify_jwt = false` (`tg-auth`: initData imzosi; `tg-bot`: webhook siri; `admin-users`: funksiya ichida `auth.getUser(jwt)`).
- `supabase/functions/deno.json` — faqat `compilerOptions` va `nodeModulesDir: "none"` (import map emas).
