-- ============================================================================
-- Batch 3 · 01 — katalog yaxlitligi (materials, material_units, material_aliases)
-- va foydalanuvchiga ko'rinadigan xato xabarlari (o'zbekcha message + hint).
--
--  0. private.norm_name(text) — nomlarni solishtirish uchun yagona normallashtirish
--     (domain-logic `normalizeAlias` bilan shartnoma; nomi va xatti-harakati o'zgarmaydi).
--  1. materials.base_unit — material biror yozuvda (o'chirilganlari ham) ishlatilgan
--     bo'lsa o'zgarmaydi; ishlatilmagan bo'lsa asosiy birlik qatori sinxron o'zgaradi.
--     Asosiy birlik qatorini o'chirish / o'zgartirish — taqiqlanadi.
--  2. material_units: ishlatilgan birlikning factor/unit/variant/material_id i o'zgarmaydi.
--  3. b_compute_qty: material, keyin birlik qatori FOR SHARE bilan o'qiladi (poyga yo'q).
--  4. Nom ↔ alias to'qnashuvi va dublikatlar — norm_name bo'yicha (indekslar ham).
--  5. Materialni o'chirish (qoldiq), nofaol / o'chirilgan material bilan operatsiyalar;
--     o'chirilgan materialning operatsiya qatorlari "muzlatiladi".
--  6. Material o'chirilganda/tiklanganda uning alias'lari ham (bir xil deleted_at).
--  7. deleted_at — server vaqti (tg_before_update).
--  8. Batch 1 xabarlari: o'zbekcha, UUID'siz, barqaror `hint`.
--
-- Xato shakli: errcode (P0001 / 23505 / 23503 / 23514 / 42501 / ...), `hint` — barqaror
-- kalit (frontend errors.ts faqat ma'lum hint bo'lsa server xabarini ko'rsatadi),
-- `message` — o'zbekcha matn. To'liq ro'yxat — docs/db-design.md.
-- ============================================================================

-- ============================================================================
-- 0. Normallashtirish
--    btrim + bo'sh joylar (probel, \t, \n, \r, NBSP U+00A0, U+202F, U+2007)
--    ketma-ketligi → bitta probel; ё→е, Ё→Е; lower().
-- ============================================================================
create function private.norm_name(p text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select lower(translate(
           btrim(regexp_replace(p, E'[ \\t\\n\\r\\u00A0\\u202F\\u2007]+', ' ', 'g'), ' '),
           'ёЁ', 'еЕ'));
$$;

revoke execute on function private.norm_name(text) from public, anon;
-- Unique indekslar ifodasida ishlatiladi — yozuvchi rollar execute qila olishi kerak.
grant execute on function private.norm_name(text) to authenticated, service_role;

-- ============================================================================
-- 0a. Unique indekslar norm_name bo'yicha. Avval mavjud dublikatlar tekshiriladi —
--     bo'lsa migratsiya aniq xato bilan to'xtaydi (ma'lumotni qo'lda tuzatish kerak).
-- ============================================================================
do $$
declare
  v text;
begin
  select string_agg(format('firma %s: "%s" (%s ta)', company_id, n, c), '; ') into v
    from (select company_id, private.norm_name(name) n, count(*) c
            from public.materials where deleted_at is null
           group by 1, 2 having count(*) > 1) d;
  if v is not null then
    raise exception 'Migratsiya to''xtatildi: normallashtirilgan nomi bir xil materiallar bor — %', v;
  end if;

  select string_agg(format('firma %s: "%s" (%s ta)', company_id, n, c), '; ') into v
    from (select company_id, private.norm_name(alias) n, count(*) c
            from public.material_aliases where deleted_at is null
           group by 1, 2 having count(*) > 1) d;
  if v is not null then
    raise exception 'Migratsiya to''xtatildi: normallashtirilgan bir xil muqobil nomlar bor — %', v;
  end if;

  select string_agg(format('material %s: "%s" / "%s" (%s ta)', material_id, n, vr, c), '; ') into v
    from (select material_id, private.norm_name(unit) n, coalesce(private.norm_name(variant), '') vr, count(*) c
            from public.material_units where deleted_at is null
           group by 1, 2, 3 having count(*) > 1) d;
  if v is not null then
    raise exception 'Migratsiya to''xtatildi: normallashtirilgan bir xil birliklar bor — %', v;
  end if;
end $$;

drop index public.materials_company_name_key;
create unique index materials_company_name_key
  on public.materials (company_id, private.norm_name(name))
  where deleted_at is null;

drop index public.material_aliases_company_alias_key;
create unique index material_aliases_company_alias_key
  on public.material_aliases (company_id, private.norm_name(alias))
  where deleted_at is null;

drop index public.material_units_material_unit_variant_key;
create unique index material_units_material_unit_variant_key
  on public.material_units (material_id, private.norm_name(unit), coalesce(private.norm_name(variant), ''))
  where deleted_at is null;

-- ============================================================================
-- 7–8. Batch 1 umumiy triggerlari: o'zbekcha xabarlar, deleted_at — server vaqti
-- ============================================================================
create or replace function private.tg_audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O''zgarishlar tarixini tahrirlab yoki o''chirib bo''lmaydi'
    using errcode = '42501', hint = 'audit_append_only';
end;
$$;

create or replace function private.tg_block_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Jadvalni tozalash (TRUNCATE) taqiqlangan'
    using errcode = '42501', hint = 'truncate_blocked';
end;
$$;

create or replace function private.tg_block_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Yozuvni butunlay o''chirib bo''lmaydi — uni o''chirilgan deb belgilang'
    using errcode = '42501', hint = 'soft_delete_only';
end;
$$;

-- UPDATE: id/company_id/created_by/created_at o'zgarmaydi; tiklash faqat admin;
-- deleted_at: null → qiymat bo'lganda server vaqti (now()), bir marta qo'yilgani
-- o'zgarmaydi (faqat null ga — tiklash); updated_at — server vaqti.
create or replace function private.tg_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Yozuv identifikatorini o''zgartirib bo''lmaydi'
      using errcode = '42501', hint = 'immutable_column';
  end if;
  -- companies jadvalida company_id ustuni yo'q — jsonb orqali umumiy tekshiruv
  if to_jsonb(new) -> 'company_id' is distinct from to_jsonb(old) -> 'company_id' then
    raise exception 'Yozuvning firmasini o''zgartirib bo''lmaydi'
      using errcode = '42501', hint = 'immutable_column';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Yozuv muallifini o''zgartirib bo''lmaydi'
      using errcode = '42501', hint = 'immutable_column';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'Yozuv yaratilgan vaqtni o''zgartirib bo''lmaydi'
      using errcode = '42501', hint = 'immutable_column';
  end if;
  -- O'chirilgan yozuvni tiklash (deleted_at -> null) faqat admin / super_admin.
  -- auth.uid() bo'lmasa (service_role, migratsiya, cron) — ruxsat.
  if old.deleted_at is not null and new.deleted_at is null
     and auth.uid() is not null
     and not private.has_role('super_admin', 'admin') then
    raise exception 'O''chirilgan yozuvni faqat administrator tiklay oladi'
      using errcode = '42501', hint = 'restore_admin_only';
  end if;
  if old.deleted_at is null and new.deleted_at is not null then
    new.deleted_at := now();
  elsif old.deleted_at is not null and new.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.tg_companies_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.is_super_admin()
     and (new.is_active is distinct from old.is_active
          or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'Firmani faollashtirish yoki o''chirish faqat tizim egasiga ruxsat etilgan'
      using errcode = '42501', hint = 'company_status_super_admin_only';
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 3 + 5 (birlik nomi) + 8. Miqdorni hisoblash: material → birlik qatori FOR SHARE.
--   Qulf tartibi (deadlock oldini olish): avval materials, keyin material_units.
--   Birlik qatori bitta so'rovda o'qiladi va qulflanadi — factor/unit parallel
--   tranzaksiya o'zgartira olmaydi (b_material_units_guard ham shu qatorni yangilaydi).
--   unit_id berilmasa — unit_input matni norm_name bo'yicha (variantsiz) qidiriladi.
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
  -- O'chirilgan birlik faqat eski (o'zgarmagan) qatorda qolishi mumkin.
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
    -- qty <= 0 bo'lsa CHECK yiqitadi; bu yerda nolga bo'linmaslik uchun 0
    new.unit_price     := coalesce(round(new.total_amount / nullif(new.qty_input, 0), 2), 0);
    new.price_per_base := coalesce(round(new.total_amount / nullif(new.qty_base, 0), 4), 0);
  end if;

  -- plpgsql AND ni qisqa tutashtirmaydi: new.purchase_id faqat movements da bor
  if tg_table_name = 'movements' then
    v_check_link := new.purchase_id is not null;
    if v_check_link and tg_op = 'UPDATE' then
      v_check_link := new.purchase_id is distinct from old.purchase_id
                   or new.material_id is distinct from old.material_id
                   or new.object_id   is distinct from old.object_id;
    end if;
    if v_check_link then
      select p.material_id, p.object_id into v_p_material, v_p_object
        from public.purchases p
       where p.company_id = new.company_id
         and p.id = new.purchase_id
         and p.deleted_at is null;
      if not found then
        raise exception 'Bog''langan xarid topilmadi yoki o''chirilgan'
          using errcode = '23503', hint = 'ops_purchase_not_found';
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

create or replace function private.tg_material_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_free constant text[] := array['status', 'note', 'updated_at', 'decided_by', 'decided_at'];
begin
  if tg_op = 'INSERT' then
    if new.status = 'kutilmoqda' then
      new.decided_by := null;
      new.decided_at := null;
    else
      new.decided_by := private.my_profile_id();
      new.decided_at := now();
    end if;
    return new;
  end if;

  if auth.uid() is not null and not private.has_role('super_admin', 'admin') then
    if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
      raise exception 'So''rovda faqat holat va izohni o''zgartirish mumkin'
        using errcode = '42501', hint = 'request_fields_locked';
    end if;
    if new.status is distinct from old.status
       and not ((old.status = 'kutilmoqda' and new.status in ('tasdiqlandi', 'rad'))
             or (old.status = 'tasdiqlandi' and new.status = 'xarid_qilindi')) then
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
  return new;
end;
$$;

create or replace function private.tg_inventory_counts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and new.status is distinct from old.status then
    raise exception 'Inventarizatsiya holati faqat "Yuborish" orqali o''zgaradi'
      using errcode = '42501', hint = 'inventory_status_direct';
  end if;
  return new;
end;
$$;

create or replace function public.submit_inventory_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.my_profile_id();
  v_count   public.inventory_counts%rowtype;
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

  update public.inventory_count_items i
     set qty_expected = coalesce((
           select sb.qty_base
             from public.stock_balances sb
            where sb.company_id = v_count.company_id
              and sb.object_id = v_count.object_id
              and sb.material_id = i.material_id
         ), 0)
   where i.company_id = v_count.company_id
     and i.inventory_count_id = v_count.id
     and i.deleted_at is null;

  update public.inventory_counts
     set status = 'submitted'
   where id = v_count.id;
end;
$$;

-- Shablon: idempotentlik norm_name bo'yicha (yangi unique indekslar bilan mos)
create or replace function private.template_material(
  p_company_id uuid, p_name text, p_base_unit text, p_category text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select m.id into v_id
    from public.materials m
   where m.company_id = p_company_id
     and private.norm_name(m.name) = private.norm_name(p_name)
     and m.deleted_at is null;
  if v_id is null then
    insert into public.materials (company_id, name, base_unit, category)
    values (p_company_id, p_name, p_base_unit, p_category)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function private.template_unit(
  p_company_id uuid, p_material_id uuid, p_unit text, p_factor numeric, p_variant text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.material_units (company_id, material_id, unit, factor, variant)
  select p_company_id, p_material_id, p_unit, p_factor, p_variant
   where not exists (
     select 1 from public.material_units u
      where u.material_id = p_material_id
        and private.norm_name(u.unit) = private.norm_name(p_unit)
        and coalesce(private.norm_name(u.variant), '') = coalesce(private.norm_name(p_variant), '')
        and u.deleted_at is null
   );
$$;

create or replace function private.template_alias(
  p_company_id uuid, p_material_id uuid, p_alias text, p_lang text default 'ru'
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.material_aliases (company_id, material_id, alias, lang)
  select p_company_id, p_material_id, p_alias, p_lang
   where not exists (
     select 1 from public.material_aliases a
      where a.company_id = p_company_id
        and private.norm_name(a.alias) = private.norm_name(p_alias)
        and a.deleted_at is null
   );
$$;

-- Shablonni qo'llash: xabarlar o'zbekcha + hint (tana Batch 1 dagidek)
create or replace function private.apply_material_template(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  -- Foydalanuvchi sessiyasida faqat super_admin (service_role / migratsiya / seed — ruxsat)
  if auth.uid() is not null and not private.is_super_admin() then
    raise exception 'Shablonni faqat tizim egasi qo''llay oladi' using errcode = '42501', hint = 'template_super_admin_only';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company_id and c.deleted_at is null) then
    raise exception 'Firma topilmadi' using errcode = 'P0002', hint = 'template_company_not_found';
  end if;

  -- G'isht (asosiy: dona)
  v := private.template_material(p_company_id, 'G''isht', 'dona', 'devor');
  perform private.template_unit(p_company_id, v, 'dona', 1);
  perform private.template_unit(p_company_id, v, 'poddon', 300);
  perform private.template_unit(p_company_id, v, 'm² devor', 51,  'yarim g''isht · 120 mm');
  perform private.template_unit(p_company_id, v, 'm² devor', 102, 'bir g''isht · 250 mm');
  perform private.template_unit(p_company_id, v, 'm² devor', 153, 'bir yarim g''isht · 380 mm');
  perform private.template_alias(p_company_id, v, 'Кирпич');

  -- Sement M400 (asosiy: kg)
  v := private.template_material(p_company_id, 'Sement M400', 'kg', 'bog''lovchi');
  perform private.template_unit(p_company_id, v, 'kg', 1);
  perform private.template_unit(p_company_id, v, 'qop', 50);
  perform private.template_unit(p_company_id, v, 'tonna', 1000);
  perform private.template_alias(p_company_id, v, 'Цемент М400');

  -- Sement M500 (asosiy: kg)
  v := private.template_material(p_company_id, 'Sement M500', 'kg', 'bog''lovchi');
  perform private.template_unit(p_company_id, v, 'kg', 1);
  perform private.template_unit(p_company_id, v, 'qop', 50);
  perform private.template_unit(p_company_id, v, 'tonna', 1000);
  perform private.template_alias(p_company_id, v, 'Цемент М500');

  -- Qum (asosiy: m³)
  v := private.template_material(p_company_id, 'Qum', 'm³', 'inert');
  perform private.template_unit(p_company_id, v, 'm³', 1);
  perform private.template_unit(p_company_id, v, 'tonna', 0.6667);
  perform private.template_alias(p_company_id, v, 'Песок');

  -- Shag'al (asosiy: m³)
  v := private.template_material(p_company_id, 'Shag''al', 'm³', 'inert');
  perform private.template_unit(p_company_id, v, 'm³', 1);
  perform private.template_unit(p_company_id, v, 'tonna', 0.7143);
  perform private.template_alias(p_company_id, v, 'Щебень');

  -- Armatura (asosiy: kg)
  v := private.template_material(p_company_id, 'Armatura', 'kg', 'metall');
  perform private.template_unit(p_company_id, v, 'kg', 1);
  perform private.template_unit(p_company_id, v, 'tonna', 1000);
  perform private.template_unit(p_company_id, v, 'metr', 0.395, 'Ø8');
  perform private.template_unit(p_company_id, v, 'metr', 0.617, 'Ø10');
  perform private.template_unit(p_company_id, v, 'metr', 0.888, 'Ø12');
  perform private.template_unit(p_company_id, v, 'metr', 1.21,  'Ø14');
  perform private.template_unit(p_company_id, v, 'metr', 1.58,  'Ø16');
  perform private.template_alias(p_company_id, v, 'Арматура');

  -- Beton (asosiy: m³)
  v := private.template_material(p_company_id, 'Beton', 'm³', 'beton');
  perform private.template_unit(p_company_id, v, 'm³', 1);
  perform private.template_alias(p_company_id, v, 'Бетон');

  -- Kafel (asosiy: m²)
  v := private.template_material(p_company_id, 'Kafel', 'm²', 'pardozlash');
  perform private.template_unit(p_company_id, v, 'm²', 1);
  perform private.template_unit(p_company_id, v, 'dona', 0.09, '30×30 sm');
  perform private.template_unit(p_company_id, v, 'dona', 0.36, '60×60 sm');
  perform private.template_alias(p_company_id, v, 'Плитка');
  perform private.template_alias(p_company_id, v, 'Кафель');
end;
$$;

-- ============================================================================
-- Yordamchilar
-- ============================================================================
-- Material biror yozuvda ishlatilganmi (o'chirilgan qatorlar ham — tiklanganda
-- b_compute_qty qty_base ni joriy factor bilan qayta hisoblaydi).
create function private.material_is_referenced(p_company_id uuid, p_material_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.movements t             where t.company_id = p_company_id and t.material_id = p_material_id)
      or exists (select 1 from public.purchases t             where t.company_id = p_company_id and t.material_id = p_material_id)
      or exists (select 1 from public.transfers t             where t.company_id = p_company_id and t.material_id = p_material_id)
      or exists (select 1 from public.material_requests t     where t.company_id = p_company_id and t.material_id = p_material_id)
      or exists (select 1 from public.inventory_count_items t where t.company_id = p_company_id and t.material_id = p_material_id)
      or exists (select 1 from public.estimate_items t        where t.company_id = p_company_id and t.material_id = p_material_id);
$$;

create function private.unit_is_referenced(p_company_id uuid, p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.movements t         where t.company_id = p_company_id and t.unit_id = p_unit_id)
      or exists (select 1 from public.purchases t         where t.company_id = p_company_id and t.unit_id = p_unit_id)
      or exists (select 1 from public.transfers t         where t.company_id = p_company_id and t.unit_id = p_unit_id)
      or exists (select 1 from public.material_requests t where t.company_id = p_company_id and t.unit_id = p_unit_id);
$$;

-- Firma ichida nom/alias tekshiruvlarini ketma-ket qilish (READ COMMITTED da:
-- qulfdan keyingi so'rov yangi snapshot oladi va parallel commit'ni ko'radi).
create function private.lock_catalog_names(p_company_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('terron.catalog_names:' || p_company_id::text, 0));
$$;

-- ============================================================================
-- materials: nom (dublikat, alias bilan to'qnashuv), asosiy birlik, soft delete
-- ============================================================================
create function private.tg_materials_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  -- 4. Nom: o'chirilmagan materiallar orasida norm_name bo'yicha
  if new.deleted_at is null
     and (tg_op = 'INSERT'
          or old.deleted_at is not null
          or private.norm_name(new.name) is distinct from private.norm_name(old.name)) then
    perform private.lock_catalog_names(new.company_id);
    if exists (
      select 1 from public.materials m
       where m.company_id = new.company_id
         and m.deleted_at is null
         and m.id <> new.id
         and private.norm_name(m.name) = private.norm_name(new.name)
    ) then
      raise exception '"%" nomli material allaqachon bor', new.name
        using errcode = '23505', hint = 'catalog_name_duplicate';
    end if;
    if exists (
      select 1
        from public.material_aliases a
        join public.materials m on m.company_id = a.company_id and m.id = a.material_id
       where a.company_id = new.company_id
         and a.deleted_at is null
         and m.deleted_at is null
         and a.material_id <> new.id
         and private.norm_name(a.alias) = private.norm_name(new.name)
    ) then
      raise exception '"%" boshqa materialning muqobil nomi sifatida ishlatilgan', new.name
        using errcode = 'P0001', hint = 'catalog_name_alias_conflict';
    end if;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  -- 1. Asosiy birlik
  if new.base_unit is distinct from old.base_unit then
    if private.material_is_referenced(new.company_id, new.id) then
      raise exception 'Asosiy birlikni o''zgartirib bo''lmaydi: material yozuvlarda ishlatilgan. Yangi material yarating.'
        using errcode = 'P0001', hint = 'catalog_base_unit_in_use';
    end if;
    if exists (
      select 1 from public.material_units u
       where u.company_id = new.company_id
         and u.material_id = new.id
         and u.variant is null
         and u.deleted_at is null
         and private.norm_name(u.unit) = private.norm_name(new.base_unit)
         and not (u.unit = old.base_unit and u.factor = 1)   -- asosiy qatorning o'zi
    ) then
      raise exception 'Materialda "%" birligi allaqachon bor — avval uni o''chiring', new.base_unit
        using errcode = 'P0001', hint = 'catalog_base_unit_conflict';
    end if;
  end if;

  -- 5. Soft delete: qoldiq nolga teng bo'lmagan obyekt bo'lsa — taqiqlanadi
  if new.deleted_at is not null and old.deleted_at is null then
    select o.name into v_name
      from public.stock_balances sb
      join public.objects o on o.company_id = sb.company_id and o.id = sb.object_id
     where sb.company_id = new.company_id
       and sb.material_id = new.id
       and sb.qty_base <> 0
     order by o.name
     limit 1;
    if found then
      raise exception 'Materialni o''chirib bo''lmaydi: "%" obyektida qoldig''i bor. Uni nofaol qiling.', v_name
        using errcode = 'P0001', hint = 'catalog_material_has_stock';
    end if;
  end if;

  return new;
end;
$$;

create trigger b_materials_guard before insert or update on public.materials
  for each row execute function private.tg_materials_guard();

-- 1. Asosiy birlik o'zgarganda (ishlatilmagan material) — factor = 1 qatori ham
create function private.tg_materials_base_unit_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.material_units u
     set unit = new.base_unit
   where u.company_id = new.company_id
     and u.material_id = new.id
     and u.unit = old.base_unit
     and u.factor = 1
     and u.variant is null
     and u.deleted_at is null;
  if not found then
    insert into public.material_units (company_id, material_id, unit, factor)
    values (new.company_id, new.id, new.base_unit, 1);
  end if;
  return null;
end;
$$;

create trigger c_base_unit_sync after update of base_unit on public.materials
  for each row when (new.base_unit is distinct from old.base_unit)
  execute function private.tg_materials_base_unit_sync();

-- 6. Material o'chirilganda — uning faol alias'lari ham (aynan shu deleted_at bilan);
--    tiklanganda — faqat shu deleted_at li alias'lar (oldin qo'lda o'chirilganlari emas).
--    Tiklashdagi to'qnashuvni b_material_aliases_guard aniq xato bilan to'xtatadi.
create function private.tg_materials_aliases_cascade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.material_aliases a
       set deleted_at = new.deleted_at
     where a.company_id = new.company_id
       and a.material_id = new.id
       and a.deleted_at is null;
  elsif old.deleted_at is not null and new.deleted_at is null then
    update public.material_aliases a
       set deleted_at = null
     where a.company_id = new.company_id
       and a.material_id = new.id
       and a.deleted_at = old.deleted_at;
  end if;
  return null;
end;
$$;

create trigger c_aliases_cascade after update of deleted_at on public.materials
  for each row when (new.deleted_at is distinct from old.deleted_at)
  execute function private.tg_materials_aliases_cascade();

-- ============================================================================
-- material_units: o'chirilgan material, dublikat, asosiy birlik qatori, ishlatilgan birlik
-- ============================================================================
create function private.tg_material_units_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_unit text;
  v_changed   boolean;
  v_is_base   boolean;
  v_live      boolean;
begin
  -- qator "tirik" bo'ladi: insert, tiklash yoki boshqa materialga ko'chirish
  v_live := new.deleted_at is null
        and (tg_op = 'INSERT'
             or old.deleted_at is not null
             or new.material_id is distinct from old.material_id
             or private.norm_name(new.unit) is distinct from private.norm_name(old.unit)
             or private.norm_name(new.variant) is distinct from private.norm_name(old.variant));

  if v_live then
    -- 6. o'chirilgan materialga birlik qo'shib / ko'chirib / tiklab bo'lmaydi
    if exists (
      select 1 from public.materials m
       where m.company_id = new.company_id and m.id = new.material_id and m.deleted_at is not null
    ) then
      raise exception 'Material o''chirilgan — unga birlik qo''shib bo''lmaydi'
        using errcode = 'P0001', hint = 'catalog_material_deleted';
    end if;
    -- 5. dublikat (norm_name; unique indeks — zaxira)
    if exists (
      select 1 from public.material_units u
       where u.company_id = new.company_id
         and u.material_id = new.material_id
         and u.deleted_at is null
         and u.id <> new.id
         and private.norm_name(u.unit) = private.norm_name(new.unit)
         and coalesce(private.norm_name(u.variant), '') = coalesce(private.norm_name(new.variant), '')
    ) then
      raise exception 'Materialda "%" birligi allaqachon bor', new.unit
        using errcode = '23505', hint = 'catalog_unit_duplicate';
    end if;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  v_changed := new.factor      is distinct from old.factor
            or new.unit        is distinct from old.unit
            or new.variant     is distinct from old.variant
            or new.material_id is distinct from old.material_id;

  select m.base_unit into v_base_unit
    from public.materials m
   where m.company_id = old.company_id and m.id = old.material_id;

  -- Asosiy birlik qatori: material.base_unit nomi, factor = 1, variantsiz, faol.
  -- (Asosiy birlik o'zgarganda c_base_unit_sync materials yangilangandan keyin
  -- ishlaydi — u paytda eski qator endi asosiy hisoblanmaydi.)
  v_is_base := old.deleted_at is null
           and old.factor = 1
           and old.variant is null
           and old.unit = v_base_unit;

  if v_is_base and (v_changed or new.deleted_at is not null) then
    raise exception 'Asosiy birlik qatorini o''zgartirib yoki o''chirib bo''lmaydi'
      using errcode = 'P0001', hint = 'catalog_base_unit_locked';
  end if;

  if v_changed and private.unit_is_referenced(old.company_id, old.id) then
    raise exception 'Bu birlik yozuvlarda ishlatilgan — koeffitsient va nomini o''zgartirib bo''lmaydi. Yangi birlik qo''shib, eskisini o''chiring.'
      using errcode = 'P0001', hint = 'catalog_unit_in_use';
  end if;

  return new;
end;
$$;

create trigger b_material_units_guard before insert or update on public.material_units
  for each row execute function private.tg_material_units_guard();

-- ============================================================================
-- material_aliases: o'chirilgan material, dublikat, boshqa material nomi bilan to'qnashuv
-- ============================================================================
create function private.tg_material_aliases_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.deleted_at is null
     and private.norm_name(new.alias) is not distinct from private.norm_name(old.alias)
     and new.material_id is not distinct from old.material_id then
    return new;
  end if;

  -- 6. o'chirilgan materialga alias qo'shib / ko'chirib / tiklab bo'lmaydi
  if exists (
    select 1 from public.materials m
     where m.company_id = new.company_id and m.id = new.material_id and m.deleted_at is not null
  ) then
    raise exception 'Material o''chirilgan — unga muqobil nom qo''shib bo''lmaydi'
      using errcode = 'P0001', hint = 'catalog_material_deleted';
  end if;

  perform private.lock_catalog_names(new.company_id);
  if exists (
    select 1 from public.material_aliases a
     where a.company_id = new.company_id
       and a.deleted_at is null
       and a.id <> new.id
       and private.norm_name(a.alias) = private.norm_name(new.alias)
  ) then
    raise exception '"%" muqobil nomi allaqachon bor', new.alias
      using errcode = '23505', hint = 'catalog_alias_duplicate';
  end if;
  if exists (
    select 1 from public.materials m
     where m.company_id = new.company_id
       and m.deleted_at is null
       and m.id <> new.material_id
       and private.norm_name(m.name) = private.norm_name(new.alias)
  ) then
    raise exception '"%" muqobil nomi boshqa material nomi bilan bir xil', new.alias
      using errcode = 'P0001', hint = 'catalog_name_alias_conflict';
  end if;
  return new;
end;
$$;

create trigger b_material_aliases_guard before insert or update on public.material_aliases
  for each row execute function private.tg_material_aliases_guard();

-- ============================================================================
-- Operatsiyalar: nofaol / o'chirilgan material.
--   * Yangi qator yoki material_id o'zgarishi:
--       o'chirilgan material — barcha 6 jadvalda taqiqlanadi;
--       nofaol material — purchases, transfers, material_requests, movements (kirim/chiqim).
--   * Mavjud qator, materiali o'chirilgan: faqat izoh/rasm (va trigger hisoblaydigan
--     ustunlar) o'zgaradi — soft delete, tiklash, miqdor, birlik, tur, obyekt,
--     bog'lanishlar — taqiqlanadi (o'chirilgan materialning qoldig'i "tirilmasin").
--   Material qatori FOR SHARE bilan qulflanadi. Trigger nomi b_check_* —
--   b_compute_qty dan oldin ishlaydi (alifbo tartibi).
-- ============================================================================
create function private.tg_ops_material_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- materiali o'chirilgan qatorda o'zgarishi mumkin bo'lgan ustunlar:
  -- izoh, rasm va trigger o'zi hisoblaydiganlar
  v_free constant text[] := array['note', 'photo_path', 'receipt_photo_path', 'updated_at',
                                  'qty_base', 'unit_input', 'unit_variant', 'unit_price',
                                  'price_per_base', 'qty_expected'];
  v_new         jsonb := to_jsonb(new);
  v_material    uuid  := (v_new ->> 'material_id')::uuid;
  v_old_mat     uuid;
  v_active      boolean;
  v_deleted     timestamptz;
  v_name        text;
  v_need_active boolean;
begin
  if tg_op = 'UPDATE' then
    v_old_mat := (to_jsonb(old) ->> 'material_id')::uuid;
    if v_old_mat is not null then
      select m.deleted_at, m.name into v_deleted, v_name
        from public.materials m
       where m.company_id = old.company_id and m.id = v_old_mat
         for share;
      if v_deleted is not null
         and (v_new - v_free) is distinct from (to_jsonb(old) - v_free) then
        raise exception 'Material o''chirilgan (%) — yozuvda faqat izoh va rasmni o''zgartirish mumkin', v_name
          using errcode = 'P0001', hint = 'catalog_material_deleted';
      end if;
    end if;
    if v_material is not distinct from v_old_mat then
      return new;
    end if;
  end if;

  if v_material is null then
    return new;   -- estimate_items: ish turi (materialsiz)
  end if;

  select m.is_active, m.deleted_at, m.name into v_active, v_deleted, v_name
    from public.materials m
   where m.company_id = new.company_id and m.id = v_material
     for share;
  if not found then
    return new;   -- kompozit FK xato beradi
  end if;

  if v_deleted is not null then
    raise exception 'Material o''chirilgan: %', v_name
      using errcode = 'P0001', hint = 'catalog_material_deleted';
  end if;

  v_need_active := case tg_table_name
    when 'movements' then (v_new ->> 'type') in ('kirim', 'chiqim')
    when 'purchases' then true
    when 'transfers' then true
    when 'material_requests' then true
    else false
  end;
  if v_need_active and not v_active then
    raise exception 'Material nofaol: %', v_name
      using errcode = 'P0001', hint = 'catalog_material_inactive';
  end if;

  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['movements', 'purchases', 'transfers', 'material_requests',
                           'inventory_count_items', 'estimate_items'] loop
    execute format('create trigger b_check_material before insert or update on public.%I
                      for each row execute function private.tg_ops_material_guard()', t);
  end loop;
end $$;

revoke execute on function
  private.material_is_referenced(uuid, uuid),
  private.unit_is_referenced(uuid, uuid),
  private.lock_catalog_names(uuid),
  private.tg_materials_guard(),
  private.tg_materials_base_unit_sync(),
  private.tg_materials_aliases_cascade(),
  private.tg_material_units_guard(),
  private.tg_material_aliases_guard(),
  private.tg_ops_material_guard()
from public, anon, authenticated;
