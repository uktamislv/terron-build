# Telegram bot va Mini App'ni ulash

Bu yo'riqnoma bir marta bajariladi. Oldin GitHub Pages'ga deploy qilingan bo'lishi kerak (Mini App faqat HTTPS manzildan ochiladi) — `docs/deploy-github-pages.md` ga qarang.

Quyida `https://FOYDALANUVCHI.github.io/terron-build` o'rniga o'zingizning GitHub Pages manzilingizni qo'ying.

## 1. Bot yaratish

1. Telegram'da **@BotFather** ni oching → `/start`.
2. `/newbot` yuboring.
3. Bot nomi (ko'rinadigan): masalan `TERRON Build`.
4. Username (oxiri `bot` bilan tugashi shart): masalan `terron_build_bot`.
5. BotFather **token** beradi (`123456789:AA...` ko'rinishida).
   - **Tokenni hech kimga yubormang, kodga, chatga yoki `.env` ga yozmang.** U keyinroq (Batch 2) faqat Supabase secrets'ga qo'yiladi:
     ```bash
     supabase secrets set TELEGRAM_BOT_TOKEN=...
     ```
   - Token tasodifan oshkor bo'lsa: BotFather → `/revoke` → yangi token.

## 2. Bot ma'lumotlari

BotFather'da `/mybots` → botingizni tanlang → **Edit Bot**:

- **Edit Description** — "Qurilish firmasi uchun material va pul nazorati. Kirish uchun pastdagi tugmani bosing."
- **Edit About** — "TERRON Build"
- **Edit Botpic** — logotip (ixtiyoriy)

## 3. Mini App'ni ulash

**A. Menyu tugmasi (asosiy usul)**

1. `/mybots` → bot → **Bot Settings** → **Menu Button** → **Configure menu button**.
2. URL: `https://FOYDALANUVCHI.github.io/terron-build/tg`
3. Tugma matni: `Ochish`.

Endi botdagi chap pastki tugma Mini App'ni ochadi.

**B. Asosiy Mini App (profil va havola uchun)**

1. `/mybots` → bot → **Bot Settings** → **Configure Mini App** → **Enable Mini App**.
2. URL: `https://FOYDALANUVCHI.github.io/terron-build/tg`
3. Shundan keyin `https://t.me/terron_build_bot?startapp` havolasi to'g'ridan-to'g'ri Mini App'ni ochadi (kunlik hisobotdagi tugma uchun kerak bo'ladi).

## 4. `.env` ga qo'shish

Faqat bot **username** (token emas!):

```
VITE_TELEGRAM_BOT_USERNAME=terron_build_bot
```

GitHub'da ham: **Settings → Secrets and variables → Actions** → `VITE_TELEGRAM_BOT_USERNAME` secret'ini qo'shing.

## 5. Tekshirish

1. Telefonda botni oching → **Ochish** tugmasi.
2. Mini App ochiladi, bosh ekranda **"Telegram ichida ochilgan"** yashil belgisi ko'rinadi.
3. Brauzerda `https://FOYDALANUVCHI.github.io/terron-build/tg` ochsangiz — sariq **"Brauzerda ochilgan"** belgisi chiqadi. Bu to'g'ri.

Kirish (telefon raqami orqali bog'lash, `tg-auth`) Batch 2 da qo'shiladi.
