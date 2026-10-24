# supabase/

- `migrations/` — SQL migratsiyalar (Batch 1 dan). Nomi: `YYYYMMDDHHMMSS_nom.sql`.
- `functions/` — Edge Functions (Deno): `tg-auth` (Batch 2), bot va ogohlantirishlar (Batch 6).
- `tests/` — RLS testlari.

Maxfiy kalitlar (`TELEGRAM_BOT_TOKEN`, `service_role`) faqat Supabase secrets'da:

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=...
```
