-- ============================================================================
-- Batch 7 · 01 — smeta Excel importi (shartnoma: docs/estimate-design.md)
--
--   1. estimate_items: unit_id (kompozit FK → material_units), code, row_number.
--      b_compute_norm trigger: material qatorida birlik (shu materialniki,
--      o'chirilmagan) majburiy, norm_qty_base = round(qty * factor, 6) bazada
--      hisoblanadi (klient qiymati e'tiborsiz). Ish qatorida material/birlik yo'q.
--   2. private.unit_is_referenced: estimate_items.unit_id ham hisobga olinadi
--      (ishlatilgan birlikning factor'i o'zgarmaydi → norm_qty_base barqaror).
--   3. estimate_import_templates — firma uchun ustunlarni moslash shablonlari.
--   4. public.import_estimate(...) — bitta tranzaksiyada yangi versiya + qatorlar.
--   5. public.set_current_estimate(p_estimate_id) — boshqa versiyani joriy qilish.
--   6. Indekslar.
--   7. (reviewer) Smetani faqat RPC orqali o'zgartirish: GUC terron.estimate_rpc
--      (RPC ichida 'on'), b_estimates_guard, b_compute_norm boshida tekshiruv —
--      hint estimate_direct_edit. Tiklash to'qnashuvi — estimate_restore_conflict.
--   8. (reviewer) estimates.import_hash — idempotentlik (estimate_id_reused).
--   9. (reviewer) alert turi smeta_ozgarishi + companies.estimate_increase_pct:
--      norm_increase / old_version_restored / current_deleted.
--  10. (reviewer) view public.estimate_totals (security_invoker).
--
-- Oldingi migratsiyalar o'zgartirilmaydi. Xato shakli: errcode + barqaror `hint` +
-- o'zbekcha `message` (docs/db-design.md → "Xato kalitlari").
-- ============================================================================

-- ============================================================================
-- 0. Yangi alert turi (faqat plpgsql ichida, runtime'da ishlatiladi — Batch 5
--    'yozuv_ochirildi' bilan bir xil sabab), firma sozlamasi, import_hash.
-- ============================================================================
alter type public.alert_type add value if not exists 'smeta_ozgarishi';

alter table public.companies
  add column estimate_increase_pct numeric(6,2) not null default 10
    check (estimate_increase_pct >= 0);

alter table public.estimates
  add column import_hash text check (import_hash is null or import_hash ~ '^[0-9a-f]{64}$');

-- RPC (import_estimate, set_current_estimate) ichidami — tranzaksiya-lokal GUC.
-- PostgREST ixtiyoriy SQL / pg_catalog.set_config ni ochmaydi; klient bu GUC ni
-- o'rnata olmaydi. auth.uid() yo'q (service_role, migratsiya, cron) — tizim.
create function private.estimate_rpc_active()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('terron.estimate_rpc', true), '') = 'on'
$$;
revoke execute on function private.estimate_rpc_active() from public, anon;
grant execute on function private.estimate_rpc_active() to authenticated, service_role;

-- ============================================================================
-- 1. estimate_items: yangi ustunlar
-- ============================================================================
alter table public.estimate_items
  add column unit_id    uuid,
  add column code       text check (code is null or length(code) <= 100),
  add column row_number integer check (row_number is null or row_number > 0),
  add constraint estimate_items_unit_fkey
    foreign key (company_id, unit_id) references public.material_units (company_id, id);

-- Qator turi ↔ maydonlar. Mavjud (eski) qatorlar uchun NOT VALID — yangi va
-- o'zgartirilgan qatorlarda tekshiriladi; buzuvchi qator bo'lmasa — VALIDATE.
alter table public.estimate_items
  add constraint estimate_items_kind_check check (
    (item_type = 'ish'
      and material_id is null and unit_id is null and norm_qty_base is null)
    or (item_type = 'material'
      and material_id is not null and unit_id is not null and norm_qty_base is not null)
  ) not valid;

do $$
begin
  if not exists (
    select 1 from public.estimate_items
     where not ((item_type = 'ish' and material_id is null and unit_id is null and norm_qty_base is null)
             or (item_type = 'material' and material_id is not null and unit_id is not null and norm_qty_base is not null))
  ) then
    alter table public.estimate_items validate constraint estimate_items_kind_check;
  else
    raise warning 'estimate_items: eski qatorlar estimate_items_kind_check ga mos emas — constraint NOT VALID qoldi';
  end if;
end $$;

create index estimate_items_company_unit_idx on public.estimate_items (company_id, unit_id);
-- (company_id, estimate_id[, sort_order]) va (company_id, material_id) — Batch 1 da bor.
create index estimates_company_object_current_idx on public.estimates (company_id, object_id, is_current);

-- ----------------------------------------------------------------------------
-- b_compute_norm — Batch 1 tg_compute_qty uslubi.
--   Qulf tartibi: materials → material_units (for share).
--   unit_id berilmasa (qulaylik, to'g'ridan-to'g'ri INSERT uchun): `unit` matni
--   norm_name bo'yicha variantsiz birlik; matn ham bo'lmasa — asosiy birlik.
--   RPC import_estimate har doim unit_id yuboradi.
--   O'chirilgan birlik faqat eski (o'zgarmagan) qatorda qolishi mumkin.
-- Trigger nomi alifbo bo'yicha b_check_material dan keyin ishlaydi.
-- ----------------------------------------------------------------------------
create function private.tg_estimate_items_norm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_id  uuid := new.unit_id;
  v_old_unit uuid;
  v_material uuid;
  v_unit     text;
  v_factor   numeric;
  v_row      text := case when new.row_number is not null then 'Qator ' || new.row_number || ': ' else '' end;
begin
  -- (0) Foydalanuvchi (auth.uid bor): begona firma qatori — RLS'dan oldin rad;
  --     RPC'siz INSERT yo'q; RPC'siz UPDATE — faqat deleted_at (soft delete / tiklash).
  if auth.uid() is not null then
    if not private.is_super_admin()
       and new.company_id is distinct from private.my_company_id() then
      raise exception 'Smeta qatorini o''zgartirishga ruxsat yo''q'
        using errcode = '42501', hint = 'estimate_direct_edit';
    end if;
    if not private.estimate_rpc_active() then
      if tg_op = 'INSERT' then
        raise exception 'Smeta qatorlari faqat smeta importi orqali qo''shiladi'
          using errcode = '42501', hint = 'estimate_direct_edit';
      end if;
      if (to_jsonb(new) - 'deleted_at' - 'updated_at') is distinct from (to_jsonb(old) - 'deleted_at' - 'updated_at') then
        raise exception 'Smeta qatorini tahrirlab bo''lmaydi — yangi versiya yuklang'
          using errcode = '42501', hint = 'estimate_direct_edit';
      end if;
    end if;
  end if;

  if new.item_type = 'ish' then
    if new.material_id is not null or new.unit_id is not null then
      raise exception '%Ish qatorida material va birlik bo''lmaydi', v_row
        using errcode = '23514', hint = 'estimate_item_invalid';
    end if;
    new.norm_qty_base := null;
    return new;
  end if;

  if new.material_id is null then
    raise exception '%Material tanlanmagan', v_row
      using errcode = '23514', hint = 'estimate_item_invalid';
  end if;

  if tg_op = 'UPDATE' then
    v_old_unit := old.unit_id;
  end if;

  -- (1) material qatori qulfi (topilmasa — kompozit FK xato beradi)
  perform 1
     from public.materials m
    where m.company_id = new.company_id
      and m.id = new.material_id
      for share;

  -- (2) unit_id berilmagan bo'lsa — matn bo'yicha yoki asosiy birlik
  if v_unit_id is null then
    if nullif(btrim(new.unit), '') is not null then
      select mu.id into v_unit_id
        from public.material_units mu
       where mu.company_id = new.company_id
         and mu.material_id = new.material_id
         and private.norm_name(mu.unit) = private.norm_name(new.unit)
         and mu.variant is null
         and mu.deleted_at is null;
    else
      select mu.id into v_unit_id
        from public.material_units mu
        join public.materials m on m.company_id = mu.company_id and m.id = mu.material_id
       where mu.company_id = new.company_id
         and mu.material_id = new.material_id
         and mu.unit = m.base_unit
         and mu.factor = 1
         and mu.variant is null
         and mu.deleted_at is null;
    end if;
  end if;

  -- (3) birlik qatorini o'qish va qulflash — bitta so'rov
  select mu.material_id, mu.unit, mu.factor
    into v_material, v_unit, v_factor
    from public.material_units mu
   where mu.company_id = new.company_id
     and mu.id = v_unit_id
     and (mu.deleted_at is null or mu.id = v_old_unit)
     for share;
  if not found then
    raise exception '%Birlik topilmadi yoki o''chirilgan', v_row
      using errcode = '23503', hint = 'ops_unit_not_found';
  end if;
  if v_material is distinct from new.material_id then
    raise exception '%Tanlangan birlik bu materialga tegishli emas', v_row
      using errcode = '23503', hint = 'ops_unit_material_mismatch';
  end if;

  -- (4) hisoblash — qulflangan qatordan; klient norm_qty_base e'tiborsiz
  new.unit_id       := v_unit_id;
  new.unit          := coalesce(nullif(btrim(new.unit), ''), v_unit);
  new.norm_qty_base := round(new.qty * v_factor, 6);
  return new;
end;
$$;

create trigger b_compute_norm before insert or update on public.estimate_items
  for each row execute function private.tg_estimate_items_norm();

-- ============================================================================
-- 2. unit_is_referenced: smeta qatorlari ham (o'chirilganlari ham)
-- ============================================================================
create or replace function private.unit_is_referenced(p_company_id uuid, p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.movements t         where t.company_id = p_company_id and t.unit_id = p_unit_id)
      or exists (select 1 from public.purchases t         where t.company_id = p_company_id and t.unit_id = p_unit_id)
      or exists (select 1 from public.transfers t         where t.company_id = p_company_id and t.unit_id = p_unit_id)
      or exists (select 1 from public.material_requests t where t.company_id = p_company_id and t.unit_id = p_unit_id)
      or exists (select 1 from public.estimate_items t    where t.company_id = p_company_id and t.unit_id = p_unit_id);
$$;

-- ============================================================================
-- 2a. estimates: o'zgarmas ustunlar, RPC'siz yaratish / is_current yo'q,
--     tiklash to'qnashuvi. Nom b_estimates_guard — a_* lardan keyin.
-- ============================================================================
create function private.tg_estimates_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.object_id   is distinct from old.object_id
       or new.version     is distinct from old.version
       or new.import_hash is distinct from old.import_hash) then
    raise exception 'Smetaning obyekti va versiyasi o''zgarmaydi'
      using errcode = '42501', hint = 'estimate_direct_edit';
  end if;

  if auth.uid() is not null and not private.estimate_rpc_active() then
    if tg_op = 'INSERT' then
      raise exception 'Smeta faqat import orqali yaratiladi'
        using errcode = '42501', hint = 'estimate_direct_edit';
    end if;
    -- Istisno: tiklash bilan birga joriylikni olib tashlash (to'qnashuvni hal qilish)
    if new.is_current is distinct from old.is_current
       and not (old.deleted_at is not null and new.deleted_at is null
                and old.is_current and not new.is_current) then
      raise exception 'Joriy versiya faqat "Joriy qilish" orqali o''zgaradi'
        using errcode = '42501', hint = 'estimate_direct_edit';
    end if;
  end if;

  -- Joriy versiyani tiklash: obyektda boshqa joriy versiya bo'lsa — aniq xato
  if tg_op = 'UPDATE'
     and old.deleted_at is not null and new.deleted_at is null and new.is_current
     and exists (
       select 1 from public.estimates e
        where e.company_id = new.company_id
          and e.object_id = new.object_id
          and e.id <> new.id
          and e.is_current
          and e.deleted_at is null
     ) then
    raise exception 'Obyektda boshqa joriy smeta bor — bu versiyani joriy emas holda tiklang'
      using errcode = '23505', hint = 'estimate_restore_conflict';
  end if;
  return new;
end;
$$;

create trigger b_estimates_guard before insert or update on public.estimates
  for each row execute function private.tg_estimates_guard();

-- ----------------------------------------------------------------------------
-- 2b. smeta_ozgarishi alertlari (tizim, security definer).
--   private.estimate_alert(kind, estimate_id, prev_id):
--     'norm_increase'        — import_estimate: yangi versiya vs avvalgi joriy;
--     'old_version_restored' — set_current_estimate: kichik raqamli versiya joriy;
--     'current_deleted'      — joriy versiya soft delete (trigger).
--   Faqat RPC ichida (GUC) yoki trigger'dan chaqiriladi.
-- ----------------------------------------------------------------------------
create function private.estimate_alert(p_kind text, p_estimate_id uuid, p_prev_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_est      public.estimates%rowtype;
  v_prev_ver integer;
  v_pct      numeric;
  v_actor    text := (select p.full_name from public.profiles p where p.id = private.my_profile_id());
  v_list     jsonb;
  v_total    integer;
  v_serious  boolean;
begin
  if p_kind in ('norm_increase', 'old_version_restored') and not private.estimate_rpc_active() then
    raise exception 'estimate_alert: faqat smeta RPC ichida'
      using errcode = '42501', hint = 'estimate_direct_edit';
  end if;

  select * into v_est from public.estimates e where e.id = p_estimate_id;
  if not found then
    return;
  end if;
  select e.version into v_prev_ver from public.estimates e
   where e.company_id = v_est.company_id and e.id = p_prev_id;

  if p_kind = 'current_deleted' then
    insert into public.alerts (company_id, type, severity, object_id, details)
    values (v_est.company_id, 'smeta_ozgarishi', 'ogohlantirish', v_est.object_id,
            jsonb_build_object('kind', 'current_deleted', 'estimate_id', v_est.id,
                               'version', v_est.version, 'actor_name', v_actor));
    return;
  end if;

  if p_kind = 'old_version_restored' then
    if v_prev_ver is null or v_prev_ver <= v_est.version then
      return;
    end if;
    insert into public.alerts (company_id, type, severity, object_id, details)
    values (v_est.company_id, 'smeta_ozgarishi', 'ogohlantirish', v_est.object_id,
            jsonb_build_object('kind', 'old_version_restored', 'estimate_id', v_est.id,
                               'version', v_est.version, 'prev_version', v_prev_ver,
                               'actor_name', v_actor));
    return;
  end if;

  if p_kind <> 'norm_increase' or v_prev_ver is null then
    return;   -- birinchi versiya — solishtiradigan narsa yo'q
  end if;

  select c.estimate_increase_pct into v_pct from public.companies c where c.id = v_est.company_id;

  with cur as (
    select i.material_id, sum(i.norm_qty_base) as q
      from public.estimate_items i
     where i.company_id = v_est.company_id and i.estimate_id = v_est.id
       and i.item_type = 'material' and i.deleted_at is null
     group by i.material_id
  ),
  prev as (
    select i.material_id, sum(i.norm_qty_base) as q
      from public.estimate_items i
     where i.company_id = v_est.company_id and i.estimate_id = p_prev_id
       and i.item_type = 'material' and i.deleted_at is null
     group by i.material_id
  ),
  d as (
    select c.material_id,
           coalesce(p.q, 0) as before,
           c.q as after,
           case when coalesce(p.q, 0) > 0 then round((c.q - p.q) / p.q * 100, 2) end as diff_pct
      from cur c
      left join prev p on p.material_id = c.material_id
  ),
  f as (
    select d.*, m.name as material_name, m.base_unit,
           coalesce((
             select sum(mv.qty_base)
               from public.movements mv
              where mv.company_id = v_est.company_id
                and mv.object_id = v_est.object_id
                and mv.material_id = d.material_id
                and mv.type = 'chiqim'
                and mv.deleted_at is null
           ), 0) as consumed
      from d
      join public.materials m on m.company_id = v_est.company_id and m.id = d.material_id
     where d.before <= 0 or d.after > d.before * (1 + v_pct / 100)
  ),
  r as (
    select f.*, f.consumed > f.before as exceeded_before,
           row_number() over (order by (f.consumed > f.before) desc, f.diff_pct desc nulls first,
                                       f.after - f.before desc, f.material_name) as rn
      from f
  )
  select jsonb_agg(jsonb_build_object(
           'material_id', r.material_id, 'material_name', r.material_name, 'base_unit', r.base_unit,
           'before', r.before, 'after', r.after, 'diff_pct', r.diff_pct,
           'consumed', r.consumed, 'exceeded_before', r.exceeded_before
         ) order by r.rn) filter (where r.rn <= 20),
         count(*)::integer,
         coalesce(bool_or(r.exceeded_before), false)
    into v_list, v_total, v_serious
    from r;

  if v_total = 0 then
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, details)
  values (v_est.company_id, 'smeta_ozgarishi',
          case when v_serious then 'jiddiy' else 'ogohlantirish' end::public.alert_severity,
          v_est.object_id,
          jsonb_build_object('kind', 'norm_increase', 'estimate_id', v_est.id,
                             'version', v_est.version, 'prev_version', v_prev_ver,
                             'materials', v_list, 'more_count', greatest(v_total - 20, 0),
                             'actor_name', v_actor));
end;
$$;

revoke execute on function private.estimate_alert(text, uuid, uuid) from public, anon;
-- invoker RPC'lar chaqiradi; funksiya o'zi GUC ni tekshiradi
grant execute on function private.estimate_alert(text, uuid, uuid) to authenticated;

create function private.tg_estimates_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.estimate_alert('current_deleted', new.id, null);
  return null;
end;
$$;

create trigger zz_estimate_alerts after update on public.estimates
  for each row
  when (old.deleted_at is null and new.deleted_at is not null and old.is_current)
  execute function private.tg_estimates_alerts();

-- ============================================================================
-- 3. estimate_import_templates
-- ============================================================================
create table public.estimate_import_templates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id),
  name              text not null check (btrim(name) <> '' and length(name) <= 120),
  header_signature  text not null check (btrim(header_signature) <> '' and length(header_signature) <= 4000),
  mapping           jsonb not null check (jsonb_typeof(mapping) = 'object'),
  sheet_name        text check (sheet_name is null or length(sheet_name) <= 120),
  header_row        integer not null default 0 check (header_row >= 0),
  last_used_at      timestamptz,
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint estimate_import_templates_company_id_id_key unique (company_id, id)
);
create unique index estimate_import_templates_signature_key
  on public.estimate_import_templates (company_id, header_signature)
  where deleted_at is null;
create index estimate_import_templates_created_by_idx on public.estimate_import_templates (created_by);

create trigger a_block_delete before delete on public.estimate_import_templates
  for each row execute function private.tg_block_delete();
create trigger a_block_truncate before truncate on public.estimate_import_templates
  for each statement execute function private.tg_block_truncate();
create trigger a_before_insert before insert on public.estimate_import_templates
  for each row execute function private.tg_before_insert();
create trigger a_before_update before update on public.estimate_import_templates
  for each row execute function private.tg_before_update();
create trigger z_audit after insert or update on public.estimate_import_templates
  for each row execute function private.audit_row();

alter table public.estimate_import_templates enable row level security;
alter table public.estimate_import_templates force row level security;
revoke all on table public.estimate_import_templates from public, anon, authenticated, service_role;
grant select, insert, update on table public.estimate_import_templates to authenticated;
grant select, insert, update, delete on table public.estimate_import_templates to service_role;

create policy estimate_import_templates_select on public.estimate_import_templates
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter')))
  );

create policy estimate_import_templates_insert on public.estimate_import_templates
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'buxgalter'))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
  );

create policy estimate_import_templates_update on public.estimate_import_templates
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'buxgalter'))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'buxgalter'))
  );

-- ============================================================================
-- 4. public.import_estimate — security invoker (RLS amal qiladi).
--    Bitta statement → bitta tranzaksiya: xato bo'lsa hech narsa yozilmaydi.
-- ============================================================================
create function public.import_estimate(
  p_id               uuid,
  p_object_id        uuid,
  p_title            text,
  p_source_file_name text,
  p_estimate_date    date,
  p_items            jsonb
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c_max_rows constant integer := 5000;
  c_uuid_re  constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_num_re   constant text := '^\s*[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]{1,3})?\s*$';
  v_me       uuid := private.my_profile_id();
  v_company  uuid;
  v_obj_del  timestamptz;
  v_ex_obj   uuid;
  v_title    text := btrim(p_title);
  v_file     text := nullif(btrim(p_source_file_name), '');
  v_n        integer;
  v_rows     jsonb;
  v_err      jsonb;
  v_version  integer;
  v_ex_hash  text;
  v_hash     text;
  v_prev_id  uuid;
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan'
      using errcode = '42501', hint = 'auth_required';
  end if;
  if not private.has_role('super_admin', 'admin', 'buxgalter') then
    raise exception 'Smeta yuklashga ruxsat yo''q'
      using errcode = '42501', hint = 'estimate_import_forbidden';
  end if;
  if p_id is null or p_object_id is null then
    raise exception 'Smeta yoki obyekt ko''rsatilmagan'
      using errcode = '22023', hint = 'estimate_invalid';
  end if;

  -- Obyekt (RLS: boshqa firma obyekti ko'rinmaydi)
  select o.company_id, o.deleted_at into v_company, v_obj_del
    from public.objects o
   where o.id = p_object_id;
  if not found or v_obj_del is not null then
    raise exception 'Obyekt topilmadi'
      using errcode = 'P0002', hint = 'estimate_object_not_found';
  end if;

  -- Obyekt bo'yicha ketma-ketlik: versiya raqami va is_current poygasiz
  perform pg_advisory_xact_lock(hashtextextended('terron.estimate_version:' || p_object_id::text, 0));

  -- Idempotentlik: shu id va shu mazmun (hash) bilan smeta bor bo'lsa — o'sha id.
  -- Hash: obyekt, nom (asl matn), qatorlar — jsonb matni kanonik (kalitlar tartiblangan).
  v_hash := encode(extensions.digest(
              convert_to(jsonb_build_object('object_id', p_object_id, 'title', p_title,
                                            'items', p_items)::text, 'UTF8'),
              'sha256'), 'hex');
  select e.object_id, e.import_hash into v_ex_obj, v_ex_hash
    from public.estimates e
   where e.id = p_id;
  if found then
    if v_ex_obj is distinct from p_object_id then
      raise exception 'Bu smeta id boshqa obyektga tegishli'
        using errcode = '23505', hint = 'estimate_id_conflict';
    end if;
    if v_ex_hash is distinct from v_hash then
      raise exception 'Bu smeta id boshqa mazmun bilan allaqachon ishlatilgan'
        using errcode = '23505', hint = 'estimate_id_reused';
    end if;
    return p_id;
  end if;

  if p_estimate_date is not null
     and (p_estimate_date < date '2000-01-01'
          or p_estimate_date > ((now() at time zone 'Asia/Tashkent')::date + interval '1 year')::date) then
    raise exception 'Smeta sanasi noto''g''ri (01.01.2000 dan bugun + 1 yilgacha)'
      using errcode = '22023', hint = 'estimate_invalid';
  end if;

  if v_title is null or v_title = '' or length(v_title) > 200 then
    raise exception 'Smeta nomi bo''sh yoki juda uzun (200 belgigacha)'
      using errcode = '22023', hint = 'estimate_invalid';
  end if;
  if v_file is not null and length(v_file) > 255 then
    raise exception 'Fayl nomi juda uzun (255 belgigacha)'
      using errcode = '22023', hint = 'estimate_invalid';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Smeta qatorlari ro''yxat bo''lishi kerak'
      using errcode = '22023', hint = 'estimate_invalid';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n = 0 then
    raise exception 'Smetada qator yo''q'
      using errcode = '22023', hint = 'estimate_invalid';
  end if;
  if v_n > c_max_rows then
    raise exception 'Smetada qatorlar juda ko''p: % (ko''pi bilan %)', v_n, c_max_rows
      using errcode = '22023', hint = 'estimate_too_many_rows';
  end if;

  -- Qatorlarni ajratish va tekshirish — bitta so'rov. Kastlar faqat regex'dan
  -- keyin (CASE ichida), shuning uchun noto'g'ri qiymat 22P02 emas, aniq xato beradi.
  with src as (
    select e.ord::integer as idx, e.j
      from jsonb_array_elements(p_items) with ordinality as e(j, ord)
  ),
  t as (
    select s.idx,
           jsonb_typeof(s.j) = 'object'                         as is_obj,
           case when jsonb_typeof(s.j) = 'object' then s.j end  as j
      from src s
  ),
  f as (
    select t.idx, t.is_obj,
           t.j ->> 'item_type'                         as item_type,
           btrim(t.j ->> 'name')                       as name,
           nullif(btrim(t.j ->> 'unit'), '')           as unit,
           nullif(btrim(t.j ->> 'code'), '')           as code,
           nullif(btrim(t.j ->> 'material_id'), '')    as mat_t,
           nullif(btrim(t.j ->> 'unit_id'), '')        as unit_t,
           t.j ->> 'qty'                               as qty_t,
           nullif(btrim(t.j ->> 'unit_price'), '')     as price_t,
           t.j ->> 'row_number'                        as rn_t,
           t.j ->> 'sort_order'                        as so_t
      from t
  ),
  p as (
    select f.*,
           case when f.mat_t  ~ c_uuid_re then f.mat_t::uuid end                      as material_id,
           case when f.unit_t ~ c_uuid_re then f.unit_t::uuid end                     as unit_id,
           case when f.qty_t   ~ c_num_re then f.qty_t::numeric end                   as qty,
           case when f.price_t ~ c_num_re then f.price_t::numeric end                 as unit_price,
           case when f.rn_t ~ '^\s*[0-9]{1,9}\s*$' then f.rn_t::integer end           as row_number,
           case when f.so_t ~ '^\s*-?[0-9]{1,9}\s*$' then f.so_t::integer end         as sort_order
      from f
  ),
  v as (
    select p.*,
           m.id as m_id, m.name as m_name, m.deleted_at as m_deleted,
           u.id as u_id, u.material_id as u_material, u.deleted_at as u_deleted,
           case
             when not p.is_obj then 'qator noto''g''ri formatda'
             when p.item_type is null or p.item_type not in ('ish', 'material')
               then 'turi «ish» yoki «material» bo''lishi kerak'
             when p.name is null or p.name = '' then 'nomi bo''sh'
             when length(p.name) > 1000 then 'nomi juda uzun (1000 belgigacha)'
             when p.qty_t is null then 'miqdor ko''rsatilmagan'
             when p.qty is null then 'miqdor raqam emas'
             when round(p.qty, 6) <= 0 then 'miqdor 0 dan katta bo''lishi kerak'
             when p.qty >= 1e14 then 'miqdor juda katta'
             when p.price_t is not null and p.unit_price is null then 'narx raqam emas'
             when p.unit_price < 0 then 'narx manfiy bo''lishi mumkin emas'
             when p.unit_price >= 1e16 then 'narx juda katta'
             when p.unit is not null and length(p.unit) > 50 then 'birlik matni juda uzun (50 belgigacha)'
             when p.code is not null and length(p.code) > 100 then 'shifr juda uzun (100 belgigacha)'
             when p.rn_t is not null and (p.row_number is null or p.row_number < 1) then 'qator raqami noto''g''ri'
             when p.so_t is not null and p.sort_order is null then 'tartib raqami noto''g''ri'
             when p.item_type = 'ish' and (p.mat_t is not null or p.unit_t is not null)
               then 'ish qatorida material va birlik bo''lmaydi'
             when p.item_type = 'ish' then null
             when p.mat_t is null then 'material tanlanmagan'
             when m.id is null then 'material topilmadi'
             when m.deleted_at is not null then 'material o''chirilgan: ' || m.name
             when p.unit_t is null then 'birlik tanlanmagan'
             when u.id is null or u.deleted_at is not null then 'birlik topilmadi yoki o''chirilgan'
             when u.material_id is distinct from m.id then 'birlik bu materialga tegishli emas'
             when round(p.qty * u.factor, 6) >= 1e14 then 'asosiy birlikdagi miqdor juda katta'
           end as err
      from p
      left join public.materials m
        on p.item_type = 'material' and m.company_id = v_company and m.id = p.material_id
      left join public.material_units u
        on p.item_type = 'material' and u.company_id = v_company and u.id = p.unit_id
  )
  select
    jsonb_agg(jsonb_build_object(
      'idx', v.idx, 'item_type', v.item_type, 'name', v.name,
      'material_id', case when v.item_type = 'material' then v.material_id end,
      'unit_id',     case when v.item_type = 'material' then v.unit_id end,
      'unit', v.unit, 'qty', v.qty, 'unit_price', v.unit_price, 'code', v.code,
      'row_number', v.row_number, 'sort_order', coalesce(v.sort_order, v.idx)
    ) order by v.idx),
    (array_agg(jsonb_build_object('idx', v.idx, 'err', v.err,
                                  'row_number', case when v.row_number >= 1 then v.row_number end)
               order by v.idx)
       filter (where v.err is not null))[1]
  into v_rows, v_err
  from v;

  if v_err is not null then
    raise exception 'Qator %: %',
        coalesce(v_err ->> 'row_number', '#' || (v_err ->> 'idx')), v_err ->> 'err'
      using errcode = '22023', hint = 'estimate_item_invalid',
            detail = coalesce(v_err ->> 'row_number', v_err ->> 'idx');
  end if;

  -- Bundan keyin smeta jadvallariga yozish — RPC nomidan (guard triggerlar uchun)
  perform set_config('terron.estimate_rpc', 'on', true);

  -- Avvalgi joriy (o'chirilmagan) versiya — norma oshishi alerti uchun
  select e.id into v_prev_id
    from public.estimates e
   where e.company_id = v_company
     and e.object_id = p_object_id
     and e.is_current
     and e.deleted_at is null;

  -- Versiya: shu obyektdagi barcha (o'chirilganlari ham) versiyalardan keyingi
  select coalesce(max(e.version), 0) + 1 into v_version
    from public.estimates e
   where e.company_id = v_company
     and e.object_id = p_object_id;

  update public.estimates e
     set is_current = false
   where e.company_id = v_company
     and e.object_id = p_object_id
     and e.is_current;

  insert into public.estimates
    (id, company_id, object_id, version, title, estimate_date, source_file_name, is_current, import_hash, created_by)
  values
    (p_id, v_company, p_object_id, v_version, v_title, p_estimate_date, v_file, true, v_hash, v_me);

  -- Qulf tartibi (docs/db-design.md): qatorlar material id tartibida yoziladi
  insert into public.estimate_items
    (company_id, estimate_id, item_type, name, material_id, unit_id, unit, qty, unit_price,
     code, row_number, sort_order, created_by)
  select v_company, p_id, r.item_type::public.estimate_item_type, r.name, r.material_id, r.unit_id,
         r.unit, r.qty, r.unit_price, r.code, r.row_number, r.sort_order, v_me
    from jsonb_to_recordset(v_rows) as r(
           idx integer, item_type text, name text, material_id uuid, unit_id uuid, unit text,
           qty numeric, unit_price numeric, code text, row_number integer, sort_order integer)
   order by r.material_id nulls first, r.idx;

  perform private.estimate_alert('norm_increase', p_id, v_prev_id);

  perform set_config('terron.estimate_rpc', 'off', true);
  return p_id;
end;
$$;

revoke execute on function public.import_estimate(uuid, uuid, text, text, date, jsonb) from public, anon;
grant execute on function public.import_estimate(uuid, uuid, text, text, date, jsonb) to authenticated;

-- ============================================================================
-- 5. public.set_current_estimate — boshqa versiyani joriy qilish
-- ============================================================================
create function public.set_current_estimate(p_estimate_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_me      uuid := private.my_profile_id();
  v_company uuid;
  v_object  uuid;
  v_prev_id uuid;
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan'
      using errcode = '42501', hint = 'auth_required';
  end if;
  if not private.has_role('super_admin', 'admin', 'buxgalter') then
    raise exception 'Joriy smetani o''zgartirishga ruxsat yo''q'
      using errcode = '42501', hint = 'estimate_import_forbidden';
  end if;

  select e.company_id, e.object_id into v_company, v_object
    from public.estimates e
   where e.id = p_estimate_id
     and e.deleted_at is null;
  if not found then
    raise exception 'Smeta topilmadi'
      using errcode = 'P0002', hint = 'estimate_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('terron.estimate_version:' || v_object::text, 0));
  perform set_config('terron.estimate_rpc', 'on', true);

  -- Avvalgi joriy (o'chirilmagan, boshqa) versiya — alert uchun
  select e.id into v_prev_id
    from public.estimates e
   where e.company_id = v_company
     and e.object_id = v_object
     and e.is_current
     and e.deleted_at is null
     and e.id <> p_estimate_id;

  update public.estimates e
     set is_current = false
   where e.company_id = v_company
     and e.object_id = v_object
     and e.is_current
     and e.id <> p_estimate_id;

  update public.estimates e
     set is_current = true
   where e.id = p_estimate_id
     and e.deleted_at is null
     and not e.is_current;

  if v_prev_id is not null then
    perform private.estimate_alert('old_version_restored', p_estimate_id, v_prev_id);
  end if;

  perform set_config('terron.estimate_rpc', 'off', true);
end;
$$;

revoke execute on function public.set_current_estimate(uuid) from public, anon;
grant execute on function public.set_current_estimate(uuid) to authenticated;

revoke execute on function private.tg_estimate_items_norm() from public, anon, authenticated;

-- ============================================================================
-- 6. public.estimate_totals — smeta bo'yicha jami (security_invoker: RLS chaqiruvchi
--    huquqida). O'chirilmagan qatorlar; total_sum = Σ round(qty * unit_price, 2).
-- ============================================================================
create view public.estimate_totals
with (security_invoker = true) as
select e.id         as estimate_id,
       e.company_id,
       e.object_id,
       count(i.id)::integer                                   as row_count,
       count(distinct i.material_id)::integer                 as material_count,
       coalesce(sum(round(i.qty * i.unit_price, 2)), 0)::numeric(20,2) as total_sum
  from public.estimates e
  left join public.estimate_items i
    on i.company_id = e.company_id
   and i.estimate_id = e.id
   and i.deleted_at is null
 group by e.id, e.company_id, e.object_id;

revoke all on public.estimate_totals from public, anon, authenticated, service_role;
grant select on public.estimate_totals to authenticated, service_role;

revoke execute on function
  private.tg_estimates_guard(),
  private.tg_estimates_alerts()
from public, anon, authenticated;
