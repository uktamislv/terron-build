-- ============================================================================
-- Batch 1 · 03 — operatsiyalar: podotchet, xarid, o'tkazma, inventarizatsiya,
-- smeta, so'rov, ombor harakatlari, ogohlantirishlar.
-- Pul — numeric(18,2), miqdor — numeric(20,6). Firmalararo havolalar — kompozit FK.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- cash_advances — kimga qancha pul berildi (podotchet)
-- ----------------------------------------------------------------------------
create table public.cash_advances (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id),
  recipient_id  uuid not null,
  amount        numeric(18,2) not null check (amount > 0),
  issued_at     timestamptz not null default now(),
  note          text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint cash_advances_company_id_id_key unique (company_id, id),
  constraint cash_advances_recipient_fkey foreign key (company_id, recipient_id)
    references public.profiles (company_id, id)
);
create index cash_advances_company_recipient_idx on public.cash_advances (company_id, recipient_id);
create index cash_advances_created_by_idx on public.cash_advances (created_by);

-- ----------------------------------------------------------------------------
-- purchases — xaridlar
-- ----------------------------------------------------------------------------
create table public.purchases (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id),
  buyer_id            uuid not null,
  object_id           uuid not null,
  material_id         uuid not null,
  supplier_id         uuid,
  -- Birlik: unit_id — haqiqat manbai; unit_input, unit_variant, qty_base — trigger hisoblaydi
  unit_id             uuid not null,
  qty_input           numeric(20,6) not null check (qty_input > 0),
  unit_input          text not null check (btrim(unit_input) <> ''),
  unit_variant        text,
  qty_base            numeric(20,6) not null,
  -- Pul: foydalanuvchi jami summani kiritadi (chekdagidek) — total_amount haqiqat manbai.
  -- unit_price (kiritilgan birlik narxi) va price_per_base (asosiy birlik narxi) — trigger hisoblaydi.
  total_amount        numeric(18,2) not null,
  unit_price          numeric(18,2) not null check (unit_price >= 0),
  price_per_base      numeric(18,4) not null check (price_per_base >= 0),
  receipt_photo_path  text,
  purchased_at        timestamptz not null default now(),
  note                text,
  created_by          uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint purchases_company_id_id_key unique (company_id, id),
  constraint purchases_qty_total_check check (qty_base > 0 and total_amount >= 0),
  constraint purchases_buyer_fkey    foreign key (company_id, buyer_id)    references public.profiles (company_id, id),
  constraint purchases_object_fkey   foreign key (company_id, object_id)   references public.objects (company_id, id),
  constraint purchases_material_fkey foreign key (company_id, material_id) references public.materials (company_id, id),
  constraint purchases_supplier_fkey foreign key (company_id, supplier_id) references public.suppliers (company_id, id),
  constraint purchases_unit_fkey     foreign key (company_id, unit_id)     references public.material_units (company_id, id)
);
create index purchases_company_unit_idx     on public.purchases (company_id, unit_id);
create index purchases_company_buyer_idx    on public.purchases (company_id, buyer_id);
create index purchases_company_object_idx   on public.purchases (company_id, object_id);
create index purchases_company_supplier_idx on public.purchases (company_id, supplier_id);
-- narx og'ishi qoidasi: material bo'yicha oxirgi N xarid
create index purchases_company_material_time_idx on public.purchases (company_id, material_id, purchased_at desc)
  where deleted_at is null;
create index purchases_created_by_idx on public.purchases (created_by);

-- ----------------------------------------------------------------------------
-- transfers — obyektlar orasida o'tkazma
-- ----------------------------------------------------------------------------
create table public.transfers (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id),
  from_object_id  uuid not null,
  to_object_id    uuid not null,
  material_id     uuid not null,
  unit_id         uuid not null,
  qty_input       numeric(20,6) not null check (qty_input > 0),
  unit_input      text not null check (btrim(unit_input) <> ''),
  unit_variant    text,
  qty_base        numeric(20,6) not null check (qty_base > 0),
  status          public.transfer_status not null default 'yuborildi',
  note            text,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint transfers_company_id_id_key unique (company_id, id),
  constraint transfers_objects_differ_check check (from_object_id <> to_object_id),
  constraint transfers_from_object_fkey foreign key (company_id, from_object_id) references public.objects (company_id, id),
  constraint transfers_to_object_fkey   foreign key (company_id, to_object_id)   references public.objects (company_id, id),
  constraint transfers_material_fkey    foreign key (company_id, material_id)    references public.materials (company_id, id),
  constraint transfers_unit_fkey        foreign key (company_id, unit_id)        references public.material_units (company_id, id)
);
create index transfers_company_unit_idx     on public.transfers (company_id, unit_id);
create index transfers_company_from_idx     on public.transfers (company_id, from_object_id);
create index transfers_company_to_idx       on public.transfers (company_id, to_object_id);
create index transfers_company_material_idx on public.transfers (company_id, material_id);
create index transfers_created_by_idx       on public.transfers (created_by);

-- ----------------------------------------------------------------------------
-- inventory_counts, inventory_count_items — inventarizatsiya
-- ----------------------------------------------------------------------------
create table public.inventory_counts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id),
  object_id   uuid not null,
  status      public.inventory_status not null default 'draft',
  counted_at  timestamptz not null default now(),
  note        text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint inventory_counts_company_id_id_key unique (company_id, id),
  constraint inventory_counts_object_fkey foreign key (company_id, object_id) references public.objects (company_id, id)
);
create index inventory_counts_company_object_idx on public.inventory_counts (company_id, object_id);
create index inventory_counts_created_by_idx on public.inventory_counts (created_by);

create table public.inventory_count_items (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id),
  inventory_count_id  uuid not null,
  material_id         uuid not null,
  qty_counted         numeric(20,6) not null check (qty_counted >= 0),
  -- yuborish paytidagi hisobdagi qoldiq (asosiy birlikda)
  qty_expected        numeric(20,6),
  note                text,
  created_by          uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint inventory_count_items_company_id_id_key unique (company_id, id),
  constraint inventory_count_items_count_fkey foreign key (company_id, inventory_count_id)
    references public.inventory_counts (company_id, id),
  constraint inventory_count_items_material_fkey foreign key (company_id, material_id)
    references public.materials (company_id, id)
);
create unique index inventory_count_items_count_material_key
  on public.inventory_count_items (inventory_count_id, material_id)
  where deleted_at is null;
create index inventory_count_items_company_count_idx    on public.inventory_count_items (company_id, inventory_count_id);
create index inventory_count_items_company_material_idx on public.inventory_count_items (company_id, material_id);
create index inventory_count_items_created_by_idx       on public.inventory_count_items (created_by);

-- ----------------------------------------------------------------------------
-- estimates, estimate_items — smeta versiyalari
-- ----------------------------------------------------------------------------
create table public.estimates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id),
  object_id         uuid not null,
  version           integer not null check (version > 0),
  title             text not null check (btrim(title) <> ''),
  estimate_date     date,
  source_file_name  text,
  is_current        boolean not null default false,
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint estimates_company_id_id_key unique (company_id, id),
  constraint estimates_object_fkey foreign key (company_id, object_id) references public.objects (company_id, id)
);
create unique index estimates_object_version_key on public.estimates (object_id, version)
  where deleted_at is null;
-- obyekt uchun bitta joriy smeta
create unique index estimates_object_current_key on public.estimates (object_id)
  where is_current and deleted_at is null;
create index estimates_company_object_idx on public.estimates (company_id, object_id);
create index estimates_created_by_idx on public.estimates (created_by);

create table public.estimate_items (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id),
  estimate_id    uuid not null,
  item_type      public.estimate_item_type not null,
  name           text not null check (btrim(name) <> ''),
  material_id    uuid,
  unit           text,
  qty            numeric(20,6) not null default 0 check (qty >= 0),
  unit_price     numeric(18,2) check (unit_price >= 0),
  -- norma asosiy birlikda (materiallar uchun)
  norm_qty_base  numeric(20,6) check (norm_qty_base >= 0),
  sort_order     integer not null default 0,
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint estimate_items_company_id_id_key unique (company_id, id),
  constraint estimate_items_estimate_fkey foreign key (company_id, estimate_id) references public.estimates (company_id, id),
  constraint estimate_items_material_fkey foreign key (company_id, material_id) references public.materials (company_id, id)
);
create index estimate_items_company_estimate_idx on public.estimate_items (company_id, estimate_id, sort_order);
create index estimate_items_company_material_idx on public.estimate_items (company_id, material_id);
create index estimate_items_created_by_idx on public.estimate_items (created_by);

-- ----------------------------------------------------------------------------
-- material_requests — prorab so'rovlari
-- ----------------------------------------------------------------------------
create table public.material_requests (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id),
  object_id    uuid not null,
  material_id  uuid not null,
  unit_id      uuid not null,
  qty_input    numeric(20,6) not null check (qty_input > 0),
  unit_input   text not null check (btrim(unit_input) <> ''),
  unit_variant text,
  qty_base     numeric(20,6) not null check (qty_base > 0),
  status       public.request_status not null default 'kutilmoqda',
  needed_by    date,
  decided_by   uuid,
  decided_at   timestamptz,
  note         text,
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint material_requests_company_id_id_key unique (company_id, id),
  constraint material_requests_object_fkey   foreign key (company_id, object_id)   references public.objects (company_id, id),
  constraint material_requests_material_fkey foreign key (company_id, material_id) references public.materials (company_id, id),
  constraint material_requests_decided_by_fkey foreign key (company_id, decided_by) references public.profiles (company_id, id),
  constraint material_requests_unit_fkey foreign key (company_id, unit_id) references public.material_units (company_id, id)
);
create index material_requests_company_unit_idx     on public.material_requests (company_id, unit_id);
create index material_requests_company_object_idx   on public.material_requests (company_id, object_id, status);
create index material_requests_company_material_idx on public.material_requests (company_id, material_id);
create index material_requests_company_decided_idx  on public.material_requests (company_id, decided_by);
create index material_requests_created_by_idx      on public.material_requests (created_by);

-- ----------------------------------------------------------------------------
-- movements — ombor harakatlari (qoldiq shu yerdan hisoblanadi)
-- ----------------------------------------------------------------------------
create table public.movements (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id),
  type                public.movement_type not null,
  object_id           uuid not null,
  material_id         uuid not null,
  unit_id             uuid not null,
  -- inventory_adjust uchun ishorali (+ ortiqcha, − kamomad), qolganlari uchun > 0.
  -- qty_base = round(qty_input * factor, 6) — trigger hisoblaydi.
  qty_input           numeric(20,6) not null,
  unit_input          text not null check (btrim(unit_input) <> ''),
  unit_variant        text,
  qty_base            numeric(20,6) not null,
  purchase_id         uuid,
  transfer_id         uuid,
  inventory_count_id  uuid,
  photo_path          text,
  occurred_at         timestamptz not null default now(),
  note                text,
  created_by          uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint movements_company_id_id_key unique (company_id, id),
  constraint movements_qty_check check (
    case when type = 'inventory_adjust'
      then qty_base <> 0 and qty_input <> 0 and sign(qty_base) = sign(qty_input)
      else qty_base > 0 and qty_input > 0
    end
  ),
  -- Har tur faqat o'ziga tegishli bog'lanishga ega
  constraint movements_links_check check (
    case type
      when 'kirim'            then transfer_id is null and inventory_count_id is null
      when 'chiqim'           then transfer_id is null and inventory_count_id is null and purchase_id is null
      when 'transfer_out'     then transfer_id is not null and inventory_count_id is null and purchase_id is null
      when 'transfer_in'      then transfer_id is not null and inventory_count_id is null and purchase_id is null
      when 'inventory_adjust' then inventory_count_id is not null and transfer_id is null and purchase_id is null
    end
  ),
  constraint movements_object_fkey    foreign key (company_id, object_id)          references public.objects (company_id, id),
  constraint movements_material_fkey  foreign key (company_id, material_id)        references public.materials (company_id, id),
  constraint movements_purchase_fkey  foreign key (company_id, purchase_id)        references public.purchases (company_id, id),
  constraint movements_transfer_fkey  foreign key (company_id, transfer_id)        references public.transfers (company_id, id),
  constraint movements_inventory_fkey foreign key (company_id, inventory_count_id) references public.inventory_counts (company_id, id),
  constraint movements_unit_fkey      foreign key (company_id, unit_id)            references public.material_units (company_id, id)
);
create index movements_company_unit_idx        on public.movements (company_id, unit_id);
-- qoldiq view'i va obyekt bo'yicha ro'yxat
create index movements_balance_idx on public.movements (company_id, object_id, material_id)
  where deleted_at is null;
create index movements_company_object_time_idx on public.movements (company_id, object_id, occurred_at desc);
create index movements_company_material_idx    on public.movements (company_id, material_id);
create index movements_company_purchase_idx    on public.movements (company_id, purchase_id) where purchase_id is not null;
create index movements_company_transfer_idx    on public.movements (company_id, transfer_id) where transfer_id is not null;
create index movements_company_inventory_idx   on public.movements (company_id, inventory_count_id) where inventory_count_id is not null;
create index movements_created_by_idx          on public.movements (created_by);

-- ----------------------------------------------------------------------------
-- alerts — tizim topgan farqlar
-- ----------------------------------------------------------------------------
create table public.alerts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id),
  type                public.alert_type not null,
  status              public.alert_status not null default 'yangi',
  severity            public.alert_severity not null default 'ogohlantirish',
  object_id           uuid,
  material_id         uuid,
  purchase_id         uuid,
  movement_id         uuid,
  request_id          uuid,
  inventory_count_id  uuid,
  details             jsonb not null default '{}'::jsonb,
  closed_by           uuid,
  closed_at           timestamptz,
  created_by          uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint alerts_company_id_id_key unique (company_id, id),
  constraint alerts_object_fkey    foreign key (company_id, object_id)          references public.objects (company_id, id),
  constraint alerts_material_fkey  foreign key (company_id, material_id)        references public.materials (company_id, id),
  constraint alerts_purchase_fkey  foreign key (company_id, purchase_id)        references public.purchases (company_id, id),
  constraint alerts_movement_fkey  foreign key (company_id, movement_id)        references public.movements (company_id, id),
  constraint alerts_request_fkey   foreign key (company_id, request_id)         references public.material_requests (company_id, id),
  constraint alerts_inventory_fkey foreign key (company_id, inventory_count_id) references public.inventory_counts (company_id, id),
  constraint alerts_closed_by_fkey foreign key (company_id, closed_by)          references public.profiles (company_id, id)
);
create index alerts_company_status_idx    on public.alerts (company_id, status, created_at desc);
create index alerts_company_object_idx    on public.alerts (company_id, object_id);
create index alerts_company_material_idx  on public.alerts (company_id, material_id);
create index alerts_company_purchase_idx  on public.alerts (company_id, purchase_id);
create index alerts_company_movement_idx  on public.alerts (company_id, movement_id);
create index alerts_company_request_idx   on public.alerts (company_id, request_id);
create index alerts_company_inventory_idx on public.alerts (company_id, inventory_count_id);
create index alerts_company_closed_by_idx on public.alerts (company_id, closed_by);
create index alerts_created_by_idx        on public.alerts (created_by);

-- ============================================================================
-- Jadvalga xos triggerlar (umumiy a_* triggerlardan keyin ishlaydi: b_* nomlar)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Miqdor bazada hisoblanadi (CLAUDE.md 6-qoida):
--   unit_id → material_units (o'chirilmagan, shu firma, shu material);
--   unit_input, unit_variant := birlik qatoridan; qty_base := round(qty_input * factor, 6).
--   Klient yuborgan qty_base / unit_price / price_per_base e'tiborga olinmaydi.
-- Qulaylik: unit_id berilmasa, unit_input matni bo'yicha variantsiz birlik qidiriladi.
-- purchases: total_amount — haqiqat manbai; unit_price = total / qty_input (2 xona),
--            price_per_base = total / qty_base (4 xona).
-- movements: purchase_id bo'lsa — shu firmada, o'chirilmagan, material va obyekt mos.
-- ----------------------------------------------------------------------------
create function private.tg_compute_qty()
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

  if v_unit_id is null then
    select mu.id into v_unit_id
      from public.material_units mu
     where mu.company_id = new.company_id
       and mu.material_id = new.material_id
       and mu.unit = new.unit_input
       and mu.variant is null
       and mu.deleted_at is null;
  end if;

  -- O'chirilgan birlik faqat eski (o'zgarmagan) qatorda qolishi mumkin
  select mu.material_id, mu.unit, mu.variant, mu.factor
    into v_material, v_unit, v_variant, v_factor
    from public.material_units mu
   where mu.company_id = new.company_id
     and mu.id = v_unit_id
     and (mu.deleted_at is null or mu.id = v_old_unit);
  if not found then
    raise exception '%: unit not found for this company (unit_id=%, unit_input=%)',
      tg_table_name, v_unit_id, new.unit_input using errcode = '23503';
  end if;
  if v_material is distinct from new.material_id then
    raise exception '%: unit % does not belong to material %', tg_table_name, v_unit_id, new.material_id
      using errcode = '23503';
  end if;

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
        raise exception 'movements: purchase % not found in this company', new.purchase_id using errcode = '23503';
      end if;
      if v_p_material is distinct from new.material_id or v_p_object is distinct from new.object_id then
        raise exception 'movements: purchase % material/object mismatch', new.purchase_id using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger b_compute_qty before insert or update on public.purchases
  for each row execute function private.tg_compute_qty();
create trigger b_compute_qty before insert or update on public.movements
  for each row execute function private.tg_compute_qty();
create trigger b_compute_qty before insert or update on public.transfers
  for each row execute function private.tg_compute_qty();
create trigger b_compute_qty before insert or update on public.material_requests
  for each row execute function private.tg_compute_qty();

-- ----------------------------------------------------------------------------
-- material_requests: admin bo'lmagan (taminotchi) faqat status va note ni o'zgartiradi;
-- status o'tishlari: kutilmoqda → tasdiqlandi | rad, tasdiqlandi → xarid_qilindi.
-- decided_by / decided_at — faqat trigger (status o'zgarganda).
-- ----------------------------------------------------------------------------
create function private.tg_material_requests_guard()
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
      raise exception 'material_requests: only status and note can be changed' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and not ((old.status = 'kutilmoqda' and new.status in ('tasdiqlandi', 'rad'))
             or (old.status = 'tasdiqlandi' and new.status = 'xarid_qilindi')) then
      raise exception 'material_requests: status % -> % not allowed', old.status, new.status using errcode = '42501';
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

create trigger b_material_requests_guard before insert or update on public.material_requests
  for each row execute function private.tg_material_requests_guard();

-- ----------------------------------------------------------------------------
-- alerts: closed_by / closed_at — faqat trigger (status 'yopildi' ga o'tganda)
-- ----------------------------------------------------------------------------
create function private.tg_alerts_close()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'yopildi' then
    if tg_op = 'INSERT' then
      new.closed_by := private.my_profile_id();
      new.closed_at := now();
    elsif old.status is distinct from 'yopildi' then
      new.closed_by := private.my_profile_id();
      new.closed_at := now();
    else
      new.closed_by := old.closed_by;
      new.closed_at := old.closed_at;
    end if;
  else
    new.closed_by := null;
    new.closed_at := null;
  end if;
  return new;
end;
$$;

create trigger b_alerts_close before insert or update on public.alerts
  for each row execute function private.tg_alerts_close();

-- ----------------------------------------------------------------------------
-- Inventarizatsiya: foydalanuvchi (authenticated) statusni to'g'ridan-to'g'ri
-- o'zgartira olmaydi va qty_expected ni yoza olmaydi — faqat
-- public.submit_inventory_count() orqali (security definer: ichida current_user = egasi).
-- ----------------------------------------------------------------------------
create function private.tg_inventory_counts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and new.status is distinct from old.status then
    raise exception 'inventory_counts.status: use public.submit_inventory_count()' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger b_inventory_counts_guard before update on public.inventory_counts
  for each row execute function private.tg_inventory_counts_guard();

create function private.tg_inventory_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.qty_expected := null;
    else
      new.qty_expected := old.qty_expected;
    end if;
  end if;
  return new;
end;
$$;

create trigger b_inventory_items_guard before insert or update on public.inventory_count_items
  for each row execute function private.tg_inventory_items_guard();

revoke execute on function
  private.tg_compute_qty(),
  private.tg_material_requests_guard(),
  private.tg_alerts_close(),
  private.tg_inventory_counts_guard(),
  private.tg_inventory_items_guard()
from public, anon, authenticated;
