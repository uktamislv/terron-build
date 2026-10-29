# Podotchet va xarid (Batch 5)

Shartnoma: db-architect, domain-logic va frontend shu hujjatga tayanadi.

## Qo'limdagi pul (podotchet)

- `cash_advances` — kimga qancha pul berildi (admin, buxgalter beradi).
- Qo'limdagi pul = Σ `cash_advances.amount` (shu odamga, o'chirilmagan) − Σ `purchases.total_amount` (`buyer_id` = shu odam, o'chirilmagan).
- View `public.cash_balances` (`security_invoker = true`): `company_id`, `profile_id`, `issued_total`, `spent_total`, `balance`, `last_issued_at`, `last_spent_at`. RLS chaqiruvchi huquqida: admin/direktor/buxgalter — hamma; boshqalar — o'zi (cash_advances va purchases RLS'i shuni ta'minlaydi; tekshir).
- Manfiy balans mumkin (o'z pulidan sarflagan) — xato emas, qizil ko'rsatiladi.
- `cash_advances.issued_at`: bo'sh bo'lsa `now()`; admin/buxgalter uchun cheklov yo'q (audit'da qoladi).
- Qator faqat chaqiruvchi shu odamning podotchetini to'liq ko'ra olsa chiqadi (admin/direktor/buxgalter/super_admin — hamma; boshqalar — faqat o'zi; taminotchi barcha xaridlarni ko'rsa ham boshqalar balansini ko'rmaydi). Qator yo'q — 0.
- **O'zgarmaslik (O2):** `amount` va `recipient_id` INSERT'dan keyin o'zgarmaydi (`hint: cash_amount_locked`) — tuzatish: soft delete + yangi yozuv. UI "Tahrirlash"da faqat izoh va sana.
- **Oluvchi:** faqat xarid kiritadigan faol xodim — `haydovchi`, `taminotchi`, `prorab`, `admin` (`hint: cash_recipient_role`).

## Xarid

- Kim kiritadi: haydovchi, taminotchi, prorab (Batch 1 RLS), admin. `buyer_id` = o'zi (admin boshqa nomidan kirita oladi).
- Maydonlar: obyekt, material, miqdor + birlik (`unit_id`), **jami summa** (chekdagi), sotuvchi (ixtiyoriy), chek rasmi (ixtiyoriy), izoh. `unit_price`, `price_per_base`, `qty_base` — baza hisoblaydi.
- Sotuvchi: `suppliers` dan tanlash yoki yangi nom yozish → yangi `suppliers` qatori. Yangi sotuvchi qo'shish huquqi: admin, super_admin (istalgan maydon); taminotchi, haydovchi, prorab — **faqat nom** (`phone`, `note` — null, aks holda RLS 42501). `update`/soft delete — faqat admin. Nom 1..120 belgi (CHECK 23514). Dublikat (katta-kichik harf, bo'shliqlar, ё/е farqsiz) — `hint: supplier_duplicate` → mavjudini tanlash.
- Idempotent: klient `id` yuboradi (Batch 4 dagidek, `purchases_pkey` 23505 → saqlangan).
- **O'chirish va tahrirlash (O1, P5):** bog'langan (o'chirilmagan) kirimi bor xaridni soft delete qilish yoki `object_id`/`material_id` ni o'zgartirish — rad (`hint: purchase_has_receipts`): avval kirimni o'chirish yoki boshqa xaridga bog'lash kerak.
- **Jonli narx belgisi:** `public.check_purchase_price(p_material_id uuid, p_price_per_base numeric, p_purchased_at timestamptz default now()) → text` — `'ok' | 'high' | 'low'` (pastda 3-qoida; orqa sanali xaridda `p_purchased_at` — xarid sanasi). Raqam (o'rtacha, foiz) **qaytarmaydi** — narxni chegaraga moslab kiritishning oldini olish. `p_price_per_base` = summa / asosiy birlikdagi miqdor (4 xonagacha yaxlitlanadi). Boshqa firma materiali yoki noma'lum id — `'ok'`.

## Xaridni kirim bilan bog'lash

- Kirim (`movements.type = 'kirim'`) yaratishda ixtiyoriy `purchase_id` (Batch 1 dagi trigger: material va obyekt mos bo'lishi shart — `ops_purchase_mismatch`). Xarid topilmasa yoki o'chirilgan bo'lsa — `hint: purchase_not_open` (23503; avval `ops_purchase_not_found` edi).
- Mini App kirim ekranida material va obyekt tanlangach: "Bog'langan xarid" ro'yxati — shu obyekt va materialdagi oxirgi 14 kunlik, to'liq qabul qilinmagan xaridlar (RPC `public.open_purchases(p_object_id, p_material_id)` → `id, purchased_at, buyer_id, buyer_name, qty_base, received_qty_base, remaining_qty_base, unit_input, unit_variant, qty_input`, eng yangisi birinchi). Bitta bo'lsa avtomatik taklif qilinadi; bog'lash ixtiyoriy.
- View `public.purchase_receipts` (`security_invoker`, faqat o'chirilmagan xaridlar): `purchase_id, company_id, object_id, material_id, buyer_id, purchased_at, qty_base, received_qty_base, remaining_qty_base` (manfiy — ortiqcha), `receipt_count, last_received_at`, `unlinked_qty_base` (bog'lanmagan nomzod kirimlar — server "covered" holati). Yig'indi harakatlar RLS'idan qat'i nazar (haydovchi o'z xaridining qabulini ko'radi).
- Mini App: `public.open_purchases_for_my_objects()` — chaqiruvchining obyektlaridagi (prorab/omborchi — a'zo obyektlar, admin — firma) oxirgi 60 kunlik to'liq qabul qilinmagan xaridlar: `purchase_id, object_id, object_name, material_id, material_name, base_unit, qty_base, received_qty_base, remaining_qty_base, purchased_at, buyer_id, buyer_name`.

## Farq qoidalari 1–3 (`alerts`)

Har qoida — **ikki joyda bir xil**: `src/domain/alerts/*.ts` (sof TS, UI va testlar uchun) va bazada `private.*` funksiya (haqiqiy ogohlantirish yaratadi). Mosligi PGlite testida solishtiriladi (Batch 3 dagi decimal kabi). Chegaralar firma sozlamasidan (`companies`).

1. **Xarid ≠ qabul** (`xarid_qabul_farqi`):
   - `diff_pct = |received − purchased| / purchased × 100`.
   - **Ortiqcha qabul** (`received > purchased` va `diff_pct > receipt_mismatch_pct`) — darhol, bog'langan kirim saqlanganda.
   - Formula aynan: `diff_pct = round(abs(received − purchased) * 100 / purchased, 2)` (`numeric(20,6)`).
   - **Kam qabul** (`received < purchased` va `diff_pct > receipt_mismatch_pct`) — faqat `now >= purchased_at + 24 soat` bo'lsa: `private.evaluate_purchase_receipt(purchase_id, p_now)`. Chaqiruvchilar: bog'langan kirim triggeri, xarid o'zgarishi va **soatlik pg_cron** `terron-evaluate-purchases` (`7 * * * *`) → `private.evaluate_due_purchases(p_now)` — oxirgi 60 kun ichidagi, 24 soatdan eski **barcha** xaridlar, **bog'langan kirimi umuman yo'q** bo'lsa ham (`received = 0` → 100 % kam qabul). Ok, ochiq alert raqamlari o'zgarmagan va admin qo'lda yopgan (raqamlar o'zgarmagan) xaridlar o'tkazib yuboriladi.
   - Bitta xarid uchun bitta ochiq (`yangi`/`korildi`) alert: qayta baholashda `details` yangilanadi; farq chegaradan tushsa — avtomatik `yopildi`. Admin qo'lda yopgan alert bir xil raqamlar bilan qayta ochilmaydi.
   - `severity`: `ogohlantirish`; farq ≥ 3× chegara → `jiddiy`.
   - `details`: `purchased_qty_base, received_qty_base, diff_pct, threshold_pct, direction ('over'|'under'), receipt_count, evaluated_at`.
2. **O'zi tekshirmagan** (`ozi_qabul_qilgan`, `severity = 'belgi'`, ogohlantirish emas). Har (xarid, kirim) juftligi uchun bitta. `details`: `buyer_id, receiver_id, qty_base, linked`.
   - **Bog'langan:** kirimning `created_by` = xaridning `buyer_id` → `linked = true`.
   - **Bog'lanmagan (evristika):** kirimni kiritgan odam shu obyekt + material uchun o'zi xaridor bo'lgan (o'chirilmagan) xarid bor va `|purchased_at − occurred_at| <= 48 soat` → eng yaqin xarid bilan, `linked = false`. Kirim avval, xarid keyin kiritilsa ham (xarid saqlanganda tekshiriladi).
3. **Narx og'ishi** (`narx_ogishi`, `severity = 'ogohlantirish'`). `price = price_per_base`. "Oldingi" — shu firma, shu material, o'chirilmagan, `(purchased_at, created_at)` bo'yicha shu xariddan qat'iy oldin.
   - `avg_n = round(sum(total_amount) / sum(qty_base), 4)` — oldingilarning oxirgi `price_avg_window` tasi (**miqdorga tortilgan**); < 2 ta → `null`.
   - `avg_90 = round(sum(total_amount) / sum(qty_base), 4)` — oldingilardan `purchased_at >= shu xarid purchased_at − 90 kun` bo'lganlarning hammasi; < 2 ta → `null`.
   - `diff_x = round((price − avg_x) * 100 / avg_x, 2)` (`avg_x` null yoki 0 → `null`).
   - **high:** `diff_n > price_deviation_pct` **yoki** `diff_90 > price_deviation_pct` (teng — yo'q). Bosqichma-bosqich ko'tarishni `avg_90` ushlaydi.
   - **low** (high bo'lmasa): `diff_n <= −50` **yoki** `diff_90 <= −50` — birlik xatosi yoki manipulyatsiya.
   - `details`: `avg_n, diff_n, avg_90, diff_90, price, direction ('high'|'low'), window_size, threshold_pct`.
   - Bitta ochiq alert; endi `ok` bo'lsa — avtomatik yopiladi. Jonli UI belgisi — `check_purchase_price` RPC (xuddi shu mantiq, "oldingi" = hozirgacha).
4. **Yozuv o'chirildi** (`yozuv_ochirildi`, `severity = 'ogohlantirish'`): `purchases`, `cash_advances`, `movements` soft delete bo'lganda (kim o'chirganidan qat'i nazar). `details`: `table, record_id, actor_profile_id, material_id, object_id` + `amount` (pul: `cash_advances.amount` / `purchases.total_amount`), `qty_base`, `recipient_id` / `buyer_id` / `movement_type`, `purchase_id`. `purchase_id` / `movement_id` ustunlari ham to'ldiriladi. Yozuv tiklanganda — avtomatik yopiladi (`closed_reason = 'restored'`).

Avtomatik yopishda: `status = 'yopildi'`, `closed_by = null`, `details.auto_closed = true`, `details.closed_reason` (`within_threshold` | `purchase_deleted` | `not_applicable` | `restored`), `details.closed_by_actor` — o'zgarishni qilgan foydalanuvchi profili (cron'da null).

Alert yaratish faqat tizim tomonidan (`security definer` funksiyalar/triggerlar). `alerts` ga authenticated insert yo'q (Batch 1). **O'zgartirish (P7):** authenticated faqat `status` va `close_note` (yopish sababi, ≤ 500 belgi) ustunlarini yangilaydi (ustun grant); `details`, `deleted_at`, `severity`, bog'lanishlar — 42501. RLS: admin / super_admin.

## Ekranlar

**Mini App `/tg/purchase`** (haydovchi, taminotchi, prorab, admin):
1. Tepada katta: **"Qo'limda: 1 250 000 so'm"** (manfiy — qizil).
2. Obyekt (avtomatik, bitta bo'lsa) → material tugmalari → miqdor + birlik → **summa** (`inputmode="numeric"`, minglik bo'sh joy bilan formatlanadi) → ixtiyoriy sotuvchi (oxirgilar tugma + "Yangi"), 📷 chek, izoh → MainButton "Saqlash".
3. Jonli: "1 kg narxi: 1 300 so'm"; `check_purchase_price` → `'high'` — sariq "Narx odatdagidan yuqori", `'low'` — sariq "Narx odatdagidan ancha past — birlikni tekshiring" (foizsiz; bloklamaydi).
4. Saqlangach: qo'limdagi pul yangilanadi, tasdiq kartasi.

**Mini App `/tg/movement` (Kirim)**: material va obyektdan keyin "Bog'langan xarid" bo'limi (yuqorida).

**Mini App `/tg/mine`**: xaridlar ham (tur belgisi "Xarid", summa).

**Veb `/cash`** (admin, buxgalter, direktor — ko'rish): odamlar bo'yicha qo'limdagi pul jadvali; "Pul berish" (kimga — xarid kiritadigan rollar, summa, izoh, sana); tarix (berilgan va sarflangan, odam bo'yicha filtr); admin/buxgalter soft delete.

**Veb `/purchases`**: xaridlar jadvali — sana, kim, obyekt, material, miqdor, summa, birlik narxi, sotuvchi, chek, qabul holati (`received/purchased`, rang: to'liq — yashil, kam — sariq, ortiqcha — qizil), alert belgilari. Filtrlar: obyekt, material, xaridor, sana. Tafsilot: bog'langan kirimlar, alertlar.

**Veb `/alerts`** (admin, direktor, buxgalter): ro'yxat (tur, jiddiylik, obyekt, material, tafsilot, holat), filtr, admin: "Ko'rildi" / "Yopish".

## Sof funksiyalar (`src/domain/`)

- `cash.ts`: `cashBalance(issued: Dec[], spent: Dec[]): Dec`, `parseSumInput(input): Dec | null` (bo'sh joy, vergul/nuqta; so'm — 2 xonagacha), `formatSumInput` (yozish paytida minglik bo'sh joy).
- `alerts/receiptMismatch.ts`: `evaluateReceipt({ purchasedQtyBase, receivedQtyBase, purchasedAt, nowIso, thresholdPct }): { status: 'ok' | 'over' | 'under' | 'pending'; diffPct: Dec; severity: 'ogohlantirish' | 'jiddiy' | null }` (`pending` — kam, lekin 24 soat o'tmagan).
- Qoida 2 ("O'zi tekshirmagan", `ozi_qabul_qilgan`) — faqat bazada: `supabase/migrations/20261029000001_purchases.sql` ("Qoida 2"); klientda alohida sof funksiya yo'q (`alerts/selfReceived.ts` o'chirilgan — takrorlanuvchi mantiq edi).
- `alerts/priceDeviation.ts`: 3-qoidaning yuqoridagi formulasi (miqdorga tortilgan `avg_n`, `avg_90`, `high`/`low`) — bazadagi `private.price_check` bilan bit-bit bir xil; aniq TS imzosi — domain-logic.
- Hammasi `Dec` (decimal.ts), foizlar 2 xonagacha `round` (bazadagi bilan bir xil).
