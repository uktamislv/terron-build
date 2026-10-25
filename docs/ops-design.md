# Kirim, chiqim, qoldiq (Batch 4)

Shartnoma: db-architect, domain-logic va frontend shu hujjatga tayanadi.

## Rasmlar (Supabase Storage)

- Bucket `photos` — **private** (`public = false`), `file_size_limit = 5 MB`, `allowed_mime_types = image/jpeg, image/png, image/webp`.
- Yo'l: `{company_id}/{yyyy}/{mm}/{uuid}.{ext}` — birinchi papka har doim foydalanuvchi firmasi.
- `storage.objects` siyosatlari (`bucket_id = 'photos'`):
  - INSERT — authenticated, `(storage.foldername(name))[1] = private.my_company_id()::text`, rol: kirim/chiqim yoki xarid kiritishi mumkin bo'lganlar.
  - SELECT — shu firma a'zolari (`(storage.foldername(name))[1] = my_company_id()::text`).
  - UPDATE / DELETE — hech kim (rasm o'zgarmaydi; yozuv soft delete bo'lsa ham rasm qoladi).
- Bazada faqat yo'l saqlanadi (`movements.photo_path`, `purchases.receipt_photo_path`). Trigger: yo'l bo'sh bo'lmasa, birinchi papka yozuvning `company_id` siga teng bo'lishi shart (`hint: ops_photo_path_company`).
- Ko'rsatish — `createSignedUrl(path, 3600)`.
- Klient yuklashdan oldin rasmni siqadi: eng uzun tomon 1600 px, JPEG ~0.8 sifat. Rasm doim ixtiyoriy.

## Sana

- `movements.occurred_at` (va `purchases.purchased_at`) — bo'sh bo'lsa `now()`.
- Admin/super_admin bo'lmaganlar uchun: `occurred_at` ∈ `[now() − 3 kun, now() + 5 daqiqa]`, aks holda `hint: ops_occurred_at_range`. Admin istalgan sanani qo'ya oladi (audit'da qoladi).

## Kirim/chiqim ekrani (Mini App, `/tg/movement`)

Maqsad — 3–4 bosish:
1. Yuqorida almashtirgich **Kirim | Chiqim** (oxirgi tanlov eslab qolinadi).
2. **Obyekt**: foydalanuvchida bitta obyekt bo'lsa — avtomatik, tanlash ekrani ko'rsatilmaydi; bir nechta bo'lsa — tugmalar (oxirgisi birinchi).
3. **Material**: katta tugmalar to'ri; tepada qidiruv; foydalanuvchi oxirgi 30 kunda ko'p ishlatganlari birinchi. Faqat faol materiallar.
4. **Miqdor + birlik**: raqam klaviaturasi (`inputmode="decimal"`), birlik "chip"lari (asosiy birlik birinchi, keyin boshqalar, variantlilar `unitLabel` bilan). Ostida jonli: "= 150 kg" va chiqimda "Qoldiq: 420 kg → 270 kg"; chiqim qoldiqdan ko'p bo'lsa — sariq ogohlantirish (bloklamaydi).
5. Ixtiyoriy: 📷 rasm, izoh.
6. Telegram `MainButton` "Saqlash" → muvaffaqiyat: `HapticFeedback.success`, qisqa tasdiq ("Kirim saqlandi: 3 qop sement · Obyekt A") va forma keyingi yozuv uchun tozalanadi (obyekt va tur saqlanadi). `BackButton` — oldingi qadamga.
- Ruxsat: `tgNavFor` `movement` beradigan rollar (prorab, omborchi, admin). Faqat a'zo obyektlar (admin — hammasi).
- Tarmoq xatosi: forma ma'lumoti yo'qolmaydi, "Qayta urinish".

## Mening yozuvlarim (Mini App, `/tg/mine`)

- Foydalanuvchining o'zi kiritgan oxirgi 50 ta yozuv (`created_by = my_profile_id`): hozircha harakatlar (Batch 5 da xaridlar qo'shiladi). Har qator: tur belgisi, material, miqdor (kiritilgan + asosiy), obyekt, vaqt (`dd.mm.yyyy HH:mm`), rasm belgisi; o'chirilgan bo'lsa "o'chirilgan" belgisi.
- Bosilganda tafsilot (rasm signed URL bilan).

## Veb: Ombor (`/movements`)

Ikki tab:
- **Harakatlar** — jadval: sana, tur, obyekt, material, miqdor (kiritilgan va asosiy), kim kiritgan, rasm, izoh. Filtrlar: obyekt, material, tur, sana oralig'i, kiritgan. Sahifalash (50 ta). Admin: soft delete / tiklash (`can`). Excel eksport — Batch 9.
- **Qoldiq** — `stock_balances`: obyekt × material, asosiy birlikda, oxirgi harakat sanasi; obyekt filtri; manfiy qoldiq qizil (`#B3261E`).
- RLS o'zi cheklaydi (prorab faqat o'z obyektlari).

## Sof funksiyalar (`src/domain/movements.ts`)

- `stockAfter(current: Dec, type, qtyBase: Dec): Dec`
- `movementWarnings({ type, qtyBase, currentStock }): ('exceeds_stock' | 'negative_stock')[]`
- `rankMaterials(materials, usage: { materialId, count, lastUsedAt }[], nowIso): Material[]` — chastota va yaqinlik bo'yicha, deterministik.
- `validateMovementDraft(draft): { ok: true } | { ok: false; errors: Partial<Record<'object'|'material'|'unit'|'qty'|'occurredAt', string>> }` — xato kodlari, matn emas.
- `occurredAtAllowed(occurredAtIso, nowIso, isAdmin): boolean` — bazadagi qoida bilan bir xil.
