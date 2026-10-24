# GitHub Pages'ga deploy

Deploy `.github/workflows/ci.yml` da tayyor: `main` ga har push'da lint, typecheck, test o'tadi, keyin sayt avtomatik chiqariladi.

## Birinchi marta

1. GitHub'da yangi repozitoriy yarating, masalan `terron-build`.
   - Bepul tarifda Pages faqat **Public** repo'da ishlaydi. Private repo uchun GitHub Pro kerak.
2. Kodni yuklang:
   ```bash
   git add .
   git commit -m "Batch 0"
   git remote add origin https://github.com/FOYDALANUVCHI/terron-build.git
   git push -u origin main
   ```
3. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Repo → **Settings → Secrets and variables → Actions → New repository secret** — uchtasini qo'shing:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_TELEGRAM_BOT_USERNAME`

   (Supabase hali yo'q bo'lsa, keyin qo'shsa ham bo'ladi — sayt ochiladi, faqat "Sozlanmagan" belgisi chiqadi.)
5. **Actions** bo'limida workflow'ni qayta ishga tushiring (yoki yangi push qiling). Tugagach manzil: `https://FOYDALANUVCHI.github.io/terron-build/`

## Tekshirish

- `https://FOYDALANUVCHI.github.io/terron-build/` — veb panel
- `https://FOYDALANUVCHI.github.io/terron-build/tg` — Mini App
- `https://FOYDALANUVCHI.github.io/terron-build/tg/purchase` — sahifani yangilaganda ham ilova ochilishi kerak (`404.html` orqali)

## Muhim

- `service_role` kaliti va `TELEGRAM_BOT_TOKEN` GitHub Secrets'ga **qo'yilmaydi**: `VITE_` bilan boshlangan har qanday qiymat brauzerga ochiq bo'ladi. Bot tokeni faqat Supabase secrets'da.
- Repo nomini o'zgartirsangiz, manzil ham o'zgaradi — BotFather'dagi Mini App URL'ini yangilang.
- O'z domeningizni ulasangiz (Settings → Pages → Custom domain), sayt `/` dan ochiladi; workflow'dagi `BASE_PATH` ni `/` ga o'zgartiring.
