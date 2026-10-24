-- ============================================================================
-- Batch 1 · 02 — katalog: materials, material_units, material_aliases, suppliers
-- ============================================================================

create table public.materials (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id),
  name        text not null check (btrim(name) <> ''),
  base_unit   text not null check (btrim(base_unit) <> ''),
  waste_pct   numeric(6,2) not null default 0 check (waste_pct >= 0 and waste_pct < 100),
  category    text,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint materials_company_id_id_key unique (company_id, id)
);
create unique index materials_company_name_key on public.materials (company_id, lower(name))
  where deleted_at is null;
create index materials_created_by_idx on public.materials (created_by);

-- 1 `unit` = `factor` asosiy birlik. Asosiy birlikning o'zi ham factor = 1 bilan saqlanadi.
create table public.material_units (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id),
  material_id  uuid not null,
  unit         text not null check (btrim(unit) <> ''),
  factor       numeric(20,10) not null check (factor > 0),
  variant      text check (variant is null or btrim(variant) <> ''),
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint material_units_company_id_id_key unique (company_id, id),
  constraint material_units_material_fkey foreign key (company_id, material_id)
    references public.materials (company_id, id)
);
create unique index material_units_material_unit_variant_key
  on public.material_units (material_id, unit, coalesce(variant, ''))
  where deleted_at is null;
create index material_units_company_material_idx on public.material_units (company_id, material_id);
create index material_units_created_by_idx on public.material_units (created_by);

-- Har material yaratilganda uning asosiy birligi (factor = 1) ham birlik qatori sifatida
-- qo'shiladi — kirim/chiqim/xarid har doim unit_id ga tayanadi.
create function private.tg_materials_base_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.material_units (company_id, material_id, unit, factor)
  select new.company_id, new.id, new.base_unit, 1
   where not exists (
     select 1 from public.material_units u
      where u.material_id = new.id
        and u.unit = new.base_unit
        and u.variant is null
        and u.deleted_at is null
   );
  return null;
end;
$$;

create trigger b_base_unit after insert on public.materials
  for each row execute function private.tg_materials_base_unit();

revoke execute on function private.tg_materials_base_unit() from public, anon, authenticated;

create table public.material_aliases (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id),
  material_id  uuid not null,
  alias        text not null check (btrim(alias) <> ''),
  lang         text not null default 'ru' check (lang in ('ru', 'uz')),
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint material_aliases_company_id_id_key unique (company_id, id),
  constraint material_aliases_material_fkey foreign key (company_id, material_id)
    references public.materials (company_id, id)
);
create unique index material_aliases_company_alias_key on public.material_aliases (company_id, lower(alias))
  where deleted_at is null;
create index material_aliases_company_material_idx on public.material_aliases (company_id, material_id);
create index material_aliases_created_by_idx on public.material_aliases (created_by);

create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id),
  name        text not null check (btrim(name) <> ''),
  phone       text,
  note        text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint suppliers_company_id_id_key unique (company_id, id)
);
create index suppliers_created_by_idx on public.suppliers (created_by);
