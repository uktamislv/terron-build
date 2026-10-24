-- ============================================================================
-- Batch 1 · 01 — asos: private sxema, enum turlar, companies, profiles,
-- objects, object_members va RLS yordamchi funksiyalari.
-- Shartnoma: docs/db-design.md
-- ============================================================================

-- Migratsiya egasi (Supabase'da `postgres`) RLS'ni chetlab o'tishi kerak:
-- security definer yordamchi funksiyalar `force row level security` yoqilgan
-- profiles/object_members ni o'qiydi. Aks holda siyosatlar rekursiyaga tushadi.
do $$
begin
  if not exists (
    select 1 from pg_roles
     where rolname = current_user and (rolsuper or rolbypassrls)
  ) then
    raise exception 'Migratsiya egasi (%) BYPASSRLS emas — private.* yordamchi funksiyalari ishlamaydi', current_user;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- public: kelajakdagi obyektlar uchun Supabase default grantlarini yopamiz.
-- Supabase `postgres` yaratgan har yangi jadval/sequence/funksiyani anon va
-- authenticated ga avtomatik ochadi. Har migratsiya grantni aniq beradi.
-- ----------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
-- DIQQAT: sxema darajasidagi default privileges faqat qo'shilgan grantlarni (Supabase'ning
-- anon/authenticated) olib tashlaydi; PostgreSQL'ning global PUBLIC EXECUTE'i qoladi.
-- Global `revoke ... from public` (sxemasiz) extension funksiyalariga ham ta'sir qilardi,
-- shuning uchun ishlatilmaydi: har yangi public funksiya `revoke execute ... from public, anon`
-- ni o'zi qiladi (masalan public.submit_inventory_count).

-- ----------------------------------------------------------------------------
-- private sxema (PostgREST orqali ochiq emas)
-- ----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
-- Bu sxemada keyin yaratiladigan funksiyalar standart holatda hammaga ochiq bo'lmasin.
alter default privileges in schema private revoke execute on functions from public;

-- ----------------------------------------------------------------------------
-- Enum turlar
-- ----------------------------------------------------------------------------
create type public.user_role as enum (
  'super_admin', 'admin', 'direktor', 'buxgalter', 'taminotchi',
  'prorab', 'omborchi', 'haydovchi', 'tekshiruvchi'
);
create type public.object_status as enum ('faol', 'yakunlangan', 'toxtatilgan');
create type public.movement_type as enum ('kirim', 'chiqim', 'transfer_out', 'transfer_in', 'inventory_adjust');
create type public.inventory_status as enum ('draft', 'submitted');
create type public.estimate_item_type as enum ('ish', 'material');
create type public.request_status as enum ('kutilmoqda', 'tasdiqlandi', 'rad', 'xarid_qilindi');
create type public.transfer_status as enum ('yuborildi', 'qabul_qilindi', 'bekor');
create type public.alert_type as enum (
  'xarid_qabul_farqi', 'ozi_qabul_qilgan', 'narx_ogishi',
  'normadan_oshish', 'inventarizatsiya_kamomadi', 'smetadan_ortiq_sorov'
);
create type public.alert_status as enum ('yangi', 'korildi', 'yopildi');
create type public.alert_severity as enum ('belgi', 'ogohlantirish', 'jiddiy');

-- ----------------------------------------------------------------------------
-- companies — firmalar va ularning sozlamalari
-- ----------------------------------------------------------------------------
create table public.companies (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (btrim(name) <> ''),
  -- Xarid ≠ qabul: farq shu foizdan oshsa ogohlantirish
  receipt_mismatch_pct  numeric(6,2) not null default 2 check (receipt_mismatch_pct >= 0),
  -- Narx og'ishi: oxirgi N xarid o'rtachasidan shu foizdan ko'p bo'lsa
  price_deviation_pct   numeric(6,2) not null default 8 check (price_deviation_pct >= 0),
  price_avg_window      integer not null default 5 check (price_avg_window between 1 and 100),
  timezone              text not null default 'Asia/Tashkent',
  is_active             boolean not null default true,
  created_by            uuid,            -- FK profiles yaratilgandan keyin qo'shiladi
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create index companies_created_by_idx on public.companies (created_by);

-- ----------------------------------------------------------------------------
-- profiles — foydalanuvchilar (auth akkaunt keyin bog'lanadi)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id),
  auth_user_id      uuid references auth.users (id) on delete set null,
  role              public.user_role not null,
  full_name         text not null check (btrim(full_name) <> ''),
  -- E.164: '+' va 9–15 raqam (normallashtirish ilova/Edge Function'da)
  phone             text not null check (phone ~ '^\+[0-9]{9,15}$'),
  telegram_user_id  bigint,
  telegram_chat_id  bigint,
  is_active         boolean not null default true,
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint profiles_company_id_id_key unique (company_id, id)
);
-- Bitta auth akkaunt / Telegram foydalanuvchisi — bitta faol profil.
create unique index profiles_auth_user_id_key on public.profiles (auth_user_id)
  where auth_user_id is not null and deleted_at is null;
create unique index profiles_telegram_user_id_key on public.profiles (telegram_user_id)
  where telegram_user_id is not null and deleted_at is null;
create unique index profiles_company_phone_key on public.profiles (company_id, phone)
  where deleted_at is null;
create index profiles_created_by_idx on public.profiles (created_by);

-- Telefon o'zgarsa, eski auth/Telegram bog'lanishi yangi raqamga o'tmasin.
-- (Agar shu UPDATE bog'lanish ustunlarini ham o'zgartirsa — masalan service_role
-- bog'lash oqimi — ular saqlanadi.)
create function private.tg_profiles_phone_unlink()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.phone is distinct from old.phone then
    if new.auth_user_id is not distinct from old.auth_user_id then
      new.auth_user_id := null;
    end if;
    if new.telegram_user_id is not distinct from old.telegram_user_id then
      new.telegram_user_id := null;
    end if;
    if new.telegram_chat_id is not distinct from old.telegram_chat_id then
      new.telegram_chat_id := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger b_profiles_phone_unlink before update on public.profiles
  for each row execute function private.tg_profiles_phone_unlink();

revoke execute on function private.tg_profiles_phone_unlink() from public, anon, authenticated;

alter table public.companies
  add constraint companies_created_by_fkey foreign key (created_by) references public.profiles (id);

-- ----------------------------------------------------------------------------
-- objects — qurilish obyektlari
-- ----------------------------------------------------------------------------
create table public.objects (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id),
  name        text not null check (btrim(name) <> ''),
  address     text,
  status      public.object_status not null default 'faol',
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint objects_company_id_id_key unique (company_id, id)
);
create index objects_created_by_idx on public.objects (created_by);

-- ----------------------------------------------------------------------------
-- object_members — foydalanuvchi ↔ obyekt (ko'pga-ko'p)
-- ----------------------------------------------------------------------------
create table public.object_members (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id),
  object_id   uuid not null,
  profile_id  uuid not null,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint object_members_company_id_id_key unique (company_id, id),
  constraint object_members_object_fkey  foreign key (company_id, object_id)  references public.objects (company_id, id),
  constraint object_members_profile_fkey foreign key (company_id, profile_id) references public.profiles (company_id, id)
);
create unique index object_members_object_profile_key on public.object_members (object_id, profile_id)
  where deleted_at is null;
create index object_members_company_object_idx on public.object_members (company_id, object_id);
create index object_members_company_profile_idx on public.object_members (company_id, profile_id);
-- private.my_object_ids() / can_access_object() uchun
create index object_members_profile_active_idx on public.object_members (profile_id, object_id)
  where deleted_at is null;
create index object_members_created_by_idx on public.object_members (created_by);

-- ----------------------------------------------------------------------------
-- RLS yordamchi funksiyalari (security definer, faqat joriy foydalanuvchi haqida)
-- ----------------------------------------------------------------------------

-- Joriy faol (o'chirilmagan, is_active) profil id. Firma ham faol va o'chirilmagan bo'lishi shart —
-- aks holda my_profile_id/my_company_id/my_role null va foydalanuvchi hech narsani ko'rmaydi.
create function private.my_profile_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select p.id
    from public.profiles p
    join public.companies c on c.id = p.company_id
   where p.auth_user_id = auth.uid()
     and p.deleted_at is null
     and p.is_active
     and c.deleted_at is null
     and c.is_active
   limit 1
$$;

create function private.my_company_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select p.company_id
    from public.profiles p
    join public.companies c on c.id = p.company_id
   where p.auth_user_id = auth.uid()
     and p.deleted_at is null
     and p.is_active
     and c.deleted_at is null
     and c.is_active
   limit 1
$$;

create function private.my_role()
returns public.user_role
language sql stable security definer
set search_path = ''
as $$
  select p.role
    from public.profiles p
    join public.companies c on c.id = p.company_id
   where p.auth_user_id = auth.uid()
     and p.deleted_at is null
     and p.is_active
     and c.deleted_at is null
     and c.is_active
   limit 1
$$;

create function private.is_super_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(private.my_role() = 'super_admin', false)
$$;

create function private.has_role(variadic roles public.user_role[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(private.my_role() = any (roles), false)
$$;

-- Firma bo'yicha rollar: barcha obyektlarni ko'radi
create function private.is_company_wide()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    private.my_role() in ('super_admin', 'admin', 'direktor', 'buxgalter', 'taminotchi', 'tekshiruvchi'),
    false
  )
$$;

create function private.can_access_company(target_company_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(private.is_super_admin() or target_company_id = private.my_company_id(), false)
$$;

-- Joriy foydalanuvchi a'zo bo'lgan (o'chirilmagan) obyektlar
create function private.my_object_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select m.object_id
    from public.object_members m
    join public.objects o on o.id = m.object_id and o.deleted_at is null
   where m.profile_id = private.my_profile_id()
     and m.deleted_at is null
$$;

-- Obyektga kirish: firma bo'yicha rol yoki object_members da a'zo
create function private.can_access_object(target_object_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.objects o
     where o.id = target_object_id
       and o.deleted_at is null
       and (private.is_super_admin() or o.company_id = private.my_company_id())
       and (
         private.is_company_wide()
         or exists (
           select 1
             from public.object_members m
            where m.object_id = o.id
              and m.profile_id = private.my_profile_id()
              and m.deleted_at is null
         )
       )
  )
$$;
