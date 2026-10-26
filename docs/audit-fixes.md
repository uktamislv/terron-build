# Audit tuzatishlari (baza tomoni)

Migratsiya: `supabase/migrations/20261108000001_audit_fixes.sql` (bitta fayl). Testlar: `supabase/tests/sql/audit_fixes.sql.test.ts` (audit repro'lari S1–S7 — regressiya testlari). Oldingi migratsiyalar o'zgartirilmagan — kerakli funksiyalar `create or replace` bilan qayta yozilgan (mantiq o'zgargan joylar pastda).

Umumiy: yangi enum qiymatlari shu tranzaksiyada SQL'da ishlatilmaydi (faqat plpgsql runtime yoki `type::text`). "Foydalanuvchi sessiyasi" — `auth.uid()` bor; ba'zi guardlar aniqroq `current_user = 'authenticated'` (PostgREST so'rovi) ga qaraydi — security definer RPC ichidagi o'zgarishlar ularga tushmaydi.

## A. Biznes mantiq

| # | Nima o'zgardi |
|---|---|
| A1 | Qoida 1 nomzodlari — `private.receipt_candidates(purchase_id)`: shu obyekt+materialdagi tirik xaridlar `(purchased_at, created_at, id)` tartibida (maqsad xariddan 14 kun oldingidan maqsadgacha); har xaridning qolgan farqi (`qty_base − bog'langan kirimlar`) > 0 bo'lsa, oynadagi (`[purchased_at, +72 soat]`) hali taqsimlanmagan bog'lanmagan kirimlar `occurred_at, id` tartibida butunicha beriladi, farq ≤ 0 bo'lguncha. Har kirim — ko'pi bilan bitta xaridga. `evaluate_purchase_receipt` shu ro'yxatdan foydalanadi va `terron.receipt_alloc:<obyekt>:<material>` qulfini oladi. |
| A2 | `manfiy_qoldiq` — yangi 5 argumentli `private.evaluate_negative_stock(company, object, material, movement, p_decreased)`; movements triggeri har (obyekt, material) juftligi uchun qoldiqqa ta'sirni hisoblaydi (yangi tirik − eski tirik, ishorali) va manfiy bo'lsa "sabab" deb beradi: kirim o'chirildi/kamaytirildi, transfer_in o'chirildi, boshqa obyektga ko'chirildi va h.k. 24 soatlik bostirish (stock_restored) saqlangan. Qoldiqni oshirgan o'zgarish (masalan qo'lda yopilgandan keyingi kirim) yangi alert yaratmaydi. 4 argumentli eski imzo — o'ram (sabab = tirik chiqim/transfer_out). |
| A3 | `inventory_count_items.counted_at` (server, `not null default now()`; INSERT va sanalgan miqdor/material o'zgarishi/tiklashda `now()`; foydalanuvchi yoza olmaydi; authenticated o'qiydi). `submit_inventory_count`: `qty_expected = private.stock_at(..., counted_at)` — `occurred_at <= counted_at` bo'lgan tirik harakatlar. Hisob yaratilgandan keyin kiritilgan, sanalgan materiallardagi harakatlar — alert `details.movements_during_count` / `movements_during_count_total` va natijada `movements_during_count` (son). |
| A4 | `movements.a_rpc_guard`: foydalanuvchi sessiyasida (admin ham) `transfer_out`/`transfer_in` — faqat `transfer_rpc_active()`, `inventory_adjust` — faqat `inventory_rpc_active()`; UPDATE'da faqat `note` o'zgarishi ruxsat. O'tkazma harakatini tiklash — hamma uchun (tizim ham) `55000 restore_transfer_movement`. Tizim (seed, migratsiya) — boshqa cheklovsiz. `movements_insert` siyosati — hamma rol uchun faqat `kirim`/`chiqim`. `apply_inventory_adjustments` endi `terron.inventory_rpc` GUC'ini o'rnatadi. |
| A5 | `receive_transfer`: o'tkazma birligi o'chirilgan bo'lsa `transfer_in` asosiy birlikda (factor 1, `qty_input = qty_base`). |
| A6 | `cash_advances.issued_at` foydalanuvchi sessiyasida o'zgarmaydi (`cash_amount_locked`; izoh — ruxsat). INSERT: admin bo'lmaganlar uchun `[now − 3 kun, now + 5 daqiqa]` (`b_op_date`, `ops_occurred_at_range`). Har `qaytarildi` yozuvi va oynadan tashqari sana (admin kiritgan) — `podotchet_belgisi` (belgi). Tizim INSERT'i — belgisiz. |
| A7 | `evaluate_object_norms` oxirida obyektning ochiq so'rovlari (kutilmoqda/tasdiqlandi) qayta baholanadi (`private.reevaluate_open_requests`); smeta qatori o'chirilsa/tiklansa — shu material so'rovlari; so'rov holati yoki `deleted_at` o'zgarsa — shu obyekt+materialdagi boshqa ochiq so'rovlar. |
| A8 | Qoida 3, 4, 6 (`evaluate_purchase_price`, `evaluate_norm`, `evaluate_request`) — `alert_meta_keys()` / `alert_meta()`: meta kalitlar saqlanadi, solishtirishga kirmaydi. |
| A9 | Kunlik hisobot: `backdated_count`. |
| A10 | `dashboard_summary` va kunlik hisobot: `cash_outstanding_sum` (Σ musbat balans) va `cash_owed_to_staff_sum` (Σ manfiy balans, musbat son), matn. `cash_on_hand_total` (sof) moslik uchun qoldi. Haftalik shaxsiy `cash_statement` o'zgarmagan (bitta odam — balans ishorasi o'zi aniq). |
| A11 | `private.alert_counts_as_new(type, severity)` (belgi emas; `ozi_qabul_qilgan`, `yozuv_ochirildi`, `yozuv_tiklandi` emas) va `private.alerts_new_count(company, from, to, object)` (security invoker). Dashboard `alerts_new_in_period` va kunlik `alerts_new` / `alerts_by_type` shu ta'rifda. |
| A13 | `b_check_qty` (purchases, movements, transfers, material_requests; `b_compute_qty` dan oldin): `qty_too_small`, `qty_too_large`, `price_too_large`. |
| A14 | `a_rpc_guard` chiqim/transfer_out INSERT va qoldiqqa ta'sir qiluvchi UPDATE'da `terron.stock:<obyekt>:<material>` qulfi (kalitlar tartibida; `create_transfer` bilan bir xil kalit). `set_current_estimate` obyekt qulfidan keyin maqsadni `for update` bilan qayta o'qiydi. |

## B. Xavfsizlik

- **B1.** `zz_posted_change` (movements, purchases; AFTER UPDATE): foydalanuvchi sessiyasida tirik yozuvning kuzatiladigan ustuni o'zgarsa — `yozuv_ozgartirildi` (ogohlantirish → Telegram). Kuzatiladi: movements — `type, object_id, material_id, unit_id, qty_input, qty_base, occurred_at, purchase_id`; purchases — `object_id, material_id, unit_id, qty_input, qty_base, total_amount, unit_price, price_per_base, purchased_at, buyer_id`. Muallifning `correct_entry` orqali tuzatishi — `yozuv_tuzatildi` (belgi). Tizim, o'tkazma/inventarizatsiya RPC ichidagi o'zgarishlar, soft delete va tiklash — bu alertsiz (o'chirish/tiklash alertlari avvalgidek).
- **B2.** `zz_settings_alert` (companies): foydalanuvchi sozlama ustunini o'zgartirsa — `sozlama_ozgardi` (ogohlantirish; `id, name, is_active, created_by, created_at, updated_at, deleted_at` kuzatilmaydi). Chegaralar: `price_deviation_pct ≤ 50`, `receipt_mismatch_pct ≤ 50`, `request_overbuy_pct 0..200`, `duplicate_window_minutes 1..1440` (0 — endi yo'q; mavjud 0 lar 10 ga o'zgartirildi), `alert_remind_hours 1..168` (mavjud qiymatlar migratsiyada chegaraga keltirildi). Foydalanuvchi alertni yopsa `close_note` majburiy (`alert_close_note_required`), details'ga `manual_closed_at`, `manual_closed_by`; kunlik hisobotda `manual_closed_count`. Admin (super_admin emas) admin/direktor profilining `role, phone, is_active, deleted_at` ini o'zgartira olmaydi — `profile_protected` (o'zinikini ham).
- **B3.** `public.svc_alert_login_set(p_target_profile uuid, p_actor uuid) → uuid` (service_role): `login_ozgardi` alerti + egasiga `login_changed` xabari.
- **B5.** Klient yuborgan `photo_sha256` / `receipt_photo_sha256` e'tiborsiz (INSERT — null, UPDATE — eski qiymat, rasm o'zgarsa — null). Xeshni faqat `public.svc_set_photo_hash(p_table text, p_id uuid, p_sha256 text) → boolean` (service_role; oq ro'yxat: `movements`, `purchases`) yozadi — takroriy rasm qoidasi shu UPDATE'da ishlaydi.
- **B6.** `receipt_verified` = keshda chek bor VA (`|kesh.total − total_amount| ≤ 1` YOKI chekda aynan bitta qator YOKI biror `items[].sum` `total_amount` dan ≤ 1 so'm farq) VA `kesh.receipt_at` `purchased_at` dan ±3 kun ichida (`receipt_at` null — tasdiqlanmaydi). Ko'p qatorli chek rasm talabini bekor qilmaydi. Chekdagi `seller_tin` tanlangan sotuvchining `tin` idan farq qilsa — `sotuvchi_stir_farqi` (belgi).
- **B11.** `private.estimate_alert` — foydalanuvchi sessiyasida boshqa firma smetasi → `estimate_direct_edit`; `current_deleted` — faqat trigger ichidan va smeta o'chirilgan bo'lsa (import RPC invoker bo'lgani uchun grant qoldi).
- **B13.** `transfers_select`, `material_requests_select`, `estimates_select` — `is_company_wide_ops()` (tekshiruvchisiz); `estimate_items` — `estimates` orqali.
- **B14.** `receive_transfer`: qabul > yuborilgan — faqat admin/super_admin va izoh bilan, aks holda `transfer_over_receipt`.
- **Profillar.** `profiles_select`: admin/super_admin — firma profillari to'liq; boshqa rollar — faqat o'zi. Boshqalarning `id, company_id, full_name, role, is_active` — view `public.profile_directory` (definer view, o'z firmasi; super_admin — hammasi; o'chirilganlar ham — tarixdagi ismlar). `open_purchases`, `spend_breakdown`, `audit_record_label`, `audit_feed`, `deleted_records` ismlarni shu view'dan oladi. **Frontend:** admin bo'lmagan rollar uchun `profiles(full_name)` embed va `listProfiles()` endi faqat o'zini qaytaradi — ismlar `profile_directory` dan olinishi kerak (admin uchun `PROFILE_COLUMNS` o'zgarishsiz ishlaydi).

## C. Ekspluatatsiya

- `companies.quiet_hours_start`, `quiet_hours_end` (`time`, standart 22:00 / 07:00; biri null — o'chiq). `svc_claim_notifications`: `alert`, `alert_reminder` (payload `severity <> 'jiddiy'`) firma tinch oynasida bo'lsa — `next_attempt_at := oyna oxiri` (Toshkent), olinmaydi. `private.quiet_until(start, end, now)`.
- `profiles.telegram_blocked_at` (admin ko'radi; `telegram_chat_id` o'zgarsa — null). `public.svc_mark_chat_blocked(p_chat_id bigint, p_blocked boolean) → integer` (service_role). `svc_complete_notification(..., p_blocked_chat_ids bigint[] default null)` — oxirgi ixtiyoriy argument (eski 6 argumentli chaqiruv ishlaydi). `p_retry_after_sec` — urinish qaytariladi (claim'dagi +1 olinadi). Qabul qiluvchilardan bloklangan chatlar chiqariladi (`svc_outbox_recipients`, `svc_notification_recipients`).
- Claim: `daily_report`, `request_overdue`, `alert_reminder`, `cash_statement` qatorlari 36 soatdan eski bo'lsa — `failed`, `last_error = 'expired'`.
- Cron `terron-cron-purge` (har kuni 03:30 UTC): `cron.job_run_details` dan 7 kundan eskilar o'chiriladi.
- `wake_dispatch`: pg_net `timeout_milliseconds = 60000`.
- Kunlik hisobot: `stuck_pending_count`, `failed_7d_count`. `public.notification_health() → jsonb` (admin/super_admin, o'z firmasi): `last_sent_at`, `stuck_pending_count`, `failed_7d_count`, `last_errors` (oxirgi 5: `id, kind, status, last_error, attempts, updated_at`), `blocked_profiles` (`profile_id, full_name, role, telegram_blocked_at`).
- Indekslar: `material_requests (company_id, created_at desc)`, `transfers (company_id, created_at desc)`, `inventory_counts (company_id, created_at desc)`, `notification_outbox (company_id, ref_id)`, `profiles (telegram_chat_id)`.

## D. Funksional qo'shimchalar

- **D1.** `public.correct_entry(p_table text, p_id uuid, p_qty_input numeric, p_unit_id uuid, p_total_amount numeric, p_note text) → void`: muallif (`created_by`) 30 daqiqa ichida, admin — istalgan vaqtda. Faqat bog'lanmagan: harakat — `kirim`/`chiqim`, `purchase_id`/`transfer_id`/`inventory_count_id` yo'q; xarid — bog'langan tirik kirimi yo'q. `null` — o'zgarmaydi; `p_note = ''` — izohni tozalaydi; `p_total_amount` — faqat xaridda. Oddiy UPDATE (barcha guard, qoida va audit — UPDATE). Muallif tuzatishi — `yozuv_tuzatildi` (belgi), admin — `yozuv_ozgartirildi`.
- **D2.** Ish oqimi xabarlari (outbox, pastda). `profiles.notify_workflow boolean default true` — profil o'zi o'zgartiradi (`profiles_update_self` siyosati + ustun grant; boshqa ustun o'zgarsa yoki qiymat o'zgarmasa — 0 qator).
- **D3.** `alerts_select_site`: prorab/omborchi a'zo obyektlarning `normadan_oshish`, `manfiy_qoldiq`, `otkazma_farqi`, `smetadan_ortiq_sorov`, `smetasiz_chiqim` alertlarini ko'radi (faqat o'qish). Dashboard'da ular uchun `alerts_new_in_period`, `dashboard_daily.alerts_count` shularni sanaydi.
- **D4.** `public.merge_suppliers(p_keep uuid, p_merge uuid) → integer` (admin/super_admin): `p_merge` ning tirik xaridlari `p_keep` ga, `p_merge` soft delete, `p_keep` dagi bo'sh `tin/phone/note` — `p_merge` dan. Admin sotuvchining `name, phone, tin, note` ini avvaldan o'zgartira oladi (jadval grant + `suppliers_update`).
- **D5.** `cancel_transfer` yuboruvchiga (`created_by`, hali `from` obyekt a'zosi) `yuborildi` holatida ruxsat beradi — o'zgarish kerak bo'lmadi (test bilan tasdiqlandi).
- **D6.** Tekshiruvchi o'z inventarizatsiyalarini holati bilan ko'radi (`inventory_counts_select`, `is_company_wide`) — o'zgarish kerak bo'lmadi.

## Yangi alert turlari

| type | severity | Bog'lanish | `details` |
|---|---|---|---|
| `yozuv_ozgartirildi` ✉ | ogohlantirish | `movement_id` yoki `purchase_id`, `object_id`, `material_id` | `table`, `record_id`, `changed` (ustunlar, alifbo), `before`, `after` (o'zgargan ustunlar + `unit_input`), `via` (`direct` \| `correct_entry`), `actor_profile_id`, `actor_name`, `author_id`, `author_name`, `material_name`, `base_unit`, `movement_type` (faqat harakat) |
| `yozuv_tuzatildi` | belgi | xuddi shunday | xuddi shunday, `via = 'correct_entry'` |
| `sozlama_ozgardi` ✉ | ogohlantirish | — | `changes: [{key, before, after}]` (kalit bo'yicha), `actor_profile_id`, `actor_name` |
| `login_ozgardi` ✉ | ogohlantirish | — | `target_profile_id`, `target_name`, `target_role`, `actor_profile_id`, `actor_name`, `actor_role` (aktyor boshqa firmaniki — null), `changed_at` |
| `podotchet_belgisi` | belgi | — | `table: 'cash_advances'`, `record_id`, `reasons` (`qaytarildi` \| `issued_at_outside_window`), `cash_kind`, `amount`, `issued_at`, `recipient_id`, `recipient_name`, `actor_profile_id`, `actor_name` |
| `sotuvchi_stir_farqi` | belgi | `purchase_id`, `object_id`, `material_id` | `seller_tin`, `supplier_id`, `supplier_name`, `supplier_tin`, `receipt_fiscal_sign`; shart yo'qolsa `not_applicable` / `purchase_deleted` bilan yopiladi |

O'zgargan `details`: `manfiy_qoldiq` — `movement_type` istalgan tur bo'lishi mumkin, yangi `movement_deleted` (bool). `inventarizatsiya_kamomadi` — `movements_during_count: [{material_id, material_name, count}]`, `movements_during_count_total`. Qo'lda yopilgan har alert — `manual_closed_at`, `manual_closed_by`.

## Yangi hint'lar

| hint | errcode | Qayerda |
|---|---|---|
| `movement_rpc_only` | 42501 | `a_rpc_guard` — o'tkazma / inventarizatsiya harakati RPC'siz |
| `restore_transfer_movement` | 55000 | `a_rpc_guard` (mavjud kalit, endi trigger ham beradi) |
| `qty_too_small` | 23514 | `b_check_qty` — asosiy birlikda 0 |
| `qty_too_large` | 22003 | `b_check_qty` — `|qty_base| ≥ 1e14` |
| `price_too_large` | 22003 | `b_check_qty` (purchases) — birlik/asosiy narx sig'maydi |
| `transfer_over_receipt` | 22023 | `receive_transfer` — ko'p qabul (admin emas yoki izohsiz) |
| `alert_close_note_required` | 23514 | `b_alerts_close_note` |
| `profile_protected` | 42501 | `b_profiles_protect` |
| `login_target_not_found` | P0002 | `svc_alert_login_set` |
| `photo_hash_invalid` | 22023 | `svc_set_photo_hash` — jadval / id |
| `correct_invalid` | 22023 | `correct_entry` |
| `correct_not_found` | P0002 | `correct_entry` |
| `correct_forbidden` | 42501 | `correct_entry` — muallif emas / rol yoki obyekt huquqi yo'q |
| `correct_window_passed` | 55000 | `correct_entry` — 30 daqiqa o'tgan |
| `correct_linked` | 55000 | `correct_entry` — bog'langan yozuv |
| `supplier_merge_forbidden` | 42501 | `merge_suppliers` |
| `supplier_merge_invalid` | 22023 | `merge_suppliers` |
| `supplier_not_found` | P0002 | `merge_suppliers` |
| `notification_health_forbidden` | 42501 | `notification_health` |

Qayta ishlatiladi: `auth_required`, `cash_amount_locked` (endi `issued_at` ham), `ops_occurred_at_range` (`cash_advances` INSERT), `photo_sha256_invalid` (`svc_set_photo_hash`), `estimate_direct_edit` (`estimate_alert`), `estimate_not_found` (`set_current_estimate` qulfdan keyin).

## Bildirishnoma payloadlari

`notification_outbox.kind` ga qo'shildi: `request_created`, `request_decided`, `request_approved`, `transfer_sent`, `purchase_for_object`, `login_changed`. Yangi ustun `ref_id uuid` — manba yozuv (so'rov / o'tkazma / xarid / `login_ozgardi` alerti). `profile_id` — `request_decided` (so'rov muallifi) va `login_changed` (login egasi) da. `request_created`, `request_approved`, `transfer_sent`, `purchase_for_object` — manba bo'yicha bir marta (unique `(kind, ref_id)`); `request_decided`, `login_changed` — har hodisada. Hamma kalitlar har doim bor (qiymati `null` bo'lishi mumkin); miqdor — JSON son; sana — `"YYYY-MM-DD"`, vaqt — ISO timestamptz. `tg-dispatch` bu turlar uchun shablon talab qiladi (aks holda qator "noma'lum kind" bilan `failed`).

Qabul qiluvchilar — `svc_outbox_recipients(p_outbox_id)` (create or replace). Hamma turlarda: faol firma va profil, `telegram_chat_id` bor, `telegram_blocked_at is null`; ish oqimi turlarida (`request_*`, `transfer_sent`, `purchase_for_object`) qo'shimcha `notify_workflow = true`.

| kind | Kimga | Qachon |
|---|---|---|
| `request_created` | firma `admin` lari | so'rov INSERT (`kutilmoqda`, tirik) |
| `request_decided` | so'rov muallifi (`profile_id`) | holat `tasdiqlandi` yoki `rad` ga o'tganda |
| `request_approved` | firma `taminotchi` lari | holat `tasdiqlandi` ga o'tganda |
| `transfer_sent` | qabul qiluvchi obyektning `prorab` / `omborchi` a'zolari | o'tkazma yaratilganda |
| `purchase_for_object` | obyektning `omborchi` / `prorab` a'zolari, xaridordan tashqari ("X sotib oldi, yo'lda") | xarid INSERT (tirik) |
| `login_changed` | login egasi (`profile_id`) | `svc_alert_login_set` |

### `request_created`, `request_decided`, `request_approved`

```json
{ "request_id": "uuid", "company_name": "…", "status": "kutilmoqda | tasdiqlandi | rad",
  "object_id": "uuid", "object_name": "…", "material_id": "uuid", "material_name": "…",
  "qty_input": 5, "unit_input": "qop", "qty_base": 250, "base_unit": "kg",
  "needed_by": "2026-11-10 | null", "note": "… | null", "decision_note": "… | null",
  "created_by_name": "… | null", "decided_by_name": "… | null",
  "created_at": "<timestamptz>", "decided_at": "<timestamptz> | null" }
```

### `transfer_sent`

```json
{ "transfer_id": "uuid", "company_name": "…",
  "from_object_id": "uuid", "from_object_name": "…", "to_object_id": "uuid", "to_object_name": "…",
  "material_id": "uuid", "material_name": "…", "qty_input": 3, "unit_input": "qop",
  "qty_base": 150, "base_unit": "kg", "note": "… | null", "sent_by_name": "… | null",
  "created_at": "<timestamptz>" }
```

### `purchase_for_object`

```json
{ "purchase_id": "uuid", "company_name": "…", "object_id": "uuid", "object_name": "…",
  "material_id": "uuid", "material_name": "…", "qty_input": 10, "unit_input": "qop",
  "qty_base": 500, "base_unit": "kg", "buyer_id": "uuid", "buyer_name": "… | null",
  "supplier_name": "… | null", "purchased_at": "<timestamptz>" }
```

### `login_changed`

```json
{ "alert_id": "uuid", "profile_id": "uuid", "profile_name": "…", "company_name": "…",
  "actor_name": "… | null", "changed_at": "<timestamptz>" }
```

### `daily_report` — yangi kalitlar

`backdated_count` (int) — oraliqda yaratilgan (`created_at`), sanasi (`occurred_at` / `purchased_at`) oraliq boshidan oldin bo'lgan tirik harakat + xaridlar. `manual_closed_count` (int) — oraliqda foydalanuvchi yopgan alertlar (`closed_at`, `details.manual_closed_at`). `stuck_pending_count` (int) — joriy: `pending` va `next_attempt_at` 15 daqiqadan oldin o'tgan yoki `sending` va 10 daqiqadan ko'p yangilanmagan. `failed_7d_count` (int) — oxirgi 7 kunda `failed`. `cash_outstanding_sum`, `cash_owed_to_staff_sum` (matn, `"1250000.00"`). `alerts_new` / `alerts_by_type` — A11 ta'rifi (o'zgarmagan natija, endi bitta yordamchidan).

### Alert payload

`kind = 'alert'` shakli o'zgarmagan. Yangi turlardan darhol yuboriladiganlari (✉): `yozuv_ozgartirildi`, `sozlama_ozgardi`, `login_ozgardi` — qabul qiluvchilar `direktor`, `admin`.

## Qilinmaganlar va cheklovlar

- `profiles` ustunlarini ustun-grant bilan yopish o'rniga RLS + `profile_directory` tanlandi: ustun grant admin'ning `PROFILE_COLUMNS` so'rovini ham buzardi (bitta `authenticated` roli). Natija — admin bo'lmaganlar uchun boshqa xodimlar ismi PostgREST embed (`profiles!…(full_name)`) va `listProfiles()` orqali endi kelmaydi; frontend `profile_directory` ga o'tishi kerak.
- `cash_statement` (haftalik shaxsiy) payloadi o'zgarmadi — bitta odamning balansi; musbat/manfiy yig'indilar dashboard va kunlik hisobotda.
- A1 taqsimlash maqsad xariddan 14 kun oldingi xaridlarni hisobga oladi (uzunroq zanjirlar amalda yo'q, baholash tez qoladi).
- `inventory_adjust` va o'tkazma harakatlarini admin ham to'g'ridan-to'g'ri o'chira olmaydi (`movement_rpc_only`) — xato tuzatish: o'tkazma — `cancel_transfer`, inventarizatsiya — qayta sanash.
- `tg-dispatch` shablonlari, `admin-users` va rasm yuklash Edge Function'lari (xeshni `svc_set_photo_hash` bilan yozish) — baza tashqarisida.

---

# 2-tur

Migratsiya: `supabase/migrations/20261109000001_audit2_fixes.sql`. Testlar: `supabase/tests/sql/audit2_fixes.sql.test.ts` (audit repro'lari F1–F6, C1 — regressiya testlari). Oldingi testlarda kutilgan natijasi ataylab o'zgargan joylar yangilangan (`audit_fixes`, `automation_batch12`, `batch1_hardening`, `purchases_batch5`, `reports_batch9`, `requests_batch8` — har birida `audit2` izohi bilan).

## Xavfsizlik

| # | Nima o'zgardi |
|---|---|
| S1 | Rasm xeshi klientga bog'liq emas. `movements.photo_path` / `purchases.receipt_photo_path` qo'yilsa va xesh yo'q bo'lsa (INSERT, yo'l o'zgarishi, xesh tozalanishi, tiklash) — AFTER trigger `zz_photo_hash_ins/upd` `private.photo_hash_queue` ga ish qo'yadi (yozuv+yo'l bo'yicha bitta ochiq) va `photo-hash` ni pg_net bilan uyg'otadi (tranzaksiyada bir marta). Zaxira — cron `terron-photo-hash-sweep` (`*/5 * * * *`, `private.photo_hash_sweep()`). `svc_set_photo_hash` ga `p_expected_path text default null`. |
| S2 | Admin boshqa odam nomidan xarid kiritsa (`buyer_id ≠ created_by`, INSERT yoki `buyer_id` o'zgarishi): xaridor shu firmaning faol, o'chirilmagan `haydovchi` / `taminotchi` / `prorab` / `admin` profili bo'lishi shart (`purchase_buyer_invalid`); `xarid_boshqa_nomidan` alerti (ogohlantirish ✉) + xaridorga `purchase_on_your_name`. Boshqa rollar uchun RLS avvalgidek rad etadi (42501); boshqa firma profili — kompozit FK (23503). |
| S3 / L1 | `receipt_verified`: "chekda aynan bitta qator" sharti olib tashlandi — endi `|kesh.total − total_amount| ≤ 1` YOKI biror `items[].sum` ≤ 1 so'm farq (bitta qatorli chekda bu `items[0].sum`). Rasm talabidan ozod: tasdiqlangan VA bir qatorli VA `receipt_total` null emas. |
| S4 | Tinch oyna ≤ 12 soat (`companies_quiet_hours_window_check`, `private.quiet_window_minutes`); mavjud uzun oynalar `end = start + 12 soat` ga keltirildi. `sozlama_ozgardi`, `login_ozgardi`, `yozuv_ozgartirildi`, `xarid_boshqa_nomidan` alertlari (va ularning eslatmalari) hech qachon ushlanmaydi. |
| S5 | `yozuv_ozgartirildi` kuzatadigan ustunlar: harakat — + `photo_path`, `geo_lat`, `geo_lng`, `geo_accuracy_m`, `geo_status`; xarid — + `receipt_photo_path`, `receipt_fiscal_sign`, `supplier_id`, `seller_tin`, `request_id`, geo, `payment_source`. `merge_suppliers` ichida — alertsiz; o'rniga bitta `sotuvchi_birlashtirildi` (belgi). `suppliers.merged_into`. O'chirilgan xaridlar ham ko'chiriladi. |
| S6 | Ko'r-ko'rona sanash: `inventory_counts_select` — tekshiruvchi faqat o'zi yaratgan hisoblar (qatorlar ota-yozuv orqali). `submit_inventory_count` tekshiruvchiga `{ok: true}` qaytaradi (admin — avvalgi `{has_shortage, not_counted_count, movements_during_count}`). `inventory_candidate_materials` tekshiruvchiga — firmaning faol katalogi (qoldiq filtrisiz). Tekshiruvchi qoldiq, harakat, xarid va pulni ko'rmaydi: `movements_select` / `purchases_select` Batch 8 dan beri `is_company_wide_ops()` (tekshiruvchisiz); qo'shimcha himoya — `private.is_blind_counter()`: `movements_select_own_deleted`, `purchases_select_own_deleted`, `cash_advances_select`, `receipt_lookups_select` siyosatlari, `stock_balances` va `cash_balances` view'lari (to'g'ridan-to'g'ri o'qishda bo'sh; definer RPC'lar ichida — to'liq), `stock_forecast` → `42501 stock_forbidden`, `my_material_usage` → bo'sh, `dashboard_summary` → hamma raqamlar 0 (`private.dashboard_blind_summary()`). `private.low_stock_count` — foydalanuvchiga execute yo'q (faqat kunlik hisobot). |
| S7 | Admin (super_admin emas): hech kimga `admin` / `direktor` rolini bera olmaydi; admin/direktor profilining `full_name` ini ham o'zgartira olmaydi; admin/direktor profilini yarata olmaydi (`b_profiles_protect_ins`) — `profile_protected`. `svc_alert_login_set(p_target_profile, p_actor, p_first_login boolean default false)`. |
| S8 | `check_purchase_price` — profil bo'yicha 10 daqiqada 30 chaqiruv (sirpanuvchi oyna, `private.rate_limits`); oshsa `54000 rate_limited`. Funksiya endi `volatile`. |
| S9 | `close_note`: foydalanuvchi sessiyasida `status = 'yopildi'` bo'lsa izoh bo'sh bo'lolmaydi (`alert_close_note_required`), yopilgan alertning izohi o'zgarmaydi (`alert_close_note_locked`) — tizim yopganlari ham. |
| S12 | `profile_directory`: + `deleted_at`, `is_available` (= `is_active and deleted_at is null`). **Frontend:** tanlash ro'yxatlari (xaridor, oluvchi, a'zo) faqat `is_available = true`. |
| S13 | `dashboard_summary`: + `telegram_blocked_count` (firma bo'yicha bloklangan tirik profillar; admin/direktor/super_admin, boshqalarga `null`), `telegram_me_blocked` (chaqiruvchining o'zi). `public.reset_chat_blocked(p_profile_id uuid) → boolean` (admin). |
| S14 | `alerts_select_site`: omborchi — `normadan_oshish`, `manfiy_qoldiq`, `otkazma_farqi`, `smetasiz_chiqim`; prorab — + `smetadan_ortiq_sorov`. |

## Ekspluatatsiya

- `public.svc_touch_chat(p_chat_id bigint) → integer` — shu chat profillarining `telegram_blocked_at` i tozalanadi (tg-bot / tg-auth har kiruvchi faollikda chaqiradi).
- Indeks `notification_outbox_company_status_idx (company_id, status, updated_at)`. `notification_outbox_ref_idx` olib tashlandi — hech bir so'rov `(company_id, ref_id)` bo'yicha qidirmaydi (`(kind, ref_id)` unique indekslari bor).

## Mahsulot

- **Haydovchi:** `material_requests_select` — a'zo obyektlarining `tasdiqlandi` holatidagi tirik so'rovlari (faqat o'qish). `request_approved` — taminotchilar + obyektning haydovchi a'zolari.
- **Yangi ish oqimi turlari:** `transfer_cancelled`, `transfer_received`, `purchase_deleted`, `inventory_applied` (pastda). Ish oqimi turlari tinch oynada ushlanadi (oyna oxirigacha); `login_changed` va `purchase_on_your_name` — hech qachon.
- **correct_entry:** xaridga bog'langan kirimni tuzatish mumkin (keyin shu xarid uchun qoida 1 va FIFO zanjiri); material / obyekt almashtirish — faqat muallif, 30 daqiqa ichida, material o'zgarsa birlik majburiy va yangi materialniki; bog'langan kirimda material/obyekt — `correct_linked`. `p_reason` — alohida (`details.reason`). `public.cancel_own_entry(p_table, p_id, p_reason)` — muallif 30 daqiqa ichida bekor qiladi (soft delete), `yozuv_tuzatildi` (belgi, `via = 'cancel_own_entry'`), `yozuv_ochirildi` emas.
- **Sana oynasi:** `ops_occurred_at_range` xatosining `detail` i — ruxsat etilgan eng erta vaqt, UTC ISO (`"2026-10-23T09:15:00Z"`); xabarda Toshkent `dd.mm.yyyy HH:MI`. Buxgalter podotchet sanasi uchun ham shu (3 kun).
- **Tekshiruvchi natijasi:** inventarizatsiya qoldiqqa qo'llansa — muallifga `inventory_applied` (miqdorlarsiz).

## Mantiq (L1–L13)

| # | Nima o'zgardi |
|---|---|
| L1 | S3 bilan bir xil (F5 regressiyasi). |
| L2 | `private.reevaluate_receipt_chain(company, object, material, from)` — `receipt_alloc` qulfi ostida obyekt+materialning tirik xaridlarini (`purchased_at ∈ [from − 14 kun, now]`) qayta baholaydi: xarid INSERT, tiklash, soft delete, `purchased_at` / `qty_base` / obyekt / material o'zgarishi, kirim o'zgarishi (`occurred_at − 72 soat` dan). Zanjir mavjud alertlarni yangilaydi/yopadi va nomzodlarni belgilaydi; **yangi** `xarid_qabul_farqi` ni yaratmaydi (`terron.receipt_chain`) — uni hourly cron yaratadi (o'tkinchi "jiddiy" xabarlar bo'lmasin). Orqa sanali xarid (`created_at − purchased_at > 24 soat`) FIFO ustuvorligisiz: oddiylaridan keyin, o'zaro `created_at` bo'yicha. |
| L3 | `manfiy_qoldiq`: `stock_restored` bilan yopilganidan 24 soat ichida yana manfiy — o'sha alert qayta ochiladi (`status = 'yangi'`, `details.reopened_at`, `reopen_count`, yopilish kalitlari olib tashlanadi); yangi Telegram xabari yo'q. |
| L4 | `receipt_candidates` — qisman taqsimlash: kirim xaridning qolgan farqi qadar beriladi, qoldig'i keyingi xaridga (bitta 200 lik kirim — ikki 100 lik xarid). |
| L5 | `merge_suppliers` tartibi: (1) birlashtiriladigan sotuvchi soft delete + `merged_into`; (2) bo'sh `tin/phone/note` to'ldiriladi; (3) xaridlar ko'chiriladi. Birlashtirish rejimida tarixiy xaridning `receipt_verified`, `receipt_total`, `seller_tin` o'zgarmaydi. `suppliers.tin` o'zgarsa — shu sotuvchi xaridlari bo'yicha `sotuvchi_stir_farqi` qayta baholanadi (`zz_tin_reeval`). |
| L6 | `purchases.payment_source text not null check in ('podotchet','firma')`. Qoida: xaridorga hech qachon tirik `berildi` podotchet berilmagan bo'lsa — `firma`, aks holda `podotchet`. Admin / super_admin / buxgalter qiymatni o'zi tanlaydi (null → qoida); boshqa rollar — INSERT'da qoida (klient qiymati e'tiborsiz), UPDATE'da o'zgarmaydi. Tizim INSERT'i (auth.uid yo'q), qiymatsiz — `podotchet`. Mavjud xaridlar migratsiyada qoida bo'yicha to'ldirildi. `cash_balances`, `private.cash_position` (podotchet muddati, haftalik hisobot), kunlik hisobot va dashboard pul yig'indilari — faqat `podotchet`. |
| L7 | `tg_movements_norm` (chiqim): qoida 4 dan keyin shu obyekt+materialning ochiq so'rovlari (qoida 6) qayta baholanadi. |
| L8 | `reevaluate_open_requests` (smeta RPC'lari, smeta qatorlari, so'rov holati, L7) dayjest rejimida: yaratilgan `smetadan_ortiq_sorov` alertlari darhol yuborilmaydi; commit oldidan (deferred `zz_alert_digest`) firma bo'yicha — ochiq bitta bo'lsa oddiy `alert` xabari, ikki va undan ko'p — bitta `alerts_digest`. |
| L9 | `correct_entry(..., p_note, p_reason, ...)`: `p_note` — yangi izoh (null — o'zgarmaydi, `''` — tozalaydi), `p_reason` — faqat alert `details.reason`. |
| L10 | Tuzatishdan keyin `private.reevaluate_duplicate`: yozuv qatnashgan ochiq `takroriy_yozuv` (record) mos kelmay qolsa — yopiladi (`not_applicable`); yozuv endi takroriy bo'lsa — yaratiladi (avtomatik yopilgani qayta ochiladi); oynadagi keyingi yozuvlar ham tekshiriladi. Harakat va xarid uchun. |
| L11 | Qulf tartibi: `terron.receipt_alloc:<obyekt>:<material>` → `terron.alert:kirim_manbasiz:<kirim>`. `evaluate_kirim_source` avval `receipt_alloc` ni oladi; `evaluate_purchase_receipt` xarid qatorini (`for no key update`) qulflamaydi — avval `receipt_alloc`. Kirim triggeri juftliklarni kalit tartibida qulflaydi. |
| L12 | `purchase_for_object` — faqat foydalanuvchi kiritgan (`auth.uid()` bor) va `purchased_at > now − 24 soat` xarid uchun. |
| L13 | S4 / ish oqimi bilan bir xil. |

## Yangi alert turlari

| type | severity | Bog'lanish | `details` |
|---|---|---|---|
| `xarid_boshqa_nomidan` ✉ | ogohlantirish | `purchase_id`, `object_id`, `material_id` | `purchase_id`, `buyer_id`, `buyer_name`, `actor_profile_id`, `actor_name`, `amount`, `object_id`, `object_name`, `material_id`, `material_name`, `qty_base`, `base_unit`, `purchased_at`, `payment_source`, `via` (`insert` \| `update`) |
| `sotuvchi_birlashtirildi` | belgi | — | `keep_supplier_id`, `keep_name`, `merged_supplier_id`, `merged_name`, `moved_count` (tirik), `moved_deleted_count`, `moved_purchase_ids` (hammasi), `filled` (`tin` \| `phone` \| `note`), `actor_profile_id`, `actor_name` |

O'zgargan `details`: `login_ozgardi` — + `first_login` (bool). `yozuv_tuzatildi` / `yozuv_ozgartirildi` — + `reason` (null bo'lishi mumkin); `cancel_own_entry` dan — `via = 'cancel_own_entry'`, `changed = ['deleted_at']`, `reason`, `author_id`, `material_name`, `base_unit`, `qty_base`, `amount`, `movement_type`, `purchase_id`. `manfiy_qoldiq` — `reopened_at`, `reopen_count`.

## Yangi hint'lar

| hint | errcode | Qayerda |
|---|---|---|
| `purchase_buyer_invalid` | 23514 | `b_buyer_guard` — xaridor nofaol / o'chirilgan / ruxsat etilmagan rol |
| `rate_limited` | 54000 | `check_purchase_price` (10 daqiqada > 30) |
| `alert_close_note_locked` | 55000 | `b_alerts_close_note` — yopilgan alert izohi |
| `chat_reset_forbidden` | 42501 | `reset_chat_blocked` — admin emas |
| `profile_not_found` | P0002 | `reset_chat_blocked` |
| `stock_forbidden` | 42501 | `stock_forecast` — tekshiruvchi |

Qayta ishlatiladi: `profile_protected` (INSERT, rol berish, ism), `correct_invalid` / `correct_forbidden` / `correct_window_passed` / `correct_linked` / `correct_not_found` (`cancel_own_entry` ham), `ops_occurred_at_range` (endi `detail` bilan), `photo_hash_invalid`, `photo_sha256_invalid`, `alert_close_note_required` (yopilgan holatda bo'sh izoh).

## RPC imzolari (yangi va o'zgargan)

```sql
-- authenticated
public.correct_entry(p_table text, p_id uuid, p_qty_input numeric default null, p_unit_id uuid default null,
                     p_total_amount numeric default null, p_note text default null, p_reason text default null,
                     p_material_id uuid default null, p_object_id uuid default null) returns void
public.cancel_own_entry(p_table text, p_id uuid, p_reason text) returns void
public.reset_chat_blocked(p_profile_id uuid) returns boolean
public.check_purchase_price(p_material_id uuid, p_price_per_base numeric) returns text   -- endi volatile, rate_limited
-- service_role
public.svc_set_photo_hash(p_table text, p_id uuid, p_sha256 text, p_expected_path text default null) returns boolean
public.svc_claim_photo_hash_jobs(p_limit integer default 20)
  returns table (job_id uuid, company_id uuid, table_name text, record_id uuid, photo_path text, attempts integer)
public.svc_complete_photo_hash_job(p_job_id uuid, p_sha256 text default null, p_error text default null,
                                   p_final boolean default false) returns text   -- done | stale | pending | failed | null
public.svc_alert_login_set(p_target_profile uuid, p_actor uuid, p_first_login boolean default false) returns uuid
public.svc_touch_chat(p_chat_id bigint) returns integer
public.svc_photo_hash_secret() returns text   -- Vault photo_hash_secret (svc_dispatch_secret kabi)
```

`correct_entry` ning eski 6 argumentli pozitsion chaqiruvi (`p_note` — 6-o'rinda) o'zgarishsiz ishlaydi. **UI:** sabab endi `p_reason` da (izoh ustiga yozilmasin); material/obyekt almashtirish — `p_material_id` + `p_unit_id` (yangi materialning birligi), `p_object_id`. PostgREST'da nomli argumentlar bilan chaqirish tavsiya etiladi.

## Edge Function shartnomasi

### photo-hash — sweep rejimi

- Uyg'otish: pg_net `POST <private.app_settings.photo_hash_url>` (standart `https://srriiiugmxgrdnuvhgix.supabase.co/functions/v1/photo-hash`), sarlavhalar `Content-Type: application/json`, `x-photo-secret: <vault photo_hash_secret>`, tana `{"mode":"sweep"}`, timeout 60 s. Har tranzaksiyada bir marta (`terron.photo_hash_woken`); cron har 5 daqiqada muddati kelgan ish bo'lsa yana uyg'otadi.
- Sir: Vault `photo_hash_secret` (32 bayt hex, migratsiyada tasodifiy yaratiladi — `tg_dispatch_secret` bilan bir xil usul). Edge Function sirni `svc_photo_hash_secret()` (service_role) bilan o'qiydi va `x-photo-secret` sarlavhasi bilan doimiy vaqtda (constant-time) solishtiradi — alohida function secret kerak emas (tg-dispatch / `svc_dispatch_secret` bilan bir xil usul).
- Ish sikli (service_role): `svc_claim_photo_hash_jobs(20)` → har ish uchun Storage `photos/<photo_path>` ni o'qish → SHA-256 (hex) → `svc_complete_photo_hash_job(job_id, sha256)`. Xato: `svc_complete_photo_hash_job(job_id, null, '<xato>', p_final)` — fayl yo'q / ruxsat yo'q → `p_final = true` (`failed`); vaqtinchalik → `false` (`pending`, `2^attempts` daqiqadan keyin; 6 urinishdan keyin `failed`). `stale` — yozuv o'chirilgan yoki rasm yo'li o'zgargan (xesh yozilmaydi). Olingan, lekin 10 daqiqada yakunlanmagan ish keyingi claim'da qayta beriladi.
- Klient oqimi (`{table, id}`) saqlanadi; u ham `svc_set_photo_hash(table, id, sha, p_expected_path => o'qilgan yo'l)` bilan yozishi kerak (eski yuklash javobi yangi rasmga yozilmasin). Muvaffaqiyatli yozuv shu yozuv+yo'lning ochiq navbat ishini `done` qiladi.

### tg-bot / tg-auth — `svc_touch_chat`

Har kiruvchi update (xabar, callback, `/start`, `my_chat_member` → `member`) va har muvaffaqiyatli `tg-auth`: `select public.svc_touch_chat(<chat_id>)` (qaytaradi: tozalangan profillar soni). Bot bloklansa — avvalgidek `svc_mark_chat_blocked(chat_id, true)` / `svc_complete_notification(..., p_blocked_chat_ids)`.

### admin-users — birinchi login

Admin (super_admin emas) `auth_user_id` null bo'lgan **direktor** (yoki admin) profiliga login bog'laganda: `svc_alert_login_set(p_target_profile => <profil>, p_actor => <admin profili>, p_first_login => true)`. Mavjud loginni almashtirish — avvalgidek (`p_first_login` siz, standart `false`). DB `profile_protected` admin/direktor profilini yaratish va rolini berishni faqat super_admin ga qoldiradi (foydalanuvchi sessiyasi) — Edge Function service_role bilan yozsa trigger ushlamaydi, shuning uchun u ham shu qoidani tekshirishi kerak.

## Bildirishnoma payloadlari (yangi)

Hamma kalitlar har doim bor (qiymati `null` bo'lishi mumkin); miqdor/summa — JSON son; vaqt — ISO timestamptz. `tg-dispatch` bu turlar uchun shablon talab qiladi.

| kind | `profile_id` | `ref_id` | Kimga | Takrorlanish |
|---|---|---|---|---|
| `transfer_cancelled` | — | o'tkazma | qabul obyektining prorab / omborchi a'zolari (bekor qiluvchidan tashqari) | bir marta |
| `transfer_received` | yuboruvchi (`created_by`) | o'tkazma | yuboruvchi (o'zi qabul qilmagan bo'lsa) | bir marta |
| `purchase_deleted` | — | xarid | obyektning prorab / omborchi a'zolari (xaridordan tashqari) — faqat `purchase_for_object` yuborilgan bo'lsa | bir marta |
| `purchase_on_your_name` | xaridor | xarid | xaridor (notify_workflow ga qaramaydi, tinch oynada ushlanmaydi) | (xarid, xaridor) bo'yicha bir marta |
| `inventory_applied` | hisob muallifi | inventarizatsiya | muallif (qo'llagan o'zi bo'lmasa) | bir marta |
| `alerts_digest` | — | — | direktor, admin | har dayjest |

`request_approved` qabul qiluvchilari: taminotchi + obyektning haydovchi a'zolari. `notify_workflow = false` — ish oqimi turlarida (yangi `transfer_*`, `purchase_deleted`, `inventory_applied` ham) qabul qiluvchi emas.

### `transfer_cancelled`, `transfer_received`

```json
{ "transfer_id": "uuid", "company_name": "…", "status": "bekor | qabul_qilindi",
  "from_object_id": "uuid", "from_object_name": "…", "to_object_id": "uuid", "to_object_name": "…",
  "material_id": "uuid", "material_name": "…", "qty_input": 3, "unit_input": "qop", "qty_base": 150,
  "received_qty_base": 150, "base_unit": "kg", "note": "… | null", "cancel_reason": "… | null",
  "sent_by_id": "uuid", "sent_by_name": "… | null", "received_by_name": "… | null",
  "created_at": "<timestamptz>", "received_at": "<timestamptz> | null" }
```
`transfer_cancelled` qo'shimcha: `cancelled_by_id`, `cancelled_by_name`, `cancelled_at`.

### `purchase_deleted`

`purchase_for_object` shakli (`purchase_id, company_name, object_id, object_name, material_id, material_name, qty_input, unit_input, qty_base, base_unit, buyer_id, buyer_name, supplier_name, purchased_at`) + `deleted_at`, `deleted_by_name`, `reason` (`cancel_own_entry` sababi yoki null).

### `purchase_on_your_name`

```json
{ "purchase_id": "uuid", "alert_id": "uuid", "company_name": "…", "buyer_id": "uuid", "buyer_name": "…",
  "actor_name": "…", "object_id": "uuid", "object_name": "…", "material_id": "uuid", "material_name": "…",
  "qty_input": 2, "unit_input": "qop", "qty_base": 100, "base_unit": "kg", "total_amount": 250000,
  "payment_source": "podotchet | firma", "purchased_at": "<timestamptz>" }
```

### `inventory_applied`

```json
{ "count_id": "uuid", "company_name": "…", "object_id": "uuid", "object_name": "…",
  "counted_at": "<timestamptz>", "submitted_at": "<timestamptz> | null", "applied_at": "<timestamptz>",
  "applied_by_name": "… | null", "items_count": 12, "adjusted_count": 3 }
```
Miqdor va kamomad yo'q (ko'r-ko'rona sanash).

### `alerts_digest`

```json
{ "company_name": "…", "alert_type": "smetadan_ortiq_sorov", "count": 7, "alert_ids": ["uuid", "…"],
  "items": [{ "alert_id": "uuid", "request_id": "uuid", "object_id": "uuid", "object_name": "…",
              "material_id": "uuid", "material_name": "…", "over_qty_base": 120.5, "base_unit": "kg" }],
  "more_count": 0, "created_at": "<timestamptz>" }
```
`items` — birinchi 20 ta (alert yaratilish tartibida), `more_count` — qolgani. Dayjestga kirgan alertlarning alohida `alert` xabari yo'q (eslatma — `alert_reminder` — avvalgidek ishlaydi).

### `login_changed` — o'zgargan

+ `first_login` (bool).

## Qilinmaganlar va cheklovlar

- Zanjir (L2) yangi `xarid_qabul_farqi` yaratmaydi — xarid o'chirilib tiklansa yoki orqa sanali xarid qo'shilsa, yangi farq alerti hourly cron'da (≤ 1 soat) paydo bo'ladi.
- `purchase_deleted` va boshqa bir martalik turlar (kind, ref_id) bo'yicha bir marta — xarid tiklanib qayta o'chirilsa ikkinchi xabar yo'q.
- `payment_source` ni admin / buxgalter keyin o'zgartirsa — `yozuv_ozgartirildi` (ogohlantirish).
- GUC'lar (`terron.correct_mode`, `terron.merge_rpc`, ...) PostgREST klienti tomonidan o'rnatilmaydi (`set_config` API'da yo'q) — faqat to'g'ridan-to'g'ri SQL (ishonchli zona) ularni soxtalashtira oladi.
