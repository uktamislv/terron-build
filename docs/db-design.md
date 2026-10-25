# Ma'lumotlar bazasi dizayni (Batch 1, 3, 4, 5)

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
| `material_requests` | firma rollari; prorab: a'zo obyektlar | admin; prorab (a'zo obyekt) | admin, taminotchi |
| `transfers` | firma rollari; prorab, omborchi: qaysidir tomoni a'zo obyekt | admin; prorab (`from_object` a'zo) | admin |
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
- `estimates`: `object_id`, `version int`, `title`, `estimate_date date`, `source_file_name`, `is_current boolean`; unique (`object_id`,`version`) va obyektda bitta `is_current` — ikkalasi o'chirilmaganlar orasida. `estimate_items`: `estimate_id`, `item_type` (`ish`/`material`), `name`, `material_id` (nullable), `unit`, `qty`, `unit_price`, `norm_qty_base` (nullable), `sort_order int`.
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
| 7 | `deleted_at`: null → qiymat bo'lganda **server vaqti** `now()` (klient yuborgani e'tiborga olinmaydi); bir marta qo'yilgan qiymat o'zgarmaydi (faqat null ga — tiklash). Barcha 18 jadval | `a_before_update` | — |

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

### Xato kalitlari (`hint`) — Batch 1–5 to'liq ro'yxati

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
