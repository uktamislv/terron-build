-- ============================================================================
-- Resurs smetasi — avtomatik moslash: review tuzatishlari
-- (20261104000001_estimate_auto.sql allaqachon qo'llangan — o'zgartirilmaydi).
--
--   1. (P2 xavfsizlik) public.remember_estimate_aliases(jsonb) o'chiriladi →
--      public.remember_estimate_aliases(p_estimate_id uuid, p_items jsonb).
--      Alias faqat chaqiruvchi (admin/super_admin — firmaning istalgani) so'nggi
--      24 soatda yuklagan smetadagi shu materialli qatorning `code` / `name`
--      matnidan olinadi. Buxgalter endi ixtiyoriy matnni ixtiyoriy materialga
--      "eka olmaydi" (avtomatik moslashni buzish / katalog nomlarini band qilish).
--   2. (P2 pul) estimate_items.line_sum numeric(18,2) — fayldagi aniq qator
--      summasi (agregatsiya qilingan qatorlarda qty × yaxlitlangan narx ≠ summa).
--      import_estimate ixtiyoriy `line_sum` qabul qiladi; estimate_totals.total_sum
--      = Σ coalesce(line_sum, round(qty * unit_price, 2)). import_hash p_items ni
--      to'liq hash'laydi — line_sum avtomatik kiradi; line_sum'siz payload hash'i
--      o'zgarmaydi (eski smetalar idempotentligi saqlanadi).
--   3. (P3) estimate_create_materials: ichki advisory qulf kaliti
--      private.lock_catalog_names bilan bir xil ekani izohlandi (tana o'zgarmagan).
--
-- Xato shakli: errcode + barqaror `hint` + o'zbekcha `message`.
-- ============================================================================

-- ============================================================================
-- 0. Matnni solishtirish: btrim + bo'sh joylar ketma-ketligi → bitta probel
--    (norm_name dagi bo'sh joy sinfi; registr va ё saqlanadi).
-- ============================================================================
create function private.squash_spaces(p text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(p, E'[ \\t\\n\\r\\u00A0\\u202F\\u2007]+', ' ', 'g'), ' ');
$$;

revoke execute on function private.squash_spaces(text) from public, anon, authenticated;

-- ============================================================================
-- 2a. estimate_items.line_sum
-- ============================================================================
alter table public.estimate_items
  add column line_sum numeric(18,2) check (line_sum >= 0);

-- ============================================================================
-- 1. remember_estimate_aliases — smetaga bog'langan
-- ============================================================================
drop function public.remember_estimate_aliases(jsonb);

-- p_items: [{ material_id, code?, name? }] (0..5000) → qo'shilgan alias'lar soni.
--   security definer (buxgalter material_aliases ga RLS orqali yoza olmaydi).
--   Tekshiruvlar (hammasi yozishdan oldin, xato bo'lsa hech narsa yozilmaydi):
--     * smeta: chaqiruvchi firmasida, o'chirilmagan — aks holda P0002 estimate_not_found;
--     * smeta muallifi — chaqiruvchi (admin / super_admin — firmaning istalgan smetasi),
--       created_at so'nggi 24 soat ichida — aks holda 22023 estimate_aliases_invalid;
--     * har qator: material firmada va o'chirilmagan; smetada shu materialli
--       (item_type = 'material', o'chirilmagan) qator bor; code / name — shu
--       material qatorlaridan birining code / name iga teng (squash_spaces bo'yicha).
--   Yozish: code → lang 'code', name → lang 'ru' — matn firmada faol alias yoki
--   faol material nomi sifatida band bo'lmasa (o'g'irlanmaydi, ustidan yozilmaydi).
create function public.remember_estimate_aliases(p_estimate_id uuid, p_items jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_max_items constant integer := 5000;
  c_uuid_re   constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_me        uuid := private.my_profile_id();
  v_company   uuid := private.my_company_id();
  v_est       public.estimates%rowtype;
  v_n         integer;
  v_idx       integer;
  v_item      jsonb;
  v_mat_t     text;
  v_mat       uuid;
  v_code      text;
  v_name      text;
  v_err       text;
  v_norm      jsonb := '[]'::jsonb;
  v_text      text;
  v_lang      text;
  v_count     integer := 0;
begin
  if v_me is null or v_company is null then
    raise exception 'Tizimga kirilmagan'
      using errcode = '42501', hint = 'auth_required';
  end if;
  if not private.has_role('super_admin', 'admin', 'buxgalter') then
    raise exception 'Muqobil nomlarni saqlashga ruxsat yo''q'
      using errcode = '42501', hint = 'estimate_import_forbidden';
  end if;

  select * into v_est
    from public.estimates e
   where e.id = p_estimate_id
     and e.company_id = v_company
     and e.deleted_at is null;
  if not found then
    raise exception 'Smeta topilmadi'
      using errcode = 'P0002', hint = 'estimate_not_found';
  end if;
  if v_est.created_by is distinct from v_me and not private.has_role('super_admin', 'admin') then
    raise exception 'Muqobil nomlarni faqat o''zingiz yuklagan smetadan saqlash mumkin'
      using errcode = '22023', hint = 'estimate_aliases_invalid';
  end if;
  if v_est.created_at < now() - interval '24 hours' then
    raise exception 'Smeta 24 soatdan oldin yuklangan — muqobil nomlarni saqlab bo''lmaydi'
      using errcode = '22023', hint = 'estimate_aliases_invalid';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Ro''yxat bo''lishi kerak'
      using errcode = '22023', hint = 'estimate_aliases_invalid';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n = 0 then
    return 0;
  end if;
  if v_n > c_max_items then
    raise exception 'Qatorlar juda ko''p: % (ko''pi bilan %)', v_n, c_max_items
      using errcode = '22023', hint = 'estimate_aliases_invalid';
  end if;

  -- (1) Tekshiruv — yozishdan oldin hammasi
  for v_idx in 1 .. v_n loop
    v_item := p_items -> (v_idx - 1);
    v_err  := null;
    v_mat  := null;

    if jsonb_typeof(v_item) <> 'object' then
      v_err := 'qator noto''g''ri formatda';
    else
      v_mat_t := btrim(v_item ->> 'material_id');
      v_code  := nullif(private.squash_spaces(v_item ->> 'code'), '');
      v_name  := nullif(private.squash_spaces(v_item ->> 'name'), '');
      if v_mat_t ~ c_uuid_re then
        select m.id into v_mat
          from public.materials m
         where m.company_id = v_company
           and m.id = v_mat_t::uuid
           and m.deleted_at is null;
      end if;
      v_err := case
        when v_mat_t is null or v_mat_t = '' then 'material ko''rsatilmagan'
        when v_mat is null then 'material topilmadi yoki o''chirilgan'
        when not exists (
          select 1 from public.estimate_items i
           where i.company_id = v_company and i.estimate_id = v_est.id
             and i.item_type = 'material' and i.material_id = v_mat
             and i.deleted_at is null)
          then 'material bu smetada yo''q'
        when v_code is not null and not exists (
          select 1 from public.estimate_items i
           where i.company_id = v_company and i.estimate_id = v_est.id
             and i.item_type = 'material' and i.material_id = v_mat
             and i.deleted_at is null
             and private.squash_spaces(i.code) = v_code)
          then 'shifr smetadagi shu material qatoriga mos emas'
        when v_name is not null and not exists (
          select 1 from public.estimate_items i
           where i.company_id = v_company and i.estimate_id = v_est.id
             and i.item_type = 'material' and i.material_id = v_mat
             and i.deleted_at is null
             and private.squash_spaces(i.name) = v_name)
          then 'nom smetadagi shu material qatoriga mos emas'
      end;
    end if;

    if v_err is not null then
      raise exception 'Qator %: %', v_idx, v_err
        using errcode = '22023', hint = 'estimate_aliases_invalid', detail = v_idx::text;
    end if;

    v_norm := v_norm || jsonb_build_array(jsonb_build_object('material_id', v_mat, 'code', v_code, 'name', v_name));
  end loop;

  -- (2) Firma katalogi qulfi (b_material_aliases_guard bilan bir xil)
  perform private.lock_catalog_names(v_company);

  for v_idx in 1 .. v_n loop
    v_item := v_norm -> (v_idx - 1);
    v_mat  := (v_item ->> 'material_id')::uuid;

    foreach v_lang in array array['code', 'ru'] loop
      v_text := case v_lang when 'code' then v_item ->> 'code' else v_item ->> 'name' end;
      continue when v_text is null;
      continue when exists (
        select 1 from public.material_aliases a
         where a.company_id = v_company and a.deleted_at is null
           and private.norm_name(a.alias) = private.norm_name(v_text));
      continue when exists (
        select 1 from public.materials m
         where m.company_id = v_company and m.deleted_at is null
           and private.norm_name(m.name) = private.norm_name(v_text));

      insert into public.material_aliases (company_id, material_id, alias, lang, created_by)
      values (v_company, v_mat, v_text, v_lang, v_me);
      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.remember_estimate_aliases(uuid, jsonb) from public, anon;
grant execute on function public.remember_estimate_aliases(uuid, jsonb) to authenticated;

-- ============================================================================
-- 2b. import_estimate — 20261101000001 dagi tana + ixtiyoriy `line_sum`
--     (JSON son yoki satr; >= 0; round(.., 2) < 1e16; 2 xonaga yaxlitlanadi).
--     Xato sabablari: 'summa raqam emas', 'summa manfiy bo''lishi mumkin emas',
--     'summa juda katta' (estimate_item_invalid). Boshqa hech narsa o'zgarmagan.
--     import_hash = sha256(object_id, title, p_items) — line_sum p_items ichida.
-- ============================================================================
create or replace function public.import_estimate(
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

  select o.company_id, o.deleted_at into v_company, v_obj_del
    from public.objects o
   where o.id = p_object_id;
  if not found or v_obj_del is not null then
    raise exception 'Obyekt topilmadi'
      using errcode = 'P0002', hint = 'estimate_object_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('terron.estimate_version:' || p_object_id::text, 0));

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
           nullif(btrim(t.j ->> 'line_sum'), '')       as sum_t,
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
           case when f.sum_t   ~ c_num_re then f.sum_t::numeric end                   as line_sum,
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
             when p.sum_t is not null and p.line_sum is null then 'summa raqam emas'
             when p.line_sum < 0 then 'summa manfiy bo''lishi mumkin emas'
             when round(p.line_sum, 2) >= 1e16 then 'summa juda katta'
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
      'unit', v.unit, 'qty', v.qty, 'unit_price', v.unit_price, 'line_sum', round(v.line_sum, 2), 'code', v.code,
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

  perform set_config('terron.estimate_rpc', 'on', true);

  select e.id into v_prev_id
    from public.estimates e
   where e.company_id = v_company
     and e.object_id = p_object_id
     and e.is_current
     and e.deleted_at is null;

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

  insert into public.estimate_items
    (company_id, estimate_id, item_type, name, material_id, unit_id, unit, qty, unit_price,
     line_sum, code, row_number, sort_order, created_by)
  select v_company, p_id, r.item_type::public.estimate_item_type, r.name, r.material_id, r.unit_id,
         r.unit, r.qty, r.unit_price, r.line_sum, r.code, r.row_number, r.sort_order, v_me
    from jsonb_to_recordset(v_rows) as r(
           idx integer, item_type text, name text, material_id uuid, unit_id uuid, unit text,
           qty numeric, unit_price numeric, line_sum numeric, code text, row_number integer, sort_order integer)
   order by r.material_id nulls first, r.idx;

  perform private.estimate_alert('norm_increase', p_id, v_prev_id);
  -- Batch 8: qoida 4 — yangi joriy versiya bo'yicha qayta baholash
  perform private.evaluate_object_norms(v_company, p_object_id);

  perform set_config('terron.estimate_rpc', 'off', true);
  return p_id;
end;
$$;

revoke execute on function public.import_estimate(uuid, uuid, text, text, date, jsonb) from public, anon;
grant execute on function public.import_estimate(uuid, uuid, text, text, date, jsonb) to authenticated;

-- ============================================================================
-- 3. estimate_create_materials — tana 20261104000001 dagi bilan bir xil, faqat
--    advisory qulf izohi (private.lock_catalog_names bilan kalit shartnomasi).
-- ============================================================================
create or replace function public.estimate_create_materials(p_items jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c_max_items constant integer := 2000;
  c_max_units constant integer := 50;
  c_num_re    constant text := '^\s*[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]{1,3})?\s*$';
  v_me        uuid := private.my_profile_id();
  v_company   uuid := private.my_company_id();
  v_n         integer;
  v_idx       integer;
  v_item      jsonb;
  v_u         jsonb;
  v_key       text;
  v_name      text;
  v_base      text;
  v_cat       text;
  v_code      text;
  v_alias     text;
  v_unit      text;
  v_factor_t  text;
  v_factor    numeric;
  v_variant   text;
  v_err       text;
  v_units     jsonb;
  v_norm      jsonb := '[]'::jsonb;
  v_out       jsonb := '[]'::jsonb;
  v_mat       uuid;
  v_created   boolean;
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan'
      using errcode = '42501', hint = 'auth_required';
  end if;
  if not private.has_role('super_admin', 'admin') then
    raise exception 'Materiallarni yaratishga ruxsat yo''q'
      using errcode = '42501', hint = 'estimate_materials_forbidden';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Materiallar ro''yxat bo''lishi kerak'
      using errcode = '22023', hint = 'estimate_materials_invalid';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n = 0 then
    raise exception 'Materiallar ro''yxati bo''sh'
      using errcode = '22023', hint = 'estimate_materials_invalid';
  end if;
  if v_n > c_max_items then
    raise exception 'Materiallar juda ko''p: % (ko''pi bilan %)', v_n, c_max_items
      using errcode = '22023', hint = 'estimate_materials_invalid';
  end if;

  -- --------------------------------------------------------------------------
  -- (1) Tekshiruv — yozishdan oldin hammasi. Normallashtirilgan elementlar v_norm ga.
  -- --------------------------------------------------------------------------
  for v_idx in 1 .. v_n loop
    v_item := p_items -> (v_idx - 1);
    v_err  := null;
    v_units := '[]'::jsonb;

    if jsonb_typeof(v_item) <> 'object' then
      v_err := 'qator noto''g''ri formatda';
    else
      v_key   := v_item ->> 'key';
      v_name  := btrim(v_item ->> 'name');
      v_base  := btrim(v_item ->> 'base_unit');
      v_cat   := nullif(btrim(v_item ->> 'category'), '');
      v_code  := nullif(btrim(v_item ->> 'code'), '');
      v_alias := nullif(btrim(v_item ->> 'alias'), '');

      v_err := case
        when coalesce(jsonb_typeof(v_item -> 'key'), 'null') not in ('string', 'number')
          or btrim(v_key) = '' then 'kalit (key) ko''rsatilmagan'
        when length(v_key) > 200 then 'kalit (key) juda uzun (200 belgigacha)'
        when v_name is null or v_name = '' then 'nomi bo''sh'
        when length(v_name) > 200 then 'nomi juda uzun (200 belgigacha)'
        when v_base is null or v_base = '' then 'asosiy birlik ko''rsatilmagan'
        when length(v_base) > 50 then 'asosiy birlik juda uzun (50 belgigacha)'
        when v_cat is not null and length(v_cat) > 100 then 'turkum juda uzun (100 belgigacha)'
        when v_code is not null and length(v_code) > 100 then 'shifr juda uzun (100 belgigacha)'
        when v_alias is not null and length(v_alias) > 200 then 'muqobil nom juda uzun (200 belgigacha)'
        when coalesce(jsonb_typeof(v_item -> 'units'), 'null') not in ('null', 'array')
          then 'birliklar ro''yxat bo''lishi kerak'
        when jsonb_typeof(v_item -> 'units') = 'array'
             and jsonb_array_length(v_item -> 'units') > c_max_units
          then 'birliklar juda ko''p (' || c_max_units || ' tagacha)'
      end;

      if v_err is null and jsonb_typeof(v_item -> 'units') = 'array' then
        for v_u in select e from jsonb_array_elements(v_item -> 'units') as e loop
          if jsonb_typeof(v_u) <> 'object' then
            v_err := 'birlik noto''g''ri formatda';
            exit;
          end if;
          v_unit     := btrim(v_u ->> 'unit');
          v_factor_t := v_u ->> 'factor';
          v_variant  := nullif(btrim(v_u ->> 'variant'), '');
          v_factor   := case when v_factor_t ~ c_num_re then v_factor_t::numeric end;
          v_err := case
            when v_unit is null or v_unit = '' then 'birlik nomi bo''sh'
            when length(v_unit) > 50 then 'birlik nomi juda uzun (50 belgigacha)'
            when v_variant is not null and length(v_variant) > 100 then 'birlik varianti juda uzun (100 belgigacha)'
            when v_factor_t is null then '«' || v_unit || '» koeffitsienti ko''rsatilmagan'
            when v_factor is null then '«' || v_unit || '» koeffitsienti raqam emas'
            when round(v_factor, 10) <= 0 then '«' || v_unit || '» koeffitsienti 0 dan katta bo''lishi kerak'
            when v_factor >= 1e10 then '«' || v_unit || '» koeffitsienti juda katta'
          end;
          exit when v_err is not null;
          v_units := v_units || jsonb_build_object('unit', v_unit, 'factor', round(v_factor, 10),
                                                   'variant', v_variant);
        end loop;
      end if;
    end if;

    if v_err is not null then
      raise exception 'Qator %: %', v_idx, v_err
        using errcode = '22023', hint = 'estimate_materials_invalid', detail = v_idx::text;
    end if;

    v_norm := v_norm || jsonb_build_array(jsonb_build_object(
      'key', v_key, 'name', v_name, 'base_unit', v_base, 'category', v_cat,
      'code', v_code, 'alias', v_alias, 'units', v_units));
  end loop;

  -- --------------------------------------------------------------------------
  -- (2) Firma katalogi qulfi. KALIT private.lock_catalog_names(company_id) BILAN
  --     AYNAN BIR XIL bo'lishi shart: hashtextextended('terron.catalog_names:' || company_id, 0)
  --     (20261027000001_catalog_guards.sql). U funksiya authenticated uchun yopiq
  --     (security definer) — shuning uchun bu invoker RPC kalitni o'zi hisoblaydi.
  --     b_materials_guard / b_material_aliases_guard ham shu kalitni oladi; qayta
  --     kirish xavfsiz. Kalitni o'zgartirsangiz — ikkala joyni birga
  --     (test: estimate_auto_fixes.sql.test.ts → "qulf kaliti").
  -- --------------------------------------------------------------------------
  perform pg_advisory_xact_lock(hashtextextended('terron.catalog_names:' || v_company::text, 0));

  for v_idx in 1 .. v_n loop
    v_item  := v_norm -> (v_idx - 1);
    v_key   := v_item ->> 'key';
    v_name  := v_item ->> 'name';
    v_base  := v_item ->> 'base_unit';
    v_cat   := v_item ->> 'category';
    v_code  := v_item ->> 'code';
    v_alias := v_item ->> 'alias';
    v_mat   := null;
    v_created := false;

    -- a) shifr
    if v_code is not null then
      select a.material_id into v_mat
        from public.material_aliases a
        join public.materials m on m.company_id = a.company_id and m.id = a.material_id
       where a.company_id = v_company
         and a.deleted_at is null
         and m.deleted_at is null
         and a.lang = 'code'
         and private.norm_name(a.alias) = private.norm_name(v_code);
    end if;

    -- b) nom
    if v_mat is null then
      select m.id into v_mat
        from public.materials m
       where m.company_id = v_company
         and m.deleted_at is null
         and private.norm_name(m.name) = private.norm_name(v_name);
    end if;

    -- c) muqobil nom — boshqa materialning nomi
    if v_mat is null and v_alias is not null then
      select m.id into v_mat
        from public.materials m
       where m.company_id = v_company
         and m.deleted_at is null
         and private.norm_name(m.name) = private.norm_name(v_alias);
    end if;

    -- d) faol alias = nom yoki muqobil nom (nom bo'yicha topilgani ustun)
    if v_mat is null then
      select a.material_id into v_mat
        from public.material_aliases a
        join public.materials m on m.company_id = a.company_id and m.id = a.material_id
       where a.company_id = v_company
         and a.deleted_at is null
         and m.deleted_at is null
         and private.norm_name(a.alias) in (private.norm_name(v_name), private.norm_name(v_alias))
       order by (private.norm_name(a.alias) = private.norm_name(v_name)) desc
       limit 1;
    end if;

    if v_mat is null then
      insert into public.materials (company_id, name, base_unit, category, created_by)
      values (v_company, v_name, v_base, v_cat, v_me)
      returning id into v_mat;
      v_created := true;

      -- Qo'shimcha birliklar: mavjud (asosiy birlik qatori ham) va takroriylar — o'tkaziladi
      for v_u in select e from jsonb_array_elements(v_item -> 'units') as e loop
        insert into public.material_units (company_id, material_id, unit, factor, variant, created_by)
        select v_company, v_mat, v_u ->> 'unit', (v_u ->> 'factor')::numeric, v_u ->> 'variant', v_me
         where not exists (
           select 1 from public.material_units u
            where u.company_id = v_company
              and u.material_id = v_mat
              and u.deleted_at is null
              and private.norm_name(u.unit) = private.norm_name(v_u ->> 'unit')
              and coalesce(private.norm_name(u.variant), '') = coalesce(private.norm_name(v_u ->> 'variant'), '')
         );
      end loop;

      -- Muqobil nom (ru): nomdan farqli va bo'sh bo'lsa
      if v_alias is not null
         and private.norm_name(v_alias) <> private.norm_name(v_name)
         and not exists (
           select 1 from public.material_aliases a
            where a.company_id = v_company and a.deleted_at is null
              and private.norm_name(a.alias) = private.norm_name(v_alias))
         and not exists (
           select 1 from public.materials m
            where m.company_id = v_company and m.deleted_at is null
              and private.norm_name(m.name) = private.norm_name(v_alias)) then
        insert into public.material_aliases (company_id, material_id, alias, lang, created_by)
        values (v_company, v_mat, v_alias, 'ru', v_me);
      end if;
    end if;

    -- Shifr alias'i (yangi va topilgan material uchun): band bo'lmasa
    if v_code is not null
       and not exists (
         select 1 from public.material_aliases a
          where a.company_id = v_company and a.deleted_at is null
            and private.norm_name(a.alias) = private.norm_name(v_code))
       and not exists (
         select 1 from public.materials m
          where m.company_id = v_company and m.deleted_at is null
            and private.norm_name(m.name) = private.norm_name(v_code)) then
      insert into public.material_aliases (company_id, material_id, alias, lang, created_by)
      values (v_company, v_mat, v_code, 'code', v_me);
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', v_key, 'material_id', v_mat, 'created', v_created));
  end loop;

  return v_out;
end;
$$;

revoke execute on function public.estimate_create_materials(jsonb) from public, anon;
grant execute on function public.estimate_create_materials(jsonb) to authenticated;

-- ============================================================================
-- 2c. estimate_totals: total_sum = Σ coalesce(line_sum, round(qty * unit_price, 2)).
--     line_sum ham, unit_price ham yo'q qator — avvalgidek hisobga kirmaydi.
-- ============================================================================
create or replace view public.estimate_totals
with (security_invoker = true) as
select e.id         as estimate_id,
       e.company_id,
       e.object_id,
       count(i.id)::integer                                   as row_count,
       count(distinct i.material_id)::integer                 as material_count,
       coalesce(sum(coalesce(i.line_sum, round(i.qty * i.unit_price, 2))), 0)::numeric(20,2) as total_sum
  from public.estimates e
  left join public.estimate_items i
    on i.company_id = e.company_id
   and i.estimate_id = e.id
   and i.deleted_at is null
 group by e.id, e.company_id, e.object_id;

revoke all on public.estimate_totals from public, anon, authenticated, service_role;
grant select on public.estimate_totals to authenticated, service_role;
