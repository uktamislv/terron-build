# Hisobotlar (Batch 9)

Hamma hisobot ma'lumoti **RLS orqali** (invoker RPC/view) — har kim faqat o'zi ko'ra oladigan qismni ko'radi (prorab — o'z obyektlari; direktor — hammasi). Sana chegaralari — Asia/Tashkent kunlari.

## Davr va filtr

- Davr: Bugun, Kecha, 7 kun, 30 kun, Shu oy, O'tgan oy, Ixtiyoriy (`dd.mm.yyyy` – `dd.mm.yyyy`). Standart — 7 kun.
- Obyekt filtri: Hammasi / bitta obyekt.
- Davr URL query'da (`?from=2026-10-01&to=2026-10-31&object=...`) — havolani ulashish mumkin.

## RPC'lar (`security invoker`, `stable`, `search_path=''`, anon yo'q)

- `public.dashboard_summary(p_from date, p_to date, p_object_id uuid default null) returns jsonb`:
  `{ kirim_count, chiqim_count, purchases_count, purchases_sum, cash_issued_sum, cash_on_hand_total, alerts_open, alerts_serious_open, alerts_new_in_period, unreceived_purchases_count, pending_transfers_count, pending_requests_count, objects_over_norm_count }` — pul `text`. `unreceived_purchases_count` — 24 soatdan eski va 90 kundan yangi, bog'langan tirik kirimi yo'q xaridlar; `objects_over_norm_count` — `norm_usage` bo'yicha sarfi ruxsatdan oshgan (smetada yo'q, lekin sarfi bor ham) materiali bor obyektlar soni (RLS bo'yicha).
- `public.dashboard_daily(p_from date, p_to date, p_object_id uuid default null) returns table(day date, kirim_count int, chiqim_count int, purchases_sum text, alerts_count int)` — har Toshkent kuni uchun (bo'sh kunlar ham, `generate_series`), ≤ 366 qator (kun).
- `public.spend_breakdown(p_from date, p_to date, p_object_id uuid default null, p_group text default 'material') returns table(key uuid, label text, purchases_sum text, purchases_count int)` — `p_group`: `material` | `object` | `buyer` | `supplier`; kamayish tartibida.
- `public.norm_overview(p_object_id uuid default null) returns table(object_id, object_name, material_id, material_name, base_unit, norm_qty_base, allowed_qty_base, consumed_qty_base, usage_pct)` — `norm_usage` asosida (ism bilan); faqat joriy smetali obyektlar.
- Chegaralar: davr ko'pi bilan **366 kun, ikkala chegara kiradi** — ya'ni `p_from <= p_to` va `p_to - p_from <= 365` (masalan 01.01.2026–01.01.2027 — 366 kun, ruxsat; 01.01.2026–02.01.2027 — 367 kun, xato); aks holda `22023`, `hint: report_period_invalid`. Klient (`periodRange` / ixtiyoriy davr) ham shu ta'rifni ishlatadi.

## Veb bosh sahifa (`/`, `DashboardPage`)

- Kartochkalar: Kirim / Chiqim (soni), Xaridlar (soni, summa), Berilgan pul, Qo'ldagi pul (jami), Ochiq ogohlantirishlar (jiddiylari qizil), Qabul qilinmagan xaridlar, Kutilayotgan so'rovlar, Normadan oshgan obyektlar. Har kartochka tegishli sahifaga havola (filtr bilan).
- Diagrammalar (Recharts, lazy chunk):
  1. **Kunlik dinamika** — kirim/chiqim soni (ustun) + xarid summasi (chiziq, ikkinchi o'q).
  2. **Smeta va haqiqiy** — materiallar bo'yicha norma (isrof bilan) va sarf (gorizontal ustunlar), eng ko'p ishlatilgan 10 tasi; oshganlar qizil.
  3. **Xarajat taqsimoti** — material / obyekt / xaridor / sotuvchi bo'yicha (tugmalar), top 8 + "Boshqa".
  4. **Podotchet** — odamlar bo'yicha qo'ldagi pul (`cash_balances`), manfiy qizil.
- Oxirgi ogohlantirishlar ro'yxati (5 ta) va "Hammasi" havolasi.
- Rolga qarab: direktor/admin/buxgalter — hammasi; prorab — o'z obyektlari (RLS); omborchi — kirim/chiqim va qoldiq kartochkalari; taminotchi — xaridlar; tekshiruvchi — faqat o'z inventarizatsiyalari (kartochkalarsiz).
- Rasm/diagramma ranglari CLAUDE.md palitrasi: asosiy `#1E5EFF`, to'q `#0B2A6B`, och `#EAF1FF`, holat ranglari.

## Excel eksport

- Tugma "Excel" har jadval sahifasida: Ombor harakatlari, Qoldiq, Xaridlar, Podotchet (balans + tarix), So'rovlar, Ogohlantirishlar, Sarf va norma, bosh sahifa xulosasi.
- Joriy filtr va davr bo'yicha **barcha** qatorlar (sahifalashsiz, 1000 tadan bo'lib yuklanadi), ≤ 50 000 qator.
- SheetJS (lazy), fayl nomi `terron-<bo'lim>-<dd.mm.yyyy>.xlsx`.
- Ustunlar o'zbekcha sarlavhali; sana — Excel sana katagi (`dd.mm.yyyy`), pul va miqdor — **son katagi** (aniq qiymatdan; 15 qiymatli raqamdan uzun bo'lsa — matn), so'm formati `# ##0`.
- **Formula injection himoyasi:** matn kataklari `=`, `+`, `-`, `@`, tab, CR bilan boshlansa — oldiga `'` qo'yiladi va `t: 's'`.
  Foydalanuvchilar uchun izoh: *ba'zi matnlar oldida `'` belgisi bor — bu Excel formula xavfsizligi uchun (masalan
  `=` yoki `-` bilan boshlangan izoh formula sifatida bajarilmasin); qiymatning o'zi o'zgarmagan.*
- Pul formati — `#,##0` (Excel minglik ajratuvchisi tizim tilidan olinadi: o'zbek/rus Excel'da bo'sh joy).
  Literal `# ##0` ishlatilmaydi — u bo'sh joyni qat'iy joyga qo'yadi ("1234 567").
- Birinchi qator qotirilgan (SheetJS CE yozmaydi — tayyor zip ichidagi varaq XML'iga `pane` qo'shiladi).
- Bo'lib yuklash: `count: 'exact'` faqat birinchi bo'lakda; barcha bo'laklarda `created_at <= eksport boshlangan vaqt`
  (eksport paytidagi yangi yozuvlar siljitmaydi); natija `id` bo'yicha takrorsiz. `.in(ids)` so'rovlari 100 talik
  bo'laklarda, ketma-ket (URL uzunligi).

## Mini App direktor bosh ekrani (`/tg`)

- Faqat ko'rish. Tepada: bugungi kirim/chiqim soni, xaridlar summasi, ochiq ogohlantirishlar (jiddiylari).
- "Smeta ishlatilishi" — obyektlar bo'yicha o'rtacha `usage_pct` va normadan oshgan materiallar soni; obyekt bosilsa — materiallar ro'yxati (progress).
- Oxirgi 10 ta ogohlantirish (tur, obyekt, qisqa matn, vaqt).
- Davr: Bugun / 7 kun tugmalari.

## Sof funksiyalar (`src/domain/reports/`)

- `periodRange(preset, todayIso): { from: string; to: string }` — Toshkent kuni bo'yicha; `presets` ro'yxati.
- `fillDays(rows, from, to)` — bo'sh kunlarni nol bilan to'ldirish.
- `topN(rows, n, valueKey, otherLabel)` — top N + "Boshqa" (Dec yig'indisi).
- `safeCell(value: string): string` — formula injection himoyasi.
- `decToExcelNumber(dec: Dec): number | string` — ≤ 15 qiymatli raqam bo'lsa son, aks holda matn.
