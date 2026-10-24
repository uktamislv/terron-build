-- ============================================================================
-- Batch 1 · 07 — materiallar shabloni. Yangi firma uchun chaqiriladi (SaaS),
-- idempotent: qayta chaqirilsa mavjud material/birlik/nom takrorlanmaydi.
-- Koeffitsientlar taxminiy — firma keyin o'zgartiradi.
-- ============================================================================

-- Material: nom bo'yicha (katta-kichik harfsiz, o'chirilmaganlar orasida) topadi yoki yaratadi
create function private.template_material(
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
     and lower(m.name) = lower(p_name)
     and m.deleted_at is null;
  if v_id is null then
    insert into public.materials (company_id, name, base_unit, category)
    values (p_company_id, p_name, p_base_unit, p_category)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create function private.template_unit(
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
        and u.unit = p_unit
        and coalesce(u.variant, '') = coalesce(p_variant, '')
        and u.deleted_at is null
   );
$$;

create function private.template_alias(
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
        and lower(a.alias) = lower(p_alias)
        and a.deleted_at is null
   );
$$;

create function private.apply_material_template(p_company_id uuid)
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
    raise exception 'apply_material_template: only super_admin' using errcode = '42501';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company_id and c.deleted_at is null) then
    raise exception 'apply_material_template: company % not found', p_company_id using errcode = 'P0002';
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

-- Faqat tizim (service_role — yangi firma yaratuvchi Edge Function) chaqiradi.
-- authenticated ga ochilmaydi: private sxema API'da yo'q, lekin baribir yopiq.
revoke execute on function
  private.template_material(uuid, text, text, text),
  private.template_unit(uuid, uuid, text, numeric, text),
  private.template_alias(uuid, uuid, text, text),
  private.apply_material_template(uuid)
from public, anon, authenticated;

grant execute on function private.apply_material_template(uuid) to service_role;
