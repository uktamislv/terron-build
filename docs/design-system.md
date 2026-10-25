# TERRON Build — dizayn tizimi

## Mavzu va auditoriya

Qurilish firmasida material va pul nazorati. Prorab va omborchi — maydonda, telefonda, quyosh ostida, qo'li band; direktor — telefonda tez ko'z yugurtiradi; admin va buxgalter — kompyuterda uzun jadvallar bilan. Har ekranning asosiy ma'lumoti — **miqdor va summa**.

## G'oya: "yuk xati" (nakladnoy)

Qurilishda har bir material harakati qog'ozda yuk xati bilan qayd etiladi: material nomi, katta yozilgan miqdor va birlik, kim, qachon, qayerga. Interfeys shu tilni oladi:

- **Raqam — qahramon.** Miqdor va summa har doim eng katta, `tabular-nums`, birlik kichik va kulrang yonida (`150` `kg`). Bu yagona "jasur" element — qolgan hamma narsa sokin.
- **Qator = yozuv.** Harakat, xarid, so'rov — chap tomonda rangli vertikal chiziq (tur: kirim — yashil, chiqim — ko'k, xarid — to'q ko'k, o'tkazma — kulrang-ko'k, o'chirilgan — chiziqli), o'rtada nom va meta, o'ngda katta raqam.
- **Daraja chizig'i.** Qoldiq va smeta ishlatilishi — ingichka gorizontal "daraja" chizig'i (normadan oshganda chiziq chegaradan o'tib qizarib ketadi), foiz o'ngda.

## Ranglar (CLAUDE.md palitrasi asosida)

| Token | Hex | Ishlatilishi |
|---|---|---|
| `brand` | `#1E5EFF` | asosiy tugma, faol holat, havolalar |
| `navy` | `#0B2A6B` | yon menyu, sarlavhalar, xarid belgisi |
| `ice` | `#EAF1FF` | tanlangan fon, chip fon, faol menyu orqasi |
| `paper` | `#FFFFFF` | kartochka, jadval |
| `canvas` | `#F4F6FA` | sahifa foni (sovuq kulrang — iliq krem emas) |
| `ink` | `#0E1A33` | asosiy matn (navy-ga moyil) |
| `muted` | `#5A6A86` | ikkinchi darajali matn, birliklar |
| `line` | `#DCE3EF` | chegaralar, ajratgichlar |
| `danger` | `#B3261E` | farq, kamomad, oshish, manfiy |
| `warn` | `#8A5300` (fon `#FFF4E0`) | ogohlantirish |
| `ok` | `#1B6E35` (fon `#E7F5EC`) | joyida, kirim |

Gradientlar yo'q. Soya faqat "suzuvchi" elementlarda (pastki varaq, menyu, toast): `0 8px 24px rgba(11,42,107,.12)`. Kartochkalar — 1px `line` chegara, soyasiz.

## Shrift

- **Inter** (CLAUDE.md) — yagona oila. Raqamlarda `font-variant-numeric: tabular-nums`, `font-feature-settings: 'cv11'` (oddiy "1" va "l" farqi).
- O'lchamlar (px): 12 (meta), 14 (asosiy jadval), 16 (asosiy matn, inputlar — iOS zoom bo'lmasin), 20 (kartochka sarlavhasi), 28 (sahifa sarlavhasi), 36–44 (qahramon raqam).
- Og'irliklar: 400 matn, 600 sarlavha va raqam, 700 faqat qahramon raqam.
- KATTA HARFLI yorliqlar yo'q; sarlavha ustida "eyebrow" yo'q; meta ma'lumot "·" bilan ulanmaydi — alohida qatorlar yoki belgi + matn.

## Shakl

- Radius ierarxiyasi: sahifa bo'limi 16, kartochka/qator 12, input/tugma 12, chip 999, belgi (badge) 8.
- Bosiladigan joy ≥ 44 px (Mini App asosiy tugmalari 52–56).
- Bo'shliq shkalasi: 4, 8, 12, 16, 24, 32.
- Belgilar: **Lucide** (`lucide-react`), 20 px, chiziq 1.75. Har menyu bandi, tur, holat belgili.

## Komponentlar (`src/components/ui/`)

- `Button` (primary / secondary / ghost / danger; o'lchamlar md 44, lg 52; yuklanish holati), `IconButton`.
- `Chip` (filtr: "Obyekt: Hammasi ▾"; tanlanganda `ice` fon + `brand` matn; "×" tozalash).
- `FilterBar` — kompyuterda chiplar bir qatorda + "Tozalash"; telefonda gorizontal aylanuvchi chip qatori, bosilganda `BottomSheet` (variantlar ro'yxati yoki sana oralig'i).
- `BottomSheet` (telefon) / `Popover` (kompyuter).
- `SegmentedControl` (Kirim | Chiqim — tanlangan bo'lak rangi tur rangida).
- `EntryRow` — "yuk xati" qatori (chap rangli chiziq, belgi, nom, meta, o'ngda `Qty`).
- `Qty` — raqam + birlik (`size`: sm/md/lg/hero).
- `Money` — summa + "so'm".
- `LevelBar` — daraja chizig'i (qiymat, chegara, oshish).
- `StatTile` — kartochka: belgi, nom, katta raqam, kichik izoh, ixtiyoriy havola (butun kartochka bosiladi).
- `DataTable` — kompyuterda: qotgan sarlavha, ixcham qatorlar, o'ngga tekislangan raqamlar, hover; telefonda avtomatik `EntryRow` ro'yxatiga aylanadi (`renderMobile`).
- `EmptyState` — belgi (Lucide, 40 px, `ice` doira ichida), bir qator sarlavha, bir qator yo'riqnoma, ixtiyoriy tugma ("Hali kirim yo'q. Birinchi kirimni Telegram'dan kiriting.").
- `Skeleton` — qator va kartochka shakllari (spinner o'rniga).
- `Toast` — pastda, 3 s.
- `PageHeader` — sarlavha (28), o'ngda amallar (Excel, Qo'shish); telefonda sarlavha qotgan (sticky) va kichrayadi.

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
- Yon menyu: navy, belgi + matn, faol band `ice` 10% fon va chap chiziq; pastda foydalanuvchi (ism, rol), "Parol", "Chiqish". ≥ 1280 px — keng; 1024–1279 — faqat belgilar (tooltip); < 1024 — yashirin, tepada menyu tugmasi (varaq).
- Kontent chapga tekislangan, maksimal kenglik 1280.

## Telefon (veb va Mini App)

```
┌─────────────────────────────┐
│ Ombor                 [⤓]   │  sticky
│ (Obyekt ▾)(7 kun ▾)(Tur ▾)→ │  aylanuvchi chiplar
├─────────────────────────────┤
│▌▲ Sement M400        150 kg │  EntryRow
│▌  Obyekt A · bugun 14:32    │
│▌▼ Armatura Ø12        1,2 t │
└─────────────────────────────┘
```

## Mini App

- Bosh ekran (prorab/omborchi): ikkita katta harakat plitkasi "Kirim" va "Chiqim" (tur rangida, belgi, 96 px balandlik), ostida "Bugun" — oxirgi yozuvlar `EntryRow`.
- Kirim/chiqim: `SegmentedControl` tepada; material to'ri — katta plitkalar (nom 2 qatorgacha, ostida joriy birlik), qidiruv; miqdor — katta (40 px) raqam maydoni, birlik chiplari, ostida "= 150 kg" `Qty` hero; MainButton.
- Pastki menyu: belgi + qisqa matn, faol — `brand`.
- Direktor bosh ekrani: `StatTile` lar 2 ustun, "Smeta" — obyektlar `LevelBar` bilan.

## Holatlar

- Yuklanish — `Skeleton`; xato — `EmptyState` uslubida, aniq sabab va "Qayta urinish"; bo'sh — yo'riqnoma.
- Fokus — 2 px `brand` halqa (`focus-visible`).
- `prefers-reduced-motion` — animatsiyalar o'chadi. Animatsiya faqat foydalanuvchi amaliga javob: varaq ochilishi (200 ms), saqlash tasdig'i (✓ belgisi), segment almashinuvi.
