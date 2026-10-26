-- ============================================================================
-- Audit tuzatishlari, 2-tur (shartnoma: docs/audit-fixes.md → "2-tur")
--
--   Xavfsizlik:
--     S1  Rasm xeshi klientga bog'liq emas: private.photo_hash_queue + pg_net
--         (photo-hash {mode:'sweep'}, x-photo-secret) + 5 daqiqalik cron;
--         svc_set_photo_hash(..., p_expected_path); svc_claim_photo_hash_jobs,
--         svc_complete_photo_hash_job.
--     S2  Boshqa xaridor nomidan xarid: xaridor tekshiruvi, xarid_boshqa_nomidan
--         alerti, purchase_on_your_name xabari.
--     S3  receipt_verified: "bitta qator" sharti olib tashlandi (L1); receipt_total
--         null — rasm talabidan ozod qilmaydi.
--     S4  Tinch soatlar ≤ 12 soat; sozlama/login/yozuv/boshqa nomidan alertlari ushlanmaydi.
--     S5  yozuv_ozgartirildi — rasm, chek, sotuvchi, so'rov, geo, to'lov manbasi
--         ustunlari; merge_suppliers — bitta sotuvchi_birlashtirildi belgisi, merged_into.
--     S6  Ko'r-ko'rona sanash: tekshiruvchi faqat o'z hisoblarini ko'radi; natija
--         {ok:true}; nomzodlar — faol katalog.
--     S7  Admin/direktor profillari: rol berish, ism, yaratish — faqat super_admin;
--         svc_alert_login_set(..., p_first_login).
--     S8  check_purchase_price — 10 daqiqada 30 marta (rate_limited).
--     S9  close_note: yopilgan alertda bo'sh izoh yo'q, yopilgandan keyin o'zgarmaydi.
--     S12 profile_directory: deleted_at, is_available.
--     S13 dashboard_summary: telegram_blocked_count, telegram_me_blocked; reset_chat_blocked.
--     S14 omborchi smetadan_ortiq_sorov ni ko'rmaydi.
--   Ekspluatatsiya: svc_touch_chat; outbox (company_id, status, updated_at) indeksi;
--     notification_outbox_ref_idx olib tashlandi (ishlatilmaydi).
--   Mahsulot: haydovchi tasdiqlangan so'rovlarni ko'radi va request_approved oladi;
--     transfer_cancelled, transfer_received, purchase_deleted, inventory_applied;
--     ish oqimi xabarlari tinch soatda ushlanadi; correct_entry (bog'langan kirim,
--     material/obyekt, p_reason), cancel_own_entry; sana oynasi detail.
--   Mantiq (L1–L13): FIFO zanjiri va orqa sana, qisman taqsimlash, manfiy_qoldiq
--     qayta ochilishi, merge tartibi, payment_source, qoida 6 harakatda va dayjest,
--     correct_entry sababi va takroriy yozuvni qayta baholash, qulf tartibi,
--     purchase_for_object faqat foydalanuvchi va yangi xarid.
--
-- Oldingi migratsiyalar o'zgartirilmaydi. Yangi enum qiymatlari shu tranzaksiyada
-- SQL'da ishlatilmaydi — faqat plpgsql ichida (runtime) yoki `type::text` orqali.
-- ============================================================================

-- ============================================================================
-- 0. Yangi alert turlari
-- ============================================================================
alter type public.alert_type add value if not exists 'xarid_boshqa_nomidan';
alter type public.alert_type add value if not exists 'sotuvchi_birlashtirildi';

-- ============================================================================
-- 1. Ustunlar, chegaralar, indekslar, tizim jadvallari
-- ============================================================================

-- S4. Tinch oyna ≤ 12 soat. Mavjud uzun oynalar: oxiri = boshi + 12 soat.
create function private.quiet_window_minutes(p_start time, p_end time)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
           when p_start is null or p_end is null then null
           when p_end > p_start then (extract(epoch from (p_end - p_start)) / 60)::integer
           else (1440 - extract(epoch from (p_start - p_end)) / 60)::integer
         end
$$;

update public.companies
   set quiet_hours_end = quiet_hours_start + interval '12 hours'
 where private.quiet_window_minutes(quiet_hours_start, quiet_hours_end) > 720;

alter table public.companies
  add constraint companies_quiet_hours_window_check
    check (quiet_hours_start is null or quiet_hours_end is null
           or private.quiet_window_minutes(quiet_hours_start, quiet_hours_end) <= 720);

-- S5. Birlashtirilgan sotuvchi qaysi sotuvchiga qo'shilgani.
alter table public.suppliers
  add column merged_into uuid,
  add constraint suppliers_merged_into_fkey foreign key (company_id, merged_into)
    references public.suppliers (company_id, id);
create index suppliers_company_merged_into_idx on public.suppliers (company_id, merged_into)
  where merged_into is not null;

-- L6. To'lov manbasi: podotchet (xaridor qo'lidagi pul) yoki firma (bevosita firma puli).
-- Mavjud xaridlar: xaridorga hech qachon 'berildi' podotchet berilmagan bo'lsa — firma.
alter table public.purchases add column payment_source text;
update public.purchases p
   set payment_source = case
         when exists (select 1 from public.cash_advances ca
                       where ca.company_id = p.company_id and ca.recipient_id = p.buyer_id
                         and ca.kind = 'berildi' and ca.deleted_at is null)
         then 'podotchet' else 'firma' end
 where p.payment_source is null;
alter table public.purchases
  alter column payment_source set not null,
  add constraint purchases_payment_source_check check (payment_source in ('podotchet', 'firma'));
create index purchases_company_buyer_source_idx on public.purchases (company_id, buyer_id, payment_source)
  where deleted_at is null;

-- Ops. Outbox: holat bo'yicha ro'yxat/health; ref_idx — hech bir so'rov ishlatmaydi
-- ((kind, ref_id) unique indekslari bor).
create index notification_outbox_company_status_idx
  on public.notification_outbox (company_id, status, updated_at);
drop index if exists public.notification_outbox_ref_idx;

-- S1. Rasm xeshi navbati (tizim jadvali, private — API'da yo'q; faqat definer RPC'lar).
create table private.photo_hash_queue (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id),
  table_name      text not null check (table_name in ('movements', 'purchases')),
  record_id       uuid not null,
  photo_path      text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'sending', 'done', 'failed', 'stale')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  done_at         timestamptz
);
create unique index photo_hash_queue_open_key
  on private.photo_hash_queue (table_name, record_id, photo_path) where status in ('pending', 'sending');
create index photo_hash_queue_due_idx
  on private.photo_hash_queue (next_attempt_at) where status in ('pending', 'sending');
create index photo_hash_queue_company_idx on private.photo_hash_queue (company_id);
create index photo_hash_queue_record_idx on private.photo_hash_queue (table_name, record_id);
alter table private.photo_hash_queue enable row level security;
alter table private.photo_hash_queue force row level security;
revoke all on private.photo_hash_queue from public, anon, authenticated, service_role;

-- S8. RPC chastota cheklovi (sirpanuvchi oyna; profil + kalit bo'yicha bitta qator).
create table private.rate_limits (
  profile_id uuid not null references public.profiles (id),
  bucket     text not null,
  hits       timestamptz[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (profile_id, bucket)
);
alter table private.rate_limits enable row level security;
alter table private.rate_limits force row level security;
revoke all on private.rate_limits from public, anon, authenticated, service_role;

-- photo-hash Edge Function manzili va siri (tg-dispatch bilan bir xil usul).
insert into private.app_settings (key, value)
values ('photo_hash_url', 'https://srriiiugmxgrdnuvhgix.supabase.co/functions/v1/photo-hash')
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from vault.secrets s where s.name = 'photo_hash_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'photo_hash_secret',
      'photo-hash sweep auth'
    );
  end if;
end $$;

-- Outbox turlari: + transfer_cancelled, transfer_received, purchase_deleted,
-- purchase_on_your_name, inventory_applied, alerts_digest.
alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox drop constraint notification_outbox_kind_ref_check;
alter table public.notification_outbox
  add constraint notification_outbox_kind_check
    check (kind in ('alert', 'daily_report', 'alert_reminder', 'request_overdue', 'cash_statement', 'bug_report',
                    'request_created', 'request_decided', 'request_approved', 'transfer_sent',
                    'purchase_for_object', 'login_changed',
                    'transfer_cancelled', 'transfer_received', 'purchase_deleted',
                    'purchase_on_your_name', 'inventory_applied', 'alerts_digest')),
  add constraint notification_outbox_kind_ref_check check (
    (kind in ('alert', 'alert_reminder') and alert_id is not null and report_date is null and profile_id is null
       and ref_id is null)
    or (kind in ('daily_report', 'request_overdue') and report_date is not null and alert_id is null
       and profile_id is null and ref_id is null)
    or (kind = 'cash_statement' and report_date is not null and alert_id is null and profile_id is not null
       and ref_id is null)
    or (kind in ('bug_report', 'alerts_digest') and alert_id is null and report_date is null and profile_id is null
       and ref_id is null)
    or (kind in ('request_created', 'request_approved', 'transfer_sent', 'purchase_for_object',
                 'transfer_cancelled', 'purchase_deleted')
       and alert_id is null and report_date is null and profile_id is null and ref_id is not null)
    or (kind in ('request_decided', 'login_changed', 'transfer_received', 'purchase_on_your_name', 'inventory_applied')
       and alert_id is null and report_date is null and profile_id is not null and ref_id is not null)
  );

create unique index notification_outbox_workflow2_key
  on public.notification_outbox (kind, ref_id)
  where kind in ('transfer_cancelled', 'transfer_received', 'purchase_deleted', 'inventory_applied');
create unique index notification_outbox_buyer_key
  on public.notification_outbox (kind, ref_id, profile_id)
  where kind = 'purchase_on_your_name';

-- ============================================================================
-- 2. Yordamchilar
-- ============================================================================

-- L11. Qoida 1 taqsimlash qulfi (evaluate_purchase_receipt bilan bir xil kalit).
-- Tartib: receipt_alloc → alert_lock (kirim_manbasiz) — hamma yo'llarda.
create function private.lock_receipt_alloc(p_object_id uuid, p_material_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended(
    'terron.receipt_alloc:' || p_object_id::text || ':' || p_material_id::text, 0))
$$;

-- S8. Sirpanuvchi oyna: p_window ichida p_max dan ko'p chaqiruv → rate_limited.
create function private.rate_limit_hit(p_bucket text, p_max integer, p_window interval)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me   uuid := private.my_profile_id();
  v_hits timestamptz[];
begin
  if v_me is null then
    return;
  end if;
  insert into private.rate_limits (profile_id, bucket) values (v_me, p_bucket)
  on conflict (profile_id, bucket) do nothing;
  select r.hits into v_hits
    from private.rate_limits r
   where r.profile_id = v_me and r.bucket = p_bucket
     for update;
  v_hits := array(select h from unnest(v_hits) h where h > now() - p_window order by h);
  if cardinality(v_hits) >= p_max then
    raise exception 'Juda ko''p so''rov — birozdan keyin qayta urinib ko''ring'
      using errcode = '54000', hint = 'rate_limited';
  end if;
  update private.rate_limits r
     set hits = v_hits || now(), updated_at = now()
   where r.profile_id = v_me and r.bucket = p_bucket;
end;
$$;

-- S1. photo-hash Edge Function'ni uyg'otish (wake_dispatch kabi: tranzaksiyada bir marta,
-- har qanday xato — WARNING, navbat qoladi, cron qayta uyg'otadi).
create function private.wake_photo_hash()
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
  if coalesce(current_setting('terron.photo_hash_woken', true), '') = '1' then
    return null;
  end if;
  begin
    select s.value into v_url from private.app_settings s where s.key = 'photo_hash_url';
    select ds.decrypted_secret into v_secret
      from vault.decrypted_secrets ds
     where ds.name = 'photo_hash_secret'
     limit 1;
    if v_url is null or v_secret is null or v_secret = '' then
      raise warning 'photo-hash uyg''otilmadi: photo_hash_url yoki photo_hash_secret sozlanmagan';
      return null;
    end if;
    v_id := net.http_post(
      url                  := v_url,
      body                 := jsonb_build_object('mode', 'sweep'),
      headers              := jsonb_build_object(
                                'Content-Type', 'application/json',
                                'x-photo-secret', v_secret),
      timeout_milliseconds := 60000
    );
  exception when others then
    raise warning 'photo-hash uyg''otilmadi: % (%)', sqlerrm, sqlstate;
    return null;
  end;
  perform set_config('terron.photo_hash_woken', '1', true);
  return v_id;
end;
$$;

-- Alert uchun Telegram navbati (Batch 12 tg_alerts_notify tanasi; dayjest ham ishlatadi).
create function private.enqueue_alert_outbox(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a        public.alerts%rowtype;
  v_object   text;
  v_material text;
  v_unit     text;
begin
  select a.* into v_a from public.alerts a where a.id = p_alert_id;
  if not found then
    return;
  end if;
  if v_a.object_id is not null then
    select o.name into v_object from public.objects o
     where o.company_id = v_a.company_id and o.id = v_a.object_id;
  end if;
  if v_a.material_id is not null then
    select m.name, m.base_unit into v_material, v_unit from public.materials m
     where m.company_id = v_a.company_id and m.id = v_a.material_id;
  end if;

  insert into public.notification_outbox (company_id, kind, alert_id, payload)
  values (
    v_a.company_id, 'alert', v_a.id,
    jsonb_build_object(
      'alert_id',      v_a.id,
      'type',          v_a.type,
      'severity',      v_a.severity,
      'object_name',   v_object,
      'material_name', v_material,
      'base_unit',     v_unit,
      'details',       v_a.details,
      'created_at',    v_a.created_at
    )
  )
  on conflict (alert_id, escalation) where alert_id is not null and kind = 'alert' do nothing;
  if found then
    perform private.wake_dispatch();
  end if;
end;
$$;

-- L8. Qoida 6 alertlari qayta baholash paytida (reevaluate_open_requests) darhol
-- yuborilmaydi — id'lar terron.alert_digest_ids ga yig'iladi, commit'da bitta
-- dayjest (zz_alert_digest, deferred).
create or replace function private.tg_alerts_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type::text = 'smetadan_ortiq_sorov'
     and coalesce(current_setting('terron.alert_digest', true), '') = 'on' then
    perform set_config('terron.alert_digest_ids',
                       coalesce(current_setting('terron.alert_digest_ids', true), '') || new.id::text || ',',
                       true);
    return null;
  end if;
  perform private.enqueue_alert_outbox(new.id);
  return null;
end;
$$;

-- Dayjestni yuborish (commit oldidan, deferred constraint trigger). Firma bo'yicha:
-- hali ochiq bitta alert — oddiy 'alert' xabari; ikki va undan ko'p — 'alerts_digest'.
create function private.tg_alert_digest_flush()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text := coalesce(current_setting('terron.alert_digest_ids', true), '');
  v_ids uuid[];
  r     record;
begin
  if v_raw = '' then
    return null;
  end if;
  perform set_config('terron.alert_digest_ids', '', true);
  select array_agg(distinct x::uuid) into v_ids
    from unnest(string_to_array(v_raw, ',')) x
   where x <> '';

  for r in
    select a.company_id, array_agg(a.id order by a.created_at, a.id) as ids
      from public.alerts a
     where a.id = any (v_ids)
       and a.deleted_at is null
       and a.status in ('yangi', 'korildi')
     group by a.company_id
     order by a.company_id
  loop
    if cardinality(r.ids) = 1 then
      perform private.enqueue_alert_outbox(r.ids[1]);
      continue;
    end if;
    insert into public.notification_outbox (company_id, kind, payload)
    select r.company_id, 'alerts_digest',
           jsonb_build_object(
             'company_name', (select c.name from public.companies c where c.id = r.company_id),
             'alert_type',   'smetadan_ortiq_sorov',
             'count',        cardinality(r.ids),
             'alert_ids',    to_jsonb(r.ids),
             'items',        coalesce((
                               select jsonb_agg(jsonb_build_object(
                                        'alert_id',      a.id,
                                        'request_id',    a.request_id,
                                        'object_id',     a.object_id,
                                        'object_name',   o.name,
                                        'material_id',   a.material_id,
                                        'material_name', m.name,
                                        'over_qty_base', (a.details ->> 'over_qty_base')::numeric,
                                        'base_unit',     m.base_unit) order by x.ord)
                                 from unnest(r.ids) with ordinality x(id, ord)
                                 join public.alerts a on a.id = x.id
                                 left join public.objects o on o.company_id = a.company_id and o.id = a.object_id
                                 left join public.materials m on m.company_id = a.company_id and m.id = a.material_id
                                where x.ord <= 20), '[]'::jsonb),
             'more_count',   greatest(cardinality(r.ids) - 20, 0),
             'created_at',   now());
    perform private.wake_dispatch();
  end loop;
  return null;
end;
$$;

create constraint trigger zz_alert_digest after insert on public.alerts
  deferrable initially deferred
  for each row
  when (new.type = 'smetadan_ortiq_sorov')
  execute function private.tg_alert_digest_flush();

-- Qoida 6 qayta baholash (A7 versiyasi) — dayjest rejimida.
create or replace function private.reevaluate_open_requests(
  p_company_id  uuid,
  p_object_id   uuid,
  p_material_id uuid,
  p_exclude     uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_prev text := coalesce(current_setting('terron.alert_digest', true), '');
begin
  perform set_config('terron.alert_digest', 'on', true);
  for v_id in
    select r.id
      from public.material_requests r
     where r.company_id = p_company_id
       and r.object_id = p_object_id
       and (p_material_id is null or r.material_id = p_material_id)
       and r.status in ('kutilmoqda', 'tasdiqlandi')
       and r.deleted_at is null
       and r.id is distinct from p_exclude
     order by r.material_id, r.id
  loop
    perform private.evaluate_request(v_id);
  end loop;
  perform set_config('terron.alert_digest', v_prev, true);
end;
$$;

-- L7. movements (chiqim) — qoida 4 dan keyin shu juftlikning ochiq so'rovlari (qoida 6).
create or replace function private.tg_movements_norm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select distinct x.o, x.m
      from (select new.object_id as o, new.material_id as m, new.type as t
            union all
            select old.object_id, old.material_id, old.type where tg_op = 'UPDATE') x
     where x.t = 'chiqim'
     order by x.o, x.m
  loop
    perform private.evaluate_norm(new.company_id, r.o, r.m);
    perform private.reevaluate_open_requests(new.company_id, r.o, r.m, null);
  end loop;
  return null;
end;
$$;

-- ============================================================================
-- 3. S1 — rasm xeshi navbati
-- ============================================================================

-- Rasm yo'li qo'yilgan va xeshi yo'q tirik yozuv → navbat (yo'l bo'yicha bitta ochiq
-- ish) + photo-hash uyg'otiladi. tg_argv[0] — rasm yo'li ustuni.
create function private.tg_photo_hash_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := to_jsonb(new) ->> tg_argv[0];
begin
  if v_path is null then
    return null;
  end if;
  insert into private.photo_hash_queue (company_id, table_name, record_id, photo_path)
  values (new.company_id, tg_table_name, new.id, v_path)
  on conflict (table_name, record_id, photo_path) where status in ('pending', 'sending') do nothing;
  if found then
    perform private.wake_photo_hash();
  end if;
  return null;
end;
$$;

create trigger zz_photo_hash_ins after insert on public.movements
  for each row
  when (new.photo_path is not null and new.photo_sha256 is null and new.deleted_at is null)
  execute function private.tg_photo_hash_enqueue('photo_path');
create trigger zz_photo_hash_upd after update on public.movements
  for each row
  when (new.photo_path is not null and new.photo_sha256 is null and new.deleted_at is null
        and (old.photo_path is distinct from new.photo_path
             or old.photo_sha256 is not null
             or old.deleted_at is not null))
  execute function private.tg_photo_hash_enqueue('photo_path');
create trigger zz_photo_hash_ins after insert on public.purchases
  for each row
  when (new.receipt_photo_path is not null and new.receipt_photo_sha256 is null and new.deleted_at is null)
  execute function private.tg_photo_hash_enqueue('receipt_photo_path');
create trigger zz_photo_hash_upd after update on public.purchases
  for each row
  when (new.receipt_photo_path is not null and new.receipt_photo_sha256 is null and new.deleted_at is null
        and (old.receipt_photo_path is distinct from new.receipt_photo_path
             or old.receipt_photo_sha256 is not null
             or old.deleted_at is not null))
  execute function private.tg_photo_hash_enqueue('receipt_photo_path');

-- B5 versiyasi + p_expected_path: berilsa, xesh faqat yozuvning rasm yo'li hali shu
-- bo'lsa yoziladi (eski yuklashning kechikkan javobi yangi rasmga yozilmaydi).
-- Muvaffaqiyatda shu yozuv+yo'lning ochiq navbat ishlari — done.
drop function public.svc_set_photo_hash(text, uuid, text);

create function public.svc_set_photo_hash(
  p_table         text,
  p_id            uuid,
  p_sha256        text,
  p_expected_path text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sha  text := nullif(lower(btrim(p_sha256)), '');
  v_path text;
  v_ok   boolean;
begin
  if p_table is null or p_table not in ('movements', 'purchases') or p_id is null then
    raise exception 'Jadval yoki yozuv noto''g''ri' using errcode = '22023', hint = 'photo_hash_invalid';
  end if;
  if v_sha is not null and v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'Rasm xeshi noto''g''ri formatda (SHA-256, 64 ta hex belgi)'
      using errcode = '23514', hint = 'photo_sha256_invalid';
  end if;

  if p_table = 'movements' then
    update public.movements m
       set photo_sha256 = v_sha
     where m.id = p_id and m.deleted_at is null and m.photo_path is not null
       and (p_expected_path is null or m.photo_path = p_expected_path)
       and m.photo_sha256 is distinct from v_sha;
    select m.photo_path, (m.photo_sha256 is not distinct from v_sha) into v_path, v_ok
      from public.movements m
     where m.id = p_id and m.deleted_at is null and m.photo_path is not null
       and (p_expected_path is null or m.photo_path = p_expected_path);
  else
    update public.purchases p
       set receipt_photo_sha256 = v_sha
     where p.id = p_id and p.deleted_at is null and p.receipt_photo_path is not null
       and (p_expected_path is null or p.receipt_photo_path = p_expected_path)
       and p.receipt_photo_sha256 is distinct from v_sha;
    select p.receipt_photo_path, (p.receipt_photo_sha256 is not distinct from v_sha) into v_path, v_ok
      from public.purchases p
     where p.id = p_id and p.deleted_at is null and p.receipt_photo_path is not null
       and (p_expected_path is null or p.receipt_photo_path = p_expected_path);
  end if;
  v_ok := coalesce(v_ok, false);

  if v_ok and v_sha is not null then
    update private.photo_hash_queue q
       set status = 'done', done_at = now(), updated_at = now()
     where q.table_name = p_table and q.record_id = p_id and q.photo_path = v_path
       and q.status in ('pending', 'sending');
  end if;
  return v_ok;
end;
$$;

-- Navbatdan olish (photo-hash sweep): avval eskirgan ishlar yopiladi (yozuv o'chirilgan,
-- rasm yo'li o'zgargan → stale; xesh allaqachon bor → done); 10 daqiqadan beri
-- "sending" va 6 urinish — failed. Keyin muddati kelgan pending / osilib qolgan sending
-- ishlar "sending" ga o'tadi (attempts + 1). Qaytaradi: olingan ishlar.
create function public.svc_claim_photo_hash_jobs(p_limit integer default 20)
returns table (
  job_id     uuid,
  company_id uuid,
  table_name text,
  record_id  uuid,
  photo_path text,
  attempts   integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update private.photo_hash_queue q
     set status     = case when x.cur_path = q.photo_path and x.has_hash then 'done' else 'stale' end,
         done_at    = now(),
         updated_at = now()
    from (
      select q2.id as qid,
             coalesce(m.photo_path, p.receipt_photo_path) as cur_path,
             coalesce(m.photo_sha256, p.receipt_photo_sha256) is not null as has_hash,
             coalesce(m.deleted_at, p.deleted_at) as del,
             (m.id is null and p.id is null) as missing
        from private.photo_hash_queue q2
        left join public.movements m on q2.table_name = 'movements' and m.id = q2.record_id
        left join public.purchases p on q2.table_name = 'purchases' and p.id = q2.record_id
       where q2.status in ('pending', 'sending')
    ) x
   where q.id = x.qid
     and (x.missing or x.del is not null or x.cur_path is distinct from q.photo_path or x.has_hash);

  update private.photo_hash_queue q
     set status = 'failed', last_error = coalesce(q.last_error, 'stuck_in_sending'), updated_at = now()
   where q.status = 'sending'
     and q.updated_at < now() - interval '10 minutes'
     and q.attempts >= 6;

  return query
  with c as (
    select q.id as cid
      from private.photo_hash_queue q
     where (q.status = 'pending' and q.next_attempt_at <= now())
        or (q.status = 'sending' and q.updated_at < now() - interval '10 minutes')
     order by q.next_attempt_at, q.created_at, q.id
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
       for update skip locked
  )
  update private.photo_hash_queue q
     set status = 'sending', attempts = q.attempts + 1, updated_at = now()
    from c
   where q.id = c.cid
  returning q.id, q.company_id, q.table_name, q.record_id, q.photo_path, q.attempts;
end;
$$;

-- Ishni yakunlash: p_sha256 berilsa — svc_set_photo_hash(..., job.photo_path) (yo'l
-- o'zgargan bo'lsa → stale); aks holda xato: p_final yoki 6 urinish → failed, yo'qsa
-- pending (2^attempts daqiqadan keyin). Qaytaradi: ishning yangi holati (topilmasa null).
create function public.svc_complete_photo_hash_job(
  p_job_id uuid,
  p_sha256 text default null,
  p_error  text default null,
  p_final  boolean default false
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_q     private.photo_hash_queue%rowtype;
  v_ok    boolean;
  v_error text := left(nullif(btrim(coalesce(p_error, '')), ''), 1000);
begin
  select q.* into v_q from private.photo_hash_queue q where q.id = p_job_id for update;
  if not found then
    return null;
  end if;
  if v_q.status not in ('pending', 'sending') then
    return v_q.status;
  end if;

  if nullif(btrim(coalesce(p_sha256, '')), '') is not null then
    v_ok := public.svc_set_photo_hash(v_q.table_name, v_q.record_id, p_sha256, v_q.photo_path);
    if not v_ok then
      update private.photo_hash_queue q
         set status = 'stale', done_at = now(), updated_at = now()
       where q.id = v_q.id and q.status in ('pending', 'sending');
    end if;
    return (select q.status from private.photo_hash_queue q where q.id = v_q.id);
  end if;

  if coalesce(p_final, false) or v_q.attempts >= 6 then
    update private.photo_hash_queue q
       set status = 'failed', last_error = coalesce(v_error, 'permanent_error'), updated_at = now()
     where q.id = v_q.id;
    return 'failed';
  end if;
  update private.photo_hash_queue q
     set status = 'pending',
         last_error = coalesce(v_error, 'unknown_error'),
         next_attempt_at = now() + make_interval(mins => power(2, greatest(v_q.attempts, 0))::integer),
         updated_at = now()
   where q.id = v_q.id;
  return 'pending';
end;
$$;

-- Cron (5 daqiqa): muddati kelgan ish bo'lsa — photo-hash uyg'otiladi. Qaytaradi: ishlar soni.
create function private.photo_hash_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  select count(*)::integer into v_n
    from private.photo_hash_queue q
   where (q.status = 'pending' and q.next_attempt_at <= now())
      or (q.status = 'sending' and q.updated_at < now() - interval '10 minutes');
  if v_n > 0 then
    perform private.wake_photo_hash();
  end if;
  return v_n;
end;
$$;

create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'terron-photo-hash-sweep') then
    perform cron.unschedule('terron-photo-hash-sweep');
  end if;
  perform cron.schedule('terron-photo-hash-sweep', '*/5 * * * *', 'select private.photo_hash_sweep()');
end $$;

-- ============================================================================
-- 4. S2 — boshqa xaridor nomidan xarid; L6 — to'lov manbasi
-- ============================================================================

-- BEFORE (foydalanuvchi sessiyasi, admin / super_admin): xaridor ≠ kirituvchi bo'lsa (INSERT yoki buyer_id
-- o'zgarsa) — xaridor shu firmaning faol, o'chirilmagan haydovchi / ta'minotchi /
-- prorab / admin profili bo'lishi shart (purchase_buyer_invalid).
-- payment_source: admin / super_admin / buxgalter — o'zi tanlaydi (null → qoida);
-- boshqalar — INSERT'da qoida bo'yicha, UPDATE'da o'zgarmaydi. Qoida: xaridorga
-- tirik 'berildi' podotchet hech qachon berilmagan bo'lsa — 'firma', aks holda
-- 'podotchet'. Tizim (auth.uid() yo'q) — null → 'podotchet'.
create function private.tg_purchases_buyer_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  boolean := auth.uid() is not null;
  v_admin boolean := private.has_role('super_admin', 'admin', 'buxgalter');
  v_rule  text;
begin
  -- faqat admin / super_admin boshqa xaridorni tanlay oladi (boshqalarni RLS rad etadi);
  -- boshqa firma / mavjud bo'lmagan profil — kompozit FK (23503) o'zi rad etadi
  if v_user and new.deleted_at is null
     and private.has_role('super_admin', 'admin')
     and new.buyer_id is distinct from new.created_by
     and (tg_op = 'INSERT' or new.buyer_id is distinct from old.buyer_id)
     and exists (select 1 from public.profiles pr where pr.company_id = new.company_id and pr.id = new.buyer_id)
     and not exists (
       select 1 from public.profiles pr
        where pr.company_id = new.company_id
          and pr.id = new.buyer_id
          and pr.deleted_at is null
          and pr.is_active
          and pr.role in ('haydovchi', 'taminotchi', 'prorab', 'admin')) then
    raise exception 'Xaridor faqat faol haydovchi, ta''minotchi, prorab yoki administrator bo''lishi mumkin'
      using errcode = '23514', hint = 'purchase_buyer_invalid';
  end if;

  if tg_op = 'UPDATE' and v_user and not v_admin then
    new.payment_source := old.payment_source;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.payment_source is null then
    new.payment_source := old.payment_source;
  end if;
  if tg_op = 'INSERT' and (new.payment_source is null or (v_user and not v_admin)) then
    if not v_user then
      v_rule := 'podotchet';
    elsif exists (select 1 from public.cash_advances ca
                   where ca.company_id = new.company_id and ca.recipient_id = new.buyer_id
                     and ca.kind = 'berildi' and ca.deleted_at is null) then
      v_rule := 'podotchet';
    else
      v_rule := 'firma';
    end if;
    new.payment_source := v_rule;
  end if;
  return new;
end;
$$;

create trigger b_buyer_guard before insert or update on public.purchases
  for each row execute function private.tg_purchases_buyer_guard();

-- AFTER (foydalanuvchi sessiyasi): boshqa odam nomidan xarid → xarid_boshqa_nomidan
-- (ogohlantirish, darhol Telegram — direktor, admin) + xaridorga purchase_on_your_name.
create function private.tg_purchases_other_buyer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.my_profile_id();
  v_buyer  text;
  v_actor  text;
  v_obj    text;
  v_mat    text;
  v_unit   text;
  v_alert  uuid;
begin
  if auth.uid() is null or new.deleted_at is not null or new.buyer_id is null
     or new.buyer_id is not distinct from coalesce(v_me, new.created_by) then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.buyer_id is not distinct from old.buyer_id then
    return null;
  end if;

  select p.full_name into v_buyer from public.profiles p where p.company_id = new.company_id and p.id = new.buyer_id;
  select p.full_name into v_actor from public.profiles p where p.id = v_me;
  select o.name into v_obj from public.objects o where o.company_id = new.company_id and o.id = new.object_id;
  select m.name, m.base_unit into v_mat, v_unit from public.materials m
   where m.company_id = new.company_id and m.id = new.material_id;

  insert into public.alerts (company_id, type, severity, object_id, material_id, purchase_id, details)
  values (new.company_id, 'xarid_boshqa_nomidan'::public.alert_type, 'ogohlantirish',
          new.object_id, new.material_id, new.id,
          jsonb_build_object(
            'purchase_id',      new.id,
            'buyer_id',         new.buyer_id,
            'buyer_name',       v_buyer,
            'actor_profile_id', v_me,
            'actor_name',       v_actor,
            'amount',           new.total_amount,
            'object_id',        new.object_id,
            'object_name',      v_obj,
            'material_id',      new.material_id,
            'material_name',    v_mat,
            'qty_base',         new.qty_base,
            'base_unit',        v_unit,
            'purchased_at',     new.purchased_at,
            'payment_source',   new.payment_source,
            'via',              lower(tg_op)))
  returning id into v_alert;

  perform private.enqueue_workflow(new.company_id, 'purchase_on_your_name', new.id, new.buyer_id,
    jsonb_build_object(
      'purchase_id',    new.id,
      'alert_id',       v_alert,
      'company_name',   (select c.name from public.companies c where c.id = new.company_id),
      'buyer_id',       new.buyer_id,
      'buyer_name',     v_buyer,
      'actor_name',     v_actor,
      'object_id',      new.object_id,
      'object_name',    v_obj,
      'material_id',    new.material_id,
      'material_name',  v_mat,
      'qty_input',      new.qty_input,
      'unit_input',     new.unit_input,
      'qty_base',       new.qty_base,
      'base_unit',      v_unit,
      'total_amount',   new.total_amount,
      'payment_source', new.payment_source,
      'purchased_at',   new.purchased_at));
  return null;
end;
$$;

create trigger zz_other_buyer_ins after insert on public.purchases
  for each row execute function private.tg_purchases_other_buyer();
create trigger zz_other_buyer_upd after update on public.purchases
  for each row when (old.buyer_id is distinct from new.buyer_id)
  execute function private.tg_purchases_other_buyer();

-- L6. Qo'limdagi pul — faqat 'podotchet' xaridlar (Batch 12 versiyasi).
create or replace view public.cash_balances
with (security_invoker = true)
as
with ledger as (
  select ca.company_id,
         ca.recipient_id                                                           as profile_id,
         (case when ca.kind = 'berildi' then ca.amount else 0 end)::numeric(18,2)    as issued,
         0::numeric(18,2)                                                          as spent,
         (case when ca.kind = 'qaytarildi' then ca.amount else 0 end)::numeric(18,2) as returned,
         case when ca.kind = 'berildi' then ca.issued_at end                       as issued_ts,
         null::timestamptz                                                         as spent_ts
    from public.cash_advances ca
   where ca.deleted_at is null
  union all
  select p.company_id,
         p.buyer_id,
         0::numeric(18,2),
         p.total_amount,
         0::numeric(18,2),
         null::timestamptz,
         p.purchased_at
    from public.purchases p
   where p.deleted_at is null
     and p.payment_source = 'podotchet'
)
select l.company_id,
       l.profile_id,
       sum(l.issued)::numeric(18,2)                                   as issued_total,
       sum(l.spent)::numeric(18,2)                                    as spent_total,
       (sum(l.issued) - sum(l.returned) - sum(l.spent))::numeric(18,2) as balance,
       max(l.issued_ts)                                               as last_issued_at,
       max(l.spent_ts)                                                as last_spent_at,
       sum(l.returned)::numeric(18,2)                                 as returned_total
  from ledger l
 where l.profile_id = (select private.my_profile_id())
    or (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter'))
    or current_user in ('service_role', 'postgres')
 group by l.company_id, l.profile_id;

create or replace function private.cash_position(
  p_company_id uuid,
  p_profile_id uuid,
  out issued_total   numeric,
  out returned_total numeric,
  out spent_total    numeric,
  out balance        numeric,
  out oldest_open_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  select coalesce(sum(ca.amount) filter (where ca.kind = 'berildi'), 0)::numeric(18,2),
         coalesce(sum(ca.amount) filter (where ca.kind = 'qaytarildi'), 0)::numeric(18,2)
    into issued_total, returned_total
    from public.cash_advances ca
   where ca.company_id = p_company_id
     and ca.recipient_id = p_profile_id
     and ca.deleted_at is null;

  select coalesce(sum(p.total_amount), 0)::numeric(18,2) into spent_total
    from public.purchases p
   where p.company_id = p_company_id
     and p.buyer_id = p_profile_id
     and p.deleted_at is null
     and p.payment_source = 'podotchet';

  balance := (issued_total - returned_total - spent_total)::numeric(18,2);

  if balance > 0 then
    select min(x.issued_at) into oldest_open_at
      from (
        select ca.issued_at,
               sum(ca.amount) over (order by ca.issued_at, ca.id) as cum
          from public.cash_advances ca
         where ca.company_id = p_company_id
           and ca.recipient_id = p_profile_id
           and ca.kind = 'berildi'
           and ca.deleted_at is null
      ) x
     where x.cum > spent_total + returned_total;
  end if;
end;
$$;

-- ============================================================================
-- 5. S3 / L1 / L5 — purchases guard (audit_fixes B6 versiyasi). O'zgargani:
--   * receipt_verified = keshda chek VA (|kesh.total − total_amount| ≤ 1 YOKI biror
--     items[].sum total_amount dan ≤ 1 farq) VA sana ±3 kun. "Chekda bitta qator"
--     endi o'zi yetarli emas (L1: bir qatorli 10 000 so'mlik chek 50 mln xaridni
--     tasdiqlardi);
--   * rasm talabidan ozod — tasdiqlangan, bir qatorli VA receipt_total null emas;
--   * merge_suppliers ichida (terron.merge_rpc, UPDATE) — receipt_verified,
--     receipt_total, seller_tin eski qiymatida qoladi (tarixiy xarid qayta baholanmaydi).
-- ============================================================================
create or replace function private.tg_purchases_auto_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revived  boolean := false;
  v_merge    boolean := coalesce(current_setting('terron.merge_rpc', true), '') = 'on';
  v_lookup   record;
  v_found    boolean;
  v_other    record;
  v_limit    numeric;
  v_mat_req  boolean;
  v_check    boolean;
  v_r        record;
  v_items    jsonb;
  v_n        integer := 0;
  v_multi    boolean := false;
  v_ok       boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_revived := old.deleted_at is not null and new.deleted_at is null;
  end if;

  -- (1)
  if new.receipt_photo_path is null then
    new.receipt_photo_sha256 := null;
  end if;
  if new.receipt_photo_sha256 is not null then
    new.receipt_photo_sha256 := nullif(lower(btrim(new.receipt_photo_sha256)), '');
    if new.receipt_photo_sha256 is not null and new.receipt_photo_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception 'Rasm xeshi noto''g''ri formatda (SHA-256, 64 ta hex belgi)'
        using errcode = '23514', hint = 'photo_sha256_invalid';
    end if;
  end if;

  -- (2)
  new.receipt_fiscal_sign := nullif(btrim(new.receipt_fiscal_sign), '');
  new.receipt_terminal_id := nullif(btrim(new.receipt_terminal_id), '');
  new.receipt_no          := nullif(btrim(new.receipt_no), '');
  new.seller_tin          := nullif(btrim(new.seller_tin), '');

  if tg_op = 'UPDATE' and v_merge then
    new.receipt_verified := old.receipt_verified;
    new.receipt_total    := old.receipt_total;
    new.seller_tin       := old.seller_tin;
  elsif new.receipt_fiscal_sign is null then
    new.receipt_verified := false;
    if auth.uid() is not null then
      new.receipt_total := null;
      new.seller_tin    := null;
    end if;
  else
    select l.total, l.seller_tin, l.receipt_at, l.payload into v_lookup
      from public.receipt_lookups l
     where l.company_id = new.company_id
       and l.fiscal_sign = new.receipt_fiscal_sign
       and l.deleted_at is null;
    v_found := found;
    if v_found then
      v_items := case when jsonb_typeof(v_lookup.payload -> 'items') = 'array'
                      then v_lookup.payload -> 'items' else '[]'::jsonb end;
      v_n := jsonb_array_length(v_items);
      v_multi := v_n > 1;
      v_ok := (
                (v_lookup.total is not null and abs(v_lookup.total - new.total_amount) <= 1)
                or exists (
                     select 1 from jsonb_array_elements(v_items) e
                      where jsonb_typeof(e) = 'object'
                        and (e ->> 'sum') ~ '^-?[0-9]+(\.[0-9]+)?$'
                        and abs((e ->> 'sum')::numeric - new.total_amount) <= 1)
              )
              and v_lookup.receipt_at is not null
              and abs(extract(epoch from (v_lookup.receipt_at - new.purchased_at))) <= 3 * 86400;
    end if;
    if auth.uid() is not null then
      new.receipt_verified := coalesce(v_found and v_ok, false);
      if v_found then
        if v_lookup.total is not null then
          new.receipt_total := v_lookup.total;
        end if;
        new.seller_tin := coalesce(v_lookup.seller_tin, new.seller_tin);
      end if;
    elsif v_found then
      new.receipt_total := coalesce(new.receipt_total, v_lookup.total);
      new.seller_tin    := coalesce(new.seller_tin, v_lookup.seller_tin);
    end if;
  end if;

  -- (3)
  if new.receipt_fiscal_sign is not null and new.deleted_at is null
     and (tg_op = 'INSERT' or v_revived or new.receipt_fiscal_sign is distinct from old.receipt_fiscal_sign) then
    perform pg_advisory_xact_lock(hashtextextended(
      'terron.receipt:' || new.company_id::text || ':' || new.receipt_fiscal_sign, 0));
    select p.created_at, pr.full_name into v_other
      from public.purchases p
      left join public.profiles pr on pr.company_id = p.company_id and pr.id = p.buyer_id
     where p.company_id = new.company_id
       and p.receipt_fiscal_sign = new.receipt_fiscal_sign
       and p.deleted_at is null
       and p.id <> new.id
     order by p.created_at
     limit 1;
    if found then
      raise exception 'Bu chek allaqachon ishlatilgan: %, %',
        coalesce(v_other.full_name, '—'),
        to_char(v_other.created_at at time zone 'Asia/Tashkent', 'DD.MM.YYYY HH24:MI')
        using errcode = '23505', hint = 'receipt_already_used';
    end if;
  end if;

  -- (4) rasm: tasdiqlangan, bir qatorli va summasi ma'lum chek — ozod
  if new.deleted_at is null and new.receipt_photo_path is null
     and not (new.receipt_verified and not v_multi and new.receipt_total is not null)
     and not v_merge then
    if tg_op = 'INSERT' then
      v_check := true;
    else
      v_check := new.total_amount is distinct from old.total_amount
              or new.material_id is distinct from old.material_id
              or old.receipt_photo_path is not null
              or new.receipt_verified is distinct from old.receipt_verified;
    end if;
    if v_check then
      select c.photo_required_amount into v_limit from public.companies c where c.id = new.company_id;
      select m.photo_required into v_mat_req
        from public.materials m
       where m.company_id = new.company_id and m.id = new.material_id;
      if (v_limit is not null and new.total_amount >= v_limit) or coalesce(v_mat_req, false) then
        raise exception 'Chek rasmi majburiy (summa chegaradan katta yoki material uchun rasm talab qilinadi)'
          using errcode = '23514', hint = 'photo_required';
      end if;
    end if;
  end if;

  -- (5)
  if new.request_id is not null and new.deleted_at is null
     and (tg_op = 'INSERT' or v_revived
          or new.request_id is distinct from old.request_id
          or new.object_id is distinct from old.object_id
          or new.material_id is distinct from old.material_id) then
    select r.object_id, r.material_id, r.status, r.deleted_at into v_r
      from public.material_requests r
     where r.company_id = new.company_id and r.id = new.request_id;
    if not found or v_r.deleted_at is not null then
      raise exception 'So''rov topilmadi yoki o''chirilgan'
        using errcode = '23503', hint = 'purchase_request_invalid';
    end if;
    if v_r.object_id is distinct from new.object_id or v_r.material_id is distinct from new.material_id then
      raise exception 'So''rov boshqa obyekt yoki materialga tegishli'
        using errcode = '23514', hint = 'purchase_request_invalid';
    end if;
    if v_r.status not in ('tasdiqlandi', 'xarid_qilindi') then
      raise exception 'Faqat tasdiqlangan so''rov bo''yicha xarid qilish mumkin'
        using errcode = '23514', hint = 'purchase_request_invalid';
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 6. S5 — yozuv_ozgartirildi (audit_fixes B1 versiyasi) +:
--   kuzatiladigan ustunlar: movements — + photo_path, geo_*; purchases — +
--   receipt_photo_path, receipt_fiscal_sign, supplier_id, seller_tin, request_id,
--   geo_*, payment_source. merge_suppliers ichida (terron.merge_rpc) — alert yo'q
--   (bitta sotuvchi_birlashtirildi belgisi). correct_entry sababi — details.reason.
-- ============================================================================
create or replace function private.tg_posted_change_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new     jsonb := to_jsonb(new);
  v_old     jsonb := to_jsonb(old);
  v_cols    text[];
  v_changed text[];
  v_before  jsonb := '{}'::jsonb;
  v_after   jsonb := '{}'::jsonb;
  v_me      uuid := private.my_profile_id();
  v_mode    text := coalesce(current_setting('terron.correct_mode', true), '');
  v_reason  text := nullif(coalesce(current_setting('terron.correct_reason', true), ''), '');
  v_type    text;
  v_sev     text;
  c         text;
begin
  if auth.uid() is null or old.deleted_at is not null or new.deleted_at is not null
     or private.transfer_rpc_active() or private.inventory_rpc_active()
     or coalesce(current_setting('terron.merge_rpc', true), '') = 'on' then
    return null;
  end if;

  v_cols := case tg_table_name
    when 'movements' then array['type', 'object_id', 'material_id', 'unit_id', 'qty_input', 'qty_base',
                                'occurred_at', 'purchase_id', 'photo_path',
                                'geo_lat', 'geo_lng', 'geo_accuracy_m', 'geo_status']
    else array['object_id', 'material_id', 'unit_id', 'qty_input', 'qty_base', 'total_amount',
               'unit_price', 'price_per_base', 'purchased_at', 'buyer_id',
               'receipt_photo_path', 'receipt_fiscal_sign', 'supplier_id', 'seller_tin', 'request_id',
               'geo_lat', 'geo_lng', 'geo_accuracy_m', 'geo_status', 'payment_source']
  end;
  select array_agg(k order by k) into v_changed
    from unnest(v_cols) k
   where v_new -> k is distinct from v_old -> k;
  if v_changed is null then
    return null;
  end if;

  foreach c in array v_changed || array['unit_input'] loop
    v_before := v_before || jsonb_build_object(c, v_old -> c);
    v_after  := v_after  || jsonb_build_object(c, v_new -> c);
  end loop;

  if v_mode = 'author' then
    v_type := 'yozuv_tuzatildi';
    v_sev  := 'belgi';
  else
    v_type := 'yozuv_ozgartirildi';
    v_sev  := 'ogohlantirish';
  end if;

  insert into public.alerts
    (company_id, type, severity, object_id, material_id, purchase_id, movement_id, details)
  values
    (new.company_id, v_type::public.alert_type, v_sev::public.alert_severity,
     (v_new ->> 'object_id')::uuid, (v_new ->> 'material_id')::uuid,
     case when tg_table_name = 'purchases' then new.id end,
     case when tg_table_name = 'movements' then new.id end,
     jsonb_build_object(
       'table',            tg_table_name,
       'record_id',        new.id,
       'changed',          to_jsonb(v_changed),
       'before',           v_before,
       'after',            v_after,
       'via',              case when v_mode <> '' then 'correct_entry' else 'direct' end,
       'reason',           v_reason,
       'actor_profile_id', v_me,
       'actor_name',       (select p.full_name from public.profiles p where p.id = v_me),
       'author_id',        v_new -> 'created_by',
       'author_name',      (select p.full_name from public.profiles p
                             where p.company_id = new.company_id and p.id = (v_new ->> 'created_by')::uuid),
       'material_name',    (select m.name from public.materials m
                             where m.company_id = new.company_id and m.id = (v_new ->> 'material_id')::uuid),
       'base_unit',        (select m.base_unit from public.materials m
                             where m.company_id = new.company_id and m.id = (v_new ->> 'material_id')::uuid),
       'movement_type',    case when tg_table_name = 'movements' then v_new -> 'type' end));
  return null;
end;
$$;

-- ============================================================================
-- 7. S5 / L5 — merge_suppliers (audit_fixes D4 versiyasi):
--   (1) p_merge soft delete + merged_into = p_keep (STIR unique to'qnashmasin);
--   (2) p_keep dagi bo'sh tin / phone / note — p_merge dan (xaridlar ko'chirilishidan
--       OLDIN — sotuvchi STIR tekshiruvi to'g'ri STIR bilan ishlaydi);
--   (3) p_merge ning BARCHA xaridlari (o'chirilganlari ham) p_keep ga; tarixiy
--       chek maydonlari o'zgarmaydi (tg_purchases_auto_guard merge rejimi);
--   (4) sotuvchi_birlashtirildi (belgi): sonlar, moved_purchase_ids.
--   Qaytaradi: ko'chirilgan tirik xaridlar soni (avvalgidek).
-- ============================================================================
create or replace function public.merge_suppliers(p_keep uuid, p_merge uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.my_profile_id();
  v_keep   public.suppliers%rowtype;
  v_merge  public.suppliers%rowtype;
  v_live   uuid[];
  v_dead   uuid[];
  v_filled text[] := '{}';
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  if not private.has_role('super_admin', 'admin') then
    raise exception 'Sotuvchilarni birlashtirish faqat administratorga ruxsat etilgan'
      using errcode = '42501', hint = 'supplier_merge_forbidden';
  end if;
  if p_keep is null or p_merge is null or p_keep = p_merge then
    raise exception 'Ikki xil sotuvchini tanlang' using errcode = '22023', hint = 'supplier_merge_invalid';
  end if;

  perform 1 from public.suppliers s where s.id in (p_keep, p_merge) order by s.id for update;
  select s.* into v_keep from public.suppliers s where s.id = p_keep and s.deleted_at is null;
  select s.* into v_merge from public.suppliers s where s.id = p_merge and s.deleted_at is null;
  if v_keep.id is null or v_merge.id is null
     or not private.can_access_company(v_keep.company_id)
     or v_merge.company_id <> v_keep.company_id then
    raise exception 'Sotuvchi topilmadi' using errcode = 'P0002', hint = 'supplier_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('terron.suppliers:' || v_keep.company_id::text, 0));
  perform set_config('terron.merge_rpc', 'on', true);

  update public.suppliers set deleted_at = now(), merged_into = p_keep where id = p_merge;

  if v_keep.tin is null and v_merge.tin is not null then v_filled := array_append(v_filled, 'tin'); end if;
  if v_keep.phone is null and v_merge.phone is not null then v_filled := array_append(v_filled, 'phone'); end if;
  if v_keep.note is null and v_merge.note is not null then v_filled := array_append(v_filled, 'note'); end if;
  if cardinality(v_filled) > 0 then
    update public.suppliers
       set tin   = coalesce(tin, v_merge.tin),
           phone = coalesce(phone, v_merge.phone),
           note  = coalesce(note, v_merge.note)
     where id = p_keep;
  end if;

  select coalesce(array_agg(p.id order by p.id) filter (where p.deleted_at is null), '{}'),
         coalesce(array_agg(p.id order by p.id) filter (where p.deleted_at is not null), '{}')
    into v_live, v_dead
    from public.purchases p
   where p.company_id = v_keep.company_id
     and p.supplier_id = p_merge;

  update public.purchases p
     set supplier_id = p_keep
   where p.company_id = v_keep.company_id
     and p.supplier_id = p_merge;

  insert into public.alerts (company_id, type, severity, details)
  values (v_keep.company_id, 'sotuvchi_birlashtirildi'::public.alert_type, 'belgi',
          jsonb_build_object(
            'keep_supplier_id',    v_keep.id,
            'keep_name',           v_keep.name,
            'merged_supplier_id',  v_merge.id,
            'merged_name',         v_merge.name,
            'moved_count',         cardinality(v_live),
            'moved_deleted_count', cardinality(v_dead),
            'moved_purchase_ids',  to_jsonb(v_live || v_dead),
            'filled',              to_jsonb(v_filled),
            'actor_profile_id',    v_me,
            'actor_name',          (select p.full_name from public.profiles p where p.id = v_me)));

  perform set_config('terron.merge_rpc', 'off', true);
  return cardinality(v_live);
end;
$$;

-- L5. Sotuvchi STIR o'zgarsa — uning xaridlari bo'yicha sotuvchi_stir_farqi qayta baholanadi.
create function private.tg_suppliers_tin_reeval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select p.id from public.purchases p
     where p.company_id = new.company_id
       and p.supplier_id = new.id
       and p.seller_tin is not null
     order by p.id
  loop
    perform private.evaluate_seller_tin(v_id);
  end loop;
  return null;
end;
$$;

create trigger zz_tin_reeval after update on public.suppliers
  for each row when (old.tin is distinct from new.tin)
  execute function private.tg_suppliers_tin_reeval();

-- ============================================================================
-- 8. L2 / L4 / L11 — Qoida 1 (xarid ≠ qabul) taqsimlash
-- ============================================================================

-- L2 + L4. receipt_candidates (audit_fixes A1 versiyasi). O'zgargani:
--   * tartib: orqa sanali xaridlar (created_at − purchased_at > 24 soat) FIFO
--     ustuvorligisiz — oddiylaridan keyin, o'zaro created_at bo'yicha; oddiylar —
--     purchased_at, created_at, id;
--   * qisman taqsimlash: kirim butunicha emas, xaridning qolgan farqi qadar beriladi,
--     qoldig'i keyingi xaridga o'tadi (bitta 200 lik kirim — ikki 100 lik xarid).
--   Qaytaradi: maqsad xaridga tushgan (kirim, ulush) juftliklari.
create or replace function private.receipt_candidates(p_purchase_id uuid)
returns table (movement_id uuid, qty_base numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_t     public.purchases%rowtype;
  r       record;
  k       record;
  v_rem   jsonb := '{}'::jsonb;
  v_gap   numeric;
  v_avail numeric;
  v_take  numeric;
begin
  select p.* into v_t from public.purchases p where p.id = p_purchase_id;
  if not found or v_t.deleted_at is not null then
    return;
  end if;

  for r in
    select p.id, p.qty_base as q, p.purchased_at as at,
           (p.created_at - p.purchased_at > interval '24 hours') as bd,
           (select coalesce(sum(m.qty_base), 0)
              from public.movements m
             where m.company_id = p.company_id
               and m.purchase_id = p.id
               and m.type = 'kirim'
               and m.deleted_at is null) as recv
      from public.purchases p
     where p.company_id = v_t.company_id
       and p.object_id = v_t.object_id
       and p.material_id = v_t.material_id
       and p.deleted_at is null
       and p.purchased_at >= v_t.purchased_at - interval '14 days'
     order by (p.created_at - p.purchased_at > interval '24 hours'),
              case when p.created_at - p.purchased_at > interval '24 hours' then p.created_at else p.purchased_at end,
              p.purchased_at, p.created_at, p.id
  loop
    v_gap := r.q - r.recv;
    if v_gap > 0 then
      for k in
        select m.id as mid, m.qty_base as mq
          from public.movements m
         where m.company_id = v_t.company_id
           and m.object_id = v_t.object_id
           and m.material_id = v_t.material_id
           and m.type = 'kirim'
           and m.purchase_id is null
           and m.transfer_id is null
           and m.deleted_at is null
           and m.occurred_at >= r.at
           and m.occurred_at <= r.at + interval '72 hours'
         order by m.occurred_at, m.id
      loop
        v_avail := coalesce((v_rem ->> k.mid::text)::numeric, k.mq);
        continue when v_avail <= 0;
        v_take := least(v_avail, v_gap);
        v_rem := v_rem || jsonb_build_object(k.mid::text, v_avail - v_take);
        v_gap := v_gap - v_take;
        if r.id = v_t.id then
          movement_id := k.mid;
          qty_base := v_take;
          return next;
        end if;
        exit when v_gap <= 0;
      end loop;
    end if;
    exit when r.id = v_t.id;
  end loop;
end;
$$;

-- L11. evaluate_purchase_receipt (audit_fixes A1 versiyasi): qulf tartibi — avval
-- terron.receipt_alloc (obyekt+material), xarid qatori qulflanmaydi (zanjir va
-- foydalanuvchi UPDATE'i o'rtasida deadlock bo'lmasin). Mantiq o'zgarmagan.
create or replace function private.evaluate_purchase_receipt(p_purchase_id uuid, p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p          public.purchases%rowtype;
  v_threshold  numeric;
  v_purchased  numeric(20,6);
  v_received   numeric(20,6);
  v_count      bigint;
  v_last_mv    uuid;
  v_diff       numeric;
  v_state      text;
  v_severity   public.alert_severity;
  v_details    jsonb;
  v_alert      public.alerts%rowtype;
  v_cand_qty   numeric(20,6);
  v_cand       jsonb;
  v_cand_id    uuid;
begin
  select p.* into v_p from public.purchases p where p.id = p_purchase_id;
  if not found then
    return;
  end if;

  if v_p.deleted_at is not null then
    perform private.close_purchase_alerts(v_p.company_id, v_p.id,
      array['xarid_qabul_farqi']::public.alert_type[], 'purchase_deleted');
    return;
  end if;

  perform private.lock_receipt_alloc(v_p.object_id, v_p.material_id);
  select p.* into v_p from public.purchases p where p.id = p_purchase_id;

  select c.receipt_mismatch_pct into v_threshold
    from public.companies c
   where c.id = v_p.company_id;

  select coalesce(sum(m.qty_base), 0),
         count(*),
         (array_agg(m.id order by m.created_at desc, m.id desc))[1]
    into v_received, v_count, v_last_mv
    from public.movements m
   where m.company_id = v_p.company_id
     and m.purchase_id = v_p.id
     and m.type = 'kirim'
     and m.deleted_at is null;

  select coalesce(sum(c.qty_base), 0)::numeric(20,6),
         coalesce(jsonb_agg(jsonb_build_object('movement_id', c.movement_id, 'qty_base', c.qty_base)), '[]'::jsonb)
    into v_cand_qty, v_cand
    from private.receipt_candidates(v_p.id) c;

  v_purchased := v_p.qty_base;
  v_diff := round(abs(v_received - v_purchased) * 100 / v_purchased, 2);

  if v_diff <= v_threshold then
    v_state := 'ok';
  elsif v_received > v_purchased then
    v_state := 'over';
  elsif p_now >= v_p.purchased_at + interval '24 hours' then
    if v_cand_qty > 0
       and round(abs(v_received + v_cand_qty - v_purchased) * 100 / v_purchased, 2) <= v_threshold then
      v_state := 'covered';
    else
      v_state := 'under';
    end if;
  else
    v_state := 'pending';
  end if;

  v_severity := case when v_diff >= 3 * v_threshold then 'jiddiy' else 'ogohlantirish' end;
  v_details := jsonb_build_object(
    'purchased_qty_base', v_purchased,
    'received_qty_base',  v_received,
    'diff_pct',           v_diff,
    'threshold_pct',      v_threshold,
    'direction',          case when v_received > v_purchased then 'over' else 'under' end,
    'receipt_count',      v_count,
    'evaluated_at',       p_now
  );
  if v_cand_qty > 0 and v_received < v_purchased then
    v_details := v_details || jsonb_build_object(
      'unlinked_candidates', v_cand,
      'unlinked_qty_base',   v_cand_qty);
  end if;

  select a.* into v_alert
    from public.alerts a
   where a.company_id = v_p.company_id
     and a.purchase_id = v_p.id
     and a.type = 'xarid_qabul_farqi'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null;

  if v_state = 'ok' then
    if v_alert.id is not null then
      update public.alerts
         set status  = 'yopildi',
             details = v_details || private.alert_meta(v_alert.details) || jsonb_build_object(
               'auto_closed', true, 'closed_reason', 'within_threshold',
               'closed_by_actor', private.my_profile_id())
       where id = v_alert.id;
    end if;
    return;
  end if;

  if v_state = 'covered' then
    if v_alert.id is not null then
      update public.alerts
         set status  = 'yopildi',
             details = v_details || private.alert_meta(v_alert.details) || jsonb_build_object(
               'auto_closed', true, 'closed_reason', 'covered_by_unlinked',
               'closed_by_actor', private.my_profile_id())
       where id = v_alert.id;
    end if;
    for v_cand_id in
      select distinct (x ->> 'movement_id')::uuid from jsonb_array_elements(v_cand) x order by 1
    loop
      perform private.mark_kirim_candidate(v_cand_id, v_p.id);
    end loop;
    return;
  end if;

  if v_alert.id is not null then
    if v_alert.severity = v_severity
       and (v_alert.details - 'evaluated_at' - private.alert_meta_keys()) = (v_details - 'evaluated_at')
       and v_alert.object_id is not distinct from v_p.object_id
       and v_alert.material_id is not distinct from v_p.material_id
       and v_alert.movement_id is not distinct from v_last_mv then
      return;
    end if;
    update public.alerts
       set severity    = v_severity,
           details     = v_details || private.alert_meta(v_alert.details),
           object_id   = v_p.object_id,
           material_id = v_p.material_id,
           movement_id = v_last_mv
     where id = v_alert.id;
    return;
  end if;

  if v_state = 'pending' then
    return;
  end if;
  -- zanjir (reevaluate_receipt_chain) faqat mavjud alertlarni yangilaydi / yopadi;
  -- yangi alertni hourly cron (evaluate_due_purchases) yoki bevosita chaqiruv yaratadi
  if coalesce(current_setting('terron.receipt_chain', true), '') = 'on' then
    return;
  end if;

  if exists (
    select 1 from public.alerts a
     where a.company_id = v_p.company_id
       and a.purchase_id = v_p.id
       and a.type = 'xarid_qabul_farqi'
       and a.status = 'yopildi'
       and a.deleted_at is null
       and coalesce((a.details ->> 'auto_closed')::boolean, false) = false
       and (a.details ->> 'purchased_qty_base')::numeric = v_purchased
       and (a.details ->> 'received_qty_base')::numeric = v_received
  ) then
    return;
  end if;

  insert into public.alerts
    (company_id, type, severity, object_id, material_id, purchase_id, movement_id, details)
  values
    (v_p.company_id, 'xarid_qabul_farqi', v_severity, v_p.object_id, v_p.material_id,
     v_p.id, v_last_mv, v_details);
end;
$$;

-- L2. Obyekt+material bo'yicha xaridlar zanjirini qayta baholash (receipt_alloc qulfi
-- ostida): tirik xaridlar, purchased_at ∈ [p_from − 14 kun, now]. Mavjud alertlar
-- yangilanadi / yopiladi (covered, ok), nomzod kirimlar belgilanadi; YANGI alert
-- yaratilmaydi (terron.receipt_chain) — uni hourly cron yaratadi (o'tkinchi "jiddiy"
-- xabarlar bo'lmasin). Qaytaradi: baholangan xaridlar soni.
create function private.reevaluate_receipt_chain(
  p_company_id  uuid,
  p_object_id   uuid,
  p_material_id uuid,
  p_from        timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_n    integer := 0;
  v_prev text := coalesce(current_setting('terron.receipt_chain', true), '');
begin
  if p_company_id is null or p_object_id is null or p_material_id is null then
    return 0;
  end if;
  perform private.lock_receipt_alloc(p_object_id, p_material_id);
  perform set_config('terron.receipt_chain', 'on', true);
  for v_id in
    select p.id
      from public.purchases p
     where p.company_id = p_company_id
       and p.object_id = p_object_id
       and p.material_id = p_material_id
       and p.deleted_at is null
       and p.purchased_at >= coalesce(p_from, now()) - interval '14 days'
       and p.purchased_at <= now()
     order by p.purchased_at, p.created_at, p.id
  loop
    perform private.evaluate_purchase_receipt(v_id);
    v_n := v_n + 1;
  end loop;
  perform set_config('terron.receipt_chain', v_prev, true);
  return v_n;
end;
$$;

-- L11. evaluate_kirim_source (Batch 12 versiyasi) — avval receipt_alloc qulfi, keyin
-- alert_lock (mark_kirim_candidate bilan bir xil tartib). Mantiq o'zgarmagan.
create or replace function private.evaluate_kirim_source(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m       public.movements%rowtype;
  v_alert   public.alerts%rowtype;
  v_open    uuid[];
  v_reason  text;
  v_unit    text;
  v_details jsonb;
begin
  select m.* into v_m from public.movements m where m.id = p_movement_id;
  if not found then
    return;
  end if;
  perform private.lock_receipt_alloc(v_m.object_id, v_m.material_id);
  perform private.alert_lock('kirim_manbasiz:' || v_m.id::text);

  select a.* into v_alert
    from public.alerts a
   where a.company_id = v_m.company_id
     and a.movement_id = v_m.id
     and a.type = 'kirim_manbasiz'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
   order by a.created_at
   limit 1;

  if v_m.deleted_at is not null or v_m.type <> 'kirim' or v_m.purchase_id is not null then
    if v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id,
        case when v_m.deleted_at is not null then 'movement_deleted'
             when v_m.purchase_id is not null then 'linked'
             else 'not_applicable' end);
    end if;
    return;
  end if;

  select coalesce(array_agg(p.id order by p.purchased_at, p.id), '{}') into v_open
    from public.purchases p
   where p.company_id = v_m.company_id
     and p.object_id = v_m.object_id
     and p.material_id = v_m.material_id
     and p.deleted_at is null
     and p.purchased_at >= v_m.occurred_at - interval '14 days'
     and p.purchased_at <= v_m.occurred_at + interval '1 day'
     and p.qty_base > (select coalesce(sum(r.qty_base), 0)
                         from public.movements r
                        where r.company_id = p.company_id
                          and r.purchase_id = p.id
                          and r.type = 'kirim'
                          and r.deleted_at is null);

  if cardinality(v_open) > 0 then
    v_reason := 'open_purchase';
  elsif not exists (
          select 1 from public.purchases p
           where p.company_id = v_m.company_id
             and p.object_id = v_m.object_id
             and p.material_id = v_m.material_id
             and p.deleted_at is null
             and p.purchased_at between v_m.occurred_at - interval '7 days' and v_m.occurred_at)
        and not exists (
          select 1 from public.transfers t
           where t.company_id = v_m.company_id
             and t.to_object_id = v_m.object_id
             and t.material_id = v_m.material_id
             and t.deleted_at is null
             and t.status <> 'bekor'
             and t.created_at between v_m.occurred_at - interval '7 days' and v_m.occurred_at) then
    v_reason := 'no_source';
  end if;

  if v_alert.id is not null and (v_alert.details ->> 'reason') = 'unlinked_candidate' then
    return;
  end if;

  if v_reason is null then
    if v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id, 'not_applicable');
    end if;
    return;
  end if;

  select m.base_unit into v_unit from public.materials m
   where m.company_id = v_m.company_id and m.id = v_m.material_id;

  v_details := jsonb_build_object(
    'reason',                v_reason,
    'qty_base',              v_m.qty_base,
    'base_unit',             v_unit,
    'occurred_at',           v_m.occurred_at,
    'open_purchase_ids',     to_jsonb(v_open),
    'candidate_purchase_id', null
  );

  if v_alert.id is not null then
    if (v_alert.details - private.alert_meta_keys()) is distinct from v_details then
      update public.alerts
         set details = v_details || private.alert_meta(v_alert.details),
             object_id = v_m.object_id, material_id = v_m.material_id
       where id = v_alert.id;
    end if;
    return;
  end if;

  if exists (
    select 1 from public.alerts a
     where a.company_id = v_m.company_id
       and a.movement_id = v_m.id
       and a.type = 'kirim_manbasiz'
       and a.status = 'yopildi'
       and a.deleted_at is null
       and coalesce((a.details ->> 'auto_closed')::boolean, false) = false
       and (a.details ->> 'reason') = v_reason
  ) then
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, material_id, movement_id, details)
  values (v_m.company_id, 'kirim_manbasiz', 'belgi', v_m.object_id, v_m.material_id, v_m.id, v_details);
end;
$$;

-- L2. purchases AFTER (Batch 5 versiyasi): qoida 1 — endi zanjir bo'yicha
-- (INSERT, soft delete, tiklash, qty_base / purchased_at / obyekt / material o'zgarishi).
create or replace function private.tg_purchases_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restored boolean;
  v_pair     record;
begin
  if tg_op = 'INSERT' then
    perform private.evaluate_purchase_price(new.id);
    perform private.reevaluate_self_for_purchase(new.id);
    perform private.reevaluate_receipt_chain(new.company_id, new.object_id, new.material_id, new.purchased_at);
    return null;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    perform private.close_purchase_alerts(new.company_id, new.id, null, 'purchase_deleted');
    perform private.reevaluate_self_for_purchase(new.id);
    perform private.reevaluate_receipt_chain(new.company_id, old.object_id, old.material_id, old.purchased_at);
    return null;
  end if;
  if new.deleted_at is not null then
    return null;
  end if;

  v_restored := old.deleted_at is not null;

  if v_restored
     or new.qty_base     is distinct from old.qty_base
     or new.purchased_at is distinct from old.purchased_at
     or new.object_id    is distinct from old.object_id
     or new.material_id  is distinct from old.material_id then
    for v_pair in
      select distinct x.o, x.m, min(x.at) over (partition by x.o, x.m) as at
        from (select new.object_id as o, new.material_id as m, new.purchased_at as at
              union all
              select old.object_id, old.material_id, old.purchased_at) x
       order by 1, 2
    loop
      perform private.reevaluate_receipt_chain(new.company_id, v_pair.o, v_pair.m, v_pair.at);
    end loop;
    perform private.evaluate_purchase_receipt(new.id);
  end if;

  if v_restored
     or new.total_amount is distinct from old.total_amount
     or new.qty_input    is distinct from old.qty_input
     or new.unit_id      is distinct from old.unit_id
     or new.material_id  is distinct from old.material_id
     or new.purchased_at is distinct from old.purchased_at then
    perform private.evaluate_purchase_price(new.id);
  end if;

  if v_restored
     or new.buyer_id     is distinct from old.buyer_id
     or new.object_id    is distinct from old.object_id
     or new.material_id  is distinct from old.material_id
     or new.purchased_at is distinct from old.purchased_at then
    perform private.reevaluate_self_for_purchase(new.id);
  end if;

  return null;
end;
$$;

-- L3. manfiy_qoldiq (audit_fixes A2 versiyasi): stock_restored bilan yopilganidan
-- 24 soat ichida qoldiq yana manfiy bo'lsa — o'sha alert QAYTA OCHILADI (status yangi,
-- details.reopened_at, reopen_count); yangi Telegram xabari yo'q (faqat INSERT yuboriladi).
create or replace function private.evaluate_negative_stock(
  p_company_id  uuid,
  p_object_id   uuid,
  p_material_id uuid,
  p_movement_id uuid,
  p_decreased   boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock   numeric(20,6);
  v_alert   public.alerts%rowtype;
  v_recent  public.alerts%rowtype;
  v_mv      public.movements%rowtype;
  v_cause   boolean := false;
  v_unit    text;
  v_details jsonb;
begin
  select m.* into v_mv from public.movements m where m.id = p_movement_id;
  v_cause := found and coalesce(p_decreased, false)
             and v_mv.object_id = p_object_id and v_mv.material_id = p_material_id;

  if not v_cause and not exists (
    select 1 from public.alerts a
     where a.company_id = p_company_id
       and a.object_id = p_object_id
       and a.material_id = p_material_id
       and a.type = 'manfiy_qoldiq'
       and a.status in ('yangi', 'korildi')
       and a.deleted_at is null
  ) then
    return;
  end if;

  perform private.alert_lock('manfiy_qoldiq:' || p_object_id::text || ':' || p_material_id::text);
  v_stock := private.object_stock(p_company_id, p_object_id, p_material_id);

  select a.* into v_alert
    from public.alerts a
   where a.company_id = p_company_id
     and a.object_id = p_object_id
     and a.material_id = p_material_id
     and a.type = 'manfiy_qoldiq'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
   order by a.created_at
   limit 1;

  if v_stock >= 0 then
    if v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id, 'stock_restored', jsonb_build_object('stock_after', v_stock));
    end if;
    return;
  end if;

  select m.base_unit into v_unit from public.materials m
   where m.company_id = p_company_id and m.id = p_material_id;

  if v_alert.id is not null then
    v_details := v_alert.details || jsonb_build_object('stock_after', v_stock, 'unit', v_unit);
    if v_cause then
      v_details := v_details || jsonb_build_object(
        'qty_base', v_mv.qty_base, 'movement_type', v_mv.type,
        'movement_deleted', v_mv.deleted_at is not null);
    end if;
    if v_details is distinct from v_alert.details
       or (v_cause and v_alert.movement_id is distinct from v_mv.id) then
      update public.alerts
         set details     = v_details,
             movement_id = case when v_cause then v_mv.id else movement_id end
       where id = v_alert.id;
    end if;
    return;
  end if;

  if not v_cause then
    return;
  end if;

  select a.* into v_recent
    from public.alerts a
   where a.company_id = p_company_id
     and a.object_id = p_object_id
     and a.material_id = p_material_id
     and a.type = 'manfiy_qoldiq'
     and a.status = 'yopildi'
     and a.deleted_at is null
     and (a.details ->> 'closed_reason') = 'stock_restored'
     and a.closed_at > now() - interval '24 hours'
   order by a.closed_at desc
   limit 1;
  if v_recent.id is not null then
    update public.alerts
       set status      = 'yangi',
           details     = (details - 'auto_closed' - 'closed_reason' - 'closed_by_actor')
                         || jsonb_build_object(
                              'stock_after', v_stock, 'qty_base', v_mv.qty_base,
                              'movement_type', v_mv.type, 'movement_deleted', v_mv.deleted_at is not null,
                              'reopened_at', now(), 'renegative_at', now(),
                              'reopen_count', coalesce((details ->> 'reopen_count')::integer, 0) + 1),
           movement_id = v_mv.id
     where id = v_recent.id;
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, material_id, movement_id, details)
  values (p_company_id, 'manfiy_qoldiq', 'ogohlantirish', p_object_id, p_material_id, v_mv.id,
          jsonb_build_object(
            'stock_after',      v_stock,
            'qty_base',         v_mv.qty_base,
            'unit',             v_unit,
            'movement_type',    v_mv.type,
            'movement_deleted', v_mv.deleted_at is not null));
end;
$$;

-- movements AFTER (audit_fixes versiyasi). A bo'limi: receipt_alloc qulflari (kalit
-- tartibida) → kirim manbasi → xaridlar zanjiri (occurred_at − 72 soatdan). Qolgani o'zgarmagan.
create or replace function private.tg_movements_automation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pair  record;
  v_day   record;
  v_kirim boolean;
  v_delta numeric;
begin
  v_kirim := new.type = 'kirim' or (tg_op = 'UPDATE' and old.type = 'kirim');

  -- A: kirim manbasi va xaridlar zanjiri
  if v_kirim and (tg_op = 'INSERT'
                  or new.purchase_id is distinct from old.purchase_id
                  or new.deleted_at  is distinct from old.deleted_at
                  or new.object_id   is distinct from old.object_id
                  or new.material_id is distinct from old.material_id
                  or new.occurred_at is distinct from old.occurred_at
                  or new.qty_base    is distinct from old.qty_base
                  or new.type        is distinct from old.type) then
    for v_pair in
      select x.o, x.m, min(x.at) as at
        from (select new.object_id as o, new.material_id as m, new.occurred_at as at
              union all
              select old.object_id, old.material_id, old.occurred_at where tg_op = 'UPDATE') x
       group by x.o, x.m
       order by x.o::text || ':' || x.m::text
    loop
      perform private.lock_receipt_alloc(v_pair.o, v_pair.m);
    end loop;
    perform private.evaluate_kirim_source(new.id);
    for v_pair in
      select x.o, x.m, min(x.at) as at
        from (select new.object_id as o, new.material_id as m, new.occurred_at as at
              union all
              select old.object_id, old.material_id, old.occurred_at where tg_op = 'UPDATE') x
       group by x.o, x.m
       order by x.o::text || ':' || x.m::text
    loop
      perform private.reevaluate_receipt_chain(new.company_id, v_pair.o, v_pair.m, v_pair.at - interval '72 hours');
    end loop;
  end if;

  -- B: manfiy qoldiq (eski va yangi obyekt+material), sabab — qoldiq kamaygan juftlik
  for v_pair in
    select distinct x.o, x.m
      from (select new.object_id as o, new.material_id as m
            union all
            select old.object_id, old.material_id where tg_op = 'UPDATE') x
     order by 1, 2
  loop
    v_delta := 0;
    if new.deleted_at is null and new.object_id = v_pair.o and new.material_id = v_pair.m then
      v_delta := v_delta + case when new.type in ('chiqim', 'transfer_out') then -new.qty_base else new.qty_base end;
    end if;
    if tg_op = 'UPDATE' and old.deleted_at is null and old.object_id = v_pair.o and old.material_id = v_pair.m then
      v_delta := v_delta - case when old.type in ('chiqim', 'transfer_out') then -old.qty_base else old.qty_base end;
    end if;
    perform private.evaluate_negative_stock(new.company_id, v_pair.o, v_pair.m, new.id, v_delta < 0);
  end loop;

  -- F: smetasiz chiqim (eski va yangi obyekt)
  if new.type = 'chiqim' or (tg_op = 'UPDATE' and old.type = 'chiqim') then
    for v_day in
      select distinct x.o
        from (select new.object_id as o
              union all
              select old.object_id where tg_op = 'UPDATE') x
       order by 1
    loop
      perform private.evaluate_no_estimate_chiqim(new.company_id, v_day.o, new.id);
    end loop;
  end if;

  -- C: takroriy yozuv (faqat INSERT), rasm xeshi (INSERT / xesh o'zgarganda / tiklashda)
  if tg_op = 'INSERT' then
    perform private.evaluate_duplicate('movements', new.id);
  end if;
  if new.photo_sha256 is not null
     and (tg_op = 'INSERT' or new.photo_sha256 is distinct from old.photo_sha256
          or (old.deleted_at is not null and new.deleted_at is null)) then
    perform private.evaluate_duplicate_photo('movements', new.id);
  end if;

  -- D: joylashuv
  if tg_op = 'INSERT' and new.geo_status = 'ok'
     or (tg_op = 'UPDATE' and (new.geo_lat is distinct from old.geo_lat
                               or new.geo_lng is distinct from old.geo_lng
                               or new.geo_accuracy_m is distinct from old.geo_accuracy_m
                               or new.geo_status is distinct from old.geo_status
                               or new.object_id is distinct from old.object_id
                               or new.deleted_at is distinct from old.deleted_at)) then
    perform private.evaluate_geo(new.id);
  end if;
  return null;
end;
$$;

-- ============================================================================
-- 9. L10 — takroriy yozuv qayta baholash (tuzatishdan keyin)
-- ============================================================================

-- Ikki yozuv hali "takroriy" ta'rifiga mosmi (Batch 12 evaluate_duplicate sharti).
create function private.duplicate_matches(p_table text, p_record uuid, p_first uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window integer;
begin
  if p_table = 'movements' then
    select c.duplicate_window_minutes into v_window
      from public.movements r join public.companies c on c.id = r.company_id where r.id = p_record;
    return exists (
      select 1
        from public.movements r
        join public.movements f on f.company_id = r.company_id and f.id = p_first
       where r.id = p_record
         and r.deleted_at is null and f.deleted_at is null
         and r.created_by = f.created_by
         and r.object_id = f.object_id and r.material_id = f.material_id
         and r.type = f.type and r.type in ('kirim', 'chiqim')
         and r.qty_base = f.qty_base
         and f.created_at <= r.created_at
         and f.created_at >= r.created_at - make_interval(mins => coalesce(v_window, 0)));
  end if;
  select c.duplicate_window_minutes into v_window
    from public.purchases r join public.companies c on c.id = r.company_id where r.id = p_record;
  return exists (
    select 1
      from public.purchases r
      join public.purchases f on f.company_id = r.company_id and f.id = p_first
     where r.id = p_record
       and r.deleted_at is null and f.deleted_at is null
       and r.created_by = f.created_by
       and r.object_id = f.object_id and r.material_id = f.material_id
       and r.qty_base = f.qty_base and r.total_amount = f.total_amount
       and f.created_at <= r.created_at
       and f.created_at >= r.created_at - make_interval(mins => coalesce(v_window, 0)));
end;
$$;

-- Yozuv o'zgargandan keyin: (1) shu yozuv qatnashgan ochiq "record" alertlari, shart
-- yo'qolgan bo'lsa — yopiladi (not_applicable); (2) yozuvning o'zi yangi holatda
-- takroriy bo'lsa — evaluate_duplicate (avtomatik yopilgani qayta ochiladi);
-- (3) oynadagi keyingi yozuvlari ham qayta tekshiriladi.
create function private.reevaluate_duplicate(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  v_company uuid;
  v_by     uuid;
  v_created timestamptz;
  v_window integer;
  v_id     uuid;
begin
  if p_table = 'movements' then
    select m.company_id, m.created_by, m.created_at into v_company, v_by, v_created
      from public.movements m where m.id = p_id;
  else
    select p.company_id, p.created_by, p.created_at into v_company, v_by, v_created
      from public.purchases p where p.id = p_id;
  end if;
  if v_company is null then
    return;
  end if;

  for a in
    select x.id, (x.details ->> 'record_id')::uuid as rec, (x.details ->> 'first_id')::uuid as fst
      from public.alerts x
     where x.company_id = v_company
       and x.type = 'takroriy_yozuv'
       and x.status in ('yangi', 'korildi')
       and x.deleted_at is null
       and (x.details ->> 'kind') = 'record'
       and (x.details ->> 'table') = p_table
       and ((x.details ->> 'record_id') = p_id::text or (x.details ->> 'first_id') = p_id::text)
     order by x.id
  loop
    if not private.duplicate_matches(p_table, a.rec, a.fst) then
      perform private.auto_close_alert(a.id, 'not_applicable');
    end if;
  end loop;

  -- (2) avtomatik yopilgan "record" alerti bo'lsa va yana mos kelsa — qayta ochiladi
  for a in
    select x.id, (x.details ->> 'first_id')::uuid as fst
      from public.alerts x
     where x.company_id = v_company
       and x.type = 'takroriy_yozuv'
       and x.status = 'yopildi'
       and x.deleted_at is null
       and coalesce((x.details ->> 'auto_closed')::boolean, false)
       and (x.details ->> 'kind') = 'record'
       and (x.details ->> 'record_id') = p_id::text
     order by x.created_at desc
     limit 1
  loop
    if private.duplicate_matches(p_table, p_id, a.fst) then
      update public.alerts
         set status = 'yangi',
             details = (details - 'auto_closed' - 'closed_reason' - 'closed_by_actor')
                       || jsonb_build_object('reopened_at', now())
       where id = a.id;
    end if;
  end loop;
  perform private.evaluate_duplicate(p_table, p_id);

  select c.duplicate_window_minutes into v_window from public.companies c where c.id = v_company;
  if p_table = 'movements' then
    for v_id in
      select m.id from public.movements m
       where m.company_id = v_company and m.created_by = v_by and m.id <> p_id and m.deleted_at is null
         and m.created_at > v_created and m.created_at <= v_created + make_interval(mins => coalesce(v_window, 0))
       order by m.created_at, m.id
    loop
      perform private.evaluate_duplicate('movements', v_id);
    end loop;
  else
    for v_id in
      select p.id from public.purchases p
       where p.company_id = v_company and p.created_by = v_by and p.id <> p_id and p.deleted_at is null
         and p.created_at > v_created and p.created_at <= v_created + make_interval(mins => coalesce(v_window, 0))
       order by p.created_at, p.id
    loop
      perform private.evaluate_duplicate('purchases', v_id);
    end loop;
  end if;
end;
$$;

-- ============================================================================
-- 10. correct_entry (audit_fixes D1 versiyasi) va cancel_own_entry
--   O'zgargani:
--   * xaridga bog'langan kirimni tuzatish mumkin (miqdor/birlik/izoh) — keyin qoida 1
--     va FIFO zanjiri shu xarid uchun qayta ishlaydi;
--   * p_material_id / p_object_id — faqat muallif, 30 daqiqa ichida (admin boshqaning
--     yozuvida — correct_forbidden); material o'zgarsa p_unit_id majburiy va yangi
--     materialniki bo'lishi shart; bog'langan kirimda — correct_linked;
--   * p_reason (L9) — alohida argument, details.reason; p_note — yangi izoh (null —
--     o'zgarmaydi, '' — tozalaydi) — eski 6 argumentli chaqiruv o'zgarishsiz ishlaydi;
--   * L10: tuzatishdan keyin takroriy yozuv qoidasi qayta baholanadi.
-- ============================================================================
drop function public.correct_entry(text, uuid, numeric, uuid, numeric, text);

create function public.correct_entry(
  p_table        text,
  p_id           uuid,
  p_qty_input    numeric default null,
  p_unit_id      uuid    default null,
  p_total_amount numeric default null,
  p_note         text    default null,
  p_reason       text    default null,
  p_material_id  uuid    default null,
  p_object_id    uuid    default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.my_profile_id();
  v_admin   boolean := private.has_role('super_admin', 'admin');
  v_m       public.movements%rowtype;
  v_p       public.purchases%rowtype;
  v_company uuid;
  v_author  uuid;
  v_created timestamptz;
  v_object  uuid;
  v_mat     uuid;
  v_new_mat uuid;
  v_new_obj uuid;
  v_note    text := nullif(btrim(p_note), '');
  v_reason  text := nullif(btrim(p_reason), '');
  v_own     boolean;
  v_move    boolean;
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  if p_table is null or p_table not in ('movements', 'purchases') or p_id is null
     or (p_qty_input is not null and (round(p_qty_input, 6) <= 0 or p_qty_input >= 1e14))
     or (p_total_amount is not null and (p_total_amount < 0 or p_total_amount >= 1e16))
     or (p_table = 'movements' and p_total_amount is not null)
     or (v_note is not null and char_length(v_note) > 500)
     or (v_reason is not null and char_length(v_reason) > 500) then
    raise exception 'Tuzatish ma''lumotlari noto''g''ri'
      using errcode = '22023', hint = 'correct_invalid';
  end if;

  if p_table = 'movements' then
    select m.* into v_m from public.movements m where m.id = p_id and m.deleted_at is null for update;
    if not found or not private.can_access_company(v_m.company_id) then
      raise exception 'Yozuv topilmadi' using errcode = 'P0002', hint = 'correct_not_found';
    end if;
    v_company := v_m.company_id; v_author := v_m.created_by; v_created := v_m.created_at;
    v_object := v_m.object_id; v_mat := v_m.material_id;
  else
    select p.* into v_p from public.purchases p where p.id = p_id and p.deleted_at is null for update;
    if not found or not private.can_access_company(v_p.company_id) then
      raise exception 'Yozuv topilmadi' using errcode = 'P0002', hint = 'correct_not_found';
    end if;
    v_company := v_p.company_id; v_author := v_p.created_by; v_created := v_p.created_at;
    v_object := v_p.object_id; v_mat := v_p.material_id;
  end if;

  v_own := v_author = v_me and v_created >= now() - interval '30 minutes';
  v_new_mat := coalesce(p_material_id, v_mat);
  v_new_obj := coalesce(p_object_id, v_object);
  v_move := v_new_mat is distinct from v_mat or v_new_obj is distinct from v_object;

  if not v_admin then
    if v_author is distinct from v_me then
      raise exception 'Faqat o''zingiz kiritgan yozuvni tuzatish mumkin'
        using errcode = '42501', hint = 'correct_forbidden';
    end if;
    if not v_own then
      raise exception 'Tuzatish muddati (30 daqiqa) o''tgan — administratorga murojaat qiling'
        using errcode = '55000', hint = 'correct_window_passed';
    end if;
    if (p_table = 'movements' and not (private.has_role('prorab', 'omborchi')
                                       and private.can_access_object(v_object)
                                       and private.can_access_object(v_new_obj)))
       or (p_table = 'purchases' and not (private.has_role('taminotchi')
                                         or (private.has_role('prorab', 'haydovchi')
                                             and private.can_access_object(v_object)
                                             and private.can_access_object(v_new_obj)))) then
      raise exception 'Bu yozuvni tuzatishga ruxsat yo''q'
        using errcode = '42501', hint = 'correct_forbidden';
    end if;
  elsif v_move and not v_own then
    -- material / obyektni almashtirish — faqat muallifning o'z tuzatishi
    if v_author is distinct from v_me then
      raise exception 'Material yoki obyektni faqat yozuv muallifi almashtira oladi'
        using errcode = '42501', hint = 'correct_forbidden';
    end if;
    raise exception 'Tuzatish muddati (30 daqiqa) o''tgan — administratorga murojaat qiling'
      using errcode = '55000', hint = 'correct_window_passed';
  end if;

  if p_table = 'movements' then
    if v_m.type not in ('kirim', 'chiqim') or v_m.transfer_id is not null or v_m.inventory_count_id is not null
       or (v_m.purchase_id is not null and v_move) then
      raise exception 'Bog''langan yozuvni tuzatib bo''lmaydi (xarid, o''tkazma yoki inventarizatsiya)'
        using errcode = '55000', hint = 'correct_linked';
    end if;
  elsif exists (select 1 from public.movements m
                 where m.company_id = v_company and m.purchase_id = p_id
                   and m.type = 'kirim' and m.deleted_at is null) then
    raise exception 'Kirimga bog''langan xaridni tuzatib bo''lmaydi'
      using errcode = '55000', hint = 'correct_linked';
  end if;

  if v_move then
    if v_new_mat is distinct from v_mat and p_unit_id is null then
      raise exception 'Material almashtirilganda birlikni ham tanlang'
        using errcode = '22023', hint = 'correct_invalid';
    end if;
    if not exists (select 1 from public.materials mt
                    where mt.company_id = v_company and mt.id = v_new_mat
                      and mt.deleted_at is null and mt.is_active)
       or not exists (select 1 from public.objects o
                       where o.company_id = v_company and o.id = v_new_obj and o.deleted_at is null) then
      raise exception 'Material yoki obyekt topilmadi'
        using errcode = '22023', hint = 'correct_invalid';
    end if;
  end if;
  if p_unit_id is not null and not exists (
       select 1 from public.material_units mu
        where mu.company_id = v_company and mu.id = p_unit_id
          and mu.material_id = v_new_mat and mu.deleted_at is null) then
    raise exception 'Birlik shu materialga tegishli emas'
      using errcode = '22023', hint = 'correct_invalid';
  end if;

  perform set_config('terron.correct_mode', case when v_own then 'author' else 'admin' end, true);
  perform set_config('terron.correct_reason', coalesce(v_reason, ''), true);

  if p_table = 'movements' then
    update public.movements m
       set qty_input   = coalesce(p_qty_input, m.qty_input),
           unit_id     = coalesce(p_unit_id, m.unit_id),
           material_id = v_new_mat,
           object_id   = v_new_obj,
           note        = case when p_note is null then m.note else v_note end
     where m.id = p_id;
    if v_m.purchase_id is not null then
      perform private.evaluate_purchase_receipt(v_m.purchase_id);
      perform private.reevaluate_receipt_chain(v_company, v_object, v_mat, v_m.occurred_at - interval '72 hours');
    end if;
  else
    update public.purchases p
       set qty_input    = coalesce(p_qty_input, p.qty_input),
           unit_id      = coalesce(p_unit_id, p.unit_id),
           material_id  = v_new_mat,
           object_id    = v_new_obj,
           total_amount = coalesce(p_total_amount, p.total_amount),
           note         = case when p_note is null then p.note else v_note end
     where p.id = p_id;
  end if;

  perform private.reevaluate_duplicate(p_table, p_id);

  perform set_config('terron.correct_mode', '', true);
  perform set_config('terron.correct_reason', '', true);
end;
$$;

-- Muallif o'z yozuvini 30 daqiqa ichida bekor qiladi (soft delete). Qoidalar
-- correct_entry bilan bir xil (rol/obyekt, bog'langan yozuv). Sabab majburiy.
-- yozuv_ochirildi o'rniga yozuv_tuzatildi (belgi, via = cancel_own_entry).
create function public.cancel_own_entry(p_table text, p_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.my_profile_id();
  v_m       public.movements%rowtype;
  v_p       public.purchases%rowtype;
  v_company uuid;
  v_author  uuid;
  v_created timestamptz;
  v_object  uuid;
  v_reason  text := nullif(btrim(p_reason), '');
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  if p_table is null or p_table not in ('movements', 'purchases') or p_id is null
     or v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Bekor qilish ma''lumotlari noto''g''ri (sabab majburiy)'
      using errcode = '22023', hint = 'correct_invalid';
  end if;

  if p_table = 'movements' then
    select m.* into v_m from public.movements m where m.id = p_id and m.deleted_at is null for update;
    if not found or not private.can_access_company(v_m.company_id) then
      raise exception 'Yozuv topilmadi' using errcode = 'P0002', hint = 'correct_not_found';
    end if;
    v_company := v_m.company_id; v_author := v_m.created_by; v_created := v_m.created_at; v_object := v_m.object_id;
  else
    select p.* into v_p from public.purchases p where p.id = p_id and p.deleted_at is null for update;
    if not found or not private.can_access_company(v_p.company_id) then
      raise exception 'Yozuv topilmadi' using errcode = 'P0002', hint = 'correct_not_found';
    end if;
    v_company := v_p.company_id; v_author := v_p.created_by; v_created := v_p.created_at; v_object := v_p.object_id;
  end if;

  if v_author is distinct from v_me then
    raise exception 'Faqat o''zingiz kiritgan yozuvni bekor qilish mumkin'
      using errcode = '42501', hint = 'correct_forbidden';
  end if;
  if v_created < now() - interval '30 minutes' then
    raise exception 'Bekor qilish muddati (30 daqiqa) o''tgan — administratorga murojaat qiling'
      using errcode = '55000', hint = 'correct_window_passed';
  end if;
  if not private.has_role('super_admin', 'admin')
     and ((p_table = 'movements' and not (private.has_role('prorab', 'omborchi') and private.can_access_object(v_object)))
          or (p_table = 'purchases' and not (private.has_role('taminotchi')
                                            or (private.has_role('prorab', 'haydovchi') and private.can_access_object(v_object))))) then
    raise exception 'Bu yozuvni bekor qilishga ruxsat yo''q'
      using errcode = '42501', hint = 'correct_forbidden';
  end if;

  if p_table = 'movements' then
    if v_m.type not in ('kirim', 'chiqim') or v_m.transfer_id is not null or v_m.inventory_count_id is not null then
      raise exception 'Bog''langan yozuvni bekor qilib bo''lmaydi (o''tkazma yoki inventarizatsiya)'
        using errcode = '55000', hint = 'correct_linked';
    end if;
  elsif exists (select 1 from public.movements m
                 where m.company_id = v_company and m.purchase_id = p_id
                   and m.type = 'kirim' and m.deleted_at is null) then
    raise exception 'Kirimga bog''langan xaridni bekor qilib bo''lmaydi'
      using errcode = '55000', hint = 'correct_linked';
  end if;

  perform set_config('terron.correct_mode', 'cancel', true);
  perform set_config('terron.correct_reason', v_reason, true);
  if p_table = 'movements' then
    update public.movements set deleted_at = now() where id = p_id;
  else
    update public.purchases set deleted_at = now() where id = p_id;
  end if;
  perform set_config('terron.correct_mode', '', true);
  perform set_config('terron.correct_reason', '', true);
end;
$$;

-- Soft delete / tiklash alerti (Batch 10 versiyasi) + cancel_own_entry rejimi:
-- muallifning o'z bekor qilishi — yozuv_tuzatildi (belgi), yozuv_ochirildi emas.
create or replace function private.tg_soft_delete_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     jsonb := to_jsonb(new);
  v_details jsonb;
  v_me      uuid;
  v_occ     timestamptz;
  v_days    integer;
  v_sev     text;
begin
  if tg_table_name = 'movements' and private.transfer_rpc_active()
     and (v_row ->> 'transfer_id') is not null then
    return null;
  end if;

  if old.deleted_at is null and new.deleted_at is not null
     and coalesce(current_setting('terron.correct_mode', true), '') = 'cancel'
     and tg_table_name in ('movements', 'purchases') then
    v_me := private.my_profile_id();
    insert into public.alerts
      (company_id, type, severity, object_id, material_id, purchase_id, movement_id, details)
    values
      (new.company_id, 'yozuv_tuzatildi'::public.alert_type, 'belgi',
       (v_row ->> 'object_id')::uuid, (v_row ->> 'material_id')::uuid,
       case when tg_table_name = 'purchases' then new.id end,
       case when tg_table_name = 'movements' then new.id end,
       jsonb_build_object(
         'table',            tg_table_name,
         'record_id',        new.id,
         'changed',          jsonb_build_array('deleted_at'),
         'via',              'cancel_own_entry',
         'reason',           nullif(current_setting('terron.correct_reason', true), ''),
         'actor_profile_id', v_me,
         'actor_name',       (select p.full_name from public.profiles p where p.id = v_me),
         'author_id',        v_row -> 'created_by',
         'material_name',    (select m.name from public.materials m
                               where m.company_id = new.company_id and m.id = (v_row ->> 'material_id')::uuid),
         'base_unit',        (select m.base_unit from public.materials m
                               where m.company_id = new.company_id and m.id = (v_row ->> 'material_id')::uuid),
         'qty_base',         v_row -> 'qty_base',
         'amount',           v_row -> 'total_amount',
         'movement_type',    case when tg_table_name = 'movements' then v_row -> 'type' end,
         'purchase_id',      case when tg_table_name = 'movements' then v_row -> 'purchase_id' end));
    return null;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    v_details := jsonb_build_object(
      'table',            tg_table_name,
      'record_id',        new.id,
      'actor_profile_id', private.my_profile_id(),
      'actor_name',       (select p.full_name from public.profiles p where p.id = private.my_profile_id()),
      'material_id',      v_row -> 'material_id',
      'material_name',    (select m.name from public.materials m where m.id = (v_row ->> 'material_id')::uuid),
      'object_id',        v_row -> 'object_id'
    );
    if tg_table_name = 'cash_advances' then
      v_details := v_details || jsonb_build_object(
        'amount', v_row -> 'amount', 'recipient_id', v_row -> 'recipient_id',
        'recipient_name', (select p.full_name from public.profiles p where p.id = (v_row ->> 'recipient_id')::uuid));
    elsif tg_table_name = 'purchases' then
      v_details := v_details || jsonb_build_object(
        'amount', v_row -> 'total_amount', 'qty_base', v_row -> 'qty_base', 'buyer_id', v_row -> 'buyer_id',
        'buyer_name', (select p.full_name from public.profiles p where p.id = (v_row ->> 'buyer_id')::uuid));
    else
      v_details := v_details || jsonb_build_object(
        'qty_base', v_row -> 'qty_base', 'movement_type', v_row -> 'type', 'purchase_id', v_row -> 'purchase_id');
    end if;

    insert into public.alerts
      (company_id, type, severity, object_id, material_id, purchase_id, movement_id, details)
    values
      (new.company_id, 'yozuv_ochirildi', 'ogohlantirish',
       (v_row ->> 'object_id')::uuid, (v_row ->> 'material_id')::uuid,
       case when tg_table_name = 'purchases' then new.id end,
       case when tg_table_name = 'movements' then new.id end,
       v_details);
  elsif old.deleted_at is not null and new.deleted_at is null then
    v_me := private.my_profile_id();

    update public.alerts a
       set status  = 'yopildi',
           details = a.details || jsonb_build_object(
             'auto_closed', true, 'closed_reason', 'restored',
             'closed_by_actor', v_me)
     where a.company_id = new.company_id
       and (a.details ->> 'record_id') = new.id::text
       and a.type = 'yozuv_ochirildi'
       and a.status in ('yangi', 'korildi')
       and a.deleted_at is null;

    v_occ := (v_row ->> case tg_table_name
                          when 'movements' then 'occurred_at'
                          when 'purchases' then 'purchased_at'
                          else 'issued_at'
                        end)::timestamptz;
    v_days := floor(extract(epoch from (now() - old.deleted_at)) / 86400)::integer;
    v_sev := case
               when v_days >= 7
                 or (v_occ at time zone 'Asia/Tashkent')::date
                    < date_trunc('month', now() at time zone 'Asia/Tashkent')::date
               then 'jiddiy'
               else 'ogohlantirish'
             end;

    v_details := jsonb_build_object(
      'table',             tg_table_name,
      'record_id',         new.id,
      'actor_profile_id',  v_me,
      'actor_name',        (select p.full_name from public.profiles p where p.id = v_me),
      'material_name',     (select m.name from public.materials m
                             where m.company_id = new.company_id and m.id = (v_row ->> 'material_id')::uuid),
      'amount',            case tg_table_name
                             when 'purchases'     then v_row -> 'total_amount'
                             when 'cash_advances' then v_row -> 'amount'
                           end,
      'qty_base',          case when tg_table_name in ('purchases', 'movements') then v_row -> 'qty_base' end,
      'base_unit',         (select m.base_unit from public.materials m
                             where m.company_id = new.company_id and m.id = (v_row ->> 'material_id')::uuid),
      'buyer_name',        (select p.full_name from public.profiles p
                             where p.company_id = new.company_id and p.id = (v_row ->> 'buyer_id')::uuid),
      'recipient_name',    (select p.full_name from public.profiles p
                             where p.company_id = new.company_id and p.id = (v_row ->> 'recipient_id')::uuid),
      'movement_type',     case when tg_table_name = 'movements' then v_row -> 'type' end,
      'occurred_at',       v_occ,
      'deleted_at_before', old.deleted_at,
      'days_since',        v_days
    );

    insert into public.alerts
      (company_id, type, severity, object_id, material_id, purchase_id, movement_id, details)
    values
      (new.company_id, 'yozuv_tiklandi', v_sev::public.alert_severity,
       (v_row ->> 'object_id')::uuid, (v_row ->> 'material_id')::uuid,
       case when tg_table_name = 'purchases' then new.id end,
       case when tg_table_name = 'movements' then new.id end,
       v_details);
  end if;
  return null;
end;
$$;

-- Sana oynasi (Batch 4 versiyasi) + detail: ruxsat etilgan eng erta vaqt
-- (UTC ISO, "YYYY-MM-DDTHH:MI:SSZ") — UI "dd.mm.yyyy dan oldin emas" deb ko'rsatadi.
create or replace function private.tg_ops_op_date()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_col constant text := tg_argv[0];
  v_ts  timestamptz := (to_jsonb(new) ->> v_col)::timestamptz;
  v_old timestamptz;
  v_min timestamptz := now() - interval '3 days';
begin
  if tg_op = 'UPDATE' then
    v_old := (to_jsonb(old) ->> v_col)::timestamptz;
  end if;

  if v_ts is null then
    v_ts := case when tg_op = 'UPDATE' then v_old else now() end;
    new := jsonb_populate_record(new, jsonb_build_object(v_col, v_ts));
  end if;

  if tg_op = 'UPDATE' and v_ts is not distinct from v_old then
    return new;
  end if;

  if auth.uid() is not null
     and not private.has_role('super_admin', 'admin')
     and (v_ts < v_min or v_ts > now() + interval '5 minutes') then
    raise exception 'Sana ruxsat etilgan oraliqdan tashqarida: % dan oldingi yoki kelajakdagi sanani faqat administrator kirita oladi',
      to_char(v_min at time zone 'Asia/Tashkent', 'DD.MM.YYYY HH24:MI')
      using errcode = '23514', hint = 'ops_occurred_at_range',
            detail = to_char(v_min at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 11. S7 — admin / direktor profillari (audit_fixes B2 versiyasi) +:
--   admin (super_admin emas): hech kimga admin/direktor rolini bera olmaydi;
--   admin/direktor profilining full_name ini ham o'zgartira olmaydi;
--   admin/direktor profilini yarata olmaydi (INSERT) → profile_protected.
-- ============================================================================
create or replace function private.tg_profiles_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.telegram_chat_id is distinct from old.telegram_chat_id then
    new.telegram_blocked_at := null;
  end if;
  if current_user <> 'authenticated' or auth.uid() is null or private.is_super_admin() then
    return new;
  end if;

  if not private.has_role('admin') then
    if (to_jsonb(new) - 'notify_workflow' - 'updated_at') is distinct from (to_jsonb(old) - 'notify_workflow' - 'updated_at')
       or new.notify_workflow is not distinct from old.notify_workflow then
      return null;
    end if;
    return new;
  end if;

  if old.role in ('admin', 'direktor')
     and (new.role is distinct from old.role
          or new.phone is distinct from old.phone
          or new.full_name is distinct from old.full_name
          or new.is_active is distinct from old.is_active
          or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'Administrator va direktor profilining roli, ismi, telefoni va holatini faqat tizim egasi o''zgartiradi'
      using errcode = '42501', hint = 'profile_protected';
  end if;
  if new.role in ('admin', 'direktor') and new.role is distinct from old.role then
    raise exception 'Administrator yoki direktor rolini faqat tizim egasi beradi'
      using errcode = '42501', hint = 'profile_protected';
  end if;
  return new;
end;
$$;

create function private.tg_profiles_protect_ins()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and auth.uid() is not null and not private.is_super_admin()
     and new.role in ('admin', 'direktor') then
    raise exception 'Administrator yoki direktor profilini faqat tizim egasi yaratadi'
      using errcode = '42501', hint = 'profile_protected';
  end if;
  return new;
end;
$$;

create trigger b_profiles_protect_ins before insert on public.profiles
  for each row execute function private.tg_profiles_protect_ins();

-- B3 versiyasi + p_first_login: admin direktor/admin profiliga BIRINCHI marta login
-- bergan holat ham login_ozgardi (details.first_login = true). admin-users Edge Function
-- auth_user_id null bo'lgan direktor/admin profiliga login bog'laganda chaqiradi.
drop function public.svc_alert_login_set(uuid, uuid);

create function public.svc_alert_login_set(
  p_target_profile uuid,
  p_actor          uuid,
  p_first_login    boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_t      public.profiles%rowtype;
  v_actor  record;
  v_alert  uuid;
  v_coname text;
begin
  select p.* into v_t from public.profiles p where p.id = p_target_profile and p.deleted_at is null;
  if p_target_profile is null or not found then
    raise exception 'Profil topilmadi' using errcode = 'P0002', hint = 'login_target_not_found';
  end if;
  select p.id, p.full_name, p.role::text as role into v_actor
    from public.profiles p
   where p.id = p_actor and p.company_id = v_t.company_id;
  select c.name into v_coname from public.companies c where c.id = v_t.company_id;

  insert into public.alerts (company_id, type, severity, details)
  values (v_t.company_id, 'login_ozgardi'::public.alert_type, 'ogohlantirish',
          jsonb_build_object(
            'target_profile_id', v_t.id,
            'target_name',       v_t.full_name,
            'target_role',       v_t.role,
            'actor_profile_id',  v_actor.id,
            'actor_name',        v_actor.full_name,
            'actor_role',        v_actor.role,
            'first_login',       coalesce(p_first_login, false),
            'changed_at',        now()))
  returning id into v_alert;

  perform private.enqueue_workflow(v_t.company_id, 'login_changed', v_alert, v_t.id,
    jsonb_build_object(
      'alert_id',     v_alert,
      'profile_id',   v_t.id,
      'profile_name', v_t.full_name,
      'company_name', v_coname,
      'actor_name',   v_actor.full_name,
      'first_login',  coalesce(p_first_login, false),
      'changed_at',   now()));
  return v_alert;
end;
$$;

-- ============================================================================
-- 12. S8 — check_purchase_price (Batch 5 versiyasi) + chastota cheklovi:
--   profil bo'yicha 10 daqiqada 30 chaqiruv (rate_limited, 54000). volatile (yozadi).
-- ============================================================================
create or replace function public.check_purchase_price(p_material_id uuid, p_price_per_base numeric)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.my_company_id();
  v_r       record;
begin
  if v_company is null then
    return 'ok';
  end if;
  perform private.rate_limit_hit('check_purchase_price', 30, interval '10 minutes');
  if p_material_id is null or p_price_per_base is null or p_price_per_base < 0 then
    return 'ok';
  end if;
  if not exists (
    select 1 from public.materials m
     where m.company_id = v_company and m.id = p_material_id and m.deleted_at is null
  ) then
    return 'ok';
  end if;
  select * into v_r
    from private.price_check(v_company, p_material_id, round(p_price_per_base, 4),
                             now(), 'infinity'::timestamptz, null);
  return v_r.direction;
end;
$$;

-- ============================================================================
-- 13. S9 — close_note (audit_fixes B2 versiyasi):
--   foydalanuvchi sessiyasida: status = yopildi bo'lsa izoh bo'sh bo'lmaydi
--   (alert_close_note_required); yopilgan alertning izohi o'zgarmaydi
--   (alert_close_note_locked, 55000).
-- ============================================================================
create or replace function private.tg_alerts_close_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if old.status = 'yopildi' and new.close_note is distinct from old.close_note then
    raise exception 'Yopilgan ogohlantirish izohini o''zgartirib bo''lmaydi'
      using errcode = '55000', hint = 'alert_close_note_locked';
  end if;
  if new.status = 'yopildi' then
    if nullif(btrim(coalesce(new.close_note, '')), '') is null then
      raise exception 'Ogohlantirishni yopishda sababini yozing'
        using errcode = '23514', hint = 'alert_close_note_required';
    end if;
    if old.status is distinct from 'yopildi' then
      new.close_note := btrim(new.close_note);
      new.details := new.details || jsonb_build_object(
        'manual_closed_at', now(), 'manual_closed_by', private.my_profile_id());
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 14. S12 — profile_directory: + deleted_at, is_available (faol va o'chirilmagan).
--   Tanlash ro'yxatlari (picker) faqat is_available = true dan foydalanadi.
-- ============================================================================
create or replace view public.profile_directory
with (security_barrier = true)
as
select p.id, p.company_id, p.full_name, p.role, p.is_active,
       p.deleted_at,
       (p.is_active and p.deleted_at is null) as is_available
  from public.profiles p
 where (select private.is_super_admin())
    or p.company_id = (select private.my_company_id());

-- ============================================================================
-- 15. S13 / Ops — bloklangan chat
-- ============================================================================

-- Firma bo'yicha bloklangan (tirik) profillar soni — faqat admin / direktor / super_admin
-- (aks holda null). dashboard_summary (invoker) chaqiradi.
create function private.telegram_blocked_count(p_company_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when private.has_role('super_admin', 'admin', 'direktor') and private.can_access_company(p_company_id)
           then (select count(*)::integer from public.profiles p
                  where p.company_id = p_company_id and p.deleted_at is null
                    and p.telegram_blocked_at is not null)
         end
$$;

-- Admin: profilning "bot bloklangan" belgisini tozalash. Qaytaradi: tozalandimi.
create function public.reset_chat_blocked(p_profile_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_co uuid;
  v_n  integer;
begin
  if private.my_profile_id() is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  if not private.has_role('super_admin', 'admin') then
    raise exception 'Faqat administrator' using errcode = '42501', hint = 'chat_reset_forbidden';
  end if;
  select p.company_id into v_co from public.profiles p where p.id = p_profile_id and p.deleted_at is null;
  if v_co is null or not private.can_access_company(v_co) then
    raise exception 'Profil topilmadi' using errcode = 'P0002', hint = 'profile_not_found';
  end if;
  update public.profiles p set telegram_blocked_at = null
   where p.id = p_profile_id and p.telegram_blocked_at is not null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- tg-bot / tg-auth: chatdan har qanday kiruvchi faollik — blok belgisi tozalanadi.
-- Qaytaradi: tozalangan profillar soni.
create function public.svc_touch_chat(p_chat_id bigint)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_chat_id is null then
    return 0;
  end if;
  update public.profiles p set telegram_blocked_at = null
   where p.telegram_chat_id = p_chat_id and p.telegram_blocked_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- dashboard_summary (audit_fixes versiyasi) + telegram_blocked_count (admin/direktor/
-- super_admin, aks holda null) va telegram_me_blocked (chaqiruvchining o'zi).
create or replace function public.dashboard_summary(p_from date, p_to date, p_object_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_period    record;
  v_company   uuid;
  v_kirim     integer;
  v_chiqim    integer;
  v_p_count   integer;
  v_p_sum     numeric(18,2);
  v_cash_iss  numeric(18,2);
  v_cash_ret  numeric(18,2);
  v_cash_hand numeric(18,2);
  v_cash_pos  numeric(18,2);
  v_cash_neg  numeric(18,2);
  v_al_open   integer;
  v_al_ser    integer;
  v_al_new    integer;
  v_unrec     integer;
  v_tr_pend   integer;
  v_rq_pend   integer;
  v_over      integer;
begin
  select * into v_period from private.report_period(p_from, p_to);
  -- ko'r-ko'rona sanash: tekshiruvchiga qoldiq / harakat / xarid / pul hisoblanmaydi
  if private.is_blind_counter() then
    return private.dashboard_blind_summary();
  end if;
  v_company := private.report_company(p_object_id);

  select count(*) filter (where m.type = 'kirim'),
         count(*) filter (where m.type = 'chiqim')
    into v_kirim, v_chiqim
    from public.movements m
   where m.company_id = v_company
     and m.deleted_at is null
     and m.type in ('kirim', 'chiqim')
     and m.occurred_at >= v_period.o_start and m.occurred_at < v_period.o_end
     and (p_object_id is null or m.object_id = p_object_id);

  select count(*), coalesce(sum(p.total_amount), 0)
    into v_p_count, v_p_sum
    from public.purchases p
   where p.company_id = v_company
     and p.deleted_at is null
     and p.purchased_at >= v_period.o_start and p.purchased_at < v_period.o_end
     and (p_object_id is null or p.object_id = p_object_id);

  select coalesce(sum(ca.amount) filter (where ca.kind = 'berildi'), 0),
         coalesce(sum(ca.amount) filter (where ca.kind = 'qaytarildi'), 0)
    into v_cash_iss, v_cash_ret
    from public.cash_advances ca
   where ca.company_id = v_company
     and ca.deleted_at is null
     and ca.issued_at >= v_period.o_start and ca.issued_at < v_period.o_end;

  select coalesce(sum(cb.balance), 0),
         coalesce(sum(cb.balance) filter (where cb.balance > 0), 0),
         coalesce(-sum(cb.balance) filter (where cb.balance < 0), 0)
    into v_cash_hand, v_cash_pos, v_cash_neg
    from public.cash_balances cb
   where cb.company_id = v_company;

  select count(*) filter (where a.status in ('yangi', 'korildi')),
         count(*) filter (where a.status in ('yangi', 'korildi') and a.severity = 'jiddiy')
    into v_al_open, v_al_ser
    from public.alerts a
   where a.company_id = v_company
     and a.deleted_at is null
     and a.severity <> 'belgi'
     and a.status in ('yangi', 'korildi')
     and (p_object_id is null or a.object_id = p_object_id);
  v_al_new := coalesce(private.alerts_new_count(v_company, v_period.o_start, v_period.o_end, p_object_id), 0);

  select count(distinct nu.object_id)
    into v_over
    from public.norm_usage nu
    join public.objects o
      on o.company_id = nu.company_id and o.id = nu.object_id and o.deleted_at is null
   where nu.company_id = v_company
     and nu.consumed_qty_base > nu.allowed_qty_base
     and (p_object_id is null or nu.object_id = p_object_id);

  select count(*)
    into v_unrec
    from public.purchases p
   where p.company_id = v_company
     and p.deleted_at is null
     and p.purchased_at < now() - interval '24 hours'
     and p.purchased_at >= now() - interval '90 days'
     and (p_object_id is null or p.object_id = p_object_id)
     and not private.purchase_has_receipt(p.company_id, p.id);

  select count(*)
    into v_tr_pend
    from public.transfers t
   where t.company_id = v_company
     and t.deleted_at is null
     and t.status = 'yuborildi'
     and (p_object_id is null or t.from_object_id = p_object_id or t.to_object_id = p_object_id);

  select count(*)
    into v_rq_pend
    from public.material_requests rq
   where rq.company_id = v_company
     and rq.deleted_at is null
     and rq.status = 'kutilmoqda'
     and (p_object_id is null or rq.object_id = p_object_id);

  return jsonb_build_object(
    'kirim_count',                v_kirim,
    'chiqim_count',               v_chiqim,
    'purchases_count',            v_p_count,
    'purchases_sum',              v_p_sum::text,
    'cash_issued_sum',            v_cash_iss::text,
    'cash_returned_sum',          v_cash_ret::text,
    'cash_on_hand_total',         v_cash_hand::text,
    'cash_outstanding_sum',       v_cash_pos::text,
    'cash_owed_to_staff_sum',     v_cash_neg::text,
    'alerts_open',                v_al_open,
    'alerts_serious_open',        v_al_ser,
    'alerts_new_in_period',       v_al_new,
    'unreceived_purchases_count', v_unrec,
    'pending_transfers_count',    v_tr_pend,
    'pending_requests_count',     v_rq_pend,
    'objects_over_norm_count',    v_over,
    'telegram_blocked_count',     private.telegram_blocked_count(v_company),
    'telegram_me_blocked',        coalesce((select p.telegram_blocked_at is not null
                                              from public.profiles p
                                             where p.id = private.my_profile_id()), false)
  );
end;
$$;

-- ============================================================================
-- 16. S6 — ko'r-ko'rona sanash
-- ============================================================================

-- tekshiruvchi — faqat o'zi yaratgan hisoblar (qatorlar ota-yozuv RLS'i orqali).
drop policy inventory_counts_select on public.inventory_counts;
create policy inventory_counts_select on public.inventory_counts
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor', 'tekshiruvchi')))
    and (
      ((select private.is_company_wide()) and not (select private.has_role('tekshiruvchi')))
      or ((select private.has_role('tekshiruvchi')) and created_by = (select private.my_profile_id()))
      or ((select private.has_role('prorab', 'omborchi')) and object_id in (select private.my_object_ids()))
    )
  );

-- Nomzod materiallar: tekshiruvchi uchun — faol katalog (qoldiq bo'yicha filtr yo'q,
-- qaysi materialda qoldiq borligi sizmaydi); admin — avvalgidek.
create or replace function public.inventory_candidate_materials(p_object_id uuid)
returns table (material_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if private.my_profile_id() is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  select o.company_id into v_company
    from public.objects o
   where o.id = p_object_id and o.deleted_at is null;
  if v_company is null or not private.can_access_company(v_company) then
    raise exception 'Obyekt topilmadi' using errcode = 'P0002', hint = 'inventory_object_not_found';
  end if;
  if not private.has_role('super_admin', 'admin', 'tekshiruvchi') then
    raise exception 'Inventarizatsiyaga ruxsat yo''q' using errcode = '42501', hint = 'inventory_forbidden';
  end if;

  if private.has_role('tekshiruvchi') then
    return query
      select m.id
        from public.materials m
       where m.company_id = v_company and m.deleted_at is null and m.is_active
       order by m.id;
    return;
  end if;

  return query
    select x.mid
      from (
        select sb.material_id as mid
          from public.stock_balances sb
         where sb.company_id = v_company and sb.object_id = p_object_id and sb.qty_base <> 0
        union
        select i.material_id
          from public.estimate_items i
          join public.estimates e on e.company_id = i.company_id and e.id = i.estimate_id
         where e.company_id = v_company and e.object_id = p_object_id
           and e.is_current and e.deleted_at is null
           and i.item_type = 'material' and i.deleted_at is null and i.material_id is not null
      ) x
      join public.materials m on m.company_id = v_company and m.id = x.mid and m.deleted_at is null
     order by x.mid;
end;
$$;

-- S6. submit_inventory_count (audit_fixes A3 versiyasi): tekshiruvchiga natija — faqat {ok:true}
-- (kamomad / sanalmagan son sizmaydi); admin — avvalgidek + ok.
create or replace function public.submit_inventory_count(p_count_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me        uuid := private.my_profile_id();
  v_count     public.inventory_counts%rowtype;
  v_list      jsonb;
  v_n         integer;
  v_total_i   numeric;
  v_nc_list   jsonb;
  v_nc_pos    integer;
  v_nc_count  integer;
  v_total_nc  numeric;
  v_total     numeric;
  v_late      jsonb;
  v_late_n    integer;
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan'
      using errcode = '42501', hint = 'auth_required';
  end if;

  select * into v_count
    from public.inventory_counts c
   where c.id = p_count_id
     and c.deleted_at is null
   for update;
  if not found or not private.can_access_company(v_count.company_id) then
    raise exception 'Inventarizatsiya topilmadi'
      using errcode = 'P0002', hint = 'inventory_not_found';
  end if;

  if not (private.has_role('super_admin', 'admin')
          or (private.has_role('tekshiruvchi') and v_count.created_by = v_me)) then
    raise exception 'Bu inventarizatsiyani yuborishga ruxsat yo''q'
      using errcode = '42501', hint = 'inventory_submit_forbidden';
  end if;

  if v_count.status <> 'draft' then
    raise exception 'Inventarizatsiya allaqachon yuborilgan'
      using errcode = '55000', hint = 'inventory_already_submitted';
  end if;

  perform set_config('terron.inventory_rpc', 'on', true);

  update public.inventory_count_items i
     set qty_expected   = private.stock_at(v_count.company_id, v_count.object_id, i.material_id, i.counted_at),
         price_per_base = private.inventory_price(v_count.company_id, i.material_id)
   where i.company_id = v_count.company_id
     and i.inventory_count_id = v_count.id
     and i.deleted_at is null;

  update public.inventory_counts
     set status = 'submitted'
   where id = v_count.id;

  -- (a) sanalgan qatorlardagi kamomad
  with s as (
    select i.material_id,
           i.qty_expected::numeric(20,6)                          as expected,
           i.qty_counted::numeric(20,6)                           as counted,
           (i.qty_expected - i.qty_counted)::numeric(20,6)        as shortage,
           i.price_per_base
      from public.inventory_count_items i
     where i.company_id = v_count.company_id
       and i.inventory_count_id = v_count.id
       and i.deleted_at is null
       and i.qty_expected is not null
       and i.qty_counted < i.qty_expected
  ),
  v as (
    select s.*, m.name as material_name, m.base_unit,
           round(s.shortage * s.price_per_base, 2) as shortage_value,
           row_number() over (order by s.shortage desc, s.material_id) as rn
      from s
      join public.materials m on m.company_id = v_count.company_id and m.id = s.material_id
  )
  select jsonb_agg(jsonb_build_object(
           'material_id', v.material_id, 'material_name', v.material_name, 'base_unit', v.base_unit,
           'expected', v.expected, 'counted', v.counted, 'shortage', v.shortage,
           'shortage_value', v.shortage_value
         ) order by v.rn) filter (where v.rn <= 20),
         count(*)::integer,
         sum(v.shortage_value)
    into v_list, v_n, v_total_i
    from v;

  -- (b) Y2 — sanalmagan materiallar (qoldig'i ≠ 0, qatori yo'q)
  with st as (
    select sb.material_id, sb.qty_base::numeric(20,6) as expected
      from public.stock_balances sb
     where sb.company_id = v_count.company_id
       and sb.object_id = v_count.object_id
       and sb.qty_base <> 0
       and not exists (
         select 1 from public.inventory_count_items i
          where i.company_id = v_count.company_id
            and i.inventory_count_id = v_count.id
            and i.material_id = sb.material_id
            and i.deleted_at is null
       )
  ),
  v as (
    select st.*, m.name as material_name, m.base_unit,
           round(st.expected * private.inventory_price(v_count.company_id, st.material_id), 2) as shortage_value,
           row_number() over (order by st.expected desc, st.material_id) as rn
      from st
      join public.materials m on m.company_id = v_count.company_id and m.id = st.material_id
     where st.expected > 0
  )
  select jsonb_agg(jsonb_build_object(
           'material_id', v.material_id, 'material_name', v.material_name, 'base_unit', v.base_unit,
           'expected', v.expected, 'shortage_value', v.shortage_value
         ) order by v.rn) filter (where v.rn <= 20),
         count(*)::integer,
         sum(v.shortage_value)
    into v_nc_list, v_nc_pos, v_total_nc
    from v;

  select count(*)::integer into v_nc_count
    from public.stock_balances sb
   where sb.company_id = v_count.company_id
     and sb.object_id = v_count.object_id
     and sb.qty_base <> 0
     and not exists (
       select 1 from public.inventory_count_items i
        where i.company_id = v_count.company_id
          and i.inventory_count_id = v_count.id
          and i.material_id = sb.material_id
          and i.deleted_at is null
     );

  -- A3: sanash davomida (hisob yaratilgandan keyin) kiritilgan harakatlar
  select coalesce(jsonb_agg(jsonb_build_object(
           'material_id', x.material_id, 'material_name', x.name, 'count', x.n)
           order by x.n desc, x.name, x.material_id), '[]'::jsonb),
         coalesce(sum(x.n), 0)::integer
    into v_late, v_late_n
    from (
      select m.material_id, mt.name, count(*)::integer as n
        from public.movements m
        join public.materials mt on mt.company_id = m.company_id and mt.id = m.material_id
       where m.company_id = v_count.company_id
         and m.object_id = v_count.object_id
         and m.deleted_at is null
         and m.created_at > v_count.created_at
         and m.material_id in (
           select i.material_id from public.inventory_count_items i
            where i.company_id = v_count.company_id
              and i.inventory_count_id = v_count.id
              and i.deleted_at is null)
       group by m.material_id, mt.name
    ) x;

  select sum(x) into v_total from (values (v_total_i), (v_total_nc)) t(x);

  if v_n > 0 or v_nc_pos > 0 then
    insert into public.alerts (company_id, type, severity, object_id, inventory_count_id, details)
    values (v_count.company_id, 'inventarizatsiya_kamomadi',
            case when v_total >= 1000000 then 'jiddiy' else 'ogohlantirish' end::public.alert_severity,
            v_count.object_id, v_count.id,
            jsonb_build_object('count_id', v_count.id,
                               'items', coalesce(v_list, '[]'::jsonb),
                               'more_count', greatest(v_n - 20, 0),
                               'not_counted', coalesce(v_nc_list, '[]'::jsonb),
                               'not_counted_more', greatest(v_nc_pos - 20, 0),
                               'total_shortage_value', v_total,
                               'movements_during_count', v_late,
                               'movements_during_count_total', v_late_n));
  end if;

  perform set_config('terron.inventory_rpc', 'off', true);
  if not private.has_role('super_admin', 'admin') then
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('has_shortage', v_n > 0 or v_nc_pos > 0,
                            'not_counted_count', v_nc_count,
                            'movements_during_count', v_late_n);
end;
$$;

-- L6. Kunlik hisobot (audit_fixes versiyasi): pul yig'indilari faqat 'podotchet' xaridlar.
create or replace function private.daily_report_stats(
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
  v_restored integer;
  v_tr_pend  integer;
  v_no_est   integer;
  v_geo_mv   integer;
  v_geo_p    integer;
  v_geo_mv_u integer;
  v_geo_p_u  integer;
  v_back_mv  integer;
  v_back_p   integer;
  v_manual   integer;
  v_pos      numeric(18,2);
  v_neg      numeric(18,2);
begin
  select c.name into v_name from public.companies c where c.id = p_company_id;

  select count(*) filter (where m.type = 'kirim'),
         count(*) filter (where m.type = 'chiqim'),
         count(*) filter (where m.type = 'chiqim' and not exists (
           select 1 from public.estimates e
            where e.company_id = m.company_id and e.object_id = m.object_id
              and e.is_current and e.deleted_at is null)),
         count(*) filter (where m.geo_status = 'denied'),
         count(*) filter (where m.geo_status = 'unavailable')
    into v_kirim, v_chiqim, v_no_est, v_geo_mv, v_geo_mv_u
    from public.movements m
   where m.company_id = p_company_id
     and m.deleted_at is null
     and m.occurred_at >= v_from and m.occurred_at < v_to;

  select count(*), coalesce(sum(p.total_amount), 0),
         count(*) filter (where p.geo_status = 'denied'),
         count(*) filter (where p.geo_status = 'unavailable')
    into v_p_count, v_p_sum, v_geo_p, v_geo_p_u
    from public.purchases p
   where p.company_id = p_company_id
     and p.deleted_at is null
     and p.purchased_at >= v_from and p.purchased_at < v_to;

  select count(*) into v_back_mv
    from public.movements m
   where m.company_id = p_company_id
     and m.deleted_at is null
     and m.created_at >= v_from and m.created_at < v_to
     and m.occurred_at < v_from;
  select count(*) into v_back_p
    from public.purchases p
   where p.company_id = p_company_id
     and p.deleted_at is null
     and p.created_at >= v_from and p.created_at < v_to
     and p.purchased_at < v_from;

  select count(*) into v_requests
    from public.material_requests r
   where r.company_id = p_company_id
     and r.deleted_at is null
     and r.created_at >= v_from and r.created_at < v_to;

  select count(*) into v_tr_pend
    from public.transfers t
   where t.company_id = p_company_id
     and t.deleted_at is null
     and t.status = 'yuborildi';

  select coalesce(jsonb_object_agg(x.type, x.n), '{}'::jsonb)
    into v_by_type
    from (
      select a.type::text as type, count(*)::integer as n
        from public.alerts a
       where a.company_id = p_company_id
         and a.deleted_at is null
         and a.created_at >= v_from and a.created_at < v_to
         and private.alert_counts_as_new(a.type::text, a.severity::text)
       group by a.type
    ) x;
  v_new := private.alerts_new_count(p_company_id, v_from, v_to, null);

  select count(*) filter (where a.type::text = 'ozi_qabul_qilgan'),
         count(*) filter (where a.type::text = 'yozuv_ochirildi'),
         count(*) filter (where a.type::text = 'yozuv_tiklandi')
    into v_self, v_deleted, v_restored
    from public.alerts a
   where a.company_id = p_company_id
     and a.deleted_at is null
     and a.created_at >= v_from and a.created_at < v_to;

  select count(*) into v_manual
    from public.alerts a
   where a.company_id = p_company_id
     and a.deleted_at is null
     and a.status = 'yopildi'
     and a.closed_at >= v_from and a.closed_at < v_to
     and a.details ? 'manual_closed_at';

  select count(*) into v_failed
    from public.notification_outbox o
   where o.company_id = p_company_id
     and o.status = 'failed'
     and o.updated_at >= v_from and o.updated_at < v_to;

  select coalesce(sum(y.b) filter (where y.b > 0), 0), coalesce(-sum(y.b) filter (where y.b < 0), 0)
    into v_pos, v_neg
    from (
      select x.pid, sum(x.amt) as b
        from (
          select ca.recipient_id as pid,
                 case when ca.kind = 'berildi' then ca.amount else -ca.amount end as amt
            from public.cash_advances ca
           where ca.company_id = p_company_id and ca.deleted_at is null
          union all
          select p.buyer_id, -p.total_amount
            from public.purchases p
           where p.company_id = p_company_id and p.deleted_at is null
             and p.payment_source = 'podotchet'
        ) x
       group by x.pid
    ) y;

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
    'deleted_count',       v_deleted,
    'restored_count',      v_restored,
    'transfers_pending_count',       v_tr_pend,
    'chiqim_without_estimate_count', v_no_est,
    'low_stock_count',     private.low_stock_count(p_company_id),
    'geo_denied_count',    v_geo_mv + v_geo_p,
    'geo_unavailable_count', v_geo_mv_u + v_geo_p_u,
    'backdated_count',     v_back_mv + v_back_p,
    'manual_closed_count', v_manual,
    'stuck_pending_count', private.outbox_stuck_count(p_company_id),
    'failed_7d_count',     private.outbox_failed_7d_count(p_company_id),
    'cash_outstanding_sum',   v_pos::text,
    'cash_owed_to_staff_sum', v_neg::text
  );
end;
$$;

-- ============================================================================
-- 17. RLS
-- ============================================================================

-- S14. Sayt alertlari: omborchi — smetadan_ortiq_sorov siz; prorab — avvalgidek.
drop policy alerts_select_site on public.alerts;
create policy alerts_select_site on public.alerts
  for select to authenticated
  using (
    company_id = (select private.my_company_id())
    and deleted_at is null
    and object_id in (select private.my_object_ids())
    and (
      ((select private.has_role('prorab'))
        and type::text in ('normadan_oshish', 'manfiy_qoldiq', 'otkazma_farqi', 'smetadan_ortiq_sorov', 'smetasiz_chiqim'))
      or ((select private.has_role('omborchi'))
        and type::text in ('normadan_oshish', 'manfiy_qoldiq', 'otkazma_farqi', 'smetasiz_chiqim'))
    )
  );

-- Haydovchi a'zo obyektlarining tasdiqlangan (tasdiqlandi) so'rovlarini ko'radi (faqat o'qish).
drop policy material_requests_select on public.material_requests;
create policy material_requests_select on public.material_requests
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor', 'taminotchi')))
    and (
      (select private.is_company_wide_ops())
      or ((select private.has_role('prorab')) and object_id in (select private.my_object_ids()))
      or ((select private.has_role('haydovchi'))
          and status = 'tasdiqlandi' and deleted_at is null
          and object_id in (select private.my_object_ids()))
    )
  );

-- ============================================================================
-- 18. Ish oqimi xabarlari (yangi turlar) va L12
-- ============================================================================

create function private.transfer_payload(p_transfer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'transfer_id',       t.id,
           'company_name',      c.name,
           'status',            t.status,
           'from_object_id',    t.from_object_id,
           'from_object_name',  fo.name,
           'to_object_id',      t.to_object_id,
           'to_object_name',    tob.name,
           'material_id',       t.material_id,
           'material_name',     m.name,
           'qty_input',         t.qty_input,
           'unit_input',        t.unit_input,
           'qty_base',          t.qty_base,
           'received_qty_base', t.received_qty_base,
           'base_unit',         m.base_unit,
           'note',              t.note,
           'cancel_reason',     t.cancel_reason,
           'sent_by_id',        t.created_by,
           'sent_by_name',      sb.full_name,
           'received_by_name',  rb.full_name,
           'created_at',        t.created_at,
           'received_at',       t.received_at)
    from public.transfers t
    join public.companies c on c.id = t.company_id
    left join public.objects fo on fo.company_id = t.company_id and fo.id = t.from_object_id
    left join public.objects tob on tob.company_id = t.company_id and tob.id = t.to_object_id
    left join public.materials m on m.company_id = t.company_id and m.id = t.material_id
    left join public.profiles sb on sb.id = t.created_by
    left join public.profiles rb on rb.company_id = t.company_id and rb.id = t.received_by
   where t.id = p_transfer_id
$$;

-- transfers: bekor → transfer_cancelled (qabul obyekti xodimlari, bekor qiluvchidan
-- tashqari); qabul qilindi → transfer_received (yuboruvchiga, o'zi qabul qilmagan bo'lsa).
create function private.tg_transfers_workflow_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.my_profile_id();
begin
  if new.deleted_at is not null then
    return null;
  end if;
  if new.status = 'bekor' then
    perform private.enqueue_workflow(new.company_id, 'transfer_cancelled', new.id, null,
      private.transfer_payload(new.id) || jsonb_build_object(
        'cancelled_by_id',   v_me,
        'cancelled_by_name', (select p.full_name from public.profiles p where p.id = v_me),
        'cancelled_at',      now()));
  elsif new.status = 'qabul_qilindi'
        and new.created_by is not null
        and new.created_by is distinct from new.received_by
        and exists (select 1 from public.profiles p where p.company_id = new.company_id and p.id = new.created_by) then
    perform private.enqueue_workflow(new.company_id, 'transfer_received', new.id, new.created_by,
      private.transfer_payload(new.id));
  end if;
  return null;
end;
$$;

create trigger zz_workflow_status after update on public.transfers
  for each row when (old.status is distinct from new.status)
  execute function private.tg_transfers_workflow_status();

-- Xarid payloadi (purchase_for_object shakli).
create function private.purchase_payload(p_purchase_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'purchase_id',   p.id,
           'company_name',  c.name,
           'object_id',     p.object_id,
           'object_name',   o.name,
           'material_id',   p.material_id,
           'material_name', m.name,
           'qty_input',     p.qty_input,
           'unit_input',    p.unit_input,
           'qty_base',      p.qty_base,
           'base_unit',     m.base_unit,
           'buyer_id',      p.buyer_id,
           'buyer_name',    pr.full_name,
           'supplier_name', s.name,
           'purchased_at',  p.purchased_at)
    from public.purchases p
    join public.companies c on c.id = p.company_id
    left join public.objects o on o.company_id = p.company_id and o.id = p.object_id
    left join public.materials m on m.company_id = p.company_id and m.id = p.material_id
    left join public.profiles pr on pr.company_id = p.company_id and pr.id = p.buyer_id
    left join public.suppliers s on s.company_id = p.company_id and s.id = p.supplier_id
   where p.id = p_purchase_id
$$;

-- L12. purchase_for_object — faqat foydalanuvchi kiritgan (auth.uid() bor) va yangi
-- (purchased_at > now − 24 soat) xarid uchun (audit_fixes D2 versiyasi).
create or replace function private.tg_purchases_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null or auth.uid() is null or new.purchased_at <= now() - interval '24 hours' then
    return null;
  end if;
  perform private.enqueue_workflow(new.company_id, 'purchase_for_object', new.id, null,
                                   private.purchase_payload(new.id));
  return null;
end;
$$;

-- Xarid o'chirildi → purchase_deleted (purchase_for_object olganlarga), faqat o'sha xabar bo'lgan bo'lsa.
create function private.tg_purchases_workflow_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.my_profile_id();
begin
  if not exists (select 1 from public.notification_outbox o
                  where o.kind = 'purchase_for_object' and o.ref_id = new.id) then
    return null;
  end if;
  perform private.enqueue_workflow(new.company_id, 'purchase_deleted', new.id, null,
    private.purchase_payload(new.id) || jsonb_build_object(
      'deleted_at',      new.deleted_at,
      'deleted_by_name', (select p.full_name from public.profiles p where p.id = v_me),
      'reason',          nullif(coalesce(current_setting('terron.correct_reason', true), ''), '')));
  return null;
end;
$$;

create trigger zz_workflow_deleted after update on public.purchases
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.tg_purchases_workflow_deleted();

-- Inventarizatsiya qoldiqqa qo'llandi → muallifga inventory_applied (miqdorlarsiz).
create function private.tg_inventory_applied_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is null or new.created_by is not distinct from new.applied_by
     or not exists (select 1 from public.profiles p where p.company_id = new.company_id and p.id = new.created_by) then
    return null;
  end if;
  perform private.enqueue_workflow(new.company_id, 'inventory_applied', new.id, new.created_by,
    (select jsonb_build_object(
              'count_id',        new.id,
              'company_name',    c.name,
              'object_id',       new.object_id,
              'object_name',     o.name,
              'counted_at',      new.counted_at,
              'submitted_at',    new.submitted_at,
              'applied_at',      new.applied_at,
              'applied_by_name', ab.full_name,
              'items_count',     (select count(*)::integer from public.inventory_count_items i
                                   where i.company_id = new.company_id and i.inventory_count_id = new.id
                                     and i.deleted_at is null),
              'adjusted_count',  (select count(*)::integer from public.movements m
                                   where m.company_id = new.company_id and m.inventory_count_id = new.id
                                     and m.type = 'inventory_adjust' and m.deleted_at is null))
       from public.companies c
       left join public.objects o on o.company_id = new.company_id and o.id = new.object_id
       left join public.profiles ab on ab.id = new.applied_by
      where c.id = new.company_id));
  return null;
end;
$$;

create trigger zz_workflow_applied after update on public.inventory_counts
  for each row when (old.applied_at is null and new.applied_at is not null)
  execute function private.tg_inventory_applied_workflow();

-- ============================================================================
-- 19. Qabul qiluvchilar (audit_fixes versiyasi) +:
--   request_approved      → taminotchi + obyektning haydovchi a'zolari;
--   transfer_cancelled    → qabul obyektining prorab / omborchi a'zolari (bekor qiluvchidan tashqari);
--   transfer_received     → yuboruvchi (profile_id);
--   purchase_deleted      → obyektning prorab / omborchi a'zolari (xaridordan tashqari);
--   purchase_on_your_name → xaridor (profile_id) — notify_workflow ga qaramaydi;
--   inventory_applied     → hisob muallifi (profile_id);
--   alerts_digest         → direktor, admin.
-- ============================================================================
create or replace function public.svc_outbox_recipients(p_outbox_id uuid)
returns table (profile_id uuid, chat_id bigint, role text)
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select x.* from public.notification_outbox x where x.id = p_outbox_id
  ),
  tr as (
    select t.from_object_id, t.to_object_id
      from o
      join public.transfers t
        on t.company_id = o.company_id
       and t.id = case
                    when (o.payload -> 'details' ->> 'transfer_id')
                         ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                    then (o.payload -> 'details' ->> 'transfer_id')::uuid
                  end
     where o.kind = 'alert'
       and (o.payload ->> 'type') = 'otkazma_farqi'
       and (o.payload -> 'details' ->> 'direction') = 'not_received'
  ),
  wf as (
    -- payload biz yozgan — uuid formati kafolatlangan
    select case
             when o.kind in ('transfer_sent', 'transfer_cancelled') then (o.payload ->> 'to_object_id')::uuid
             when o.kind in ('purchase_for_object', 'purchase_deleted', 'request_approved')
               then (o.payload ->> 'object_id')::uuid
           end as object_id,
           case
             when o.kind in ('purchase_for_object', 'purchase_deleted') then (o.payload ->> 'buyer_id')::uuid
             when o.kind = 'transfer_cancelled' then (o.payload ->> 'cancelled_by_id')::uuid
           end as exclude_id
      from o
     where o.kind in ('transfer_sent', 'transfer_cancelled', 'purchase_for_object', 'purchase_deleted',
                      'request_approved')
  )
  select distinct on (p.telegram_chat_id)
         p.id, p.telegram_chat_id, p.role::text
    from o
    join public.companies c on c.id = o.company_id
    join public.profiles p
      on p.company_id = o.company_id
      or (o.kind = 'bug_report' and p.role = 'super_admin')
    join public.companies pc on pc.id = p.company_id
   where c.is_active
     and c.deleted_at is null
     and pc.is_active
     and pc.deleted_at is null
     and p.is_active
     and p.deleted_at is null
     and p.telegram_chat_id is not null
     and p.telegram_blocked_at is null
     and (o.kind not in ('request_created', 'request_decided', 'request_approved', 'transfer_sent',
                         'purchase_for_object', 'transfer_cancelled', 'transfer_received',
                         'purchase_deleted', 'inventory_applied')
          or p.notify_workflow)
     and case
           when o.kind in ('cash_statement', 'login_changed', 'request_decided', 'transfer_received',
                           'purchase_on_your_name', 'inventory_applied')
             then p.id = o.profile_id
           when o.kind = 'request_overdue' then p.company_id = o.company_id and p.role in ('taminotchi', 'admin')
           when o.kind = 'bug_report'      then p.role = 'super_admin'
                                                or (p.company_id = o.company_id and p.role = 'admin')
           when o.kind = 'request_created' then p.company_id = o.company_id and p.role = 'admin'
           when o.kind = 'request_approved'
             then p.company_id = o.company_id
                  and (p.role = 'taminotchi'
                       or (p.role = 'haydovchi'
                           and exists (select 1 from wf
                                         join public.object_members om on om.object_id = wf.object_id
                                        where om.profile_id = p.id and om.deleted_at is null)))
           when o.kind in ('transfer_sent', 'transfer_cancelled', 'purchase_for_object', 'purchase_deleted')
             then p.company_id = o.company_id
                  and p.role in ('prorab', 'omborchi')
                  and exists (select 1 from wf
                                join public.object_members om on om.object_id = wf.object_id
                               where om.profile_id = p.id and om.deleted_at is null
                                 and p.id is distinct from wf.exclude_id)
           else p.company_id = o.company_id
                and (p.role in ('direktor', 'admin')
                     or (p.role = 'prorab' and exists (
                           select 1
                             from tr
                             join public.object_members om
                               on om.object_id in (tr.from_object_id, tr.to_object_id)
                            where om.profile_id = p.id
                              and om.deleted_at is null)))
         end
   order by p.telegram_chat_id, p.role, p.id;
$$;

-- ============================================================================
-- 20. S4 / L13 — navbatdan olish (audit_fixes versiyasi). Tinch oynada ushlanadi
--   (next_attempt_at := oyna oxiri):
--   * alert / alert_reminder — jiddiy emas VA turi sozlama_ozgardi, login_ozgardi,
--     yozuv_ozgartirildi, xarid_boshqa_nomidan emas;
--   * alerts_digest;
--   * ish oqimi turlari (request_*, transfer_*, purchase_for_object, purchase_deleted,
--     inventory_applied). login_changed va purchase_on_your_name — hech qachon.
-- ============================================================================
create or replace function public.svc_claim_notifications(p_limit integer default 20)
returns setof public.notification_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_outbox o
     set status     = 'failed',
         last_error = 'expired'
   where o.status in ('pending', 'sending')
     and o.kind in ('daily_report', 'request_overdue', 'alert_reminder', 'cash_statement')
     and o.created_at < now() - interval '36 hours';

  update public.notification_outbox o
     set status     = 'failed',
         last_error = coalesce(o.last_error, 'stuck_in_sending')
   where o.status = 'sending'
     and o.updated_at < now() - interval '10 minutes'
     and o.attempts >= 6;

  update public.notification_outbox o
     set next_attempt_at = q.until
    from (
      select x.id, private.quiet_until(c.quiet_hours_start, c.quiet_hours_end, now()) as until
        from public.notification_outbox x
        join public.companies c on c.id = x.company_id
       where x.status = 'pending'
         and x.next_attempt_at <= now()
         and (
           (x.kind in ('alert', 'alert_reminder')
            and coalesce(x.payload ->> 'severity', '') <> 'jiddiy'
            and coalesce(x.payload ->> 'type', '') not in
                ('sozlama_ozgardi', 'login_ozgardi', 'yozuv_ozgartirildi', 'xarid_boshqa_nomidan'))
           or x.kind in ('alerts_digest', 'request_created', 'request_decided', 'request_approved',
                         'transfer_sent', 'transfer_cancelled', 'transfer_received',
                         'purchase_for_object', 'purchase_deleted', 'inventory_applied')
         )
    ) q
   where o.id = q.id
     and q.until is not null;

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

-- ============================================================================
-- 21. Ruxsatlar
-- ============================================================================
revoke execute on function

  private.lock_receipt_alloc(uuid, uuid),
  private.rate_limit_hit(text, integer, interval),
  private.wake_photo_hash(),
  private.enqueue_alert_outbox(uuid),
  private.tg_alert_digest_flush(),
  private.tg_photo_hash_enqueue(),
  private.photo_hash_sweep(),
  private.tg_purchases_buyer_guard(),
  private.tg_purchases_other_buyer(),
  private.tg_suppliers_tin_reeval(),
  private.reevaluate_receipt_chain(uuid, uuid, uuid, timestamptz),
  private.duplicate_matches(text, uuid, uuid),
  private.reevaluate_duplicate(text, uuid),
  private.tg_profiles_protect_ins(),
  private.transfer_payload(uuid),
  private.purchase_payload(uuid),
  private.tg_transfers_workflow_status(),
  private.tg_purchases_workflow_deleted(),
  private.tg_inventory_applied_workflow()
from public, anon, authenticated, service_role;

-- dashboard_summary (invoker) chaqiradi; ichida rol tekshiriladi.
revoke execute on function private.telegram_blocked_count(uuid) from public, anon;
grant execute on function private.telegram_blocked_count(uuid) to authenticated;

revoke execute on function
  public.correct_entry(text, uuid, numeric, uuid, numeric, text, text, uuid, uuid),
  public.cancel_own_entry(text, uuid, text),
  public.reset_chat_blocked(uuid)
from public, anon;
grant execute on function
  public.correct_entry(text, uuid, numeric, uuid, numeric, text, text, uuid, uuid),
  public.cancel_own_entry(text, uuid, text),
  public.reset_chat_blocked(uuid)
to authenticated;

revoke execute on function
  public.svc_set_photo_hash(text, uuid, text, text),
  public.svc_claim_photo_hash_jobs(integer),
  public.svc_complete_photo_hash_job(uuid, text, text, boolean),
  public.svc_alert_login_set(uuid, uuid, boolean),
  public.svc_touch_chat(bigint)
from public, anon, authenticated;
grant execute on function
  public.svc_set_photo_hash(text, uuid, text, text),
  public.svc_claim_photo_hash_jobs(integer),
  public.svc_complete_photo_hash_job(uuid, text, text, boolean),
  public.svc_alert_login_set(uuid, uuid, boolean),
  public.svc_touch_chat(bigint)
to service_role;

-- companies CHECK (tinch oyna) foydalanuvchi UPDATE'ida ham baholanadi.
revoke execute on function private.quiet_window_minutes(time, time) from public, anon;
grant execute on function private.quiet_window_minutes(time, time) to authenticated, service_role;

-- ============================================================================
-- 22. S6 (davomi) — ko'r-ko'rona sanash: tekshiruvchi qoldiq, harakat, xarid va
--   podotchetni ko'rmaydi (himoya qatlami). movements_select / purchases_select
--   Batch 8 dan beri is_company_wide_ops() (tekshiruvchisiz) — o'zgarmagan; quyida
--   qolgan yo'llar aniq yopiladi. Definer RPC'lar ichida (current_user ≠ authenticated)
--   view filtrlari ishlamaydi — submit_inventory_count va boshqalar to'liq qoldiqni oladi.
-- ============================================================================
create function private.is_blind_counter()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.my_role() = 'tekshiruvchi', false)
$$;
revoke execute on function private.is_blind_counter() from public, anon;
grant execute on function private.is_blind_counter() to authenticated, service_role;

drop policy movements_select_own_deleted on public.movements;
create policy movements_select_own_deleted on public.movements
  for select to authenticated
  using (
    deleted_at is not null
    and created_by = (select private.my_profile_id())
    and company_id = (select private.my_company_id())
    and not (select private.is_blind_counter())
  );

drop policy purchases_select_own_deleted on public.purchases;
create policy purchases_select_own_deleted on public.purchases
  for select to authenticated
  using (
    deleted_at is not null
    and created_by = (select private.my_profile_id())
    and company_id = (select private.my_company_id())
    and not (select private.is_blind_counter())
  );

drop policy cash_advances_select on public.cash_advances;
create policy cash_advances_select on public.cash_advances
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter')))
    and not (select private.is_blind_counter())
    and (
      (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter'))
      or recipient_id = (select private.my_profile_id())
    )
  );

drop policy receipt_lookups_select on public.receipt_lookups;
create policy receipt_lookups_select on public.receipt_lookups
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
    and not (select private.is_blind_counter())
  );

-- Qoldiq view (Batch 1 formulasi): to'g'ridan-to'g'ri o'qishda tekshiruvchiga — bo'sh.
create or replace view public.stock_balances
with (security_invoker = true)
as
select
  m.company_id,
  m.object_id,
  m.material_id,
  sum(
    case m.type
      when 'kirim'            then m.qty_base
      when 'transfer_in'      then m.qty_base
      when 'chiqim'           then -m.qty_base
      when 'transfer_out'     then -m.qty_base
      when 'inventory_adjust' then m.qty_base   -- ishorali
    end
  )::numeric(20,6) as qty_base,
  max(m.occurred_at) as last_movement_at
from public.movements m
where m.deleted_at is null
  and not (current_user = 'authenticated' and (select private.is_blind_counter()))
group by m.company_id, m.object_id, m.material_id;

-- Podotchet (L6 versiyasi) — tekshiruvchiga bo'sh.
create or replace view public.cash_balances
with (security_invoker = true)
as
with ledger as (
  select ca.company_id,
         ca.recipient_id                                                           as profile_id,
         (case when ca.kind = 'berildi' then ca.amount else 0 end)::numeric(18,2)    as issued,
         0::numeric(18,2)                                                          as spent,
         (case when ca.kind = 'qaytarildi' then ca.amount else 0 end)::numeric(18,2) as returned,
         case when ca.kind = 'berildi' then ca.issued_at end                       as issued_ts,
         null::timestamptz                                                         as spent_ts
    from public.cash_advances ca
   where ca.deleted_at is null
  union all
  select p.company_id,
         p.buyer_id,
         0::numeric(18,2),
         p.total_amount,
         0::numeric(18,2),
         null::timestamptz,
         p.purchased_at
    from public.purchases p
   where p.deleted_at is null
     and p.payment_source = 'podotchet'
)
select l.company_id,
       l.profile_id,
       sum(l.issued)::numeric(18,2)                                   as issued_total,
       sum(l.spent)::numeric(18,2)                                    as spent_total,
       (sum(l.issued) - sum(l.returned) - sum(l.spent))::numeric(18,2) as balance,
       max(l.issued_ts)                                               as last_issued_at,
       max(l.spent_ts)                                                as last_spent_at,
       sum(l.returned)::numeric(18,2)                                 as returned_total
  from ledger l
 where not (current_user = 'authenticated' and (select private.is_blind_counter()))
   and (l.profile_id = (select private.my_profile_id())
        or (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter'))
        or current_user in ('service_role', 'postgres'))
 group by l.company_id, l.profile_id;

-- Prognoz (Batch 12) — tekshiruvchiga 42501 stock_forbidden (UI bu rolga chaqirmaydi).
create or replace function public.stock_forecast(p_object_id uuid)
returns table (
  material_id                 uuid,
  material_name               text,
  base_unit                   text,
  stock_qty_base              numeric,
  avg_daily_qty_base          numeric,
  days_left                   numeric,
  other_objects_qty_base      numeric,
  estimate_remaining_qty_base numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if private.is_blind_counter() then
    raise exception 'Qoldiq ma''lumoti bu rol uchun yopiq'
      using errcode = '42501', hint = 'stock_forbidden';
  end if;
  return query
  with mv as (
    select m.company_id,
           m.material_id,
           sum(case m.type
                 when 'kirim'            then m.qty_base
                 when 'transfer_in'      then m.qty_base
                 when 'chiqim'           then -m.qty_base
                 when 'transfer_out'     then -m.qty_base
                 when 'inventory_adjust' then m.qty_base
               end)::numeric(20,6) as stock,
           coalesce(sum(m.qty_base) filter (
             where m.type = 'chiqim'
               and (m.occurred_at at time zone 'Asia/Tashkent')::date
                   between (now() at time zone 'Asia/Tashkent')::date - 13
                       and (now() at time zone 'Asia/Tashkent')::date), 0)::numeric(20,6) as out14
      from public.movements m
     where m.object_id = p_object_id
       and m.company_id = (select o.company_id from public.objects o where o.id = p_object_id)
       and m.deleted_at is null
     group by m.company_id, m.material_id
  ),
  f as (
    select mv.company_id, mv.material_id, mv.stock, round(mv.out14 / 14, 6) as avg_daily
      from mv
     where mv.stock <> 0 or mv.out14 > 0
  )
  select f.material_id,
         mt.name::text,
         mt.base_unit::text,
         f.stock::numeric,
         f.avg_daily::numeric,
         (case when f.avg_daily <= 0 then null
               when f.stock <= 0 then 0::numeric
               else round(f.stock / f.avg_daily, 1) end)::numeric,
         (select coalesce(sum(sb.qty_base), 0)::numeric(20,6)
            from public.stock_balances sb
            join public.objects o on o.company_id = sb.company_id and o.id = sb.object_id and o.deleted_at is null
           where sb.company_id = f.company_id
             and sb.material_id = f.material_id
             and sb.object_id <> p_object_id
             and sb.qty_base > 0)::numeric,
         (select nu.remaining_qty_base
            from public.norm_usage nu
           where nu.company_id = f.company_id
             and nu.object_id = p_object_id
             and nu.material_id = f.material_id)::numeric
    from f
    join public.materials mt on mt.company_id = f.company_id and mt.id = f.material_id
   order by 6 nulls last, 2, 1;
end;
$$;

-- Material ishlatilishi (Batch 4) — tekshiruvchiga bo'sh.
create or replace function public.my_material_usage(p_days integer default 30)
returns table (material_id uuid, use_count bigint, last_used_at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_me    uuid := private.my_profile_id();
  v_since timestamptz;
begin
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Kunlar soni 1 dan 365 gacha bo''lishi kerak'
      using errcode = '22023', hint = 'ops_usage_days_range';
  end if;
  if v_me is null or private.is_blind_counter() then
    return;
  end if;
  v_since := now() - make_interval(days => p_days);

  return query
    select u.material_id, count(*)::bigint, max(u.ts)
      from (
        select m.material_id, m.created_at as ts
          from public.movements m
         where m.created_by = v_me
           and m.deleted_at is null
           and m.created_at >= v_since
        union all
        select p.material_id, p.created_at
          from public.purchases p
         where p.created_by = v_me
           and p.deleted_at is null
           and p.created_at >= v_since
      ) u
     group by u.material_id
     order by 2 desc, 3 desc, 1;
end;
$$;

-- dashboard_summary uchun: tekshiruvchiga qoldiq / harakat / xarid / pul / norma qismlari
-- hisoblanmaydi — hammasi 0 (kalitlar o'zgarmaydi; UI bu rolga InspectorCounts ko'rsatadi).
create function private.dashboard_blind_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kirim_count', 0, 'chiqim_count', 0, 'purchases_count', 0, 'purchases_sum', '0.00',
    'cash_issued_sum', '0.00', 'cash_returned_sum', '0.00', 'cash_on_hand_total', '0.00',
    'cash_outstanding_sum', '0.00', 'cash_owed_to_staff_sum', '0.00',
    'alerts_open', 0, 'alerts_serious_open', 0, 'alerts_new_in_period', 0,
    'unreceived_purchases_count', 0, 'pending_transfers_count', 0, 'pending_requests_count', 0,
    'objects_over_norm_count', 0, 'telegram_blocked_count', null,
    'telegram_me_blocked', coalesce((select p.telegram_blocked_at is not null from public.profiles p
                                      where p.id = private.my_profile_id()), false))
$$;
revoke execute on function private.dashboard_blind_summary() from public, anon;
grant execute on function private.dashboard_blind_summary() to authenticated;

-- S7. photo-hash Edge Function siri (svc_dispatch_secret kabi): x-photo-secret sarlavhasini
-- shu qiymat bilan solishtiradi — alohida function secret kerak emas.
create function public.svc_photo_hash_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
    from vault.decrypted_secrets ds
   where ds.name = 'photo_hash_secret'
   limit 1;
$$;
revoke execute on function public.svc_photo_hash_secret() from public, anon, authenticated;
grant execute on function public.svc_photo_hash_secret() to service_role;
