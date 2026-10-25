# Smeta Excel importi (Batch 7, veb)

Kim: `admin`, `buxgalter` (Batch 1 RLS: `estimates`, `estimate_items` insert). Boshqalar — ko'rish (`docs/db-design.md` matritsasi).

## Oqim (veb `/estimates` → "Smeta yuklash")

1. **Fayl.** `.xlsx`, `.xls`, `.csv` (≤ 10 MB). Obyekt tanlanadi. Brauzerda o'qiladi (SheetJS) — fayl serverga yuklanmaydi, faqat natija saqlanadi (`source_file_name`).
2. **Varaq va sarlavha.** Varaqlar ro'yxati; sarlavha qatori avtomatik topiladi (`detectHeaderRow`), foydalanuvchi o'zgartira oladi.
3. **Ustunlarni moslash.** Har bir maydon uchun ustun: `name` (majburiy), `unit` (majburiy), `qty` (majburiy), `price` (ixtiyoriy), `sum` (ixtiyoriy), `type` (ixtiyoriy — "ish"/"material"), `code` (ixtiyoriy). Avtomatik taklif (`autoMapColumns`, o'zbek va rus kalit so'zlari). Firma uchun **shablon** eslab qolinadi: sarlavha imzosi (`headerSignature`) mos kelsa — avtomatik qo'llanadi.
4. **Qatorlarni ajratish.** `parseRows`: bo'sh, jami ("Итого", "Jami"), bo'lim sarlavhalari (faqat nom, raqamsiz) — o'tkazib yuboriladi (ro'yxatda "o'tkazildi" belgisi bilan ko'rinadi). Raqamlar: bo'sh joy/NBSP minglik, vergul yoki nuqta kasr (`parseDec`). Xato qatorlar belgilanadi, foydalanuvchi tuzatadi yoki o'tkazib yuboradi.
5. **Katalogga moslash.** Har qator uchun `matchMaterialByName` (nom + muqobil nomlar): aniq moslik (score 1) — avtomatik; qisman — takliflar; foydalanuvchi: material tanlaydi / "Ish (material emas)" / "Yangi material yaratish" (nom, asosiy birlik). Tanlangan moslik **muqobil nom sifatida saqlanishi** taklif qilinadi (keyingi import avtomatik moslaydi).
6. **Birlik savollari.** Material uchun smetadagi birlik (`unit`) materialning birliklari orasida `findUnit` bilan topilmasa: "Smetadagi «т» qaysi birlikka mos?" — mavjud birlikni tanlash yoki yangi birlik + koeffitsient qo'shish (Batch 3 katalog himoyalari amal qiladi). Bir xil birlik matni butun import bo'yicha bir marta so'raladi.
7. **Tekshirish.** Jadval: qatorlar, moslik, birlik, miqdor, asosiy birlikda miqdor (`toBaseQty`), narx, summa; jami summa; ogohlantirishlar (summa ≠ miqdor × narx, takroriy material). Avvalgi joriy versiya bilan **farq** (`diffEstimates`): qo'shilgan, olib tashlangan, miqdori/narxi o'zgargan materiallar.
8. **Saqlash.** RPC `public.import_estimate(...)` — bitta tranzaksiyada: yangi versiya (`version = max + 1`), `is_current = true`, eski versiyalar `is_current = false`, qatorlar. Idempotent (klient `id`).

## Ma'lumotlar

- `estimates`: `object_id, version, title, source_file_name, estimate_date, is_current`.
- `estimate_items`: `item_type ('ish' | 'material')`, `name` (smetadagi asl nom), `material_id` (material bo'lsa), `unit` (smetadagi birlik matni), `unit_id` (yangi, nullable — material birligi), `qty` (smetadagi miqdor), `norm_qty_base` (asosiy birlikda — `toBaseQty(qty, factor)`; material bo'lsa majburiy), `unit_price`, `sort_order`, `code` (yangi, ixtiyoriy), `row_number` (yangi — Excel'dagi qator).
- Yangi jadval `estimate_import_templates`: `company_id, name, header_signature text, mapping jsonb, sheet_name, header_row int, last_used_at` + standart ustunlar, RLS: admin/buxgalter yozadi, firma ko'radi. Unique `(company_id, header_signature)` o'chirilmaganlar orasida.
- **Amalga oshirildi** (`20261031000001_estimates.sql`, tafsilot — `docs/db-design.md` → "Smeta importi"):
  - `estimate_items.unit_id` — FK `(company_id, unit_id) → material_units`; material qatorida majburiy (`estimate_items_kind_check`), ish qatorida `material_id`, `unit_id`, `norm_qty_base` null. `code` ≤ 100, `row_number` > 0.
  - `norm_qty_base` — trigger `b_compute_norm` hisoblaydi (`round(qty * factor, 6)`), klient qiymati e'tiborsiz; birlik o'chirilmagan va shu materialniki bo'lishi shart. Smetada ishlatilgan birlikning `factor`i o'zgarmaydi (`catalog_unit_in_use`).
  - Shablon: `name` ≤ 120, `header_signature` ≤ 4000, `mapping` — JSON obyekt, `sheet_name` ≤ 120, `header_row` ≥ 0 (0 dan, standart 0). Unique indeks qisman — upsert: imzo bo'yicha qidirib `update` yoki `insert`.

## RPC `public.import_estimate`

```
import_estimate(
  p_id uuid,                 -- klient id (idempotent)
  p_object_id uuid,
  p_title text,
  p_source_file_name text,
  p_estimate_date date,
  p_items jsonb              -- [{item_type, name, material_id, unit, unit_id, qty, unit_price, code, row_number, sort_order}]
) returns uuid
```
- `security invoker` (RLS amal qiladi), `search_path = ''`. Har qatorni tekshiradi: material bo'lsa `material_id` va `unit_id` shu materialniki, `norm_qty_base = round(qty * factor, 6)` **bazada hisoblanadi** (klientdan olinmaydi); `qty > 0`; `unit_price >= 0`; ≤ 5000 qator.
- Shu `p_id` bilan smeta allaqachon bo'lsa — o'sha id qaytariladi (qayta yaratmaydi).
- Hint'lar: `estimate_too_many_rows`, `estimate_item_invalid` (`message` da qator raqami).

**Amalga oshirildi — aniqliklar:**
- Ruxsat: `super_admin`, `admin`, `buxgalter`; boshqalar — `42501 estimate_import_forbidden`. Tizimga kirilmagan — `auth_required`.
- `p_items` elementi: raqamlar (`qty`, `unit_price`) JSON son yoki satr (nuqta bilan, `Dec.toString()`), `row_number`/`sort_order` — butun son. `sort_order` bo'lmasa — massivdagi tartib (1..n). `unit` — smetadagi asl matn (ixtiyoriy, ≤ 50; bo'lmasa birlik nomi yoziladi). `norm_qty_base` yuborilmaydi (yuborilsa e'tiborsiz).
- Qator xatosi: `22023`, hint `estimate_item_invalid`, `message` = `Qator <row_number>: <sabab>` (`row_number` yo'q bo'lsa `Qator #<massiv indeksi 1 dan>`), `detail` = shu raqam (matn). Faqat birinchi xato qator qaytariladi; hech narsa yozilmaydi.
- Boshqa hint'lar: `estimate_invalid` (22023 — `p_id`/obyekt yo'q, nom bo'sh yoki > 200, fayl nomi > 255, `p_items` massiv emas yoki bo'sh), `estimate_object_not_found` (P0002 — obyekt yo'q/o'chirilgan/boshqa firma), `estimate_id_conflict` (23505 — shu `p_id` boshqa obyektda), `estimate_too_many_rows` (22023 — > 5000).
- Idempotentlik `p_id` bo'yicha qatorlar tekshiruvidan **oldin**: takroriy chaqiruv (hatto boshqa `p_items` bilan) mavjud id ni qaytaradi.
- Versiya: shu obyektdagi barcha (o'chirilganlari ham) versiyalar `max + 1`; obyekt bo'yicha advisory lock — parallel import poygasiz.
- **Idempotentlik mazmun bilan:** `import_hash` = sha256(`object_id`, `p_title` (asl), `p_items`). Shu `p_id` + boshqa mazmun → `23505 estimate_id_reused` (klient qayta urinishda **aynan o'sha** payload'ni yuborishi shart).
- Qo'shimcha: `round(qty, 6) > 0`, asosiy birlikda `round(qty × factor, 6) < 1e14` (xabar: "asosiy birlikdagi miqdor juda katta"), `estimate_date` null yoki 01.01.2000 .. bugun + 1 yil (`estimate_invalid`).
- **Faqat RPC:** `estimates`/`estimate_items` ga to'g'ridan-to'g'ri INSERT, qator mazmunini, `object_id`, `version`, `is_current` ni o'zgartirish — `42501 estimate_direct_edit`. Ruxsat: smeta nomi/sana/fayl nomi, soft delete (tiklash — admin). O'chirilgan joriy versiyani tiklash to'qnashsa — `23505 estimate_restore_conflict` (yechim: `is_current = false` bilan tiklash).
- **Direktorga signal** — `alerts.type = 'smeta_ozgarishi'`, Telegram'ga darhol (Batch 6 outbox). `details.kind`: `norm_increase` (yangi versiyada material normasi `companies.estimate_increase_pct` (standart 10%) dan ko'p oshgan yoki yangi material; chiqim eski normadan allaqachon oshgan bo'lsa — `jiddiy`), `old_version_restored`, `current_deleted`. Aniq shakl — `docs/db-design.md` → "smeta_ozgarishi alertlari".
- **Jami:** view `public.estimate_totals` (`estimate_id, company_id, object_id, row_count, material_count, total_sum`) — ro'yxat va diff uchun.

## RPC `public.set_current_estimate`

```
set_current_estimate(p_estimate_id uuid) returns void
```
- `security invoker`, `search_path = ''`. Ruxsat — `super_admin`, `admin`, `buxgalter` (`estimate_import_forbidden`). Smeta o'chirilgan / topilmasa / boshqa firmaniki — `P0002 estimate_not_found`. Shu obyektdagi boshqa versiyalar `is_current = false`, bu — `true`. Takror chaqiruv xavfsiz.

## Sof funksiyalar (`src/domain/estimate/`)

- `detectHeaderRow(rows: Cell[][], maxScan = 30): number | null`
- `headerSignature(header: string[]): string` — normallashtirilgan (`normalizeAlias`) sarlavhalar `|` bilan.
- `autoMapColumns(header: string[]): Partial<Record<EstimateField, number>>` — kalit so'zlar: name: наименование, наименование работ и затрат, nomi, ish nomi, материал; unit: ед. изм, единица, o'lchov, birlik; qty: кол-во, количество, miqdori, hajmi; price: цена, narx, стоимость единицы; sum: сумма, стоимость, summa, всего; type: тип, вид, turi; code: шифр, код, обоснование, №.
- `parseRows(rows, headerRow, mapping): ParsedRow[]` — `{ rowNumber, kind: 'item' | 'section' | 'total' | 'empty' | 'invalid', name, unit, qty: Dec | null, price: Dec | null, sum: Dec | null, type: 'ish' | 'material' | null, code, errors: string[] }`.
- `diffEstimates(prev: DiffItem[], next: DiffItem[]): DiffResult` — material bo'yicha (`material_id`, `ish` uchun normallashtirilgan nom) guruhlab: `added`, `removed`, `changed` (`qtyBaseBefore/After`, `priceBefore/After`), `unchanged` soni; jami summa farqi.
- Hammasi `Dec` bilan, float yo'q.

## Resurs smetasi — avtomatik moslash (20261104000001)

Sabab: haqiqiy rus resurs smetasi (ЛРВ, 821 ta noyob material, 1308 qator) qo'lda moslandi. Maqsad — keyingi importlar deyarli avtomatik: smetadagi **shifr** (resurs / narx to'plami kodi) va **asl nom** katalogda muqobil nom sifatida eslab qolinadi, moslanmaganlar bitta tugma bilan ommaviy yaratiladi.

### `material_aliases.lang = 'code'`

- Ruxsat etilgan qiymatlar: `'ru' | 'uz' | 'code'`. `'code'` — smetadagi shifr ("101-0123", "С101-0123", 6 xonali kod).
- Unikallik o'zgarmagan: firma bo'yicha `private.norm_name(alias)` o'chirilmaganlar orasida — barcha `lang` birgalikda (shifr matni oddiy alias bilan ham to'qnashadi). Nom ↔ alias to'qnashuvi (`catalog_name_alias_conflict`) shifrlarga ham tegishli.
- Klient moslashda: avval `lang = 'code'` alias'lar shifr ustuni bo'yicha, keyin nom + boshqa alias'lar (`matchMaterialByName`).

### RPC `public.estimate_create_materials`

```
estimate_create_materials(p_items jsonb) returns jsonb

p_items (1..2000): [{
  key        text | number   -- klient kaliti, javobda qaytadi (≤ 200)
  name       text            -- ≤ 200
  base_unit  text            -- ≤ 50
  category   text | null     -- ≤ 100
  code       text | null     -- shifr, ≤ 100
  alias      text | null     -- smetadagi asl (ruscha) nom, ≤ 200
  units      [{ unit text (≤ 50), factor number | string (> 0, < 1e10), variant text | null (≤ 100) }] | null   -- ≤ 50 ta
}]
→ [{ key text, material_id uuid, created boolean }]   -- kirish tartibida
```

- `security invoker` (RLS amal qiladi), `search_path = ''`. Ruxsat: `super_admin`, `admin` (katalog boshqaruvi bilan bir xil). Boshqalar — `42501 estimate_materials_forbidden`; profilsiz — `42501 auth_required`. Firma — chaqiruvchining `my_company_id()` (super_admin uchun ham).
- **Avval tekshiruv** (hammasi, yozishdan oldin), keyin firma katalogi qulfi — `pg_advisory_xact_lock(hashtextextended('terron.catalog_names:' || company_id, 0))` (katalog triggerlari bilan bir xil kalit), so'ng elementlar ketma-ket.
- **Idempotent qidiruv** (hammasi `norm_name` bo'yicha, faqat o'chirilmagan material / alias, faqat o'z firmasi):
  1. `lang = 'code'` alias = `code`;
  2. material nomi = `name`;
  3. material nomi = `alias`;
  4. har qanday alias = `name` yoki `alias` (`name` ga moslik ustun).
  Topilsa — `created = false`; `code` alias'i yo'q va matn bo'sh bo'lsa — qo'shiladi (birlik va boshqa alias qo'shilmaydi). Nofaol (`is_active = false`) material ham topiladi.
- **Topilmasa — yaratiladi:** material (`created_by` = chaqiruvchi; asosiy birlik qatori `factor = 1` — mavjud `b_base_unit` triggeri), `units` (mavjud birlik bilan `norm_name(unit)` + `norm_name(variant)` bo'yicha takrorlari, asosiy birlik ham — jimgina o'tkaziladi; `factor` `numeric(20,10)` ga yaxlitlanadi), `code` → `lang = 'code'`, `alias` → `lang = 'ru'` (nomdan `norm_name` bo'yicha farqli bo'lsa).
- **Alias o'g'irlanmaydi:** matn firmada faol alias (har qanday material, har qanday `lang`) yoki faol material nomi sifatida band bo'lsa — o'tkaziladi, xato yo'q.
- Bitta chaqiruvda takroriy nom/shifr — keyingisi oldingisi yaratgan materialni qaytaradi (`created = false`).
- **Xato:** `22023 estimate_materials_invalid`. Ro'yxat darajasida: massiv emas / bo'sh / > 2000 (`Materiallar juda ko'p: N (ko'pi bilan 2000)`). Qator: `message` = `Qator <n>: <sabab>`, `n` — massivdagi o'rni (1 dan), `detail` = `n`. Faqat birinchi xato; **hech narsa yozilmaydi**. Sabablar: `qator noto'g'ri formatda`, `kalit (key) ko'rsatilmagan`, `nomi bo'sh`, `nomi juda uzun (200 belgigacha)`, `asosiy birlik ko'rsatilmagan`, `... juda uzun`, `birliklar ro'yxat bo'lishi kerak`, `birlik nomi bo'sh`, `«<birlik>» koeffitsienti ko'rsatilmagan / raqam emas / 0 dan katta bo'lishi kerak / juda katta`.
- Klient: 200 belgidan uzun smeta nomini `name` uchun qisqartiradi (asl nom `alias` ga yoki keyin `remember_estimate_aliases` ga — u 1000 gacha qabul qiladi).

### RPC `public.remember_estimate_aliases` (20261105000001 — smetaga bog'langan)

> 20261104000001 dagi `remember_estimate_aliases(p_items jsonb)` **o'chirildi** (review P2: buxgalter ixtiyoriy matnni ixtiyoriy materialga alias qilib, avtomatik moslashni buzishi va katalog nomlarini band qilishi mumkin edi — masalan "Цемент М500" → Kafel).

```
remember_estimate_aliases(p_estimate_id uuid, p_items jsonb) returns integer

p_items (0..5000): [{ material_id uuid, code text | null, name text | null }]
→ qo'shilgan alias'lar soni
```

- Muvaffaqiyatli `import_estimate` dan **keyin**, o'sha smeta id si bilan chaqiriladi (alohida tranzaksiya; xato bo'lsa import saqlangan qoladi — klient jimgina log qiladi).
- Ruxsat: `super_admin`, `admin`, `buxgalter` — boshqalar `42501 estimate_import_forbidden`; profilsiz `42501 auth_required`.
- `security definer`, `search_path = ''` (buxgalter `material_aliases` ga RLS orqali yoza olmaydi). Tekshiruvlar tartibi, hammasi yozishdan oldin:
  1. smeta chaqiruvchi firmasida va o'chirilmagan — aks holda `P0002 estimate_not_found` (mavjud hint, qayta ishlatiladi);
  2. smeta muallifi (`created_by`) — chaqiruvchi; `admin` / `super_admin` — firmaning istalgan smetasi. Aks holda `22023 estimate_aliases_invalid`, `Muqobil nomlarni faqat o'zingiz yuklagan smetadan saqlash mumkin`;
  3. smeta `created_at` so'nggi 24 soat ichida (hamma rollar uchun) — aks holda `22023 estimate_aliases_invalid`, `Smeta 24 soatdan oldin yuklangan — muqobil nomlarni saqlab bo'lmaydi`;
  4. `p_items` massiv, ≤ 5000 (bo'sh — 0);
  5. har qator: `material_id` firmada va o'chirilmagan; smetada shu `material_id` li `item_type = 'material'`, o'chirilmagan qator bor; `code` (null bo'lmasa) shu material qatorlaridan birining `code` iga, `name` (null bo'lmasa) birining `name` iga teng. Solishtirish — `private.squash_spaces` (btrim + bo'sh joy ketma-ketligi, NBSP ham, → bitta probel); registr va ё **farqlanadi**.
- Qator xatosi: `22023 estimate_aliases_invalid`, `Qator <n>: <sabab>` (`detail` = n, massivdagi o'rni 1 dan). Sabablar: `qator noto'g'ri formatda`, `material ko'rsatilmagan`, `material topilmadi yoki o'chirilgan`, `material bu smetada yo'q`, `shifr smetadagi shu material qatoriga mos emas`, `nom smetadagi shu material qatoriga mos emas`. Birinchi xato; **hech narsa yozilmaydi**. (Uzunlik cheklovlari endi kerak emas — matn smeta qatoriga teng bo'lishi shart: `code` ≤ 100, `name` ≤ 1000 import'da tekshirilgan.)
- Yozish: `code` → `lang = 'code'`, `name` → `lang = 'ru'`, matn `squash_spaces` qilingan holda — faqat firmada faol alias yoki faol material nomi (o'zi ham, `norm_name` bo'yicha) sifatida band bo'lmasa. Ustidan yozmaydi, o'g'irlamaydi; takroriy chaqiruv — 0.
- `created_by` = chaqiruvchi profili. Audit (`z_audit`): actor — haqiqiy chaqiruvchi (`auth.uid()` definer ichida ham), `device` — `x-client-device`.
- Qulf — `private.lock_catalog_names(company_id)`.
- Klient: `import_estimate` ga yuborilgan `name` / `code` ni aynan (yoki faqat bo'sh joylari farqli) yuboradi; `material_id` — shu qatorda tanlangan material.

### `estimate_items.line_sum` (20261105000001)

Sabab (review P2): agregatsiya qilingan qatorlarda (bir xil resurs bir necha qatordan yig'ilgan) fayldagi summa aniq, lekin `unit_price numeric(18,2)` yaxlitlangani uchun `qty × unit_price ≠ fayl summasi`.

- Ustun: `estimate_items.line_sum numeric(18,2)`, nullable, `check (line_sum >= 0)`.
- `import_estimate` qator elementi: ixtiyoriy `line_sum` — JSON son yoki satr (nuqta bilan), `>= 0`, 2 xonaga yaxlitlanadi, `< 1e16` (yaxlitlangandan keyin). Xato sabablari (`22023 estimate_item_invalid`, `Qator <row_number>: ...`): `summa raqam emas`, `summa manfiy bo'lishi mumkin emas`, `summa juda katta`. Ish qatorida ham ruxsat.
- **Qator summasi** (hamma joyda): `coalesce(line_sum, round(qty * unit_price, 2))`. `public.estimate_totals.total_sum` = shu ifodaning yig'indisi. `line_sum` yo'q qatorlar — avvalgidek (ikkalasi ham yo'q — summaga kirmaydi).
- Bazada boshqa smeta summasi hisoblanmaydi: hisobotlar (`dashboard_*`, `spend_breakdown`) xaridlarga, norma (`norm_usage`, `norm_overview`, qoida 4) va `smeta_ozgarishi` alerti — `norm_qty_base` ga tayanadi (narxsiz). Klient (`diffEstimates`, smeta jadvali, Excel eksport) ham shu ifodani ishlatishi kerak.
- `import_hash` = sha256(`object_id`, `title`, `p_items`) — `line_sum` `p_items` ichida, demak hash'ga kiradi: shu `p_id` + boshqa `line_sum` → `23505 estimate_id_reused`. `line_sum`siz payload hash'i o'zgarmagan (eski smetalar idempotentligi saqlanadi).
- `estimate_create_materials` (20261105000001 da qayta yaratilgan, tana o'zgarmagan): ichki `pg_advisory_xact_lock(hashtextextended('terron.catalog_names:' || company_id, 0))` kaliti `private.lock_catalog_names` bilan bir xil ekani izohlangan va test bilan tekshirilgan.

### `hint` kalitlari (frontend `src/data/errors.ts`, `src/i18n/uz.ts`)

| `hint` | `errcode` | RPC |
|---|---|---|
| `estimate_materials_forbidden` | 42501 | `estimate_create_materials` |
| `estimate_materials_invalid` | 22023 | `estimate_create_materials` |
| `estimate_aliases_invalid` | 22023 | `remember_estimate_aliases` (qator xatolari + smeta muallifi / 24 soat) |

Qayta ishlatiladi: `auth_required` (ikkalasi), `estimate_import_forbidden` va `estimate_not_found` (P0002) — `remember_estimate_aliases`; `estimate_item_invalid` — `line_sum` xatolari. 20261105000001 yangi hint qo'shmaydi.
