# So'rovlar, o'tkazmalar, inventarizatsiya, norma (Batch 8)

## Norma (smeta asosida)

Obyekt + material uchun **norma** = joriy smetadagi shu material qatorlarining `Σ norm_qty_base` (o'chirilmaganlar). **Isrof bilan norma** = `round(norma × (1 + waste_pct / 100), 6)` (`materials.waste_pct`).
**Sarf** = shu obyektdagi o'chirilmagan `chiqim` harakatlarining `Σ qty_base` (barcha vaqt; `transfer_out` sarf emas).

View `public.norm_usage` (`security_invoker`): `company_id, object_id, material_id, estimate_id, norm_qty_base, allowed_qty_base (isrof bilan), consumed_qty_base, requested_open_qty_base (kutilmoqda + tasdiqlandi so'rovlar), remaining_qty_base (= allowed − consumed), usage_pct`. Faqat joriy smetasi bor obyektlar va smetadagi materiallar + smetada yo'q, lekin sarfi bor materiallar (`norm_qty_base = 0`).

## Qoida 4 — normadan oshish (`normadan_oshish`)

- `chiqim` INSERT/UPDATE/soft delete/tiklashda (obyektda joriy smeta bo'lsa) qayta baholanadi.
- `consumed > allowed` → alert. `over_pct = round((consumed − allowed) × 100 / allowed, 2)`; `over_pct ≥ 25` → `jiddiy`, aks holda `ogohlantirish`.
- Material smetada yo'q (`allowed = 0`), lekin sarf bor → alert `details.not_in_estimate = true`, `ogohlantirish`.
- Bitta ochiq alert har (obyekt, material, smeta) uchun; qayta baholashda `details` yangilanadi (raqamlar o'zgarmasa — yozilmaydi); sarf chegaradan tushsa (masalan chiqim o'chirildi) — avtomatik yopiladi.
- Yangi smeta versiyasi joriy bo'lganda shu obyekt bo'yicha qayta baholanadi.
- `details`: `{norm_qty_base, allowed_qty_base, consumed_qty_base, over_pct, waste_pct, estimate_id, estimate_version, not_in_estimate, base_unit}`.

## Qoida 6 — smetadan ortiq so'rov (`smetadan_ortiq_sorov`)

- So'rov INSERT'da (va admin miqdorni o'zgartirsa): `requested_qty_base > remaining − (boshqa ochiq so'rovlar)` bo'lsa → alert (so'rov bo'yicha bitta). Joriy smeta yo'q yoki material smetada yo'q → `details.not_in_estimate = true`.
- `details`: `{requested_qty_base, allowed_qty_base, consumed_qty_base, other_open_qty_base, available_qty_base, over_qty_base, estimate_version, not_in_estimate, base_unit}`; `severity = 'ogohlantirish'`.
- So'rov rad etilsa yoki o'chirilsa — alert avtomatik yopiladi.

## So'rovlar (`material_requests`)

- Kim: prorab (a'zo obyekt), admin. Mini App `/tg/request` → "So'rov" tab: obyekt (avtomatik), material, miqdor + birlik, kerakli sana (ixtiyoriy, tez tugmalar: bugun, ertaga, 3 kun), izoh. Saqlashdan oldin jonli "Smetada qolgan: 1 200 kg" (`norm_usage` dan), ortiq bo'lsa sariq ogohlantirish (bloklamaydi).
- Holatlar (Batch 1): `kutilmoqda → tasdiqlandi | rad`, `tasdiqlandi → xarid_qilindi`. Admin tasdiqlaydi/rad etadi (sabab — `note` ga emas, yangi `decision_note text` ustuni), taminotchi "Xarid qilindi" (ixtiyoriy `purchase_id` bog'lash — yangi ustun, kompozit FK).
- Veb `/requests`: ro'yxat (holat filtri, obyekt, material), har qatorda smeta holati (qolgan, ortiqcha — qizil), amallar `can()` bo'yicha.
- Mini App "Mening yozuvlarim"da so'rovlar holati bilan.

## O'tkazmalar (`transfers`)

RPC'lar (`security definer`, ichida rol, firma va a'zolik tekshiruvi; `search_path=''`):
- `create_transfer(p_id, p_from_object_id, p_to_object_id, p_material_id, p_unit_id, p_qty_input, p_note) → uuid` — prorab (`from` a'zo) yoki admin; bitta tranzaksiyada `transfers` (`yuborildi`) + `transfer_out` harakati (`from` obyektda). Idempotent.
- `receive_transfer(p_transfer_id, p_qty_received_input text default null, p_note text default null)` — qabul qiluvchi obyektning prorab/omborchisi yoki admin; `transfer_in` harakati (`to` obyektda; miqdor — yuborilgan yoki kiritilgan, birlik — o'tkazmaniki), holat `qabul_qilindi`. Qabul miqdori yuborilgandan farq qilsa → `transfers.received_qty_base` va alert `xarid_qabul_farqi` emas — yangi alert turi **`otkazma_farqi`** (`details: {sent_qty_base, received_qty_base, diff_qty_base, base_unit, from_object_name, to_object_name}`; kam bo'lsa `ogohlantirish`).
- `cancel_transfer(p_transfer_id, p_reason)` — yuborgan odam yoki admin, faqat `yuborildi` holatida; `transfer_out` soft delete, holat `bekor`.
- Harakatlarni to'g'ridan-to'g'ri `transfer_*` bilan yaratish (Batch 1) faqat admin — o'zgarmaydi; RPC'lar shu cheklovni chetlab o'tmaydi, balki o'z tekshiruvini qiladi.
- Mini App: `/tg/request` → "O'tkazma" tab (yuborish); `/tg/movement` tepasida "Kelayotgan o'tkazmalar (N)" — bosilsa qabul qilish (miqdorni o'zgartirish mumkin).
- Veb `/movements` → "O'tkazmalar" tab: ro'yxat, holat, farq.

## Inventarizatsiya

- Mini App `/tg/inventory` (tekshiruvchi, admin): obyekt → "Yangi sanash" → materiallar ro'yxati (obyektda qoldig'i bor yoki smetadagi; qidiruv) → har biriga sanalgan miqdor + birlik (**kutilgan qoldiq ko'rsatilmaydi** — ko'r-ko'rona sanash) → qoralama avtomatik saqlanadi (`inventory_count_items`, `draft`) → "Yakunlash" (`submit_inventory_count`, Batch 1) — tasdiq oynasi.
- `inventory_count_items` ga `unit_id` va `qty_input` (Batch 1 da `qty_counted` asosiy birlikda) — yangi ustunlar `qty_input numeric(20,6)`, `unit_id`, `qty_counted` = `round(qty_input * factor, 6)` bazada (trigger, Batch 3 uslubi).
- **Qoida 5 — kamomad** (`inventarizatsiya_kamomadi`): `submit_inventory_count` ichida (yoki undan keyingi trigger) har qator `qty_counted < qty_expected` bo'lsa — hisob bo'yicha **bitta** alert: `details: {count_id, items: [{material_id, material_name, base_unit, expected, counted, shortage, shortage_value}], total_shortage_value, more_count}` (eng ko'p 20, kattasidan). `shortage_value` = kamomad × oxirgi 90 kunlik miqdorga tortilgan o'rtacha narx (`price_per_base`; yo'q bo'lsa null). `total_shortage_value ≥ 1 000 000` so'm → `jiddiy`.
- Ortiqcha (counted > expected) — alert emas, lekin ko'rsatiladi.
- **Tuzatish:** admin veb'da yakunlangan hisobni ko'rib "Qoldiqni tuzatish" — RPC `apply_inventory_adjustments(p_count_id)` (admin): har farq uchun `inventory_adjust` harakati (`inventory_count_id` bilan, ishorali), hisobga `applied_at`, `applied_by` (yangi ustunlar); ikki marta qo'llab bo'lmaydi.
- Veb `/movements` → "Inventarizatsiya" tab: hisoblar ro'yxati, tafsilot (kutilgan, sanalgan, farq, qiymat), "Qoldiqni tuzatish".

## Sof funksiyalar (`src/domain/`)

- `norms.ts`: `allowedQty(norm: Dec, wastePct: Dec): Dec`, `evaluateNorm({normQtyBase, wastePct, consumedQtyBase}): {status: 'ok' | 'over' | 'not_in_estimate'; allowed: Dec; overPct: Dec | null; severity: 'ogohlantirish' | 'jiddiy' | null}`, `evaluateRequest({requestedQtyBase, allowedQtyBase, consumedQtyBase, otherOpenQtyBase}): {over: boolean; available: Dec; overQty: Dec}`.
- `inventory.ts`: `shortageItems(items: {materialId, expected, counted}[]): {materialId, shortage}[]`, `shortageValue(shortage: Dec, pricePerBase: Dec | null): Dec | null` (2 xona), `shortageSeverity(totalValue: Dec | null): 'ogohlantirish' | 'jiddiy'`.
- Formulalar SQL bilan aynan bir xil (PGlite moslik testi): `allowed = round(norm * (1 + waste/100), 6)`; `over_pct = round((consumed - allowed) * 100 / allowed, 2)`; `shortage_value = round(shortage * price, 2)`.

## Amalga oshirish (baza — `20261101000001_requests.sql`)

To'liq tafsilot: `docs/db-design.md` → "So'rovlar, o'tkazmalar, inventarizatsiya, norma (Batch 8)". Shartnomaga aniqliklar:

- **Qoida 4:** bitta ochiq alert (obyekt, material) — boshqa smeta versiyasi uchun ochilgani `closed_reason = 'estimate_changed'` bilan yopiladi va yangi versiya bo'yicha baholanadi; joriy smeta o'chirilsa — `no_current_estimate`. Avtomatik yopish sabablari: `within_threshold`, `estimate_changed`, `no_current_estimate`. Admin qo'lda yopgani bir xil (smeta, allowed, consumed) da qayta ochilmaydi. `not_in_estimate` alertida `over_pct = null`.
- **Qoida 6:** obyektda joriy smeta umuman yo'q bo'lsa — alert yaratilmaydi (asos yo'q, shovqin); qoida 4 ham smetasiz obyektda alert bermaydi. Joriy smeta bor, material unda yo'q — `not_in_estimate = true` alert (allowed = 0). Yopish sabablari: `request_rejected`, `request_deleted`, `within_threshold`, `no_current_estimate`.
- **Tasdiqlangan qarorlar:** (1) `transfers` ga to'g'ridan-to'g'ri yozuv hech kimga (admin ham) — faqat RPC; `transfer_*` harakatlarni admin to'g'ridan-to'g'ri yarata oladi (Batch 1). (3) O'tkazma bekor qilinganda `yozuv_ochirildi` alerti yaratilmaydi. (4) `materials.waste_pct` o'zgarishi norma alertlarini darhol qayta baholamaydi — keyingi chiqim / smeta o'zgarishida.
- **So'rov:** `decision_note` — faqat admin; `purchase_id` — faqat `xarid_qilindi` holatida, xarid shu obyekt va materialniki (`request_purchase_invalid`, `purchase_not_open`).
- **"Qayerga" ro'yxati:** `transfer_target_objects() → table(id, name)` — firmaning faol, o'chirilmagan obyektlari (admin, super_admin, prorab; boshqalar 42501).
- **O'tkazma RPC'lari:** `create_transfer(... p_qty_input numeric, p_note text default null) → uuid`; `receive_transfer(p_transfer_id, p_qty_received_input text default null, p_note text default null) → void`; `cancel_transfer(p_transfer_id, p_reason text default null) → void`. `transfers` ga to'g'ridan-to'g'ri INSERT/UPDATE (har qanday foydalanuvchi, admin ham) — `transfer_direct_edit`. Qabul takrorlansa shu miqdor bilan — o'zgarishsiz (idempotent); 0 qabul qilish mumkin (harakatsiz, alert). `otkazma_farqi` — kam ham, ko'p ham `ogohlantirish`; `details` ga qo'shimcha `transfer_id`, `direction` (`under`/`over`); `diff_qty_base = received − sent`. Bekor qilishda `yozuv_ochirildi` alerti yaratilmaydi.
- **Inventarizatsiya:** qatorga `unit_id` + `qty_input` yuboriladi (`qty_counted` ni baza hisoblaydi); `unit_id` siz eski klient — `qty_counted` asosiy birlikda qabul qilinadi. Kamomad alerti `material_id = null`, ro'yxat `shortage` bo'yicha (kattasidan), narx `numeric(18,4)`. `apply_inventory_adjustments(p_count_id) → integer` (yaratilgan harakatlar soni).
- **Telegram:** `otkazma_farqi` darhol yuboriladi (Batch 6 trigger sharti o'zgarmadi); Edge Function shabloniga yangi tur qo'shilishi kerak.

## Review tuzatishlari (shartnoma o'zgarishlari)

Tafsilot: `docs/db-design.md` → "Review tuzatishlari (Batch 8)".

- **Tekshiruvchi** `movements`, `purchases`, `stock_balances`, `norm_usage`, `purchase_receipts` va `inventory_count_items.qty_expected` ni ko'rmaydi. Sanash ro'yxati — `inventory_candidate_materials(p_object_id) → table(material_id uuid)` (miqdorsiz).
- `submit_inventory_count(p_count_id) → jsonb {has_shortage, not_counted_count}` (raqamsiz).
- Natija (kutilgan, farq, qiymat) — `inventory_count_details(p_count_id)` (admin, direktor, buxgalter): `material_id, material_name, base_unit, qty_input, unit_id, qty_counted, qty_expected, diff, shortage_value` — raqamlar `text`.
- Kamomad alerti: `not_counted` (sanalmagan, qoldig'i bor materiallar), `not_counted_more`; tuzatilgandan keyin `applied_at`, `applied_by_name`. Yuborilgan hisob qatorlari qulflangan (`inventory_locked`).
- **Qoida 6:** `available = allowed − max(consumed, delivered) − other_open`, `delivered = kirim + transfer_in − transfer_out`; `details.delivered_qty_base`; `norm_usage.delivered_qty_base`.
- **O'tkazma:** qabul obyekti faol bo'lishi shart; `transfer_receive_hours` (standart 48) dan ko'p qabul qilinmasa — `otkazma_farqi` `direction = 'not_received'` (qabul/bekorda `transfer_received` / `transfer_cancelled` bilan yopiladi); o'zi yuborib o'zi qabul — `ozi_qabul_qilgan` (`kind: 'transfer'`); bekor qilish — yaratuvchi hali `from` a'zosi bo'lsa yoki admin.
- **So'rov holatlari:** tasdiqlash / rad etish — faqat admin; taminotchi — faqat `tasdiqlandi → xarid_qilindi`.
- **Telegram:** 4-qoida alerti kuchaysa (jiddiy / 50 % / 100 %) — yangi xabar (`payload.escalation` 1/2/3). Kunlik hisobotda `transfers_pending_count`, `chiqim_without_estimate_count`. `waste_pct` o'zgarishi — `smeta_ozgarishi` (`kind: 'waste_changed'`).
