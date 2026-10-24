-- ============================================================================
-- Batch 1 · 04 — audit_log, umumiy triggerlar (soft delete, o'zgarmas ustunlar,
-- created_by, updated_at) va ularni barcha biznes jadvallarga ulash.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- audit_log
-- ----------------------------------------------------------------------------
create table public.audit_log (
  id                bigint generated always as identity primary key,
  company_id        uuid not null references public.companies (id),
  table_name        text not null,
  record_id         uuid not null,
  action            text not null check (action in ('INSERT', 'UPDATE', 'SOFT_DELETE', 'RESTORE')),
  old_data          jsonb,
  new_data          jsonb,
  changed_fields    text[],
  actor_profile_id  uuid,          -- FK yo'q: audit hech qachon bloklanmasin
  actor_auth_uid    uuid,
  device            text check (device in ('veb', 'mobil', 'tizim')),
  created_at        timestamptz not null default now()
);
create index audit_log_company_time_idx on public.audit_log (company_id, created_at desc);
create index audit_log_record_idx       on public.audit_log (table_name, record_id, created_at desc);
create index audit_log_actor_idx        on public.audit_log (company_id, actor_profile_id, created_at desc);

-- audit_log o'zgarmaydi va o'chirilmaydi (service_role va egasi uchun ham)
create function private.tg_audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only (% blocked)', tg_op
    using errcode = '42501';
end;
$$;

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function private.tg_audit_log_immutable();

-- TRUNCATE (DELETE triggerini chetlab o'tadi) — biznes jadvallar va audit_log da taqiqlangan
create function private.tg_block_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'truncate is not allowed on %', tg_table_name
    using errcode = '42501';
end;
$$;

create trigger a_block_truncate
  before truncate on public.audit_log
  for each statement execute function private.tg_block_truncate();

-- ----------------------------------------------------------------------------
-- Umumiy trigger funksiyalari
-- ----------------------------------------------------------------------------

-- Haqiqiy DELETE taqiqlangan — faqat soft delete (deleted_at)
create function private.tg_block_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'soft delete only: % (set deleted_at instead of DELETE)', tg_table_name
    using errcode = '42501';
end;
$$;

-- INSERT: created_by bo'sh bo'lsa — joriy profil; created_at/updated_at — server vaqti
create function private.tg_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is null then
    new.created_by := private.my_profile_id();
  end if;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

-- UPDATE: id/company_id/created_by/created_at o'zgarmaydi; tiklash faqat admin;
-- updated_at — server vaqti
create function private.tg_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception '%.id cannot be changed', tg_table_name using errcode = '42501';
  end if;
  -- companies jadvalida company_id ustuni yo'q — jsonb orqali umumiy tekshiruv
  if to_jsonb(new) -> 'company_id' is distinct from to_jsonb(old) -> 'company_id' then
    raise exception '%.company_id cannot be changed', tg_table_name using errcode = '42501';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception '%.created_by cannot be changed', tg_table_name using errcode = '42501';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception '%.created_at cannot be changed', tg_table_name using errcode = '42501';
  end if;
  -- O'chirilgan yozuvni tiklash (deleted_at -> null) faqat admin / super_admin.
  -- auth.uid() bo'lmasa (service_role, migratsiya, cron) — ruxsat.
  if old.deleted_at is not null and new.deleted_at is null
     and auth.uid() is not null
     and not private.has_role('super_admin', 'admin') then
    raise exception 'only admin can restore deleted records (%)', tg_table_name using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- companies: is_active va deleted_at ni faqat super_admin o'zgartiradi
create function private.tg_companies_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.is_super_admin()
     and (new.is_active is distinct from old.is_active
          or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'only super_admin can change companies.is_active / deleted_at' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Audit: har INSERT/UPDATE audit_log ga (DELETE bloklangan, shuning uchun yozilmaydi)
create function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new      jsonb := to_jsonb(new);
  v_old      jsonb;
  v_action   text;
  v_changed  text[];
  v_uid      uuid := auth.uid();
  v_device   text;
  v_header   text;
  v_company  uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'INSERT';
  else
    v_old := to_jsonb(old);
    select coalesce(array_agg(k order by k), '{}'::text[])
      into v_changed
      from jsonb_object_keys(v_new) as k
     where k <> 'updated_at'
       and v_new -> k is distinct from v_old -> k;
    -- faqat updated_at o'zgargan (yoki hech narsa) — yozmaymiz
    if cardinality(v_changed) = 0 then
      return null;
    end if;
    v_action := case
      when v_old ->> 'deleted_at' is null and v_new ->> 'deleted_at' is not null then 'SOFT_DELETE'
      when v_old ->> 'deleted_at' is not null and v_new ->> 'deleted_at' is null then 'RESTORE'
      else 'UPDATE'
    end;
  end if;

  if v_uid is null then
    v_device := 'tizim';
  else
    begin
      v_header := nullif(current_setting('request.headers', true), '')::json ->> 'x-client-device';
    exception when others then
      v_header := null;
    end;
    v_device := case when v_header in ('veb', 'mobil') then v_header end;
  end if;

  v_company := case when tg_table_name = 'companies'
                    then (v_new ->> 'id')::uuid
                    else (v_new ->> 'company_id')::uuid end;

  insert into public.audit_log
    (company_id, table_name, record_id, action, old_data, new_data,
     changed_fields, actor_profile_id, actor_auth_uid, device)
  values
    (v_company, tg_table_name, (v_new ->> 'id')::uuid, v_action, v_old, v_new,
     v_changed, private.my_profile_id(), v_uid, v_device);

  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- Triggerlarni barcha biznes jadvallarga ulash.
-- Nomlar tartibi muhim (bir xil vaqtdagi triggerlar alifbo tartibida ishlaydi):
-- a_* — umumiy, b_* — jadvalga xos, z_audit — oxirida.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'profiles', 'objects', 'object_members',
    'materials', 'material_units', 'material_aliases', 'suppliers',
    'cash_advances', 'purchases', 'transfers',
    'inventory_counts', 'inventory_count_items',
    'estimates', 'estimate_items', 'material_requests',
    'movements', 'alerts'
  ] loop
    execute format('create trigger a_block_delete before delete on public.%I
                      for each row execute function private.tg_block_delete()', t);
    execute format('create trigger a_block_truncate before truncate on public.%I
                      for each statement execute function private.tg_block_truncate()', t);
    execute format('create trigger a_before_insert before insert on public.%I
                      for each row execute function private.tg_before_insert()', t);
    execute format('create trigger a_before_update before update on public.%I
                      for each row execute function private.tg_before_update()', t);
    execute format('create trigger z_audit after insert or update on public.%I
                      for each row execute function private.audit_row()', t);
  end loop;
end $$;

create trigger b_companies_guard
  before update on public.companies
  for each row execute function private.tg_companies_guard();

-- Trigger funksiyalarini to'g'ridan-to'g'ri chaqirib bo'lmaydi, lekin baribir yopamiz
revoke execute on function
  private.tg_audit_log_immutable(),
  private.tg_block_delete(),
  private.tg_block_truncate(),
  private.tg_before_insert(),
  private.tg_before_update(),
  private.tg_companies_guard(),
  private.audit_row()
from public, anon, authenticated;
