# Ma'lumotlar bazasi dizayni (Batch 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)

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
| `materials`, `material_units`, `material_aliases` | firma a'zolari | admin | admin |
| `suppliers` | firma a'zolari | admin; taminotchi, haydovchi, prorab — faqat nom (Batch 5) | admin |
| `cash_advances` | admin, direktor, buxgalter: hammasi; boshqalar: o'ziga berilgani | admin, buxgalter | admin, buxgalter |
| `purchases` | admin, direktor, buxgalter, taminotchi, tekshiruvchi: hammasi; prorab: a'zo obyektlar + o'zi xarid qilgani; haydovchi: faqat o'zi xarid qilgani | admin, taminotchi; haydovchi, prorab (a'zo obyekt); `buyer_id = my_profile_id()` (admin'dan tashqari) | admin |
| `movements` | firma rollari: hammasi; prorab, omborchi: a'zo obyektlar | admin; prorab, omborchi (a'zo obyekt) | admin |
| `inventory_counts`, `inventory_count_items` | firma rollari; prorab, omborchi: a'zo obyektlar | admin, tekshiruvchi | admin, tekshiruvchi (o'zi yaratgan, `status = 'draft'`) |
| `estimates`, `estimate_items` | firma rollari; prorab: a'zo obyektlar | admin, buxgalter | admin, buxgalter |
| `estimate_import_templates` (Batch 7) | firma a'zolari | admin, buxgalter | admin, buxgalter |

Batch 7: `estimates`, `estimate_items` — qo'shish va `is_current`/qator mazmunini o'zgartirish faqat RPC (`import_estimate`, `set_current_estimate`) orqali; to'g'ridan-to'g'ri — faqat nom/sana/fayl nomi va soft delete ("Smeta importi" bo'limi).
| `material_requests` | firma rollari; prorab: a'zo obyektlar | admin; prorab (a'zo obyekt) | admin, taminotchi |
| `transfers` | firma rollari; prorab, omborchi: qaysidir tomoni a'zo obyekt | Batch 8: faqat RPC `create_transfer` (admin; prorab — `from` a'zo) | Batch 8: faqat RPC `receive_transfer` / `cancel_transfer` |
| `alerts` | admin, direktor, buxgalter | — (faqat tizim: trigger/Edge Function; Batch 5 qoidalari — `private.evaluate_*`) | admin — faqat `status`, `close_note` (Batch 5) |
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
- **alerts:** `closed_by`/`closed_at` — faqat trigger (`b_alerts_close`): status `yopildi` ga o'tganda `my_profile_id()`/`now()`, `yopildi` dan chiqsa null. Batch 5: `closed_by` faqat `current_user = 'authenticated'` bo'lsa (foydalanuvchi yopdi); tizim (security definer qoida funksiyasi, service_role, cron) yopsa — null.
- **`created_by`** — oddiy FK `profiles(id)` (kompozit emas): `super_admin` o'z firmasida turib boshqa firmalarda yozuv yaratadi; kompozit FK buni buzardi. INSERT siyosati `created_by = my_profile_id()` ni talab qiladi, UPDATE trigger uni o'zgartirishni taqiqlaydi.
- `decided_by`, `closed_by`, `buyer_id`, `recipient_id` — kompozit FK (shu firma profili). Natija: super_admin boshqa firmada so'rovni hal qilsa yoki alertni yopsa, o'zini `decided_by`/`closed_by` qilib yoza olmaydi (null qoldiradi) — sinov versiyasi uchun maqbul.

## Soft delete

- Har jadvalda `before delete` trigger → 42501, hint `soft_delete_only` (service_role uchun ham).
- O'chirish = `deleted_at` qo'yish (qiymat — server vaqti `now()`, klientniki e'tiborga olinmaydi; qo'yilgani o'zgarmaydi — Batch 3); tiklash = `deleted_at = null` (faqat admin).
- Batch 10: tiklash UI uchun `public.restore_record(p_table, p_id)` (oq ro'yxat, invoker) — "Tarix va tiklash" bo'limi.

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
- `materials`: `name` (firma ichida `private.norm_name(name)` unique, o'chirilmaganlar orasida), `base_unit text`, `waste_pct numeric(6,2) default 0`, `is_active`, `category text`.
- `material_units`: `material_id`, `unit text`, `factor numeric(20,10) check (> 0)` — 1 `unit` = `factor` asosiy birlik, `variant text` (ixtiyoriy). Unique (`material_id`, `norm_name(unit)`, `coalesce(norm_name(variant),'')`) o'chirilmaganlar orasida. Asosiy birlikning o'zi ham `factor = 1` qator sifatida saqlanadi (birlik tanlash tugmalari bitta ro'yxatdan chiqadi).
- `material_aliases`: `material_id`, `alias text`, `lang text` (`ru`, `uz`). Unique (`company_id`, `norm_name(alias)`) o'chirilmaganlar orasida.
- `suppliers`: `name`, `phone`, `note`.
- `cash_advances`: `recipient_id` (→ profiles), `amount numeric(18,2) check (> 0)`, `issued_at`, `note`.
- **Miqdor bazada hisoblanadi** (`purchases`, `movements`, `transfers`, `material_requests`): `unit_id uuid not null`, FK `(company_id, unit_id) → material_units (company_id, id)`. Trigger `b_compute_qty` (before insert or update, security definer): birlikni o'qiydi (o'chirilmagan; UPDATE'da o'zgarmagan eski birlik o'chirilgan bo'lsa ham qoladi), `unit.material_id ≠ material_id` yoki topilmasa — `23503`; `unit_input := unit.unit`, `unit_variant := unit.variant`, `qty_base := round(qty_input * factor, 6)`. Klient yuborgan `qty_base`, `unit_input` e'tiborga olinmaydi. Qulaylik: `unit_id` berilmasa, `(material_id, unit_input)` bo'yicha **variantsiz** birlik qidiriladi. `inventory_adjust` da `qty_input` manfiy bo'lishi mumkin — ishora `qty_base` ga o'tadi.
- Har materialning asosiy birligi (`factor = 1`) material yaratilganda avtomatik `material_units` ga qo'shiladi (`b_base_unit` trigger). `base_unit` ni o'zgartirish — Batch 3 qoidalari bo'yicha (pastda "Katalog yaxlitligi").
- `purchases`: `buyer_id` (→ profiles), `object_id` (not null), `material_id`, `unit_id`, `supplier_id` (nullable), `qty_input`, `unit_input`, `unit_variant`, `qty_base`, `total_amount numeric(18,2)` — **haqiqat manbai** (foydalanuvchi chekdagi jami summani kiritadi), `unit_price numeric(18,2)` = `round(total_amount / qty_input, 2)` va `price_per_base numeric(18,4)` = `round(total_amount / qty_base, 4)` — ikkalasini trigger hisoblaydi (narx og'ishi qoidasi `price_per_base` ga tayanadi), `receipt_photo_path text`, `purchased_at`, `note`. `check (qty_base > 0 and total_amount >= 0)`.
- `movements`: `type movement_type` (`kirim`,`chiqim`,`transfer_out`,`transfer_in`,`inventory_adjust`), `object_id`, `material_id`, `unit_id`, `qty_input`, `unit_input`, `unit_variant`, `qty_base`, `purchase_id` (nullable), `transfer_id` (nullable), `inventory_count_id` (nullable), `photo_path`, `occurred_at`, `note`. `qty_base > 0`, `qty_input > 0` (inventory_adjust uchun `<> 0`, ishorali). Bog'lanishlar (`movements_links_check`): `kirim` — `transfer_id`, `inventory_count_id` null (`purchase_id` ixtiyoriy); `chiqim` — uchalasi null; `transfer_in/out` — `transfer_id` majburiy, boshqalari null; `inventory_adjust` — `inventory_count_id` majburiy, boshqalari null. `purchase_id` bo'lsa (trigger): xarid shu firmada, o'chirilmagan (aks holda `23503`), `material_id` va `object_id` mos (aks holda `23514`).
- `inventory_counts`: `object_id`, `status` (`draft`/`submitted`), `counted_at`. `inventory_count_items`: `inventory_count_id`, `material_id`, `qty_counted`, `qty_expected` (yuborish paytidagi hisob).
- `estimates`: `object_id`, `version int`, `title`, `estimate_date date`, `source_file_name`, `is_current boolean`; unique (`object_id`,`version`) va obyektda bitta `is_current` — ikkalasi o'chirilmaganlar orasida. `estimate_items`: `estimate_id`, `item_type` (`ish`/`material`), `name`, `material_id` (nullable), `unit`, `qty`, `unit_price`, `norm_qty_base` (nullable), `sort_order int`; Batch 7: `unit_id`, `code`, `row_number` — pastda "Smeta importi".
- `material_requests`: `object_id`, `material_id`, `unit_id`, `qty_input`, `unit_input`, `unit_variant`, `qty_base`, `status request_status` (`kutilmoqda`,`tasdiqlandi`,`rad`,`xarid_qilindi`), `needed_by date`, `decided_by`, `decided_at`, `note`.
- `transfers`: `from_object_id`, `to_object_id` (`check from <> to`), `material_id`, `unit_id`, `qty_input`, `unit_input`, `unit_variant`, `qty_base`, `status` (`yuborildi`/`qabul_qilindi`/`bekor`).
- `alerts`: `type alert_type` (`xarid_qabul_farqi`, `ozi_qabul_qilgan`, `narx_ogishi`, `normadan_oshish`, `inventarizatsiya_kamomadi`, `smetadan_ortiq_sorov`), `status alert_status` (`yangi`,`korildi`,`yopildi`), `severity` (`belgi`,`ogohlantirish`,`jiddiy`), `object_id`, `material_id`, `purchase_id`, `movement_id`, `request_id`, `inventory_count_id` (5-qoida uchun), `details jsonb`, `closed_by`, `closed_at`.

## Katalog yaxlitligi (Batch 3 — `20261027000001_catalog_guards.sql`)

Triggerlar service_role va superuser uchun ham ishlaydi (ma'lumot yaxlitligi). Xato shakli: `errcode` + `hint` (barqaror kalit) + o'zbekcha `message` (UUID'siz). Frontend `errors.ts` server xabarini **faqat ma'lum `hint` bo'lsa** ko'rsatadi — to'liq ro'yxat pastda ("Xato kalitlari").

### Nomlarni normallashtirish — `private.norm_name(text)`

`immutable strict`, `search_path = ''`. Tartib: bo'sh joy belgilari (probel, `\t`, `\n`, `\r`, NBSP `U+00A0`, `U+202F`, `U+2007`) ketma-ketligi → bitta probel; `btrim`; `ё→е`, `Ё→Е`; `lower()`. `null → null`. **Shartnoma:** domain-logic `normalizeAlias` (TS) aynan shunday ishlaydi va PGlite'da shu funksiya bilan solishtiriladi — nomi va xatti-harakati o'zgarmaydi. Execute: `authenticated`, `service_role` (unique indeks ifodasida), `anon`/`public` — yo'q.

Unique indekslar (o'chirilmaganlar orasida): `materials (company_id, norm_name(name))`, `material_aliases (company_id, norm_name(alias))`, `material_units (material_id, norm_name(unit), coalesce(norm_name(variant), ''))`. Migratsiya indekslarni almashtirishdan oldin normallashtirilgan dublikatlarni qidiradi — topilsa aniq xato bilan to'xtaydi (ma'lumotni qo'lda tuzatish kerak). Triggerlar dublikatni indeksdan oldin aniq `hint` bilan rad etadi (indeks — zaxira). `b_compute_qty` ning `unit_input` fallback'i, shablon (`template_*`) idempotentligi ham `norm_name` bo'yicha.

### Qoidalar

| # | Qoida | Trigger | `errcode` / `hint` |
|---|---|---|---|
| 1 | `materials.base_unit` — material biror yozuvda (`movements`, `purchases`, `transfers`, `material_requests`, `inventory_count_items`, `estimate_items`; **o'chirilganlari ham**) ishlatilgan bo'lsa o'zgarmaydi | `b_materials_guard` | P0001 `catalog_base_unit_in_use` |
| 1 | Yangi `base_unit` (norm_name bo'yicha) materialning boshqa variantsiz faol birligi bilan bir xil | `b_materials_guard` | P0001 `catalog_base_unit_conflict` |
| 1 | Ishlatilmagan materialda `base_unit` o'zgarsa — asosiy birlik qatori (`factor = 1`, variantsiz) yangi nomga sinxron o'zgaradi (bo'lmasa — yaratiladi) | `c_base_unit_sync` (after) | — |
| 1 | Asosiy birlik qatori (`unit = materials.base_unit`, `factor = 1`, variantsiz, faol): soft delete yoki `factor`/`unit`/`variant`/`material_id` o'zgarishi | `b_material_units_guard` | P0001 `catalog_base_unit_locked` |
| 2 | Birlik operatsiyada `unit_id` sifatida ishlatilgan (o'chirilganlari ham) — `factor`/`unit`/`variant`/`material_id` o'zgarmaydi. Yo'l: yangi birlik qo'shib, eskisini o'chirish (soft delete — ruxsat) | `b_material_units_guard` | P0001 `catalog_unit_in_use` |
| 3 | Material nomi dublikati (norm_name) — insert, qayta nomlash, tiklash | `b_materials_guard` | 23505 `catalog_name_duplicate` |
| 3 | Alias dublikati (firma bo'yicha) — insert, o'zgartirish, tiklash (shu jumladan material tiklanganda kaskad) | `b_material_aliases_guard` | 23505 `catalog_alias_duplicate` |
| 3 | Birlik dublikati (`material_id`, unit, variant) | `b_material_units_guard` | 23505 `catalog_unit_duplicate` |
| 4 | Material nomi = boshqa materialning alias'i yoki aksincha (norm_name; o'chirilmagan alias va o'chirilmagan material orasida). O'z nomiga teng alias — ruxsat | `b_materials_guard`, `b_material_aliases_guard` | P0001 `catalog_name_alias_conflict` |
| 5 | Materialni soft delete — `stock_balances` da qoldig'i ≠ 0 (manfiy ham) obyekt bo'lsa (xabarda obyekt nomi) | `b_materials_guard` | P0001 `catalog_material_has_stock` |
| 5 | O'chirilgan materialga yangi operatsiya yoki `material_id` ni unga o'zgartirish (6 jadval); o'chirilgan materialga birlik/alias qo'shish, ko'chirish, tiklash | `b_check_material`, `b_material_units_guard`, `b_material_aliases_guard` | P0001 `catalog_material_deleted` |
| 5 | Materiali o'chirilgan **mavjud** operatsiya qatori "muzlatiladi": faqat `note`, `photo_path`, `receipt_photo_path` (va trigger hisoblaydigan `qty_base`, `unit_input`, `unit_variant`, `unit_price`, `price_per_base`, `qty_expected`) o'zgaradi. `deleted_at`, `qty_input`, `unit_id`, `type`, `object_id`, bog'lanishlar, status — rad (qoldiq "tirilmasin"). Material tiklansa — yana tahrirlanadi | `b_check_material` | P0001 `catalog_material_deleted` |
| 5 | Nofaol material: yangi `purchases`, `transfers`, `material_requests`, `movements` (`kirim`/`chiqim`). Ruxsat: `transfer_in/out`, `inventory_adjust`, `inventory_count_items`, `estimate_items` | `b_check_material` | P0001 `catalog_material_inactive` |
| 6 | Material soft delete → uning faol alias'lari ham soft delete, `deleted_at` **aynan materialniki**. Tiklashda faqat shu `deleted_at` li alias'lar tiklanadi (oldin qo'lda o'chirilganlari emas); to'qnashsa — `catalog_alias_duplicate` / `catalog_name_alias_conflict` va butun tiklash bekor | `c_aliases_cascade` (after) | — |
| 7 | `deleted_at`: null → qiymat bo'lganda **server vaqti** `now()` (klient yuborgani e'tiborga olinmaydi); bir marta qo'yilgan qiymat o'zgarmaydi (faqat null ga — tiklash). Barcha biznes jadvallar (Batch 7 dan 19 ta) | `a_before_update` | — |

- **"O'chirilganlari ham" (1–2) — ataylab qattiqroq.** `b_compute_qty` UPDATE'da (tiklashda ham) `qty_base` ni joriy `factor` bilan qayta hisoblaydi; factor faqat o'chirilgan yozuv bo'lgani uchun o'zgarsa, tiklashda tarixiy `qty_base` jimgina o'zgarardi. Shu sabab `b_compute_qty` ning qayta hisoblashi xavfsiz qoldirildi: ishlatilgan birlikning factor'i o'zgarmas.
- **Bitta tranzaksiyada** alias qo'lda o'chirilib, keyin material o'chirilsa — ikkalasining `deleted_at` i bir xil (`now()` — tranzaksiya boshi), material tiklanganda bu alias ham tiklanadi. Qabul qilingan cheklov.
- **Trigger tartibi** (alifbo): `a_*` → `b_check_material` → `b_compute_qty` → boshqa `b_*` → `c_*` → `z_audit`.

### Qulflar va poyga

- **Miqdor hisoblash (`b_compute_qty`):** (1) `materials` qatori `for share`; (2) `unit_id` bo'lmasa nom bo'yicha qidirish; (3) `material_units` qatorini **o'qish va `for share` qulflash bitta so'rovda**; (4) factor/unit shu qatordan. INSERT va har UPDATE'da (unit_id o'zgarsa ham). Natija: parallel `factor`/`unit` o'zgarishi (`b_material_units_guard`, UPDATE — qatorni `for no key update` qulflaydi) yoki `base_unit` o'zgarishi/materialni o'chirish bilan poyga yo'q — biri ikkinchisini kutadi, keyin READ COMMITTED da yangi snapshot bilan tekshiradi. PGlite bitta sessiyali — ikki sessiyali poyga testi yo'q; test funksiya manbasida qulf tartibini va trigger tartibini tekshiradi.
- **`b_check_material`** ham material qatorini `for share` qulflaydi (inventarizatsiya va smeta qatorlari uchun ham).
- **Qulf tartibi: avval `materials`, keyin `material_units`.** Ommaviy yozuvda (import, RPC, bir tranzaksiyada ko'p qator) qatorlarni **material `id` tartibida** yozing — aks holda ikki tranzaksiya qarama-qarshi tartibda qulflab deadlock'ga tushishi mumkin (PostgreSQL birini `40P01` bilan bekor qiladi — klient qayta urinadi).
- **Nom/alias:** firma bo'yicha `pg_advisory_xact_lock` (`private.lock_catalog_names`), so'ng tekshiruv. READ COMMITTED da qulfdan keyingi so'rov yangi snapshot oladi va parallel commit'ni ko'radi. **Cheklov:** REPEATABLE READ / SERIALIZABLE tranzaksiyadagi RPC'larda snapshot birinchi so'rovda qotadi — qulfdan keyingi tekshiruv parallel commit'ni **ko'rmaydi**; bunday RPC'lar katalogga yozsa, unique indeks (zaxira) 23505 beradi yoki nom↔alias to'qnashuvi o'tib ketishi mumkin. Katalogga yozuvchi RPC'lar READ COMMITTED da bo'lsin.
- **Yordamchilar** (`private`, security definer, `search_path = ''`, execute — hech kimga): `material_is_referenced`, `unit_is_referenced`, `lock_catalog_names`.
- **Katalog RLS** o'zgarmadi: yozish — `super_admin`, `admin` (frontend `can('manage_catalog')`), ko'rish — firma a'zolari.
- `base_unit` o'zgarganda boshqa birliklarning koeffitsientlari avtomatik qayta hisoblanmaydi (material ishlatilmagan — admin tuzatadi).

### Hisobotlar uchun

- Guruhlash **`unit_id` / `qty_base` bo'yicha**, `unit_input` matni bo'yicha emas: `unit_input` — kiritilgan paytdagi birlik nomining nusxasi (ko'rsatish uchun); birlik o'chirilib, shu nomda yangisi (boshqa factor bilan) qo'shilishi mumkin. Miqdorlarni solishtirish va yig'ish — faqat `qty_base` (asosiy birlikda).

### Deploy tekshiruvi

- `lower()` (va `norm_name`) kirill harflarini bazaning locale/collation'iga qarab kichraytiradi. PGlite'da `Ц→ц` ishlaydi; **prod Supabase'da birinchi deploy'da tekshiring:** `select private.norm_name('ЦЕМЕНТ Ё') = 'цемент е'` → `true` bo'lishi kerak. `false` bo'lsa — nom/alias unique va to'qnashuv tekshiruvlari kirillda katta-kichik harfni farqlaydi.

### Xato kalitlari (`hint`) — Batch 1–7 to'liq ro'yxati

| `hint` | `errcode` | Qayerda | Ma'nosi |
|---|---|---|---|
| `soft_delete_only` | 42501 | `a_block_delete` | Yozuvni butunlay o'chirib bo'lmaydi |
| `truncate_blocked` | 42501 | `a_block_truncate` | TRUNCATE taqiqlangan |
| `audit_append_only` | 42501 | `audit_log_immutable` | Tarixni tahrirlab/o'chirib bo'lmaydi |
| `immutable_column` | 42501 | `a_before_update` | `id`, `company_id`, `created_by`, `created_at` o'zgarmaydi |
| `restore_admin_only` | 42501 | `a_before_update` | Tiklash faqat admin |
| `company_status_super_admin_only` | 42501 | `b_companies_guard` | Firma `is_active`/`deleted_at` — faqat super_admin |
| `ops_unit_not_found` | 23503 | `b_compute_qty` | Birlik topilmadi yoki o'chirilgan |
| `ops_unit_material_mismatch` | 23503 | `b_compute_qty` | Birlik boshqa materialniki |
| `purchase_not_open` | 23503 | `b_compute_qty` (movements) | Bog'langan xarid yo'q / o'chirilgan (Batch 5; avval `ops_purchase_not_found`) |
| `ops_purchase_mismatch` | 23514 | `b_compute_qty` (movements) | Xarid boshqa material/obyektga tegishli |
| `request_fields_locked` | 42501 | `b_material_requests_guard` | Taminotchi faqat holat va izohni o'zgartiradi |
| `request_status_transition` | 42501 | `b_material_requests_guard` | Ruxsatsiz holat o'tishi |
| `inventory_status_direct` | 42501 | `b_inventory_counts_guard` | Holat faqat `submit_inventory_count` orqali |
| `auth_required` | 42501 | `submit_inventory_count` | Tizimga kirilmagan |
| `inventory_not_found` | P0002 | `submit_inventory_count` | Inventarizatsiya topilmadi |
| `inventory_submit_forbidden` | 42501 | `submit_inventory_count` | Yuborishga ruxsat yo'q |
| `inventory_already_submitted` | 55000 | `submit_inventory_count` | Allaqachon yuborilgan |
| `template_super_admin_only` | 42501 | `apply_material_template` | Faqat super_admin |
| `template_company_not_found` | P0002 | `apply_material_template` | Firma topilmadi |
| `catalog_base_unit_in_use` | P0001 | `b_materials_guard` | Asosiy birlik — material ishlatilgan |
| `catalog_base_unit_conflict` | P0001 | `b_materials_guard` | Yangi asosiy birlik nomi band |
| `catalog_base_unit_locked` | P0001 | `b_material_units_guard` | Asosiy birlik qatori qulflangan |
| `catalog_unit_in_use` | P0001 | `b_material_units_guard` | Ishlatilgan birlik o'zgarmaydi |
| `catalog_unit_duplicate` | 23505 | `b_material_units_guard` | Birlik dublikati |
| `catalog_name_duplicate` | 23505 | `b_materials_guard` | Material nomi dublikati |
| `catalog_alias_duplicate` | 23505 | `b_material_aliases_guard` | Muqobil nom dublikati |
| `catalog_name_alias_conflict` | P0001 | `b_materials_guard`, `b_material_aliases_guard` | Nom ↔ alias to'qnashuvi |
| `catalog_material_has_stock` | P0001 | `b_materials_guard` | Qoldig'i bor material o'chirilmaydi |
| `catalog_material_deleted` | P0001 | `b_check_material`, `b_material_units_guard`, `b_material_aliases_guard` | O'chirilgan material |
| `catalog_material_inactive` | P0001 | `b_check_material` | Nofaol material |
| `ops_photo_path_format` | 23514 | `b_photo_path` (Batch 4) | Rasm yo'li formati noto'g'ri |
| `ops_photo_path_company` | 23514 | `b_photo_path` (Batch 4) | Rasm boshqa firma papkasida |
| `ops_occurred_at_range` | 23514 | `b_op_date` (Batch 4) | Sana [now − 3 kun, now + 5 daqiqa] dan tashqarida (admin emas) |
| `ops_usage_days_range` | 22023 | `my_material_usage` (Batch 4) | `p_days` 1..365 dan tashqari yoki null |
| `ops_photo_not_owned` | 42501 | `b_photo_path` (Batch 4) | Rasm yo'q, o'zi yuklamagan yoki 24 soatdan eski |
| `ops_photo_reused` | 23505 | `b_photo_path` (Batch 4) | Rasm boshqa tirik yozuvga biriktirilgan |
| `supplier_duplicate` | 23505 | `b_suppliers_guard` (Batch 5) | Shu nomdagi (norm_name) sotuvchi firmada bor |
| `cash_amount_locked` | P0001 | `b_cash_advances_guard` (Batch 5) | Podotchet summasi / oluvchisi o'zgarmaydi |
| `cash_recipient_role` | P0001 | `b_cash_advances_guard` (Batch 5) | Oluvchi xarid kiritadigan faol xodim emas |
| `purchase_has_receipts` | P0001 | `b_purchases_guard` (Batch 5) | Bog'langan kirimi bor xaridni o'chirish / obyekt-materialini o'zgartirish |
| `estimate_import_forbidden` | 42501 | `import_estimate`, `set_current_estimate` (Batch 7) | Rol admin / buxgalter / super_admin emas |
| `estimate_invalid` | 22023 | `import_estimate` (Batch 7) | `p_id`/`p_object_id` yo'q, nom bo'sh yoki > 200, fayl nomi > 255, `p_items` massiv emas yoki bo'sh |
| `estimate_object_not_found` | P0002 | `import_estimate` (Batch 7) | Obyekt yo'q, o'chirilgan yoki boshqa firmaniki (RLS) |
| `estimate_id_conflict` | 23505 | `import_estimate` (Batch 7) | Shu `p_id` li smeta boshqa obyektga tegishli |
| `estimate_too_many_rows` | 22023 | `import_estimate` (Batch 7) | Qatorlar > 5000 |
| `estimate_item_invalid` | 22023 / 23514 | `import_estimate` (22023, `message`: `Qator <Excel qator raqami>: <sabab>`, `detail`: raqam) · `b_compute_norm` (23514) | Smeta qatori noto'g'ri |
| `estimate_not_found` | P0002 | `set_current_estimate` (Batch 7), `remember_estimate_aliases` (20261105000001) | Smeta yo'q, o'chirilgan yoki boshqa firmaniki |
| `estimate_id_reused` | 23505 | `import_estimate` (Batch 7) | Shu `p_id` boshqa mazmun (hash) bilan ishlatilgan |
| `estimate_direct_edit` | 42501 | `b_estimates_guard`, `b_compute_norm`, `estimate_alert` (Batch 7) | Smeta/qatorni RPC'siz yaratish yoki tahrirlash; obyekt/versiya o'zgarmaydi; begona firma qatori |
| `estimate_restore_conflict` | 23505 | `b_estimates_guard` (Batch 7) | O'chirilgan joriy versiyani tiklash — obyektda boshqa joriy versiya bor |
| `request_purchase_invalid` | 23514 | `b_material_requests_guard` (Batch 8) | `purchase_id` holat `xarid_qilindi` emas yoki xarid boshqa obyekt/materialniki |
| `transfer_direct_edit` | 42501 | `b_transfers_guard` (Batch 8) | O'tkazmani RPC'siz yaratish / o'zgartirish (foydalanuvchi) |
| `transfer_invalid` | 22023 | `create_transfer`, `receive_transfer`, `cancel_transfer` (Batch 8) | Majburiy maydon yo'q, from = to, miqdor ≤ 0 / raqam emas / juda katta, izoh/sabab > 500, material topilmadi |
| `transfer_object_not_found` | P0002 | `create_transfer` (Batch 8) | Obyekt yo'q, o'chirilgan yoki boshqa firmaniki |
| `transfer_forbidden` | 42501 | `create_transfer`, `receive_transfer`, `cancel_transfer` (Batch 8) | Rol / a'zolik / muallif emas |
| `transfer_id_reused` | 23505 | `create_transfer` (Batch 8) | Shu `p_id` boshqa ma'lumot bilan ishlatilgan |
| `transfer_not_found` | P0002 | `receive_transfer`, `cancel_transfer` (Batch 8) | O'tkazma yo'q, o'chirilgan yoki boshqa firmaniki |
| `transfer_not_open` | 55000 | `receive_transfer`, `cancel_transfer` (Batch 8) | Bekor qilingan o'tkazmani qabul qilish / qabul qilinganini bekor qilish |
| `transfer_already_received` | 55000 | `receive_transfer` (Batch 8) | Allaqachon boshqa miqdor bilan qabul qilingan |
| `inventory_apply_direct` | 42501 | `b_inventory_counts_guard` (Batch 8) | `applied_at`/`applied_by` ni to'g'ridan-to'g'ri o'zgartirish |
| `inventory_apply_forbidden` | 42501 | `apply_inventory_adjustments` (Batch 8) | Admin / super_admin emas |
| `inventory_not_submitted` | 55000 | `apply_inventory_adjustments` (Batch 8) | Hisob hali yakunlanmagan (draft) |
| `inventory_already_applied` | 55000 | `apply_inventory_adjustments` (Batch 8) | Qoldiq allaqachon tuzatilgan |
| `inventory_locked` | 42501 | `b_inventory_items_lock` (Batch 8) | Yuborilgan hisob qatorlarini qo'shish / o'zgartirish (hamma uchun, RPC'dan tashqari) |
| `inventory_forbidden` | 42501 | `inventory_candidate_materials` (Batch 8) | Rol tekshiruvchi / admin / super_admin emas |
| `inventory_object_not_found` | P0002 | `inventory_candidate_materials` (Batch 8) | Obyekt yo'q, o'chirilgan yoki boshqa firmaniki |
| `inventory_details_forbidden` | 42501 | `inventory_count_details` (Batch 8) | Rol admin / direktor / buxgalter / super_admin emas |
| `report_period_invalid` | 22023 | `dashboard_summary`, `dashboard_daily`, `spend_breakdown` (Batch 9) | Davr noto'g'ri: `p_from`/`p_to` null, `p_from > p_to` yoki `p_to − p_from > 365` (ko'pi bilan 366 kun, ikkala chegara kiradi) |
| `report_group_invalid` | 22023 | `spend_breakdown` (Batch 9) | `p_group` — `material` / `object` / `buyer` / `supplier` emas (null ham) |
| `estimate_materials_forbidden` | 42501 | `estimate_create_materials` (20261104000001) | Rol admin / super_admin emas |
| `estimate_materials_invalid` | 22023 | `estimate_create_materials` (20261104000001) | `p_items` massiv emas, bo'sh, > 2000 yoki qator xatosi (`message`: `Qator <n>: <sabab>`, n — massivdagi o'rni 1 dan; `detail`: n) |
| `transfer_insufficient_stock` | 22023 | `create_transfer` (Batch 12) | Manba obyektda qoldiq yetarli emas (xabarda mavjud qoldiq) |
| `photo_required` | 23514 | `c_purchases_auto`, `c_movements_auto` (Batch 12) | Chek/kirim rasmi majburiy (summa chegarasi yoki material bayrog'i; QR tasdiqlangan xarid — istisno) |
| `photo_sha256_invalid` | 23514 | `c_purchases_auto`, `c_movements_auto` (Batch 12) | Rasm xeshi SHA-256 hex emas |
| `receipt_already_used` | 23505 | `c_purchases_auto` (Batch 12) | Shu fiskal belgili chek firmada boshqa tirik xaridda (kim, qachon) |
| `purchase_request_invalid` | 23503 / 23514 | `c_purchases_auto` (Batch 12) | So'rov yo'q / o'chirilgan / boshqa firma (23503); boshqa obyekt-material yoki tasdiqlanmagan (23514) |
| `supplier_tin_duplicate` | 23505 | `c_suppliers_tin_guard` (Batch 12) | Shu STIR li sotuvchi firmada bor |
| `receipt_lookup_invalid` | 22023 | `svc_upsert_receipt_lookup` (Batch 12) | Firma yoki fiskal belgi yo'q |
| `alert_action_forbidden` | 42501 | `svc_mark_alert_seen` (Batch 12) | Telegram profili yo'q/nofaol, admin emas yoki boshqa firma |
| `alert_not_found` | P0002 | `svc_mark_alert_seen` (Batch 12) | Alert yo'q yoki o'chirilgan |
| `bug_report_invalid` | 23514 | `b_bug_reports_guard` (Batch 11) | Xatolik xabari matni bo'sh yoki > 2000 belgi |
| `bug_report_rate_limited` | 23514 | `b_bug_reports_guard` (Batch 11) | Bir foydalanuvchi 10 daqiqada 5 tadan ko'p xabar |
| `estimate_aliases_invalid` | 22023 | `remember_estimate_aliases(p_estimate_id, p_items)` (20261105000001) | Smeta chaqiruvchi yuklamagan (buxgalter; admin/super_admin — istalgani) yoki 24 soatdan eski; `p_items` massiv emas / > 5000; qator xatosi (material yo'q / o'chirilgan / boshqa firmaniki / smetada yo'q, `code` yoki `name` smetadagi shu material qatoriga mos emas); qator xatosida `message` = `Qator <n>: <sabab>`, `detail` = n |

`remember_estimate_aliases` qayta ishlatadi: `auth_required`, `estimate_import_forbidden` (rol admin / buxgalter / super_admin emas), `estimate_not_found` (P0002 — smeta yo'q, o'chirilgan yoki boshqa firmaniki). `estimate_create_materials` — `auth_required`. `import_estimate` ning `line_sum` xatolari — `estimate_item_invalid`. 20261104000001 dagi 1-argumentli `remember_estimate_aliases(jsonb)` 20261105000001 da o'chirilgan.

`material_aliases.lang` (20261104000001): `'ru' | 'uz' | 'code'` — `'code'` smetadagi resurs/narx to'plami shifri; unikallik o'zgarmagan (firma bo'yicha `norm_name(alias)`, barcha `lang` birga).

Batch 8 qayta ishlatadi: `auth_required`, `inventory_not_found`, `purchase_not_open` (so'rovga bog'langan xarid yo'q / o'chirilgan), `ops_unit_not_found` / `ops_unit_material_mismatch` (`b_compute_counted`, o'tkazma harakatlari), `catalog_material_*` (o'tkazma, inventarizatsiya).

`b_compute_norm` (smeta qatori) birlik xatolarida `ops_unit_not_found` / `ops_unit_material_mismatch` (23503) ni qayta ishlatadi.

Hint'siz qolganlar (foydalanuvchi ko'rmaydi): RLS rad etishi (42501, PostgreSQL xabari), CHECK/FK/unique cheklovlar (23514/23503/23505 — zaxira), `private.log_auth_event` (faqat service_role, Edge Function ichki xatosi), birinchi migratsiyadagi BYPASSRLS tekshiruvi.

## Kirim, chiqim, rasm (Batch 4 — `20261028000001_ops.sql`)

Shartnoma: `docs/ops-design.md`.

### Storage (`photos` bucket)

- `storage.buckets`: `id = name = 'photos'`, `public = false`, `file_size_limit = 5242880` (5 MB), `allowed_mime_types = {image/jpeg, image/png, image/webp}` (`on conflict (id) do update` — `public = false`, limit va mime qayta qo'yiladi).
- Yo'l: `{company_id}/{yyyy}/{mm}/{uuid}.{ext}`, regex `^[0-9a-f-]{36}/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$` (faqat kichik harf, boshida `/` yo'q).
- `storage.objects` siyosatlari (`to authenticated`):
  - `photos_insert` — `bucket_id = 'photos'`, `(storage.foldername(name))[1] = my_company_id()::text`, yo'l regex'ga mos, rol: `super_admin, admin, prorab, omborchi, haydovchi, taminotchi`. super_admin ham faqat o'z firmasi papkasiga.
  - `photos_select` — `bucket_id = 'photos'` va: super_admin — hammasi; aks holda birinchi papka = `my_company_id()::text` **va** (firma bo'yicha rol (`is_company_wide()`) **yoki** `owner_id = auth.uid()::text` **yoki** rasm foydalanuvchi ko'ra oladigan `movements.photo_path` / `purchases.receipt_photo_path` da (invoker `exists` — RLS amal qiladi)). Natija: prorab/omborchi — a'zo obyektlar va o'zi yuklagani, haydovchi — o'z xaridlari cheki va o'zi yuklagani. `createSignedUrl` shu siyosatga tayanadi. Indekslar: `movements_photo_path_idx`, `purchases_receipt_photo_path_idx` (partial, `is not null`).
  - UPDATE / DELETE siyosati **yo'q** — rasm o'zgarmaydi, o'chirilmaydi. Klient `upsert: true` ishlatmaydi (UPDATE siyosatini talab qiladi).
- `anon` — hech narsa.

### Rasm yo'li trigger'i — `b_photo_path` (`private.tg_ops_photo_path(col)`)

- `movements.photo_path`, `purchases.receipt_photo_path`; `security definer`, `search_path = ''`. Bo'sh satr → `null`.
- INSERT yoki yo'l o'zgarganda: regex (`ops_photo_path_format`), birinchi papka = `company_id::text` (`ops_photo_path_company`) — hamma uchun.
- Shu holatda, foydalanuvchi sessiyasida admin/super_admin bo'lmasa: `storage.objects` da `bucket_id = 'photos'`, `name = yo'l`, `owner_id = auth.uid()::text`, `created_at > now() - 24 soat` bo'lishi shart (`ops_photo_not_owned`, 42501). service_role — tekshirilmaydi.
- Bitta yo'l — bitta tirik yozuv, `movements` va `purchases` bo'ylab (INSERT, yo'l o'zgarishi yoki tiklashda; hamma uchun, admin ham): `ops_photo_reused` (23505). Zaxira — partial unique indekslar `movements_photo_path_key`, `purchases_receipt_photo_path_key` (`deleted_at is null`); jadvallar aro poyga — `pg_advisory_xact_lock(yo'l)`. O'chirilgan yozuvning rasmi bo'shaydi.

### Operatsiya sanasi — `b_op_date` (`private.tg_ops_op_date(col)`)

- `movements.occurred_at`, `purchases.purchased_at`, `inventory_counts.counted_at`.
- INSERT: `null` → `now()`. UPDATE: `null` → eski qiymat.
- `auth.uid()` bor (foydalanuvchi sessiyasi) va rol `admin`/`super_admin` emas: INSERT yoki sana o'zgarganda `now() − 3 kun ≤ sana ≤ now() + 5 daqiqa` (chegaralar kiradi), aks holda `ops_occurred_at_range` (23514). `now()` — tranzaksiya boshlangan vaqt. service_role / cron / migratsiya — cheklovsiz. Domain `occurredAtAllowed` bilan bir xil qoida.
- `cash_advances.issued_at` cheklanmagan (buxgalter/admin yozadi). Batch 5: `null` → `now()` (`b_issued_at`).

### `public.my_material_usage(p_days integer default 30)`

- `returns table (material_id uuid, use_count bigint, last_used_at timestamptz)`.
- Joriy foydalanuvchi (`created_by = my_profile_id()`) oxirgi `p_days` kunda (`created_at` bo'yicha) kiritgan, o'chirilmagan `movements` + `purchases`, material bo'yicha guruhlangan. Tartib: `use_count desc, last_used_at desc, material_id`.
- `p_days` 1..365, aks holda (`null` ham) `ops_usage_days_range` (22023).
- `plpgsql stable security invoker`, `search_path = ''` — RLS amal qiladi. Execute: `authenticated`; `public`, `anon` dan olib tashlangan.
- Indekslar: `movements_created_by_time_idx`, `purchases_created_by_time_idx` (`(created_by, created_at desc) where deleted_at is null`).

### O'z o'chirilgan yozuvlari

- Qo'shimcha SELECT siyosatlari `movements_select_own_deleted`, `purchases_select_own_deleted`: `deleted_at is not null and created_by = my_profile_id() and company_id = my_company_id()` ("Mening yozuvlarim"da "o'chirilgan" belgisi). Faqat o'chirilganlar — tirik qatorlar ko'rinishi o'zgarmaydi (`stock_balances` ga ta'sir yo'q).

## Podotchet, xarid, farq qoidalari (Batch 5 — `20261029000001_purchases.sql`)

Shartnoma: `docs/purchase-design.md`.

### `public.cash_balances` (view, `security_invoker = true`)

- Ustunlar: `company_id uuid`, `profile_id uuid`, `issued_total numeric(18,2)`, `spent_total numeric(18,2)`, `balance numeric(18,2)` (manfiy bo'lishi mumkin), `last_issued_at timestamptz` (null — pul berilmagan), `last_spent_at timestamptz` (null — xarid yo'q).
- `issued` — o'chirilmagan `cash_advances.amount` (`recipient_id`), `spent` — o'chirilmagan `purchases.total_amount` (`buyer_id`). Qator — kamida bitta o'chirilmagan podotchet yoki xaridi bor odam uchun.
- **Ko'rinish.** Ikki manba jadvalning RLS'i har xil (taminotchi barcha xaridlarni, lekin faqat o'z podotchetini ko'radi). Shuning uchun qator faqat `profile_id = my_profile_id()` **yoki** rol `super_admin/admin/direktor/buxgalter` (= `cash_advances_select` sharti; bu rollar purchases'ni ham to'liq ko'radi) **yoki** `current_user in ('service_role', 'postgres')` (bot, cron) bo'lsa chiqadi.
- Grant: `authenticated`, `service_role` — `select`; `anon` — yo'q.

### `cash_advances`

- `b_issued_at`: INSERT'da `issued_at = null` → `now()`, UPDATE'da `null` → eski qiymat. Sana cheklanmaydi.
- `b_cash_advances_guard` (security definer): `amount`, `recipient_id` UPDATE'da o'zgarmaydi — hamma uchun (service_role ham) — P0001 `cash_amount_locked`. INSERT va tiklashda oluvchi shu firmaning o'chirilmagan, `is_active` profili, roli `haydovchi/taminotchi/prorab/admin` — P0001 `cash_recipient_role`. Ruxsatsiz foydalanuvchi (admin/buxgalter/super_admin emas) uchun tekshiruv o'tkazib yuboriladi — RLS 42501 beradi; boshqa firma profili — kompozit FK 23503.

### `suppliers`

- `suppliers_insert`: `super_admin`, `admin` — istalgan maydon; `taminotchi`, `haydovchi`, `prorab` — faqat nom (`phone is null and note is null`). O'z firmasi, `created_by = my_profile_id()`. `suppliers_update` (o'zgartirish, soft delete, tiklash) — admin (o'zgarmadi).
- `suppliers_name_length_check`: `char_length(name) between 1 and 120`.
- Nom dublikati: firma ichida, o'chirilmaganlar orasida, `private.norm_name` bo'yicha — `b_suppliers_guard` (security definer, firma bo'yicha advisory lock) 23505 `supplier_duplicate` (INSERT, qayta nomlash, tiklash). Zaxira — `suppliers_company_name_key` unique indeks.

### `purchases`

- `b_purchases_guard` (before update, security definer): bog'langan, o'chirilmagan kirimi bor xaridni soft delete qilish yoki `object_id` / `material_id` ni o'zgartirish — P0001 `purchase_has_receipts` (hamma uchun). Trigger tartibi: `b_compute_qty` avval ishlaydi — boshqa materialga o'tkazishda birlik ham mos bo'lmasa avval `ops_unit_material_mismatch` chiqadi.
- `b_compute_qty` (create or replace): bog'langan xarid topilmasa / o'chirilgan — 23503 `purchase_not_open` (avval `ops_purchase_not_found`).

### Xarid qabul holati

- `private.purchase_receipt_stats(p_company_id, p_purchase_id)` — `security definer`, `stable`: bog'langan `kirim`, o'chirilmagan harakatlar yig'indisi (`received_qty_base numeric(20,6)`, `receipt_count bigint`, `last_received_at`). Definer — haydovchi harakatlarni ko'rmaydi, lekin o'z xaridi qabulini ko'rishi kerak. Faqat yig'indi, faqat chaqiruvchi firmasi uchun (`auth.uid() is null or can_access_company`). Execute: `authenticated`, `service_role`.
- View `public.purchase_receipts` (`security_invoker = true`): `purchase_id, company_id, object_id, material_id, buyer_id, purchased_at, qty_base, received_qty_base, remaining_qty_base` (= `qty_base − received`, manfiy — ortiqcha), `receipt_count bigint, last_received_at`. Faqat o'chirilmagan xaridlar.
- `public.open_purchases(p_object_id uuid, p_material_id uuid)` — `sql stable security invoker`, `search_path = ''`; execute: `authenticated`, `service_role`. Qaytaradi: `id, purchased_at, buyer_id, buyer_name, qty_base, received_qty_base, remaining_qty_base, unit_input, unit_variant, qty_input`. Shart: `purchased_at >= now() − 14 kun`, `remaining_qty_base > 0`. Tartib: `purchased_at desc, created_at desc, id`.

### alerts

- Yangi enum qiymati `alert_type.yozuv_ochirildi` (`alter type ... add value if not exists`). Migratsiya tranzaksiyasida ishlatilmaydi — faqat plpgsql funksiyalar ichida runtime'da (indeks predikatlari va SQL-funksiyalarda yo'q).
- Yangi ustun `close_note text` (≤ 500, `alerts_close_note_length_check`).
- Ustun grant: `authenticated` — `update (status, close_note)` (jadval darajasidagi UPDATE olib tashlandi). `details`, `deleted_at`, `severity`, bog'lanishlar — 42501. RLS (`alerts_update`) — admin, super_admin.
- `b_alerts_close`: `closed_by` faqat `current_user = 'authenticated'` (foydalanuvchi yopdi) bo'lsa `my_profile_id()`; tizim (security definer funksiya, service_role, cron) yopsa — null.
- Zaxira indekslar: `alerts_open_receipt_key (purchase_id)` — `xarid_qabul_farqi`, ochiq; `alerts_open_price_key (purchase_id)` — `narx_ogishi`, ochiq; `alerts_self_receipt_key (purchase_id, movement_id)` — `ozi_qabul_qilgan`; hammasi `deleted_at is null`. `alerts_company_record_idx (company_id, details->>'record_id')` — o'chirish alertini tiklashda topish.

### Farq qoidalari

Hammasi `private`, `security definer`, `search_path = ''`, execute — hech kimga (`authenticated`, `service_role` ham; triggerlar ichida va cron — egasi `postgres`). Formulalar `src/domain/alerts/*` bilan bit-bit bir xil.

| Funksiya | Nima qiladi |
|---|---|
| `private.evaluate_purchase_receipt(p_purchase_id uuid, p_now timestamptz default now())` | Qoida 1 |
| `private.evaluate_due_purchases(p_now timestamptz default now()) → integer` | Soatlik: 24 soat–60 kunlik barcha xaridlar uchun qoida 1; baholanganlar sonini qaytaradi |
| `private.evaluate_self_receipt(p_movement_id uuid)` | Qoida 2 (bog'langan va evristika) |
| `private.reevaluate_self_for_purchase(p_purchase_id uuid)` | Xarid o'zgarganda qoida 2: bog'langan, belgisi bor va nomzod kirimlar |
| `private.price_check(company, material, price, before_at, before_created, exclude_id) → (avg_n, diff_n, avg_90, diff_90, direction, window_size, threshold_pct)` | Qoida 3 hisobi (stable) |
| `private.evaluate_purchase_price(p_purchase_id uuid)` | Qoida 3 |
| `private.close_purchase_alerts(company, purchase, types alert_type[] \| null, reason text)` | Xaridning ochiq alertlarini avtomatik yopish |

**Avtomatik yopish:** `status = 'yopildi'`, `closed_by = null`, `details.auto_closed = true`, `closed_reason` (`within_threshold` / `purchase_deleted` / `not_applicable` / `restored`), `closed_by_actor = my_profile_id()` (o'zgarishni qilgan foydalanuvchi; cron'da null).

**Qoida 1 — `xarid_qabul_farqi`.** `diff_pct = round(abs(received − purchased) * 100 / purchased, 2)` (`numeric(20,6)`). `diff_pct <= receipt_mismatch_pct` → ok (ochiq alert yopiladi); `received > purchased` → darhol; `received < purchased` → faqat `p_now >= purchased_at + 24 soat` (aks holda "pending": yangi alert yo'q, ochig'i yangilanadi). `severity`: `diff_pct >= 3 × chegara` → `jiddiy`, aks holda `ogohlantirish`. Bitta ochiq alert; raqamlar va bog'lanishlar o'zgarmagan bo'lsa UPDATE qilinmaydi (tarix shovqini yo'q). Admin **qo'lda** yopgan alert bir xil (`purchased_qty_base`, `received_qty_base`) raqamlarda qayta yaratilmaydi. `details`: `purchased_qty_base, received_qty_base, diff_pct, threshold_pct, direction (over/under), receipt_count, evaluated_at`. Xarid qatori `FOR NO KEY UPDATE` bilan qulflanadi.

**Soatlik tekshiruv (Y1).** `pg_cron` (`create extension if not exists pg_cron with schema pg_catalog`), ish `terron-evaluate-purchases`, `7 * * * *`, `select private.evaluate_due_purchases()` — idempotent (bor bo'lsa avval `cron.unschedule`). Nomzodlar: o'chirilmagan, faol (o'chirilmagan) firmadagi, `purchased_at ∈ [p_now − 60 kun, p_now − 24 soat]` xaridlar — **bog'langan kirimi yo'q** bo'lsa ham. O'tkazib yuboriladi: farq chegarada va ochiq alert yo'q; ochiq alert raqamlari o'zgarmagan; admin qo'lda yopgan alert bilan bir xil raqamlar.

**Qoida 2 — `ozi_qabul_qilgan`, `severity = 'belgi'`.** (a) Bog'langan, o'chirilmagan kirim, xarid o'chirilmagan, `movements.created_by = purchases.buyer_id` → `linked = true`. (b) Bog'lanmagan kirim: kiritgan odam xaridor bo'lgan, shu obyekt + material, o'chirilmagan xarid, `|purchased_at − occurred_at| <= 48 soat` → eng yaqin xarid bilan, `linked = false`. Har (xarid, kirim) juftligi uchun bitta. Shart yo'qolsa — ochiq belgi avtomatik yopiladi (`not_applicable`); qaytsa — avtomatik yopilgani qayta `yangi` (qo'lda yopilgani — yo'q); ochiq bo'lsa `details` yangilanadi. `details`: `buyer_id, receiver_id, qty_base, linked`.

**Qoida 3 — `narx_ogishi`, `severity = 'ogohlantirish'`.** "Oldingi": shu firma, shu material, o'chirilmagan, `(purchased_at, created_at)` bo'yicha qat'iy oldin. `avg_n = round(sum(total_amount) / sum(qty_base), 4)` — oxirgi `price_avg_window` tasi (< 2 → null); `avg_90` — xuddi shunday, `purchased_at >= xarid purchased_at − 90 kun` bo'lganlarning hammasi (< 2 → null). `diff_x = round((price_per_base − avg_x) * 100 / avg_x, 2)` (avg null/0 → null). `high`: `diff_n > chegara` yoki `diff_90 > chegara`; aks holda `low`: `diff_n <= −50` yoki `diff_90 <= −50`; aks holda `ok`. `details`: `avg_n, diff_n, avg_90, diff_90, price, direction, window_size, threshold_pct`. Bitta ochiq alert; `ok` bo'lsa avtomatik yopiladi.

**`public.check_purchase_price(p_material_id uuid, p_price_per_base numeric) → text`** — `'ok' | 'high' | 'low'`. `plpgsql stable security definer`, `search_path = ''` (firma bo'yicha butun oyna kerak — prorab/haydovchi boshqalar xaridini ko'rmaydi). Faqat `my_company_id()` va shu firmaning o'chirilmagan materiali (aks holda `'ok'`); "oldingi" = `(purchased_at, created_at) < (now(), infinity)`; narx `round(p, 4)`. O'rtacha yoki foiz qaytarilmaydi (kalibrlashning oldini olish). Execute: faqat `authenticated`.

**Triggerlar** (AFTER, `zz_*` — `z_audit` dan keyin; security definer):

- `purchases.zz_alert_rules_ins` — qoida 3, qoida 2 (nomzod kirimlar).
- `purchases.zz_alert_rules_upd` (`deleted_at`, `qty_base`, `purchased_at`, `total_amount`, `qty_input`, `unit_id`, `material_id`, `object_id`, `buyer_id`): soft delete → barcha ochiq alertlar yopiladi (`purchase_deleted`) + qoida 2; tiklash → 1, 3, 2; `qty_base`/`purchased_at` → 1; narx maydonlari/`purchased_at` → 3; `buyer_id`/`object_id`/`material_id`/`purchased_at` → 2.
- `movements.zz_alert_rules_ins` — `kirim`: bog'langan bo'lsa qoida 1; qoida 2.
- `movements.zz_alert_rules_upd` — eski yoki yangi tur `kirim` va `qty_base`/`purchase_id`/`deleted_at`/`type`/`object_id`/`material_id`/`occurred_at` o'zgarsa: eski va yangi xarid uchun qoida 1 (uuid tartibida), kirim uchun qoida 2.
- `zz_deleted_alert` (`purchases`, `cash_advances`, `movements`; `deleted_at` o'zgarsa): soft delete → `yozuv_ochirildi` alert (`ogohlantirish`; `purchase_id`/`movement_id`, `object_id`, `material_id`; `details`: `table, record_id, actor_profile_id, material_id, object_id` + `amount`/`qty_base`/`recipient_id`/`buyer_id`/`movement_type`/`purchase_id`); tiklash → shu alert avtomatik yopiladi (`restored`). Nomi `zz_alert_rules_upd` dan keyin — xarid o'chirilganda eski alertlar avval yopiladi.

**Aktyor va audit.** Alert `z_audit` orqali tarixga tushadi: `created_by`, `actor_profile_id` — triggerni chaqirgan foydalanuvchi (`auth.uid()` definer ichida ham chaqiruvchiniki), `device` — sarlavhadan. Cron/service_role — null / `tizim`.

### Idempotentlik

- `purchases` va `cash_advances` da `authenticated` jadval darajasida `insert` grantiga ega — klient `id` yuboradi; takror so'rov `23505` (`purchases_pkey` / `cash_advances_pkey`).

## Telegram bildirishnomalari (Batch 6 — `20261030000001_notifications.sql`)

Shartnoma va oqim: `docs/bot-design.md`. Bu yerda — baza tomoni.

### `public.notification_outbox` (tizim jadvali)

- Ustunlar: `id`, `company_id`, `kind` (`alert` | `daily_report`), `alert_id` (FK `(company_id, alert_id) → alerts`), `report_date`, `payload jsonb`, `status` (`pending` | `sending` | `sent` | `failed`), `attempts`, `next_attempt_at`, `last_error` (≤ 1000), `sent_count`, `delivered_chat_ids bigint[]` (yetkazilgan chatlar; `sent_count = cardinality`), `created_at`, `sent_at`, `updated_at` (trigger `b_touch`).
- `check`: `alert` ↔ `alert_id` bor va `report_date` yo'q; `daily_report` ↔ aksincha. Unique: `(alert_id)`, `(company_id, report_date) where kind = 'daily_report'`.
- **Biznes jadval emas — audit istisnosi** (`_fixtures.ts → SYSTEM_TABLES`): `created_by`, `deleted_at`, audit trigger yo'q — yozuvchi faqat security definer funksiyalar (tizim jurnali; foydalanuvchi o'zgartira olmaydi, `audit_log` ni shovqin bilan to'ldirmaydi). Lekin `a_block_delete` / `a_block_truncate` bor, RLS `enable` + `force`.
- Yetkazish — "kamida bir marta" (`docs/bot-design.md`).
- RLS: `select` — `admin`/`super_admin` (o'z firmasi; super_admin — hammasi). Grant: `authenticated`, `service_role` — faqat `select` (yozish — faqat RPC orqali).

### Sozlamalar va sir

- `private.app_settings (key, value)` — `dispatch_url` (sir emas). Hech kimga grant yo'q, RLS yoqilgan.
- `net` sxemasi jadvallari — `revoke all ... from public, anon, authenticated` (navbatdagi so'rov sarlavhasida sir bor).
- Vault: `tg_dispatch_secret` — migratsiyada `vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), ...)` (bo'lmasa). O'qish — `vault.decrypted_secrets` (faqat definer funksiyalar).

### Funksiyalar

| Funksiya | Kim | Vazifa |
|---|---|---|
| `private.wake_dispatch()` | ichki | `net.http_post(dispatch_url, headers {Content-Type, x-dispatch-secret}, body {})`. Tranzaksiyada bir marta (`terron.dispatch_woken`). Har qanday xato — `WARNING`, chaqiruvchi buzilmaydi. |
| `private.wake_dispatch_if_due()` | cron | Navbatda vaqti kelgan `pending` yoki 10 daqiqadan eski `sending` bo'lsagina uyg'otadi. |
| `private.tg_alerts_notify()` | trigger `alerts.zz_notify` (AFTER INSERT) | `deleted_at is null`, `severity <> 'belgi'`, `type <> 'ozi_qabul_qilgan'` → outbox qatori (payload: `alert_id, type, severity, object_name, material_name, base_unit, details, created_at`) + uyg'otish. UPDATE'da trigger yo'q. |
| `private.daily_report_stats(company, period_start, period_end) → jsonb` | ichki | Oraliq `[period_start, period_end)`; `date` — oraliq oxiridagi Toshkent sanasi. Pastda. |
| `private.enqueue_daily_reports(date default bugun Toshkent) → int` | cron | Har faol, o'chirilmagan firma uchun `daily_report` (`on conflict do nothing`), `report_date = date`, payload = stats `[date−1 20:00, date 20:00)` Toshkent. Qo'shilgan bo'lsa — uyg'otish. |
| `public.svc_dispatch_secret() → text` | service_role | Vault siri. |
| `public.svc_claim_notifications(p_limit int default 20)` | service_role | `for update skip locked`; vaqti kelgan `pending` + 10 daqiqadan eski `sending` → `sending`, `attempts + 1`. Eski `sending` va `attempts >= 6` → `failed` (`stuck_in_sending`). Limit 1..100. |
| `public.svc_notification_recipients(p_company_id)` | service_role | `(profile_id, chat_id, role)`: firma faol; profil faol, o'chirilmagan, `direktor`/`admin`, `telegram_chat_id` bor; bitta chat — bir marta. |
| `public.svc_complete_notification(p_id, p_ok, p_delivered bigint[] default '{}', p_error, p_retry_after_sec default null, p_final default false) → text` | service_role | Faqat `sending` qatorga. `p_delivered` har doim `delivered_chat_ids` ga qo'shiladi (takrorsiz). `ok` → `sent`; `p_final` → darhol `failed`; `retry_after` → `pending` (+retry_after s, urinish qaytariladi); `attempts >= 6` → `failed`; aks holda `pending`, `+2^attempts` daqiqa (2, 4, 8, 16, 32). Yangi holatni qaytaradi. |

**`daily_report_stats` maydonlari:** `date` (`YYYY-MM-DD`), `company_name`, `kirim_count` / `chiqim_count` (`movements.occurred_at`), `purchases_count`, `purchases_sum` (`purchases.purchased_at`, `sum(total_amount)::numeric(18,2)::text`, masalan `"3000.50"`), `requests_count` (`material_requests.created_at`; Batch 8 gacha amalda 0), `alerts_new` + `alerts_by_type` (`alerts.created_at`; `belgi`, `ozi_qabul_qilgan` va `yozuv_ochirildi` siz), `self_received_count` (`ozi_qabul_qilgan`), `deleted_count` (`yozuv_ochirildi`), `period_start` / `period_end` (ISO, UTC), `failed_count` (shu firmaning oraliqda `failed` bo'lgan outbox qatorlari, `updated_at` bo'yicha). Hamma joyda `deleted_at is null`. `failed` qatorlarning veb ko'rsatkichi — Batch 9.

### pg_cron

- `terron-dispatch` — `* * * * *` → `select private.wake_dispatch_if_due()`.
- `terron-daily-report` — `0 15 * * *` (20:00 Toshkent) → `select private.enqueue_daily_reports()`.

## Smeta importi (Batch 7 — `20261031000001_estimates.sql`)

Shartnoma va oqim: `docs/estimate-design.md`. Bu yerda — baza tomoni.

### `estimate_items` — yangi ustunlar va trigger

- `unit_id uuid` (nullable; FK `(company_id, unit_id) → material_units (company_id, id)`), `code text` (≤ 100), `row_number integer` (> 0, Excel'dagi qator).
- `estimate_items_kind_check`: `ish` → `material_id`, `unit_id`, `norm_qty_base` null; `material` → uchalasi majburiy. Eski qatorlar uchun `NOT VALID` qo'shilib, buzuvchi qator bo'lmasa migratsiyada `VALIDATE` qilinadi (aks holda warning, faqat yangi/o'zgargan qatorlarda tekshiriladi).
- Trigger `b_compute_norm` (before insert or update, security definer; `b_check_material` dan keyin): `ish` — material/birlik bo'lsa `23514 estimate_item_invalid`, `norm_qty_base := null`. `material` — `materials` → `material_units` `for share` (Batch 1 `b_compute_qty` uslubi), birlik o'chirilmagan (UPDATE'da o'zgarmagan eski birlik — ruxsat) va shu materialniki (`ops_unit_not_found` / `ops_unit_material_mismatch`, 23503); `norm_qty_base := round(qty * factor, 6)` — **klient qiymati e'tiborsiz**, har UPDATE'da qayta hisoblanadi. `unit_id` berilmasa (to'g'ridan-to'g'ri INSERT qulayligi): `unit` matni norm_name bo'yicha variantsiz birlik, matn bo'lmasa — asosiy birlik. `unit` bo'sh bo'lsa — birlik nomi yoziladi (aks holda smetadagi asl matn qoladi).
- `private.unit_is_referenced` endi `estimate_items.unit_id` ni ham hisoblaydi → smetada ishlatilgan birlikning `factor`i o'zgarmaydi (`catalog_unit_in_use`), `norm_qty_base` barqaror.
- `qty > 0` faqat RPC'da tekshiriladi (jadvalda Batch 1 dagi `qty >= 0` qoldi).
- Indekslar: `estimate_items (company_id, unit_id)` (yangi), `estimates (company_id, object_id, is_current)` (yangi); `estimate_items (company_id, estimate_id, sort_order)` va `(company_id, material_id)` — Batch 1 dan.

### `estimate_import_templates`

- Ustunlar: `name` (≤ 120), `header_signature` (≤ 4000), `mapping jsonb` (obyekt), `sheet_name` (≤ 120), `header_row int default 0` (≥ 0, 0 dan boshlanadi), `last_used_at` + standart ustunlar. Unique `(company_id, header_signature) where deleted_at is null` (`estimate_import_templates_signature_key`).
- RLS: ko'rish — firma a'zolari (o'chirilganlarni: super_admin, admin, direktor, buxgalter); qo'shish/o'zgartirish — super_admin, admin, buxgalter. DELETE yo'q. Triggerlar: `a_block_delete`, `a_block_truncate`, `a_before_insert`, `a_before_update`, `z_audit`.
- Upsert: unique indeks qisman (`where deleted_at is null`) — PostgREST `on_conflict` bilan ishlamaydi. Repo avval imzo bo'yicha qidiradi, keyin `update` yoki `insert` (poygada 23505 → qayta o'qish).

### RPC

- `public.import_estimate(p_id uuid, p_object_id uuid, p_title text, p_source_file_name text, p_estimate_date date, p_items jsonb) returns uuid` — `security invoker`, `search_path = ''`, execute — `authenticated`. Tartib: `auth_required` → rol (`estimate_import_forbidden`) → `p_id`/`p_object_id` → obyekt (RLS orqali; `estimate_object_not_found`) → `pg_advisory_xact_lock('terron.estimate_version:' || object_id)` → **idempotentlik** (shu `p_id` bor bo'lsa — o'sha id; boshqa obyektda bo'lsa `estimate_id_conflict`) → nom/fayl nomi/`p_items` → ≤ 5000 → har qator tekshiruvi (birinchi xato qator, `estimate_item_invalid`) → `version = coalesce(max(version), 0) + 1` (shu obyektdagi barcha, o'chirilganlari ham) → eski `is_current = false` → yangi smeta `is_current = true` → qatorlar (`material_id` tartibida — qulf tartibi). Hammasi bitta statement/tranzaksiya: xato bo'lsa hech narsa yozilmaydi.
- `p_items[]`: `{item_type, name, material_id, unit, unit_id, qty, unit_price, code, row_number, sort_order}`. Raqamlar — JSON son yoki satr (`"12.5"`, nuqta bilan; vergul yo'q). Tekshiruv: obyekt; `item_type ∈ {ish, material}`; `name` bo'sh emas (trim, ≤ 1000); `0 < qty < 1e14`; `unit_price` null yoki `0 ≤ narx < 1e16`; `unit` ≤ 50; `code` ≤ 100; `row_number` butun ≥ 1 yoki null; `sort_order` butun yoki null (null → massivdagi tartib 1..n); `ish` — `material_id`, `unit_id` yo'q; `material` — `material_id` (shu firma, o'chirilmagan; nofaol — ruxsat), `unit_id` (o'chirilmagan, shu materialniki). `norm_qty_base` yuborilsa e'tiborsiz.
- `public.set_current_estimate(p_estimate_id uuid) returns void` — invoker, super_admin/admin/buxgalter; o'chirilmagan, ko'rinadigan smeta (`estimate_not_found`); obyekt qulfi, boshqa versiyalar `is_current = false`, bu — `true`. Takror chaqiruv — o'zgarishsiz.
- Qo'shimcha tekshiruvlar: `round(qty, 6) > 0`; material qatorida `round(qty * factor, 6) < 1e14`; `unit_price < 1e16`; `estimate_date` null yoki `2000-01-01 .. bugun (Toshkent) + 1 yil` (aks holda `estimate_invalid`).
- **Idempotentlik (`import_hash`):** `estimates.import_hash text` (64 hex) = `sha256(jsonb_build_object('object_id', p_object_id, 'title', p_title, 'items', p_items)::text)` (`extensions.digest`; jsonb matni kanonik — kalitlar tartiblangan). Shu `p_id` + shu hash → mavjud id; boshqa hash → `23505 estimate_id_reused`; boshqa obyekt → `estimate_id_conflict`.

### Smetani faqat RPC orqali o'zgartirish

- Ikkala RPC ichida `set_config('terron.estimate_rpc', 'on', true)` (oxirida `'off'`); tekshiruv — `private.estimate_rpc_active()`. PostgREST ixtiyoriy SQL'ni va `pg_catalog.set_config` ni ochmaydi — klient bu GUC ni o'rnata olmaydi. `auth.uid()` yo'q (service_role, cron, migratsiya) — tizim, cheklovsiz (o'zgarmas ustunlardan tashqari).
- `estimates` — `b_estimates_guard`: `object_id`, `version`, `import_hash` hech kim uchun o'zgarmaydi (`company_id` — `a_before_update`). Foydalanuvchi RPC'siz: INSERT yo'q; `is_current` ni o'zgartira olmaydi (istisno: tiklash bilan birga `is_current = false`). Ruxsat: `title`, `estimate_date`, `source_file_name`, soft delete (tiklash — admin). O'chirilgan `is_current` versiyani to'g'ridan-to'g'ri UPDATE bilan tiklash, obyektda boshqa joriy versiya bo'lsa — `23505 estimate_restore_conflict` (yechim: `deleted_at = null, is_current = false`; Batch 10 `restore_record` buni o'zi qiladi). Eslatma: RPC'lar eski joriylikni o'chirilgan qatorlardan ham olib tashlaydi, shuning uchun to'qnashuv amalda faqat tizim yozuvlarida chiqadi.
- `estimate_items` — `b_compute_norm` boshida: foydalanuvchi va super_admin emas, `company_id ≠ my_company_id()` → rad (RLS'dan oldin, RPC ichida ham); RPC'siz INSERT yo'q; RPC'siz UPDATE'da faqat `deleted_at` (va `updated_at`) o'zgaradi. Hammasi `42501 estimate_direct_edit`.
- Natija (rol matritsasi): `estimates`, `estimate_items` ga to'g'ridan-to'g'ri INSERT — hech kimga (faqat RPC); UPDATE (soft delete) — admin, buxgalter.

### `smeta_ozgarishi` alertlari

- `alert_type` ga `smeta_ozgarishi` (faqat plpgsql ichida ishlatiladi). Firma sozlamasi `companies.estimate_increase_pct numeric(6,2) default 10` (≥ 0).
- `private.estimate_alert(kind, estimate_id, prev_id)` — security definer; `norm_increase` va `old_version_restored` faqat RPC ichida (GUC; aks holda `estimate_direct_edit`). Execute — `authenticated` (invoker RPC chaqiradi).
- `norm_increase` (`import_estimate`, avvalgi o'chirilmagan joriy versiya bo'lsa): material bo'yicha `before = Σ norm_qty_base` (avvalgi), `after` (yangi), o'chirilmagan qatorlar. Belgilanadi: `before = 0` (yangi material) yoki `after > before × (1 + pct/100)` (10% → 10% aynan — yo'q, 11% — bor). `consumed` — shu obyekt va materialdagi o'chirilmagan `chiqim` `qty_base` yig'indisi; `exceeded_before = consumed > before`. Har versiya uchun bitta alert, `severity` — biror material `exceeded_before` bo'lsa `jiddiy`, aks holda `ogohlantirish`. Tartib: `exceeded_before` desc, `diff_pct` desc (yangi material — birinchi), oshish hajmi desc; 20 tagacha, qolgani — `more_count`.
- `old_version_restored` (`set_current_estimate`): yangi joriy versiya raqami avvalgi joriydan kichik bo'lsa, `ogohlantirish`.
- `current_deleted` — trigger `zz_estimate_alerts` (after update): joriy versiya soft delete qilinsa, `ogohlantirish`.
- `details` shakli:
  - `{kind: 'norm_increase', estimate_id, version, prev_version, materials: [{material_id, material_name, base_unit, before, after, diff_pct (2 xona; yangi materialda null), consumed, exceeded_before}], more_count, actor_name}`
  - `{kind: 'old_version_restored', estimate_id, version, prev_version, actor_name}`
  - `{kind: 'current_deleted', estimate_id, version, actor_name}`
  - `object_id` — alert ustunida, `material_id` — null.
- Telegram: Batch 6 `zz_notify` (`severity <> 'belgi' and type <> 'ozi_qabul_qilgan'`) bu turni o'zgartirishsiz qamraydi — outbox payload `object_name` bilan, `material_name = null`. Bot matn shabloni (Edge Function) `smeta_ozgarishi` uchun qo'shilishi kerak.

### `public.estimate_totals` (view, `security_invoker = true`)

- `estimate_id, company_id, object_id, row_count, material_count, total_sum` (`Σ round(qty * unit_price, 2)`, narxsiz qator — 0), faqat o'chirilmagan qatorlar. Grant: `authenticated`, `service_role` — `select`.
- **20261105000001:** `total_sum = Σ coalesce(line_sum, round(qty * unit_price, 2))` — `estimate_items.line_sum numeric(18,2)` (nullable, `>= 0`) fayldagi aniq qator summasi (agregatsiya qilingan qatorlar). `line_sum` yo'q qator — avvalgidek. Bu — bazadagi yagona smeta summasi hisobi (hisobotlar, norma, `smeta_ozgarishi` — narxsiz). `import_estimate` ixtiyoriy `line_sum` qabul qiladi (son/satr, ≥ 0, 2 xona, < 1e16; xato — `estimate_item_invalid`); `import_hash` ga `p_items` orqali kiradi. Tafsilot — `docs/estimate-design.md`.

## So'rovlar, o'tkazmalar, inventarizatsiya, norma (Batch 8 — `20261101000001_requests.sql`)

Shartnoma: `docs/requests-design.md`. Bu yerda — baza tomoni.

### Norma — `private.norm_numbers`, `public.norm_usage`

- `private.norm_numbers(company, object, material) → (o_estimate_id, o_estimate_version, o_norm_qty_base, o_waste_pct, o_allowed_qty_base, o_consumed_qty_base, o_base_unit)` — security definer, stable; qoida 4 va 6 uchun yagona hisob. Execute — hech kimga.
- View `public.norm_usage` (`security_invoker`): `company_id, object_id, material_id, estimate_id, norm_qty_base, allowed_qty_base, consumed_qty_base, requested_open_qty_base, remaining_qty_base, usage_pct`. Joriy (o'chirilmagan) smetali obyektlar; materiallar = smetadagi (o'chirilmagan `material` qatorlari) ∪ chiqimi bor. Grant: `authenticated`, `service_role` — `select`. RLS manbalari: `estimates` (prorab — a'zo obyektlar; omborchi/haydovchi — hech narsa), `movements`, `material_requests`, `materials`.
- **Formulalar va cast'lar** (domain bilan bit-bit): `norm = Σ norm_qty_base ::numeric(20,6)`; `allowed = round(norm * (1 + m.waste_pct / 100), 6)` (`waste_pct` — `numeric(6,2)`, `100` — butun literal); `consumed = Σ chiqim qty_base ::numeric(20,6)`; `requested_open = Σ qty_base (kutilmoqda, tasdiqlandi) ::numeric(20,6)`; `remaining = (allowed − consumed)::numeric(20,6)`; `usage_pct = round(consumed * 100 / allowed, 1)` (`allowed = 0` → null). `over_pct = round((consumed::numeric(20,6) − allowed::numeric(20,6)) * 100 / allowed::numeric(20,6), 2)`.
- Indekslar: `estimate_items_norm_idx (company_id, estimate_id, material_id) where item_type = 'material' and deleted_at is null`; `movements_chiqim_idx (company_id, object_id, material_id) where type = 'chiqim' and deleted_at is null`; `material_requests_open_idx (company_id, object_id, material_id) where status in (kutilmoqda, tasdiqlandi) and deleted_at is null`.

### Qoida 4 — `normadan_oshish` (`private.evaluate_norm(company, object, material)`)

- (obyekt, material) bo'yicha `pg_advisory_xact_lock`. Joriy smeta yo'q → ochiq alertlar yopiladi (`no_current_estimate`). Boshqa smeta uchun ochiq alert → `estimate_changed`.
- `norm = 0` yoki `allowed = 0`: sarf > 0 → `not_in_estimate` (ogohlantirish), aks holda ok. `consumed > allowed` → over (`over_pct ≥ 25` → jiddiy). Ok → ochiq alert yopiladi (`within_threshold`).
- Bitta ochiq alert (obyekt, material) — zaxira unique `alerts_open_norm_key (object_id, material_id)`. `severity` va `details` o'zgarmasa — UPDATE yo'q. Admin qo'lda yopgan alert bir xil (`estimate_id`, `allowed`, `consumed`) da qayta yaratilmaydi; boshqa sonlarda — yangi alert (yangi Telegram xabar).
- `details`: `{norm_qty_base, allowed_qty_base, consumed_qty_base, over_pct (null — not_in_estimate), waste_pct, estimate_id, estimate_version, not_in_estimate, base_unit}`; avtomatik yopishda + `auto_closed, closed_reason, closed_by_actor`.
- Chaqiriladi: `movements.zz_norm_rules_ins` (chiqim INSERT), `zz_norm_rules_upd` (eski yoki yangi tur chiqim; `qty_base`/`deleted_at`/`type`/`object_id`/`material_id` — eski va yangi juftlik); `estimates.zz_norm_rules` (joriy versiya soft delete / tiklash → obyekt); `estimate_items.zz_norm_rules` (joriy smetadagi material qatori soft delete / tiklash); `import_estimate`, `set_current_estimate` (create or replace — Batch 7 mantiqi o'zgarmagan, oxirida `private.evaluate_object_norms`).
- `private.evaluate_object_norms(company, object)` — joriy smeta materiallari ∪ chiqim materiallari ∪ ochiq alert materiallari, material id tartibida. Execute — `authenticated` (invoker smeta RPC'lari chaqiradi); foydalanuvchi sessiyasida faqat o'z firmasi (`estimate_direct_edit`).
- `materials.waste_pct` o'zgarishi alertlarni darhol qayta baholamaydi — keyingi chiqim/smeta o'zgarishida.

### Qoida 6 — `smetadan_ortiq_sorov` (`private.evaluate_request(request_id)`)

- `available = allowed − consumed − other_open` (`other_open` — shu obyekt+materialdagi boshqa kutilmoqda/tasdiqlandi so'rovlar `Σ qty_base ::numeric(20,6)`); over: `requested > available`; `over_qty = requested − available`. Obyektda **joriy smeta umuman yo'q** → alert yaratilmaydi (ochig'i `no_current_estimate` bilan yopiladi; qoida 4 ham smetasiz obyektda alert bermaydi). Joriy smeta bor, material unda yo'q → `not_in_estimate = true` (allowed = 0 → har doim alert).
- `details`: `{requested_qty_base, allowed_qty_base, consumed_qty_base, other_open_qty_base, available_qty_base, over_qty_base, estimate_version, not_in_estimate, base_unit}`; `severity = ogohlantirish`; `request_id`, `object_id`, `material_id` ustunlarda. Zaxira unique `alerts_open_request_key (request_id)`.
- Triggerlar `material_requests.zz_alert_rules_ins` / `zz_alert_rules_upd`: INSERT; `qty_base`/`object_id`/`material_id` o'zgarishi, tiklash, `rad` dan qaytarish → qayta baholash; `rad` → yopiladi (`request_rejected`), soft delete → `request_deleted`; kam bo'lsa → `within_threshold`. `tasdiqlandi`/`xarid_qilindi` ga o'tish alertga tegmaydi.

### `material_requests`

- Yangi: `decision_note text` (≤ 500), `purchase_id uuid` — FK `(company_id, purchase_id) → purchases`, indeks `material_requests_company_purchase_idx` (partial), check `purchase_id is null or status = 'xarid_qilindi'`.
- `b_material_requests_guard` (endi security definer): admin bo'lmagan — `status`, `note` (+ `purchase_id`, agar yangi holat `xarid_qilindi`); `decision_note` — faqat admin (INSERT'da boshqalar uchun null). `purchase_id` (INSERT yoki bog'lanish/obyekt/material/holat o'zgarsa, hamma uchun): holat `xarid_qilindi` emas → `request_purchase_invalid`; xarid yo'q/o'chirilgan → `purchase_not_open`; boshqa obyekt/material → `request_purchase_invalid`.

### O'tkazmalar

- Yangi ustunlar: `received_qty_base numeric(20,6)` (≥ 0), `received_at`, `received_by` (FK `(company_id, received_by) → profiles`; super_admin boshqa firmada — null), `cancel_reason` (≤ 500). Indekslar: `transfers_company_received_by_idx`, `transfers_open_to_idx (company_id, to_object_id) where status = 'yuborildi' and deleted_at is null`.
- `b_transfers_guard` (before insert/update, security definer): `auth.uid()` bor va `private.transfer_rpc_active()` (GUC `terron.transfer_rpc`, Batch 7 uslubi) emas → `42501 transfer_direct_edit`. Tizim (service_role, migratsiya) — cheklovsiz. Natija: rol matritsasida `transfers` INSERT/UPDATE — hech kimga (faqat RPC). `transfer_*` harakatlarni to'g'ridan-to'g'ri yaratish (admin, Batch 1) o'zgarmadi.
- RPC'lar (`security definer`, `search_path = ''`, execute — `authenticated`):
  - `public.create_transfer(p_id uuid, p_from_object_id uuid, p_to_object_id uuid, p_material_id uuid, p_unit_id uuid, p_qty_input numeric, p_note text default null) → uuid`. Tartib: auth → maydonlar/miqdor (`0 < round(q,6)`, `< 1e14`)/izoh → `from` obyekt (firma, o'chirilmagan) va `to` (shu firma) → rol (admin/super_admin yoki prorab + `from` a'zo) → material shu firmada → `p_id` advisory lock, idempotentlik (bir xil firma/from/to/material/unit/qty → shu id, aks holda `transfer_id_reused`) → `transfers` (yuborildi) + `transfer_out` harakati (shu birlik va miqdor; `b_compute_qty`).
  - `public.receive_transfer(p_transfer_id uuid, p_qty_received_input text default null, p_note text default null) → void`. Miqdor — o'tkazma birligida, matn (`^\s*[+]?(\d+(\.\d*)?|\.\d+)\s*$`, 6 xona); null/bo'sh → yuborilgan. Rol: admin/super_admin yoki prorab/omborchi + `to` a'zo. Qator `for update`. Allaqachon qabul qilingan: miqdorsiz yoki shu `qty_base` → o'zgarishsiz; boshqa → `transfer_already_received`. `bekor` → `transfer_not_open`. Miqdor > 0 → `transfer_in` (izoh harakatda); 0 → harakatsiz. Holat `qabul_qilindi`, `received_*`. Farq ≠ 0 → alert `otkazma_farqi` (`ogohlantirish`, kam ham, ko'p ham; `object_id = to`, `material_id`, `movement_id = transfer_in`): `details {transfer_id, sent_qty_base, received_qty_base, diff_qty_base (received − sent), direction (under/over), base_unit, from_object_name, to_object_name}`.
  - `public.transfer_target_objects() → table(id uuid, name text)` — "qayerga" ro'yxati: chaqiruvchi firmasining `status = 'faol'`, o'chirilmagan obyektlari (faqat id, nom; nom tartibida). `stable security definer`; faqat admin, super_admin, prorab — boshqalar `42501 transfer_forbidden`; anon — yo'q.
  - `public.cancel_transfer(p_transfer_id uuid, p_reason text default null) → void`. Yaratgan odam (`created_by`) yoki admin; `bekor` → o'zgarishsiz; `qabul_qilindi` → `transfer_not_open`. `transfer_out` soft delete (RPC ichida — `yozuv_ochirildi` alerti yaratilmaydi: `tg_soft_delete_alert` create or replace), holat `bekor`, `cancel_reason`.
- Telegram: `zz_notify` sharti (`severity <> 'belgi' and type <> 'ozi_qabul_qilgan'`) `otkazma_farqi` ni o'zgarishsiz qamraydi; payload `object_name` (qabul obyekti), `material_name`, `base_unit`. Bot matn shabloni (Edge Function) `otkazma_farqi` uchun qo'shilishi kerak.

### Inventarizatsiya

- `inventory_count_items`: `qty_input numeric(20,6)` (≥ 0), `unit_id` (FK `(company_id, unit_id) → material_units`, indeks), check `(unit_id is null) = (qty_input is null)` (eski qatorlar — ikkalasi null). Unique `(inventory_count_id, material_id)` o'chirilmaganlar orasida — Batch 1 dan.
- `b_compute_counted` (security definer, materials → material_units `for share`): `qty_counted := round(qty_input * factor, 6)`, klient qiymati e'tiborsiz. INSERT: `unit_id` yo'q → asosiy birlik; `qty_input` ham yo'q → `qty_input := qty_counted` (eski klient). UPDATE: ikkalasi null → `qty_counted` eski qiymat. Birlik xatolari — `ops_unit_*`. `private.unit_is_referenced` endi `inventory_count_items.unit_id` ni ham hisoblaydi.
- `inventory_counts`: `applied_at`, `applied_by` (FK profiles). `b_inventory_counts_guard` (+ yangi `b_inventory_counts_guard_ins`): `authenticated` INSERT'da `applied_*` → null; UPDATE'da o'zgartirsa → `inventory_apply_direct`.
- **Qoida 5** — `submit_inventory_count` (create or replace) oxirida: `qty_counted < qty_expected` qatorlar; `price_per_base = round(Σ total_amount / Σ qty_base, 4)::numeric(18,4)` (shu material, o'chirilmagan, `purchased_at ≥ now() − 90 kun`; yo'q → null); `expected`, `counted`, `shortage` — `::numeric(20,6)`; `shortage_value = round(shortage * price_per_base, 2)`; `total = Σ shortage_value` (hammasi null → null); `total ≥ 1 000 000` → `jiddiy`. Bitta alert (`object_id`, `inventory_count_id`; `material_id` null), zaxira unique `alerts_inventory_shortage_key`. `details {count_id, items: [{material_id, material_name, base_unit, expected, counted, shortage, shortage_value}] (20 tagacha, shortage desc, material_id), total_shortage_value, more_count}`. Ortiqcha — alertda yo'q.
- `public.apply_inventory_adjustments(p_count_id uuid) → integer` (security definer; execute — `authenticated`): auth → hisob (`inventory_not_found`) → admin/super_admin (`inventory_apply_forbidden`) → `applied_at` bor → `inventory_already_applied` → holat `submitted` emas → `inventory_not_submitted`. Har `qty_counted ≠ qty_expected` (expected null — o'tkazib yuboriladi) qator uchun `inventory_adjust` harakati: asosiy birlik, `qty_input = counted − expected`, `inventory_count_id`, material id tartibida. `applied_at`, `applied_by`. Qaytaradi — harakatlar soni.

### Review tuzatishlari (Batch 8, shu migratsiyada)

- **Y1 — ko'r-ko'rona sanash.** `private.is_company_wide_ops()` = `is_company_wide()` minus `tekshiruvchi`. `movements_select`, `purchases_select` (drop + create) shu funksiyadan foydalanadi → tekshiruvchi `movements`, `purchases`, `stock_balances`, `purchase_receipts`, `norm_usage` (view'da qo'shimcha `not has_role('tekshiruvchi')`) da hech narsa ko'rmaydi. `public.inventory_candidate_materials(p_object_id uuid) → table(material_id uuid)` (definer, stable; tekshiruvchi / admin / super_admin; o'z firmasi): obyektda qoldig'i ≠ 0 yoki joriy smetada bor (o'chirilmagan) materiallar, miqdorsiz.
- **O5 — `qty_expected` yashirin.** `inventory_count_items` SELECT — ustun grant (`qty_expected`, `price_per_base` siz). Yangi `price_per_base numeric(18,4)` — yuborish paytidagi 90 kunlik narx (`private.inventory_price`). `b_inventory_items_guard` ikkalasini authenticated yozuvidan himoyalaydi. `public.inventory_count_details(p_count_id uuid) → table(material_id uuid, material_name text, base_unit text, qty_input text, unit_id uuid, qty_counted text, qty_expected text, diff text, shortage_value text)` — admin / direktor / buxgalter / super_admin; raqamlar `text`; `diff = (counted − expected)::numeric(20,6)`; `shortage_value = round((expected − counted)::numeric(20,6) * price_per_base, 2)` (alert bilan aynan; faqat kamomadda).
- **`submit_inventory_count` → `jsonb`** (drop + create): `{has_shortage: boolean, not_counted_count: int}` — raqamsiz. `not_counted_count` — qoldig'i ≠ 0, lekin qatori yo'q materiallar.
- **Y2 — sanalmagan materiallar** (qoldiq > 0, qatori yo'q) kamomad alertiga: `details.not_counted: [{material_id, material_name, base_unit, expected, shortage_value}]` (20 tagacha, expected desc), `not_counted_more`; `total_shortage_value` ularni ham qo'shadi. Alert `details`: `{count_id, items, more_count, not_counted, not_counted_more, total_shortage_value}` (+ P5: tuzatilgandan keyin `applied_at`, `applied_by_name`; alert yopilmaydi).
- **O4.** `b_inventory_items_lock`: hisob `status <> 'draft'` bo'lsa qator INSERT/UPDATE (soft delete ham) — hamma uchun (service_role, superuser ham) `42501 inventory_locked`; faqat inventarizatsiya RPC'lari ichida (GUC `terron.inventory_rpc`).
- **Y3 — qabul qilinmagan o'tkazma.** `companies.transfer_receive_hours int default 48` (1..8760). `private.evaluate_due_transfers(p_now timestamptz default now()) → int` — `yuborildi` holatida `created_at + soat ≤ p_now` bo'lgan har o'tkazma uchun **bitta** `otkazma_farqi` (`ogohlantirish`, `object_id = to`): `details {transfer_id, direction: 'not_received', sent_qty_base, base_unit, from_object_name, to_object_name, sent_at, hours}` (hours — o'tgan butun soat). Qator `for update` qulfi (receive/cancel bilan poygasiz). Qabul → `closed_reason = 'transfer_received'`, bekor → `'transfer_cancelled'` (`private.close_transfer_alerts`). Cron `terron-evaluate-transfers` — `17 * * * *`. Indeks `alerts_company_transfer_idx (company_id, details->>'transfer_id') where details ? 'transfer_id'`. `create_transfer`: `to` obyekt `status = 'faol'` bo'lishi shart (`transfer_object_not_found`).
- **Y4.** `receive_transfer`: qabul qiluvchi = yaratuvchi → `ozi_qabul_qilgan` (`belgi`, Telegram'ga yo'q), `movement_id = transfer_in`, `details {transfer_id, qty_base, buyer_id: null, receiver_id, kind: 'transfer'}`.
- **Y5 — qoida 6.** `norm_numbers.o_delivered_qty_base` va `norm_usage.delivered_qty_base` = Σ (`kirim` + `transfer_in` − `transfer_out`), o'chirilmagan, shu obyekt, `::numeric(20,6)`. Formula: `available = allowed::numeric(20,6) − greatest(consumed::numeric(20,6), delivered::numeric(20,6)) − other_open::numeric(20,6)`. `remaining_qty_base` o'zgarmadi (`allowed − consumed`). Alert `details` ga `delivered_qty_base`.
- **O7.** `evaluate_request` boshida `pg_advisory_xact_lock(hashtext('terron.request:' || object_id || ':' || material_id))`.
- **O1 — kuchayish.** `notification_outbox.escalation int not null default 0`; unique `notification_outbox_alert_key` → `(alert_id, escalation) where alert_id is not null`; `tg_alerts_notify` (create or replace) yangi conflict maqsadi bilan. Qoida 4 ochiq alerti yangilanganda daraja (`private.norm_escalation_level`: over_pct ≥ 100 → 3, ≥ 50 → 2, `jiddiy` → 1) oshsa — `private.enqueue_alert_escalation(alert_id, level)`: outbox qatori (`escalation = level`, payload = asosiy shakl + `escalation`, joriy `details`, `created_at = now()`), har daraja bir marta, dispatch uyg'otiladi. `tg-dispatch` payload'ni o'zgarishsiz uzatadi (`AlertPayload.escalation`).
- **O2.** `b_material_requests_guard`: admin bo'lmagan (taminotchi) — faqat `tasdiqlandi → xarid_qilindi`; tasdiqlash / rad etish — faqat admin.
- **O3.** `daily_report_stats` (create or replace) + `transfers_pending_count` (hozir `yuborildi`), `chiqim_without_estimate_count` (oraliqdagi chiqimlar, obyektida joriy smeta yo'q).
- **P4.** `materials.zz_waste_alert` (after update of `waste_pct`, qiymat o'zgarsa): `smeta_ozgarishi`, `ogohlantirish`, `object_id` null, `material_id`; `details {kind: 'waste_changed', material_id, material_name, before, after, actor_name}`.
- **P9.** `cancel_transfer`: admin bo'lmagan yaratuvchi hali `from` obyekt a'zosi bo'lishi shart.
- **Avtomatik yopish sabablari** (frontend tarjima qiladi): `within_threshold`, `estimate_changed`, `no_current_estimate`, `request_rejected`, `request_deleted`, `purchase_deleted`, `not_applicable`, `restored`, `transfer_received`, `transfer_cancelled`.

## Hisobotlar (Batch 9 — `20261102000001_reports.sql`)

Shartnoma: `docs/reports-design.md` → "RPC'lar". Hammasi `security invoker` (RLS chaqiruvchi huquqida), `stable`, `search_path = ''`; execute — faqat `authenticated` (`public`, `anon` dan olingan).

### Umumiy qoidalar

- **Firma:** doim chaqiruvchining o'z firmasi (`private.my_company_id()`), super_admin ham (o'z firmasi). RLS qo'shimcha toraytiradi. Aniq `company_id = …` sharti `(company_id, vaqt)` indekslarini ishlatadi (RLS'dagi `is_super_admin() or …` OR-sharti indeksga tushmaydi). Profil yo'q / nofaol → hamma ko'rsatkich nol.
- **Davr:** Toshkent kunlari, `[p_from::timestamp at time zone 'Asia/Tashkent', (p_to + 1)::timestamp at time zone 'Asia/Tashkent')` — `private.report_period(p_from, p_to)`. `p_from`/`p_to` null, `p_from > p_to`, `p_to − p_from > 365` (ko'pi bilan 366 kun, ikkala chegara kiradi) → `22023 report_period_invalid`.
- **Obyekt filtri:** `private.report_company(p_object_id)` — obyekt chaqiruvchiga RLS bo'yicha ko'rinmasa (prorab a'zo emas, boshqa firma, mavjud emas) → `null` → natija nol / bo'sh (xato emas — mavjudligi sizmaydi).
- **O'chirilganlar:** har jadvalda `deleted_at is null` aniq (admin/direktor RLS bo'yicha o'chirilganlarni ham ko'radi — hisobotga kirmaydi).
- **Ogohlantirishlar:** `severity = 'belgi'` (masalan `ozi_qabul_qilgan`) hisoblanmaydi. Ochiq = `status in ('yangi','korildi')`. Alerts RLS — faqat admin/direktor/buxgalter/super_admin; qolganlarga alert ko'rsatkichlari 0.
- Pul va miqdor — `text` (`numeric(18,2)` / `numeric(20,6)` aniq qiymati).

### `public.dashboard_summary(p_from date, p_to date, p_object_id uuid default null) → jsonb`

| Kalit | Turi | Hisob |
|---|---|---|
| `kirim_count`, `chiqim_count` | int | davrdagi `movements` (`occurred_at`) |
| `purchases_count`, `purchases_sum` | int, text | davrdagi `purchases` (`purchased_at`), Σ `total_amount` |
| `cash_issued_sum` | text | davrdagi `cash_advances` (`issued_at`); obyekt filtriga qaramaydi |
| `cash_on_hand_total` | text | Σ `cash_balances.balance` (RLS ko'rgan qatorlar); joriy holat, obyektsiz |
| `alerts_open`, `alerts_serious_open` | int | ochiq; jiddiylari (`severity = 'jiddiy'`); joriy holat |
| `alerts_new_in_period` | int | davrda yaratilgan (`created_at`, istalgan status) |
| `unreceived_purchases_count` | int | `purchases` (RLS): `now() − 90 kun ≤ purchased_at < now() − 24 soat` va `not private.purchase_has_receipt(company_id, id)`; joriy holat |
| `pending_transfers_count` | int | `transfers.status = 'yuborildi'` (filtr: `from` yoki `to` obyekt) |
| `pending_requests_count` | int | `material_requests.status = 'kutilmoqda'` |
| `objects_over_norm_count` | int | `norm_usage` (RLS) bo'yicha `consumed_qty_base > allowed_qty_base` materiali bor (o'chirilmagan) obyektlar soni — smetada yo'q, lekin sarfi bor (norm = 0) ham; prorab — a'zo obyektlari, tekshiruvchi/omborchi/haydovchi — 0 |

Obyekt filtri obyektga bog'langan ko'rsatkichlarga (alerts — `object_id = p_object_id`).

### `public.dashboard_daily(p_from, p_to, p_object_id default null)`

`returns table (day date, kirim_count int, chiqim_count int, purchases_sum text, alerts_count int)` — `p_from..p_to` har kuni (bo'sh kunlar nol bilan, ≤ 366 qator), kun — `(ts at time zone 'Asia/Tashkent')::date`. `alerts_count` — shu kuni yaratilgan (belgi'siz). Ko'rinmaydigan obyekt — kunlar nol bilan.

### `public.spend_breakdown(p_from, p_to, p_object_id default null, p_group text default 'material')`

`returns table (key uuid, label text, purchases_sum text, purchases_count int)` — davrdagi xaridlar `material_id` / `object_id` / `buyer_id` / `supplier_id` bo'yicha; tartib `purchases_sum desc, purchases_count desc, key nulls last`. `label` — `materials.name` / `objects.name` / `profiles.full_name` / `suppliers.name` (RLS ko'rmasa — null). Sotuvchisiz xaridlar — `key = null, label = null`. Noto'g'ri `p_group` → `22023 report_group_invalid`.

### `public.norm_overview(p_object_id uuid default null)`

`returns table (object_id uuid, object_name text, material_id uuid, material_name text, base_unit text, norm_qty_base text, allowed_qty_base text, consumed_qty_base text, usage_pct text)` — `norm_usage` + nomlar; o'chirilgan obyektlar chiqmaydi; `usage_pct` null — ruxsat 0. Tartib: `object_name, material_name`. Tekshiruvchi, omborchi, haydovchi — bo'sh; prorab — a'zo obyektlar.

### Indekslar (partial, `deleted_at is null`)

`movements_company_occurred_idx (company_id, occurred_at)`, `purchases_company_purchased_idx (company_id, purchased_at)`, `purchases_company_object_purchased_idx (company_id, object_id, purchased_at)`, `alerts_company_created_idx (company_id, created_at)`, `cash_advances_company_issued_idx (company_id, issued_at)`. Obyekt + vaqt harakatlar uchun mavjud `movements_company_object_time_idx`. EXPLAIN (PGlite, 2 firma × 6000 harakat / 2000 xarid, 250 kun): davr so'rovlari shu indekslardan bitmap scan.

**`private.purchase_has_receipt(p_company_id uuid, p_purchase_id uuid) → boolean`** — `security definer`, `stable`, `search_path = ''`; xaridga bog'langan o'chirilmagan `kirim` bormi (`movements_company_purchase_idx`). Faqat chaqiruvchi firmasi (`my_company_id()`, super_admin — istalgan), aks holda `null`. Faqat boolean — miqdor sizmaydi; haydovchi harakatlarni ko'rmasa ham o'z xaridining qabul holatini to'g'ri ko'radi. Execute — faqat `authenticated`.

## Tarix va tiklash (Batch 10 — `20261103000001_history.sql`)

To'liq shartnoma va yorliq formatlari: `docs/history-design.md` → "Baza".

- `public.audit_feed(p_from, p_to, p_table, p_action, p_actor, p_device, p_record_id, p_before_id bigint, p_limit int default 50)` — `audit_log` (RLS: admin/direktor — o'z firmasi, super_admin — hammasi, qolganlar — 0), keyset `id < p_before_id`, `order by id desc`, `p_limit` 1..200, davr `private.report_period` (≤ 366 kun).
- `public.deleted_records(p_from, p_to, p_table default null, p_limit default 100, p_offset default 0)` — oq ro'yxatdagi jadvallarning o'chirilgan qatorlari (`union all`, RLS), faqat admin/direktor/super_admin; `deleted_by_name` — oxirgi `SOFT_DELETE` aktyori. O'tkazma harakatlari chiqmaydi.
- `public.restore_record(p_table, p_id) → void` — `volatile`; rol tekshiruvi → oq ro'yxat → `execute format('update public.%I set deleted_at = null where id = $1 and deleted_at is not null', p_table) using p_id` → `get diagnostics`. Batch 1/3/7/8 triggerlari (tiklash faqat admin, nom/alias/birlik to'qnashuvi, alias kaskadi, smeta joriyligi, inventarizatsiya qulfi) o'zgarmagan va o'z hint'ini beradi.
- `private.audit_record_label(table, record_id, new_data, old_data)` — invoker; faqat yozuvning o'z qiymatlari + RLS bo'yicha nomlar (material, obyekt, profil, sotuvchi), join'lar `company_id` bilan; boshqa firma — `null`. Yordamchilar `private.history_tables()`, `history_num(numeric)`, `history_money(numeric)`. Execute — `authenticated` (invoker zanjiri).
- **Oq ro'yxat** (16): `profiles`, `objects`, `object_members`, `materials`, `material_units`, `material_aliases`, `suppliers`, `cash_advances`, `purchases`, `movements`, `material_requests`, `inventory_counts`, `inventory_count_items`, `estimates`, `estimate_items`, `estimate_import_templates`. Kirmaydi: `companies`, `transfers` (o'tkazma bekor qilinadi, tiklanmaydi), `alerts`, `audit_log`, `notification_outbox`.
- Indekslar: `audit_log_company_id_idx (company_id, id desc)`, `audit_log_company_record_idx (company_id, table_name, record_id, id desc)`, `audit_log_company_actor_idx (company_id, actor_profile_id, id desc)`, `audit_log_company_record_id_idx (company_id, record_id, id desc)` (O4: "Shu yozuv tarixi"); partial `(company_id, deleted_at) where deleted_at is not null` — `movements`, `purchases`, `cash_advances`, `material_requests`, `estimate_items`, `inventory_count_items`.
- Yangi hint'lar: `history_limit_invalid` (22023), `restore_table_invalid` (22023), `restore_not_found` (P0002), `restore_not_deleted` (55000), `restore_transfer_movement` (55000), `restore_conflict` (23505, hint'siz unique to'qnashuv), `inventory_apply_expired` (55000). `restore_admin_only` (42501) — mavjud kalit, RPC ham beradi.
- **Review tuzatishlari (shu migratsiyada, `create or replace`):** `tg_compute_qty` va `tg_material_requests_guard` — tiklashda bog'langan xarid tekshiriladi (`purchase_not_open`); `tg_soft_delete_alert` — tiklash → `yozuv_tiklandi` alerti (details va severity — `docs/history-design.md`); `b_profiles_restore_unlink` — profil tiklanganda bog'lanishlar null, `login_kind = 'none'`, `is_active = false`; `restore_record('estimates', …)` — boshqa joriy versiya bo'lsa `is_current = false` bilan tiklaydi; `inventory_counts.submitted_at` + `b_inventory_submitted_at`; `apply_inventory_adjustments` — `inventory_apply_expired` (> 7 kun); `daily_report_stats` — `restored_count`. `audit_feed` — dinamik SQL, aniq firma sharti (oraliq ko'rinishida — tartib kaliti saqlanadi).
- **Maxfiy ustunlar `audit_log` da (P8).** `old_data`/`new_data` — qatorning to'liq nusxasi (`to_jsonb`), jumladan authenticated'ga ustun grantlari bilan yopilgan yoki ichki maydonlar: `profiles.auth_user_id`, `telegram_user_id`, `telegram_chat_id`, `login_kind`; `inventory_count_items.qty_expected`, `price_per_base` (Y1/O5 — tekshiruvchidan yashirilgan); `auth` hodisalari `details`. Hozir `audit_log` ni faqat admin, direktor, super_admin o'qiydi — ular uchun bu ochiq bo'lishi qabul qilingan. **`audit_log_select` RLS'i boshqa rollarga kengaytirilsa** (masalan "Mening yozuvlarim" tarixi) yoki `audit_feed` boshqa rollarga ochilsa — `old_data`/`new_data` dan shu kalitlarni olib tashlaydigan redaksiya (view yoki RPC ichida `- 'key'`) majburiy.

## Avtomatlashtirish (Batch 12 — `20261106000001_automation.sql`)

Shartnoma: `docs/automation-design.md`; outbox payloadlari va alert `details` shakllari — o'sha faylda, "Bildirishnoma payloadlari (DB → tg-dispatch)".

**Enum.** `alert_type` ga 9 qiymat: `kirim_manbasiz`, `manfiy_qoldiq`, `takroriy_yozuv`, `joylashuv_farqi`, `smetasiz_chiqim`, `chek_farqi`, `sorovdan_ortiq_xarid`, `podotchet_muddati`, `podotchet_manfiy`. `ADD VALUE` bilan bir tranzaksiyada qo'shilgani uchun yangi qiymatlar indeks predikatlarida ishlatilmaydi — "bitta ochiq alert" kafolati `private.alert_lock(key)` (advisory xact lock) + tekshiruv bilan.

**Yangi ustunlar.**
- `companies`: `photo_required_amount numeric(18,2) null (> 0)`, `cash_max_days int 14 (1..365)`, `duplicate_window_minutes int 10 (0..1440; 0 — o'chiq)`, `request_overbuy_pct numeric(6,2) 20 (0..1000)`, `alert_remind_hours int 48 (1..720)`, `forecast_days_warn int 3 (1..60)`. Admin o'zgartiradi (`companies_update`, ustun grant cheklovi yo'q).
- `objects`: `lat numeric(9,6)`, `lng numeric(9,6)` (ikkalasi yoki hech biri), `radius_m int not null default 300 (10..50000)`.
- `materials.photo_required boolean not null default false`.
- `movements`: `photo_sha256 text (^[0-9a-f]{64}$)`, `geo_lat`, `geo_lng numeric(9,6)`, `geo_accuracy_m int (0..100000)`, `geo_status text ('ok','denied','unavailable')`; `*_geo_check`: koordinatalar faqat `ok` da va juft.
- `purchases`: `receipt_photo_sha256`, geo ustunlari (yuqoridagidek), `receipt_fiscal_sign text (^[0-9A-Za-z]{1,64}$)`, `receipt_terminal_id`, `receipt_no` (1..64), `receipt_verified boolean not null default false`, `receipt_total numeric(18,2) (>= 0)`, `seller_tin text (^[0-9]{9,14}$)`, `request_id uuid` — FK `(company_id, request_id) → material_requests`.
- `suppliers.tin text (^[0-9]{9,14}$)`; unique `(company_id, tin) where tin is not null and deleted_at is null`.
- `cash_advances.kind text not null default 'berildi' check in ('berildi','qaytarildi')` — o'zgarmaydi (`cash_amount_locked`).
- `notification_outbox.profile_id uuid` (FK `(company_id, profile_id)`), `kind` ∪ `alert_reminder`, `request_overdue`, `cash_statement`.

**`public.receipt_lookups`** (biznes jadvali: audit, soft delete, `a_*` triggerlar, RLS enable + force): `id`, `company_id`, `fiscal_sign`, `terminal_id`, `receipt_no`, `payload jsonb (object)`, `total numeric(18,2)`, `seller_tin`, `seller_name (≤ 300)`, `receipt_at`, `fetched_at`, `created_by`, `created_at`, `updated_at`, `deleted_at`; unique `(company_id, fiscal_sign) where deleted_at is null`. SELECT — o'z firmasi (o'chirilganlar — admin/direktor/super_admin). INSERT/UPDATE grant — **hech kimga**; yozish faqat `public.svc_upsert_receipt_lookup(...)` (security definer, execute — service_role; receipt-lookup Edge Function). Tiklash oq ro'yxatiga kirmaydi (kesh).

**Indekslar.** `purchases_receipt_fiscal_sign_key` (unique, `(company_id, receipt_fiscal_sign) where not null and deleted_at is null`), `purchases_company_request_idx`, `purchases_receipt_sha_idx`, `movements_photo_sha_idx`, `movements_unlinked_kirim_idx (company_id, object_id, material_id, occurred_at) where kirim and purchase_id is null`, `alerts_company_profile_idx (company_id, details->>'profile_id')`, outbox: `notification_outbox_alert_key (alert_id, escalation) where kind = 'alert'` (qayta yaratildi), `_reminder_key (alert_id)`, `_overdue_key (company_id, report_date)`, `_cash_key (profile_id, report_date)`.

**Guardlar (BEFORE, `c_*` — `b_*` dan keyin).**
- `c_movements_auto`: rasm yo'li null → xesh null; xesh normallashtiriladi (`lower(btrim)`), format; kirimda `materials.photo_required` → `photo_path` majburiy.
- `c_purchases_auto`: xesh (rasm yo'li null → xesh null); chek maydonlari trim; foydalanuvchi sessiyasida (har INSERT/UPDATE) `receipt_verified` = shu firma keshida fiskal belgi bormi (`FOUND`), kesh bo'lsa `receipt_total` := kesh.total (null bo'lmasa), `seller_tin` := coalesce(kesh, klient); belgi yo'q → `receipt_total`, `seller_tin` null; service_role — bo'sh qiymatlar keshdan; fiskal belgi bitta tirik xaridda (advisory lock + tekshiruv, zaxira — unique indeks; tiklashda ham); rasm majburiy (`receipt_verified` → shart emas; material bayrog'i; `total_amount >= photo_required_amount`); `request_id` tekshiruvi.
- `c_suppliers_tin_guard`: STIR dublikati.

**Qoidalar** (`private.*`, security definer, execute — hech kimga; AFTER triggerlar `zz_automation_ins/upd` — `movements`, `purchases`; `material_requests` — o'chirish/miqdor):
- A: `evaluate_kirim_source(movement)`, `mark_kirim_candidate(movement, purchase)`; `evaluate_purchase_receipt` (create or replace) — nomzodlar (`purchased_at ≤ occurred_at ≤ purchased_at + 72 soat`, bog'lanmagan), qamrov `round(abs(received + Σ nomzod − purchased) * 100 / purchased, 2) <= chegara` → `covered` (alert yo'q, ochig'i `covered_by_unlinked` bilan yopiladi).
- B: `evaluate_negative_stock(company, object, material, movement)` — faqat tirik chiqim/transfer_out yoki ochiq alert bo'lsa hisoblaydi; `stock_restored` yopilgandan 24 soat ichida yangisi yaratilmaydi (yopilganining details'i yangilanadi); `private.object_stock(...)`. `create_transfer` (create or replace) — `transfer_insufficient_stock`.
- C: `evaluate_duplicate(table, id)` (oyna `0 ≤ Δcreated_at ≤ window`, chegaralar kiradi; `first_id` — eng eski, teng bo'lsa kichik id), `evaluate_duplicate_photo(table, id)`.
- D: `evaluate_geo(movement)`, `private.geo_distance_m(lat1, lng1, lat2, lng2) → int` (haversine, R = 6 371 000; trigonometriya double precision da, natija numeric → int; hech narsa float saqlanmaydi). Ichkarida: `d <= radius + least(accuracy, radius)` (manfiy/null → 0).
- F: `evaluate_no_estimate_chiqim(company, object, movement)` — obyekt bo'yicha bitta ochiq alert joriy smeta paydo bo'lguncha; `estimates` AFTER triggeri `zz_automation` (`private.tg_estimates_no_estimate_close`) joriy smeta paydo bo'lganda yopadi (`estimate_added`).
- G: `evaluate_receipt_total(purchase)` — `abs(receipt_total − total_amount) > 1`; keshdagi chek ko'p qatorli (`payload.items` > 1) — taqqoslanmaydi (`multi_line_receipt`).
- H: `sync_request_purchase(company, request)` (holat / `purchase_id` — mavjud `b_material_requests_guard` orqali), `evaluate_request_overbuy(request)` — `Σ xarid * 100 > so'rov * (100 + pct)`.
- I: `private.cash_position(company, profile)` → `issued_total, returned_total, spent_total, balance, oldest_open_at` (FIFO). Yosh = Toshkent sanalari farqi (`issued_at`); muddati o'tgan — `balance > 0 and yosh > cash_max_days`.
- K: `public.stock_forecast(p_object_id uuid)` (sql, security invoker, execute — authenticated) → `material_id, material_name, base_unit, stock_qty_base, avg_daily_qty_base, days_left, other_objects_qty_base, estimate_remaining_qty_base`. `avg_daily = round(Σ chiqim [Toshkent bugun − 13 .. bugun] / 14, 6)`; `days_left`: avg ≤ 0 → null, stock ≤ 0 → 0, aks holda `round(stock / avg, 1)`. `private.low_stock_count(company)` — xuddi shu formula (definer, faol obyektlar), `days_left <= forecast_days_warn`.

**Cron** (`private.*`, postgres nomidan): `enqueue_alert_reminders(p_now)` — `terron-alert-reminders` `27 * * * *`; `enqueue_request_overdue(p_date)` — `terron-request-overdue` `0 4 * * *` (09:00 Toshkent); `evaluate_cash_advances(p_now)` — `terron-cash-check` `10 4 * * *`; `enqueue_cash_statements(p_date)` — `terron-cash-statement` `0 4 * * 1` (dushanba 09:00).

**Service RPC** (execute — faqat service_role): `svc_outbox_recipients(p_outbox_id uuid) → (profile_id, chat_id, role)`; `svc_mark_alert_seen(p_telegram_user_id bigint, p_alert_id uuid) → text`; `svc_upsert_receipt_lookup(p_company_id uuid, p_created_by uuid, p_fiscal_sign text, p_terminal_id text, p_receipt_no text, p_payload jsonb, p_total numeric, p_seller_tin text, p_seller_name text, p_receipt_at timestamptz) → uuid`.

**O'zgargan (create or replace):** `tg_alerts_notify`, `enqueue_alert_escalation` (conflict maqsadi `kind = 'alert'`), `tg_cash_advances_guard` (+ kind; oluvchi roli/faolligi faqat `berildi` da tekshiriladi — qaytarish nofaol odamdan ham), `evaluate_purchase_receipt`, `create_transfer`, `cash_balances` (`returned_total` oxirida; `balance = berildi − qaytarildi − xaridlar`; `issued_total`, `last_issued_at` — faqat berildi), `dashboard_summary` (`cash_issued_sum` — faqat berildi, yangi `cash_returned_sum`), `daily_report_stats` (`low_stock_count`, `geo_denied_count`, `geo_unavailable_count`). Meta kalitlar (`reminded_at`, `seen_*`) — `private.alert_meta_keys()` / `private.alert_meta(details)`: qayta baholashda saqlanadi, solishtirishga kirmaydi.

**Yangi hint'lar:** `transfer_insufficient_stock` (22023, `create_transfer`; xabarda mavjud qoldiq, `detail` — raqam), `photo_required` (23514, `c_purchases_auto`, `c_movements_auto`), `photo_sha256_invalid` (23514, o'sha), `receipt_already_used` (23505, `c_purchases_auto` — insert, belgi o'zgarishi, tiklash; xabarda xaridor ismi va `dd.mm.yyyy HH:MI` Toshkent), `purchase_request_invalid` (23503 — so'rov yo'q/o'chirilgan/boshqa firma; 23514 — boshqa obyekt/material yoki holat tasdiqlandi/xarid_qilindi emas), `supplier_tin_duplicate` (23505, `c_suppliers_tin_guard`), `receipt_lookup_invalid` (22023, `svc_upsert_receipt_lookup`), `alert_action_forbidden` (42501, `svc_mark_alert_seen`), `alert_not_found` (P0002, o'sha). `cash_amount_locked` — endi `kind` o'zgarishida ham.

## Topshirish (Batch 11 — `20261107000001_handoff.sql`)

Shartnoma: `docs/handoff-design.md` (1-bo'lim — ustunlar, RLS, payload).

- **`public.bug_reports`** (biznes jadvali: `a_*` triggerlar, `z_audit`, soft delete, RLS enable + force): `id, company_id, message (1..2000), screen (≤ 200), client (≤ 500), app_version (≤ 50), photo_path, status ('yangi' | 'korildi' | 'hal_qilindi'), created_by, created_at, updated_at, deleted_at`. `created_by` — **kompozit** FK `(company_id, created_by) → profiles` (xabar doim o'z firmasiga, super_admin ham).
- `b_bug_reports_guard` (security definer): foydalanuvchi sessiyasida INSERT — `created_by = my_profile_id()`, `status = 'yangi'`, `deleted_at = null`, `company_id` null → o'z firmasi; cheklov (profil bo'yicha advisory lock, 10 daqiqa, ≤ 5, o'chirilganlari ham) — `bug_report_rate_limited`; matn btrim (`bug_report_invalid`), `screen/client/app_version` kesiladi; `photo_path` — format `{company_id}/bug/{yyyy}/{mm}/{uuid}.{ext}`, firma papkasi, o'zi yuklagan va 24 soatdan yangi (admin ham), bitta yo'l — bitta tirik xabar (`ops_photo_*` hint'lari; zaxira — `bug_reports_photo_path_key`).
- RLS: SELECT — o'zi (o'chirilmagan), admin (firma, o'chirilganlar ham), super_admin (hamma); INSERT — o'z firmasi, `created_by = my_profile_id()`; UPDATE — admin, super_admin. Grant: authenticated — `select`, `insert (id, company_id, message, screen, client, app_version, photo_path)`, `update (status, deleted_at)`; service_role — `select, insert, update`. Tiklash oq ro'yxatiga (`history_tables`) kirmaydi.
- Storage: `photos_insert` / `photos_select` qayta yaratildi (siyosatlar soni o'zgarmagan). `bug/` yo'li: yuklash — istalgan faol rol (o'z firmasi papkasi); ko'rish — yuklagan, firma admini, super_admin. Operatsiya rasmlari uchun shartlar Batch 4 dagi bilan bir xil.
- `notification_outbox`: `kind` ∪ `bug_report`, ustun `bug_report_id` (FK `(company_id, bug_report_id) → bug_reports`, unique `where kind = 'bug_report'`, `(kind = 'bug_report') = (bug_report_id is not null)`). Trigger `bug_reports.zz_notify` → `private.tg_bug_reports_notify()`. `svc_outbox_recipients` (create or replace): `bug_report` → xabar firmasi `admin` lari + barcha faol `super_admin` lar (o'z firmasi faol); qolgan kind'lar o'zgarmagan.
- Demo ma'lumot — `supabase/seed/demo.sql` (`docs/handoff-design.md` 3-bo'lim, `docs/deploy-supabase.md`).

## Qoldiq

- View `public.stock_balances` (`with (security_invoker = true)` — RLS chaqiruvchi huquqida ishlaydi): `company_id`, `object_id`, `material_id`, `last_movement_at`, `qty_base` = `kirim + transfer_in − chiqim − transfer_out + inventory_adjust`, faqat `deleted_at is null` harakatlar.

## Seed va shablon

- `private.apply_material_template(company_id uuid)` — yangi firma uchun materiallar shabloni (SaaS'da har yangi firmaga chaqiriladi). Idempotent (material nom bo'yicha, birlik `(unit, variant)` bo'yicha, alias — hammasi `private.norm_name` bo'yicha (Batch 3) tekshiriladi). Execute — faqat `service_role` (va egasi); foydalanuvchi sessiyasida faqat super_admin. Sement M400 va M500 — ikki alohida material.
- `supabase/seed.sql`: namuna firma, 3 obyekt, shablon qo'llanadi. Auth foydalanuvchilarisiz (ular Batch 2 da). **Production'ga qo'llanmaydi** — faqat lokal/sinov uchun namuna ma'lumot.

## Xavfsizlik chegaralari va eslatmalar

- **`device` sarlavhasi** (`x-client-device`) klient tomonidan soxtalashtirilishi mumkin — faqat ma'lumot uchun (audit), hech qanday xavfsizlik qarori unga tayanmaydi. Keyin JWT claim'ga (tg-auth bergan sessiya) o'tkaziladi.
- **`postgres` / Supabase dashboard — ishonchli zona.** Superuser / egasi sifatida bajarilgan SQL RLS'ni chetlab o'tadi, `session_replication_role` yoki triggerlarni o'chirish orqali auditni ham chetlab o'tishi mumkin. Ilova faqat `authenticated` va `service_role` orqali ishlaydi.
- **Sanalar:** bazada `timestamptz` (UTC). Hisobotlarda kunlarga kesish doim `(ts at time zone 'Asia/Tashkent')::date` bilan (`companies.timezone`).
- **Telefon bir necha firmada** bo'lishi mumkin (`unique (company_id, phone)`). Bitta auth/Telegram akkaunt — bitta faol profil; qaysi firma profiliga bog'lashni Batch 2 dagi bog'lash oqimi hal qiladi.
- **Orqa sanaga yozish** — Batch 4 da cheklangan (yuqorida "Kirim, chiqim, rasm").
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
