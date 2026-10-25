-- ============================================================================
-- Batch 11 · 01 — topshirish: "Xatolik haqida xabar berish"
-- (shartnoma: docs/handoff-design.md, 1-bo'lim; payload — "Bildirishnoma payloadi
-- (bug_report)")
--
--   1. public.bug_reports — foydalanuvchi xabari (biznes jadvali: audit, soft
--      delete, a_* triggerlar, RLS enable + force, kompozit FK).
--   2. b_bug_reports_guard — created_by / status / company_id serverdan, matn
--      normallashtirish (bug_report_invalid), cheklov 10 daqiqada ≤ 5 ta
--      (bug_report_rate_limited), rasm yo'li (ops_photo_* hint'lari).
--   3. Storage: photos_insert / photos_select qayta yaratildi — skrinshot yo'li
--      {company_id}/bug/{yyyy}/{mm}/{uuid}.{ext}: istalgan faol foydalanuvchi o'z
--      firmasi papkasiga yuklaydi; ko'radi — o'zi, firma admini, super_admin.
--      Boshqa (operatsiya) rasmlari uchun shartlar o'zgarmagan.
--   4. notification_outbox: kind 'bug_report' + bug_report_id; zz_notify trigger;
--      svc_outbox_recipients (create or replace) — firma admin(lar)i + barcha
--      super_admin'lar.
--
-- Tiklash oq ro'yxatiga (private.history_tables / restore_record) KIRMAYDI —
-- alerts va receipt_lookups kabi ish oqimi (holat) jadvali; admin o'chirgan
-- xabarni to'g'ridan-to'g'ri `update ... set deleted_at = null` bilan tiklay oladi
-- (RLS + a_before_update: tiklash faqat admin).
--
-- Oldingi migratsiyalar o'zgartirilmaydi. Xato shakli: errcode + barqaror `hint` +
-- o'zbekcha `message` (docs/db-design.md → "Xato kalitlari").
-- ============================================================================

-- ============================================================================
-- 1. Jadval
-- ============================================================================
create table public.bug_reports (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id),
  message      text not null
               constraint bug_reports_message_check check (char_length(message) between 1 and 2000),
  screen       text constraint bug_reports_screen_check check (char_length(screen) <= 200),
  client       text constraint bug_reports_client_check check (char_length(client) <= 500),
  app_version  text constraint bug_reports_app_version_check check (char_length(app_version) <= 50),
  photo_path   text constraint bug_reports_photo_path_check
               check (photo_path ~ '^[0-9a-f-]{36}/bug/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'),
  status       text not null default 'yangi'
               constraint bug_reports_status_check check (status in ('yangi', 'korildi', 'hal_qilindi')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint bug_reports_company_id_id_key unique (company_id, id),
  -- Xabar har doim o'z firmasiga yoziladi (super_admin ham) — shuning uchun kompozit FK.
  constraint bug_reports_created_by_fkey foreign key (company_id, created_by)
    references public.profiles (company_id, id)
);

comment on table public.bug_reports is
  'Mini App / veb: "Xatolik haqida xabar berish". Holat: yangi → korildi → hal_qilindi (admin).';

create index bug_reports_company_time_idx on public.bug_reports (company_id, created_at desc);
create index bug_reports_company_status_idx on public.bug_reports (company_id, status)
  where deleted_at is null;
create index bug_reports_company_created_by_idx on public.bug_reports (company_id, created_by, created_at desc);
create index bug_reports_company_deleted_idx on public.bug_reports (company_id, deleted_at)
  where deleted_at is not null;
create unique index bug_reports_photo_path_key on public.bug_reports (photo_path)
  where photo_path is not null and deleted_at is null;

-- Umumiy triggerlar (Batch 1 tartibi: a_* → b_* → z_audit → zz_*)
create trigger a_block_delete before delete on public.bug_reports
  for each row execute function private.tg_block_delete();
create trigger a_block_truncate before truncate on public.bug_reports
  for each statement execute function private.tg_block_truncate();
create trigger a_before_insert before insert on public.bug_reports
  for each row execute function private.tg_before_insert();
create trigger a_before_update before update on public.bug_reports
  for each row execute function private.tg_before_update();
create trigger z_audit after insert or update on public.bug_reports
  for each row execute function private.audit_row();

-- ============================================================================
-- 2. Guard (BEFORE INSERT OR UPDATE, security definer — storage.objects va
--    boshqa foydalanuvchilar xabarlarini RLS'siz o'qiydi).
--
--   Foydalanuvchi sessiyasida (auth.uid() bor), INSERT:
--     company_id null → my_company_id(); created_by := my_profile_id();
--     status := 'yangi'; deleted_at := null (klient qiymati e'tiborga olinmaydi).
--     Cheklov: shu profil oxirgi 10 daqiqada (created_at, o'chirilganlari ham)
--     5 ta xabar yozgan bo'lsa — 23514 bug_report_rate_limited. Profil bo'yicha
--     advisory lock — parallel so'rovlar navbat bilan. Mavjud id bilan qayta
--     yuborish cheklovga tushmaydi — 23505 bug_reports_pkey (idempotent retry).
--   Hamma uchun (INSERT yoki ustun o'zgarganda):
--     message — btrim; bo'sh yoki > 2000 → 23514 bug_report_invalid;
--     screen / client / app_version — btrim, bo'sh → null, uzunligi kesiladi
--     (200 / 500 / 50) — avtomatik to'ldiriladigan maydonlar xato bermaydi.
--   Rasm (photo_path): bo'sh → null; INSERT yoki yo'l o'zgarganda —
--     format ({company_id}/bug/{yyyy}/{mm}/{uuid}.{ext}) → ops_photo_path_format;
--     birinchi papka = company_id → ops_photo_path_company;
--     foydalanuvchi sessiyasida (admin ham) — storage.objects da bor, o'zi
--     yuklagan (owner_id), 24 soatdan yangi → aks holda 42501 ops_photo_not_owned;
--     INSERT, yo'l o'zgarishi yoki tiklashda — bitta yo'l bitta tirik xabarda
--     → 23505 ops_photo_reused (zaxira — bug_reports_photo_path_key).
--   UPDATE'da matn ustunlarini authenticated o'zgartira olmaydi (ustun grantlari:
--   faqat status, deleted_at); status — RLS bo'yicha faqat admin / super_admin.
-- ============================================================================
create function private.tg_bug_reports_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_me      uuid;
  v_n       integer;
  v_changed boolean;
  v_revived boolean := false;
begin
  if tg_op = 'INSERT' and v_uid is not null then
    v_me := private.my_profile_id();
    new.company_id := coalesce(new.company_id, private.my_company_id());
    new.created_by := v_me;
    new.status     := 'yangi';
    new.deleted_at := null;

    if v_me is not null then
      perform pg_advisory_xact_lock(hashtextextended('terron.bug_report:' || v_me::text, 0));
      select count(*)::integer into v_n
        from public.bug_reports b
       where b.company_id = new.company_id
         and b.created_by = v_me
         and b.created_at > now() - interval '10 minutes';
      -- Shu id bilan qayta yuborish (javob yo'qolgan) — cheklov emas, pkey to'qnashuvi
      -- (bug_reports_pkey) chiqsin: klient uni "saqlangan" deb qabul qiladi.
      if v_n >= 5 and not exists (select 1 from public.bug_reports b where b.id = new.id) then
        raise exception 'Juda ko''p xabar yuborildi — 10 daqiqadan keyin qayta urinib ko''ring'
          using errcode = '23514', hint = 'bug_report_rate_limited';
      end if;
    end if;
  end if;

  -- Matn maydonlari
  if tg_op = 'INSERT'
     or new.message is distinct from old.message
     or new.screen is distinct from old.screen
     or new.client is distinct from old.client
     or new.app_version is distinct from old.app_version then
    new.message := btrim(new.message);
    if new.message is null or new.message = '' or char_length(new.message) > 2000 then
      raise exception 'Xabar matni 1 dan 2000 belgigacha bo''lishi kerak'
        using errcode = '23514', hint = 'bug_report_invalid';
    end if;
    new.screen      := left(nullif(btrim(new.screen), ''), 200);
    new.client      := left(nullif(btrim(new.client), ''), 500);
    new.app_version := left(nullif(btrim(new.app_version), ''), 50);
  end if;

  -- Rasm yo'li
  if new.photo_path is not null and btrim(new.photo_path) = '' then
    new.photo_path := null;
  end if;
  if new.photo_path is null then
    return new;
  end if;

  v_changed := tg_op = 'INSERT' or new.photo_path is distinct from old.photo_path;
  if tg_op = 'UPDATE' then
    v_revived := old.deleted_at is not null and new.deleted_at is null;
  end if;
  if not v_changed and not v_revived then
    return new;
  end if;

  if v_changed then
    if new.photo_path !~ '^[0-9a-f-]{36}/bug/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$' then
      raise exception 'Rasm yo''li noto''g''ri formatda'
        using errcode = '23514', hint = 'ops_photo_path_format';
    end if;
    if split_part(new.photo_path, '/', 1) <> new.company_id::text then
      raise exception 'Rasm boshqa firma papkasida — uni bu xabarga biriktirib bo''lmaydi'
        using errcode = '23514', hint = 'ops_photo_path_company';
    end if;
    if v_uid is not null and not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'photos'
         and o.name = new.photo_path
         and o.owner_id = v_uid::text
         and o.created_at > now() - interval '24 hours'
    ) then
      raise exception 'Rasm topilmadi yoki uni siz yuklamagansiz (rasm 24 soat ichida biriktirilishi kerak)'
        using errcode = '42501', hint = 'ops_photo_not_owned';
    end if;
  end if;

  if new.deleted_at is null then
    perform pg_advisory_xact_lock(hashtextextended('terron.photo_path:' || new.photo_path, 0));
    if exists (select 1 from public.bug_reports b
                where b.photo_path = new.photo_path and b.deleted_at is null and b.id <> new.id) then
      raise exception 'Bu rasm boshqa xabarga biriktirilgan — yangi rasm yuklang'
        using errcode = '23505', hint = 'ops_photo_reused';
    end if;
  end if;
  return new;
end;
$$;

create trigger b_bug_reports_guard before insert or update on public.bug_reports
  for each row execute function private.tg_bug_reports_guard();

-- ============================================================================
-- 3. RLS
--   SELECT: o'zi yozgan (o'chirilmagan) xabarlar; admin — firmaning hammasi
--           (o'chirilganlari ham); super_admin — barcha firmalar.
--   INSERT: faol foydalanuvchi, faqat o'z firmasiga (super_admin ham),
--           created_by = o'zi, status = 'yangi', deleted_at null (guard qo'yadi).
--   UPDATE: admin (o'z firmasi), super_admin — holat va soft delete / tiklash.
--   DELETE: yo'q.
-- ============================================================================
alter table public.bug_reports enable row level security;
alter table public.bug_reports force row level security;

create policy bug_reports_select on public.bug_reports
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (
      (select private.has_role('super_admin', 'admin'))
      or (created_by = (select private.my_profile_id()) and deleted_at is null)
    )
  );

create policy bug_reports_insert on public.bug_reports
  for insert to authenticated
  with check (
    company_id = (select private.my_company_id())
    and created_by = (select private.my_profile_id())
    and status = 'yangi'
    and deleted_at is null
  );

create policy bug_reports_update on public.bug_reports
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  );

revoke all on public.bug_reports from public, anon, authenticated, service_role;
grant select on public.bug_reports to authenticated;
grant insert (id, company_id, message, screen, client, app_version, photo_path)
  on public.bug_reports to authenticated;
grant update (status, deleted_at) on public.bug_reports to authenticated;
grant select, insert, update on public.bug_reports to service_role;

-- ============================================================================
-- 4. Storage: skrinshot yo'li {company_id}/bug/{yyyy}/{mm}/{uuid}.{ext}.
--    Siyosatlar soni o'zgarmaydi (photos_insert, photos_select) — qayta yaratildi.
--    Operatsiya rasmlari ({company_id}/{yyyy}/{mm}/...) uchun shartlar Batch 4
--    dagi bilan aynan bir xil.
-- ============================================================================
drop policy photos_insert on storage.objects;
create policy photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select private.my_company_id())::text
    and (
      (
        name ~ '^[0-9a-f-]{36}/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
        and (select private.has_role('super_admin', 'admin', 'prorab', 'omborchi', 'haydovchi', 'taminotchi'))
      )
      -- Xatolik skrinshoti: istalgan faol foydalanuvchi (my_company_id() null emas)
      or name ~ '^[0-9a-f-]{36}/bug/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
    )
  );

drop policy photos_select on storage.objects;
create policy photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (
      (select private.is_super_admin())
      or (
        (storage.foldername(objects.name))[1] = (select private.my_company_id())::text
        and case
              -- Skrinshot: faqat yuklagan odam va firma admini
              when (storage.foldername(objects.name))[2] = 'bug' then
                (select private.has_role('admin'))
                or objects.owner_id = (select auth.uid())::text
              else
                (select private.is_company_wide())
                or objects.owner_id = (select auth.uid())::text
                or exists (select 1 from public.movements m where m.photo_path = objects.name)
                or exists (select 1 from public.purchases p where p.receipt_photo_path = objects.name)
            end
      )
    )
  );

-- ============================================================================
-- 5. Bildirishnoma: notification_outbox kind 'bug_report'.
--    bug_report_id — FK (company_id, bug_report_id) → bug_reports; xabar bo'yicha
--    bitta qator (unique). Payload — docs/handoff-design.md.
-- ============================================================================
alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox drop constraint notification_outbox_kind_ref_check;
alter table public.notification_outbox
  add column bug_report_id uuid,
  add constraint notification_outbox_bug_report_fkey foreign key (company_id, bug_report_id)
    references public.bug_reports (company_id, id),
  add constraint notification_outbox_kind_check
    check (kind in ('alert', 'daily_report', 'alert_reminder', 'request_overdue', 'cash_statement', 'bug_report')),
  add constraint notification_outbox_kind_ref_check check (
    (kind in ('alert', 'alert_reminder') and alert_id is not null and report_date is null and profile_id is null)
    or (kind in ('daily_report', 'request_overdue') and report_date is not null and alert_id is null and profile_id is null)
    or (kind = 'cash_statement' and report_date is not null and alert_id is null and profile_id is not null)
    or (kind = 'bug_report' and alert_id is null and report_date is null and profile_id is null)
  ),
  add constraint notification_outbox_bug_report_ref_check
    check ((kind = 'bug_report') = (bug_report_id is not null));

create unique index notification_outbox_bug_report_key
  on public.notification_outbox (bug_report_id) where kind = 'bug_report';

-- AFTER INSERT: tirik xabar → outbox (+ uyg'otish). Ismlar shu paytdagi holatda.
create function private.tg_bug_reports_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text;
  v_name    text;
  v_role    text;
begin
  if new.deleted_at is not null then
    return null;
  end if;
  select c.name into v_company from public.companies c where c.id = new.company_id;
  if new.created_by is not null then
    select p.full_name, p.role::text into v_name, v_role
      from public.profiles p
     where p.company_id = new.company_id and p.id = new.created_by;
  end if;

  insert into public.notification_outbox (company_id, kind, bug_report_id, payload)
  values (
    new.company_id, 'bug_report', new.id,
    jsonb_build_object(
      'bug_report_id',     new.id,
      'company_id',        new.company_id,
      'company_name',      v_company,
      'reporter_id',       new.created_by,
      'reporter_name',     v_name,
      'reporter_role',     v_role,
      'screen',            new.screen,
      'message',           left(new.message, 500),
      'message_truncated', char_length(new.message) > 500,
      'client',            new.client,
      'app_version',       new.app_version,
      'has_photo',         new.photo_path is not null,
      'created_at',        new.created_at
    )
  )
  on conflict (bug_report_id) where kind = 'bug_report' do nothing;

  if found then
    perform private.wake_dispatch();
  end if;
  return null;
end;
$$;

create trigger zz_notify after insert on public.bug_reports
  for each row execute function private.tg_bug_reports_notify();

-- Qabul qiluvchilar (Batch 12 versiyasi + bug_report). Faol firma, faol o'chirilmagan
-- profil, Telegram chat bog'langan; bitta chat — bir marta.
--   cash_statement  → faqat profile_id;
--   request_overdue → taminotchi, admin;
--   bug_report      → xabar firmasining admin(lar)i va BARCHA super_admin'lar
--                     (tizim egasi; profili qaysi firmada bo'lishidan qat'i nazar,
--                     o'sha firma ham faol bo'lishi shart);
--   qolganlari      → direktor, admin; alert otkazma_farqi / not_received bo'lsa — jo'natuvchi
--                     va qabul qiluvchi obyektlarning prorab a'zolari ham.
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
     and case o.kind
           when 'cash_statement'  then p.id = o.profile_id
           when 'request_overdue' then p.company_id = o.company_id and p.role in ('taminotchi', 'admin')
           when 'bug_report'      then p.role = 'super_admin'
                                       or (p.company_id = o.company_id and p.role = 'admin')
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
-- 6. Ruxsatlar
-- ============================================================================
revoke execute on function
  private.tg_bug_reports_guard(),
  private.tg_bug_reports_notify()
from public, anon, authenticated, service_role;

-- create or replace grantlarni saqlaydi; aniqlik uchun takrorlanadi.
revoke execute on function public.svc_outbox_recipients(uuid) from public, anon, authenticated;
grant execute on function public.svc_outbox_recipients(uuid) to service_role;
