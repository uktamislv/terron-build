# TERRON Build — qurilish firmalari uchun boshqaruv tizimi

Bu fayl loyihaning asosiy yo'riqnomasi. Har bir ishni boshlashdan oldin shu faylni o'qi va qoidalarga amal qil.

## Maqsad

Qurilish firmasida material va pul yo'qolishini kamaytiradigan veb tizim. Kelajakda boshqa firmalarga obuna (SaaS) sifatida sotiladi, shuning uchun boshidanoq ko'p firmali quriladi.

**Hozirgi bosqich — SINOV VERSIYASI.** Tizim haqiqiy qurilish firmasiga (quruvchiga) beriladi: prorab, omborchi, ta'minotchi, haydovchi va direktor bitta umumiy baza bilan ishlab ko'radi. Sinov versiyasi **ikki interfeysdan** iborat va ikkalasi birga quriladi:

- **Veb panel** — admin, buxgalter, ta'minotchi uchun (kompyuter va telefonda ishlaydi)
- **Telegram Mini App** — prorab, omborchi, haydovchi, tekshiruvchi va direktor uchun (asosiy kundalik ish shu yerda)

## Stack

- React 18 + TypeScript (strict) + Vite
- Tailwind CSS
- Supabase: PostgreSQL, Auth, RLS, Storage (rasmlar uchun), keyinroq Edge Functions
- Recharts — diagrammalar
- SheetJS (`xlsx`) — Excel import va eksport
- Vitest — testlar
- Telegram WebApp SDK (`https://telegram.org/js/telegram-web-app.js`) — Mini App
- Supabase Edge Functions (Deno) — Telegram autentifikatsiyasi va bot
- `pg_cron` + `pg_net` — kunlik hisobot va ogohlantirish xabarlari
- Hosting: **Cloudflare Workers Static Assets** — faqat frontend (`dist/`), sozlama `wrangler.jsonc` da. Backend to'liq Supabase'da; Cloudflare'da API, baza yoki sir yo'q. Mini App ham shu HTTPS domendan ochiladi (`https://<domen>/tg`). Netlify, Vercel, GitHub Pages ishlatilmaydi
- GitHub Actions — har push'da lint, typecheck, test; `main` ga push'da `wrangler deploy`

## Arxitektura qoidalari (buzilmaydi)

1. **Ko'p firmalilik.** Har bir biznes jadvalida `company_id` bor. Har bir jadvalda RLS yoqilgan; foydalanuvchi faqat o'z firmasining ma'lumotini ko'radi. RLS siyosatlari uchun testlar yoziladi.
2. **Ma'lumot qatlami alohida.** Supabase'ga murojaat faqat `src/data/` ichidagi repository fayllarida (`materialsRepo.ts`, `movementsRepo.ts` va h.k.). Komponentlar Supabase'ni to'g'ridan-to'g'ri chaqirmaydi.
3. **Hech narsa butunlay o'chirilmaydi.** Barcha jadvallarda `deleted_at` (soft delete). O'chirilgan yozuv tarixda ko'rinadi va tiklanadi.
4. **Audit log.** Har bir INSERT/UPDATE/DELETE PostgreSQL trigger orqali `audit_log` jadvaliga yoziladi: kim, qachon, jadval, yozuv, eski qiymat, yangi qiymat, qurilma (veb/mobil).
5. **Har bir yozuvda** `created_by`, `created_at`, `updated_at`.
6. **Birliklar.** Har bir material asosiy birlikda hisoblanadi. Kiritishda foydalanuvchi istalgan birlikni tanlaydi; bazada ikkalasi ham saqlanadi: `qty_input` + `unit_input` va `qty_base`. Konvertatsiya bitta funksiyada va to'liq test bilan qoplangan.
7. **Pul va miqdor** — `numeric`, hech qachon `float`. Pul — so'm.
8. **Vaqt zonasi** — Asia/Tashkent. Sana formati — `dd.mm.yyyy`.
9. **Til** — interfeys o'zbek tilida (lotin). Matnlar `src/i18n/uz.ts` faylida turadi, keyin rus tili qo'shilishi uchun.
10. **Maxfiy kalitlar** — faqat `.env` da. `service_role` kaliti hech qachon frontend kodiga tushmaydi. `.env` git'ga qo'shilmaydi.

## Bitta loyiha — ikki interfeys

Veb panel va Mini App **bitta repozitoriyada, bitta React ilovasida** quriladi:

- `/` — veb panel (yon menyuli keng layout)
- `/tg/*` — Mini App (telefon layout, pastki menyu)
- `src/data/` (repository qatlami) va `src/domain/` (birlik konvertatsiyasi, farq qoidalari) ikkala interfeys uchun **umumiy**. Mantiq takrorlanmaydi.

### Mini App ekranlari (sinov versiyasi)

| Ekran | Kim uchun |
|---|---|
| Bosh — bugungi holat, smeta ishlatilishi, ogohlantirishlar (faqat ko'rish) | direktor |
| Kirim / chiqim — almashtirgich, material tugmalari, birlik tanlash, ixtiyoriy rasm | prorab, omborchi |
| Xarid — qo'limdagi pul, material, miqdor, summa, obyekt, ixtiyoriy chek rasmi | haydovchi, ta'minotchi, prorab |
| So'rov va o'tkazma | prorab |
| Inventarizatsiya — qoldiqni sanash | tekshiruvchi |
| Mening yozuvlarim — o'zi kiritgan oxirgi yozuvlar va ularning holati | hammasi |

Telegram imkoniyatlaridan foydalan: `MainButton` (Saqlash), `BackButton`, `HapticFeedback`, `expand()`. Ranglar Telegram mavzusiga emas, bizning ko'k-oq dizaynimizga tayanadi.

### Telegram orqali kirish (xavfsizlik — muhim)

1. Admin veb paneldan foydalanuvchini telefon raqami va roli bilan qo'shadi.
2. Foydalanuvchi Mini App'ni birinchi marta ochganda `requestContact` orqali raqamini ulashadi; raqam mos kelsa, `profiles.telegram_user_id` saqlanadi.
3. Har safar Mini App ochilganda `initData` **Edge Function'da** (`tg-auth`) bot tokeni bilan HMAC orqali tekshiriladi, `auth_date` eskirmaganligi tekshiriladi, keyin shu foydalanuvchi uchun Supabase sessiyasi beriladi. RLS veb paneldagidek ishlaydi.
4. Klientdagi `initDataUnsafe` ga hech qachon ishonilmaydi. Bot tokeni faqat Supabase secrets'da.

### Telegram bot

- `alerts` jadvaliga yangi yozuv tushganda direktor va adminga darhol xabar (farq, o'chirish, narx og'ishi).
- Har kuni 20:00 (Asia/Tashkent) direktorga kunlik hisobot: kirim, chiqim, xaridlar, so'rovlar, farqlar soni + "Mini App'ni ochish" tugmasi.
- Xabar matnlari `src/i18n/` dan emas, Edge Function ichidagi shablondan, lekin bitta joyda.

## Rollar

| Rol | Nima qila oladi |
|---|---|
| `super_admin` | Hammasi, barcha firmalar (tizim egasi) |
| `admin` | Firma ichida hammasi, foydalanuvchi qo'shadi, sozlamalar |
| `direktor` | Faqat ko'rish: hisobot, farqlar, tarix |
| `buxgalter` | Ro'yxatlar, hisobotlar, podotchet berish |
| `taminotchi` | Xarid kiritadi |
| `prorab` | Kirim, chiqim, xarid, so'rov — faqat biriktirilgan obyektlarda |
| `omborchi` | Kirim, chiqim — faqat biriktirilgan obyektlarda |
| `haydovchi` | Faqat o'z xaridini kiritadi va qo'lidagi pulni ko'radi |
| `tekshiruvchi` | Inventarizatsiya o'tkazadi |

Foydalanuvchi va obyekt o'rtasida ko'pga-ko'p bog'lanish (`object_members`): bitta prorab bir nechta obyektda bo'lishi mumkin, bitta obyektda bir nechta odam. Agar foydalanuvchida bitta obyekt bo'lsa, formalarda u avtomatik tanlanadi.

## Asosiy jadvallar

- `companies` — firmalar, sozlamalar (farq chegarasi, narx og'ish chegarasi %)
- `profiles` — foydalanuvchi, `company_id`, rol, ism, telefon, `telegram_user_id`, `telegram_chat_id`
- `objects`, `object_members`
- `materials` — nom, asosiy birlik, isrof foizi, faol/nofaol
- `material_units` — `material_id`, birlik, koeffitsient (asosiy birlikka), ixtiyoriy `variant` nomi (masalan "bir g'isht · 250 mm")
- `material_aliases` — boshqa nomlar (masalan ruscha "Цемент М500"), smeta importida avtomatik moslash uchun
- `suppliers`
- `cash_advances` — kimga qancha pul berildi (podotchet)
- `purchases` — kim, nima, qancha, narx, summa, obyekt, sotuvchi, ixtiyoriy chek rasmi
- `movements` — tur: `kirim`, `chiqim`, `transfer_out`, `transfer_in`, `inventory_adjust`; obyekt, material, miqdor (kiritilgan va asosiy birlikda), bog'langan `purchase_id`, ixtiyoriy rasm, kim kiritgan
- `inventory_counts`, `inventory_count_items`
- `estimates` (smeta versiyalari), `estimate_items` (ish turi yoki material, birlik, miqdor, narx, norma)
- `material_requests` — prorab so'rovi, holat: kutilmoqda / tasdiqlandi / rad / xarid qilindi
- `transfers` — obyektlar orasida o'tkazma
- `alerts` — tizim topgan farqlar, holat: yangi / ko'rildi / yopildi
- `audit_log`

Qoldiq alohida jadvalda saqlanmaydi — `movements` dan hisoblanadi (view yoki funksiya).

## Farqlarni aniqlash qoidalari (`alerts`)

1. **Xarid ≠ qabul** — xarid miqdori va bog'langan kirim(lar) yig'indisi farq qilsa (firma sozlamasidagi chegaradan ko'p).
2. **O'zi tekshirmagan** — xarid qilgan va qabul qilgan bitta odam bo'lsa, belgi qo'yiladi (ogohlantirish emas, belgi).
3. **Narx og'ishi** — xarid narxi shu materialning oxirgi N ta xaridi o'rtachasidan chegaradan ko'p yuqori bo'lsa (standart ±8 %).
4. **Normadan oshish** — obyektdagi chiqim smeta normasidan oshsa.
5. **Inventarizatsiya kamomadi** — sanalgan qoldiq hisobdagidan kam bo'lsa.
6. **Smetadan ortiq so'rov** — so'ralgan miqdor smetada qolgan miqdordan ko'p bo'lsa.

Har bir qoida alohida, sof (pure) funksiya va unit testlar bilan.

## Dizayn

- Ranglar: asosiy ko'k `#1E5EFF`, to'q ko'k `#0B2A6B` (yon menyu), och ko'k `#EAF1FF`, oq fon
- Holat ranglari: qizil `#B3261E` (farq/kamomad), sariq-jigarrang `#8A5300` (ogohlantirish), yashil `#1B6E35` (joyida)
- Shrift: Inter
- Tugmalar va bosiladigan joylar kamida 44 px balandlikda
- Material tanlash — matn yozish emas, tugmalar orqali
- Kirim/chiqim formasi telefonda 3–4 bosishda tugashi kerak
- Rasm odatda ixtiyoriy. Istisno: firma belgilagan summadan katta xarid va "rasm majburiy" deb belgilangan materiallar (Batch 12)

## Sub-agentlar

`.claude/agents/` ichida quyidagi sub-agentlarni yarat va ishni ularga bo'lib ber:

- **db-architect** — migratsiyalar, jadvallar, RLS, triggerlar, view'lar, seed
- **frontend** — sahifalar, komponentlar, formalar, mobil moslashuv
- **domain-logic** — birlik konvertatsiyasi, farq qoidalari, smeta import mantiqi (sof funksiyalar)
- **tester** — Vitest testlari, RLS testlari, har batch oxirida tekshiruv
- **reviewer** — har batch oxirida kodni xavfsizlik va qoidalarga muvofiqlik bo'yicha ko'rib chiqadi

## Batch rejasi (sinov versiyasi)

Har bir batch oxirida: testlar o'tadi, typecheck toza, qisqa hisobot yoziladi. **Keyingi batch'ga faqat men tasdiqlaganimdan keyin o'tiladi.** Veb va Mini App ekranlari bir batch ichida parallel qilinadi, chunki ma'lumot qatlami umumiy.

- **Batch 0 — Asos.** Vite + React + TS + Tailwind, router (`/` va `/tg`), Supabase client, `.env.example`, papka tuzilmasi, GitHub Actions, Cloudflare'ga birinchi deploy. BotFather'da bot yaratish va Mini App URL'ini ulash bo'yicha menga qadamma-qadam yo'riqnoma.
- **Batch 1 — Ma'lumotlar bazasi.** Barcha jadvallar, RLS, audit trigger, soft delete, qoldiq view. Seed: namuna firma, 3 obyekt, materiallar shabloni (g'isht, sement, qum, shag'al, armatura, beton, kafel va ularning birliklari).
- **Batch 2 — Kirish va rollar.** Veb: email/telefon bilan kirish. Mini App: `tg-auth` Edge Function, kontakt orqali bog'lash. Admin foydalanuvchi qo'shadi, rol beradi, obyektga biriktiradi. Rolga qarab menyu.
- **Batch 3 — Materiallar va birliklar.** Katalog (veb), birliklar va koeffitsientlar (doimiy va variantli), ruscha muqobil nomlar. Konvertatsiya funksiyasi to'liq testlar bilan.
- **Batch 4 — Kirim, chiqim, qoldiq.** Mini App: kirim/chiqim ekrani. Veb: ombor harakatlari jadvali va qoldiq. Ixtiyoriy rasm (Supabase Storage).
- **Batch 5 — Podotchet va xarid.** Veb: pul berish, har bir odamning qo'lidagi pul. Mini App: xarid ekrani. Xaridni kirim bilan bog'lash, farq qoidalari 1–3.
- **Batch 6 — Telegram bot.** Ogohlantirishlarni darhol yuborish, kunlik hisobot (`pg_cron`), Mini App'ga havola tugmasi.
- **Batch 7 — Smeta Excel importi (veb).** Fayl yuklash → ustunlarni moslash (shablon firma uchun eslab qolinadi) → katalogga moslash → birlik savollari → tekshirish → saqlash. Yangi versiya yuklansa, eski bilan farqni ko'rsatish.
- **Batch 8 — So'rovlar, o'tkazmalar, inventarizatsiya, norma.** Mini App: so'rov/o'tkazma va inventarizatsiya ekranlari. Veb: tasdiqlash. Farq qoidalari 4–6.
- **Batch 9 — Hisobotlar.** Veb bosh sahifa: raqamli kartochkalar, diagrammalar (smeta va haqiqiy, sarf, xarajat taqsimoti, podotchet), ogohlantirishlar, Excel eksport. Mini App: direktor bosh ekrani.
- **Batch 10 — Tarix.** O'zgarishlar tarixi sahifasi, filtrlar, o'chirilgan yozuvni tiklash.
- **Batch 11 — Topshirish.** To'liq sinov ma'lumotlari, quruvchi uchun qisqa qo'llanma (har bir rol uchun 1 sahifa), Mini App ichida "xatolik haqida xabar berish" tugmasi.
- **Batch 12 — Avtomatlashtirish.** Kirimni xaridga avtomatik bog'lash, manfiy qoldiq, takroriy yozuv, joylashuv (GPS) belgisi, chegaradan katta xaridda rasm majburiy, smetasiz chiqim, chek QR (soliq.uz), so'rov → xarid zanjiri, podotchet qaytarish va muddat, eslatmalar va Telegram tugmalari, material tugash prognozi. Dizayn: `docs/automation-design.md`. Batch 11 dan oldin bajariladi.

## Sinov versiyasiga KIRMAYDI (keyingi bosqich)

Buxgalteriya (bank), buyurtmachilar va aktlar, yetkazib beruvchilar qarzi, pul oqimi prognozi, ish grafigi, texnika va yoqilg'i, hujjatlar arxivi, chekdan avtomatik o'qish, Mini App'da oflayn rejim, obuna va to'lov. Lekin bazani shunday tuzki, bularni keyin qo'shish oson bo'lsin.
