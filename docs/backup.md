# Zaxira nusxa (backup)

Barcha ma'lumot Supabase'da: PostgreSQL bazasi (firmalar, harakatlar, xaridlar, audit) va Storage (chek va kirim rasmlari). Cloudflare'da faqat frontend fayllari — ular git'da bor, zaxira kerak emas.

## Free reja cheklovlari (hozirgi holat)

- **Avtomatik zaxira yo'q.** Free rejada kunlik backup ham, point-in-time recovery (PITR) ham yo'q — baza buzilsa yoki noto'g'ri SQL ishga tushirilsa, tiklash uchun faqat o'zingiz olgan nusxa qoladi.
- **7 kun faolliksiz — loyiha to'xtatiladi (pause).** Restore qilinadi, ma'lumot o'chmaydi, lekin uzoq to'xtab qolgan loyiha uchun Supabase ogohlantirishlarini kuzating.
- Baza hajmi 500 MB, Storage 1 GB gacha.

**Tavsiya: haqiqiy firma bilan ishlashdan (production) oldin Pro rejaga o'ting** — kunlik avtomatik backup (7 kun), pause yo'q, kattaroq limitlar; kerak bo'lsa PITR qo'shimchasi. Pro'da ham quyidagi haftalik qo'lda nusxani davom ettirish foydali (Supabase'dan tashqarida saqlanadigan nusxa).

## Haftalik qo'lda nusxa (har dushanba)

Kerak: Supabase CLI (`npx supabase`), loyiha bog'langan (`npx supabase link --project-ref <REF>`) va database paroli. Nusxalarni **git'ga qo'shmang** — ularda shaxsiy ma'lumot bor; shifrlangan diskda / bulutda saqlang.

### 1. Baza (3 fayl)

```bash
mkdir -p backups/$(date +%Y-%m-%d) && cd backups/$(date +%Y-%m-%d)
npx supabase db dump --linked --role-only -f roles.sql
npx supabase db dump --linked -f schema.sql
npx supabase db dump --linked --data-only --use-copy -f data.sql
```

- `roles.sql` — rollar, `schema.sql` — jadvallar, funksiyalar, RLS, triggerlar, `data.sql` — ma'lumotlar.
- `auth` va `storage` sxemalaridagi foydalanuvchi va fayl yozuvlari ham `data.sql` ga tushadi (login'lar tiklanadi).
- Vault sirlari (`tg_dispatch_secret`) dump'ga shifrlangan holda tushadi va boshqa loyihada ochilmaydi — tiklashdan keyin yangi sir yarating (`docs/bot-design.md`, "Sirni almashtirish").

### 2. Storage (rasmlar)

Dashboard → Storage → bucket → fayllarni yuklab olish qo'lda noqulay; CLI bilan:

```bash
npx supabase storage cp -r ss:///<bucket> ./storage/<bucket> --experimental
```

Har bucket uchun takrorlang (ro'yxat: Dashboard → Storage). Rasmlar ixtiyoriy va katta bo'lishi mumkin — bazadan farqli, oyiga bir marta yetarli bo'lishi mumkin.

### 3. Tekshirish

- Fayllar bo'sh emas: `ls -la` — `data.sql` hajmi o'tgan haftadagidan keskin kichik bo'lmasin.
- Har oy bir marta tiklashni sinab ko'ring (bo'sh lokal baza yoki alohida sinov loyihasida):

```bash
psql "<sinov bazasi connection string>" -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql
```

`session_replication_role = replica` — tiklash paytida triggerlar (audit, guard'lar) qayta ishlamasin.

## Tiklashdan keyin

1. `private.app_settings.dispatch_url` ni yangi loyiha URL'iga o'zgartiring (`docs/deploy-supabase.md`, "Yangi loyihada: dispatch_url").
2. Edge Functions'ni deploy qiling va secrets'ni yozing (`node scripts/setup-telegram.mjs --project-ref <yangi REF>`).
3. `docs/deploy-supabase.md` dagi "Bildirishnomalar ishlayaptimi" tekshiruvlarini bajaring.
