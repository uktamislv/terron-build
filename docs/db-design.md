# Ma'lumotlar bazasi dizayni (Batch 1)

Supabase PostgreSQL 17. Bu hujjat — migratsiyalar uchun shartnoma. Kod bilan farq qilsa, hujjat yangilanadi.

## Umumiy qoidalar

- Sxemalar: `public` — jadvallar (PostgREST orqali ochiq, RLS bilan). `private` — yordamchi funksiyalar va triggerlar (API'ga ochiq emas).
- Kalitlar: `id uuid primary key default gen_random_uuid()`.
- Har bir biznes jadvalida: `company_id uuid not null`, `created_by uuid` (→ `profiles.id`), `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, `deleted_at timestamptz`.
- **Firmalararo yaxlitlik:** har bir biznes jadvalida `unique (company_id, id)`. Boshqa biznes jadvaliga havola **kompozit FK** bilan: `foreign key (company_id, material_id) references materials (company_id, id)`. Shunda A firma yozuvi B firma materialiga bog'lana olmaydi, hatto UUID ma'lum bo'lsa ham.
- Har bir FK ustuni indekslanadi (kompozit FK uchun `(company_id, x_id)` indeksi).
- Pul — `numeric(18,2)` (so'm). Miqdor — `numeric(20,6)`. Koeffitsient — `numeric(20,10)`. Foiz — `numeric(6,2)`. `float`/`real` yo'q.
- Vaqt — `timestamptz`. Ko'rsatish Asia/Tashkent'da (frontend). Sana ustunlari (masalan smeta sanasi) — `date`.
- Nomlar — kichik harf, snake_case.

## Rollar

`create type user_role as enum ('super_admin','admin','direktor','buxgalter','taminotchi','prorab','omborchi','haydovchi','tekshiruvchi')`

- **Firma bo'yicha rollar** (barcha obyektlarni ko'radi): `super_admin`, `admin`, `direktor`, `buxgalter`, `taminotchi`, `tekshiruvchi`.
- **Obyekt bo'yicha rollar** (faqat `object_members` dagi obyektlar): `prorab`, `omborchi`.
- **`haydovchi`**: faqat o'z xaridlari va o'ziga berilgan podotchet; katalog va o'zi biriktirilgan obyektlar.
- `super_admin` — barcha firmalarni ko'radi va o'zgartiradi.

## Foydalanuvchi va auth

- `profiles.auth_user_id uuid references auth.users(id) on delete set null` — **nullable**: admin foydalanuvchini telefon va rol bilan oldindan qo'shadi, auth akkaunt keyin (Batch 2) bog'lanadi. Unique — o'chirilmagan profillar orasida (soft delete qilingan profil akkauntni band qilmasin).
- `profiles`: `company_id`, `role`, `full_name`, `phone` (E.164: `^\+[0-9]{9,15}$`; firma ichida unique, `deleted_at is null` bo'lganlar orasida), `telegram_user_id bigint` (unique, o'chirilmaganlar orasida), `telegram_chat_id bigint`, `is_active boolean`.
- `created_by` hamma joyda `profiles.id` ga ishora qiladi (auth id'ga emas).

## Yordamchi funksiyalar (`private` sxema)

Barchasi `language sql stable security definer set search_path = ''`, faqat joriy foydalanuvchi (`auth.uid()`) haqida ma'lumot qaytaradi. `authenticated` ga `usage on schema private` va `execute` beriladi (RLS siyosatlari chaqiruvchi huquqi bilan ishlaydi); `anon` va `public` dan olib tashlanadi.

| Funksiya | Qaytaradi |
|---|---|
| `private.my_profile_id()` | joriy faol (o'chirilmagan, `is_active`) profil id; firmasi ham `is_active` va o'chirilmagan bo'lishi shart (aks holda hamma yordamchilar null → hech narsa ko'rinmaydi) |
| `private.my_company_id()` | uning `company_id` |
| `private.my_role()` | uning roli |
| `private.is_super_admin()` | `my_role() = 'super_admin'` |
| `private.has_role(variadic user_role[])` | rol ro'yxatda bormi |
| `private.can_access_company(uuid)` | `is_super_admin() or company_id = my_company_id()` |
| `private.can_access_object(uuid)` | firma bo'yicha rol **yoki** `object_members` da a'zo (o'chirilmagan) |
| `private.is_company_wide()` | rol firma bo'yicha rollardan birimi (`super_admin`, `admin`, `direktor`, `buxgalter`, `taminotchi`, `tekshiruvchi`) |
| `private.my_object_ids()` | `setof uuid` — a'zo bo'lgan (o'chirilmagan) obyektlar; siyosatlarda `object_id in (select private.my_object_ids())` (har qator uchun funksiya chaqirilmaydi) |

Siyosatlarda har doim `(select private.fn())` ko'rinishida — har qator uchun qayta chaqirilmasligi uchun.

Migratsiya egasi (`postgres`) `BYPASSRLS` bo'lishi shart (Supabase'da shunday): security definer funksiyalar `force row level security` li `profiles`/`object_members` ni o'qiydi. Bo'lmasa birinchi migratsiya `raise exception` bilan to'xtaydi.

## RLS

- Har bir `public` jadvalda `enable row level security` **va** `force row level security`.
- `anon` uchun hech qanday siyosat yo'q. Siyosatlar `to authenticated`.
- **DELETE siyosati yo'q** — DELETE hech kimga ruxsat etilmaydi.
- **SELECT:** firma a'zolari `deleted_at is null` qatorlarni ko'radi (rol cheklovlari bilan). `admin`, `direktor`, `super_admin` o'chirilganlarni ham ko'radi (tarix va tiklash uchun) — alohida siyosat.
- **INSERT `with check`:** `company_id = my_company_id()` (super_admin — istalgan), `created_by = my_profile_id()`, rol ruxsati, obyekt bo'yicha rol uchun `can_access_object(object_id)`.
- **UPDATE:** `using` + `with check` ikkalasi ham. Soft delete = `update ... set deleted_at = now()`.
- Trigger `company_id`, `created_by`, `created_at` ni UPDATE'da o'zgartirishni taqiqlaydi.

### Kirish matritsasi

| Jadval | Ko'rish | Qo'shish | O'zgartirish / soft delete |
|---|---|---|---|
| `companies` | o'z firmasi | super_admin | admin (o'z firmasi sozlamalari), super_admin |
| `profiles` | firma a'zolari | admin | admin |
| `objects` | firma rollari: hammasi; boshqalar: a'zo bo'lganlari | admin | admin |
| `object_members` | firma rollari: hammasi; boshqalar: o'z qatorlari | admin | admin |
| `materials`, `material_units`, `material_aliases`, `suppliers` | firma a'zolari | admin | admin |
| `cash_advances` | admin, direktor, buxgalter: hammasi; boshqalar: o'ziga berilgani | admin, buxgalter | admin, buxgalter |
| `purchases` | admin, direktor, buxgalter, taminotchi, tekshiruvchi: hammasi; prorab: a'zo obyektlar + o'zi xarid qilgani; haydovchi: faqat o'zi xarid qilgani | admin, taminotchi; haydovchi, prorab (a'zo obyekt); `buyer_id = my_profile_id()` (admin'dan tashqari) | admin |
| `movements` | firma rollari: hammasi; prorab, omborchi: a'zo obyektlar | admin; prorab, omborchi (a'zo obyekt) | admin |
| `inventory_counts`, `inventory_count_items` | firma rollari; prorab, omborchi: a'zo obyektlar | admin, tekshiruvchi | admin, tekshiruvchi (o'zi yaratgan, `status = 'draft'`) |
| `estimates`, `estimate_items` | firma rollari; prorab: a'zo obyektlar | admin, buxgalter | admin, buxgalter |
| `material_requests` | firma rollari; prorab: a'zo obyektlar | admin; prorab (a'zo obyekt) | admin, taminotchi |
| `transfers` | firma rollari; prorab, omborchi: qaysidir tomoni a'zo obyekt | admin; prorab (`from_object` a'zo) | admin |
| `alerts` | admin, direktor, buxgalter | — (faqat tizim: trigger/Edge Function) | admin |
| `audit_log` | admin, direktor | — (faqat trigger) | — |
| `company_settings` ichida | `companies` ustunlari sifatida | | |

Bu Batch 1 asosi; keyingi batch'larda (masalan creator o'z yozuvini tuzatishi) kengaytiriladi.

### Matritsaga aniqliklar (Batch 1 amalga oshirishda)

- **O'chirilgan qatorlarni ko'rish:** `super_admin`, `admin`, `direktor` **va shu jadvalni o'zgartira oladigan rol** (`cash_advances`, `estimates`, `estimate_items` — buxgalter; `inventory_*` — tekshiruvchi; `material_requests` — taminotchi). Sabab: PostgreSQL UPDATE'da yangi qator SELECT siyosatidan ham o'tishi kerak — aks holda bu rollar soft delete qila olmaydi.
- **Tiklash** (`deleted_at` → null) faqat `admin`/`super_admin` — `a_before_update` trigger tekshiradi (`auth.uid()` bo'lmasa — tizim, ruxsat).
- **companies:** admin `is_active` va `deleted_at` ni o'zgartira olmaydi (faqat super_admin) — `b_companies_guard` trigger.
- **profiles:** admin `role = 'super_admin'` profil yarata olmaydi, super_admin profilini o'zgartira olmaydi va o'zini super_admin qila olmaydi.
- **purchases:** `omborchi` ham a'zo obyektlardagi xaridlarni ko'radi (kirimni xaridga bog'lash uchun). Har kim o'zi `buyer_id` bo'lgan xaridni ko'radi.
- **movements:** prorab/omborchi faqat `kirim`/`chiqim` qo'sha oladi; `transfer_*` va `inventory_adjust` — admin (keyin Batch 8 funksiyalari). `haydovchi` harakatlarni ko'rmaydi.
- **material_requests:** prorab faqat `status = 'kutilmoqda'`, `decided_by is null` bilan qo'shadi. **transfers:** prorab faqat `status = 'yuborildi'`.
- **inventory_count_items / estimate_items** ko'rinishi ota-yozuvning RLS'i orqali (`exists (select 1 from inventory_counts …)`).
- **Grantlar:** `anon` — hech narsa. `authenticated` — `select, insert, update` (`audit_log` — faqat `select`). `service_role` — `select, insert, update, delete` (DELETE baribir trigger bilan bloklangan; `truncate`, `references`, `trigger` yo'q), `audit_log` da faqat `select` (audit yozuvini faqat trigger qiladi). `stock_balances` — `authenticated`, `service_role` uchun `select`.
- **profiles ustun grantlari:** `authenticated` — `insert (id, company_id, role, full_name, phone, is_active, created_by)`, `update (role, full_name, phone, is_active, deleted_at, updated_at)`. `auth_user_id`, `telegram_user_id`, `telegram_chat_id` ni faqat `service_role` yozadi (Batch 2: tg-auth / bog'lash). Trigger `b_profiles_phone_unlink`: `phone` o'zgarsa, shu UPDATE o'zi o'zgartirmagan bog'lanish ustunlari (`auth_user_id`, `telegram_user_id`, `telegram_chat_id`) null bo'ladi — eski akkaunt yangi raqamga o'tmaydi.
- **Default privileges:** `alter default privileges for role postgres in schema public revoke all on tables/sequences from anon, authenticated` va `execute on functions` — keyingi migratsiyalarda yangi obyektlar avtomatik ochilmaydi, grant aniq beriladi. PostgreSQL'ning global `PUBLIC EXECUTE` (funksiyalar) sxema darajasida olib tashlanmaydi; global revoke extension funksiyalarini ham buzgani uchun ishlatilmagan — har yangi public funksiya `revoke execute ... from public, anon` ni o'zi qiladi.
- **TRUNCATE:** har biznes jadval va `audit_log` da `a_block_truncate` (`before truncate for each statement`, 42501) — superuser uchun ham.
- **purchases qo'shish:** `taminotchi` (firma bo'yicha rol) — istalgan obyektga; `prorab` va `haydovchi` — faqat a'zo obyektga (`can_access_object`); hamma admin bo'lmaganlar — `buyer_id = my_profile_id()`.
- **material_requests:** admin/super_admin bo'lmagan (taminotchi) faqat `status` va `note` ni o'zgartiradi (`b_material_requests_guard`). O'tishlar: `kutilmoqda → tasdiqlandi | rad`, `tasdiqlandi → xarid_qilindi`; admin — istalgan. `decided_by`/`decided_at` — faqat trigger: status o'zgarganda `my_profile_id()`/`now()`, aks holda eski qiymat; INSERT'da `kutilmoqda` bo'lsa null. Natija: taminotchi so'rovni soft delete qila olmaydi (faqat admin).
- **inventory:** `inventory_counts_insert` — `status = 'draft'`. `draft → submitted` faqat `public.submit_inventory_count(p_count_id uuid)` orqali (security definer; admin/super_admin yoki shu hisobni yaratgan tekshiruvchi; har qator `qty_expected` = `stock_balances` dagi joriy qoldiq yoki 0; status draft bo'lmasa — `55000`, topilmasa — `P0002`). `authenticated` statusni to'g'ridan-to'g'ri o'zgartirsa — 42501 (`b_inventory_counts_guard`); `qty_expected` ni yoza olmaydi (`b_inventory_items_guard`: insert'da null, update'da eski qiymat). Trigger `current_user = 'authenticated'` ga qaraydi — definer funksiya ichida `current_user` = egasi.
- **alerts:** `closed_by`/`closed_at` — faqat trigger (`b_alerts_close`): status `yopildi` ga o'tganda `my_profile_id()`/`now()`, `yopildi` dan chiqsa null.
- **`created_by`** — oddiy FK `profiles(id)` (kompozit emas): `super_admin` o'z firmasida turib boshqa firmalarda yozuv yaratadi; kompozit FK buni buzardi. INSERT siyosati `created_by = my_profile_id()` ni talab qiladi, UPDATE trigger uni o'zgartirishni taqiqlaydi.
- `decided_by`, `closed_by`, `buyer_id`, `recipient_id` — kompozit FK (shu firma profili). Natija: super_admin boshqa firmada so'rovni hal qilsa yoki alertni yopsa, o'zini `decided_by`/`closed_by` qilib yoza olmaydi (null qoldiradi) — sinov versiyasi uchun maqbul.

## Soft delete

- Har jadvalda `before delete` trigger → `raise exception 'soft delete only'` (service_role uchun ham).
- O'chirish = `deleted_at` qo'yish; tiklash = `deleted_at = null` (faqat admin).

## Audit

- `audit_log`: `id bigint generated always as identity`, `company_id`, `table_name text`, `record_id uuid`, `action text` (`INSERT`, `UPDATE`, `SOFT_DELETE`, `RESTORE`), `old_data jsonb`, `new_data jsonb`, `changed_fields text[]`, `actor_profile_id uuid`, `actor_auth_uid uuid`, `device text` (`veb`, `mobil`, `tizim`), `created_at timestamptz`.
- Bitta umumiy trigger funksiya `private.audit_row()` (`security definer`), har biznes jadvalga `after insert or update`.
- `changed_fields` — UPDATE'da o'zgargan ustunlar (`updated_at` dan tashqari). Faqat `updated_at` o'zgargan UPDATE yozilmaydi. `companies` uchun `audit_log.company_id = companies.id`.
- Umumiy triggerlar (nom tartibi bilan): `a_block_delete` (before delete), `a_block_truncate` (before truncate, statement), `a_before_insert` (`created_by` bo'sh bo'lsa `my_profile_id()`; `created_at`/`updated_at` = `now()`), `a_before_update` (`id`, `company_id`, `created_by`, `created_at` o'zgarmaydi; tiklash — faqat admin; `updated_at = now()`), `z_audit` (after insert or update).
- `device`: so'rov sarlavhasidan `current_setting('request.headers', true)::json ->> 'x-client-device'` (`veb`/`mobil`), auth bo'lmasa (service_role, cron) — `tizim`. Noto'g'ri qiymat — `null`.
- `audit_log` ga to'g'ridan-to'g'ri INSERT/UPDATE/DELETE hech kimga yo'q (grant ham, siyosat ham yo'q). `audit_log` ning o'zida DELETE va UPDATE trigger bilan bloklangan.

## Jadvallar (asosiy ustunlar)

- `companies`: `name`, `receipt_mismatch_pct numeric(6,2) default 2`, `price_deviation_pct default 8`, `price_avg_window int default 5`, `timezone text default 'Asia/Tashkent'`, `is_active`.
- `objects`: `name`, `address`, `status` (`faol`/`yakunlangan`/`toxtatilgan`).
- `object_members`: `object_id`, `profile_id`, unique (`object_id`,`profile_id`) o'chirilmaganlar orasida.
- `materials`: `name` (firma ichida `lower(name)` unique, o'chirilmaganlar orasida), `base_unit text`, `waste_pct numeric(6,2) default 0`, `is_active`, `category text`.
- `material_units`: `material_id`, `unit text`, `factor numeric(20,10) check (> 0)` — 1 `unit` = `factor` asosiy birlik, `variant text` (ixtiyoriy). Unique (`material_id`,`unit`,`coalesce(variant,'')`) o'chirilmaganlar orasida. Asosiy birlikning o'zi ham `factor = 1` qator sifatida saqlanadi (birlik tanlash tugmalari bitta ro'yxatdan chiqadi).
- `material_aliases`: `material_id`, `alias text`, `lang text` (`ru`, `uz`). Unique (`company_id`, `lower(alias)`).
- `suppliers`: `name`, `phone`, `note`.
- `cash_advances`: `recipient_id` (→ profiles), `amount numeric(18,2) check (> 0)`, `issued_at`, `note`.
- **Miqdor bazada hisoblanadi** (`purchases`, `movements`, `transfers`, `material_requests`): `unit_id uuid not null`, FK `(company_id, unit_id) → material_units (company_id, id)`. Trigger `b_compute_qty` (before insert or update, security definer): birlikni o'qiydi (o'chirilmagan; UPDATE'da o'zgarmagan eski birlik o'chirilgan bo'lsa ham qoladi), `unit.material_id ≠ material_id` yoki topilmasa — `23503`; `unit_input := unit.unit`, `unit_variant := unit.variant`, `qty_base := round(qty_input * factor, 6)`. Klient yuborgan `qty_base`, `unit_input` e'tiborga olinmaydi. Qulaylik: `unit_id` berilmasa, `(material_id, unit_input)` bo'yicha **variantsiz** birlik qidiriladi. `inventory_adjust` da `qty_input` manfiy bo'lishi mumkin — ishora `qty_base` ga o'tadi.
- Har materialning asosiy birligi (`factor = 1`) material yaratilganda avtomatik `material_units` ga qo'shiladi (`b_base_unit` trigger). `base_unit` ni keyin o'zgartirish hozircha cheklanmagan — Batch 3 da (harakat bo'lsa taqiqlash) hal qilinadi.
- `purchases`: `buyer_id` (→ profiles), `object_id` (not null), `material_id`, `unit_id`, `supplier_id` (nullable), `qty_input`, `unit_input`, `unit_variant`, `qty_base`, `total_amount numeric(18,2)` — **haqiqat manbai** (foydalanuvchi chekdagi jami summani kiritadi), `unit_price numeric(18,2)` = `round(total_amount / qty_input, 2)` va `price_per_base numeric(18,4)` = `round(total_amount / qty_base, 4)` — ikkalasini trigger hisoblaydi (narx og'ishi qoidasi `price_per_base` ga tayanadi), `receipt_photo_path text`, `purchased_at`, `note`. `check (qty_base > 0 and total_amount >= 0)`.
- `movements`: `type movement_type` (`kirim`,`chiqim`,`transfer_out`,`transfer_in`,`inventory_adjust`), `object_id`, `material_id`, `unit_id`, `qty_input`, `unit_input`, `unit_variant`, `qty_base`, `purchase_id` (nullable), `transfer_id` (nullable), `inventory_count_id` (nullable), `photo_path`, `occurred_at`, `note`. `qty_base > 0`, `qty_input > 0` (inventory_adjust uchun `<> 0`, ishorali). Bog'lanishlar (`movements_links_check`): `kirim` — `transfer_id`, `inventory_count_id` null (`purchase_id` ixtiyoriy); `chiqim` — uchalasi null; `transfer_in/out` — `transfer_id` majburiy, boshqalari null; `inventory_adjust` — `inventory_count_id` majburiy, boshqalari null. `purchase_id` bo'lsa (trigger): xarid shu firmada, o'chirilmagan (aks holda `23503`), `material_id` va `object_id` mos (aks holda `23514`).
- `inventory_counts`: `object_id`, `status` (`draft`/`submitted`), `counted_at`. `inventory_count_items`: `inventory_count_id`, `material_id`, `qty_counted`, `qty_expected` (yuborish paytidagi hisob).
- `estimates`: `object_id`, `version int`, `title`, `estimate_date date`, `source_file_name`, `is_current boolean`; unique (`object_id`,`version`) va obyektda bitta `is_current` — ikkalasi o'chirilmaganlar orasida. `estimate_items`: `estimate_id`, `item_type` (`ish`/`material`), `name`, `material_id` (nullable), `unit`, `qty`, `unit_price`, `norm_qty_base` (nullable), `sort_order int`.
- `material_requests`: `object_id`, `material_id`, `unit_id`, `qty_input`, `unit_input`, `unit_variant`, `qty_base`, `status request_status` (`kutilmoqda`,`tasdiqlandi`,`rad`,`xarid_qilindi`), `needed_by date`, `decided_by`, `decided_at`, `note`.
- `transfers`: `from_object_id`, `to_object_id` (`check from <> to`), `material_id`, `unit_id`, `qty_input`, `unit_input`, `unit_variant`, `qty_base`, `status` (`yuborildi`/`qabul_qilindi`/`bekor`).
- `alerts`: `type alert_type` (`xarid_qabul_farqi`, `ozi_qabul_qilgan`, `narx_ogishi`, `normadan_oshish`, `inventarizatsiya_kamomadi`, `smetadan_ortiq_sorov`), `status alert_status` (`yangi`,`korildi`,`yopildi`), `severity` (`belgi`,`ogohlantirish`,`jiddiy`), `object_id`, `material_id`, `purchase_id`, `movement_id`, `request_id`, `inventory_count_id` (5-qoida uchun), `details jsonb`, `closed_by`, `closed_at`.

## Qoldiq

- View `public.stock_balances` (`with (security_invoker = true)` — RLS chaqiruvchi huquqida ishlaydi): `company_id`, `object_id`, `material_id`, `last_movement_at`, `qty_base` = `kirim + transfer_in − chiqim − transfer_out + inventory_adjust`, faqat `deleted_at is null` harakatlar.

## Seed va shablon

- `private.apply_material_template(company_id uuid)` — yangi firma uchun materiallar shabloni (SaaS'da har yangi firmaga chaqiriladi). Idempotent (material nom bo'yicha, birlik `(unit, variant)` bo'yicha, alias `lower(alias)` bo'yicha tekshiriladi). Execute — faqat `service_role` (va egasi); foydalanuvchi sessiyasida faqat super_admin. Sement M400 va M500 — ikki alohida material.
- `supabase/seed.sql`: namuna firma, 3 obyekt, shablon qo'llanadi. Auth foydalanuvchilarisiz (ular Batch 2 da). **Production'ga qo'llanmaydi** — faqat lokal/sinov uchun namuna ma'lumot.

## Xavfsizlik chegaralari va eslatmalar

- **`device` sarlavhasi** (`x-client-device`) klient tomonidan soxtalashtirilishi mumkin — faqat ma'lumot uchun (audit), hech qanday xavfsizlik qarori unga tayanmaydi. Keyin JWT claim'ga (tg-auth bergan sessiya) o'tkaziladi.
- **`postgres` / Supabase dashboard — ishonchli zona.** Superuser / egasi sifatida bajarilgan SQL RLS'ni chetlab o'tadi, `session_replication_role` yoki triggerlarni o'chirish orqali auditni ham chetlab o'tishi mumkin. Ilova faqat `authenticated` va `service_role` orqali ishlaydi.
- **Sanalar:** bazada `timestamptz` (UTC). Hisobotlarda kunlarga kesish doim `(ts at time zone 'Asia/Tashkent')::date` bilan (`companies.timezone`).
- **Telefon bir necha firmada** bo'lishi mumkin (`unique (company_id, phone)`). Bitta auth/Telegram akkaunt — bitta faol profil; qaysi firma profiliga bog'lashni Batch 2 dagi bog'lash oqimi hal qiladi.
- **Orqa sanaga yozish** (`occurred_at`, `purchased_at` o'tmishga) hozircha cheklanmagan — Batch 4 da qoida qo'shiladi.
- **`audit_log`** da `updated_at`/`deleted_at`/`created_by` yo'q — faqat qo'shiladigan jurnal uchun ataylab qilingan istisno (o'zgarmaydi, o'chirilmaydi).

Shablon (koeffitsientlar taxminiy, firma o'zgartiradi):

| Material | Asosiy birlik | Birliklar (1 birlik = N asosiy) | Ruscha nom |
|---|---|---|---|
| G'isht | dona | poddon = 300; m² devor: yarim g'isht · 120 mm = 51, bir g'isht · 250 mm = 102, bir yarim g'isht · 380 mm = 153 | Кирпич |
| Sement M400 / M500 | kg | qop = 50; tonna = 1000 | Цемент М400 / М500 |
| Qum | m³ | tonna = 0,6667 | Песок |
| Shag'al | m³ | tonna = 0,7143 | Щебень |
| Armatura | kg | tonna = 1000; metr: Ø8 = 0,395, Ø10 = 0,617, Ø12 = 0,888, Ø14 = 1,21, Ø16 = 1,58 | Арматура |
| Beton | m³ | — | Бетон |
| Kafel | m² | dona: 30×30 sm = 0,09, 60×60 sm = 0,36 | Плитка, Кафель |
