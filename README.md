# TERRON Build

Qurilish firmalari uchun material va pul nazorati tizimi. Batafsil qoidalar — [CLAUDE.md](CLAUDE.md).

- `/` — veb panel (admin, buxgalter, ta'minotchi)
- `/tg` — Telegram Mini App (prorab, omborchi, haydovchi, tekshiruvchi, direktor)

## Ishga tushirish

```bash
npm install
cp .env.example .env   # qiymatlarni to'ldiring
npm run dev
```

## Buyruqlar

| Buyruq | Vazifasi |
|---|---|
| `npm run dev` | Lokal server |
| `npm run build` | Ishlab chiqarish uchun yig'ish |
| `npm run typecheck` | TypeScript tekshiruvi |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |

## Papkalar

```
src/
  web/        veb panel sahifalari va layout
  tg/         Mini App ekranlari, Telegram SDK qatlami
  components/ umumiy UI komponentlar
  data/       Supabase repository'lari (Supabase faqat shu yerda)
  domain/     sof biznes mantig'i (birliklar, farq qoidalari)
  i18n/       interfeys matnlari (uz.ts)
  lib/        yordamchilar (sana, summa formati)
supabase/     migratsiyalar, Edge Functions, RLS testlari
docs/         deploy va Telegram bot yo'riqnomalari
```
