-- ============================================================================
-- Batch 12 · 01 — avtomatlashtirish (shartnoma: docs/automation-design.md,
-- payloadlar: "Bildirishnoma payloadlari (DB → tg-dispatch)")
--
--   0. alert_type: kirim_manbasiz, manfiy_qoldiq, takroriy_yozuv, joylashuv_farqi,
--      smetasiz_chiqim, chek_farqi, sorovdan_ortiq_xarid, podotchet_muddati,
--      podotchet_manfiy. ADD VALUE — yangi qiymatlar shu tranzaksiyada SQL'da
--      (indeks predikati, SQL-funksiya) ishlatilmaydi: faqat plpgsql ichida
--      (runtime) yoki `type::text` bilan. "Bitta ochiq alert" kafolati — unique
--      indeks o'rniga advisory lock + tekshiruv (private.alert_lock).
--   1. Ustunlar: companies (sozlamalar), objects (lat/lng/radius_m), materials
--      (photo_required), movements / purchases (rasm xeshi, geo), purchases (chek QR,
--      request_id), suppliers.tin, cash_advances.kind.
--   2. receipt_lookups — chek keshi (yozish faqat svc_upsert_receipt_lookup).
--   3. notification_outbox: yangi kind'lar, profile_id; svc_outbox_recipients.
--   4. BEFORE guardlar: rasm xeshi formati, rasm majburiy (photo_required), chek
--      bir marta (receipt_already_used), receipt_verified (server), so'rov
--      (purchase_request_invalid), sotuvchi STIR (supplier_tin_duplicate),
--      cash_advances.kind o'zgarmaydi (cash_amount_locked).
--   5. Qoidalar (A–I) va AFTER triggerlar (zz_automation).
--   6. create_transfer (create or replace) — transfer_insufficient_stock.
--   7. cash_balances (qaytarish), dashboard_summary (cash_returned_sum),
--      daily_report_stats (low_stock_count, geo_denied_count).
--   8. Cron funksiyalari: eslatma, muddati o'tgan so'rov, podotchet, haftalik hisob.
--   9. RPC: stock_forecast, svc_mark_alert_seen, svc_upsert_receipt_lookup.
--
-- Oldingi migratsiyalar o'zgartirilmaydi. Xato shakli: errcode + barqaror `hint` +
-- o'zbekcha `message` (docs/db-design.md → "Xato kalitlari").
-- ============================================================================

-- ============================================================================
-- 0. Yangi alert turlari
-- ============================================================================
alter type public.alert_type add value if not exists 'kirim_manbasiz';
alter type public.alert_type add value if not exists 'manfiy_qoldiq';
alter type public.alert_type add value if not exists 'takroriy_yozuv';
alter type public.alert_type add value if not exists 'joylashuv_farqi';
alter type public.alert_type add value if not exists 'smetasiz_chiqim';
alter type public.alert_type add value if not exists 'chek_farqi';
alter type public.alert_type add value if not exists 'sorovdan_ortiq_xarid';
alter type public.alert_type add value if not exists 'podotchet_muddati';
alter type public.alert_type add value if not exists 'podotchet_manfiy';

-- ============================================================================
-- 1. Ustunlar
-- ============================================================================

-- Firma sozlamalari (admin o'zgartiradi — companies_update siyosati, ustun cheklovi yo'q)
alter table public.companies
  add column photo_required_amount numeric(18,2)
    constraint companies_photo_required_amount_check
    check (photo_required_amount is null or photo_required_amount > 0),
  add column cash_max_days integer not null default 14
    constraint companies_cash_max_days_check check (cash_max_days between 1 and 365),
  add column duplicate_window_minutes integer not null default 10
    constraint companies_duplicate_window_minutes_check check (duplicate_window_minutes between 0 and 1440),
  add column request_overbuy_pct numeric(6,2) not null default 20
    constraint companies_request_overbuy_pct_check check (request_overbuy_pct between 0 and 1000),
  add column alert_remind_hours integer not null default 48
    constraint companies_alert_remind_hours_check check (alert_remind_hours between 1 and 720),
  add column forecast_days_warn integer not null default 3
    constraint companies_forecast_days_warn_check check (forecast_days_warn between 1 and 60);

-- D. Obyekt joyi
alter table public.objects
  add column lat numeric(9,6) constraint objects_lat_check check (lat between -90 and 90),
  add column lng numeric(9,6) constraint objects_lng_check check (lng between -180 and 180),
  add column radius_m integer not null default 300
    constraint objects_radius_m_check check (radius_m between 10 and 50000),
  add constraint objects_latlng_pair_check check ((lat is null) = (lng is null));

-- E. Material uchun rasm majburiy
alter table public.materials
  add column photo_required boolean not null default false;

-- C, D. Harakat: rasm xeshi, joylashuv
alter table public.movements
  add column photo_sha256 text
    constraint movements_photo_sha256_check check (photo_sha256 ~ '^[0-9a-f]{64}$'),
  add column geo_lat numeric(9,6) constraint movements_geo_lat_check check (geo_lat between -90 and 90),
  add column geo_lng numeric(9,6) constraint movements_geo_lng_check check (geo_lng between -180 and 180),
  add column geo_accuracy_m integer
    constraint movements_geo_accuracy_check check (geo_accuracy_m between 0 and 100000),
  add column geo_status text
    constraint movements_geo_status_check check (geo_status in ('ok', 'denied', 'unavailable')),
  add constraint movements_geo_check check (
    (geo_lat is null) = (geo_lng is null)
    and (geo_lat is null or geo_status = 'ok')
    and (geo_status is distinct from 'ok' or geo_lat is not null)
    and (geo_accuracy_m is null or geo_lat is not null)
  );

-- C, D, G, H. Xarid
alter table public.purchases
  add column receipt_photo_sha256 text
    constraint purchases_receipt_photo_sha256_check check (receipt_photo_sha256 ~ '^[0-9a-f]{64}$'),
  add column geo_lat numeric(9,6) constraint purchases_geo_lat_check check (geo_lat between -90 and 90),
  add column geo_lng numeric(9,6) constraint purchases_geo_lng_check check (geo_lng between -180 and 180),
  add column geo_accuracy_m integer
    constraint purchases_geo_accuracy_check check (geo_accuracy_m between 0 and 100000),
  add column geo_status text
    constraint purchases_geo_status_check check (geo_status in ('ok', 'denied', 'unavailable')),
  add constraint purchases_geo_check check (
    (geo_lat is null) = (geo_lng is null)
    and (geo_lat is null or geo_status = 'ok')
    and (geo_status is distinct from 'ok' or geo_lat is not null)
    and (geo_accuracy_m is null or geo_lat is not null)
  ),
  add column receipt_fiscal_sign text
    constraint purchases_receipt_fiscal_sign_check check (receipt_fiscal_sign ~ '^[0-9A-Za-z]{1,64}$'),
  add column receipt_terminal_id text
    constraint purchases_receipt_terminal_id_check check (char_length(receipt_terminal_id) between 1 and 64),
  add column receipt_no text
    constraint purchases_receipt_no_check check (char_length(receipt_no) between 1 and 64),
  add column receipt_verified boolean not null default false,
  add column receipt_total numeric(18,2)
    constraint purchases_receipt_total_check check (receipt_total >= 0),
  add column seller_tin text
    constraint purchases_seller_tin_check check (seller_tin ~ '^[0-9]{9,14}$'),
  add column request_id uuid,
  add constraint purchases_request_fkey foreign key (company_id, request_id)
    references public.material_requests (company_id, id);

create unique index purchases_receipt_fiscal_sign_key on public.purchases (company_id, receipt_fiscal_sign)
  where receipt_fiscal_sign is not null and deleted_at is null;
create index purchases_company_request_idx on public.purchases (company_id, request_id)
  where request_id is not null;
create index purchases_receipt_sha_idx on public.purchases (company_id, receipt_photo_sha256)
  where receipt_photo_sha256 is not null and deleted_at is null;
create index movements_photo_sha_idx on public.movements (company_id, photo_sha256)
  where photo_sha256 is not null and deleted_at is null;
-- kirim manbasi (A): obyekt + material bo'yicha bog'lanmagan kirimlar
create index movements_unlinked_kirim_idx on public.movements (company_id, object_id, material_id, occurred_at)
  where type = 'kirim' and purchase_id is null and deleted_at is null;

-- G. Sotuvchi STIR (9 — yuridik, 14 — JShShIR)
alter table public.suppliers
  add column tin text constraint suppliers_tin_check check (tin ~ '^[0-9]{9,14}$');
create unique index suppliers_company_tin_key on public.suppliers (company_id, tin)
  where tin is not null and deleted_at is null;

-- I. Podotchet: berildi | qaytarildi
alter table public.cash_advances
  add column kind text not null default 'berildi'
    constraint cash_advances_kind_check check (kind in ('berildi', 'qaytarildi'));

-- Podotchet alertlarini odam bo'yicha topish
create index alerts_company_profile_idx on public.alerts (company_id, (details ->> 'profile_id'))
  where details ? 'profile_id';

-- ============================================================================
-- 2. receipt_lookups — soliq.uz chek sahifasi keshi (fiskal belgi bo'yicha).
--    O'qish: shu firma a'zolari (o'chirilganini — admin/direktor/super_admin).
--    Yozish: authenticated — yo'q; faqat public.svc_upsert_receipt_lookup
--    (service_role, receipt-lookup Edge Function). Audit, soft delete — umumiy.
-- ============================================================================
create table public.receipt_lookups (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id),
  fiscal_sign  text not null constraint receipt_lookups_fiscal_sign_check check (fiscal_sign ~ '^[0-9A-Za-z]{1,64}$'),
  terminal_id  text constraint receipt_lookups_terminal_id_check check (char_length(terminal_id) between 1 and 64),
  receipt_no   text constraint receipt_lookups_receipt_no_check check (char_length(receipt_no) between 1 and 64),
  payload      jsonb not null default '{}'::jsonb
               constraint receipt_lookups_payload_check check (jsonb_typeof(payload) = 'object'),
  total        numeric(18,2) constraint receipt_lookups_total_check check (total >= 0),
  seller_tin   text constraint receipt_lookups_seller_tin_check check (seller_tin ~ '^[0-9]{9,14}$'),
  seller_name  text constraint receipt_lookups_seller_name_check check (char_length(seller_name) <= 300),
  receipt_at   timestamptz,
  fetched_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint receipt_lookups_company_id_id_key unique (company_id, id)
);
create unique index receipt_lookups_company_sign_key on public.receipt_lookups (company_id, fiscal_sign)
  where deleted_at is null;
create index receipt_lookups_created_by_idx on public.receipt_lookups (created_by);

create trigger a_block_delete before delete on public.receipt_lookups
  for each row execute function private.tg_block_delete();
create trigger a_block_truncate before truncate on public.receipt_lookups
  for each statement execute function private.tg_block_truncate();
create trigger a_before_insert before insert on public.receipt_lookups
  for each row execute function private.tg_before_insert();
create trigger a_before_update before update on public.receipt_lookups
  for each row execute function private.tg_before_update();
create trigger z_audit after insert or update on public.receipt_lookups
  for each row execute function private.audit_row();

alter table public.receipt_lookups enable row level security;
alter table public.receipt_lookups force row level security;

create policy receipt_lookups_select on public.receipt_lookups
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
  );

revoke all on public.receipt_lookups from public, anon, authenticated, service_role;
grant select on public.receipt_lookups to authenticated, service_role;

-- ============================================================================
-- 3. notification_outbox: yangi turlar
--    alert_reminder — alert_id bilan (alert bo'yicha bitta);
--    request_overdue — (company_id, report_date) bo'yicha bitta;
--    cash_statement — profile_id bilan, (profile_id, report_date) bo'yicha bitta.
--    notification_outbox_alert_key endi faqat kind = 'alert' (eslatma qatori
--    asosiy xabar bilan to'qnashmasin) — tg_alerts_notify va
--    enqueue_alert_escalation yangi conflict maqsadi bilan qayta yaratiladi.
-- ============================================================================
alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox drop constraint notification_outbox_kind_ref_check;
alter table public.notification_outbox
  add column profile_id uuid,
  add constraint notification_outbox_profile_fkey foreign key (company_id, profile_id)
    references public.profiles (company_id, id),
  add constraint notification_outbox_kind_check
    check (kind in ('alert', 'daily_report', 'alert_reminder', 'request_overdue', 'cash_statement')),
  add constraint notification_outbox_kind_ref_check check (
    (kind in ('alert', 'alert_reminder') and alert_id is not null and report_date is null and profile_id is null)
    or (kind in ('daily_report', 'request_overdue') and report_date is not null and alert_id is null and profile_id is null)
    or (kind = 'cash_statement' and report_date is not null and alert_id is null and profile_id is not null)
  );

drop index public.notification_outbox_alert_key;
create unique index notification_outbox_alert_key
  on public.notification_outbox (alert_id, escalation) where alert_id is not null and kind = 'alert';
create unique index notification_outbox_reminder_key
  on public.notification_outbox (alert_id) where kind = 'alert_reminder';
create unique index notification_outbox_overdue_key
  on public.notification_outbox (company_id, report_date) where kind = 'request_overdue';
create unique index notification_outbox_cash_key
  on public.notification_outbox (profile_id, report_date) where kind = 'cash_statement';
create index notification_outbox_profile_idx
  on public.notification_outbox (company_id, profile_id) where profile_id is not null;

-- Batch 8 versiyasi; faqat conflict maqsadi (kind = 'alert').
create or replace function private.tg_alerts_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object   text;
  v_material text;
  v_unit     text;
begin
  if new.object_id is not null then
    select o.name into v_object
      from public.objects o
     where o.company_id = new.company_id and o.id = new.object_id;
  end if;
  if new.material_id is not null then
    select m.name, m.base_unit into v_material, v_unit
      from public.materials m
     where m.company_id = new.company_id and m.id = new.material_id;
  end if;

  insert into public.notification_outbox (company_id, kind, alert_id, payload)
  values (
    new.company_id, 'alert', new.id,
    jsonb_build_object(
      'alert_id',      new.id,
      'type',          new.type,
      'severity',      new.severity,
      'object_name',   v_object,
      'material_name', v_material,
      'base_unit',     v_unit,
      'details',       new.details,
      'created_at',    new.created_at
    )
  )
  on conflict (alert_id, escalation) where alert_id is not null and kind = 'alert' do nothing;

  if found then
    perform private.wake_dispatch();
  end if;
  return null;
end;
$$;

create or replace function private.enqueue_alert_escalation(p_alert_id uuid, p_level integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a        public.alerts%rowtype;
  v_object   text;
  v_material text;
  v_unit     text;
begin
  select a.* into v_a from public.alerts a where a.id = p_alert_id;
  if not found or v_a.deleted_at is not null or p_level is null or p_level < 1 then
    return;
  end if;
  select o.name into v_object from public.objects o
   where o.company_id = v_a.company_id and o.id = v_a.object_id;
  select m.name, m.base_unit into v_material, v_unit from public.materials m
   where m.company_id = v_a.company_id and m.id = v_a.material_id;

  insert into public.notification_outbox (company_id, kind, alert_id, escalation, payload)
  values (
    v_a.company_id, 'alert', v_a.id, p_level,
    jsonb_build_object(
      'alert_id',      v_a.id,
      'type',          v_a.type,
      'severity',      v_a.severity,
      'object_name',   v_object,
      'material_name', v_material,
      'base_unit',     v_unit,
      'details',       v_a.details,
      'created_at',    now(),
      'escalation',    p_level
    )
  )
  on conflict (alert_id, escalation) where alert_id is not null and kind = 'alert' do nothing;

  if found then
    perform private.wake_dispatch();
  end if;
end;
$$;

-- Qabul qiluvchilar (outbox qatori bo'yicha). Faol firma, faol o'chirilmagan profil,
-- Telegram chat bog'langan; bitta chat — bir marta.
--   cash_statement  → faqat profile_id;
--   request_overdue → taminotchi, admin;
--   qolganlari      → direktor, admin; alert otkazma_farqi / not_received bo'lsa — jo'natuvchi
--                     va qabul qiluvchi obyektlarning prorab a'zolari ham.
create function public.svc_outbox_recipients(p_outbox_id uuid)
returns table (profile_id uuid, chat_id bigint, role text)
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select x.* from public.notification_outbox x where x.id = p_outbox_id
  ),
  tr as (
    select t.from_object_id, t.to_object_id
      from o
      join public.transfers t
        on t.company_id = o.company_id
       and t.id = case
                    when (o.payload -> 'details' ->> 'transfer_id')
                         ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                    then (o.payload -> 'details' ->> 'transfer_id')::uuid
                  end
     where o.kind = 'alert'
       and (o.payload ->> 'type') = 'otkazma_farqi'
       and (o.payload -> 'details' ->> 'direction') = 'not_received'
  )
  select distinct on (p.telegram_chat_id)
         p.id, p.telegram_chat_id, p.role::text
    from o
    join public.companies c on c.id = o.company_id
    join public.profiles p on p.company_id = o.company_id
   where c.is_active
     and c.deleted_at is null
     and p.is_active
     and p.deleted_at is null
     and p.telegram_chat_id is not null
     and case o.kind
           when 'cash_statement'  then p.id = o.profile_id
           when 'request_overdue' then p.role in ('taminotchi', 'admin')
           else p.role in ('direktor', 'admin')
                or (p.role = 'prorab' and exists (
                      select 1
                        from tr
                        join public.object_members om
                          on om.object_id in (tr.from_object_id, tr.to_object_id)
                       where om.profile_id = p.id
                         and om.deleted_at is null))
         end
   order by p.telegram_chat_id, p.role, p.id;
$$;

-- ============================================================================
-- 4. Yordamchilar
-- ============================================================================

-- Alert kaliti bo'yicha tranzaksiya qulfi ("bitta ochiq alert" — enum qiymatlari
-- shu migratsiyada indeks predikatida ishlatilmaydi).
create function private.alert_lock(p_key text)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('terron.alert:' || p_key, 0))
$$;

-- Obyekt + material qoldig'i (asosiy birlikda), stock_balances bilan bir xil formula.
create function private.object_stock(p_company_id uuid, p_object_id uuid, p_material_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case m.type
                        when 'kirim'            then m.qty_base
                        when 'transfer_in'      then m.qty_base
                        when 'chiqim'           then -m.qty_base
                        when 'transfer_out'     then -m.qty_base
                        when 'inventory_adjust' then m.qty_base
                      end), 0)::numeric(20,6)
    from public.movements m
   where m.company_id = p_company_id
     and m.object_id = p_object_id
     and m.material_id = p_material_id
     and m.deleted_at is null
$$;

-- Haversine masofa (metr, butun). R = 6 371 000 m. Trigonometriya faqat shu yerda
-- double precision da (numeric'da sin/cos yo'q); natija numeric'ga yaxlitlanadi va
-- hech qayerda float saqlanmaydi. src/domain dagi distanceMeters bilan bir xil.
create function private.geo_distance_m(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric)
returns integer
language sql
immutable
set search_path = ''
as $$
  select round((
    2 * 6371000 * asin(least(1::double precision, sqrt(
        power(sin(radians((p_lat2 - p_lat1)::double precision) / 2), 2)
      + cos(radians(p_lat1::double precision)) * cos(radians(p_lat2::double precision))
        * power(sin(radians((p_lng2 - p_lng1)::double precision) / 2), 2))))
  )::numeric)::integer
$$;

-- Ochiq alertni avtomatik yopish (mavjud qoidalar kabi details belgilari bilan).
create function private.auto_close_alert(p_alert_id uuid, p_reason text, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.alerts a
     set status  = 'yopildi',
         details = a.details || coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
           'auto_closed', true, 'closed_reason', p_reason, 'closed_by_actor', private.my_profile_id())
   where a.id = p_alert_id
     and a.status in ('yangi', 'korildi');
end;
$$;

-- Alert details'dagi "meta" kalitlar (eslatma, Telegram "Ko'rildi") — qayta baholashda
-- saqlanadi va "o'zgardimi" solishtirishiga kirmaydi.
create function private.alert_meta_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['reminded_at', 'seen_by_profile_id', 'seen_by_name', 'seen_at', 'seen_via']::text[]
$$;

create function private.alert_meta(p_details jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(coalesce(p_details, '{}'::jsonb)) e
   where e.key = any (private.alert_meta_keys())
$$;

-- Podotchet holati (FIFO). Sarf = xaridlar + qaytarishlar; berilgan pullar issued_at
-- tartibida eng eskisidan yopiladi; oldest_open_at — birinchi to'liq yopilmagan
-- berilgan pul vaqti (balans ≤ 0 → null).
create function private.cash_position(
  p_company_id uuid,
  p_profile_id uuid,
  out issued_total   numeric,
  out returned_total numeric,
  out spent_total    numeric,
  out balance        numeric,
  out oldest_open_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  select coalesce(sum(ca.amount) filter (where ca.kind = 'berildi'), 0)::numeric(18,2),
         coalesce(sum(ca.amount) filter (where ca.kind = 'qaytarildi'), 0)::numeric(18,2)
    into issued_total, returned_total
    from public.cash_advances ca
   where ca.company_id = p_company_id
     and ca.recipient_id = p_profile_id
     and ca.deleted_at is null;

  select coalesce(sum(p.total_amount), 0)::numeric(18,2) into spent_total
    from public.purchases p
   where p.company_id = p_company_id
     and p.buyer_id = p_profile_id
     and p.deleted_at is null;

  balance := (issued_total - returned_total - spent_total)::numeric(18,2);

  if balance > 0 then
    select min(x.issued_at) into oldest_open_at
      from (
        select ca.issued_at,
               sum(ca.amount) over (order by ca.issued_at, ca.id) as cum
          from public.cash_advances ca
         where ca.company_id = p_company_id
           and ca.recipient_id = p_profile_id
           and ca.kind = 'berildi'
           and ca.deleted_at is null
      ) x
     where x.cum > spent_total + returned_total;
  end if;
end;
$$;

-- ============================================================================
-- 5. BEFORE guardlar (c_* — b_compute_qty, b_photo_path dan keyin: qty_base,
--    total_amount, yo'l allaqachon hisoblangan/tozalangan).
-- ============================================================================

-- movements: rasm xeshi formati (rasm yo'li null → xesh null); kirimda material photo_required → photo_path majburiy.
create function private.tg_movements_auto_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check boolean;
begin
  if new.photo_path is null then
    new.photo_sha256 := null;   -- rasmsiz xesh saqlanmaydi
  end if;
  if new.photo_sha256 is not null then
    new.photo_sha256 := nullif(lower(btrim(new.photo_sha256)), '');
    if new.photo_sha256 is not null and new.photo_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception 'Rasm xeshi noto''g''ri formatda (SHA-256, 64 ta hex belgi)'
        using errcode = '23514', hint = 'photo_sha256_invalid';
    end if;
  end if;

  if new.type = 'kirim' and new.deleted_at is null and new.photo_path is null then
    if tg_op = 'INSERT' then
      v_check := true;
    else
      v_check := new.material_id is distinct from old.material_id
              or old.photo_path is not null
              or new.type is distinct from old.type;
    end if;
    if v_check and exists (
      select 1 from public.materials m
       where m.company_id = new.company_id and m.id = new.material_id and m.photo_required
    ) then
      raise exception 'Bu material uchun kirimda rasm majburiy'
        using errcode = '23514', hint = 'photo_required';
    end if;
  end if;
  return new;
end;
$$;

create trigger c_movements_auto before insert or update on public.movements
  for each row execute function private.tg_movements_auto_guard();

-- purchases:
--   (1) rasm xeshi formati (rasm yo'li null → xesh null);
--   (2) chek maydonlari: bo'sh satr → null. Foydalanuvchi sessiyasida (har INSERT/UPDATE):
--       fiskal belgi null → receipt_verified = false, receipt_total = seller_tin = null;
--       belgi bor → receipt_verified = shu firma keshida belgi bormi; kesh bo'lsa
--       receipt_total := kesh.total (null bo'lmasa), seller_tin := coalesce(kesh, klient).
--       service_role / tizim: bo'sh receipt_total / seller_tin — keshdan;
--   (3) fiskal belgi firma bo'yicha bitta tirik xaridda — receipt_already_used (23505);
--   (4) rasm majburiy: total_amount >= companies.photo_required_amount yoki material
--       photo_required → receipt_photo_path (receipt_verified bo'lsa — shart emas);
--   (5) request_id: so'rov shu firmada, o'chirilmagan, shu obyekt va material,
--       holati tasdiqlandi / xarid_qilindi — purchase_request_invalid.
create function private.tg_purchases_auto_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revived  boolean := false;
  v_lookup   record;
  v_found    boolean;
  v_other    record;
  v_limit    numeric;
  v_mat_req  boolean;
  v_check    boolean;
  v_r        record;
begin
  if tg_op = 'UPDATE' then
    v_revived := old.deleted_at is not null and new.deleted_at is null;
  end if;

  -- (1)
  if new.receipt_photo_path is null then
    new.receipt_photo_sha256 := null;   -- rasmsiz xesh saqlanmaydi
  end if;
  if new.receipt_photo_sha256 is not null then
    new.receipt_photo_sha256 := nullif(lower(btrim(new.receipt_photo_sha256)), '');
    if new.receipt_photo_sha256 is not null and new.receipt_photo_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception 'Rasm xeshi noto''g''ri formatda (SHA-256, 64 ta hex belgi)'
        using errcode = '23514', hint = 'photo_sha256_invalid';
    end if;
  end if;

  -- (2)
  new.receipt_fiscal_sign := nullif(btrim(new.receipt_fiscal_sign), '');
  new.receipt_terminal_id := nullif(btrim(new.receipt_terminal_id), '');
  new.receipt_no          := nullif(btrim(new.receipt_no), '');
  new.seller_tin          := nullif(btrim(new.seller_tin), '');

  if new.receipt_fiscal_sign is null then
    new.receipt_verified := false;
    if auth.uid() is not null then
      -- chekdan kelmagan summa / STIR foydalanuvchi sessiyasida saqlanmaydi
      new.receipt_total := null;
      new.seller_tin    := null;
    end if;
  else
    select l.total, l.seller_tin into v_lookup
      from public.receipt_lookups l
     where l.company_id = new.company_id
       and l.fiscal_sign = new.receipt_fiscal_sign
       and l.deleted_at is null;
    v_found := found;
    if auth.uid() is not null then
      -- foydalanuvchi sessiyasi: tasdiq va keshdagi qiymatlar — faqat server (klient qiymati ustidan)
      new.receipt_verified := v_found;
      if v_found then
        if v_lookup.total is not null then
          new.receipt_total := v_lookup.total;
        end if;
        new.seller_tin := coalesce(v_lookup.seller_tin, new.seller_tin);
      end if;
    elsif v_found then
      new.receipt_total := coalesce(new.receipt_total, v_lookup.total);
      new.seller_tin    := coalesce(new.seller_tin, v_lookup.seller_tin);
    end if;
  end if;

  -- (3)
  if new.receipt_fiscal_sign is not null and new.deleted_at is null
     and (tg_op = 'INSERT' or v_revived or new.receipt_fiscal_sign is distinct from old.receipt_fiscal_sign) then
    perform pg_advisory_xact_lock(hashtextextended(
      'terron.receipt:' || new.company_id::text || ':' || new.receipt_fiscal_sign, 0));
    select p.created_at, pr.full_name into v_other
      from public.purchases p
      left join public.profiles pr on pr.company_id = p.company_id and pr.id = p.buyer_id
     where p.company_id = new.company_id
       and p.receipt_fiscal_sign = new.receipt_fiscal_sign
       and p.deleted_at is null
       and p.id <> new.id
     order by p.created_at
     limit 1;
    if found then
      raise exception 'Bu chek allaqachon ishlatilgan: %, %',
        coalesce(v_other.full_name, '—'),
        to_char(v_other.created_at at time zone 'Asia/Tashkent', 'DD.MM.YYYY HH24:MI')
        using errcode = '23505', hint = 'receipt_already_used';
    end if;
  end if;

  -- (4)
  if new.deleted_at is null and new.receipt_photo_path is null and not new.receipt_verified then
    if tg_op = 'INSERT' then
      v_check := true;
    else
      v_check := new.total_amount is distinct from old.total_amount
              or new.material_id is distinct from old.material_id
              or old.receipt_photo_path is not null
              or new.receipt_verified is distinct from old.receipt_verified;
    end if;
    if v_check then
      select c.photo_required_amount into v_limit from public.companies c where c.id = new.company_id;
      select m.photo_required into v_mat_req
        from public.materials m
       where m.company_id = new.company_id and m.id = new.material_id;
      if (v_limit is not null and new.total_amount >= v_limit) or coalesce(v_mat_req, false) then
        raise exception 'Chek rasmi majburiy (summa chegaradan katta yoki material uchun rasm talab qilinadi)'
          using errcode = '23514', hint = 'photo_required';
      end if;
    end if;
  end if;

  -- (5)
  if new.request_id is not null and new.deleted_at is null
     and (tg_op = 'INSERT' or v_revived
          or new.request_id is distinct from old.request_id
          or new.object_id is distinct from old.object_id
          or new.material_id is distinct from old.material_id) then
    select r.object_id, r.material_id, r.status, r.deleted_at into v_r
      from public.material_requests r
     where r.company_id = new.company_id and r.id = new.request_id;
    if not found or v_r.deleted_at is not null then
      raise exception 'So''rov topilmadi yoki o''chirilgan'
        using errcode = '23503', hint = 'purchase_request_invalid';
    end if;
    if v_r.object_id is distinct from new.object_id or v_r.material_id is distinct from new.material_id then
      raise exception 'So''rov boshqa obyekt yoki materialga tegishli'
        using errcode = '23514', hint = 'purchase_request_invalid';
    end if;
    if v_r.status not in ('tasdiqlandi', 'xarid_qilindi') then
      raise exception 'Faqat tasdiqlangan so''rov bo''yicha xarid qilish mumkin'
        using errcode = '23514', hint = 'purchase_request_invalid';
    end if;
  end if;
  return new;
end;
$$;

create trigger c_purchases_auto before insert or update on public.purchases
  for each row execute function private.tg_purchases_auto_guard();

-- suppliers: STIR bo'yicha dublikat — supplier_tin_duplicate (zaxira — unique indeks).
create function private.tg_suppliers_tin_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.tin := nullif(btrim(new.tin), '');
  if new.tin is not null and new.deleted_at is null
     and (tg_op = 'INSERT' or old.deleted_at is not null or new.tin is distinct from old.tin) then
    perform pg_advisory_xact_lock(hashtextextended('terron.supplier_tin:' || new.company_id::text || ':' || new.tin, 0));
    if exists (
      select 1 from public.suppliers s
       where s.company_id = new.company_id and s.tin = new.tin and s.deleted_at is null and s.id <> new.id
    ) then
      raise exception 'STIR % bilan sotuvchi allaqachon bor — ro''yxatdan tanlang', new.tin
        using errcode = '23505', hint = 'supplier_tin_duplicate';
    end if;
  end if;
  return new;
end;
$$;

create trigger c_suppliers_tin_guard before insert or update on public.suppliers
  for each row execute function private.tg_suppliers_tin_guard();

-- cash_advances: Batch 5 versiyasi + kind ham o'zgarmaydi (cash_amount_locked);
-- oluvchi roli / faolligi (cash_recipient_role) — faqat kind = 'berildi'.
create or replace function private.tg_cash_advances_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.amount is distinct from old.amount
       or new.recipient_id is distinct from old.recipient_id
       or new.kind is distinct from old.kind then
      raise exception 'Berilgan pul summasi, turi va oluvchisini o''zgartirib bo''lmaydi — yozuvni o''chirib, yangisini kiriting'
        using errcode = 'P0001', hint = 'cash_amount_locked';
    end if;
    if not (old.deleted_at is not null and new.deleted_at is null) then
      return new;
    end if;
  end if;

  -- Batch 12: qaytarish (qaytarildi) — nofaol / roli o'zgargan odamdan ham qabul qilinadi
  if new.deleted_at is not null
     or new.kind <> 'berildi'
     or (auth.uid() is not null and not private.has_role('super_admin', 'admin', 'buxgalter'))
     or not exists (select 1 from public.profiles pr
                     where pr.company_id = new.company_id and pr.id = new.recipient_id) then
    return new;
  end if;

  if not exists (
    select 1 from public.profiles pr
     where pr.company_id = new.company_id
       and pr.id = new.recipient_id
       and pr.deleted_at is null
       and pr.is_active
       and pr.role in ('haydovchi', 'taminotchi', 'prorab', 'admin')
  ) then
    raise exception 'Pulni faqat xarid kiritadigan faol xodimga (haydovchi, ta''minotchi, prorab, admin) berish mumkin'
      using errcode = 'P0001', hint = 'cash_recipient_role';
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 6. Qoidalar
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. kirim_manbasiz (belgi), harakat bo'yicha bitta ochiq.
--   reason = 'open_purchase': shu obyekt+materialda ochiq xarid (purchased_at ∈
--            [occurred_at − 14 kun, occurred_at + 1 kun], qabul qilinmagan qismi bor);
--   reason = 'no_source': [occurred_at − 7 kun, occurred_at] da shu obyekt+material
--            uchun xarid ham, o'tkazma (bekor qilinmagan) ham yo'q;
--   reason = 'unlinked_candidate': evaluate_purchase_receipt belgilagan (o'zgarmaydi).
--   Kirim bog'lansa / o'chirilsa — yopiladi (linked / movement_deleted). Admin qo'lda
--   yopgan shu sababli alert qayta yaratilmaydi.
-- ----------------------------------------------------------------------------
create function private.evaluate_kirim_source(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m       public.movements%rowtype;
  v_alert   public.alerts%rowtype;
  v_open    uuid[];
  v_reason  text;
  v_unit    text;
  v_details jsonb;
begin
  select m.* into v_m from public.movements m where m.id = p_movement_id;
  if not found then
    return;
  end if;
  perform private.alert_lock('kirim_manbasiz:' || v_m.id::text);

  select a.* into v_alert
    from public.alerts a
   where a.company_id = v_m.company_id
     and a.movement_id = v_m.id
     and a.type = 'kirim_manbasiz'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
   order by a.created_at
   limit 1;

  if v_m.deleted_at is not null or v_m.type <> 'kirim' or v_m.purchase_id is not null then
    if v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id,
        case when v_m.deleted_at is not null then 'movement_deleted'
             when v_m.purchase_id is not null then 'linked'
             else 'not_applicable' end);
    end if;
    return;
  end if;

  select coalesce(array_agg(p.id order by p.purchased_at, p.id), '{}') into v_open
    from public.purchases p
   where p.company_id = v_m.company_id
     and p.object_id = v_m.object_id
     and p.material_id = v_m.material_id
     and p.deleted_at is null
     and p.purchased_at >= v_m.occurred_at - interval '14 days'
     and p.purchased_at <= v_m.occurred_at + interval '1 day'
     and p.qty_base > (select coalesce(sum(r.qty_base), 0)
                         from public.movements r
                        where r.company_id = p.company_id
                          and r.purchase_id = p.id
                          and r.type = 'kirim'
                          and r.deleted_at is null);

  if cardinality(v_open) > 0 then
    v_reason := 'open_purchase';
  elsif not exists (
          select 1 from public.purchases p
           where p.company_id = v_m.company_id
             and p.object_id = v_m.object_id
             and p.material_id = v_m.material_id
             and p.deleted_at is null
             and p.purchased_at between v_m.occurred_at - interval '7 days' and v_m.occurred_at)
        and not exists (
          select 1 from public.transfers t
           where t.company_id = v_m.company_id
             and t.to_object_id = v_m.object_id
             and t.material_id = v_m.material_id
             and t.deleted_at is null
             and t.status <> 'bekor'
             and t.created_at between v_m.occurred_at - interval '7 days' and v_m.occurred_at) then
    v_reason := 'no_source';
  end if;

  if v_alert.id is not null and (v_alert.details ->> 'reason') = 'unlinked_candidate' then
    return;
  end if;

  if v_reason is null then
    if v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id, 'not_applicable');
    end if;
    return;
  end if;

  select m.base_unit into v_unit from public.materials m
   where m.company_id = v_m.company_id and m.id = v_m.material_id;

  v_details := jsonb_build_object(
    'reason',                v_reason,
    'qty_base',              v_m.qty_base,
    'base_unit',             v_unit,
    'occurred_at',           v_m.occurred_at,
    'open_purchase_ids',     to_jsonb(v_open),
    'candidate_purchase_id', null
  );

  if v_alert.id is not null then
    if (v_alert.details - private.alert_meta_keys()) is distinct from v_details then
      update public.alerts
         set details = v_details || private.alert_meta(v_alert.details),
             object_id = v_m.object_id, material_id = v_m.material_id
       where id = v_alert.id;
    end if;
    return;
  end if;

  if exists (
    select 1 from public.alerts a
     where a.company_id = v_m.company_id
       and a.movement_id = v_m.id
       and a.type = 'kirim_manbasiz'
       and a.status = 'yopildi'
       and a.deleted_at is null
       and coalesce((a.details ->> 'auto_closed')::boolean, false) = false
       and (a.details ->> 'reason') = v_reason
  ) then
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, material_id, movement_id, details)
  values (v_m.company_id, 'kirim_manbasiz', 'belgi', v_m.object_id, v_m.material_id, v_m.id, v_details);
end;
$$;

-- Nomzod kirimni belgilash (evaluate_purchase_receipt dan): ochiq alert bo'lsa —
-- candidate_purchase_id yoziladi; yo'q bo'lsa — reason = unlinked_candidate. Shu xarid
-- bo'yicha nomzod alerti avval bo'lgan bo'lsa (yopilgani ham) — qayta yaratilmaydi.
create function private.mark_kirim_candidate(p_movement_id uuid, p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m     public.movements%rowtype;
  v_alert public.alerts%rowtype;
  v_unit  text;
begin
  select m.* into v_m from public.movements m where m.id = p_movement_id;
  if not found or v_m.deleted_at is not null or v_m.purchase_id is not null then
    return;
  end if;
  perform private.alert_lock('kirim_manbasiz:' || v_m.id::text);

  if exists (
    select 1 from public.alerts a
     where a.company_id = v_m.company_id
       and a.movement_id = v_m.id
       and a.type = 'kirim_manbasiz'
       and a.deleted_at is null
       and (a.details ->> 'candidate_purchase_id') = p_purchase_id::text
  ) then
    return;
  end if;

  select a.* into v_alert
    from public.alerts a
   where a.company_id = v_m.company_id
     and a.movement_id = v_m.id
     and a.type = 'kirim_manbasiz'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
   order by a.created_at
   limit 1;

  if v_alert.id is not null then
    update public.alerts
       set details     = details || jsonb_build_object('candidate_purchase_id', p_purchase_id),
           purchase_id = p_purchase_id
     where id = v_alert.id;
    return;
  end if;

  select m.base_unit into v_unit from public.materials m
   where m.company_id = v_m.company_id and m.id = v_m.material_id;
  insert into public.alerts (company_id, type, severity, object_id, material_id, movement_id, purchase_id, details)
  values (v_m.company_id, 'kirim_manbasiz', 'belgi', v_m.object_id, v_m.material_id, v_m.id, p_purchase_id,
          jsonb_build_object(
            'reason',                'unlinked_candidate',
            'qty_base',              v_m.qty_base,
            'base_unit',             v_unit,
            'occurred_at',           v_m.occurred_at,
            'open_purchase_ids',     '[]'::jsonb,
            'candidate_purchase_id', p_purchase_id));
end;
$$;

-- ----------------------------------------------------------------------------
-- Qoida 1 (Batch 5 versiyasi) + A.2 nomzodlar.
--   Nomzod — bog'lanmagan kirim: shu obyekt+material, purchase_id null, o'chirilmagan,
--   occurred_at ∈ [purchased_at, purchased_at + 72 soat].
--   Kam qabul (under, 24 soatdan keyin) va round(abs(received + Σ nomzod − purchased)
--   * 100 / purchased, 2) <= chegara (qoida 1 formulasi) → 'covered': alert yaratilmaydi (ochig'i
--   yopiladi: covered_by_unlinked), nomzodlar kirim_manbasiz bilan belgilanadi.
--   Yopmasa — details ga unlinked_candidates [{movement_id, qty_base}] va
--   unlinked_qty_base qo'shiladi (faqat nomzod bo'lsa va received < purchased).
-- ----------------------------------------------------------------------------
create or replace function private.evaluate_purchase_receipt(p_purchase_id uuid, p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p          public.purchases%rowtype;
  v_threshold  numeric;
  v_purchased  numeric(20,6);
  v_received   numeric(20,6);
  v_count      bigint;
  v_last_mv    uuid;
  v_diff       numeric;
  v_state      text;
  v_severity   public.alert_severity;
  v_details    jsonb;
  v_alert      public.alerts%rowtype;
  v_cand_qty   numeric(20,6);
  v_cand       jsonb;
  v_cand_id    uuid;
begin
  select p.* into v_p
    from public.purchases p
   where p.id = p_purchase_id
     for no key update;
  if not found then
    return;
  end if;

  if v_p.deleted_at is not null then
    perform private.close_purchase_alerts(v_p.company_id, v_p.id,
      array['xarid_qabul_farqi']::public.alert_type[], 'purchase_deleted');
    return;
  end if;

  select c.receipt_mismatch_pct into v_threshold
    from public.companies c
   where c.id = v_p.company_id;

  select coalesce(sum(m.qty_base), 0),
         count(*),
         (array_agg(m.id order by m.created_at desc, m.id desc))[1]
    into v_received, v_count, v_last_mv
    from public.movements m
   where m.company_id = v_p.company_id
     and m.purchase_id = v_p.id
     and m.type = 'kirim'
     and m.deleted_at is null;

  select coalesce(sum(m.qty_base), 0)::numeric(20,6),
         coalesce(jsonb_agg(jsonb_build_object('movement_id', m.id, 'qty_base', m.qty_base)
                            order by m.occurred_at, m.id), '[]'::jsonb)
    into v_cand_qty, v_cand
    from public.movements m
   where m.company_id = v_p.company_id
     and m.object_id = v_p.object_id
     and m.material_id = v_p.material_id
     and m.type = 'kirim'
     and m.purchase_id is null
     and m.transfer_id is null
     and m.deleted_at is null
     and m.occurred_at >= v_p.purchased_at
     and m.occurred_at <= v_p.purchased_at + interval '72 hours';

  v_purchased := v_p.qty_base;
  v_diff := round(abs(v_received - v_purchased) * 100 / v_purchased, 2);

  if v_diff <= v_threshold then
    v_state := 'ok';
  elsif v_received > v_purchased then
    v_state := 'over';
  elsif p_now >= v_p.purchased_at + interval '24 hours' then
    if v_cand_qty > 0
       and round(abs(v_received + v_cand_qty - v_purchased) * 100 / v_purchased, 2) <= v_threshold then
      v_state := 'covered';
    else
      v_state := 'under';
    end if;
  else
    v_state := 'pending';
  end if;

  v_severity := case when v_diff >= 3 * v_threshold then 'jiddiy' else 'ogohlantirish' end;
  v_details := jsonb_build_object(
    'purchased_qty_base', v_purchased,
    'received_qty_base',  v_received,
    'diff_pct',           v_diff,
    'threshold_pct',      v_threshold,
    'direction',          case when v_received > v_purchased then 'over' else 'under' end,
    'receipt_count',      v_count,
    'evaluated_at',       p_now
  );
  if v_cand_qty > 0 and v_received < v_purchased then
    v_details := v_details || jsonb_build_object(
      'unlinked_candidates', v_cand,
      'unlinked_qty_base',   v_cand_qty);
  end if;

  select a.* into v_alert
    from public.alerts a
   where a.company_id = v_p.company_id
     and a.purchase_id = v_p.id
     and a.type = 'xarid_qabul_farqi'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null;

  if v_state = 'ok' then
    if v_alert.id is not null then
      update public.alerts
         set status  = 'yopildi',
             details = v_details || private.alert_meta(v_alert.details) || jsonb_build_object(
               'auto_closed', true, 'closed_reason', 'within_threshold',
               'closed_by_actor', private.my_profile_id())
       where id = v_alert.id;
    end if;
    return;
  end if;

  if v_state = 'covered' then
    if v_alert.id is not null then
      update public.alerts
         set status  = 'yopildi',
             details = v_details || private.alert_meta(v_alert.details) || jsonb_build_object(
               'auto_closed', true, 'closed_reason', 'covered_by_unlinked',
               'closed_by_actor', private.my_profile_id())
       where id = v_alert.id;
    end if;
    for v_cand_id in
      select (x ->> 'movement_id')::uuid from jsonb_array_elements(v_cand) x order by 1
    loop
      perform private.mark_kirim_candidate(v_cand_id, v_p.id);
    end loop;
    return;
  end if;

  if v_alert.id is not null then
    if v_alert.severity = v_severity
       and (v_alert.details - 'evaluated_at' - private.alert_meta_keys()) = (v_details - 'evaluated_at')
       and v_alert.object_id is not distinct from v_p.object_id
       and v_alert.material_id is not distinct from v_p.material_id
       and v_alert.movement_id is not distinct from v_last_mv then
      return;
    end if;
    update public.alerts
       set severity    = v_severity,
           details     = v_details || private.alert_meta(v_alert.details),
           object_id   = v_p.object_id,
           material_id = v_p.material_id,
           movement_id = v_last_mv
     where id = v_alert.id;
    return;
  end if;

  if v_state = 'pending' then
    return;
  end if;

  if exists (
    select 1 from public.alerts a
     where a.company_id = v_p.company_id
       and a.purchase_id = v_p.id
       and a.type = 'xarid_qabul_farqi'
       and a.status = 'yopildi'
       and a.deleted_at is null
       and coalesce((a.details ->> 'auto_closed')::boolean, false) = false
       and (a.details ->> 'purchased_qty_base')::numeric = v_purchased
       and (a.details ->> 'received_qty_base')::numeric = v_received
  ) then
    return;
  end if;

  insert into public.alerts
    (company_id, type, severity, object_id, material_id, purchase_id, movement_id, details)
  values
    (v_p.company_id, 'xarid_qabul_farqi', v_severity, v_p.object_id, v_p.material_id,
     v_p.id, v_last_mv, v_details);
end;
$$;

-- ----------------------------------------------------------------------------
-- B. manfiy_qoldiq (ogohlantirish), obyekt+material bo'yicha bitta ochiq.
--   Hisoblanadi faqat: sabab harakati tirik chiqim / transfer_out (shu obyekt+material)
--   yoki shu juftlik uchun ochiq alert bor (yopish uchun).
--   Qoldiq < 0 (aynan 0 — alert emas): ochiq alert bo'lsa — details yangilanadi; yo'q
--   bo'lsa va sabab tirik chiqim / transfer_out bo'lsa — yaratiladi. Lekin oxirgi 24
--   soatda stock_restored bilan yopilgan alert bo'lsa — yangisi yaratilmaydi, yopilganining
--   details'i (stock_after, qty_base, movement_type, renegative_at) yangilanadi (shovqin yo'q).
--   Qoldiq ≥ 0 → ochiq alert yopiladi (stock_restored).
-- ----------------------------------------------------------------------------
create function private.evaluate_negative_stock(
  p_company_id  uuid,
  p_object_id   uuid,
  p_material_id uuid,
  p_movement_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock   numeric(20,6);
  v_alert   public.alerts%rowtype;
  v_recent  public.alerts%rowtype;
  v_mv      public.movements%rowtype;
  v_out     boolean := false;
  v_unit    text;
  v_details jsonb;
begin
  select m.* into v_mv from public.movements m where m.id = p_movement_id;
  v_out := found and v_mv.deleted_at is null and v_mv.type in ('chiqim', 'transfer_out')
           and v_mv.object_id = p_object_id and v_mv.material_id = p_material_id;

  if not v_out and not exists (
    select 1 from public.alerts a
     where a.company_id = p_company_id
       and a.object_id = p_object_id
       and a.material_id = p_material_id
       and a.type = 'manfiy_qoldiq'
       and a.status in ('yangi', 'korildi')
       and a.deleted_at is null
  ) then
    return;
  end if;

  perform private.alert_lock('manfiy_qoldiq:' || p_object_id::text || ':' || p_material_id::text);
  v_stock := private.object_stock(p_company_id, p_object_id, p_material_id);

  select a.* into v_alert
    from public.alerts a
   where a.company_id = p_company_id
     and a.object_id = p_object_id
     and a.material_id = p_material_id
     and a.type = 'manfiy_qoldiq'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
   order by a.created_at
   limit 1;

  if v_stock >= 0 then
    if v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id, 'stock_restored', jsonb_build_object('stock_after', v_stock));
    end if;
    return;
  end if;

  select m.base_unit into v_unit from public.materials m
   where m.company_id = p_company_id and m.id = p_material_id;

  if v_alert.id is not null then
    v_details := v_alert.details || jsonb_build_object('stock_after', v_stock, 'unit', v_unit);
    if v_out then
      v_details := v_details || jsonb_build_object('qty_base', v_mv.qty_base, 'movement_type', v_mv.type);
    end if;
    if v_details is distinct from v_alert.details
       or (v_out and v_alert.movement_id is distinct from v_mv.id) then
      update public.alerts
         set details     = v_details,
             movement_id = case when v_out then v_mv.id else movement_id end
       where id = v_alert.id;
    end if;
    return;
  end if;

  if not v_out then
    return;
  end if;

  select a.* into v_recent
    from public.alerts a
   where a.company_id = p_company_id
     and a.object_id = p_object_id
     and a.material_id = p_material_id
     and a.type = 'manfiy_qoldiq'
     and a.status = 'yopildi'
     and a.deleted_at is null
     and (a.details ->> 'closed_reason') = 'stock_restored'
     and a.closed_at > now() - interval '24 hours'
   order by a.closed_at desc
   limit 1;
  if v_recent.id is not null then
    update public.alerts
       set details     = details || jsonb_build_object(
                           'stock_after', v_stock, 'qty_base', v_mv.qty_base,
                           'movement_type', v_mv.type, 'renegative_at', now()),
           movement_id = v_mv.id
     where id = v_recent.id;
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, material_id, movement_id, details)
  values (p_company_id, 'manfiy_qoldiq', 'ogohlantirish', p_object_id, p_material_id, v_mv.id,
          jsonb_build_object(
            'stock_after',   v_stock,
            'qty_base',      v_mv.qty_base,
            'unit',          v_unit,
            'movement_type', v_mv.type));
end;
$$;

-- ----------------------------------------------------------------------------
-- F. smetasiz_chiqim (ogohlantirish) — obyekt bo'yicha BITTA ochiq alert, obyektda joriy
--   smeta paydo bo'lguncha. Yaratiladi: tirik chiqim kiritilganda joriy smeta yo'q va ochiq
--   alert yo'q bo'lsa (first_day = shu chiqim Toshkent kuni). Keyingi chiqimlar / o'chirish /
--   tiklash — details qayta hisoblanadi (first_day dan beri): count, days (chiqimli kunlar
--   soni), last_day (= day), materials, last_movement_id. Qayta yuborilmaydi. Joriy smeta
--   paydo bo'lsa (estimates triggeri yoki keyingi chiqim) — yopiladi (estimate_added).
-- ----------------------------------------------------------------------------
create function private.evaluate_no_estimate_chiqim(
  p_company_id  uuid,
  p_object_id   uuid,
  p_movement_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert     public.alerts%rowtype;
  v_first     date;
  v_from      timestamptz;
  v_count     integer;
  v_days      integer;
  v_last      uuid;
  v_last_day  date;
  v_materials jsonb;
  v_details   jsonb;
begin
  perform private.alert_lock('smetasiz_chiqim:' || p_object_id::text);

  select a.* into v_alert
    from public.alerts a
   where a.company_id = p_company_id
     and a.object_id = p_object_id
     and a.type = 'smetasiz_chiqim'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
   order by a.created_at
   limit 1;

  if exists (
    select 1 from public.estimates e
     where e.company_id = p_company_id and e.object_id = p_object_id
       and e.is_current and e.deleted_at is null
  ) then
    if v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id, 'estimate_added');
    end if;
    return;
  end if;

  if v_alert.id is null then
    select (m.occurred_at at time zone 'Asia/Tashkent')::date into v_first
      from public.movements m
     where m.id = p_movement_id and m.deleted_at is null and m.type = 'chiqim'
       and m.company_id = p_company_id and m.object_id = p_object_id;
    if not found then
      return;
    end if;
  else
    v_first := coalesce((v_alert.details ->> 'first_day')::date,
                        (v_alert.created_at at time zone 'Asia/Tashkent')::date);
  end if;
  v_from := v_first::timestamp at time zone 'Asia/Tashkent';

  select count(*)::integer,
         count(distinct (m.occurred_at at time zone 'Asia/Tashkent')::date)::integer,
         max((m.occurred_at at time zone 'Asia/Tashkent')::date),
         (array_agg(m.id order by m.occurred_at desc, m.created_at desc, m.id desc))[1]
    into v_count, v_days, v_last_day, v_last
    from public.movements m
   where m.company_id = p_company_id
     and m.object_id = p_object_id
     and m.type = 'chiqim'
     and m.deleted_at is null
     and m.occurred_at >= v_from;

  if v_count = 0 and v_alert.id is null then
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'material_id', x.material_id, 'material_name', x.name,
           'qty_base', x.qty, 'base_unit', x.base_unit) order by x.name, x.material_id), '[]'::jsonb)
    into v_materials
    from (
      select m.material_id, mt.name, mt.base_unit, sum(m.qty_base)::numeric(20,6) as qty
        from public.movements m
        join public.materials mt on mt.company_id = m.company_id and mt.id = m.material_id
       where m.company_id = p_company_id
         and m.object_id = p_object_id
         and m.type = 'chiqim'
         and m.deleted_at is null
         and m.occurred_at >= v_from
       group by m.material_id, mt.name, mt.base_unit
    ) x;

  v_details := jsonb_build_object(
    'first_day',        to_char(v_first, 'YYYY-MM-DD'),
    'last_day',         to_char(v_last_day, 'YYYY-MM-DD'),
    'day',              to_char(v_last_day, 'YYYY-MM-DD'),
    'days',             v_days,
    'count',            v_count,
    'materials',        v_materials,
    'last_movement_id', v_last);

  if v_alert.id is not null then
    if (v_alert.details - private.alert_meta_keys()) is distinct from v_details then
      update public.alerts
         set details     = v_alert.details || v_details,
             movement_id = coalesce(v_last, movement_id)
       where id = v_alert.id;
    end if;
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, movement_id, details)
  values (p_company_id, 'smetasiz_chiqim', 'ogohlantirish', p_object_id, v_last, v_details);
end;
$$;

-- Obyektda joriy smeta paydo bo'lsa — ochiq smetasiz_chiqim yopiladi (estimate_added).
create function private.tg_estimates_no_estimate_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.evaluate_no_estimate_chiqim(new.company_id, new.object_id, null);
  return null;
end;
$$;

create trigger zz_automation after insert or update of is_current, deleted_at on public.estimates
  for each row
  when (new.is_current and new.deleted_at is null)
  execute function private.tg_estimates_no_estimate_close();

-- ----------------------------------------------------------------------------
-- C. takroriy_yozuv
--   record (belgi): shu created_by, obyekt, material, tur (harakat) / total_amount
--     (xarid), qty_base — companies.duplicate_window_minutes ichida avval kiritilgan
--     tirik yozuv bor. Faqat INSERT; faqat kirim/chiqim; created_by null — tizim, yo'q.
--   photo (ogohlantirish): shu firmada shu SHA-256 boshqa tirik yozuvda
--     (movements.photo_sha256 yoki purchases.receipt_photo_sha256).
--   Yozuv + kind (+ sha) bo'yicha bitta alert.
-- ----------------------------------------------------------------------------
create function private.evaluate_duplicate(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company  uuid;
  v_by       uuid;
  v_object   uuid;
  v_material uuid;
  v_qty      numeric;
  v_total    numeric;
  v_type     text;
  v_created  timestamptz;
  v_deleted  timestamptz;
  v_window   integer;
  v_first    uuid;
begin
  if p_table = 'movements' then
    select m.company_id, m.created_by, m.object_id, m.material_id, m.qty_base, null, m.type::text,
           m.created_at, m.deleted_at
      into v_company, v_by, v_object, v_material, v_qty, v_total, v_type, v_created, v_deleted
      from public.movements m where m.id = p_id;
  else
    select p.company_id, p.created_by, p.object_id, p.material_id, p.qty_base, p.total_amount, null,
           p.created_at, p.deleted_at
      into v_company, v_by, v_object, v_material, v_qty, v_total, v_type, v_created, v_deleted
      from public.purchases p where p.id = p_id;
  end if;
  if v_company is null or v_deleted is not null or v_by is null then
    return;
  end if;
  if p_table = 'movements' and v_type not in ('kirim', 'chiqim') then
    return;
  end if;

  select c.duplicate_window_minutes into v_window from public.companies c where c.id = v_company;
  if coalesce(v_window, 0) <= 0 then
    return;   -- qoida o'chiq
  end if;

  if p_table = 'movements' then
    select m.id into v_first
      from public.movements m
     where m.company_id = v_company
       and m.created_by = v_by
       and m.object_id = v_object
       and m.material_id = v_material
       and m.type::text = v_type
       and m.qty_base = v_qty
       and m.deleted_at is null
       and m.id <> p_id
       and m.created_at <= v_created
       and m.created_at >= v_created - make_interval(mins => v_window)
     order by m.created_at, m.id
     limit 1;
  else
    select p.id into v_first
      from public.purchases p
     where p.company_id = v_company
       and p.created_by = v_by
       and p.object_id = v_object
       and p.material_id = v_material
       and p.qty_base = v_qty
       and p.total_amount = v_total
       and p.deleted_at is null
       and p.id <> p_id
       and p.created_at <= v_created
       and p.created_at >= v_created - make_interval(mins => v_window)
     order by p.created_at, p.id
     limit 1;
  end if;
  if v_first is null then
    return;
  end if;

  perform private.alert_lock('takroriy_yozuv:record:' || p_id::text);
  if exists (
    select 1 from public.alerts a
     where a.company_id = v_company
       and a.type = 'takroriy_yozuv'
       and a.deleted_at is null
       and (a.details ->> 'record_id') = p_id::text
       and (a.details ->> 'kind') = 'record'
  ) then
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, material_id, movement_id, purchase_id, details)
  values (v_company, 'takroriy_yozuv', 'belgi', v_object, v_material,
          case when p_table = 'movements' then p_id end,
          case when p_table = 'purchases' then p_id end,
          jsonb_build_object(
            'kind',           'record',
            'table',          p_table,
            'record_id',      p_id,
            'first_id',       v_first,
            'window_minutes', v_window,
            'qty_base',       v_qty,
            'total_amount',   v_total,
            'movement_type',  v_type));
end;
$$;

create function private.evaluate_duplicate_photo(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company  uuid;
  v_object   uuid;
  v_material uuid;
  v_sha      text;
  v_deleted  timestamptz;
  v_first    record;
begin
  if p_table = 'movements' then
    select m.company_id, m.object_id, m.material_id, m.photo_sha256, m.deleted_at
      into v_company, v_object, v_material, v_sha, v_deleted
      from public.movements m where m.id = p_id;
  else
    select p.company_id, p.object_id, p.material_id, p.receipt_photo_sha256, p.deleted_at
      into v_company, v_object, v_material, v_sha, v_deleted
      from public.purchases p where p.id = p_id;
  end if;
  if v_company is null or v_sha is null or v_deleted is not null then
    return;
  end if;

  select x.tbl, x.id into v_first
    from (
      select 'movements'::text as tbl, m.id, m.created_at
        from public.movements m
       where m.company_id = v_company and m.photo_sha256 = v_sha and m.deleted_at is null
         and not (p_table = 'movements' and m.id = p_id)
      union all
      select 'purchases', p.id, p.created_at
        from public.purchases p
       where p.company_id = v_company and p.receipt_photo_sha256 = v_sha and p.deleted_at is null
         and not (p_table = 'purchases' and p.id = p_id)
    ) x
   order by x.created_at, x.id
   limit 1;
  if not found then
    return;
  end if;

  perform private.alert_lock('takroriy_yozuv:photo:' || p_id::text);
  if exists (
    select 1 from public.alerts a
     where a.company_id = v_company
       and a.type = 'takroriy_yozuv'
       and a.deleted_at is null
       and (a.details ->> 'record_id') = p_id::text
       and (a.details ->> 'kind') = 'photo'
       and (a.details ->> 'sha256') = v_sha
  ) then
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, material_id, movement_id, purchase_id, details)
  values (v_company, 'takroriy_yozuv', 'ogohlantirish', v_object, v_material,
          case when p_table = 'movements' then p_id end,
          case when p_table = 'purchases' then p_id end,
          jsonb_build_object(
            'kind',        'photo',
            'table',       p_table,
            'record_id',   p_id,
            'first_id',    v_first.id,
            'first_table', v_first.tbl,
            'sha256',      v_sha));
end;
$$;

-- ----------------------------------------------------------------------------
-- D. joylashuv_farqi (belgi) — kirim/chiqim, geo_status = 'ok', obyekt koordinatasi
--   bor, distance_m > radius_m + least(coalesce(geo_accuracy_m, 0), radius_m) (aniqlik
--   radiusdan oshmaydi — juda noaniq GPS alertni "yutib" yubormasin). Harakat bo'yicha bitta;
--   shart yo'qolsa ochig'i yopiladi (not_applicable). Xarid — faqat saqlanadi.
-- ----------------------------------------------------------------------------
create function private.evaluate_geo(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m     public.movements%rowtype;
  v_o     record;
  v_dist  integer;
  v_far   boolean := false;
  v_alert public.alerts%rowtype;
begin
  select m.* into v_m from public.movements m where m.id = p_movement_id;
  if not found then
    return;
  end if;
  perform private.alert_lock('joylashuv_farqi:' || v_m.id::text);

  select o.lat, o.lng, o.radius_m into v_o
    from public.objects o
   where o.company_id = v_m.company_id and o.id = v_m.object_id;

  if v_m.deleted_at is null and v_m.type in ('kirim', 'chiqim') and v_m.geo_status = 'ok'
     and v_m.geo_lat is not null and v_o.lat is not null then
    v_dist := private.geo_distance_m(v_m.geo_lat, v_m.geo_lng, v_o.lat, v_o.lng);
    v_far := v_dist > greatest(coalesce(v_o.radius_m, 0), 0)
                     + least(greatest(coalesce(v_m.geo_accuracy_m, 0), 0), greatest(coalesce(v_o.radius_m, 0), 0));
  end if;

  select a.* into v_alert
    from public.alerts a
   where a.company_id = v_m.company_id
     and a.movement_id = v_m.id
     and a.type = 'joylashuv_farqi'
     and a.deleted_at is null
   order by a.created_at desc
   limit 1;

  if not v_far then
    if v_alert.id is not null and v_alert.status in ('yangi', 'korildi') then
      perform private.auto_close_alert(v_alert.id, 'not_applicable');
    end if;
    return;
  end if;

  if v_alert.id is not null and v_alert.status in ('yangi', 'korildi') then
    if (v_alert.details ->> 'distance_m')::integer is distinct from v_dist then
      update public.alerts
         set details = details || jsonb_build_object(
               'distance_m', v_dist, 'radius_m', v_o.radius_m, 'accuracy_m', v_m.geo_accuracy_m,
               'geo_lat', v_m.geo_lat, 'geo_lng', v_m.geo_lng, 'object_lat', v_o.lat, 'object_lng', v_o.lng)
       where id = v_alert.id;
    end if;
    return;
  end if;
  if v_alert.id is not null and not coalesce((v_alert.details ->> 'auto_closed')::boolean, false) then
    return;   -- admin qo'lda yopgan
  end if;

  insert into public.alerts (company_id, type, severity, object_id, material_id, movement_id, details)
  values (v_m.company_id, 'joylashuv_farqi', 'belgi', v_m.object_id, v_m.material_id, v_m.id,
          jsonb_build_object(
            'distance_m',    v_dist,
            'radius_m',      v_o.radius_m,
            'accuracy_m',    v_m.geo_accuracy_m,
            'geo_lat',       v_m.geo_lat,
            'geo_lng',       v_m.geo_lng,
            'object_lat',    v_o.lat,
            'object_lng',    v_o.lng,
            'movement_type', v_m.type));
end;
$$;

-- ----------------------------------------------------------------------------
-- G. chek_farqi (ogohlantirish) — |receipt_total − total_amount| > 1 so'm. Keshdagi chek
--   ko'p qatorli (payload.items > 1) bo'lsa — taqqoslanmaydi (multi_line_receipt).
--   Xarid bo'yicha bitta ochiq; tuzatilsa yopiladi (within_threshold); o'chirilsa —
--   Batch 5 close_purchase_alerts. Admin qo'lda yopgan bir xil raqamlar — qayta yo'q.
-- ----------------------------------------------------------------------------
create function private.evaluate_receipt_total(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p       public.purchases%rowtype;
  v_alert   public.alerts%rowtype;
  v_details jsonb;
  v_multi   boolean;
begin
  select p.* into v_p from public.purchases p where p.id = p_purchase_id;
  if not found then
    return;
  end if;
  perform private.alert_lock('chek_farqi:' || v_p.id::text);

  select a.* into v_alert
    from public.alerts a
   where a.company_id = v_p.company_id
     and a.purchase_id = v_p.id
     and a.type = 'chek_farqi'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
   limit 1;

  -- Ko'p qatorli chek (kesh payload.items > 1): xarid — bitta qator, jami taqqoslanmaydi
  if v_p.receipt_fiscal_sign is not null then
    select case when jsonb_typeof(l.payload -> 'items') = 'array'
                then jsonb_array_length(l.payload -> 'items') > 1 else false end
      into v_multi
      from public.receipt_lookups l
     where l.company_id = v_p.company_id
       and l.fiscal_sign = v_p.receipt_fiscal_sign
       and l.deleted_at is null;
  end if;
  v_multi := coalesce(v_multi, false);

  if v_p.deleted_at is not null or v_p.receipt_total is null or v_multi
     or abs(v_p.receipt_total - v_p.total_amount) <= 1 then
    if v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id,
        case when v_p.deleted_at is not null then 'purchase_deleted'
             when v_multi then 'multi_line_receipt'
             else 'within_threshold' end);
    end if;
    return;
  end if;

  v_details := jsonb_build_object(
    'receipt_total',       v_p.receipt_total,
    'total_amount',        v_p.total_amount,
    'diff',                v_p.total_amount - v_p.receipt_total,
    'receipt_fiscal_sign', v_p.receipt_fiscal_sign,
    'receipt_verified',    v_p.receipt_verified);

  if v_alert.id is not null then
    if (v_alert.details - private.alert_meta_keys()) is distinct from v_details then
      update public.alerts
         set details = v_alert.details || v_details, object_id = v_p.object_id, material_id = v_p.material_id
       where id = v_alert.id;
    end if;
    return;
  end if;

  if exists (
    select 1 from public.alerts a
     where a.company_id = v_p.company_id
       and a.purchase_id = v_p.id
       and a.type = 'chek_farqi'
       and a.status = 'yopildi'
       and a.deleted_at is null
       and coalesce((a.details ->> 'auto_closed')::boolean, false) = false
       and (a.details ->> 'receipt_total')::numeric = v_p.receipt_total
       and (a.details ->> 'total_amount')::numeric = v_p.total_amount
  ) then
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, material_id, purchase_id, details)
  values (v_p.company_id, 'chek_farqi', 'ogohlantirish', v_p.object_id, v_p.material_id, v_p.id, v_details);
end;
$$;

-- ----------------------------------------------------------------------------
-- H. So'rov ↔ xarid.
--   sync_request_purchase: so'rovga bog'langan tirik xaridlar bo'lsa va so'rov
--   tasdiqlandi / xarid_qilindi bo'lsa — xarid_qilindi, purchase_id = (joriysi tirik va
--   shu so'rovniki bo'lsa — o'sha, aks holda eng oxirgisi). Tirik xarid qolmasa va
--   purchase_id shu so'rov xaridiga (o'chirilgan) ko'rsatsa — tasdiqlandi, null.
--   Qo'lda bog'langan (request_id siz xarid) — o'zgarmaydi. Mavjud guard amal qiladi.
--   evaluate_request_overbuy: Σ xarid > so'rov × (1 + request_overbuy_pct / 100) →
--   sorovdan_ortiq_xarid (belgi), so'rov bo'yicha bitta ochiq.
-- ----------------------------------------------------------------------------
create function private.evaluate_request_overbuy(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r       public.material_requests%rowtype;
  v_pct     numeric;
  v_sum     numeric(20,6);
  v_cnt     integer;
  v_last    uuid;
  v_over    numeric;
  v_unit    text;
  v_alert   public.alerts%rowtype;
  v_details jsonb;
begin
  select r.* into v_r from public.material_requests r where r.id = p_request_id;
  if not found then
    return;
  end if;
  perform private.alert_lock('sorovdan_ortiq_xarid:' || v_r.id::text);

  select c.request_overbuy_pct into v_pct from public.companies c where c.id = v_r.company_id;
  select coalesce(sum(p.qty_base), 0)::numeric(20,6), count(*)::integer,
         (array_agg(p.id order by p.created_at desc, p.id desc))[1]
    into v_sum, v_cnt, v_last
    from public.purchases p
   where p.company_id = v_r.company_id and p.request_id = v_r.id and p.deleted_at is null;

  select a.* into v_alert
    from public.alerts a
   where a.company_id = v_r.company_id
     and a.request_id = v_r.id
     and a.type = 'sorovdan_ortiq_xarid'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
   limit 1;

  if v_r.deleted_at is not null or v_cnt = 0 or v_sum * 100 <= v_r.qty_base * (100 + v_pct) then
    if v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id,
        case when v_r.deleted_at is not null then 'request_deleted' else 'within_threshold' end);
    end if;
    return;
  end if;

  v_over := round((v_sum - v_r.qty_base) * 100 / v_r.qty_base, 2);
  select m.base_unit into v_unit from public.materials m
   where m.company_id = v_r.company_id and m.id = v_r.material_id;
  v_details := jsonb_build_object(
    'request_qty_base',   v_r.qty_base,
    'purchased_qty_base', v_sum,
    'over_pct',           v_over,
    'threshold_pct',      v_pct,
    'base_unit',          v_unit,
    'purchase_count',     v_cnt);

  if v_alert.id is not null then
    if (v_alert.details - private.alert_meta_keys()) is distinct from v_details then
      update public.alerts set details = v_alert.details || v_details, purchase_id = v_last where id = v_alert.id;
    end if;
    return;
  end if;

  if exists (
    select 1 from public.alerts a
     where a.company_id = v_r.company_id
       and a.request_id = v_r.id
       and a.type = 'sorovdan_ortiq_xarid'
       and a.status = 'yopildi'
       and a.deleted_at is null
       and coalesce((a.details ->> 'auto_closed')::boolean, false) = false
       and (a.details ->> 'purchased_qty_base')::numeric = v_sum
  ) then
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, material_id, request_id, purchase_id, details)
  values (v_r.company_id, 'sorovdan_ortiq_xarid', 'belgi', v_r.object_id, v_r.material_id, v_r.id, v_last, v_details);
end;
$$;

create function private.sync_request_purchase(p_company_id uuid, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      public.material_requests%rowtype;
  v_latest uuid;
  v_target uuid;
begin
  select r.* into v_r
    from public.material_requests r
   where r.company_id = p_company_id and r.id = p_request_id
     for update;
  if not found or v_r.deleted_at is not null then
    return;
  end if;

  select p.id into v_latest
    from public.purchases p
   where p.company_id = p_company_id and p.request_id = p_request_id and p.deleted_at is null
   order by p.created_at desc, p.id desc
   limit 1;

  if v_latest is not null then
    if v_r.status not in ('tasdiqlandi', 'xarid_qilindi') then
      return;
    end if;
    v_target := case
      when v_r.purchase_id is not null and exists (
             select 1 from public.purchases p
              where p.company_id = p_company_id and p.id = v_r.purchase_id
                and p.deleted_at is null and p.request_id = p_request_id)
        then v_r.purchase_id
      else v_latest
    end;
    if v_r.status is distinct from 'xarid_qilindi' or v_r.purchase_id is distinct from v_target then
      update public.material_requests
         set status = 'xarid_qilindi', purchase_id = v_target
       where id = v_r.id;
    end if;
  elsif v_r.status = 'xarid_qilindi' and v_r.purchase_id is not null and exists (
          select 1 from public.purchases p
           where p.company_id = p_company_id and p.id = v_r.purchase_id
             and p.request_id = p_request_id and p.deleted_at is not null) then
    update public.material_requests
       set status = 'tasdiqlandi', purchase_id = null
     where id = v_r.id;
  end if;
end;
$$;

-- ============================================================================
-- 7. AFTER triggerlar (zz_automation — zz_alert_rules dan keyin, zz_deleted_alert dan oldin)
-- ============================================================================

-- movements
create function private.tg_movements_automation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pid  uuid;
  v_pair record;
  v_day  record;
  v_kirim boolean;
begin
  v_kirim := new.type = 'kirim' or (tg_op = 'UPDATE' and old.type = 'kirim');

  -- A: kirim manbasi va nomzod xaridlarni qayta baholash
  if v_kirim and (tg_op = 'INSERT'
                  or new.purchase_id is distinct from old.purchase_id
                  or new.deleted_at  is distinct from old.deleted_at
                  or new.object_id   is distinct from old.object_id
                  or new.material_id is distinct from old.material_id
                  or new.occurred_at is distinct from old.occurred_at
                  or new.qty_base    is distinct from old.qty_base
                  or new.type        is distinct from old.type) then
    perform private.evaluate_kirim_source(new.id);
    for v_pid in
      select p.id
        from public.purchases p
       where p.company_id = new.company_id
         and p.object_id = new.object_id
         and p.material_id = new.material_id
         and p.deleted_at is null
         and p.purchased_at between new.occurred_at - interval '72 hours' and new.occurred_at
         and (p.id is distinct from new.purchase_id)
         and (exists (select 1 from public.alerts a
                       where a.company_id = p.company_id and a.purchase_id = p.id
                         and a.type = 'xarid_qabul_farqi' and a.status in ('yangi', 'korildi')
                         and a.deleted_at is null)
              or exists (select 1 from public.alerts a
                          where a.company_id = p.company_id and a.purchase_id = p.id
                            and a.type = 'kirim_manbasiz' and a.deleted_at is null))
       order by p.id
    loop
      perform private.evaluate_purchase_receipt(v_pid);
    end loop;
  end if;

  -- B: manfiy qoldiq (eski va yangi obyekt+material)
  for v_pair in
    select distinct x.o, x.m
      from (select new.object_id as o, new.material_id as m
            union all
            select old.object_id, old.material_id where tg_op = 'UPDATE') x
     order by 1, 2
  loop
    perform private.evaluate_negative_stock(new.company_id, v_pair.o, v_pair.m, new.id);
  end loop;

  -- F: smetasiz chiqim (eski va yangi obyekt)
  if new.type = 'chiqim' or (tg_op = 'UPDATE' and old.type = 'chiqim') then
    for v_day in
      select distinct x.o
        from (select new.object_id as o
              union all
              select old.object_id where tg_op = 'UPDATE') x
       order by 1
    loop
      perform private.evaluate_no_estimate_chiqim(new.company_id, v_day.o, new.id);
    end loop;
  end if;

  -- C: takroriy yozuv (faqat INSERT), rasm xeshi (INSERT / xesh o'zgarganda / tiklashda)
  if tg_op = 'INSERT' then
    perform private.evaluate_duplicate('movements', new.id);
  end if;
  if new.photo_sha256 is not null
     and (tg_op = 'INSERT' or new.photo_sha256 is distinct from old.photo_sha256
          or (old.deleted_at is not null and new.deleted_at is null)) then
    perform private.evaluate_duplicate_photo('movements', new.id);
  end if;

  -- D: joylashuv
  if tg_op = 'INSERT' and new.geo_status = 'ok'
     or (tg_op = 'UPDATE' and (new.geo_lat is distinct from old.geo_lat
                               or new.geo_lng is distinct from old.geo_lng
                               or new.geo_accuracy_m is distinct from old.geo_accuracy_m
                               or new.geo_status is distinct from old.geo_status
                               or new.object_id is distinct from old.object_id
                               or new.deleted_at is distinct from old.deleted_at)) then
    perform private.evaluate_geo(new.id);
  end if;
  return null;
end;
$$;

create trigger zz_automation_ins after insert on public.movements
  for each row execute function private.tg_movements_automation();
create trigger zz_automation_upd after update on public.movements
  for each row
  when (old.deleted_at     is distinct from new.deleted_at
     or old.qty_base       is distinct from new.qty_base
     or old.purchase_id    is distinct from new.purchase_id
     or old.object_id      is distinct from new.object_id
     or old.material_id    is distinct from new.material_id
     or old.occurred_at    is distinct from new.occurred_at
     or old.type           is distinct from new.type
     or old.photo_sha256   is distinct from new.photo_sha256
     or old.geo_lat        is distinct from new.geo_lat
     or old.geo_lng        is distinct from new.geo_lng
     or old.geo_accuracy_m is distinct from new.geo_accuracy_m
     or old.geo_status     is distinct from new.geo_status)
  execute function private.tg_movements_automation();

-- purchases
create function private.tg_purchases_automation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req uuid;
  v_mv  uuid;
begin
  -- H: so'rov holati va ortiqcha xarid (eski va yangi so'rov)
  for v_req in
    select distinct x.r
      from (select new.request_id as r
            union all
            select old.request_id where tg_op = 'UPDATE') x
     where x.r is not null
     order by 1
  loop
    perform private.sync_request_purchase(new.company_id, v_req);
    perform private.evaluate_request_overbuy(v_req);
  end loop;

  -- G: chek summasi
  if tg_op = 'INSERT'
     or new.receipt_total is distinct from old.receipt_total
     or new.total_amount  is distinct from old.total_amount
     or new.deleted_at    is distinct from old.deleted_at then
    perform private.evaluate_receipt_total(new.id);
  end if;

  -- C
  if tg_op = 'INSERT' then
    perform private.evaluate_duplicate('purchases', new.id);
  end if;
  if new.receipt_photo_sha256 is not null
     and (tg_op = 'INSERT' or new.receipt_photo_sha256 is distinct from old.receipt_photo_sha256
          or (old.deleted_at is not null and new.deleted_at is null)) then
    perform private.evaluate_duplicate_photo('purchases', new.id);
  end if;

  -- A: yangi / o'zgargan xarid — shu obyekt+materialdagi bog'lanmagan kirimlar manbasi
  if tg_op = 'INSERT'
     or new.deleted_at  is distinct from old.deleted_at
     or new.object_id   is distinct from old.object_id
     or new.material_id is distinct from old.material_id
     or new.qty_base    is distinct from old.qty_base
     or new.purchased_at is distinct from old.purchased_at then
    for v_mv in
      select a.movement_id
        from public.alerts a
       where a.company_id = new.company_id
         and a.type = 'kirim_manbasiz'
         and a.status in ('yangi', 'korildi')
         and a.deleted_at is null
         and a.movement_id is not null
         and ((a.object_id = new.object_id and a.material_id = new.material_id)
              or (tg_op = 'UPDATE' and a.object_id = old.object_id and a.material_id = old.material_id))
       order by 1
    loop
      perform private.evaluate_kirim_source(v_mv);
    end loop;
  end if;
  return null;
end;
$$;

create trigger zz_automation_ins after insert on public.purchases
  for each row execute function private.tg_purchases_automation();
create trigger zz_automation_upd after update on public.purchases
  for each row
  when (old.deleted_at           is distinct from new.deleted_at
     or old.request_id           is distinct from new.request_id
     or old.receipt_total        is distinct from new.receipt_total
     or old.total_amount         is distinct from new.total_amount
     or old.receipt_photo_sha256 is distinct from new.receipt_photo_sha256
     or old.object_id            is distinct from new.object_id
     or old.material_id          is distinct from new.material_id
     or old.qty_base             is distinct from new.qty_base
     or old.purchased_at         is distinct from new.purchased_at)
  execute function private.tg_purchases_automation();

-- So'rov o'chirilsa / tiklansa — ortiqcha xarid alerti qayta baholanadi.
create function private.tg_requests_overbuy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.evaluate_request_overbuy(new.id);
  return null;
end;
$$;

create trigger zz_automation_upd after update on public.material_requests
  for each row
  when (old.deleted_at is distinct from new.deleted_at or old.qty_base is distinct from new.qty_base)
  execute function private.tg_requests_overbuy();

-- ============================================================================
-- 8. create_transfer (Batch 8 versiyasi) + manba qoldig'i tekshiruvi:
--    so'ralgan miqdor (asosiy birlikda) > from obyekt qoldig'i →
--    22023 transfer_insufficient_stock (xabarda mavjud qoldiq; detail — raqam).
--    Obyekt+material bo'yicha advisory lock — parallel o'tkazmalar navbat bilan.
-- ============================================================================
create or replace function public.create_transfer(
  p_id             uuid,
  p_from_object_id uuid,
  p_to_object_id   uuid,
  p_material_id    uuid,
  p_unit_id        uuid,
  p_qty_input      numeric,
  p_note           text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.my_profile_id();
  v_company uuid;
  v_ex      public.transfers%rowtype;
  v_note    text := nullif(btrim(p_note), '');
  v_factor  numeric;
  v_stock   numeric(20,6);
  v_need    numeric(20,6);
  v_unit    text;
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  if p_id is null or p_from_object_id is null or p_to_object_id is null
     or p_material_id is null or p_unit_id is null then
    raise exception 'O''tkazma ma''lumotlari to''liq emas'
      using errcode = '22023', hint = 'transfer_invalid';
  end if;
  if p_from_object_id = p_to_object_id then
    raise exception 'Qayerdan va qayerga — bir xil obyekt'
      using errcode = '22023', hint = 'transfer_invalid';
  end if;
  if p_qty_input is null or round(p_qty_input, 6) <= 0 or p_qty_input >= 1e14 then
    raise exception 'Miqdor 0 dan katta bo''lishi kerak'
      using errcode = '22023', hint = 'transfer_invalid';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Izoh juda uzun (500 belgigacha)'
      using errcode = '22023', hint = 'transfer_invalid';
  end if;

  select o.company_id into v_company
    from public.objects o
   where o.id = p_from_object_id and o.deleted_at is null;
  if not found or not private.can_access_company(v_company)
     or not exists (select 1 from public.objects o
                     where o.company_id = v_company and o.id = p_to_object_id and o.deleted_at is null
                       and o.status = 'faol') then
    raise exception 'Obyekt topilmadi'
      using errcode = 'P0002', hint = 'transfer_object_not_found';
  end if;

  if not (private.has_role('super_admin', 'admin')
          or (private.has_role('prorab') and p_from_object_id in (select private.my_object_ids()))) then
    raise exception 'Bu obyektdan o''tkazma yuborishga ruxsat yo''q'
      using errcode = '42501', hint = 'transfer_forbidden';
  end if;

  if not exists (select 1 from public.materials m where m.company_id = v_company and m.id = p_material_id) then
    raise exception 'Material topilmadi'
      using errcode = '22023', hint = 'transfer_invalid';
  end if;

  -- Idempotentlik
  perform pg_advisory_xact_lock(hashtextextended('terron.transfer:' || p_id::text, 0));
  select t.* into v_ex from public.transfers t where t.id = p_id;
  if found then
    if v_ex.company_id = v_company
       and v_ex.from_object_id = p_from_object_id and v_ex.to_object_id = p_to_object_id
       and v_ex.material_id = p_material_id and v_ex.unit_id = p_unit_id
       and v_ex.qty_input = round(p_qty_input, 6) then
      return p_id;
    end if;
    raise exception 'Bu o''tkazma id boshqa ma''lumot bilan allaqachon ishlatilgan'
      using errcode = '23505', hint = 'transfer_id_reused';
  end if;

  -- Batch 12 (B): manba qoldig'i. Birlik topilmasa — b_compute_qty o'z xatosini beradi.
  select mu.factor into v_factor
    from public.material_units mu
   where mu.company_id = v_company and mu.id = p_unit_id
     and mu.material_id = p_material_id and mu.deleted_at is null;
  if found then
    perform pg_advisory_xact_lock(hashtextextended(
      'terron.stock:' || p_from_object_id::text || ':' || p_material_id::text, 0));
    v_stock := private.object_stock(v_company, p_from_object_id, p_material_id);
    v_need  := round(round(p_qty_input, 6) * v_factor, 6);
    if v_need > v_stock then
      select m.base_unit into v_unit from public.materials m
       where m.company_id = v_company and m.id = p_material_id;
      raise exception 'Manba obyektda qoldiq yetarli emas: mavjud % %',
        private.history_num(greatest(v_stock, 0)), v_unit
        using errcode = '22023', hint = 'transfer_insufficient_stock', detail = v_stock::text;
    end if;
  end if;

  perform set_config('terron.transfer_rpc', 'on', true);

  insert into public.transfers
    (id, company_id, from_object_id, to_object_id, material_id, unit_id, qty_input, unit_input,
     qty_base, status, note, created_by)
  values
    (p_id, v_company, p_from_object_id, p_to_object_id, p_material_id, p_unit_id, p_qty_input, '-',
     0, 'yuborildi', v_note, v_me);

  insert into public.movements
    (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base,
     transfer_id, note, created_by)
  values
    (v_company, 'transfer_out', p_from_object_id, p_material_id, p_unit_id, p_qty_input, '-',
     0, p_id, v_note, v_me);

  perform set_config('terron.transfer_rpc', 'off', true);
  return p_id;
end;
$$;

-- ============================================================================
-- 9. Podotchet: cash_balances (qaytarish bilan), dashboard_summary
-- ============================================================================
create or replace view public.cash_balances
with (security_invoker = true)
as
with ledger as (
  select ca.company_id,
         ca.recipient_id                                                           as profile_id,
         (case when ca.kind = 'berildi' then ca.amount else 0 end)::numeric(18,2)    as issued,
         0::numeric(18,2)                                                          as spent,
         (case when ca.kind = 'qaytarildi' then ca.amount else 0 end)::numeric(18,2) as returned,
         case when ca.kind = 'berildi' then ca.issued_at end                       as issued_ts,
         null::timestamptz                                                         as spent_ts
    from public.cash_advances ca
   where ca.deleted_at is null
  union all
  select p.company_id,
         p.buyer_id,
         0::numeric(18,2),
         p.total_amount,
         0::numeric(18,2),
         null::timestamptz,
         p.purchased_at
    from public.purchases p
   where p.deleted_at is null
)
select l.company_id,
       l.profile_id,
       sum(l.issued)::numeric(18,2)                                   as issued_total,
       sum(l.spent)::numeric(18,2)                                    as spent_total,
       (sum(l.issued) - sum(l.returned) - sum(l.spent))::numeric(18,2) as balance,
       max(l.issued_ts)                                               as last_issued_at,
       max(l.spent_ts)                                                as last_spent_at,
       sum(l.returned)::numeric(18,2)                                 as returned_total
  from ledger l
 where l.profile_id = (select private.my_profile_id())
    or (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter'))
    or current_user in ('service_role', 'postgres')
 group by l.company_id, l.profile_id;

comment on view public.cash_balances is
  'Qo''limdagi pul: berildi − qaytarildi (cash_advances.kind) − sarflangan (purchases), o''chirilmaganlar. '
  'Qator faqat chaqiruvchi shu odamning podotchetini to''liq ko''ra olsa chiqadi '
  '(admin/direktor/buxgalter/super_admin — hamma, boshqalar — o''zi).';

-- Batch 9 versiyasi: cash_issued_sum — faqat 'berildi'; yangi cash_returned_sum.
create or replace function public.dashboard_summary(p_from date, p_to date, p_object_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_period    record;
  v_company   uuid;
  v_kirim     integer;
  v_chiqim    integer;
  v_p_count   integer;
  v_p_sum     numeric(18,2);
  v_cash_iss  numeric(18,2);
  v_cash_ret  numeric(18,2);
  v_cash_hand numeric(18,2);
  v_al_open   integer;
  v_al_ser    integer;
  v_al_new    integer;
  v_unrec     integer;
  v_tr_pend   integer;
  v_rq_pend   integer;
  v_over      integer;
begin
  select * into v_period from private.report_period(p_from, p_to);
  v_company := private.report_company(p_object_id);

  select count(*) filter (where m.type = 'kirim'),
         count(*) filter (where m.type = 'chiqim')
    into v_kirim, v_chiqim
    from public.movements m
   where m.company_id = v_company
     and m.deleted_at is null
     and m.type in ('kirim', 'chiqim')
     and m.occurred_at >= v_period.o_start and m.occurred_at < v_period.o_end
     and (p_object_id is null or m.object_id = p_object_id);

  select count(*), coalesce(sum(p.total_amount), 0)
    into v_p_count, v_p_sum
    from public.purchases p
   where p.company_id = v_company
     and p.deleted_at is null
     and p.purchased_at >= v_period.o_start and p.purchased_at < v_period.o_end
     and (p_object_id is null or p.object_id = p_object_id);

  select coalesce(sum(ca.amount) filter (where ca.kind = 'berildi'), 0),
         coalesce(sum(ca.amount) filter (where ca.kind = 'qaytarildi'), 0)
    into v_cash_iss, v_cash_ret
    from public.cash_advances ca
   where ca.company_id = v_company
     and ca.deleted_at is null
     and ca.issued_at >= v_period.o_start and ca.issued_at < v_period.o_end;

  select coalesce(sum(cb.balance), 0)
    into v_cash_hand
    from public.cash_balances cb
   where cb.company_id = v_company;

  select count(*) filter (where a.status in ('yangi', 'korildi')),
         count(*) filter (where a.status in ('yangi', 'korildi') and a.severity = 'jiddiy'),
         count(*) filter (where a.created_at >= v_period.o_start and a.created_at < v_period.o_end)
    into v_al_open, v_al_ser, v_al_new
    from public.alerts a
   where a.company_id = v_company
     and a.deleted_at is null
     and a.severity <> 'belgi'
     and (a.status in ('yangi', 'korildi')
          or (a.created_at >= v_period.o_start and a.created_at < v_period.o_end))
     and (p_object_id is null or a.object_id = p_object_id);

  select count(distinct nu.object_id)
    into v_over
    from public.norm_usage nu
    join public.objects o
      on o.company_id = nu.company_id and o.id = nu.object_id and o.deleted_at is null
   where nu.company_id = v_company
     and nu.consumed_qty_base > nu.allowed_qty_base
     and (p_object_id is null or nu.object_id = p_object_id);

  select count(*)
    into v_unrec
    from public.purchases p
   where p.company_id = v_company
     and p.deleted_at is null
     and p.purchased_at < now() - interval '24 hours'
     and p.purchased_at >= now() - interval '90 days'
     and (p_object_id is null or p.object_id = p_object_id)
     and not private.purchase_has_receipt(p.company_id, p.id);

  select count(*)
    into v_tr_pend
    from public.transfers t
   where t.company_id = v_company
     and t.deleted_at is null
     and t.status = 'yuborildi'
     and (p_object_id is null or t.from_object_id = p_object_id or t.to_object_id = p_object_id);

  select count(*)
    into v_rq_pend
    from public.material_requests rq
   where rq.company_id = v_company
     and rq.deleted_at is null
     and rq.status = 'kutilmoqda'
     and (p_object_id is null or rq.object_id = p_object_id);

  return jsonb_build_object(
    'kirim_count',                v_kirim,
    'chiqim_count',               v_chiqim,
    'purchases_count',            v_p_count,
    'purchases_sum',              v_p_sum::text,
    'cash_issued_sum',            v_cash_iss::text,
    'cash_returned_sum',          v_cash_ret::text,
    'cash_on_hand_total',         v_cash_hand::text,
    'alerts_open',                v_al_open,
    'alerts_serious_open',        v_al_ser,
    'alerts_new_in_period',       v_al_new,
    'unreceived_purchases_count', v_unrec,
    'pending_transfers_count',    v_tr_pend,
    'pending_requests_count',     v_rq_pend,
    'objects_over_norm_count',    v_over
  );
end;
$$;

-- ============================================================================
-- 10. K. Material tugash prognozi
--    stock_qty_base     = qoldiq (stock_balances formulasi);
--    avg_daily_qty_base = round(Σ chiqim [Toshkent bugun − 13 .. bugun] / 14, 6)
--                         (transfer_out va inventory_adjust kirmaydi);
--    days_left          = avg ≤ 0 → null; stock ≤ 0 → 0; aks holda round(stock / avg, 1)
--                         (src/domain forecastDays(stockBase, avgDaily) bilan bir xil);
--    other_objects_qty_base — boshqa (o'chirilmagan) obyektlardagi musbat qoldiqlar
--                         yig'indisi, faqat chaqiruvchi ko'radiganlari (RLS);
--    estimate_remaining_qty_base — norm_usage.remaining_qty_base (joriy smeta yo'q → null).
--    Qatorlar: qoldig'i ≠ 0 yoki 14 kunda chiqimi bor materiallar. security invoker.
-- ============================================================================
create function public.stock_forecast(p_object_id uuid)
returns table (
  material_id                 uuid,
  material_name               text,
  base_unit                   text,
  stock_qty_base              numeric,
  avg_daily_qty_base          numeric,
  days_left                   numeric,
  other_objects_qty_base      numeric,
  estimate_remaining_qty_base numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with mv as (
    select m.company_id,
           m.material_id,
           sum(case m.type
                 when 'kirim'            then m.qty_base
                 when 'transfer_in'      then m.qty_base
                 when 'chiqim'           then -m.qty_base
                 when 'transfer_out'     then -m.qty_base
                 when 'inventory_adjust' then m.qty_base
               end)::numeric(20,6) as stock,
           coalesce(sum(m.qty_base) filter (
             where m.type = 'chiqim'
               and (m.occurred_at at time zone 'Asia/Tashkent')::date
                   between (now() at time zone 'Asia/Tashkent')::date - 13
                       and (now() at time zone 'Asia/Tashkent')::date), 0)::numeric(20,6) as out14
      from public.movements m
     where m.object_id = p_object_id
       and m.company_id = (select o.company_id from public.objects o where o.id = p_object_id)
       and m.deleted_at is null
     group by m.company_id, m.material_id
  ),
  f as (
    select mv.company_id, mv.material_id, mv.stock, round(mv.out14 / 14, 6) as avg_daily
      from mv
     where mv.stock <> 0 or mv.out14 > 0
  )
  select f.material_id,
         mt.name::text,
         mt.base_unit::text,
         f.stock,
         f.avg_daily,
         case when f.avg_daily <= 0 then null
              when f.stock <= 0 then 0::numeric
              else round(f.stock / f.avg_daily, 1) end,
         (select coalesce(sum(sb.qty_base), 0)::numeric(20,6)
            from public.stock_balances sb
            join public.objects o on o.company_id = sb.company_id and o.id = sb.object_id and o.deleted_at is null
           where sb.company_id = f.company_id
             and sb.material_id = f.material_id
             and sb.object_id <> p_object_id
             and sb.qty_base > 0),
         (select nu.remaining_qty_base
            from public.norm_usage nu
           where nu.company_id = f.company_id
             and nu.object_id = p_object_id
             and nu.material_id = f.material_id)
    from f
    join public.materials mt on mt.company_id = f.company_id and mt.id = f.material_id
   order by 6 nulls last, 2, 1
$$;

-- Kunlik hisobot uchun (security definer, RLS'siz): faol obyektlarda days_left <=
-- forecast_days_warn bo'lgan (obyekt, material) soni — stock_forecast formulasi.
create function private.low_stock_count(p_company_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from (
      select x.stock,
             round(x.out14 / 14, 6) as avg_daily
        from (
          select m.object_id, m.material_id,
                 sum(case m.type
                       when 'kirim'            then m.qty_base
                       when 'transfer_in'      then m.qty_base
                       when 'chiqim'           then -m.qty_base
                       when 'transfer_out'     then -m.qty_base
                       when 'inventory_adjust' then m.qty_base
                     end)::numeric(20,6) as stock,
                 coalesce(sum(m.qty_base) filter (
                   where m.type = 'chiqim'
               and (m.occurred_at at time zone 'Asia/Tashkent')::date
                   between (now() at time zone 'Asia/Tashkent')::date - 13
                       and (now() at time zone 'Asia/Tashkent')::date), 0)::numeric(20,6) as out14
            from public.movements m
            join public.objects o
              on o.company_id = m.company_id and o.id = m.object_id
             and o.deleted_at is null and o.status = 'faol'
           where m.company_id = p_company_id
             and m.deleted_at is null
           group by m.object_id, m.material_id
        ) x
       where x.stock <> 0 or x.out14 > 0
    ) y
   where (case when y.avg_daily <= 0 then null
               when y.stock <= 0 then 0::numeric
               else round(y.stock / y.avg_daily, 1) end)
         <= (select c.forecast_days_warn from public.companies c where c.id = p_company_id)
$$;

-- ============================================================================
-- 11. Kunlik hisobot (Batch 10 versiyasi) + low_stock_count, geo_denied_count,
--     geo_unavailable_count.
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
  v_geo_mv   integer;
  v_geo_p    integer;
  v_geo_mv_u integer;
  v_geo_p_u  integer;
begin
  select c.name into v_name from public.companies c where c.id = p_company_id;

  select count(*) filter (where m.type = 'kirim'),
         count(*) filter (where m.type = 'chiqim'),
         count(*) filter (where m.type = 'chiqim' and not exists (
           select 1 from public.estimates e
            where e.company_id = m.company_id and e.object_id = m.object_id
              and e.is_current and e.deleted_at is null)),
         count(*) filter (where m.geo_status = 'denied'),
         count(*) filter (where m.geo_status = 'unavailable')
    into v_kirim, v_chiqim, v_no_est, v_geo_mv, v_geo_mv_u
    from public.movements m
   where m.company_id = p_company_id
     and m.deleted_at is null
     and m.occurred_at >= v_from and m.occurred_at < v_to;

  select count(*), coalesce(sum(p.total_amount), 0),
         count(*) filter (where p.geo_status = 'denied'),
         count(*) filter (where p.geo_status = 'unavailable')
    into v_p_count, v_p_sum, v_geo_p, v_geo_p_u
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
    'chiqim_without_estimate_count', v_no_est,
    'low_stock_count',     private.low_stock_count(p_company_id),
    'geo_denied_count',    v_geo_mv + v_geo_p,
    'geo_unavailable_count', v_geo_mv_u + v_geo_p_u
  );
end;
$$;

-- ============================================================================
-- 12. Cron funksiyalari (postgres nomidan; hech kimga execute yo'q)
-- ============================================================================

-- J. Ochiq (yangi) alert eslatmasi — bir marta. Qaytaradi: qo'shilgan qatorlar.
create function private.enqueue_alert_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v_n        integer := 0;
  v_object   text;
  v_material text;
  v_unit     text;
  v_details  jsonb;
begin
  for r in
    select a.*
      from public.alerts a
      join public.companies c on c.id = a.company_id
     where c.is_active
       and c.deleted_at is null
       and a.status = 'yangi'
       and a.deleted_at is null
       and a.severity <> 'belgi'
       and a.type::text <> 'ozi_qabul_qilgan'
       and a.created_at <= p_now - make_interval(hours => c.alert_remind_hours)
       and not exists (
         select 1 from public.notification_outbox o
          where o.alert_id = a.id and o.kind = 'alert_reminder')
     order by a.created_at, a.id
  loop
    v_object := null; v_material := null; v_unit := null;
    if r.object_id is not null then
      select o.name into v_object from public.objects o where o.company_id = r.company_id and o.id = r.object_id;
    end if;
    if r.material_id is not null then
      select m.name, m.base_unit into v_material, v_unit
        from public.materials m where m.company_id = r.company_id and m.id = r.material_id;
    end if;

    update public.alerts
       set details = details || jsonb_build_object('reminded_at', p_now)
     where id = r.id
     returning details into v_details;

    insert into public.notification_outbox (company_id, kind, alert_id, payload)
    values (r.company_id, 'alert_reminder', r.id,
            jsonb_build_object(
              'alert_id',      r.id,
              'type',          r.type,
              'severity',      r.severity,
              'status',        r.status,
              'object_name',   v_object,
              'material_name', v_material,
              'base_unit',     v_unit,
              'details',       v_details,
              'created_at',    r.created_at,
              'reminded_at',   p_now,
              'hours_open',    floor(extract(epoch from (p_now - r.created_at)) / 3600)::integer))
    on conflict (alert_id) where kind = 'alert_reminder' do nothing;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;

  if v_n > 0 then
    perform private.wake_dispatch();
  end if;
  return v_n;
end;
$$;

-- H. Muddati o'tgan tasdiqlangan so'rovlar — firma bo'yicha kunlik bitta xabar.
create function private.enqueue_request_overdue(
  p_date date default (now() at time zone 'Asia/Tashkent')::date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.notification_outbox (company_id, kind, report_date, payload)
  select c.id, 'request_overdue', p_date,
         jsonb_build_object(
           'date',         to_char(p_date, 'YYYY-MM-DD'),
           'company_name', c.name,
           'count',        x.cnt,
           'requests',     x.items)
    from public.companies c
    join lateral (
      select count(*)::integer as cnt,
             coalesce((jsonb_agg(jsonb_build_object(
               'request_id',      q.id,
               'object_id',       q.object_id,
               'object_name',     q.object_name,
               'material_name',   q.material_name,
               'qty_input',       q.qty_input,
               'unit_input',      q.unit_input,
               'qty_base',        q.qty_base,
               'base_unit',       q.base_unit,
               'needed_by',       to_char(q.needed_by, 'YYYY-MM-DD'),
               'days_overdue',    p_date - q.needed_by,
               'created_by_name', q.created_by_name) order by q.needed_by, q.created_at, q.id)
               filter (where q.rn <= 20)), '[]'::jsonb) as items
        from (
          select r.id, r.object_id, r.qty_input, r.unit_input, r.qty_base, r.needed_by, r.created_at,
                 o.name as object_name, m.name as material_name, m.base_unit,
                 pr.full_name as created_by_name,
                 row_number() over (order by r.needed_by, r.created_at, r.id) as rn
            from public.material_requests r
            join public.objects o on o.company_id = r.company_id and o.id = r.object_id
            join public.materials m on m.company_id = r.company_id and m.id = r.material_id
            left join public.profiles pr on pr.company_id = r.company_id and pr.id = r.created_by
           where r.company_id = c.id
             and r.status = 'tasdiqlandi'
             and r.deleted_at is null
             and r.needed_by < p_date
        ) q
    ) x on x.cnt > 0
   where c.is_active
     and c.deleted_at is null
   order by c.id
  on conflict (company_id, report_date) where kind = 'request_overdue' do nothing;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    perform private.wake_dispatch();
  end if;
  return v_n;
end;
$$;

-- I. Podotchet muddati (ogohlantirish) va manfiy balans (belgi) — odam bo'yicha
--    bitta ochiq. Qaytaradi: yaratilgan alertlar soni.
create function private.evaluate_cash_advances(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        record;
  v_pos    record;
  v_alert  public.alerts%rowtype;
  v_det    jsonb;
  v_days   integer;
  v_n      integer := 0;
begin
  for r in
    select distinct x.company_id, x.profile_id, c.cash_max_days, pr.full_name
      from (
        select ca.company_id, ca.recipient_id as profile_id from public.cash_advances ca where ca.deleted_at is null
        union
        select p.company_id, p.buyer_id from public.purchases p where p.deleted_at is null
        union
        select a.company_id, (a.details ->> 'profile_id')::uuid
          from public.alerts a
         where a.details ? 'profile_id'
           and a.type::text in ('podotchet_muddati', 'podotchet_manfiy')
           and a.status in ('yangi', 'korildi')
           and a.deleted_at is null
      ) x
      join public.companies c on c.id = x.company_id and c.is_active and c.deleted_at is null
      join public.profiles pr on pr.company_id = x.company_id and pr.id = x.profile_id
     order by x.company_id, x.profile_id
  loop
    perform private.alert_lock('podotchet:' || r.profile_id::text);
    select * into v_pos from private.cash_position(r.company_id, r.profile_id);

    -- podotchet_muddati
    select a.* into v_alert
      from public.alerts a
     where a.company_id = r.company_id
       and a.type = 'podotchet_muddati'
       and a.details ? 'profile_id'
       and (a.details ->> 'profile_id') = r.profile_id::text
       and a.status in ('yangi', 'korildi')
       and a.deleted_at is null
     limit 1;
    -- FIFO yoshi — Toshkent sanalari farqi; muddati o'tgan: yosh > cash_max_days (teng — yo'q)
    v_days := (p_now at time zone 'Asia/Tashkent')::date
              - (v_pos.oldest_open_at at time zone 'Asia/Tashkent')::date;
    if v_pos.balance > 0 and v_pos.oldest_open_at is not null and v_days > r.cash_max_days then
      v_det := jsonb_build_object(
        'profile_id',     r.profile_id,
        'profile_name',   r.full_name,
        'balance',        v_pos.balance,
        'oldest_open_at', v_pos.oldest_open_at,
        'days_open',      v_days,
        'max_days',       r.cash_max_days);
      if v_alert.id is null then
        insert into public.alerts (company_id, type, severity, details)
        values (r.company_id, 'podotchet_muddati', 'ogohlantirish', v_det);
        v_n := v_n + 1;
      elsif (v_alert.details ->> 'balance')::numeric is distinct from v_pos.balance
         or (v_alert.details ->> 'oldest_open_at')::timestamptz is distinct from v_pos.oldest_open_at
         or (v_alert.details ->> 'max_days')::integer is distinct from r.cash_max_days then
        update public.alerts set details = details || v_det where id = v_alert.id;
      end if;
    elsif v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id, 'within_threshold',
        jsonb_build_object('balance', v_pos.balance));
    end if;

    -- podotchet_manfiy
    select a.* into v_alert
      from public.alerts a
     where a.company_id = r.company_id
       and a.type = 'podotchet_manfiy'
       and a.details ? 'profile_id'
       and (a.details ->> 'profile_id') = r.profile_id::text
       and a.status in ('yangi', 'korildi')
       and a.deleted_at is null
     limit 1;
    if v_pos.balance < 0 then
      v_det := jsonb_build_object(
        'profile_id',   r.profile_id,
        'profile_name', r.full_name,
        'balance',      v_pos.balance);
      if v_alert.id is null then
        insert into public.alerts (company_id, type, severity, details)
        values (r.company_id, 'podotchet_manfiy', 'belgi', v_det);
        v_n := v_n + 1;
      elsif (v_alert.details ->> 'balance')::numeric is distinct from v_pos.balance then
        update public.alerts set details = details || v_det where id = v_alert.id;
      end if;
    elsif v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id, 'within_threshold',
        jsonb_build_object('balance', v_pos.balance));
    end if;
  end loop;
  return v_n;
end;
$$;

-- I. Haftalik shaxsiy hisob (dushanba). Davr: [p_date − 7 kun, p_date) Toshkent.
create function private.enqueue_cash_statements(
  p_date date default (now() at time zone 'Asia/Tashkent')::date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end   timestamptz := p_date::timestamp at time zone 'Asia/Tashkent';
  v_start timestamptz := (p_date - 7)::timestamp at time zone 'Asia/Tashkent';
  r       record;
  v_pos   record;
  v_iss   numeric(18,2);
  v_ret   numeric(18,2);
  v_sp    numeric(18,2);
  v_n     integer := 0;
begin
  for r in
    select pr.id, pr.company_id, pr.full_name, c.name as company_name
      from public.profiles pr
      join public.companies c on c.id = pr.company_id and c.is_active and c.deleted_at is null
     where pr.is_active
       and pr.deleted_at is null
       and pr.telegram_chat_id is not null
       and (exists (select 1 from public.cash_advances ca
                     where ca.company_id = pr.company_id and ca.recipient_id = pr.id and ca.deleted_at is null)
            or exists (select 1 from public.purchases p
                        where p.company_id = pr.company_id and p.buyer_id = pr.id and p.deleted_at is null))
     order by pr.company_id, pr.id
  loop
    select * into v_pos from private.cash_position(r.company_id, r.id);
    select coalesce(sum(ca.amount) filter (where ca.kind = 'berildi'), 0),
           coalesce(sum(ca.amount) filter (where ca.kind = 'qaytarildi'), 0)
      into v_iss, v_ret
      from public.cash_advances ca
     where ca.company_id = r.company_id and ca.recipient_id = r.id and ca.deleted_at is null
       and ca.issued_at >= v_start and ca.issued_at < v_end;
    select coalesce(sum(p.total_amount), 0) into v_sp
      from public.purchases p
     where p.company_id = r.company_id and p.buyer_id = r.id and p.deleted_at is null
       and p.purchased_at >= v_start and p.purchased_at < v_end;

    continue when v_pos.balance = 0 and v_iss = 0 and v_ret = 0 and v_sp = 0;

    insert into public.notification_outbox (company_id, kind, report_date, profile_id, payload)
    values (r.company_id, 'cash_statement', p_date, r.id,
            jsonb_build_object(
              'date',             to_char(p_date, 'YYYY-MM-DD'),
              'period_start',     to_char(p_date - 7, 'YYYY-MM-DD'),
              'period_end',       to_char(p_date - 1, 'YYYY-MM-DD'),
              'company_name',     r.company_name,
              'profile_id',       r.id,
              'profile_name',     r.full_name,
              'issued_week',      v_iss::text,
              'spent_week',       v_sp::text,
              'returned_week',    v_ret::text,
              'issued_total',     v_pos.issued_total::numeric(18,2)::text,
              'returned_total',   v_pos.returned_total::numeric(18,2)::text,
              'spent_total',      v_pos.spent_total::numeric(18,2)::text,
              'balance',          v_pos.balance::numeric(18,2)::text,
              'oldest_open_date', to_char(v_pos.oldest_open_at at time zone 'Asia/Tashkent', 'YYYY-MM-DD'),
              'days_open',        case when v_pos.oldest_open_at is not null then
                                    (p_date - (v_pos.oldest_open_at at time zone 'Asia/Tashkent')::date) end))
    on conflict (profile_id, report_date) where kind = 'cash_statement' do nothing;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;

  if v_n > 0 then
    perform private.wake_dispatch();
  end if;
  return v_n;
end;
$$;

-- ============================================================================
-- 13. Service RPC'lar (faqat service_role)
-- ============================================================================

-- J. Telegram "Ko'rildi" tugmasi.
create function public.svc_mark_alert_seen(p_telegram_user_id bigint, p_alert_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_p public.profiles%rowtype;
  v_a public.alerts%rowtype;
begin
  select p.* into v_p
    from public.profiles p
    join public.companies c on c.id = p.company_id
   where p.telegram_user_id = p_telegram_user_id
     and p.deleted_at is null
     and p.is_active
     and c.deleted_at is null
     and c.is_active
   limit 1;
  if p_telegram_user_id is null or not found or v_p.role not in ('admin', 'super_admin') then
    raise exception 'Faqat administrator belgilay oladi'
      using errcode = '42501', hint = 'alert_action_forbidden';
  end if;

  select a.* into v_a
    from public.alerts a
   where a.id = p_alert_id and a.deleted_at is null
     for update;
  if p_alert_id is null or not found then
    raise exception 'Ogohlantirish topilmadi' using errcode = 'P0002', hint = 'alert_not_found';
  end if;
  if v_p.role <> 'super_admin' and v_a.company_id <> v_p.company_id then
    raise exception 'Faqat administrator belgilay oladi'
      using errcode = '42501', hint = 'alert_action_forbidden';
  end if;

  if v_a.status = 'yangi' then
    update public.alerts
       set status  = 'korildi',
           details = details || jsonb_build_object(
             'seen_by_profile_id', v_p.id,
             'seen_by_name',       v_p.full_name,
             'seen_at',            now(),
             'seen_via',           'telegram')
     where id = v_a.id;
  end if;
  return v_p.full_name;
end;
$$;

-- G. Chek keshi (receipt-lookup Edge Function). p_created_by — shu firma profili
-- bo'lishi shart (aks holda null). Upsert (company_id, fiscal_sign).
create function public.svc_upsert_receipt_lookup(
  p_company_id  uuid,
  p_created_by  uuid,
  p_fiscal_sign text,
  p_terminal_id text,
  p_receipt_no  text,
  p_payload     jsonb,
  p_total       numeric,
  p_seller_tin  text,
  p_seller_name text,
  p_receipt_at  timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sign  text := nullif(btrim(p_fiscal_sign), '');
  v_by    uuid;
  v_id    uuid;
begin
  if p_company_id is null or v_sign is null then
    raise exception 'Chek ma''lumotlari to''liq emas' using errcode = '22023', hint = 'receipt_lookup_invalid';
  end if;
  select pr.id into v_by from public.profiles pr where pr.company_id = p_company_id and pr.id = p_created_by;

  perform pg_advisory_xact_lock(hashtextextended('terron.receipt_lookup:' || p_company_id::text || ':' || v_sign, 0));
  select l.id into v_id
    from public.receipt_lookups l
   where l.company_id = p_company_id and l.fiscal_sign = v_sign and l.deleted_at is null;

  if v_id is null then
    insert into public.receipt_lookups
      (company_id, fiscal_sign, terminal_id, receipt_no, payload, total, seller_tin, seller_name,
       receipt_at, fetched_at, created_by)
    values
      (p_company_id, v_sign, nullif(btrim(p_terminal_id), ''), nullif(btrim(p_receipt_no), ''),
       coalesce(p_payload, '{}'::jsonb), round(p_total, 2), nullif(btrim(p_seller_tin), ''),
       left(nullif(btrim(p_seller_name), ''), 300), p_receipt_at, now(), v_by)
    returning id into v_id;
  else
    update public.receipt_lookups
       set terminal_id = coalesce(nullif(btrim(p_terminal_id), ''), terminal_id),
           receipt_no  = coalesce(nullif(btrim(p_receipt_no), ''), receipt_no),
           payload     = coalesce(p_payload, payload),
           total       = coalesce(round(p_total, 2), total),
           seller_tin  = coalesce(nullif(btrim(p_seller_tin), ''), seller_tin),
           seller_name = coalesce(left(nullif(btrim(p_seller_name), ''), 300), seller_name),
           receipt_at  = coalesce(p_receipt_at, receipt_at),
           fetched_at  = now()
     where id = v_id;
  end if;
  return v_id;
end;
$$;

-- ============================================================================
-- 14. Ruxsatlar
-- ============================================================================
revoke execute on function
  private.alert_lock(text),
  private.object_stock(uuid, uuid, uuid),
  private.geo_distance_m(numeric, numeric, numeric, numeric),
  private.auto_close_alert(uuid, text, jsonb),
  private.cash_position(uuid, uuid),
  private.tg_movements_auto_guard(),
  private.tg_purchases_auto_guard(),
  private.tg_suppliers_tin_guard(),
  private.evaluate_kirim_source(uuid),
  private.mark_kirim_candidate(uuid, uuid),
  private.evaluate_negative_stock(uuid, uuid, uuid, uuid),
  private.evaluate_no_estimate_chiqim(uuid, uuid, uuid),
  private.tg_estimates_no_estimate_close(),
  private.alert_meta_keys(),
  private.alert_meta(jsonb),
  private.evaluate_duplicate(text, uuid),
  private.evaluate_duplicate_photo(text, uuid),
  private.evaluate_geo(uuid),
  private.evaluate_receipt_total(uuid),
  private.evaluate_request_overbuy(uuid),
  private.sync_request_purchase(uuid, uuid),
  private.tg_movements_automation(),
  private.tg_purchases_automation(),
  private.tg_requests_overbuy(),
  private.low_stock_count(uuid),
  private.enqueue_alert_reminders(timestamptz),
  private.enqueue_request_overdue(date),
  private.evaluate_cash_advances(timestamptz),
  private.enqueue_cash_statements(date)
from public, anon, authenticated, service_role;

revoke execute on function public.stock_forecast(uuid) from public, anon;
grant execute on function public.stock_forecast(uuid) to authenticated;

revoke execute on function
  public.svc_outbox_recipients(uuid),
  public.svc_mark_alert_seen(bigint, uuid),
  public.svc_upsert_receipt_lookup(uuid, uuid, text, text, text, jsonb, numeric, text, text, timestamptz)
from public, anon, authenticated;
grant execute on function
  public.svc_outbox_recipients(uuid),
  public.svc_mark_alert_seen(bigint, uuid),
  public.svc_upsert_receipt_lookup(uuid, uuid, text, text, text, jsonb, numeric, text, text, timestamptz)
to service_role;

revoke all on public.cash_balances from public, anon, authenticated, service_role;
grant select on public.cash_balances to authenticated, service_role;

-- ============================================================================
-- 15. pg_cron (postgres nomidan; UTC). Toshkent = UTC+5.
--    terron-alert-reminders — har soat :27;
--    terron-request-overdue — 04:00 UTC = 09:00 Toshkent, har kuni;
--    terron-cash-check      — 04:10 UTC = 09:10 Toshkent, har kuni;
--    terron-cash-statement  — 04:00 UTC dushanba = 09:00 Toshkent.
-- ============================================================================
create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  j record;
begin
  for j in
    select * from (values
      ('terron-alert-reminders', '27 * * * *', 'select private.enqueue_alert_reminders()'),
      ('terron-request-overdue', '0 4 * * *',  'select private.enqueue_request_overdue()'),
      ('terron-cash-check',      '10 4 * * *', 'select private.evaluate_cash_advances()'),
      ('terron-cash-statement',  '0 4 * * 1',  'select private.enqueue_cash_statements()')
    ) v(name, sched, cmd)
  loop
    if exists (select 1 from cron.job where jobname = j.name) then
      perform cron.unschedule(j.name);
    end if;
    perform cron.schedule(j.name, j.sched, j.cmd);
  end loop;
end $$;
