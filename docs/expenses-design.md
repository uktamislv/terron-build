# Xarajatlar (ombordan tashqari) va "smetaga kirmaydi" materiallar

Maqsad: qurilishning materialdan boshqa xarajatlarini (oziq-ovqat, yoqilg'i, transport, ijara va h.k.) ham nazoratga olish — podotchetdan ayiriladi, hisobotda ko'rinadi, mavjud nazorat qoidalari amal qiladi. Ombor qoldig'iga ta'sir qilmaydi. Yoqilg'i — oddiy xarajat turi (texnika hisobi emas, u keyingi bosqich).

Migratsiya: `supabase/migrations/20261111000001_expenses.sql`.

## 1. Xarajat turlari — `expense_categories`

- Ustunlar: `id, company_id, name` (≤ 80, firma ichida `norm_name` bo'yicha unique, o'chirilmaganlar), `monthly_limit numeric(18,2)` (null = limitsiz, > 0), `photo_required boolean default false`, `is_active boolean default true`, `sort_order int default 0` + standart ustunlar (created_by/at, updated_at, deleted_at). RLS + audit + soft delete.
- Standart turlar (har firmaga — mavjudlarga migratsiyada, yangilariga trigger orqali): Oziq-ovqat, Yoqilg'i, Transport va yetkazish, Asbob-uskuna ijarasi, Kommunal xizmatlar, Boshqa.
- Ko'rish — firmaning barcha faol rollari (tekshiruvchidan tashqari); qo'shish/o'zgartirish — admin.

## 2. Xarajatlar — `expenses`

- Ustunlar: `id, company_id, category_id` (FK), `object_id` (nullable — null = "Umumiy (obyektsiz)"), `amount numeric(18,2) > 0`, `spent_at timestamptz` (orqa sana qoidasi — `b_op_date` bilan bir xil: admin emaslar uchun 3 kun), `payer_id` (kim to'ladi; admin emas bo'lsa = o'zi), `payment_source` ('podotchet' | 'firma', xariddagi qoida bilan bir xil), `supplier_id` (ixtiyoriy), `note` (≤ 500), `receipt_photo_path`, `receipt_photo_sha256` (server — photo-hash navbati), chek QR ustunlari (`receipt_fiscal_sign`, `receipt_terminal_id`, `receipt_no`, `receipt_verified`, `receipt_total`, `seller_tin`), geo ustunlari (`geo_lat/lng/accuracy_m/status`) + standart ustunlar.
- RLS: INSERT — admin, taminotchi, prorab, haydovchi, buxgalter (`payer_id = me`, admin boshqa nomidan ham; obyekt berilsa — `can_access_object`); SELECT — company-wide ops rollari (admin, direktor, buxgalter, taminotchi) hammasini, boshqalar — o'zi to'laganlari va o'zi kiritganlari; UPDATE — faqat admin (to'g'ridan-to'g'ri) va `correct_entry` / `cancel_own_entry` orqali muallif 30 daqiqa ichida; DELETE yo'q. Tekshiruvchi ko'rmaydi.
- Fiskal belgi — **xaridlar va xarajatlar bo'yicha birga** unique (bitta chek ikki joyda ishlatilmaydi; `receipt_already_used`).
- `restore_record` oq ro'yxati, tarix (`audit_feed`, `deleted_records`, `audit_record_label`), photo-hash navbati, `svc_set_photo_hash` jadval ro'yxati — `expenses` qo'shiladi.

## 3. Pul (podotchet)

- `cash_balances`, `cash_position`, podotchet muddati (FIFO), haftalik hisob, dashboard pul kartasi — `payment_source = 'podotchet'` xarajatlar xaridlar kabi "sarflandi" ga qo'shiladi.

## 4. Nazorat qoidalari

- **Rasm majburiy:** `amount >= companies.photo_required_amount` yoki `category.photo_required` → rasm shart (QR tasdiqlangan chek — xarid qoidasi bilan bir xil ozodlik).
- **Takroriy yozuv:** shu `created_by`, tur, obyekt, `amount` — `duplicate_window_minutes` ichida → `takroriy_yozuv` (belgi). Rasm xeshi takrori — `takroriy_yozuv` (photo), xarid/harakatlar bilan birga tekshiriladi.
- **Oylik limit:** tur bo'yicha joriy oy (Toshkent) yig'indisi `monthly_limit` dan oshsa → yangi alert `xarajat_limiti` (ogohlantirish, tur + oy bo'yicha bitta ochiq; details: category, month, limit, spent, over, last_expense_id). Limit o'zgarsa yoki xarajat o'chirilsa — qayta baholanadi, limitdan pastga tushsa avtomatik yopiladi.
- **O'zgartirish/o'chirish/tiklash:** `yozuv_ozgartirildi` (admin to'g'ridan-to'g'ri), `yozuv_tuzatildi` (muallif), `yozuv_ochirildi`, `yozuv_tiklandi` — xaridlardagidek.
- **Boshqa nomidan:** admin `payer_id <> created_by` → `xarid_boshqa_nomidan` (details `table = 'expenses'`) va to'lovchiga `purchase_on_your_name` analogi (`expense_on_your_name`).
- **Chek:** `chek_farqi`, `sotuvchi_stir_farqi` — xariddagidek.
- **Joylashuv:** saqlanadi, alert yo'q (xarajat odatda do'konda).

## 5. Hisobotlar

- `dashboard_summary`: `expense_sum` (davr), `expense_by_category` (top), umumiy xarajat = xaridlar + xarajatlar.
- `spend_breakdown`: `p_group` — `category` (xarajat turi) qo'shiladi; `object` guruhlashida xarajatlar ham (alohida ustun: material / boshqa).
- Kunlik hisobot: `expenses_count`, `expenses_sum`, `expense_limit_alerts`.
- Smeta va haqiqiy diagramma (obyekt bo'yicha so'm): material xaridi va boshqa xarajat alohida segment.

## 6. "Smetaga kirmaydi" materiallar

- `materials.outside_estimate boolean default false` (admin).
- Qoida 4 (`normadan_oshish`) va `not_in_estimate` holati, qoida 6 (`smetadan_ortiq_sorov`) — bunday materiallar uchun ishlamaydi. `smetasiz_chiqim` ham ularni hisobga olmaydi.
- Norma jadvalida "Smetaga kirmaydi" belgisi bilan ko'rsatiladi (sarf ko'rinadi, ogohlantirish yo'q). Ombor, qoldiq, xarid, narx og'ishi, manfiy qoldiq — oddiy material kabi.

## 7. Interfeys

- **Mini App "Xarid"**: yuqorida **"Material / Xarajat"** almashtirgich (oxirgi tanlov eslab qolinadi). Xarajat: tur tugmalari (ko'p ishlatilgani oldinda), summa (katta raqam), obyekt (bitta bo'lsa avtomatik; "Umumiy" varianti), izoh, sana chiplari, chek rasmi/QR (rasm majburiy bo'lsa — belgisi). 3–4 bosish.
- **Veb**: "Xaridlar" sahifasida "Xarajatlar" tabi — ro'yxat, filtrlar (tur, obyekt, to'lovchi, davr), "Xarajat qo'shish" dialogi, tafsilot, tuzatish/o'chirish, Excel. "Sozlamalar → Xarajat turlari" — qo'shish, nom, oylik limit, rasm majburiy, faol/nofaol, tartib.
- **Yozuvlar**: xarajatlar ham (tuzatish/bekor qilish 30 daqiqa).
- **Pul tarixi**: xarajatlar "sarflandi" qatorlari.
- **Bosh sahifa**: xarajatlar kartasi va tur bo'yicha taqsimot; ogohlantirishlar `xarajat_limiti`.
- **Katalog**: material formasida "Smetaga kirmaydi" belgisi.
- Qo'llanmalar (taminotchi, haydovchi, prorab, buxgalter, admin, direktor) yangilanadi.
