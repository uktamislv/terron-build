# TERRON Build — dizayn tizimi

## Mavzu va auditoriya

Qurilish firmasida material va pul nazorati. Prorab va omborchi — maydonda, telefonda, quyosh ostida, qo'li band; direktor — telefonda tez ko'z yugurtiradi; admin va buxgalter — kompyuterda uzun jadvallar bilan. Har ekranning asosiy ma'lumoti — **miqdor va summa**.

## G'oya: "yuk xati" (nakladnoy)

Qurilishda har bir material harakati qog'ozda yuk xati bilan qayd etiladi: material nomi, katta yozilgan miqdor va birlik, kim, qachon, qayerga. Interfeys shu tilni oladi:

- **Raqam — qahramon.** Miqdor va summa har doim eng katta, `tabular-nums`, birlik kichik va kulrang yonida (`150` `kg`). Bu yagona "jasur" element — qolgan hamma narsa sokin.
- **Qator = yozuv.** Harakat, xarid, so'rov — chap tomonda rangli vertikal chiziq (tur: kirim — yashil, chiqim — ko'k, xarid — to'q ko'k, o'tkazma — kulrang-ko'k, o'chirilgan — chiziqli), o'rtada nom va meta, o'ngda katta raqam.
- **Daraja chizig'i.** Qoldiq va smeta ishlatilishi — ingichka gorizontal "daraja" chizig'i (normadan oshganda chiziq chegaradan o'tib qizarib ketadi), foiz o'ngda.

## Ranglar (CLAUDE.md palitrasi asosida)

Manba — `src/index.css` dagi `@theme`. JS nusxasi — `src/components/ui/tokens.ts` (`colors.*`): Recharts, Telegram (`setHeaderColor`, `setBottomBarColor`, `MainButton`), SVG belgilar shu yerdan oladi. Kodda `[#…]` ko'rinishidagi ixtiyoriy rang yozilmaydi — faqat tokenlar.

| Token | Hex | Ishlatilishi |
|---|---|---|
| `brand` | `#1E5EFF` | asosiy tugma, faol holat, havolalar, chiqim |
| `brand-600` | `#1A52E0` | asosiy tugma hover |
| `brand-700` | `#1747C4` | asosiy tugma bosilgan (active) |
| `brand-300` | `#7FA2FF` | to'q fondagi (navy, toast) havola, faol menyu chizig'i |
| `navy` | `#0B2A6B` | yon menyu, sarlavhalar, xarid belgisi, diagrammadagi summa chizig'i |
| `ice` | `#EAF1FF` | tanlangan fon, chip fon, faol menyu orqasi |
| `ice-hover` | `#DCE8FF` | `ice` fondagi tugma hover |
| `paper` | `#FFFFFF` | kartochka, jadval, Telegram pastki paneli |
| `canvas` | `#F4F6FA` | sahifa foni, Telegram sarlavha paneli (sovuq kulrang — iliq krem emas) |
| `ink` | `#0E1A33` | asosiy matn (navy-ga moyil) |
| `muted` | `#5A6A86` | ikkinchi darajali matn, birliklar, placeholder (shaffoflik qo'shilmaydi — kontrast) |
| `muted-300` | `#9AA8C0` | diagrammadagi "Boshqa" ustuni (matn uchun emas) |
| `line` | `#DCE3EF` | kartochka chegaralari, ajratgichlar |
| `line-hover` | `#C5D0E3` | kartochka/chip hover chegarasi |
| `line-strong` | `#7D8BA3` | input, checkbox, qidiruv chegarasi (≥ 3:1 kontrast) |
| `danger` | `#B3261E` (fon `#FDECEA`, JS: `dangerBg`) | farq, kamomad, oshish, manfiy |
| `warn` | `#8A5300` (fon `#FFF4E0`) | ogohlantirish |
| `ok` | `#1B6E35` (fon `#E7F5EC`) | joyida, kirim |
| `ok-300` | `#7EE2A0` | to'q fondagi (toast) "joyida" belgisi |
| `transfer` | `#52709F` | o'tkazma (EntryRow chizig'i, belgi) |

Gradientlar yo'q. Soya faqat "suzuvchi" elementlarda (pastki varaq, menyu, toast): `0 8px 24px rgba(11,42,107,.12)`. Kartochkalar — 1px `line` chegara, soyasiz.

### Kontrast

- Matn rangiga shaffoflik qo'shilmaydi (`text-brand/80`, `text-white/80`, `text-danger/75`, `text-muted/70` yo'q) — to'liq token.
- Placeholder — `text-muted`; katta raqam maydonida — `text-muted/40` (faqat "0" ishorasi).
- Input, checkbox, qidiruv chegarasi — `line-strong`; `line` — faqat kartochka ajratgichlari.

### Holat semantikasi

- Kirim — `ok`, chiqim — `brand`, xarid/summa — `navy`, o'tkazma — `transfer`, inventarizatsiya tuzatishi — neytral. Diagrammalar ham shu ranglarda (kunlik: kirim yashil, chiqim ko'k, summa chizig'i navy).
- Qizil (`danger`) faqat haqiqiy muammo uchun: kamomad, normadan oshish, manfiy qoldiq/balans, jiddiy ogohlantirish. Norma jadvalida material nomi faqat oshganda qizil. Ogohlantirish holati "yangi" — `info` (ko'k), "ko'rildi" — neytral, "yopildi" — `ok`.
- Rang yagona belgi emas: manfiy son U+2212 minus bilan yoziladi (podotchet diagrammasidagi manfiy ustun yonida ham qiymat yoziladi), holat — belgi va matn bilan.
- Ochiq ogohlantirishlar kartochkasi: jiddiy bor — `danger`, ogohlantirish bor — `warn`, yo'q — `ok`. "hozir" belgisi — `ice` fon, `brand` matn.
- `warn` va `danger` — faqat ogohlantirishlar (alerts) uchun, veb va Telegram ilovasida bir xil. Reja holatlari muammo emas (`src/components/statusTones.ts`): so'rov "kutilmoqda" va "tasdiqlandi" — `info`, "rad" — neytral, "xarid qilindi" — `ok`; o'tkazma "yuborildi" — `info`, "qabul qilindi" — `ok`, "bekor" — neytral. So'rov qatorining chap chizig'i — neytral (holat belgida).

## Shrift

- **Inter** (CLAUDE.md) — yagona oila, o'z serverimizdan: `@fontsource-variable/inter` (faqat latin, latin-ext va kirill qism-to'plamlari — `src/index.css` dagi `@font-face`). Google Fonts ishlatilmaydi. Raqamlarda `font-variant-numeric: tabular-nums`, `font-feature-settings: 'cv11'` (oddiy "1" va "l" farqi).
- Og'irliklar: 400 matn, 600 sarlavha va raqam, 700 faqat qahramon raqam.
- KATTA HARFLI yorliqlar yo'q; sarlavha ustida "eyebrow" yo'q; meta ma'lumot "·" bilan ulanmaydi — alohida qatorlar yoki belgi + matn.

### Matn shkalasi

| Klass | px | Ishlatilishi |
|---|---|---|
| `text-xs` | 12 | meta, belgi (badge), pastki menyu yorlig'i |
| `text-sm` | 14 | jadval, ikkinchi darajali matn, yorliqlar |
| `text-base` | 16 | asosiy matn, inputlar (iOS zoom bo'lmasin), EntryRow nomi |
| `text-lg` | 18 | modal sarlavhasi, `Qty` hero birligi, katta maydon ichidagi birlik |
| `text-xl` | 20 | **bo'lim / kartochka sarlavhasi** (`Card`, `SectionTitle`, Mini App sarlavhasi) |
| `text-2xl` | 24 | StatTile raqami, telefondagi sahifa sarlavhasi |
| `text-page` | 28 | sahifa sarlavhasi (`PageHeader`, kompyuter) — `--text-page: 1.75rem` |
| `text-hero` | 40 | qahramon raqam (`Qty size="hero"`, katta miqdor/summa maydoni) — `--text-hero: 2.5rem` |

`text-[15px]`, `text-[11px]`, `text-[28px]`, `text-[40px]`, `text-[44px]` kabi ixtiyoriy o'lchamlar ishlatilmaydi.

### Raqam va sana formati (`src/lib/format.ts`)

- Minglik guruh — tor bo'linmas bo'shliq U+202F (`1 250 000`), kasr — vergul. `parseDec` U+202F ni bo'shliq sifatida qabul qiladi.
- Raqam va birlik orasida — bo'linmas bo'shliq U+00A0 (`formatQtyUnit` → `150 kg`, `formatSum` → `1 250 000 so'm`); "so'm" — `t.ui.sum` dan.
- Minus — U+2212 (`−80 kg`), chiziqcha emas.
- Yordamchilar: `formatQty`, `formatQtyUnit`, `formatSum`, `formatSumNumber`, `formatDate`, `formatDateTime`, `formatTime` (`HH:mm`; `formatDateTime(...).slice(-5)` ishlatilmaydi), `isoDateToDisplay`, `parseDisplayDate`, `maskDateInput`.
- Excel eksportida raqamlar raqam katakchasi bo'lib qoladi (matnga aylantirilmaydi).

## Shakl

- Radius ierarxiyasi: sahifa bo'limi 16, kartochka/qator 12, input/tugma 12, chip 999, belgi (badge) 8.
- Bosiladigan joy ≥ 44 px (Mini App asosiy tugmalari 52–56). Toast tugmalari, tozalash "×", checkbox/radio yorliqlari, sana maydonlari ham `min-h-11` / `size-11`.
- Bo'shliq shkalasi: 4, 8, 12, 16, 24, 32.
- Belgilar: **Lucide** (`lucide-react`), 20 px, chiziq 1.75. Har menyu bandi, tur, holat belgili. UI matnlarida emoji/glif (✓, ⚠️, 📷) yo'q — belgilar komponentda Lucide bilan.

## Komponentlar (`src/components/ui/`)

- `Button` (primary / secondary / ghost / danger; o'lchamlar md 44, lg 52; yuklanish holati), `IconButton`.
- `Chip` (filtr: "Obyekt: Hammasi ▾"; tanlanganda `ice` fon + `brand` chegara va matn; "×" tozalash).
- `choiceClass({ selected, shape, tone, size, dashed, label, emphasis, highlight })` (`choiceClass.ts`) — **yagona tanlov uslubi**: tanlangan = `ice` fon + `brand` chegara (+ qalin matn). Tanlangan holat boshqa joyda qo'lda yozilmaydi.
  - `shape`: `pill` (chip: birlik, sotuvchi, filtr), `box` (to'rdagi radio-tugma: rol, holat, til, birlik kalkulyatori), `stack` (ikki qatorli variant: "Ertaga / sana", 52 px), `tile` (material plitkasi, 76 px), `row` (checkbox/radio qatori, obyekt).
  - `tone`: `brand` (standart) | `ok` (sanalgan) | `danger`.
  - `size`: `sm` 14 px (veb) | `md` 16 px (Mini App) — balandlik har doim ≥ 44 px.
  - `label: true` — `<label>` + sr-only input: kursor va `has-[:focus-visible]` fokus halqasi.
  - `dashed` — "Yangi sotuvchi" kabi qo'shimcha amal; `highlight` — ko'p ishlatiladigan material; `emphasis: false` — ichida o'z og'irligi bor qatorlar.
  - `chipClass(active)` — veb filtr chipi uchun qisqartma (`choiceClass({ shape: 'pill', size: 'sm' })`).
- `inputClass({ size, error, multiline })` (`inputClass.ts`) — **yagona input uslubi**: `md` 44 px, `lg` 48 px (Mini App matn), `hero` 64 px / 40 px qalin raqam (miqdor, summa). Chegara `line-strong`, fokus — `brand` + halqa, xato — `danger`, placeholder — `muted` (hero'da `muted/40`). `TextField`, `TextAreaField`, `SelectField`, `DateField`, `SearchBox`, Mini App `BigNumberInput` shundan foydalanadi.
- `TextField`, `TextAreaField` (izoh/sabab), `SelectField` — yorliq har doim ko'rinadi; xato/izoh `aria-describedby` bilan, xato `role="alert"`.
- `DateField` / `DateInput` — niqobli sana: `dd.mm.yyyy`, `inputMode="numeric"`, nuqtalar o'zi qo'yiladi; mavjud bo'lmagan sana va `min`/`max` tekshiriladi. Qiymat ichkarida doim ISO (`yyyy-mm-dd`); ISO nusxa qo'yilsa ham qabul qilinadi. Native `type="date"` ishlatilmaydi.
- `SearchBox` — yagona qidiruv maydoni (`size`: `md` — veb filtri, `lg` — Mini App).
- `FilterBar` — kompyuterda chiplar bir qatorda + "Tozalash" (ichidagi select/sana fokusda — chip atrofida halqa); telefonda gorizontal aylanuvchi chip qatori, bosilganda `BottomSheet` (variantlar ro'yxati yoki sana oralig'i).
- `BottomSheet` (telefon) / `Popover` (kompyuter).
- `SegmentedControl` (Kirim | Chiqim — tanlangan bo'lak rangi tur rangida).
- `EntryRow` — "yuk xati" qatori (chap rangli chiziq, belgi, nom, meta, o'ngda `Qty`).
- `Qty` — raqam + birlik (`size`: sm/md/lg/hero).
- `Money` — summa + "so'm" (`formatSumNumber` + `t.ui.sum`).
- `LevelBar` — daraja chizig'i (qiymat, chegara, oshish; `size`: `sm` jadval ichida / `md`; `percentDigits` — foizdagi kasr xonalari). `NormProgress` — `LevelBar` ustidagi yupqa o'ram.
- `StatTile` — kartochka: belgi, nom, katta raqam, kichik izoh, ixtiyoriy havola (butun kartochka bosiladi).
- `DataTable` — kompyuterda: qotgan sarlavha, ixcham qatorlar, o'ngga tekislangan raqamlar, hover; telefonda avtomatik `EntryRow` ro'yxatiga aylanadi (`renderMobile`). `rowData` — qatorga `data-*` atributlar. Norma jadvali (`NormUsageTable`) ham shu.
- `DetailRows` — tafsilot ro'yxati (chapda nom, o'ngda qiymat). Mini App tafsilotlari ham shu.
- `EmptyState` — belgi (Lucide, 40 px, `ice` doira ichida), bir qator sarlavha, bir qator yo'riqnoma, ixtiyoriy tugma ("Hali kirim yo'q. Birinchi kirimni Telegram ilovasidan kiriting.").
- `RetryNotice` — yuklash xatosi va "Qayta urinish" (veb va Mini App). Qisman xato (masalan, "Yozuvlarim"da xaridlar yuklanmadi) ham yashirilmaydi.
- `Skeleton` — qator va kartochka shakllari (spinner o'rniga).
- `Toast` — pastda, 3 s; havola va yopish tugmasi 44 px.
- `PageHeader` — sarlavha (`text-page`, 28), o'ngda amallar (Excel, Qo'shish). Tor ekranda amallar sarlavha ostiga o'tadi (flex-wrap); `secondaryActions` telefonda `ActionMenu` ("⋯") ga yig'iladi, kompyuterda oddiy tugmalar. Telefonda sarlavha qotgan (sticky) va kichrayadi.

## Veb layout

```
┌──────────┬──────────────────────────────────────────────┐
│ navy     │  Ombor                         [Excel] [+]   │  PageHeader
│ ▣ Bosh   │  [Obyekt: Hammasi ▾] [7 kun ▾] [Tur ▾] ×     │  FilterBar
│ ▤ Ombor  │ ┌──────────────────────────────────────────┐ │
│ ...      │ │ Sana   Tur  Obyekt  Material     Miqdor  │ │  DataTable
│          │ │ 01.11  ▲    A       Sement M400  150 kg  │ │
│ [avatar] │ └──────────────────────────────────────────┘ │
└──────────┴──────────────────────────────────────────────┘
```
- Yon menyu: navy, belgi + matn, faol band `ice` 10% fon va chap chiziq (`brand-300`); pastda foydalanuvchi (ism, rol), "Parol", "Chiqish". ≥ 1280 px — keng; 1024–1279 — faqat belgilar (tooltip); < 1024 — yashirin, tepada menyu tugmasi (varaq, `aria-controls`).
- Navy yon menyuda fokus halqasi — oq (ko'k halqa navy ustida ko'rinmaydi).
- Menyu bandi nomi va sahifa sarlavhasi bir xil ("Ombor").
- Kontent chapga tekislangan, maksimal kenglik 1280 (`max-w-7xl`).

## Telefon (veb va Mini App)

```
┌─────────────────────────────┐
│ Ombor                 [⤓]   │  sticky
│ (Obyekt ▾)(7 kun ▾)(Tur ▾)→ │  aylanuvchi chiplar
├─────────────────────────────┤
│▌▲ Sement M400        150 kg │  EntryRow
│▌  Obyekt A                  │
│▌  bugun 14:32               │
│▌▼ Armatura Ø12        1,2 t │
└─────────────────────────────┘
```

## Mini App

- Foydalanuvchiga ko'rinadigan nom — "Telegram ilovasi" ("Mini App" faqat kod va hujjatda).
- Sarlavha (ilova ichida, sticky): chapda sahifa nomi (`text-xl`, h1), o'ngda belgilar (Yordam, Xatolik haqida xabar). Bosh ekranda — brend belgisi va nomi (salomlashish sahifa ichida). Sahifalar ichida takroriy `PageHeader` yo'q.
- Bosh ekran (prorab/omborchi): ikkita katta harakat plitkasi "Kirim" va "Chiqim" (tur rangida, belgi, 96 px balandlik, bosilganda `active:scale`), o'ng burchakda bugungi soni ("Bugun: 3"); ostida "Bugun" — oxirgi yozuvlar `EntryRow` (o'tkazma — `transfer`, tuzatish — neytral), vaqt `formatTime`.
- Kirim/chiqim: `SegmentedControl` tepada; material to'ri — katta plitkalar (nom 2 qatorgacha, ostida joriy birlik), qidiruv; tepada "Ko'p ishlatiladi" guruhi (≤ 4 ta, yulduzcha va och ko'k chegara — `choiceClass({ highlight })`), keyin "Barcha materiallar". Miqdor — `BigNumberInput`: 40 px raqam, ichida o'ngda birlik ("qop", "so'm"), ochilganda fokus, `enterKeyHint="done"`; birlik chiplari, ostida "= 150 kg" `Qty` hero; MainButton.
- O'tkazmada qabul qiluvchi obyekt bitta bo'lsa — avtomatik tanlanadi.
- Saqlangandan keyin MainButton ~1,2 s yashil "Saqlandi" bo'lib turadi (`flashMainButtonSaved`); tasdiq banneri — asosiy matn va alohida qatorda obyekt/summa.
- Rasm maydoni: "Rasm" + kulrang "(ixtiyoriy)"; majburiy bo'lsa "(ixtiyoriy)" o'rniga `Badge tone="warn"` "majburiy".
- Pastki menyu: belgi + qisqa matn (12 px), faol — `brand`. MainButton ko'rinib turganda (`useMainButton` → `TgChromeContext`) va matn maydoni fokusda (klaviatura ochiq) — yashiriladi.
- Telegram: `initTelegram` — `setHeaderColor`/`setBackgroundColor` (canvas), `setBottomBarColor` (paper), `disableVerticalSwipes()`, har biri `isVersionAtLeast` bilan. Ranglar `tokens.ts` dan. `:root { color-scheme: light }`. Balandlik — `min-h-app` (`--tg-viewport-stable-height`, aks holda `100dvh`).
- Qoralamada ma'lumot bo'lsa (kirim/chiqim, xarid, so'rov, o'tkazma, sanash) — `enableClosingConfirmation`, bo'shasa — o'chiriladi (`useClosingConfirmation`).
- Direktor bosh ekrani: `StatTile` lar 2 ustun, "Smeta" — obyektlar `LevelBar` bilan; ogohlantirish qatori bosilsa — `/tg?alert=<id>` (tepada `AlertDeepLink` kartochkasi).

## Holatlar

- Yuklanish — `Skeleton`; xato — `RetryNotice` / `EmptyState` uslubida, aniq sabab va "Qayta urinish"; bo'sh — yo'riqnoma.
- Fokus — 2 px `brand` halqa (`focus-visible`); to'q fonda — oq.
- Maydon xatosi — maydon ostida, `aria-describedby` bilan bog'langan va `role="alert"`.
- `prefers-reduced-motion` — animatsiyalar o'chadi. Animatsiya faqat foydalanuvchi amaliga javob: varaq ochilishi (200 ms), saqlash tasdig'i (Lucide `CircleCheck`, MainButton "Saqlandi"), segment almashinuvi, katta plitka bosilishi (`active:scale`).
