# Cloudflare'ga deploy (hosting)

Cloudflare faqat frontendni beradi (veb panel va Mini App). Baza, kirish va rasmlar — Supabase'da. Sozlama `wrangler.jsonc` da.

## 1. Birinchi deploy (kompyuterdan)

1. https://dash.cloudflare.com/sign-up da bepul akkaunt oching.
2. Loyiha papkasida Cloudflare'ga kiring — brauzer ochiladi, **Allow** bosing:
   ```bash
   npx wrangler login
   ```
3. Deploy:
   ```bash
   npm run deploy
   ```
   Oxirida manzil chiqadi: `https://terron-build.terron-build.workers.dev`. Shu manzil Mini App uchun ham ishlatiladi.

Lokal `npm run deploy` build paytida `.env` faylidagi `VITE_` qiymatlarini oladi.

## 2. GitHub'dan avtomatik deploy

`main` ga har push'da testlar o'tsa, sayt avtomatik yangilanadi.

1. Cloudflare → **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** shabloni → token yarating.
2. Cloudflare bosh sahifasida o'ng tomonda **Account ID** ni nusxalang.
3. GitHub repo → **Settings → Secrets and variables → Actions**:
   - **Secrets**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - **Variables**: `CLOUDFLARE_DEPLOY` = `true`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TELEGRAM_BOT_USERNAME`

`VITE_` qiymatlari ochiq (brauzerga tushadi), shuning uchun Variables'da turadi. `CLOUDFLARE_DEPLOY` qo'yilmaguncha CI faqat tekshiruvlarni bajaradi.

4. Deploy job'i **`production`** GitHub Environment'ida ishlaydi (Settings → Environments → `production` — birinchi deploy'da o'zi yaratiladi). U yerda **Deployment branches → faqat `main`** qo'ying; xohlasangiz Cloudflare sirlarini repo darajasidan shu environment'ga ko'chiring va "Required reviewers" yoqing. `CLOUDFLARE_DEPLOY` o'zgaruvchisi **repo darajasida** qolsin (job sharti environment'dan oldin tekshiriladi).

## Sarlavhalar (`public/_headers`)

- HTML (`/`, `/tg`, barcha SPA yo'llari) — `Cache-Control: no-cache`; `/assets/*` — 1 yil, `immutable` (fayl nomida hash). Yangi deploy'dan keyin eski chunk topilmasa ilova bir marta o'zi qayta yuklanadi.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — domen (va uning subdomenlari) faqat HTTPS orqali ochiladi. O'z domeningizni ulashdan oldin barcha subdomenlarda HTTPS borligiga ishonch hosil qiling.
- `Permissions-Policy`: kamera va joylashuv — faqat o'z saytimiz; mikrofon va to'lov — o'chiq.

## Muhim

- `service_role` kaliti va `TELEGRAM_BOT_TOKEN` GitHub'ga ham, Cloudflare'ga ham **qo'yilmaydi** — faqat Supabase secrets'da.
- GitHub Pages endi kerak emas: repo → **Settings → Pages** → saytni o'chiring. Repo'ni **Private** qilsa bo'ladi (Settings → General → Danger Zone) — Cloudflare'ga ta'sir qilmaydi.

## Tekshirish

- `https://.../` — veb panel
- `https://.../tg` — Mini App
- `https://.../tg/purchase` — sahifani yangilaganda ham ilova ochiladi (200 javob)
