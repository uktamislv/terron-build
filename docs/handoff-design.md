# Batch 11 — Topshirish

Maqsad: tizimni quruvchiga sinovga berishga tayyorlash.

## 1. Xatolik haqida xabar berish

- Jadval `public.bug_reports`: `id, company_id, created_by, message text (1..2000), screen text (≤200, masalan "/tg/movement"), client text (≤500 — platforma, Telegram versiyasi, user agent qisqa), app_version text (≤50), photo_path text (ixtiyoriy, Storage `photos` bucket qoidalari bilan), status text check in ('yangi','korildi','hal_qilindi') default 'yangi'` + standart ustunlar. RLS: har bir faol foydalanuvchi o'z firmasiga **insert** qiladi (`created_by` = o'zi); o'qish — o'zi yozganlarini + admin/super_admin firmaning hammasini; status o'zgartirish — admin. Soft delete, audit.
- Insert trigger → `notification_outbox` kind `bug_report` (payload: report id, kim, rol, ekran, xabar (≤500 kesilgan), client). Qabul qiluvchilar — `svc_outbox_recipients`: **faqat super_admin** (tizim egasi; `20261111000001_expenses.sql` dan — firma adminlari emas). Firma admini xabarlarni veb paneldagi ro'yxatda ko'radi (RLS o'zgarmagan).
- Cheklov: bir foydalanuvchi 10 daqiqada ≤ 5 ta xabar (`23514 bug_report_rate_limited`).
- Mini App: har ekranda (TgLayout sarlavhasida yoki "Mening yozuvlarim" yonida) kichik "Xatolik haqida xabar berish" tugmasi → BottomSheet: matn (majburiy), ixtiyoriy rasm (skrinshot), joriy ekran avtomatik. Yuborilgach: "Rahmat, xabaringiz yuborildi" (Telegram xabari faqat tizim egasiga — super_admin).
- Veb: yon menyuda (foydalanuvchi bloki) ham shu tugma; admin uchun "Xatolik xabarlari" ro'yxati (Sozlamalar ichida yoki alohida sahifa) — holatni o'zgartirish.

### Baza (`supabase/migrations/20261107000001_handoff.sql`)

- **Ustunlar:** `id uuid` (pk, klient yuborishi mumkin — idempotentlik), `company_id uuid not null`, `message text not null` (btrim, 1..2000), `screen text` (≤ 200), `client text` (≤ 500), `app_version text` (≤ 50), `photo_path text`, `status text not null default 'yangi'` (`yangi` | `korildi` | `hal_qilindi`), `created_by uuid` (kompozit FK `(company_id, created_by) → profiles`), `created_at`, `updated_at`, `deleted_at`. Unique `(company_id, id)`.
- **Klient INSERT qiladigan ustunlar:** `id, company_id, message, screen, client, app_version, photo_path` (boshqalari — 42501). `company_id` berilmasa — o'z firmasi. `created_by`, `status = 'yangi'`, `deleted_at = null` — server (trigger `b_bug_reports_guard`). `screen` / `client` / `app_version` server tomonida kesiladi (xato bermaydi), bo'sh satr → null.
- **RLS:** INSERT — faol foydalanuvchi, faqat o'z firmasiga (super_admin ham). SELECT — o'zi yozgan o'chirilmaganlar; admin — firmaning hammasi (o'chirilganlari ham); super_admin — barcha firmalar. UPDATE — admin (o'z firmasi), super_admin; ustun grantlari: faqat `status`, `deleted_at`. Muallif / boshqa rollar UPDATE qilsa — 0 qator. DELETE — yo'q (soft delete). Tiklash — admin, `update … set deleted_at = null` (tiklash oq ro'yxatiga kirmaydi — alerts kabi ish oqimi jadvali).
- **Cheklov:** bir profil 10 daqiqada ≤ 5 ta (o'chirilganlari ham hisoblanadi) — `23514 bug_report_rate_limited`. Mavjud `id` bilan qayta yuborish cheklovga tushmaydi — `23505 bug_reports_pkey` (klient "saqlangan" deb qabul qiladi). service_role — cheklovsiz.
- **Skrinshot:** yo'l `{company_id}/bug/{yyyy}/{mm}/{uuid}.{ext}` (kichik harf; `photos` bucket). Yuklash (`photos_insert`) — istalgan faol rol, faqat o'z firmasi papkasiga; ko'rish (`photos_select`) — yuklagan odam, firma admini, super_admin (direktor va boshqa firma bo'yicha rollar ko'rmaydi). Xabarga biriktirish: format, firma papkasi, o'zi yuklagan va 24 soatdan yangi (admin ham faqat o'zinikini), bitta rasm — bitta tirik xabar. Operatsiya rasmlari (`{company_id}/{yyyy}/{mm}/…`) xabarga biriktirilmaydi va aksincha.
- **Xato kalitlari:** `bug_report_invalid` (23514 — xabar bo'sh yoki > 2000), `bug_report_rate_limited` (23514), rasm — mavjud `ops_photo_path_format` (23514), `ops_photo_path_company` (23514), `ops_photo_not_owned` (42501), `ops_photo_reused` (23505). Noto'g'ri `status` — CHECK 23514 (hint'siz).
- **Frontend uchun:** rasm yo'lini `photoPath` emas, `bug/` papkali variant bilan yasash kerak (`{companyId}/bug/{yyyy}/{mm}/{uuid}.{ext}`, oy Asia/Tashkent). `tg-dispatch` `kind = 'bug_report'` uchun shablon talab qiladi (aks holda qator "noma'lum kind" bilan `failed`).

### Bildirishnoma payloadi (bug_report)

`notification_outbox`: `kind = 'bug_report'`, `bug_report_id` (FK, xabar bo'yicha bitta qator — unique), `alert_id`, `report_date`, `profile_id` — null. Trigger `bug_reports.zz_notify` (AFTER INSERT, tirik xabar) qatorni qo'shadi va `tg-dispatch` ni uyg'otadi. Hamma kalitlar har doim bor (qiymati `null` bo'lishi mumkin); ismlar — yozilgan paytdagi holatda.

```json
{ "bug_report_id": "uuid", "company_id": "uuid", "company_name": "Demo qurilish",
  "reporter_id": "uuid | null", "reporter_name": "Sherzod Aliyev | null", "reporter_role": "prorab | null",
  "screen": "/tg/movement | null", "message": "≤ 500 belgi (kesilgan)", "message_truncated": false,
  "client": "tg 8.0 · android | null", "app_version": "0.11.0 | null", "has_photo": true,
  "created_at": "<timestamptz>" }
```

Qabul qiluvchilar — `public.svc_outbox_recipients(p_outbox_id)` (Batch 12 RPC, create or replace): **faqat** barcha faol `super_admin` lar (qaysi firmada bo'lishidan qat'i nazar; ularning firmasi ham faol bo'lishi shart; `20261111000001_expenses.sql` dan firma `admin` lari qabul qiluvchi emas), bloklanmagan (`telegram_blocked_at is null`), `telegram_chat_id` bor, bitta chat — bir marta. Rasmning o'zi Telegram'ga yuborilmaydi (`has_photo` — faqat belgi; ko'rish — veb paneldagi ro'yxatda, signed URL).

## 2. Qo'llanma (har rol uchun 1 sahifa)

- Matn — `src/i18n/guides.uz.ts` (rus tili keyin qo'shiladi): har rol uchun sarlavha, "Sizning vazifangiz" (2–3 gap), "Har kuni" (qadamlar), "Muhim qoidalar", "Ogohlantirishlar nimani anglatadi" (shu rolga tegishlilari), "Savol bo'lsa".
- Rollar: admin, direktor, buxgalter, taminotchi, prorab, omborchi, haydovchi, tekshiruvchi.
- Ko'rsatish: Mini App'da "Yordam" (pastki menyu emas — sarlavhadagi "?" belgisi) va veb'da "Yordam" (yon menyu, foydalanuvchi bloki) — o'z roli sahifasi, boshqa rollarni ham ochish mumkin. Chop etish uchun qulay (print CSS — bir rol = bir A4).
- Nusxa: `docs/qollanma/<rol>.md` — chop etish/yuborish uchun (shu matndan).

## 3. Sinov ma'lumotlari

- `supabase/seed/demo.sql` — **alohida "Demo qurilish" firmasi** (haqiqiy firma ma'lumotlariga tegmaydi): 3 obyekt (koordinatalari bilan), shablon materiallar, 1 smeta (har obyektga), 30 kunlik kirim/chiqim/xarid/podotchet/so'rov/o'tkazma/inventarizatsiya, bir nechta ogohlantirish holati (xarid ≠ qabul, narx og'ishi, normadan oshish, manfiy qoldiq…). Profillar auth foydalanuvchisiz (`login_kind` qoidalariga mos) — faqat ma'lumot ko'rinishi uchun. Idempotent (qayta ishga tushirsa takrorlamaydi), bitta tranzaksiya.
- Avtomatik **qo'llanmaydi** — admin xohlasa `supabase db query`/SQL editor orqali ishga tushiradi (yo'riqnoma `docs/deploy-supabase.md` da). PGlite testida tekshiriladi.
- Amalga oshirish: firma id `de300000-0000-4000-8000-000000000001`, bor bo'lsa — hech narsa qilinmaydi (NOTICE). Triggerlar yoqiq — alertlar tabiiy hosil bo'ladi (14 tur, `supabase/tests/sql/demo_seed.sql.test.ts` da qayd etilgan). Oddiy yozuvlar "tizim" kontekstida (claims yo'q, o'tgan sanalar ruxsat), faqat sessiya talab qiladigan RPC'lar (`create_transfer`, `receive_transfer`, `submit_inventory_count`) va admin qarorlari uchun 4 ta vaqtinchalik `auth.users` qatori (`*@demo-seed.invalid`) demo admin / 2 prorab / tekshiruvchiga bog'lanadi va `request.jwt.claims` (tranzaksiya-lokal) o'rnatiladi; oxirida bog'lanish uziladi va auth qatorlari o'chiriladi. Global cron funksiyalari chaqirilmaydi (`podotchet_muddati`, `podotchet_manfiy`, `request_overdue` keyingi cron'da tabiiy chiqadi). `created_at` va `alerts.created_at` — seed ishga tushgan vaqt.

## 4. Mayda ishlar

- Sozlamalar alohida sahifa: `/settings`, `WebNavKey 'settings'` (admin, super_admin), yon menyuda.
- `docs/telegram-bot-setup.md`: "Ko'rildi" tugmasi uchun webhook'ni qayta ulash (`node scripts/setup-telegram.mjs`) va bot tokenini almashtirish (sinovdan oldin — token 25.10.2026 da ochiq ko'ringan).
