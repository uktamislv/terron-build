# Telegram bot: ogohlantirishlar va kunlik hisobot (Batch 6)

## Oqim (outbox)

Xabarlar to'g'ridan-to'g'ri triggerdan yuborilmaydi — avval navbatga (outbox) yoziladi, keyin Edge Function yuboradi. Shunda Telegram yoki tarmoq xatosida xabar yo'qolmaydi va qayta yuboriladi.

1. `alerts` ga yangi qator (INSERT) → trigger `public.notification_outbox` ga qator qo'shadi va `net.http_post` bilan `tg-dispatch` ni "uyg'otadi" (darhol yuborish uchun).
2. `pg_cron` har daqiqada `tg-dispatch` ni chaqiradi (zaxira: uyg'otish yo'qolsa, xato bo'lsa — qayta urinish).
3. `pg_cron` har kuni `0 15 * * *` (UTC = 20:00 Toshkent) → `private.enqueue_daily_reports()` har faol firma uchun `daily_report` qatorini qo'shadi.
4. `tg-dispatch` (Edge Function, `verify_jwt = false`, maxfiy sarlavha bilan): navbatdan qatorlarni oladi (`svc_claim_notifications`), qabul qiluvchilarni aniqlaydi, xabarni shablondan yasaydi, Telegram'ga yuboradi, natijani yozadi (`svc_complete_notification`).

## Jadval `public.notification_outbox`

`id uuid`, `company_id`, `kind` (`alert` | `daily_report`), `alert_id uuid null`, `report_date date null`, `payload jsonb`, `status` (`pending` | `sending` | `sent` | `failed`), `attempts int`, `next_attempt_at timestamptz`, `last_error text`, `sent_count int`, `delivered_chat_ids bigint[]`, `created_at`, `sent_at`, `updated_at`.
- RLS: authenticated — faqat admin/super_admin o'qiydi (o'z firmasi); yozish — hech kim (faqat tizim).
- Unique: `(alert_id)` (alert bo'yicha bitta), `(company_id, report_date) where kind = 'daily_report'`.
- **Har qabul qiluvchi bo'yicha holat:** `delivered_chat_ids` — yetkazilgan chatlar; qayta urinishda faqat qolganlarga yuboriladi. `sent_count = cardinality(delivered_chat_ids)`. Qator `sent` bo'ladi faqat hozirgi har bir qabul qiluvchi yetkazilgan yoki yetib bo'lmaydigan (403 / 400 "chat not found") bo'lsa.
- Qayta urinish: `attempts` < 6, kechikish `2^attempts` daqiqa (2, 4, 8, 16, 32); 6 dan keyin `failed`. `attempts` claim paytida oshadi. Telegram 429 va vaqt byudjeti — `retry_after` soniyadan keyin, urinish hisoblanmaydi.
- **Doimiy xato → darhol `failed`:** yaroqsiz payload (xabar yasalmadi) va Telegram 400 xabarning o'zi uchun (masalan "can't parse entities", "message is too long" — shu qator; boshqa qatorlar davom etadi). Soni kunlik hisobotda (`failed_count`); veb paneldagi ko'rsatkich — Batch 9.
- **Bot tokeni yaroqsiz / bekor qilingan (401 / 404) — `failed` EMAS** (audit tuzatishi): shu chaqiruvdagi hamma qolgan qatorlar `retry_after = 600` s bilan keyinga, urinish hisoblanmaydi — token almashtirilgach xabarlar yo'qolmaydi. Darhol qayta yuborish SQL'i — `docs/telegram-bot-setup.md` §7.
- 10 daqiqadan ko'p `sending` da qolgan qator (funksiya yiqilgan) qayta olinadi; urinishlari tugagan bo'lsa — `failed` (`stuck_in_sending`).
- **Audit istisnosi:** tizim jurnali — `audit_log` trigger, `created_by`, soft delete yo'q (yozuvchi faqat security definer funksiyalar, foydalanuvchi o'zgartira olmaydi). DELETE / TRUNCATE baribir bloklanadi, eski qatorlar saqlanadi.
- **Yetkazish kafolati — "kamida bir marta":** xabar yo'qolmaydi, lekin kamdan-kam takrorlanishi mumkin (Telegram qabul qilgan, natija bazaga yozilmay qolgan — masalan funksiya shu orada yiqilgan; qator 10 daqiqadan keyin qayta olinadi va o'sha chatga yana yuboriladi).

## Qaysi alertlar darhol yuboriladi

- `xarid_qabul_farqi`, `narx_ogishi`, `yozuv_ochirildi`, `normadan_oshish`, `inventarizatsiya_kamomadi`, `smetadan_ortiq_sorov` — darhol.
- `ozi_qabul_qilgan` (`severity = 'belgi'`) — darhol **emas**, faqat kunlik hisobotda soni.
- Alert yangilanishi (`details` o'zgarishi) qayta yubormaydi — istisno (Batch 8): `normadan_oshish` kuchaysa (jiddiy / over_pct ≥ 50 / ≥ 100) outbox'ga `escalation` = 1/2/3 bilan yangi qator (payload `escalation` maydoni bilan), har daraja bir marta; unique `(alert_id, escalation)`.
- `otkazma_farqi` (Batch 8) — darhol; `direction`: `under` / `over` / `not_received`.
- **Spam himoyasi:** bitta dispatch chaqiruvida bitta firmadan 5 tadan ko'p `alert` qatori olinsa — `formatAlertDigest` bilan bitta xabar (har qabul qiluvchiga bitta); qatorlarning hammasi birga yakunlanadi. Bitta chatga ketma-ket yuborishlar orasida ~1 s.

## Qabul qiluvchilar

Faol firmaning faol (`is_active`, o'chirilmagan) `direktor` va `admin` profillari, `telegram_chat_id is not null`; bitta chat — bir marta. Hech kim bo'lmasa — `sent` (`sent_count = 0`), xato emas.

## Payload

Alert uchun (trigger yig'adi, ismlar shu paytdagi holatda):
```json
{ "alert_id": "...", "type": "narx_ogishi", "severity": "ogohlantirish",
  "object_name": "Obyekt A", "material_name": "Sement M400", "base_unit": "kg",
  "details": { ...alerts.details... }, "created_at": "..." }
```

Kunlik hisobot uchun — `private.daily_report_stats(company_id, period_start, period_end)`, oraliq **`[kecha 20:00, bugun 20:00)` Toshkent** (hisobot yuborilgandan keyingi yozuvlar ertangisiga tushadi — hech narsa tushib qolmaydi); `report_date` va `date` — bugungi sana:
```json
{ "date": "2026-10-29", "period_start": "2026-10-28T15:00:00Z", "period_end": "2026-10-29T15:00:00Z",
  "company_name": "...",
  "kirim_count": 12, "chiqim_count": 7, "purchases_count": 5, "purchases_sum": "12500000.00",
  "requests_count": 0, "alerts_new": 3, "alerts_by_type": { "narx_ogishi": 1, "xarid_qabul_farqi": 2 },
  "self_received_count": 1, "deleted_count": 0, "failed_count": 0 }
```
`requests_count` — oraliqda yaratilgan `material_requests` (Batch 8 gacha amalda 0). `alerts_new` / `alerts_by_type` — `belgi`, `ozi_qabul_qilgan` va `yozuv_ochirildi` siz (ular `self_received_count` va `deleted_count` da alohida). `failed_count` — oraliqda `failed` bo'lgan outbox qatorlari (shu firma). Vaqt ustunlari: `movements.occurred_at`, `purchases.purchased_at`, `material_requests.created_at`, `alerts.created_at`, `notification_outbox.updated_at`; o'chirilganlar hisoblanmaydi. Raqamlar navbatga qo'yilgan paytdagi holatda.

## Xabar shablonlari

Bitta joyda: `supabase/functions/_shared/notifyMessages.ts` (sof TS, testlar bilan). Telegram `parse_mode: 'HTML'` — barcha foydalanuvchi matnlari (nomlar) HTML-escape qilinadi.
- `formatAlertMessage(payload): string` — masalan:
  - "⚠️ <b>Narx odatdagidan yuqori</b>\nSement M400 · Obyekt A\nNarx: 1 450 so'm/kg (o'rtacha 1 300)\n29.10.2026 14:32"
  - "⚠️ <b>Xarid va qabul farqi</b>\n…Xarid: 100 kg, qabul: 85 kg (−15 %)"
  - "🗑 <b>Xarid o'chirildi</b>\nSement M400 · 1 250 000 so'm · Ali Valiyev"
- `formatAlertDigest(payloads): string` — "⚠️ 12 ta yangi ogohlantirish" + tur bo'yicha qisqa ro'yxat, ko'pi bilan 10 tasi tafsilot bilan, qolgani "… va yana N ta".
- `formatDailyReport(payload): string` — "📊 <b>Kunlik hisobot · 29.10.2026</b>\nKirim: 12 · Chiqim: 7\nXaridlar: 5 ta, 12 500 000 so'm\nSo'rovlar: 0\nYangi farqlar: 3 (narx — 1, xarid/qabul — 2)\nO'zi qabul qilgan: 1"
- Raqamlar o'zbek formatida (minglik bo'sh joy, kasr vergul), sana `dd.mm.yyyy`, vaqt Asia/Tashkent.
- Har xabar ostida inline tugma `web_app`: "Mini App'ni ochish" → `MINI_APP_URL` (alert uchun `…/tg`; hisobot uchun ham).
- Direktor ham Mini App'da faqat ko'rish huquqiga ega (Batch 9 da bosh ekran).

## Xavfsizlik

- `tg-dispatch` ni faqat baza chaqiradi: sarlavha `x-dispatch-secret` = Vault'dagi `tg_dispatch_secret` (migratsiya ichida `gen_random_bytes` bilan yaratiladi — git'da yo'q). Edge Function sirni `svc_dispatch_secret()` (faqat service_role) orqali o'qiydi va doimiy vaqtda solishtiradi. Noto'g'ri → 401.
- Sir keshi: funksiya ichida 5 daqiqa. Sarlavha mos kelmasa — keshni yangilab yana tekshiradi, lekin bazaga ko'pi bilan 30 s da bir marta boradi.
- **Sirni almashtirish (rotatsiya):** `select vault.update_secret((select id from vault.secrets where name = 'tg_dispatch_secret'), encode(extensions.gen_random_bytes(32), 'hex'));` — keyingi uyg'otishlar yangi sir bilan ketadi; funksiya birinchi mos kelmagan so'rovda keshni yangilaydi (30 s ichida eski sirli so'rov 401 olishi mumkin — xabar navbatda qoladi, cron keyingi daqiqada yuboradi).
- Dispatch URL — `private.app_settings` jadvalida (`dispatch_url`), sir emas. Migratsiya production loyiha URL'ini yozadi. **Lokal / staging bazada** production funksiyasini uyg'otmaslik uchun: `update private.app_settings set value = '' where key = 'dispatch_url';` (yoki o'sha muhitning URL'i) — bo'sh bo'lsa uyg'otish WARNING bilan o'tkaziladi.
- `net` sxemasi jadvallari (`net.http_request_queue` — sarlavhada sir, `net._http_response`) — `anon` / `authenticated` ga yopiq (migratsiyada `revoke`).
- Bot tokeni faqat Supabase secrets'da (Batch 2). Token va sir log, javob va `last_error` ga tushmaydi (`sanitizeError`).

## Amalga oshirish (Batch 6)

- Migratsiya: `supabase/migrations/20261030000001_notifications.sql` (baza tafsilotlari — `docs/db-design.md`, "Telegram bildirishnomalari").
- Edge Function: `supabase/functions/tg-dispatch/{logic,index}.ts`, `verify_jwt = false`.
  - `x-dispatch-secret` yo'q / noto'g'ri → 401 (sarlavha yo'q bo'lsa baza chaqirilmaydi); Vault'da sir yo'q → 500.
  - **Darhol javob (audit tuzatishi):** sir tekshirilgach funksiya `202 {"accepted":true}` qaytaradi va yuborish siklini `EdgeRuntime.waitUntil` ichida fonda davom ettiradi — pg_net 5 s timeout'i siklni uzmaydi. `EdgeRuntime` bo'lmasa (lokal) — sinxron, `200 { processed, sent, failed }`.
  - `svc_claim_notifications(20)` → xabarlar rejasi (digest) → har xabar uchun `svc_outbox_recipients(p_outbox_id)` (Batch 12; kind bo'yicha qabul qiluvchilar) → yetkazilmagan chatlarga `sendMessage` (`parse_mode: 'HTML'`, link preview o'chiq, 5 s timeout) → `svc_complete_notification(p_id, p_ok, p_delivered, p_error, p_retry_after_sec, p_final[, p_blocked_chat_ids])`.
  - 403 (bot bloklangan, akkaunt o'chirilgan) va 400 "chat not found" / "user not found" / "PEER_ID_INVALID" — qabul qiluvchi o'tkazib yuboriladi, xato emas; bu chat id'lar `p_blocked_chat_ids bigint[]` bilan yuboriladi — faqat `tg-dispatch/logic.ts` dagi `COMPLETE_SENDS_BLOCKED_CHAT_IDS = true` bo'lganda (DB parametrni qo'shgach yoqiladi; RPC eski bo'lsa PGRST202 → parametrsiz qayta chaqiriladi).
  - Boshqa 400 → xabar yaroqsiz: shu qator darhol `failed`, qolgan qabul qiluvchilarga yuborilmaydi.
  - 401 / 404 → bot tokeni yaroqsiz: qolgan qatorlar `retry_after = 600` (failed emas).
  - 429 → joriy qator (yetkazilganlari yozilib) va shu chaqiruvda qolgan qatorlar `retry_after` bilan keyinga.
  - Vaqt byudjeti: sikl ~50 s dan oshsa, qolgan qatorlar `retry_after = 1` bilan qaytariladi.
  - Xabar 4096 dan uzun bo'lsa butun qatorlar olib tashlanadi; bitta qator ham sig'masa — HTML teglar olib tashlanib kesiladi (yarim teg / entity qolmaydi).
  - Natija (sinxron rejimda javob, fon rejimida log): `{ processed, sent, failed }` (`failed` — shu chaqiruvda `sent` bo'lmagan qatorlar: qayta urinishga ketganlar ham).
- Uyg'otish (`private.wake_dispatch`) bir tranzaksiyada bir marta; pg_net so'rovi commit'dan keyin ketadi, xatosi alert INSERT ni buzmaydi.

### Deploy

1. `supabase db push` (yoki MCP `apply_migration`) — `20261030000001_notifications.sql`. Oldin Database → Extensions: `pg_net`, `pg_cron`, `supabase_vault` yoqilganini tekshiring (migratsiya `create extension if not exists` qiladi).
2. `supabase functions deploy tg-dispatch --no-verify-jwt`. Secrets (Batch 2 dan bor): `TELEGRAM_BOT_TOKEN`, `MINI_APP_URL`; `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — avtomatik.
3. Tekshiruv: `select jobname, schedule from cron.job;` — `terron-dispatch`, `terron-daily-report`; `select count(*) from vault.secrets where name = 'tg_dispatch_secret';` = 1; `select private.wake_dispatch();` → `select status_code, content from net._http_response order by id desc limit 1;` — 202 `{"accepted":true}` (yuborish fonda; natija — funksiya loglarida "tg-dispatch: tugadi").
4. Direktor/admin Mini App orqali Telegram'ni bog'lagan bo'lishi kerak (`profiles.telegram_chat_id`), aks holda xabar `sent_count = 0` bilan yopiladi.
