-- ============================================================================
-- Batch 10 · 01 — o'zgarishlar tarixi va tiklash (shartnoma: docs/history-design.md)
--
--   1. Indekslar: audit_log (company_id, id desc), (company_id, table_name,
--      record_id, id desc), (company_id, actor_profile_id, id desc); o'chirilgan
--      qatorlar uchun partial (company_id, deleted_at) — katta jadvallarda.
--   2. private.history_tables() — tiklash / "O'chirilganlar" oq ro'yxati.
--   3. private.history_num / history_money — yorliq uchun son formatlash.
--   4. private.audit_record_label(table, record_id, new_data, old_data) — invoker:
--      faqat yozuvning o'z qiymatlari + RLS bo'yicha ko'rinadigan nomlar; boshqa
--      firma (can_access_company = false) — null.
--   5. public.audit_feed(...)       — invoker (audit_log RLS), keyset sahifalash.
--   6. public.deleted_records(...)  — invoker (biznes jadvallar RLS), oq ro'yxat.
--   7. public.restore_record(...)   — invoker (RLS + a_before_update "tiklash faqat
--      admin" + mavjud to'qnashuv triggerlari), dinamik SQL faqat oq ro'yxat + %I.
--      Smeta: boshqa joriy versiya bo'lsa — joriy EMAS holda tiklanadi (P1).
--   Review tuzatishlari (shu faylda):
--   0.  alert turi 'yozuv_tiklandi'; inventory_counts.submitted_at (+ trigger).
--   9.  O1 — tg_compute_qty, tg_material_requests_guard: tiklashda bog'langan xarid
--       tekshiriladi (purchase_not_open).
--   10. O3 — tg_soft_delete_alert: tiklash → 'yozuv_tiklandi' alerti.
--   11. O2 — profil tiklanganda bog'lanishlar uziladi, is_active = false.
--   12. P2 — apply_inventory_adjustments: inventory_apply_expired (> 7 kun).
--   13. O3 — daily_report_stats: restored_count.
--   O4 — audit_feed: aniq company_id predikati, dinamik filtrlar, indeks
--        audit_log (company_id, record_id, id desc).
--
-- Oldingi migratsiyalar o'zgartirilmaydi. Xato shakli: errcode + barqaror `hint` +
-- o'zbekcha `message` (docs/db-design.md → "Xato kalitlari").
-- ============================================================================

-- ============================================================================
-- 0. Yangi alert turi (faqat plpgsql ichida, runtime'da ishlatiladi — Batch 5
--    'yozuv_ochirildi' bilan bir xil sabab: yangi enum qiymati shu tranzaksiyada
--    SQL'da ishlatilmaydi).
-- ============================================================================
alter type public.alert_type add value if not exists 'yozuv_tiklandi';

-- ============================================================================
-- 0a. inventory_counts.submitted_at — yakunlangan vaqt (P2: eski hisobni qo'llamaslik).
--     Backfill: audit_log dagi draft → submitted o'tishi, bo'lmasa updated_at.
--     Trigger (backfill'dan keyin yaratiladi): status submitted ga o'tganda now();
--     aks holda eski qiymat (hech kim qo'lda o'zgartira olmaydi).
-- ============================================================================
alter table public.inventory_counts add column submitted_at timestamptz;

update public.inventory_counts c
   set submitted_at = coalesce(
         (select max(a.created_at)
            from public.audit_log a
           where a.company_id = c.company_id
             and a.table_name = 'inventory_counts'
             and a.record_id = c.id
             and a.new_data ->> 'status' = 'submitted'
             and coalesce(a.old_data ->> 'status', '') <> 'submitted'),
         c.updated_at)
 where c.status = 'submitted';

create function private.tg_inventory_submitted_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.submitted_at := case when new.status = 'submitted' then now() end;
  elsif new.status = 'submitted' and old.status is distinct from 'submitted' then
    new.submitted_at := now();
  elsif new.status is distinct from 'submitted' then
    new.submitted_at := null;
  else
    new.submitted_at := old.submitted_at;
  end if;
  return new;
end;
$$;

create trigger b_inventory_submitted_at before insert or update on public.inventory_counts
  for each row execute function private.tg_inventory_submitted_at();

-- ============================================================================
-- 1. Indekslar
--    Mavjudlar (Batch 1): audit_log_company_time_idx (company_id, created_at desc),
--    audit_log_record_idx (table_name, record_id, created_at desc),
--    audit_log_actor_idx (company_id, actor_profile_id, created_at desc) —
--    vaqt bo'yicha; keyset esa id bo'yicha.
-- ============================================================================
create index audit_log_company_id_idx     on public.audit_log (company_id, id desc);
create index audit_log_company_record_idx on public.audit_log (company_id, table_name, record_id, id desc);
create index audit_log_company_actor_idx  on public.audit_log (company_id, actor_profile_id, id desc);
-- O4: "Shu yozuv tarixi" (p_record_id, jadvalsiz)
create index audit_log_company_record_id_idx on public.audit_log (company_id, record_id, id desc);

-- O'chirilganlar sahifasi: kam qator, lekin katta jadvallarda to'liq skanerlamaslik uchun
create index movements_company_deleted_idx             on public.movements (company_id, deleted_at)             where deleted_at is not null;
create index purchases_company_deleted_idx             on public.purchases (company_id, deleted_at)             where deleted_at is not null;
create index cash_advances_company_deleted_idx         on public.cash_advances (company_id, deleted_at)         where deleted_at is not null;
create index material_requests_company_deleted_idx     on public.material_requests (company_id, deleted_at)     where deleted_at is not null;
create index estimate_items_company_deleted_idx        on public.estimate_items (company_id, deleted_at)        where deleted_at is not null;
create index inventory_count_items_company_deleted_idx on public.inventory_count_items (company_id, deleted_at) where deleted_at is not null;

-- ============================================================================
-- 2. Oq ro'yxat — tiklanadigan biznes jadvallari.
--    Kirmaydi: companies (firma holati — faqat super_admin, b_companies_guard),
--    transfers (o'tkazma bekor qilinadi, tiklanmaydi — faqat RPC, transfer_direct_edit),
--    alerts (tizim yozuvi), audit_log, notification_outbox (tizim jadvallari).
-- ============================================================================
create function private.history_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'profiles', 'objects', 'object_members',
    'materials', 'material_units', 'material_aliases', 'suppliers',
    'cash_advances', 'purchases', 'movements', 'material_requests',
    'inventory_counts', 'inventory_count_items',
    'estimates', 'estimate_items', 'estimate_import_templates'
  ]::text[]
$$;

-- ============================================================================
-- 3. Son formatlash (yorliq uchun): ortiqcha nollarsiz, kasr — vergul;
--    summa — minglik probel bilan ("1 250 000,5").
-- ============================================================================
create function private.history_num(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(trim_scale(p)::text, '.', ',')
$$;

create function private.history_money(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(split_part(x.t, '.', 1), '(\d)(?=(\d{3})+$)', '\1 ', 'g')
         || case when position('.' in x.t) > 0 then ',' || split_part(x.t, '.', 2) else '' end
    from (select trim_scale(p)::text as t) x
$$;

-- ============================================================================
-- 4. private.audit_record_label — jadval bo'yicha qisqa nom.
--    security invoker: nomlar (material, obyekt, profil, sotuvchi) chaqiruvchining
--    RLS'i bo'yicha join qilinadi; qolgani — faqat berilgan new_data/old_data.
--    Yozuv firmasi chaqiruvchiga ochiq bo'lmasa (can_access_company) — null.
--    'auth' (Batch 2 auth hodisalari) — record_id = maqsad profil (RLS bo'yicha).
-- ============================================================================
create function private.audit_record_label(
  p_table     text,
  p_record_id uuid,
  p_new_data  jsonb,
  p_old_data  jsonb
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  d      jsonb := coalesce(p_new_data, p_old_data);
  v_co   uuid;
  v_mat  text;
  v_obj  text;
  v_unit text;
begin
  if p_table = 'auth' then
    return (select p.full_name from public.profiles p where p.id = p_record_id);
  end if;
  if d is null or jsonb_typeof(d) <> 'object' then
    return null;
  end if;

  v_co := case when p_table = 'companies' then (d ->> 'id')::uuid else (d ->> 'company_id')::uuid end;
  if v_co is null or not private.can_access_company(v_co) then
    return null;
  end if;

  if d ->> 'material_id' is not null then
    select m.name, m.base_unit into v_mat, v_unit
      from public.materials m
     where m.company_id = v_co and m.id = (d ->> 'material_id')::uuid;
  end if;
  if d ->> 'object_id' is not null then
    select o.name into v_obj
      from public.objects o
     where o.company_id = v_co and o.id = (d ->> 'object_id')::uuid;
  end if;

  return case p_table
    when 'companies'                 then d ->> 'name'
    when 'objects'                   then d ->> 'name'
    when 'suppliers'                 then d ->> 'name'
    when 'materials'                 then d ->> 'name'
    when 'estimate_import_templates' then d ->> 'name'
    when 'estimate_items'            then d ->> 'name'
    when 'profiles'                  then d ->> 'full_name'
    when 'material_units' then
      concat_ws(' · ', v_mat,
                (d ->> 'unit') || coalesce(' (' || (d ->> 'variant') || ')', ''))
    when 'material_aliases' then
      concat_ws(' → ', d ->> 'alias', v_mat)
    when 'object_members' then
      concat_ws(' · ',
                (select p.full_name from public.profiles p
                  where p.company_id = v_co and p.id = (d ->> 'profile_id')::uuid),
                v_obj)
    when 'movements' then
      concat_ws(' · ', v_mat,
                private.history_num((d ->> 'qty_input')::numeric) || ' ' || (d ->> 'unit_input') || ' '
                || case d ->> 'type'
                     when 'kirim'            then 'kirim'
                     when 'chiqim'           then 'chiqim'
                     when 'transfer_out'     then 'o''tkazma (chiqdi)'
                     when 'transfer_in'      then 'o''tkazma (keldi)'
                     when 'inventory_adjust' then 'inventarizatsiya tuzatishi'
                     else d ->> 'type'
                   end)
    when 'purchases' then
      concat_ws(' · ', v_mat,
                private.history_money((d ->> 'total_amount')::numeric) || ' so''m',
                (select s.name from public.suppliers s
                  where s.company_id = v_co and s.id = (d ->> 'supplier_id')::uuid))
    when 'cash_advances' then
      concat_ws(' · ',
                (select p.full_name from public.profiles p
                  where p.company_id = v_co and p.id = (d ->> 'recipient_id')::uuid),
                private.history_money((d ->> 'amount')::numeric) || ' so''m')
    when 'transfers' then
      concat_ws(' · ', v_mat,
                private.history_num((d ->> 'qty_input')::numeric) || ' ' || (d ->> 'unit_input'),
                nullif(concat_ws(' → ',
                  (select o.name from public.objects o
                    where o.company_id = v_co and o.id = (d ->> 'from_object_id')::uuid),
                  (select o.name from public.objects o
                    where o.company_id = v_co and o.id = (d ->> 'to_object_id')::uuid)), ''))
    when 'material_requests' then
      concat_ws(' · ', v_mat,
                private.history_num((d ->> 'qty_input')::numeric) || ' ' || (d ->> 'unit_input'),
                v_obj)
    when 'inventory_counts' then
      concat_ws(' · ', 'Inventarizatsiya', v_obj)
    when 'inventory_count_items' then
      concat_ws(' · ', v_mat,
                private.history_num((d ->> 'qty_counted')::numeric) || coalesce(' ' || v_unit, ''))
    when 'estimates' then
      concat_ws(' · ', v_obj, d ->> 'title', 'v' || (d ->> 'version'))
    when 'alerts' then
      concat_ws(' · ', d ->> 'type', v_obj, v_mat)
    else null
  end;
end;
$$;

-- ============================================================================
-- 5. public.audit_feed — audit_log (RLS: admin, direktor — o'z firmasi;
--    super_admin — hammasi; boshqalar — 0 qator). Eng yangisi birinchi,
--    keyset: id < p_before_id. Davr — Toshkent kunlari, ≤ 366 kun.
-- ============================================================================
create function public.audit_feed(
  p_from      date,
  p_to        date,
  p_table     text   default null,
  p_action    text   default null,
  p_actor     uuid   default null,
  p_device    text   default null,
  p_record_id uuid   default null,
  p_before_id bigint default null,
  p_limit     int    default 50
)
returns table (
  id               bigint,
  created_at       timestamptz,
  table_name       text,
  record_id        uuid,
  action           text,
  actor_profile_id uuid,
  actor_name       text,
  device           text,
  changed_fields   text[],
  old_data         jsonb,
  new_data         jsonb,
  record_label     text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_start timestamptz;
  v_end   timestamptz;
  -- O4: aniq firma predikati (indeks (company_id, ...) ishlatilsin); super_admin — null (hammasi)
  v_co    uuid := case when private.is_super_admin() then null else private.my_company_id() end;
begin
  select r.o_start, r.o_end into v_start, v_end from private.report_period(p_from, p_to) r;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'Sahifa hajmi 1 dan 200 gacha bo''lishi kerak'
      using errcode = '22023', hint = 'history_limit_invalid';
  end if;
  if v_co is null and not private.is_super_admin() then
    return;   -- profil/firma yo'q
  end if;

  -- Dinamik SQL: faqat berilgan filtrlar qo'shiladi va har chaqiruvda haqiqiy qiymatlar
  -- bilan rejalashtiriladi (generic plan "p is null or ..." bilan indeksni yo'qotmasin).
  -- Qiymatlar faqat USING orqali ($1..$10), matnga qo'shilmaydi.
  return query execute
    'select a.id, a.created_at, a.table_name, a.record_id, a.action, a.actor_profile_id,
            pr.full_name,
            a.device, a.changed_fields, a.old_data, a.new_data,
            private.audit_record_label(a.table_name, a.record_id, a.new_data, a.old_data)
       from public.audit_log a
       left join public.profiles pr on pr.id = a.actor_profile_id
      where a.created_at >= $1 and a.created_at < $2'
    -- Firma sharti oraliq ko'rinishida (>= va <=): '=' bo'lsa planner company_id ni tartib
    -- kalitidan chiqarib tashlaydi va 2 firmali bazada ham audit_log_pkey bo'ylab orqaga
    -- skanerlashni tanlashi mumkin (boshqa firmaning yangi qatorlarini filtr bilan o'tkazib).
    -- 'order by company_id, id desc' faqat (company_id, ...) indekslaridan tartibli o'qiladi.
    || case when v_co        is not null then ' and a.company_id >= $3 and a.company_id <= $3' else '' end
    || case when p_table     is not null then ' and a.table_name = $4'       else '' end
    || case when p_action    is not null then ' and a.action = $5'           else '' end
    || case when p_actor     is not null then ' and a.actor_profile_id = $6' else '' end
    || case when p_device    is not null then ' and a.device = $7'           else '' end
    || case when p_record_id is not null then ' and a.record_id = $8'        else '' end
    || case when p_before_id is not null then ' and a.id < $9'               else '' end
    || case when v_co is not null then ' order by a.company_id, a.id desc' else ' order by a.id desc' end
    || ' limit $10'
    using v_start, v_end, v_co, p_table, p_action, p_actor, p_device, p_record_id, p_before_id, p_limit;
end;
$$;

-- ============================================================================
-- 6. public.deleted_records — oq ro'yxatdagi jadvallarning soft delete qilingan
--    qatorlari (deleted_at davrda). RLS amal qiladi; sahifa faqat admin, direktor,
--    super_admin uchun — boshqa rollar (masalan prorab o'z o'chirilgan harakatlarini
--    RLS bo'yicha ko'radi) bo'sh natija oladi. O'tkazma harakatlari (transfer_id)
--    chiqmaydi — ular o'tkazma RPC'lari bilan boshqariladi va tiklanmaydi.
--    deleted_by_name — audit_log dagi oxirgi SOFT_DELETE aktyori (audit_log RLS).
-- ============================================================================
create function public.deleted_records(
  p_from   date,
  p_to     date,
  p_table  text default null,
  p_limit  int  default 100,
  p_offset int  default 0
)
returns table (
  table_name      text,
  record_id       uuid,
  record_label    text,
  deleted_at      timestamptz,
  deleted_by_name text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_start timestamptz;
  v_end   timestamptz;
begin
  select r.o_start, r.o_end into v_start, v_end from private.report_period(p_from, p_to) r;
  if p_limit is null or p_limit < 1 or p_limit > 200 or p_offset is null or p_offset < 0 then
    raise exception 'Sahifa hajmi 1 dan 200 gacha, siljish 0 yoki undan katta bo''lishi kerak'
      using errcode = '22023', hint = 'history_limit_invalid';
  end if;
  if p_table is not null and not (p_table = any (private.history_tables())) then
    raise exception 'Bu turdagi yozuvlar ro''yxati yo''q'
      using errcode = '22023', hint = 'restore_table_invalid';
  end if;
  if not private.has_role('super_admin', 'admin', 'direktor') then
    return;
  end if;

  return query
  with d (table_name, company_id, record_id, deleted_at, data) as (
              select 'profiles'::text, t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.profiles t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'profiles')
    union all select 'objects', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.objects t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'objects')
    union all select 'object_members', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.object_members t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'object_members')
    union all select 'materials', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.materials t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'materials')
    union all select 'material_units', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.material_units t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'material_units')
    union all select 'material_aliases', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.material_aliases t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'material_aliases')
    union all select 'suppliers', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.suppliers t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'suppliers')
    union all select 'cash_advances', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.cash_advances t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'cash_advances')
    union all select 'purchases', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.purchases t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'purchases')
    union all select 'movements', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.movements t
               where t.deleted_at >= v_start and t.deleted_at < v_end and t.transfer_id is null
                 and (p_table is null or p_table = 'movements')
    union all select 'material_requests', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.material_requests t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'material_requests')
    union all select 'inventory_counts', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.inventory_counts t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'inventory_counts')
    -- qty_expected / price_per_base authenticated ga yopiq (ustun grantlari) — faqat kerakli ustunlar
    union all select 'inventory_count_items', t.company_id, t.id, t.deleted_at,
                     jsonb_build_object('id', t.id, 'company_id', t.company_id, 'material_id', t.material_id,
                                        'qty_counted', t.qty_counted, 'inventory_count_id', t.inventory_count_id)
                from public.inventory_count_items t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'inventory_count_items')
    union all select 'estimates', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.estimates t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'estimates')
    union all select 'estimate_items', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.estimate_items t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'estimate_items')
    union all select 'estimate_import_templates', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.estimate_import_templates t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'estimate_import_templates')
  )
  select d.table_name, d.record_id,
         private.audit_record_label(d.table_name, d.record_id, d.data, null),
         d.deleted_at,
         pr.full_name
    from d
    left join lateral (
      select a.actor_profile_id
        from public.audit_log a
       where a.company_id = d.company_id
         and a.table_name = d.table_name
         and a.record_id = d.record_id
         and a.action = 'SOFT_DELETE'
       order by a.id desc
       limit 1
    ) la on true
    left join public.profiles pr on pr.id = la.actor_profile_id
   order by d.deleted_at desc, d.table_name, d.record_id
   limit p_limit offset p_offset;
end;
$$;

-- ============================================================================
-- 7. public.restore_record — o'chirilgan yozuvni tiklash (deleted_at = null).
--    security invoker: RLS (update siyosatlari) va a_before_update ("tiklash faqat
--    admin") amal qiladi; mavjud triggerlar (nom/alias/birlik to'qnashuvi, alias
--    kaskadi, smeta joriyligi, inventarizatsiya qulfi, o'chirilgan material/xarid)
--    o'z hint'lari bilan xato beradi. Jadval nomi — faqat oq ro'yxat va %I.
--    Hint'siz unique_violation (masalan profil telefoni, a'zolik) — restore_conflict.
-- ============================================================================
create function public.restore_record(p_table text, p_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_rows    bigint;
  v_deleted boolean;
  v_hint    text;
  v_demote  boolean := false;
begin
  if not private.has_role('super_admin', 'admin') then
    raise exception 'O''chirilgan yozuvni faqat administrator tiklay oladi'
      using errcode = '42501', hint = 'restore_admin_only';
  end if;
  if p_table is null or not (p_table = any (private.history_tables())) then
    raise exception 'Bu turdagi yozuvni tiklab bo''lmaydi'
      using errcode = '22023', hint = 'restore_table_invalid';
  end if;
  if p_id is null then
    raise exception 'Yozuv topilmadi' using errcode = 'P0002', hint = 'restore_not_found';
  end if;

  -- O'tkazma harakati (transfer_out / transfer_in): o'tkazma bekor qilinganda
  -- o'chiriladi — tiklansa qoldiq o'tkazma holatiga zid bo'ladi.
  if p_table = 'movements' and exists (
       select 1 from public.movements m where m.id = p_id and m.transfer_id is not null
     ) then
    raise exception 'O''tkazma harakatini tiklab bo''lmaydi — kerak bo''lsa yangi o''tkazma yarating'
      using errcode = '55000', hint = 'restore_transfer_movement';
  end if;

  -- P1: smeta — obyektda boshqa joriy versiya bo'lsa, joriy EMAS holda tiklanadi
  --     (b_estimates_guard istisnosi; smeta RPC GUC'i ichida).
  if p_table = 'estimates' and exists (
       select 1
         from public.estimates e
        where e.id = p_id
          and e.deleted_at is not null
          and e.is_current
          and exists (
            select 1 from public.estimates x
             where x.company_id = e.company_id
               and x.object_id = e.object_id
               and x.id <> e.id
               and x.is_current
               and x.deleted_at is null)
     ) then
    v_demote := true;
  end if;

  begin
    if v_demote then
      perform set_config('terron.estimate_rpc', 'on', true);
      update public.estimates
         set deleted_at = null, is_current = false
       where id = p_id and deleted_at is not null;
      get diagnostics v_rows = row_count;
      perform set_config('terron.estimate_rpc', 'off', true);
    else
      execute format('update public.%I set deleted_at = null where id = $1 and deleted_at is not null', p_table)
        using p_id;
      get diagnostics v_rows = row_count;
    end if;
  exception when unique_violation then
    get stacked diagnostics v_hint = pg_exception_hint;
    if coalesce(v_hint, '') <> '' then
      raise;
    end if;
    raise exception 'Tiklab bo''lmaydi: bir xil qiymatli faol yozuv bor'
      using errcode = '23505', hint = 'restore_conflict';
  end;

  if v_rows = 0 then
    execute format('select t.deleted_at is not null from public.%I t where t.id = $1', p_table)
      into v_deleted
      using p_id;
    if v_deleted is not null and not v_deleted then
      raise exception 'Yozuv o''chirilmagan' using errcode = '55000', hint = 'restore_not_deleted';
    end if;
    -- ko'rinmaydi (boshqa firma / yo'q) yoki RLS update'ga yo'l qo'ymadi
    raise exception 'Yozuv topilmadi' using errcode = 'P0002', hint = 'restore_not_found';
  end if;
end;
$$;

-- ============================================================================
-- 9. O1 — o'chirilgan xaridga bog'langan yozuvni tiklash: bog'lanish tekshiruvi
--    tiklashda ham (old.deleted_at is not null and new.deleted_at is null).
--    Bog'langan xarid o'chirilgan bo'lsa → purchase_not_open.
--    (a) tg_compute_qty — Batch 5 versiyasi, faqat movements bog'lanish sharti.
-- ============================================================================
create or replace function private.tg_compute_qty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_id    uuid := new.unit_id;
  v_old_unit   uuid;
  v_material   uuid;
  v_unit       text;
  v_variant    text;
  v_factor     numeric;
  v_check_link boolean := true;
  v_p_material uuid;
  v_p_object   uuid;
begin
  if tg_op = 'UPDATE' then
    v_old_unit := old.unit_id;
  end if;

  -- (1) material qatori qulfi (topilmasa — kompozit FK xato beradi)
  perform 1
     from public.materials m
    where m.company_id = new.company_id
      and m.id = new.material_id
      for share;

  -- (2) unit_id berilmagan bo'lsa — nom bo'yicha
  if v_unit_id is null then
    select mu.id into v_unit_id
      from public.material_units mu
     where mu.company_id = new.company_id
       and mu.material_id = new.material_id
       and private.norm_name(mu.unit) = private.norm_name(new.unit_input)
       and mu.variant is null
       and mu.deleted_at is null;
  end if;

  -- (3) birlik qatorini o'qish va qulflash — bitta so'rov.
  select mu.material_id, mu.unit, mu.variant, mu.factor
    into v_material, v_unit, v_variant, v_factor
    from public.material_units mu
   where mu.company_id = new.company_id
     and mu.id = v_unit_id
     and (mu.deleted_at is null or mu.id = v_old_unit)
     for share;
  if not found then
    raise exception 'Birlik topilmadi yoki o''chirilgan'
      using errcode = '23503', hint = 'ops_unit_not_found';
  end if;
  if v_material is distinct from new.material_id then
    raise exception 'Tanlangan birlik bu materialga tegishli emas'
      using errcode = '23503', hint = 'ops_unit_material_mismatch';
  end if;

  -- (4) hisoblash — qulflangan qatordan
  new.unit_id      := v_unit_id;
  new.unit_input   := v_unit;
  new.unit_variant := v_variant;
  new.qty_base     := round(new.qty_input * v_factor, 6);

  if tg_table_name = 'purchases' then
    new.unit_price     := coalesce(round(new.total_amount / nullif(new.qty_input, 0), 2), 0);
    new.price_per_base := coalesce(round(new.total_amount / nullif(new.qty_base, 0), 4), 0);
  end if;

  if tg_table_name = 'movements' then
    v_check_link := new.purchase_id is not null;
    if v_check_link and tg_op = 'UPDATE' then
      v_check_link := new.purchase_id is distinct from old.purchase_id
                   or new.material_id is distinct from old.material_id
                   or new.object_id   is distinct from old.object_id
                   or (old.deleted_at is not null and new.deleted_at is null);  -- Batch 10: tiklash
    end if;
    if v_check_link then
      select p.material_id, p.object_id into v_p_material, v_p_object
        from public.purchases p
       where p.company_id = new.company_id
         and p.id = new.purchase_id
         and p.deleted_at is null;
      if not found then
        raise exception 'Bog''langan xarid topilmadi yoki o''chirilgan'
          using errcode = '23503', hint = 'purchase_not_open';
      end if;
      if v_p_material is distinct from new.material_id or v_p_object is distinct from new.object_id then
        raise exception 'Bog''langan xarid boshqa material yoki obyektga tegishli'
          using errcode = '23514', hint = 'ops_purchase_mismatch';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- (b) tg_material_requests_guard — Batch 8 versiyasi, faqat bog'lanish sharti.
-- ----------------------------------------------------------------------------
create or replace function private.tg_material_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free       text[] := array['status', 'note', 'updated_at', 'decided_by', 'decided_at'];
  v_user       boolean := auth.uid() is not null and not private.has_role('super_admin', 'admin');
  v_p_object   uuid;
  v_p_material uuid;
begin
  if tg_op = 'INSERT' then
    if v_user then
      new.decision_note := null;
    end if;
    if new.status = 'kutilmoqda' then
      new.decided_by := null;
      new.decided_at := null;
    else
      new.decided_by := private.my_profile_id();
      new.decided_at := now();
    end if;
  else
    if v_user then
      if new.status = 'xarid_qilindi' then
        v_free := v_free || array['purchase_id'];
      end if;
      if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
        raise exception 'So''rovda faqat holat va izohni o''zgartirish mumkin'
          using errcode = '42501', hint = 'request_fields_locked';
      end if;
      -- O2: tasdiqlash / rad etish — faqat admin; taminotchi — faqat tasdiqlandi → xarid_qilindi
      if new.status is distinct from old.status
         and not (old.status = 'tasdiqlandi' and new.status = 'xarid_qilindi') then
        raise exception 'So''rov holatini "%" dan "%" ga o''zgartirib bo''lmaydi', old.status, new.status
          using errcode = '42501', hint = 'request_status_transition';
      end if;
    end if;

    if new.status is distinct from old.status then
      new.decided_by := private.my_profile_id();
      new.decided_at := now();
    else
      new.decided_by := old.decided_by;
      new.decided_at := old.decided_at;
    end if;
  end if;

  if new.purchase_id is not null
     and (tg_op = 'INSERT'
          or new.purchase_id is distinct from old.purchase_id
          or new.object_id   is distinct from old.object_id
          or new.material_id is distinct from old.material_id
          or new.status      is distinct from old.status
          or (old.deleted_at is not null and new.deleted_at is null)) then  -- Batch 10: tiklash
    if new.status <> 'xarid_qilindi' then
      raise exception 'Xaridni faqat "xarid qilindi" holatidagi so''rovga bog''lash mumkin'
        using errcode = '23514', hint = 'request_purchase_invalid';
    end if;
    select p.object_id, p.material_id into v_p_object, v_p_material
      from public.purchases p
     where p.company_id = new.company_id
       and p.id = new.purchase_id
       and p.deleted_at is null;
    if not found then
      raise exception 'Bog''langan xarid topilmadi yoki o''chirilgan'
        using errcode = '23503', hint = 'purchase_not_open';
    end if;
    if v_p_object is distinct from new.object_id or v_p_material is distinct from new.material_id then
      raise exception 'Xarid boshqa obyekt yoki materialga tegishli'
        using errcode = '23514', hint = 'request_purchase_invalid';
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 10. O3 — tiklash ham signal beradi. tg_soft_delete_alert (Batch 8 versiyasi,
--     create or replace): o'chirish qismi o'zgarmagan; tiklashda 'yozuv_ochirildi'
--     avvalgidek 'restored' bilan yopiladi VA yangi 'yozuv_tiklandi' alerti yaratiladi
--     (purchases, cash_advances, movements; zz_notify — darhol bot).
--     severity: o'chirilganidan beri ≥ 7 kun yoki yozuv sanasi (occurred_at /
--     purchased_at / issued_at, Toshkent) joriy oydan oldin → 'jiddiy'
--     ("o'tgan davrni o'zgartirish"), aks holda 'ogohlantirish'.
--     details: table, record_id, actor_profile_id, actor_name, material_name, amount,
--     qty_base, base_unit, buyer_name, recipient_name, movement_type, occurred_at,
--     deleted_at_before, days_since.
--     O'tkazma RPC ichidagi transfer_* harakatlari — alert yo'q (avvalgidek).
-- ============================================================================
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

-- ============================================================================
-- 11. O2 — profil tiklanganda bog'lanishlar uziladi va profil nofaol bo'ladi:
--     auth_user_id, telegram_user_id, telegram_chat_id → null, login_kind = 'none',
--     is_active = false. Admin keyin ataylab faollashtiradi va qayta bog'laydi.
--     BEFORE trigger NEW ni o'zgartiradi — Batch 2 ustun grantlari (authenticated
--     bog'lanish ustunlariga yoza olmaydi) chetlab o'tilmaydi: trigger faqat tiklash
--     holatida va faqat null/false/'none' qo'yadi. Nom b_profiles_restore_unlink —
--     b_profiles_phone_unlink dan keyin.
-- ============================================================================
create function private.tg_profiles_restore_unlink()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.auth_user_id     := null;
  new.telegram_user_id := null;
  new.telegram_chat_id := null;
  new.login_kind       := 'none';
  new.is_active        := false;
  return new;
end;
$$;

create trigger b_profiles_restore_unlink before update on public.profiles
  for each row
  when (old.deleted_at is not null and new.deleted_at is null)
  execute function private.tg_profiles_restore_unlink();

-- ============================================================================
-- 12. P2 — apply_inventory_adjustments (Batch 8, create or replace): hisob
--     submitted_at dan 7 kundan ko'p o'tgan bo'lsa → inventory_apply_expired
--     (55000; qayta sanash kerak). Qolgani o'zgarmagan.
-- ============================================================================
create or replace function public.apply_inventory_adjustments(p_count_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me    uuid := private.my_profile_id();
  v_count public.inventory_counts%rowtype;
  r       record;
  v_n     integer := 0;
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
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
  if not private.has_role('super_admin', 'admin') then
    raise exception 'Qoldiqni tuzatishga ruxsat yo''q'
      using errcode = '42501', hint = 'inventory_apply_forbidden';
  end if;
  if v_count.applied_at is not null then
    raise exception 'Bu inventarizatsiya bo''yicha qoldiq allaqachon tuzatilgan'
      using errcode = '55000', hint = 'inventory_already_applied';
  end if;
  if v_count.status <> 'submitted' then
    raise exception 'Inventarizatsiya hali yakunlanmagan'
      using errcode = '55000', hint = 'inventory_not_submitted';
  end if;
  -- Batch 10 (P2): eski hisob — qoldiq o'shandan beri o'zgargan bo'lishi mumkin
  if v_count.submitted_at is not null and v_count.submitted_at < now() - interval '7 days' then
    raise exception 'Inventarizatsiya 7 kundan oldin yakunlangan — qoldiqni tuzatish uchun qayta sanang'
      using errcode = '55000', hint = 'inventory_apply_expired';
  end if;

  for r in
    select i.material_id,
           (i.qty_counted - i.qty_expected)::numeric(20,6) as diff,
           (select mu.id
              from public.material_units mu
              join public.materials m on m.company_id = mu.company_id and m.id = mu.material_id
             where mu.company_id = i.company_id and mu.material_id = i.material_id
               and mu.unit = m.base_unit and mu.factor = 1 and mu.variant is null
               and mu.deleted_at is null) as unit_id
      from public.inventory_count_items i
     where i.company_id = v_count.company_id
       and i.inventory_count_id = v_count.id
       and i.deleted_at is null
       and i.qty_expected is not null
       and i.qty_counted <> i.qty_expected
     order by i.material_id
  loop
    insert into public.movements
      (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base,
       inventory_count_id, note, created_by)
    values
      (v_count.company_id, 'inventory_adjust', v_count.object_id, r.material_id, r.unit_id, r.diff, '-',
       r.diff, v_count.id, 'Inventarizatsiya tuzatishi', v_me);
    v_n := v_n + 1;
  end loop;

  update public.inventory_counts
     set applied_at = now(),
         applied_by = case when v_count.company_id = private.my_company_id() then v_me end
   where id = v_count.id;

  -- P5: kamomad alertiga tuzatish belgisi (alert yopilmaydi)
  update public.alerts a
     set details = a.details || jsonb_build_object(
           'applied_at', now(),
           'applied_by_name', (select p.full_name from public.profiles p where p.id = v_me))
   where a.company_id = v_count.company_id
     and a.inventory_count_id = v_count.id
     and a.type = 'inventarizatsiya_kamomadi'
     and a.deleted_at is null;

  return v_n;
end;
$$;

-- ============================================================================
-- 13. O3 — kunlik hisobot (Batch 8 daily_report_stats, create or replace):
--     restored_count — davrda yaratilgan 'yozuv_tiklandi' alertlari; bu tur
--     (yozuv_ochirildi kabi) alerts_new / alerts_by_type ga kirmaydi.
-- ============================================================================
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
begin
  select c.name into v_name from public.companies c where c.id = p_company_id;

  select count(*) filter (where m.type = 'kirim'),
         count(*) filter (where m.type = 'chiqim'),
         count(*) filter (where m.type = 'chiqim' and not exists (
           select 1 from public.estimates e
            where e.company_id = m.company_id and e.object_id = m.object_id
              and e.is_current and e.deleted_at is null))
    into v_kirim, v_chiqim, v_no_est
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

  select count(*) into v_tr_pend
    from public.transfers t
   where t.company_id = p_company_id
     and t.deleted_at is null
     and t.status = 'yuborildi';

  select coalesce(jsonb_object_agg(x.type, x.n), '{}'::jsonb), coalesce(sum(x.n), 0)
    into v_by_type, v_new
    from (
      select a.type::text as type, count(*)::integer as n
        from public.alerts a
       where a.company_id = p_company_id
         and a.deleted_at is null
         and a.created_at >= v_from and a.created_at < v_to
         and a.severity <> 'belgi'
         and a.type::text not in ('ozi_qabul_qilgan', 'yozuv_ochirildi', 'yozuv_tiklandi')
       group by a.type
    ) x;

  select count(*) filter (where a.type::text = 'ozi_qabul_qilgan'),
         count(*) filter (where a.type::text = 'yozuv_ochirildi'),
         count(*) filter (where a.type::text = 'yozuv_tiklandi')
    into v_self, v_deleted, v_restored
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
    'deleted_count',       v_deleted,
    'restored_count',      v_restored,
    'transfers_pending_count',       v_tr_pend,
    'chiqim_without_estimate_count', v_no_est
  );
end;
$$;

-- ============================================================================
-- 14. Ruxsatlar
-- ============================================================================
revoke all on function
  private.history_tables(),
  private.history_num(numeric),
  private.history_money(numeric),
  private.audit_record_label(text, uuid, jsonb, jsonb)
from public, anon;

-- invoker zanjiri: public RPC'lar authenticated huquqida chaqiradi
grant execute on function
  private.history_tables(),
  private.history_num(numeric),
  private.history_money(numeric),
  private.audit_record_label(text, uuid, jsonb, jsonb)
to authenticated;

revoke all on function
  public.audit_feed(date, date, text, text, uuid, text, uuid, bigint, int),
  public.deleted_records(date, date, text, int, int),
  public.restore_record(text, uuid)
from public, anon;

grant execute on function
  public.audit_feed(date, date, text, text, uuid, text, uuid, bigint, int),
  public.deleted_records(date, date, text, int, int),
  public.restore_record(text, uuid)
to authenticated;


-- Trigger funksiyalari — hech kimga (create or replace qilinganlar grantlarini saqlaydi)
revoke execute on function
  private.tg_inventory_submitted_at(),
  private.tg_profiles_restore_unlink()
from public, anon, authenticated, service_role;
