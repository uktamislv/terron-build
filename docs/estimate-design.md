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
