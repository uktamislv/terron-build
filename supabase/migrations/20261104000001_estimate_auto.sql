-- ============================================================================
-- Resurs smetasi — avtomatik moslash (shartnoma: docs/estimate-design.md →
-- "Resurs smetasi — avtomatik moslash (20261104000001)").
--
--   1. material_aliases.lang — yangi qiymat 'code' (smetadagi resurs / narx
--      to'plami shifri: "101-0123", "С101-0123"). Unique indeks
--      (company_id, norm_name(alias)) o'zgarmaydi — shifrlar ham firma bo'yicha unikal.
--   2. public.estimate_create_materials(p_items jsonb) → jsonb — moslanmagan
--      materiallarni bitta tranzaksiyada yaratish (idempotent; security invoker,
--      RLS: faqat admin / super_admin).
--   3. public.remember_estimate_aliases(p_items jsonb) → integer — muvaffaqiyatli
--      importdan keyin shifr va smetadagi nomni muqobil nom sifatida eslab qolish
--      (security definer: buxgalter material_aliases ga RLS orqali yoza olmaydi).
--
-- Moslashtirish — private.norm_name bo'yicha (katalogning unique indekslari va
-- b_*_guard triggerlari bilan bir xil). Qulf — katalog triggerlari bilan bir xil
-- advisory kalit ('terron.catalog_names:' || company_id) — nom/alias tekshiruvi
-- va yozish parallel tranzaksiyalar bilan poygasiz.
--
-- Oldingi migratsiyalar o'zgartirilmaydi. Xato shakli: errcode + barqaror `hint`
-- + o'zbekcha `message` (docs/db-design.md → "Xato kalitlari").
-- ============================================================================

-- ============================================================================
-- 1. material_aliases.lang: 'ru' | 'uz' | 'code'
-- ============================================================================
alter table public.material_aliases
  drop constraint material_aliases_lang_check;
alter table public.material_aliases
  add constraint material_aliases_lang_check check (lang in ('ru', 'uz', 'code'));

-- ============================================================================
-- 2. public.estimate_create_materials
--
--   p_items: [{ key, name, base_unit, category?, code?, alias?,
--               units?: [{ unit, factor, variant? }] }]   (1..2000)
--   Natija:  [{ key, material_id, created }]  — kirish tartibida.
--
--   Har element uchun (firma qulfi ostida, ketma-ket):
--     a) faol 'code' alias (norm_name = code)               → o'sha material;
--     b) faol material: norm_name(name) = name               → o'sha material;
--     c) faol material: norm_name(name) = alias              → o'sha material;
--     d) faol alias (har qanday lang): = name yoki = alias   → o'sha material;
--     topilsa — created = false, shifr alias'i yo'q va bo'sh bo'lsa qo'shiladi;
--     topilmasa — material (asosiy birlik qatori b_base_unit triggeri bilan),
--     qo'shimcha birliklar, shifr alias'i ('code'), alias ('ru', nomdan farqli bo'lsa).
--   Alias hech qachon "o'g'irlanmaydi": matn firmada faol alias yoki boshqa
--   material nomi sifatida band bo'lsa — jimgina o'tkazib yuboriladi.
--   Tekshiruv xatosi — 22023 estimate_materials_invalid, `Qator <n>: <sabab>`
--   (n — massivdagi o'rni, 1 dan), detail = n; hech narsa yozilmaydi.
-- ============================================================================
create function public.estimate_create_materials(p_items jsonb)
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
  -- (2) Firma katalogi qulfi — b_materials_guard / b_material_aliases_guard bilan
  --     bir xil kalit (private.lock_catalog_names). Qayta kirish xavfsiz.
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
-- 3. public.remember_estimate_aliases
--
--   p_items: [{ material_id, code?, name? }]  (0..5000)
--   Natija:  qo'shilgan alias'lar soni.
--
--   security definer: buxgalter (import qiladi) material_aliases ga RLS orqali
--   yoza olmaydi. Shuning uchun aniq tekshiruvlar: chaqiruvchining faol profili,
--   roli (super_admin / admin / buxgalter), material shu firmaniki va o'chirilmagan.
--   Har element: shifr → 'code' alias, nom → 'ru' alias (material nomidan farqli
--   bo'lsa) — faqat matn firmada faol alias yoki material nomi sifatida band
--   bo'lmasa. Hech narsa ustidan yozilmaydi / o'g'irlanmaydi.
--   created_by = chaqiruvchi profili; audit (z_audit) actor — auth.uid() orqali
--   haqiqiy chaqiruvchi (definer ichida ham).
-- ============================================================================
create function public.remember_estimate_aliases(p_items jsonb)
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
      v_code  := nullif(btrim(v_item ->> 'code'), '');
      v_name  := nullif(btrim(v_item ->> 'name'), '');
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
        when v_code is not null and length(v_code) > 100 then 'shifr juda uzun (100 belgigacha)'
        when v_name is not null and length(v_name) > 1000 then 'nomi juda uzun (1000 belgigacha)'
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
      -- band: faol alias (har qanday material, har qanday lang) yoki faol material nomi
      -- (o'zi ham — nomning o'zini alias qilish ma'nosiz)
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

revoke execute on function public.remember_estimate_aliases(jsonb) from public, anon;
grant execute on function public.remember_estimate_aliases(jsonb) to authenticated;
