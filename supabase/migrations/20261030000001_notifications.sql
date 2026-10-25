-- ============================================================================
-- Batch 6 · 01 — Telegram bildirishnomalari (shartnoma: docs/bot-design.md)
--
--   1. public.notification_outbox — yuborish navbati (outbox). RLS: admin/super_admin
--      o'z firmasini o'qiydi; authenticated yozmaydi; DELETE/TRUNCATE bloklangan.
--   2. private.app_settings — tizim sozlamalari (dispatch_url). Hech kimga grant yo'q.
--   3. Vault sir 'tg_dispatch_secret' (yo'q bo'lsa yaratiladi; git'da yo'q).
--   4. private.wake_dispatch() — pg_net bilan tg-dispatch ni "uyg'otish" (xato
--      chaqiruvchini buzmaydi); alerts AFTER INSERT → outbox + uyg'otish.
--   5. private.daily_report_stats(company, start, end) — oraliq statistikasi ([kecha 20:00, bugun 20:00)).
--      notification_outbox — audit istisnosi (tizim jurnali); yetkazish "kamida bir marta".
--   6. private.enqueue_daily_reports(date) — har faol firma uchun idempotent qator.
--   7. pg_cron: terron-dispatch (har daqiqa, faqat navbatda ish bo'lsa),
--      terron-daily-report (15:00 UTC = 20:00 Toshkent).
--   8. public.svc_* — tg-dispatch (service_role) uchun RPC'lar.
--
-- Oldingi migratsiyalar o'zgartirilmaydi.
-- ============================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

-- ============================================================================
-- 1. notification_outbox
--    Tizim jurnali: audit trigger va soft delete yo'q (yozuvchi — faqat security
--    definer funksiyalar), lekin qatorlar o'chirilmaydi (a_block_delete/truncate).
--    status: pending → sending (claim) → sent | pending (qayta urinish) | failed.
-- ============================================================================
create table public.notification_outbox (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id),
  kind             text not null
                   constraint notification_outbox_kind_check check (kind in ('alert', 'daily_report')),
  alert_id         uuid,
  report_date      date,
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'pending'
                   constraint notification_outbox_status_check
                   check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts         integer not null default 0
                   constraint notification_outbox_attempts_check check (attempts >= 0),
  next_attempt_at  timestamptz not null default now(),
  last_error       text
                   constraint notification_outbox_last_error_check
                   check (last_error is null or char_length(last_error) <= 1000),
  sent_count       integer not null default 0
                   constraint notification_outbox_sent_count_check check (sent_count >= 0),
  -- Yetkazilgan chatlar (qayta urinishda ularga qayta yuborilmaydi). sent_count = cardinality.
  delivered_chat_ids bigint[] not null default '{}',
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  updated_at       timestamptz not null default now(),
  constraint notification_outbox_alert_fkey foreign key (company_id, alert_id)
    references public.alerts (company_id, id),
  constraint notification_outbox_kind_ref_check check (
    (kind = 'alert' and alert_id is not null and report_date is null)
    or (kind = 'daily_report' and report_date is not null and alert_id is null)
  )
);

comment on table public.notification_outbox is
  'Telegram xabarlari navbati (outbox). Yozuvchi — faqat tizim (trigger, cron, tg-dispatch RPC). '
  'Qayta urinish: 2^attempts daqiqa, 6 urinishdan keyin failed.';

create unique index notification_outbox_alert_key
  on public.notification_outbox (alert_id) where alert_id is not null;
create unique index notification_outbox_report_key
  on public.notification_outbox (company_id, report_date) where kind = 'daily_report';
create index notification_outbox_due_idx
  on public.notification_outbox (next_attempt_at) where status in ('pending', 'sending');
create index notification_outbox_company_idx
  on public.notification_outbox (company_id, created_at desc);

create function private.tg_outbox_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger a_block_delete before delete on public.notification_outbox
  for each row execute function private.tg_block_delete();
create trigger a_block_truncate before truncate on public.notification_outbox
  for each statement execute function private.tg_block_truncate();
create trigger b_touch before update on public.notification_outbox
  for each row execute function private.tg_outbox_touch();

alter table public.notification_outbox enable row level security;
alter table public.notification_outbox force row level security;

create policy notification_outbox_select on public.notification_outbox
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  );

revoke all on public.notification_outbox from public, anon, authenticated, service_role;
grant select on public.notification_outbox to authenticated, service_role;

-- ============================================================================
-- 2. private.app_settings — sir bo'lmagan tizim sozlamalari.
-- ============================================================================
create table private.app_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

alter table private.app_settings enable row level security;
alter table private.app_settings force row level security;
revoke all on private.app_settings from public, anon, authenticated, service_role;

insert into private.app_settings (key, value)
values ('dispatch_url', 'https://srriiiugmxgrdnuvhgix.supabase.co/functions/v1/tg-dispatch')
on conflict (key) do nothing;

-- ============================================================================
-- 3. Vault: tg-dispatch ni chaqirish siri (32 bayt, hex). Qiymat migratsiyada
--    tasodifiy yaratiladi — repozitoriyda yo'q. O'qish: vault.decrypted_secrets.
-- ============================================================================
do $$
begin
  if not exists (select 1 from vault.secrets s where s.name = 'tg_dispatch_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'tg_dispatch_secret',
      'tg-dispatch auth'
    );
  end if;
end $$;

-- ============================================================================
-- 4. tg-dispatch ni uyg'otish
--    pg_net so'rovi tranzaksiya commit bo'lgandan keyin yuboriladi (rollback —
--    yuborilmaydi). Bitta tranzaksiyada bir marta (terron.dispatch_woken).
--    Har qanday xato (sozlama yo'q, pg_net yo'q) — WARNING, chaqiruvchi buzilmaydi;
--    xabar navbatda qoladi va terron-dispatch cron'i baribir yuboradi.
-- ============================================================================
create function private.wake_dispatch()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
  v_id     bigint;
begin
  if coalesce(current_setting('terron.dispatch_woken', true), '') = '1' then
    return null;
  end if;

  begin
    select s.value into v_url from private.app_settings s where s.key = 'dispatch_url';
    select ds.decrypted_secret into v_secret
      from vault.decrypted_secrets ds
     where ds.name = 'tg_dispatch_secret'
     limit 1;
    if v_url is null or v_secret is null or v_secret = '' then
      raise warning 'tg-dispatch uyg''otilmadi: dispatch_url yoki tg_dispatch_secret sozlanmagan';
      return null;
    end if;

    v_id := net.http_post(
      url                  := v_url,
      body                 := '{}'::jsonb,
      headers              := jsonb_build_object(
                                'Content-Type', 'application/json',
                                'x-dispatch-secret', v_secret),
      timeout_milliseconds := 5000
    );
  exception when others then
    -- sqlerrm'da sir yo'q (sarlavhalar xato matniga kirmaydi)
    raise warning 'tg-dispatch uyg''otilmadi: % (%)', sqlerrm, sqlstate;
    return null;
  end;

  perform set_config('terron.dispatch_woken', '1', true);
  return v_id;
end;
$$;

-- Cron uchun: navbatda yuboriladigan qator bo'lsagina uyg'otadi (bo'sh chaqiruvlar yo'q).
create function private.wake_dispatch_if_due()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.notification_outbox o
     where (o.status = 'pending' and o.next_attempt_at <= now())
        or (o.status = 'sending' and o.updated_at < now() - interval '10 minutes')
  ) then
    return private.wake_dispatch();
  end if;
  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- alerts AFTER INSERT → outbox (darhol yuboriladigan turlar).
-- 'belgi' darajasi va 'ozi_qabul_qilgan' — yo'q (faqat kunlik hisobotda soni).
-- UPDATE — trigger yo'q (details o'zgarishi qayta yubormaydi).
-- Ismlar shu paytdagi holatda payload'ga yoziladi.
-- ----------------------------------------------------------------------------
create function private.tg_alerts_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object   text;
  v_material text;
  v_unit     text;
begin
  if new.object_id is not null then
    select o.name into v_object
      from public.objects o
     where o.company_id = new.company_id and o.id = new.object_id;
  end if;
  if new.material_id is not null then
    select m.name, m.base_unit into v_material, v_unit
      from public.materials m
     where m.company_id = new.company_id and m.id = new.material_id;
  end if;

  insert into public.notification_outbox (company_id, kind, alert_id, payload)
  values (
    new.company_id, 'alert', new.id,
    jsonb_build_object(
      'alert_id',      new.id,
      'type',          new.type,
      'severity',      new.severity,
      'object_name',   v_object,
      'material_name', v_material,
      'base_unit',     v_unit,
      'details',       new.details,
      'created_at',    new.created_at
    )
  )
  on conflict (alert_id) where alert_id is not null do nothing;

  if found then
    perform private.wake_dispatch();
  end if;
  return null;
end;
$$;

-- zz_notify — z_audit dan keyin (tarixda avval alert, keyin navbat).
create trigger zz_notify after insert on public.alerts
  for each row
  when (new.deleted_at is null
        and new.severity <> 'belgi'
        and new.type <> 'ozi_qabul_qilgan')
  execute function private.tg_alerts_notify();

-- ============================================================================
-- 5. Kunlik hisobot statistikasi — oraliq [p_period_start, p_period_end)
--    (cron: [kecha 20:00, bugun 20:00) Toshkent — hisobot yuborilgandan keyingi
--    yozuvlar ertangi hisobotga tushadi, hech narsa tushib qolmaydi).
--    Vaqt ustunlari: movements.occurred_at, purchases.purchased_at,
--    material_requests.created_at, alerts.created_at. O'chirilganlar hisoblanmaydi.
--    alerts_new / alerts_by_type — 'belgi', 'ozi_qabul_qilgan' va 'yozuv_ochirildi'
--    siz (ular alohida: self_received_count, deleted_count). purchases_sum — matn.
--    failed_count — shu firmaning oraliqda 'failed' bo'lgan outbox qatorlari
--    (updated_at bo'yicha). date — oraliq oxiridagi Toshkent sanasi.
-- ============================================================================
create function private.daily_report_stats(
  p_company_id    uuid,
  p_period_start  timestamptz,
  p_period_end    timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from     timestamptz := p_period_start;
  v_to       timestamptz := p_period_end;
  v_date     date := ((p_period_end - interval '1 microsecond') at time zone 'Asia/Tashkent')::date;
  v_failed   integer;
  v_name     text;
  v_kirim    integer;
  v_chiqim   integer;
  v_p_count  integer;
  v_p_sum    numeric(18,2);
  v_requests integer;
  v_by_type  jsonb;
  v_new      integer;
  v_self     integer;
  v_deleted  integer;
begin
  select c.name into v_name from public.companies c where c.id = p_company_id;

  select count(*) filter (where m.type = 'kirim'),
         count(*) filter (where m.type = 'chiqim')
    into v_kirim, v_chiqim
    from public.movements m
   where m.company_id = p_company_id
     and m.deleted_at is null
     and m.occurred_at >= v_from and m.occurred_at < v_to;

  select count(*), coalesce(sum(p.total_amount), 0)
    into v_p_count, v_p_sum
    from public.purchases p
   where p.company_id = p_company_id
     and p.deleted_at is null
     and p.purchased_at >= v_from and p.purchased_at < v_to;

  select count(*) into v_requests
    from public.material_requests r
   where r.company_id = p_company_id
     and r.deleted_at is null
     and r.created_at >= v_from and r.created_at < v_to;

  select coalesce(jsonb_object_agg(x.type, x.n), '{}'::jsonb), coalesce(sum(x.n), 0)
    into v_by_type, v_new
    from (
      select a.type::text as type, count(*)::integer as n
        from public.alerts a
       where a.company_id = p_company_id
         and a.deleted_at is null
         and a.created_at >= v_from and a.created_at < v_to
         and a.severity <> 'belgi'
         and a.type::text not in ('ozi_qabul_qilgan', 'yozuv_ochirildi')
       group by a.type
    ) x;

  select count(*) filter (where a.type::text = 'ozi_qabul_qilgan'),
         count(*) filter (where a.type::text = 'yozuv_ochirildi')
    into v_self, v_deleted
    from public.alerts a
   where a.company_id = p_company_id
     and a.deleted_at is null
     and a.created_at >= v_from and a.created_at < v_to;

  select count(*) into v_failed
    from public.notification_outbox o
   where o.company_id = p_company_id
     and o.status = 'failed'
     and o.updated_at >= v_from and o.updated_at < v_to;

  return jsonb_build_object(
    'date',                to_char(v_date, 'YYYY-MM-DD'),
    'period_start',        to_char(v_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'period_end',          to_char(v_to at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'failed_count',        v_failed,
    'company_name',        v_name,
    'kirim_count',         v_kirim,
    'chiqim_count',        v_chiqim,
    'purchases_count',     v_p_count,
    'purchases_sum',       v_p_sum::text,
    'requests_count',      v_requests,
    'alerts_new',          v_new,
    'alerts_by_type',      v_by_type,
    'self_received_count', v_self,
    'deleted_count',       v_deleted
  );
end;
$$;

-- ============================================================================
-- 6. Kunlik hisobotni navbatga qo'yish — har faol (o'chirilmagan) firma uchun bitta
--    (unique (company_id, report_date)); takroriy chaqiruv yangi qator qo'shmaydi.
--    Oraliq: [p_date − 1 kun 20:00, p_date 20:00) Asia/Tashkent; report_date = p_date.
--    Qaytaradi: qo'shilgan qatorlar soni.
-- ============================================================================
create function private.enqueue_daily_reports(
  p_date date default (now() at time zone 'Asia/Tashkent')::date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end   timestamptz := (p_date + time '20:00') at time zone 'Asia/Tashkent';
  v_start timestamptz := v_end - interval '24 hours';
  v_n     integer;
begin
  insert into public.notification_outbox (company_id, kind, report_date, payload)
  select c.id, 'daily_report', p_date, private.daily_report_stats(c.id, v_start, v_end)
    from public.companies c
   where c.is_active
     and c.deleted_at is null
   order by c.id
  on conflict (company_id, report_date) where kind = 'daily_report' do nothing;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    perform private.wake_dispatch();
  end if;
  return v_n;
end;
$$;

-- ============================================================================
-- 8. Service RPC'lar (tg-dispatch, service_role). public — PostgREST rpc uchun;
--    execute FAQAT service_role.
-- ============================================================================

-- Vault'dagi sir (tg-dispatch kiruvchi sarlavhani shu bilan solishtiradi).
create function public.svc_dispatch_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
    from vault.decrypted_secrets ds
   where ds.name = 'tg_dispatch_secret'
   limit 1;
$$;

-- Navbatdan qatorlar olish: pending (vaqti kelgan) va 10 daqiqadan ko'p 'sending'
-- da qolib ketganlar (funksiya yiqilgan). status → sending, attempts + 1.
-- Qolib ketgan va urinishlari tugaganlar — failed. p_limit: 1..100.
create function public.svc_claim_notifications(p_limit integer default 20)
returns setof public.notification_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_outbox o
     set status     = 'failed',
         last_error = coalesce(o.last_error, 'stuck_in_sending')
   where o.status = 'sending'
     and o.updated_at < now() - interval '10 minutes'
     and o.attempts >= 6;

  return query
  with c as (
    select o.id
      from public.notification_outbox o
     where (o.status = 'pending' and o.next_attempt_at <= now())
        or (o.status = 'sending' and o.updated_at < now() - interval '10 minutes')
     order by o.next_attempt_at, o.created_at, o.id
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
       for update skip locked
  )
  update public.notification_outbox o
     set status   = 'sending',
         attempts = o.attempts + 1
    from c
   where o.id = c.id
  returning o.*;
end;
$$;

-- Qabul qiluvchilar: firma faol; profil faol, o'chirilmagan, direktor yoki admin,
-- Telegram chat bog'langan. Bitta chat — bir marta.
create function public.svc_notification_recipients(p_company_id uuid)
returns table (profile_id uuid, chat_id bigint, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (p.telegram_chat_id)
         p.id, p.telegram_chat_id, p.role::text
    from public.profiles p
    join public.companies c on c.id = p.company_id
   where p.company_id = p_company_id
     and c.is_active
     and c.deleted_at is null
     and p.is_active
     and p.deleted_at is null
     and p.role in ('direktor', 'admin')
     and p.telegram_chat_id is not null
   order by p.telegram_chat_id, p.role, p.id;
$$;

-- Natija: faqat 'sending' qatorga ta'sir qiladi (aks holda — o'zgarishsiz, joriy holat).
--   p_delivered har doim delivered_chat_ids ga qo'shiladi (takrorsiz);
--   sent_count = cardinality(delivered_chat_ids). Keyin:
--   p_ok                       → sent (sent_at; p_error — o'tkazilganlar haqida izoh);
--   p_final                    → failed darhol (doimiy xato: bot tokeni, yaroqsiz payload);
--   p_retry_after_sec (429, vaqt byudjeti) → pending, next_attempt_at = now() + retry_after,
--                                urinish hisoblanmaydi (attempts − 1);
--   aks holda attempts >= 6    → failed;
--   aks holda                  → pending, next_attempt_at = now() + 2^attempts daqiqa.
-- p_error ≤ 1000 belgi; token/sirlar Edge tomonda tozalanadi.
create function public.svc_complete_notification(
  p_id               uuid,
  p_ok               boolean,
  p_delivered        bigint[] default '{}',
  p_error            text default null,
  p_retry_after_sec  integer default null,
  p_final            boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.notification_outbox%rowtype;
  v_error     text := left(nullif(btrim(coalesce(p_error, '')), ''), 1000);
  v_delivered bigint[];
  v_status    text;
  v_next      timestamptz;
  v_attempts  integer;
begin
  select o.* into v_row
    from public.notification_outbox o
   where o.id = p_id
     for update;
  if not found then
    return null;
  end if;
  if v_row.status <> 'sending' then
    return v_row.status;
  end if;

  select coalesce(array_agg(distinct x order by x), '{}')
    into v_delivered
    from unnest(v_row.delivered_chat_ids || coalesce(p_delivered, '{}')) as x
   where x is not null;

  v_attempts := v_row.attempts;
  v_next     := v_row.next_attempt_at;
  if coalesce(p_ok, false) then
    v_status := 'sent';
  elsif coalesce(p_final, false) then
    v_status := 'failed';
    v_error  := coalesce(v_error, 'permanent_error');
  elsif p_retry_after_sec is not null and p_retry_after_sec > 0 then
    v_status   := 'pending';
    v_attempts := greatest(v_row.attempts - 1, 0);
    v_next     := now() + make_interval(secs => least(p_retry_after_sec, 3600));
    v_error    := coalesce(v_error, 'rate_limited');
  elsif v_row.attempts >= 6 then
    v_status := 'failed';
    v_error  := coalesce(v_error, 'unknown_error');
  else
    v_status := 'pending';
    v_next   := now() + make_interval(mins => power(2, v_row.attempts)::integer);
    v_error  := coalesce(v_error, 'unknown_error');
  end if;

  update public.notification_outbox o
     set status             = v_status,
         attempts           = v_attempts,
         next_attempt_at    = v_next,
         delivered_chat_ids = v_delivered,
         sent_count         = cardinality(v_delivered),
         sent_at            = case when v_status = 'sent' then now() else o.sent_at end,
         last_error         = v_error
   where o.id = p_id;
  return v_status;
end;
$$;

-- ============================================================================
-- Ruxsatlar
-- ============================================================================
revoke execute on function
  private.tg_outbox_touch(),
  private.wake_dispatch(),
  private.wake_dispatch_if_due(),
  private.tg_alerts_notify(),
  private.daily_report_stats(uuid, timestamptz, timestamptz),
  private.enqueue_daily_reports(date)
from public, anon, authenticated, service_role;

revoke execute on function
  public.svc_dispatch_secret(),
  public.svc_claim_notifications(integer),
  public.svc_notification_recipients(uuid),
  public.svc_complete_notification(uuid, boolean, bigint[], text, integer, boolean)
from public, anon, authenticated;

grant execute on function
  public.svc_dispatch_secret(),
  public.svc_claim_notifications(integer),
  public.svc_notification_recipients(uuid),
  public.svc_complete_notification(uuid, boolean, bigint[], text, integer, boolean)
to service_role;

-- pg_net jadvallari (so'rovlar navbati — sarlavhalarda dispatch siri; javoblar)
-- foydalanuvchilarga ochiq bo'lmasin.
revoke all on all tables in schema net from public, anon, authenticated;
revoke all on all sequences in schema net from public, anon, authenticated;

-- ============================================================================
-- 7. pg_cron (postgres nomidan). Idempotent: shu nomdagi ish bo'lsa — avval o'chiriladi.
--    terron-dispatch     — har daqiqa; navbatda vaqti kelgan qator bo'lsagina HTTP.
--    terron-daily-report — 15:00 UTC = 20:00 Asia/Tashkent (UTC+5, yozgi vaqt yo'q).
-- ============================================================================
create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'terron-dispatch') then
    perform cron.unschedule('terron-dispatch');
  end if;
  perform cron.schedule('terron-dispatch', '* * * * *', 'select private.wake_dispatch_if_due()');

  if exists (select 1 from cron.job where jobname = 'terron-daily-report') then
    perform cron.unschedule('terron-daily-report');
  end if;
  perform cron.schedule('terron-daily-report', '0 15 * * *', 'select private.enqueue_daily_reports()');
end $$;
