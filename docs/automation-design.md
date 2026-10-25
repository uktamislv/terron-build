# Batch 12 — Avtomatlashtirish

Maqsad: qo'lda kiritishni kamaytirish va hozir ushlanmayotgan yo'qotish holatlarini ushlash. Asos: tizim tahlili va o'xshash tizimlar (Procore, Kojo, Buildertrend, Raken, Sitemate, Gectaro, 1C:УСО, chek QR + soliq API holati) o'rganildi.

Umumiy qoidalar: yangi ogohlantirishlar — `alerts` (yangi `alert_type` qiymatlari), Telegram'ga Batch 6 outbox orqali; har qoida — TS da sof funksiya + SQL'da bir xil mantiq (PGlite parity testlari, mavjud qoidalar kabi). Firma sozlamalari — `companies` ustunlari (standart qiymat bilan), admin veb sozlamalarda o'zgartiradi. Hamma matn — `src/i18n/uz.ts`; bot matnlari — `supabase/functions/_shared/notifyMessages.ts`.

Migratsiya: `supabase/migrations/20261106000001_automation.sql` (bitta fayl).

## A. Kirim manbasi

1. **Avtomatik bog'lash (UI).** Kirim ekranida shu obyekt + material uchun ochiq xarid (`open_purchases`) **bittagina** bo'lsa — u oldindan tanlangan (bir bosishda olib tashlanadi). Bir nechta bo'lsa — eng eskisi birinchi, tanlanmagan.
2. **Server:** `private.evaluate_purchase_receipt` (soatlik) — bog'lanmagan kirim (shu obyekt, material, xarid vaqtidan keyin 72 soat ichida, `purchase_id` null, `transfer_id` null) xaridga **nomzod** sifatida hisoblanadi. Nomzodlar miqdori farqni yopsa — "xarid ≠ qabul" alerti yaratilmaydi (soxta "100% qabul qilinmagan" chiqmaydi), lekin kirim `kirim_manbasiz` bilan belgilanadi; yopmasa — alert `details.unlinked_candidates` (kirim id va miqdorlari) bilan.
3. **Yangi alert `kirim_manbasiz`** (severity `belgi`): kirim `purchase_id` va `transfer_id` siz, va shu obyekt+materialda ochiq xarid bor (ya'ni bog'lash kerak edi) **yoki** oxirgi 7 kunda shu obyekt+material uchun hech qanday xarid/o'tkazma yo'q. Inventarizatsiya tuzatishi (`inventory_adjust`) bundan mustasno.

## B. Manfiy qoldiq

- Trigger: `chiqim` / `transfer_out` dan keyin obyekt+material qoldig'i < 0 → alert `manfiy_qoldiq` (`ogohlantirish`, `details: {stock_after, qty_base, unit}`), bir obyekt+material uchun ochiq alert bo'lsa — yangisi yaratilmaydi (details yangilanadi).
- `create_transfer`: manba qoldig'idan ko'p bo'lsa — `22023 transfer_insufficient_stock` (xabarda mavjud qoldiq). Chiqim bloklanmaydi (qurilishda kirim kechikishi mumkin) — faqat alert.

## C. Takroriy yozuv

- `movements`, `purchases`: shu `created_by`, obyekt, material, `qty_base` (xaridda + `total_amount`) 10 daqiqa ichida takrorlansa → alert `takroriy_yozuv` (`belgi`, `details.first_id`). UI: saqlashdan oldin ogohlantirish ("10 daqiqa oldin xuddi shunday yozuv kiritilgan — baribir saqlaysizmi?"), bloklamaydi.
- Rasm xeshi: `purchases.receipt_photo_sha256`, `movements.photo_sha256` (klient hisoblaydi, SHA-256 hex, server format tekshiradi). Shu firmada shu xesh boshqa yozuvda bo'lsa → `takroriy_yozuv` (`details.kind = 'photo'`, `ogohlantirish`).
- Chek QR (G bo'lim) — fiskal belgi firma bo'yicha **unique** (o'chirilmaganlar): takroriy chek saqlanmaydi (`23505 receipt_already_used`, kim va qachon ishlatgani bilan).

## D. Joylashuv (GPS)

- `objects`: `lat numeric(9,6)`, `lng numeric(9,6)`, `radius_m integer default 300` (nullable koordinatalar). Admin vebda kiritadi; Mini App'da prorab/admin "Shu yerni obyekt joyi qilish" (admin tasdig'isiz faqat admin).
- `movements`, `purchases`: `geo_lat`, `geo_lng`, `geo_accuracy_m`, `geo_status text check in ('ok','denied','unavailable')` (nullable — eski yozuvlar, veb).
- Mini App: Telegram `LocationManager` (Bot API 8.0; yo'q bo'lsa `navigator.geolocation`), saqlashni **to'xtatmaydi** — 3 s kutadi, bo'lmasa `unavailable`.
- Alert `joylashuv_farqi` (`belgi`): kirim/chiqim/xarid obyekt koordinatasidan `radius_m + accuracy` dan uzoqda (haversine, SQL'da). Xarid — obyekt emas, do'kon joyida bo'ladi → xarid uchun alert yo'q, faqat saqlanadi (kelajakda tahlil). `denied` — kunlik hisobotda soni.

## E. Rasm majburiy (chegara)

- `companies.photo_required_amount numeric(18,2)` (null = o'chiq; standart null), `materials.photo_required boolean default false`.
- Guard: xarid `total_amount >= photo_required_amount` yoki material `photo_required` → `receipt_photo_path` majburiy (`23514 photo_required`). Kirimda material `photo_required` → `photo_path` majburiy. Chek QR orqali tasdiqlangan xarid (G) — rasmsiz ham qabul (QR o'zi isbot).
- UI: majburiy bo'lsa rasm maydoni "majburiy" belgisi bilan, Saqlash rasm qo'shilmaguncha nofaol, sabab ko'rsatiladi.

## F. Smetasiz chiqim

- Alert `smetasiz_chiqim` (`ogohlantirish`): joriy smetasi yo'q obyektda chiqim — obyekt bo'yicha kuniga bittadan (Toshkent kuni), `details: {count, materials}` kun davomida yangilanadi.

## G. Chek QR (soliq.uz)

- O'zbekiston fiskal cheklarida QR → `https://ofd.soliq.uz/...` havola (aniq format — domain-logic agent o'rganadi va test bilan mustahkamlaydi).
- Mini App xarid ekrani: "Chekni skanerlash" — `Telegram.WebApp.showScanQrPopup`. Natija URL → `parseReceiptQr(url)` (sof, `src/domain/receipt/`) → `{ terminalId, receiptNo, fiscalSign, datetime?, total? }` yoki null (boshqa domen — rad).
- Edge Function `receipt-lookup` (JWT talab qiladi): faqat ruxsat etilgan host (`ofd.soliq.uz`) ga GET (5 s timeout, redirect yo'q, ≤ 1 MB), HTML'dan sotuvchi nomi, STIR (INN), sana-vaqt, jami, qatorlar (nom, miqdor, narx, summa) ni ajratadi (`logic.ts` — sof parser, fixture HTML bilan test). Natija `receipt_lookups` keshida (fiskal belgi bo'yicha, firma bo'yicha RLS). Sahifa ochilmasa — QR maydonlarining o'zi saqlanadi, foydalanuvchi qo'lda to'ldiradi.
- Xarid: `purchases.receipt_fiscal_sign text`, `receipt_terminal_id text`, `receipt_no text`, `receipt_verified boolean default false`, `receipt_total numeric(18,2)`, `seller_tin text`. Formada: summa, sana, sotuvchi avtomatik; bitta qatorli chek → material nomi bo'yicha moslash (`matchMaterialByName`), ko'p qatorli → foydalanuvchi qatorni tanlaydi (bitta xarid = bitta material qoladi; ko'p qatorli xarid — keyingi bosqich).
- `receipt_total` ≠ `total_amount` (> 1 so'm) → alert `chek_farqi` (`ogohlantirish`).
- Sotuvchi: `suppliers.tin text` — STIR bo'yicha topiladi, bo'lmasa avtomatik yaratiladi (nom + STIR).

## H. So'rov → xarid zanjiri

- `purchases.request_id uuid` (FK `(company_id, request_id)`). Xarid ekranida (taminotchi/prorab/haydovchi) shu obyekt uchun **tasdiqlangan** so'rovlar chip sifatida — bosilsa obyekt, material, miqdor to'ladi.
- Trigger: `request_id` bilan xarid yaratilsa — so'rov `xarid_qilindi`, `purchase_id` bog'lanadi (mavjud guard'lar bilan mos). Qo'lda belgilash (veb modal) qoladi.
- Cron (kuniga 09:00 Toshkent): `tasdiqlandi` holatidagi, `needed_by` o'tgan so'rovlar → taminotchi va admin'ga eslatma (bot, alert emas — `notification` outbox, `kind = 'request_overdue'`).
- Xarid miqdori so'rovdan 20% dan ko'p → alert `sorovdan_ortiq_xarid` (`belgi`).

## I. Podotchet

- `cash_advances.kind text not null default 'berildi' check in ('berildi','qaytarildi')` — qaytarish: odam ortiqcha pulni qaytardi. `cash_balances` = berildi − qaytarildi − xaridlar.
- `companies.cash_max_days integer default 14`. Kunlik cron: balansi > 0 va eng eski "yopilmagan" berilgan pul (FIFO: berilganlar − sarflar − qaytarishlar) `cash_max_days` dan eski → alert `podotchet_muddati` (`ogohlantirish`, odam bo'yicha bitta ochiq). Balans < 0 → alert `podotchet_manfiy` (`belgi`).
- Haftalik (dushanba 09:00 Toshkent) pul egasiga (Telegram ulangan bo'lsa) shaxsiy xabar: berildi, sarflandi, qaytarildi, qoldiq, eng eski qoldiq sanasi.

## J. Eslatmalar va Telegram tugmalari

- Ochiq (`yangi`) alert 48 soatdan oshsa — direktor va admin'ga bir marta qayta eslatma (`details.reminded_at`).
- Qabul qilinmagan o'tkazma (`otkazma_farqi/not_received`) — jo'natgan va qabul qiluvchi obyekt prorab(lar)iga ham xabar.
- Alert xabarida inline tugmalar: "Ko'rildi" (`callback_data = 'al:seen:<alert_id>'`) va "Ochish" (Mini App havolasi). `tg-bot` `callback_query` ni qabul qiladi: chat → profil (telegram_user_id), rol admin/super_admin, alert shu firmaniki → `status = 'korildi'`; boshqalarga "Faqat admin" javobi (`answerCallbackQuery`). Xabar tahrirlanadi: "✓ Ko'rildi — <ism>".

## K. Material tugash prognozi

- SQL `public.stock_forecast(p_object_id uuid)` (security invoker): har material — qoldiq (asosiy birlikda), oxirgi 14 kun o'rtacha kunlik chiqim, `days_left` (qoldiq / o'rtacha; o'rtacha 0 bo'lsa null), boshqa obyektlardagi qoldiq (faqat foydalanuvchi ko'ra oladigan obyektlar), smetada qolgan miqdor. Hisob — sof funksiya `forecastDays` (TS) bilan parity.
- Mini App bosh (prorab/omborchi/direktor): "Tugayotganlar" — `days_left <= 3`, har birida "So'rov yuborish" (miqdor taklifi: 7 kunlik sarf, smeta qoldig'idan oshmaydi) va boshqa obyektda bo'lsa "O'tkazma so'rash".
- Kunlik hisobotga: tugayotgan materiallar soni.

## L. Kiritishni tezlashtirish (UI)

- Har foydalanuvchi + material uchun oxirgi birlik va miqdor eslab qolinadi (localStorage, `src/tg/*/prefs.ts` uslubida, try/catch); keyingi safar birlik oldindan tanlangan, miqdor — taklif (chip), avtomatik yozilmaydi.
- So'rov, o'tkazma, inventarizatsiya ekranlarida materiallar `rankMaterials` + `my_material_usage` bo'yicha (kirim/chiqim ekranidagidek).

## Yangi alert turlari (yig'ma)

`kirim_manbasiz`, `manfiy_qoldiq`, `takroriy_yozuv`, `joylashuv_farqi`, `smetasiz_chiqim`, `chek_farqi`, `sorovdan_ortiq_xarid`, `podotchet_muddati`, `podotchet_manfiy`.

## Yangi firma sozlamalari

`photo_required_amount` (null), `cash_max_days` (14), `duplicate_window_minutes` (10), `request_overbuy_pct` (20), `alert_remind_hours` (48), `forecast_days_warn` (3). Veb: Sozlamalar sahifasida (admin).

## Bildirishnoma payloadlari (DB → tg-dispatch)

Manba: `supabase/migrations/20261106000001_automation.sql`. Hamma kalitlar har doim bor (qiymati `null` bo'lishi mumkin). Alert `details` dagi miqdor va pul — JSON son (numeric, kasr saqlanadi); outbox payload'idagi pul — **satr** (`"1250000.00"`, kunlik hisobotdagi `purchases_sum` kabi). Sana — `"YYYY-MM-DD"` (Toshkent kuni), vaqt — ISO timestamptz.

### Outbox `kind` lari va qabul qiluvchilar

`notification_outbox.kind`: `alert` | `daily_report` | `alert_reminder` | `request_overdue` | `cash_statement`. Yangi ustun `profile_id uuid null` — faqat `cash_statement` da (xabar egasi).

Qabul qiluvchilar — **yangi RPC** `public.svc_outbox_recipients(p_outbox_id uuid) → table (profile_id uuid, chat_id bigint, role text)` (faqat service_role; tg-dispatch `svc_notification_recipients` o'rniga shuni chaqiradi; eski RPC o'zgarmagan). Faol firma, faol o'chirilmagan profil, `telegram_chat_id is not null`, bitta chat — bir marta:

| kind | Kimga |
|---|---|
| `alert`, `alert_reminder`, `daily_report` | `direktor`, `admin` |
| `alert` + `type = 'otkazma_farqi'` + `details.direction = 'not_received'` | yuqoridagilar **va** o'tkazmaning jo'natuvchi va qabul qiluvchi obyektlaridagi `prorab` a'zolari (`object_members`) |
| `request_overdue` | `taminotchi`, `admin` |
| `cash_statement` | faqat `profile_id` (pul egasi) |

### `alert_reminder` (J) — soatlik cron `private.enqueue_alert_reminders()`

`yangi` holatidagi, `belgi` bo'lmagan, `ozi_qabul_qilgan` bo'lmagan alert `companies.alert_remind_hours` (standart 48) dan eski bo'lsa — bir marta (`alert_id` bo'yicha unique). Alertga `details.reminded_at` yoziladi. `alert_id` — ustunda ham.
```json
{ "alert_id": "uuid", "type": "narx_ogishi", "severity": "ogohlantirish", "status": "yangi",
  "object_name": "Obyekt A | null", "material_name": "Sement | null", "base_unit": "kg | null",
  "details": { "...": "alerts.details (reminded_at bilan)" }, "created_at": "<alert yaratilgan vaqt>",
  "reminded_at": "<timestamptz>", "hours_open": 49 }
```

### `request_overdue` (H) — har kuni 09:00 Toshkent, `private.enqueue_request_overdue(p_date)`

Firma bo'yicha bitta qator (`(company_id, report_date)` unique), faqat muddati o'tgan so'rov bo'lsa. So'rov: `status = 'tasdiqlandi'`, `needed_by < p_date`, o'chirilmagan. `requests` — `needed_by` bo'yicha eng eskisi birinchi, ko'pi bilan 20 ta; `count` — hammasi.
```json
{ "date": "2026-11-06", "company_name": "…", "count": 3,
  "requests": [ { "request_id": "uuid", "object_id": "uuid", "object_name": "…", "material_name": "…",
                  "qty_input": 2.5, "unit_input": "qop", "qty_base": 125, "base_unit": "kg",
                  "needed_by": "2026-11-04", "days_overdue": 2, "created_by_name": "… | null" } ] }
```

### `cash_statement` (I) — har dushanba 09:00 Toshkent, `private.enqueue_cash_statements(p_date)`

Telegram bog'langan (`telegram_chat_id`), faol profil; balansi ≠ 0 yoki oxirgi 7 kunda harakati bor bo'lsa. `(profile_id, report_date)` unique. Davr: `[p_date − 7 kun, p_date)` Toshkent kunlari.
```json
{ "date": "2026-11-09", "period_start": "2026-11-02", "period_end": "2026-11-08",
  "company_name": "…", "profile_id": "uuid", "profile_name": "…",
  "issued_week": "1000000.00", "spent_week": "350000.00", "returned_week": "0.00",
  "issued_total": "5000000.00", "returned_total": "100000.00", "spent_total": "4200000.00",
  "balance": "700000.00", "oldest_open_date": "2026-10-20 | null", "days_open": "20 | null" }
```
`oldest_open_date` — FIFO: berilganlar `issued_at` tartibida, sarf (xaridlar + qaytarishlar) eng eskisidan yopadi; birinchi to'liq yopilmagan berilgan pul sanasi. Balans ≤ 0 → `null`. `days_open` — int.

### `daily_report` — yangi kalitlar

`low_stock_count` (int) — faol obyektlarda `days_left <= companies.forecast_days_warn` bo'lgan (obyekt, material) juftliklari (K formulasi). `geo_denied_count` (int) — oraliqda `geo_status = 'denied'` bo'lgan harakat + xaridlar. `geo_unavailable_count` (int) — xuddi shunday, `geo_status = 'unavailable'`. Qolgan kalitlar o'zgarmagan; yangi alert turlari `alerts_by_type` ga o'z nomi bilan tushadi (`belgi` lar — yo'q).

### Yangi alert turlari — `details`

Alert payload (`kind = 'alert'`) shakli o'zgarmagan (`alert_id, type, severity, object_name, material_name, base_unit, details, created_at`). Darhol yuboriladi — `severity <> 'belgi'` bo'lganlari (✉).

| type | severity | Bog'lanish ustunlari | `details` |
|---|---|---|---|
| `kirim_manbasiz` | belgi | `movement_id`, `object_id`, `material_id`, `purchase_id` (= `candidate_purchase_id`) | `reason`: `'open_purchase'` (ochiq xarid bor edi) \| `'no_source'` (7 kunda xarid/o'tkazma yo'q) \| `'unlinked_candidate'` (xarid ≠ qabul farqini yopgan nomzod); `qty_base` num; `base_unit` text; `occurred_at`; `open_purchase_ids` uuid[] (faqat `open_purchase` da to'la, aks holda `[]`); `candidate_purchase_id` uuid\|null |
| `manfiy_qoldiq` ✉ | ogohlantirish | `object_id`, `material_id`, `movement_id` (oxirgi sabab) | `stock_after` num (manfiy); `qty_base` num (oxirgi harakat); `unit` text (asosiy birlik); `movement_type` `'chiqim'`\|`'transfer_out'`. Obyekt+material bo'yicha bitta ochiq alert — keyingi chiqimda details yangilanadi (qayta yuborilmaydi). Qoldiq ≥ 0 bo'lsa avtomatik yopiladi (`closed_reason = 'stock_restored'`). Shunday yopilgandan keyin 24 soat ichida qoldiq yana manfiy bo'lsa — yangi alert (va xabar) **yo'q**: yopilgan alertning details'i yangilanadi (+ `renegative_at`) |
| `takroriy_yozuv` | belgi (`kind = 'record'`) / ✉ ogohlantirish (`kind = 'photo'`) | `movement_id` yoki `purchase_id` (yangi yozuv) | `kind`: `'record'` \| `'photo'`; `table`: `'movements'`\|`'purchases'`; `record_id`; `first_id` (avvalgi yozuv); record: `window_minutes` int, `qty_base` num, `total_amount` num\|null (faqat xarid), `movement_type` text\|null; photo: `first_table`, `sha256` |
| `joylashuv_farqi` | belgi | `movement_id`, `object_id`, `material_id` | `distance_m` int; `radius_m` int; `accuracy_m` int\|null; `geo_lat`, `geo_lng`, `object_lat`, `object_lng` num; `movement_type` |
| `smetasiz_chiqim` ✉ | ogohlantirish | `object_id`, `movement_id` (oxirgi chiqim) | `first_day`, `last_day`, `day` (= `last_day`) `"YYYY-MM-DD"`; `days` int (chiqimli kunlar soni); `count` int (`first_day` dan beri shu obyektdagi chiqimlar); `materials`: `[{material_id, material_name, qty_base num, base_unit}]` (nom bo'yicha); `last_movement_id`. Obyekt bo'yicha **bitta ochiq** alert, obyektda joriy smeta paydo bo'lguncha (keyingi kunlarda ham shu alert yangilanadi, qayta yuborilmaydi); joriy smeta paydo bo'lsa — avtomatik yopiladi (`closed_reason = 'estimate_added'`) |
| `chek_farqi` ✉ | ogohlantirish | `purchase_id`, `object_id`, `material_id` | `receipt_total` num; `total_amount` num; `diff` num (= total_amount − receipt_total); `receipt_fiscal_sign` text; `receipt_verified` bool. Keshdagi chek ko'p qatorli bo'lsa (`payload.items` > 1) — alert yo'q (ochig'i `multi_line_receipt` bilan yopiladi): bitta xarid = chekning bitta qatori; boshqa qatorlar QR'siz kiritiladi (fiskal belgi firma bo'yicha bitta xaridda) |
| `sorovdan_ortiq_xarid` | belgi | `request_id`, `purchase_id` (oxirgi), `object_id`, `material_id` | `request_qty_base` num; `purchased_qty_base` num (so'rovga bog'langan tirik xaridlar); `over_pct` num (2 xona); `threshold_pct` num; `base_unit`; `purchase_count` int |
| `podotchet_muddati` ✉ | ogohlantirish | — | `profile_id`; `profile_name`; `balance` num; `oldest_open_at` timestamptz; `days_open` int; `max_days` int |
| `podotchet_manfiy` | belgi | — | `profile_id`; `profile_name`; `balance` num (manfiy) |

Avtomatik yopilganda (mavjud qoidalar kabi) details ga `auto_closed: true`, `closed_reason`, `closed_by_actor` qo'shiladi. Masofa: haversine, R = 6 371 000 m, natija butun metrga yaxlitlanadi; alert sharti `distance_m > radius_m + least(coalesce(accuracy_m, 0), radius_m)` (aniqlik radiusdan oshmaydi; manfiy/null → 0).

**Meta kalitlar.** `reminded_at`, `seen_by_profile_id`, `seen_by_name`, `seen_at`, `seen_via` — qoida qayta baholanib details yangilansa ham saqlanadi va "o'zgardimi" solishtirishiga kirmaydi (Batch 12 qoidalari va `xarid_qabul_farqi`).

### Telegram tugmasi "Ko'rildi" — `public.svc_mark_alert_seen(p_telegram_user_id bigint, p_alert_id uuid) → text`

Faqat service_role. Qaytaradi: bosgan odamning `full_name`. Xatolar (`hint`): `alert_not_found` (P0002 — alert yo'q / o'chirilgan), `alert_action_forbidden` (42501 — profil topilmadi / nofaol / firmasi nofaol, rol admin yoki super_admin emas, alert boshqa firmaniki; super_admin — istalgan firma). `yangi` → `korildi`; `korildi` / `yopildi` — o'zgarmaydi (idempotent), ism baribir qaytadi. Birinchi bosishda details ga `seen_by_profile_id`, `seen_by_name`, `seen_at`, `seen_via: 'telegram'` yoziladi.

### Chek keshi — `public.svc_upsert_receipt_lookup(...)`

`receipt_lookups` ga yozish faqat shu service_role RPC orqali (receipt-lookup Edge Function foydalanuvchi JWT'sini tekshirib, firmasini aniqlagandan keyin chaqiradi): `svc_upsert_receipt_lookup(p_company_id uuid, p_created_by uuid, p_fiscal_sign text, p_terminal_id text, p_receipt_no text, p_payload jsonb, p_total numeric, p_seller_tin text, p_seller_name text, p_receipt_at timestamptz) → uuid`. `(company_id, fiscal_sign)` bo'yicha upsert (`fetched_at = now()`). authenticated — faqat o'z firmasi qatorlarini o'qiydi, yozmaydi. `purchases.receipt_verified`, `receipt_total`, `seller_tin` ni foydalanuvchi sessiyasida (har INSERT/UPDATE) server belgilaydi: fiskal belgi yo'q → `receipt_verified = false`, `receipt_total = seller_tin = null`; belgi bor → `receipt_verified` = shu firma keshida shu belgi bormi; kesh bo'lsa `receipt_total` := keshdagi `total` (null bo'lmasa, klient qiymati ustidan), `seller_tin` := keshdagi (bo'lmasa — klientniki). Keshsiz QR (sahifa ochilmagan) — klient `receipt_total` saqlanadi, `receipt_verified = false`. Podotchet qaytarish (`kind = 'qaytarildi'`) nofaol yoki roli o'zgargan odamdan ham qabul qilinadi (rol tekshiruvi faqat `berildi`).
