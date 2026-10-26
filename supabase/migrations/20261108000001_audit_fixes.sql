-- ============================================================================
-- Audit tuzatishlari (shartnoma: docs/audit-fixes.md)
--
--   A. Biznes mantiq:
--      A1  Qoida 1 — bog'lanmagan kirim faqat BITTA xaridni qoplaydi (FIFO,
--          purchased_at bo'yicha, qolgan farq kuzatiladi; obyekt+material qulfi).
--      A2  manfiy_qoldiq — qoldiqni kamaytirgan HAR qanday harakat o'zgarishida
--          (kirim o'chirildi / kamaytirildi, transfer_in o'chirildi); 24 soatlik
--          bostirish saqlanadi.
--      A3  Inventarizatsiya: kutilgan qoldiq — qator sanalgan paytdagi
--          (occurred_at <= counted_at) qoldiq; sanash davomidagi harakatlar — details.
--      A4  transfer_* / inventory_adjust harakatlari faqat RPC ichida (hamma uchun);
--          o'tkazma harakatini tiklash — yo'q; movements_insert — faqat kirim/chiqim.
--      A5  receive_transfer: birlik o'chirilgan bo'lsa — asosiy birlikda.
--      A6  cash_advances.issued_at o'zgarmaydi; INSERT oynasi (admin emas);
--          qaytarish va oynadan tashqari sana — belgi (podotchet_belgisi).
--      A7  Qoida 6 smeta o'zgarganda va qo'shni so'rov holati o'zgarganda qayta baholanadi.
--      A8  Qoida 3, 4, 6 — meta kalitlar (seen_*, reminded_at) saqlanadi.
--      A9  Kunlik hisobot: backdated_count.
--      A10 Pul: musbat va manfiy balanslar alohida (cash_outstanding_sum, cash_owed_to_staff_sum).
--      A11 "Yangi ogohlantirishlar" — bitta yordamchi (private.alerts_new_count).
--      A13 Miqdor/narx chegaralari — barqaror hint'lar (qty_too_small, qty_too_large, price_too_large).
--      A14 terron.stock: qulfi chiqim/transfer_out yo'llarida; set_current_estimate — qayta for update.
--   B. Xavfsizlik:
--      B1  Joylashtirilgan yozuv o'zgartirilsa — yozuv_ozgartirildi (muallif tuzatishi — yozuv_tuzatildi).
--      B2  Sozlama o'zgarishi — sozlama_ozgardi; chegaralar; yopishda izoh majburiy;
--          admin/direktor profilini faqat super_admin o'zgartiradi (profile_protected).
--      B3  svc_alert_login_set — login_ozgardi + egasiga xabar (login_changed).
--      B5  Rasm xeshi faqat svc_set_photo_hash orqali (klient qiymati e'tiborsiz).
--      B6  receipt_verified — summa/qator va sana sharti; sotuvchi STIR farqi (belgi);
--          ko'p qatorli chek rasm talabini bekor qilmaydi.
--      B11 private.estimate_alert — firma tekshiruvi.
--      B13 transfers / material_requests / estimates — tekshiruvchiga yopiq.
--      B14 receive_transfer — yuborilgandan ko'p qabul faqat admin, izoh bilan.
--      Profillar: admin bo'lmaganlar boshqalarning faqat id/ism/rol/faolligini ko'radi
--      (public.profile_directory).
--   C. Ekspluatatsiya: tinch soatlar, bloklangan chatlar, eskirgan qatorlar,
--      cron.job_run_details tozalash, pg_net timeout 60 s, notification_health(), indekslar.
--   D. Funksional: correct_entry, ish oqimi bildirishnomalari, obyekt alertlari
--      prorab/omborchiga, merge_suppliers.
--
-- Oldingi migratsiyalar o'zgartirilmaydi. Xato shakli: errcode + barqaror `hint` +
-- o'zbekcha `message` (docs/db-design.md → "Xato kalitlari").
-- Yangi enum qiymatlari shu tranzaksiyada SQL'da ishlatilmaydi — faqat plpgsql ichida
-- (runtime) yoki `type::text` orqali.
-- ============================================================================

-- ============================================================================
-- 0. Yangi alert turlari
-- ============================================================================
alter type public.alert_type add value if not exists 'yozuv_ozgartirildi';
alter type public.alert_type add value if not exists 'yozuv_tuzatildi';
alter type public.alert_type add value if not exists 'sozlama_ozgardi';
alter type public.alert_type add value if not exists 'login_ozgardi';
alter type public.alert_type add value if not exists 'podotchet_belgisi';
alter type public.alert_type add value if not exists 'sotuvchi_stir_farqi';

-- ============================================================================
-- 1. Ustunlar, chegaralar, indekslar
-- ============================================================================

-- C. Tinch soatlar (Asia/Tashkent). Ikkalasidan biri null — o'chiq.
alter table public.companies
  add column quiet_hours_start time default '22:00',
  add column quiet_hours_end   time default '07:00',
  add constraint companies_quiet_hours_check
    check (quiet_hours_start is null or quiet_hours_end is null or quiet_hours_start <> quiet_hours_end);

-- B2. Sozlama chegaralari. Mavjud qiymatlar avval chegaraga keltiriladi
-- (duplicate_window_minutes = 0 "o'chiq" edi — endi ruxsat yo'q, standart 10 qo'yiladi).
do $$
declare
  v integer;
begin
  update public.companies
     set price_deviation_pct      = least(price_deviation_pct, 50),
         receipt_mismatch_pct     = least(receipt_mismatch_pct, 50),
         request_overbuy_pct      = least(request_overbuy_pct, 200),
         duplicate_window_minutes = case when duplicate_window_minutes < 1 then 10 else duplicate_window_minutes end,
         alert_remind_hours       = least(alert_remind_hours, 168)
   where price_deviation_pct > 50
      or receipt_mismatch_pct > 50
      or request_overbuy_pct > 200
      or duplicate_window_minutes < 1
      or alert_remind_hours > 168;
  get diagnostics v = row_count;
  if v > 0 then
    raise notice 'audit_fixes: % ta firma sozlamasi yangi chegaralarga keltirildi', v;
  end if;
end $$;

alter table public.companies
  add constraint companies_price_deviation_pct_max_check check (price_deviation_pct <= 50),
  add constraint companies_receipt_mismatch_pct_max_check check (receipt_mismatch_pct <= 50);
alter table public.companies drop constraint companies_request_overbuy_pct_check;
alter table public.companies
  add constraint companies_request_overbuy_pct_check check (request_overbuy_pct between 0 and 200);
alter table public.companies drop constraint companies_duplicate_window_minutes_check;
alter table public.companies
  add constraint companies_duplicate_window_minutes_check check (duplicate_window_minutes between 1 and 1440);
alter table public.companies drop constraint companies_alert_remind_hours_check;
alter table public.companies
  add constraint companies_alert_remind_hours_check check (alert_remind_hours between 1 and 168);

-- C. Bloklangan chat; D2. Ish oqimi xabarlarini o'chirish (profil o'zi).
alter table public.profiles
  add column telegram_blocked_at timestamptz,
  add column notify_workflow boolean not null default true;

-- A3. Qator sanalgan vaqt (mavjud qatorlar — migratsiya vaqti).
alter table public.inventory_count_items
  add column counted_at timestamptz not null default now();
grant select (counted_at) on public.inventory_count_items to authenticated;

-- D2 / B3. Ish oqimi xabarlari: manba yozuv id (so'rov, o'tkazma, xarid, alert).
alter table public.notification_outbox add column ref_id uuid;

-- C. Indekslar (ro'yxat sahifalari)
create index material_requests_company_created_idx on public.material_requests (company_id, created_at desc);
create index transfers_company_created_idx on public.transfers (company_id, created_at desc);
create index inventory_counts_company_created_idx on public.inventory_counts (company_id, created_at desc);
create index notification_outbox_ref_idx on public.notification_outbox (company_id, ref_id) where ref_id is not null;
create index profiles_telegram_chat_idx on public.profiles (telegram_chat_id) where telegram_chat_id is not null;

-- ============================================================================
-- 2. Yordamchilar
-- ============================================================================

-- A11. "Yangi ogohlantirish" ta'rifi — dashboard va kunlik hisobot uchun bitta:
-- belgi emas va audit turidagi (alohida sanaladigan) alert emas.
create function private.alert_counts_as_new(p_type text, p_severity text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_severity, '') <> 'belgi'
     and coalesce(p_type, '') not in ('ozi_qabul_qilgan', 'yozuv_ochirildi', 'yozuv_tiklandi')
$$;

-- security invoker: dashboard'da RLS amal qiladi (alerts — admin/direktor/buxgalter,
-- prorab/omborchi — o'z obyektlarining ruxsat etilgan turlari); kunlik hisobotda
-- (definer, postgres) — butun firma.
create function private.alerts_new_count(
  p_company_id uuid,
  p_from       timestamptz,
  p_to         timestamptz,
  p_object_id  uuid default null
)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
    from public.alerts a
   where a.company_id = p_company_id
     and a.deleted_at is null
     and a.created_at >= p_from and a.created_at < p_to
     and private.alert_counts_as_new(a.type::text, a.severity::text)
     and (p_object_id is null or a.object_id = p_object_id)
$$;

-- C. Tinch soat tugaydigan vaqt (Asia/Tashkent): p_now oynada bo'lsa — oyna oxiri,
-- aks holda (yoki sozlama yo'q) — null. Oyna yarim tundan o'tishi mumkin (22:00–07:00).
create function private.quiet_until(p_start time, p_end time, p_now timestamptz)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Tashkent';
  v_t     time := v_local::time;
  v_in    boolean;
  v_end   timestamp;
begin
  if p_start is null or p_end is null or p_start = p_end or p_now is null then
    return null;
  end if;
  if p_start < p_end then
    v_in := v_t >= p_start and v_t < p_end;
  else
    v_in := v_t >= p_start or v_t < p_end;
  end if;
  if not v_in then
    return null;
  end if;
  v_end := v_local::date + p_end;
  if v_end <= v_local then
    v_end := v_end + interval '1 day';
  end if;
  return v_end at time zone 'Asia/Tashkent';
end;
$$;

-- A3. Qoldiq berilgan vaqtgacha (occurred_at <= p_at), stock_balances formulasi.
create function private.stock_at(p_company_id uuid, p_object_id uuid, p_material_id uuid, p_at timestamptz)
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
     and m.occurred_at <= p_at
$$;

-- A14. Obyekt + material qoldig'i qulfi (create_transfer bilan bir xil kalit).
create function private.lock_stock(p_object_id uuid, p_material_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended(
    'terron.stock:' || p_object_id::text || ':' || p_material_id::text, 0))
$$;

-- D2 / B3. Ish oqimi xabari (outbox) — takrorlanmaydigan turlarda unique indeks
-- (on conflict do nothing). Qo'shilsa — tg-dispatch uyg'otiladi.
create function private.enqueue_workflow(
  p_company_id uuid,
  p_kind       text,
  p_ref_id     uuid,
  p_profile_id uuid,
  p_payload    jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_outbox (company_id, kind, ref_id, profile_id, payload)
  values (p_company_id, p_kind, p_ref_id, p_profile_id, coalesce(p_payload, '{}'::jsonb))
  on conflict do nothing;
  if found then
    perform private.wake_dispatch();
  end if;
end;
$$;

-- ============================================================================
-- 3. BEFORE guardlar
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A4 + A14. movements: o'tkazma va inventarizatsiya harakatlari faqat RPC ichida.
--   Foydalanuvchi sessiyasida (admin ham): transfer_out / transfer_in — faqat
--   transfer_rpc_active(); inventory_adjust — faqat inventory_rpc_active().
--   UPDATE'da (eski yoki yangi tur shunday bo'lsa) faqat `note` o'zgarishi ruxsat.
--   O'tkazma harakatini tiklash (deleted_at → null) — hamma uchun (tizim ham) rad.
--   Tizim (auth.uid() yo'q: seed, migratsiya, cron) — boshqa cheklovsiz.
--   A14: chiqim / transfer_out yozilganda va qoldiqqa ta'sir qiluvchi UPDATE'da
--   terron.stock:<obyekt>:<material> qulfi (kalitlar tartibida).
--   Nom a_rpc_guard — a_before_* dan keyin, b_* dan oldin.
-- ----------------------------------------------------------------------------
create function private.tg_movements_rpc_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free  constant text[] := array['note', 'updated_at'];
  v_new_t text := new.type::text;
  v_old_t text;
  v_tr    boolean;
  v_inv   boolean;
  v_edit  boolean;
  v_key   text;
begin
  if tg_op = 'UPDATE' then
    v_old_t := old.type::text;
  end if;
  v_tr  := v_new_t in ('transfer_out', 'transfer_in') or coalesce(v_old_t in ('transfer_out', 'transfer_in'), false);
  v_inv := v_new_t = 'inventory_adjust' or coalesce(v_old_t = 'inventory_adjust', false);

  if tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is null
     and (old.transfer_id is not null or v_tr) and not private.transfer_rpc_active() then
    raise exception 'O''tkazma harakatini tiklab bo''lmaydi — kerak bo''lsa yangi o''tkazma yarating'
      using errcode = '55000', hint = 'restore_transfer_movement';
  end if;

  if auth.uid() is not null and (v_tr or v_inv) then
    v_edit := tg_op = 'INSERT' or (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free);
    if v_edit and v_tr and not private.transfer_rpc_active() then
      raise exception 'O''tkazma harakati faqat "O''tkazma" orqali yaratiladi va o''zgaradi'
        using errcode = '42501', hint = 'movement_rpc_only';
    end if;
    if v_edit and v_inv and not private.inventory_rpc_active() then
      raise exception 'Inventarizatsiya tuzatishi faqat "Qoldiqni tuzatish" orqali yaratiladi'
        using errcode = '42501', hint = 'movement_rpc_only';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if v_new_t in ('chiqim', 'transfer_out') then
      perform private.lock_stock(new.object_id, new.material_id);
    end if;
  elsif new.qty_input   is distinct from old.qty_input
     or new.unit_id     is distinct from old.unit_id
     or new.deleted_at  is distinct from old.deleted_at
     or new.type        is distinct from old.type
     or new.object_id   is distinct from old.object_id
     or new.material_id is distinct from old.material_id then
    for v_key in
      select distinct k
        from unnest(array[old.object_id::text || ':' || old.material_id::text,
                          new.object_id::text || ':' || new.material_id::text]) k
       order by k
    loop
      perform pg_advisory_xact_lock(hashtextextended('terron.stock:' || v_key, 0));
    end loop;
  end if;
  return new;
end;
$$;

create trigger a_rpc_guard before insert or update on public.movements
  for each row execute function private.tg_movements_rpc_guard();

-- ----------------------------------------------------------------------------
-- A13. Miqdor va narx chegaralari — b_compute_qty dan OLDIN (aks holda numeric
--   to'lib ketishi hint'siz 22003 beradi). Birlik topilmasa — tekshirmaydi
--   (b_compute_qty o'z xatosini beradi).
--   qty_base = round(qty_input * factor, 6) = 0       → 23514 qty_too_small
--   |qty_base| ≥ 1e14 (numeric(20,6))                  → 22003 qty_too_large
--   purchases: total / qty_input ≥ 1e16 (unit_price numeric(18,2)) yoki
--              total / qty_base ≥ 1e14 (price_per_base numeric(18,4)) → 22003 price_too_large
--   Nom b_check_qty — b_check_material dan keyin, b_compute_qty dan oldin.
-- ----------------------------------------------------------------------------
create function private.tg_check_qty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit   uuid := new.unit_id;
  v_factor numeric;
  v_q      numeric;
  v_total  numeric;
begin
  if new.qty_input is null then
    return new;
  end if;
  if v_unit is null then
    select mu.id into v_unit
      from public.material_units mu
     where mu.company_id = new.company_id
       and mu.material_id = new.material_id
       and private.norm_name(mu.unit) = private.norm_name(new.unit_input)
       and mu.variant is null
       and mu.deleted_at is null
     limit 1;
  end if;
  select mu.factor into v_factor
    from public.material_units mu
   where mu.company_id = new.company_id and mu.id = v_unit;
  if v_factor is null then
    return new;
  end if;

  v_q := round(new.qty_input * v_factor, 6);
  if v_q = 0 then
    raise exception 'Miqdor juda kichik — asosiy birlikda 0 ga teng bo''lib qoladi'
      using errcode = '23514', hint = 'qty_too_small';
  end if;
  if abs(v_q) >= 1e14 then
    raise exception 'Miqdor juda katta'
      using errcode = '22003', hint = 'qty_too_large';
  end if;

  if tg_table_name = 'purchases' then
    v_total := (to_jsonb(new) ->> 'total_amount')::numeric;
    if v_total is not null
       and (abs(v_total / new.qty_input) >= 1e16 or abs(v_total / v_q) >= 1e14) then
      raise exception 'Narx juda katta — summa yoki miqdorni tekshiring'
        using errcode = '22003', hint = 'price_too_large';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['purchases', 'movements', 'transfers', 'material_requests'] loop
    execute format('create trigger b_check_qty before insert or update on public.%I
                      for each row execute function private.tg_check_qty()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- B5. Rasm xeshi — klientdan qabul qilinmaydi. Foydalanuvchi sessiyasida INSERT —
--   null; UPDATE — eski qiymat (rasm yo'li o'zgarsa — null). Xeshni faqat
--   public.svc_set_photo_hash (service_role, Edge Function yuklashdan keyin) yozadi.
--   tg_argv[0] — xesh ustuni, tg_argv[1] — rasm yo'li ustuni. Nom b_photo_hash_client —
--   c_*_auto (format tekshiruvi) dan oldin.
-- ----------------------------------------------------------------------------
create function private.tg_photo_hash_client()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_col  constant text := tg_argv[0];
  v_path constant text := tg_argv[1];
  v_keep jsonb;
begin
  -- faqat foydalanuvchi so'rovi (PostgREST: authenticated); svc_set_photo_hash (definer) — o'tadi
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT'
     or (to_jsonb(new) ->> v_path) is distinct from (to_jsonb(old) ->> v_path) then
    v_keep := 'null'::jsonb;
  else
    v_keep := to_jsonb(old) -> v_col;
  end if;
  new := jsonb_populate_record(new, jsonb_build_object(v_col, v_keep));
  return new;
end;
$$;

create trigger b_photo_hash_client before insert or update on public.movements
  for each row execute function private.tg_photo_hash_client('photo_sha256', 'photo_path');
create trigger b_photo_hash_client before insert or update on public.purchases
  for each row execute function private.tg_photo_hash_client('receipt_photo_sha256', 'receipt_photo_path');

-- ----------------------------------------------------------------------------
-- A6. cash_advances (Batch 12 versiyasi): foydalanuvchi sessiyasida issued_at ham
--   o'zgarmaydi (cash_amount_locked; null → eski qiymat, b_issued_at). Izoh (note)
--   o'zgarishi va soft delete — ruxsat. Tizim (auth.uid() yo'q) sanani o'zgartira oladi.
--   INSERT oynasi — b_op_date (pastda, Batch 4 qoidasi).
-- ----------------------------------------------------------------------------
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
       or new.kind is distinct from old.kind
       or (auth.uid() is not null and coalesce(new.issued_at, old.issued_at) is distinct from old.issued_at) then
      raise exception 'Berilgan pul summasi, turi, sanasi va oluvchisini o''zgartirib bo''lmaydi — yozuvni o''chirib, yangisini kiriting'
        using errcode = 'P0001', hint = 'cash_amount_locked';
    end if;
    if not (old.deleted_at is not null and new.deleted_at is null) then
      return new;
    end if;
  end if;

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

-- INSERT: admin/super_admin bo'lmagan foydalanuvchi uchun issued_at ∈ [now − 3 kun,
-- now + 5 daqiqa] (ops_occurred_at_range). b_issued_at (null → now()) dan keyin.
create trigger b_op_date before insert on public.cash_advances
  for each row execute function private.tg_ops_op_date('issued_at');

-- ----------------------------------------------------------------------------
-- B2 + D2. profiles:
--   * telegram_chat_id o'zgarsa — telegram_blocked_at := null (yangi chat);
--   * admin bo'lmagan foydalanuvchi faqat O'Z profilining notify_workflow ini
--     o'zgartiradi (profiles_update_self siyosati) — boshqa ustun o'zgarsa yoki
--     notify_workflow o'zgarmasa, qator jimgina o'tkazib yuboriladi (0 qator);
--   * admin (super_admin emas) admin / direktor profilining role, phone,
--     is_active, deleted_at ini o'zgartira olmaydi → profile_protected.
--   Tizim (current_user ≠ authenticated: service_role, cron, definer RPC) va super_admin — cheklovsiz.
-- ----------------------------------------------------------------------------
create function private.tg_profiles_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.telegram_chat_id is distinct from old.telegram_chat_id then
    new.telegram_blocked_at := null;
  end if;
  -- Faqat foydalanuvchi so'rovi (PostgREST: current_user = authenticated). Tizim, service_role va
  -- security definer RPC'lar ichidagi o'zgarishlar — cheklovsiz.
  if current_user <> 'authenticated' or auth.uid() is null or private.is_super_admin() then
    return new;
  end if;

  if not private.has_role('admin') then
    -- boshqa ustun o'zgarsa yoki notify_workflow o'zgarmasa — qator jimgina o'tkazib
    -- yuboriladi (0 qator, avvalgi RLS xatti-harakati bilan bir xil)
    if (to_jsonb(new) - 'notify_workflow' - 'updated_at') is distinct from (to_jsonb(old) - 'notify_workflow' - 'updated_at')
       or new.notify_workflow is not distinct from old.notify_workflow then
      return null;
    end if;
    return new;
  end if;

  if old.role in ('admin', 'direktor')
     and (new.role is distinct from old.role
          or new.phone is distinct from old.phone
          or new.is_active is distinct from old.is_active
          or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'Administrator va direktor profilining roli, telefoni va holatini faqat tizim egasi o''zgartiradi'
      using errcode = '42501', hint = 'profile_protected';
  end if;
  return new;
end;
$$;

create trigger b_profiles_protect before update on public.profiles
  for each row execute function private.tg_profiles_protect();

-- ----------------------------------------------------------------------------
-- B2. alerts: foydalanuvchi alertni yopsa — close_note majburiy
--   (alert_close_note_required); details ga manual_closed_at / manual_closed_by
--   (kunlik hisobot: manual_closed_count). Tizim (security definer qoidalar,
--   service_role, cron) — tekshirilmaydi.
-- ----------------------------------------------------------------------------
create function private.tg_alerts_close_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and new.status = 'yopildi' and old.status is distinct from 'yopildi' then
    if nullif(btrim(coalesce(new.close_note, '')), '') is null then
      raise exception 'Ogohlantirishni yopishda sababini yozing'
        using errcode = '23514', hint = 'alert_close_note_required';
    end if;
    new.close_note := btrim(new.close_note);
    new.details := new.details || jsonb_build_object(
      'manual_closed_at', now(), 'manual_closed_by', private.my_profile_id());
  end if;
  return new;
end;
$$;

create trigger b_alerts_close_note before update on public.alerts
  for each row execute function private.tg_alerts_close_note();

-- ----------------------------------------------------------------------------
-- A3. inventory_count_items.counted_at — qator sanalgan vaqt (server):
--   INSERT — now() (tizim o'z qiymatini bera oladi); sanalgan miqdor / material
--   o'zgarsa yoki tiklansa — now(); aks holda o'zgarmaydi (foydalanuvchi uchun).
--   Nom b_counted_at — b_compute_counted (qty_counted hisoblangan) dan keyin.
-- ----------------------------------------------------------------------------
create function private.tg_inventory_items_counted_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null or new.counted_at is null then
      new.counted_at := now();
    end if;
  elsif new.qty_counted is distinct from old.qty_counted
     or new.material_id is distinct from old.material_id
     or (old.deleted_at is not null and new.deleted_at is null) then
    new.counted_at := now();
  elsif auth.uid() is not null or new.counted_at is null then
    new.counted_at := old.counted_at;
  end if;
  return new;
end;
$$;

create trigger b_counted_at before insert or update on public.inventory_count_items
  for each row execute function private.tg_inventory_items_counted_at();

-- ============================================================================
-- 4. Qoidalar
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A1. Bog'lanmagan kirimlarni xaridlarga taqsimlash (FIFO).
--   Shu obyekt+materialdagi tirik xaridlar (purchased_at, created_at, id) tartibida,
--   maqsad xariddan 14 kun oldingilardan boshlab maqsad xaridgacha (kiradi). Har xarid
--   uchun qolgan farq = qty_base − bog'langan kirimlar; farq > 0 bo'lsa, oynadagi
--   (occurred_at ∈ [purchased_at, purchased_at + 72 soat]) hali taqsimlanmagan
--   bog'lanmagan kirimlar occurred_at, id tartibida butunicha beriladi, farq ≤ 0
--   bo'lguncha. Har kirim — ko'pi bilan bitta xaridga. Qaytaradi: maqsad xaridga
--   tushgan kirimlar (taqsimlash tartibida).
-- ----------------------------------------------------------------------------
create function private.receipt_candidates(p_purchase_id uuid)
returns table (movement_id uuid, qty_base numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_t    public.purchases%rowtype;
  r      record;
  k      record;
  v_used uuid[] := '{}';
  v_gap  numeric;
begin
  select p.* into v_t from public.purchases p where p.id = p_purchase_id;
  if not found or v_t.deleted_at is not null then
    return;
  end if;

  for r in
    select p.id, p.qty_base as q, p.purchased_at as at,
           (select coalesce(sum(m.qty_base), 0)
              from public.movements m
             where m.company_id = p.company_id
               and m.purchase_id = p.id
               and m.type = 'kirim'
               and m.deleted_at is null) as recv
      from public.purchases p
     where p.company_id = v_t.company_id
       and p.object_id = v_t.object_id
       and p.material_id = v_t.material_id
       and p.deleted_at is null
       and p.purchased_at >= v_t.purchased_at - interval '14 days'
       and (p.purchased_at, p.created_at, p.id) <= (v_t.purchased_at, v_t.created_at, v_t.id)
     order by p.purchased_at, p.created_at, p.id
  loop
    v_gap := r.q - r.recv;
    if v_gap > 0 then
      for k in
        select m.id as mid, m.qty_base as mq
          from public.movements m
         where m.company_id = v_t.company_id
           and m.object_id = v_t.object_id
           and m.material_id = v_t.material_id
           and m.type = 'kirim'
           and m.purchase_id is null
           and m.transfer_id is null
           and m.deleted_at is null
           and m.occurred_at >= r.at
           and m.occurred_at <= r.at + interval '72 hours'
           and not (m.id = any (v_used))
         order by m.occurred_at, m.id
      loop
        v_used := v_used || k.mid;
        v_gap := v_gap - k.mq;
        if r.id = v_t.id then
          movement_id := k.mid;
          qty_base := k.mq;
          return next;
        end if;
        exit when v_gap <= 0;
      end loop;
    end if;
    exit when r.id = v_t.id;
  end loop;
end;
$$;

-- Qoida 1 (Batch 12 versiyasi): nomzodlar — private.receipt_candidates (FIFO);
-- obyekt+material bo'yicha terron.receipt_alloc qulfi. Qolgani o'zgarmagan.
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

  perform pg_advisory_xact_lock(hashtextextended(
    'terron.receipt_alloc:' || v_p.object_id::text || ':' || v_p.material_id::text, 0));

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

  select coalesce(sum(c.qty_base), 0)::numeric(20,6),
         coalesce(jsonb_agg(jsonb_build_object('movement_id', c.movement_id, 'qty_base', c.qty_base)), '[]'::jsonb)
    into v_cand_qty, v_cand
    from private.receipt_candidates(v_p.id) c;

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
-- A2. manfiy_qoldiq — sabab: qoldiqni KAMAYTIRGAN har qanday harakat o'zgarishi
--   (p_decreased: chiqim / transfer_out qo'shildi, kirim / transfer_in o'chirildi
--   yoki kamaytirildi, boshqa obyektga ko'chirildi ...). Ochiq alert bo'lsa — details
--   yangilanadi; stock_restored bilan yopilganidan 24 soat ichida — yangi alert yo'q
--   (yopilganining details'i yangilanadi). Qoldiq ≥ 0 → ochig'i yopiladi.
--   details: stock_after, qty_base, unit, movement_type (istalgan tur), movement_deleted.
-- ----------------------------------------------------------------------------
create function private.evaluate_negative_stock(
  p_company_id  uuid,
  p_object_id   uuid,
  p_material_id uuid,
  p_movement_id uuid,
  p_decreased   boolean
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
  v_cause   boolean := false;
  v_unit    text;
  v_details jsonb;
begin
  select m.* into v_mv from public.movements m where m.id = p_movement_id;
  v_cause := found and coalesce(p_decreased, false)
             and v_mv.object_id = p_object_id and v_mv.material_id = p_material_id;

  if not v_cause and not exists (
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
    if v_cause then
      v_details := v_details || jsonb_build_object(
        'qty_base', v_mv.qty_base, 'movement_type', v_mv.type,
        'movement_deleted', v_mv.deleted_at is not null);
    end if;
    if v_details is distinct from v_alert.details
       or (v_cause and v_alert.movement_id is distinct from v_mv.id) then
      update public.alerts
         set details     = v_details,
             movement_id = case when v_cause then v_mv.id else movement_id end
       where id = v_alert.id;
    end if;
    return;
  end if;

  if not v_cause then
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
                           'movement_type', v_mv.type, 'movement_deleted', v_mv.deleted_at is not null,
                           'renegative_at', now()),
           movement_id = v_mv.id
     where id = v_recent.id;
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, material_id, movement_id, details)
  values (p_company_id, 'manfiy_qoldiq', 'ogohlantirish', p_object_id, p_material_id, v_mv.id,
          jsonb_build_object(
            'stock_after',      v_stock,
            'qty_base',         v_mv.qty_base,
            'unit',             v_unit,
            'movement_type',    v_mv.type,
            'movement_deleted', v_mv.deleted_at is not null));
end;
$$;

-- Batch 12 imzosi saqlanadi: sabab = tirik chiqim / transfer_out (eski ma'no).
create or replace function private.evaluate_negative_stock(
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
begin
  perform private.evaluate_negative_stock(
    p_company_id, p_object_id, p_material_id, p_movement_id,
    exists (select 1 from public.movements m
             where m.id = p_movement_id and m.deleted_at is null
               and m.type in ('chiqim', 'transfer_out')));
end;
$$;

-- movements AFTER trigger (Batch 12 versiyasi) — faqat B bo'limi: har (obyekt, material)
-- juftligi uchun qoldiqqa ta'sir (yangi tirik − eski tirik, ishorali); manfiy → p_decreased.
create or replace function private.tg_movements_automation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pid   uuid;
  v_pair  record;
  v_day   record;
  v_kirim boolean;
  v_delta numeric;
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

  -- B: manfiy qoldiq (eski va yangi obyekt+material), sabab — qoldiq kamaygan juftlik
  for v_pair in
    select distinct x.o, x.m
      from (select new.object_id as o, new.material_id as m
            union all
            select old.object_id, old.material_id where tg_op = 'UPDATE') x
     order by 1, 2
  loop
    v_delta := 0;
    if new.deleted_at is null and new.object_id = v_pair.o and new.material_id = v_pair.m then
      v_delta := v_delta + case when new.type in ('chiqim', 'transfer_out') then -new.qty_base else new.qty_base end;
    end if;
    if tg_op = 'UPDATE' and old.deleted_at is null and old.object_id = v_pair.o and old.material_id = v_pair.m then
      v_delta := v_delta - case when old.type in ('chiqim', 'transfer_out') then -old.qty_base else old.qty_base end;
    end if;
    perform private.evaluate_negative_stock(new.company_id, v_pair.o, v_pair.m, new.id, v_delta < 0);
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

-- ----------------------------------------------------------------------------
-- A3. submit_inventory_count (Batch 8 versiyasi):
--   qty_expected = qator sanalgan paytdagi qoldiq (private.stock_at(..., counted_at) —
--   occurred_at <= counted_at bo'lgan tirik harakatlar). Sanalmagan materiallar (Y2) —
--   yuborish paytidagi qoldiq (avvalgidek).
--   Ogohlantirish: hisob boshlangandan (inventory_counts.created_at) keyin kiritilgan,
--   sanalgan materiallardagi tirik harakatlar — alert details.movements_during_count
--   [{material_id, material_name, count}] va movements_during_count_total. Natija
--   jsonb ga movements_during_count (son) qo'shildi.
-- ----------------------------------------------------------------------------
create or replace function public.submit_inventory_count(p_count_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me        uuid := private.my_profile_id();
  v_count     public.inventory_counts%rowtype;
  v_list      jsonb;
  v_n         integer;
  v_total_i   numeric;
  v_nc_list   jsonb;
  v_nc_pos    integer;
  v_nc_count  integer;
  v_total_nc  numeric;
  v_total     numeric;
  v_late      jsonb;
  v_late_n    integer;
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

  perform set_config('terron.inventory_rpc', 'on', true);

  update public.inventory_count_items i
     set qty_expected   = private.stock_at(v_count.company_id, v_count.object_id, i.material_id, i.counted_at),
         price_per_base = private.inventory_price(v_count.company_id, i.material_id)
   where i.company_id = v_count.company_id
     and i.inventory_count_id = v_count.id
     and i.deleted_at is null;

  update public.inventory_counts
     set status = 'submitted'
   where id = v_count.id;

  -- (a) sanalgan qatorlardagi kamomad
  with s as (
    select i.material_id,
           i.qty_expected::numeric(20,6)                          as expected,
           i.qty_counted::numeric(20,6)                           as counted,
           (i.qty_expected - i.qty_counted)::numeric(20,6)        as shortage,
           i.price_per_base
      from public.inventory_count_items i
     where i.company_id = v_count.company_id
       and i.inventory_count_id = v_count.id
       and i.deleted_at is null
       and i.qty_expected is not null
       and i.qty_counted < i.qty_expected
  ),
  v as (
    select s.*, m.name as material_name, m.base_unit,
           round(s.shortage * s.price_per_base, 2) as shortage_value,
           row_number() over (order by s.shortage desc, s.material_id) as rn
      from s
      join public.materials m on m.company_id = v_count.company_id and m.id = s.material_id
  )
  select jsonb_agg(jsonb_build_object(
           'material_id', v.material_id, 'material_name', v.material_name, 'base_unit', v.base_unit,
           'expected', v.expected, 'counted', v.counted, 'shortage', v.shortage,
           'shortage_value', v.shortage_value
         ) order by v.rn) filter (where v.rn <= 20),
         count(*)::integer,
         sum(v.shortage_value)
    into v_list, v_n, v_total_i
    from v;

  -- (b) Y2 — sanalmagan materiallar (qoldig'i ≠ 0, qatori yo'q)
  with st as (
    select sb.material_id, sb.qty_base::numeric(20,6) as expected
      from public.stock_balances sb
     where sb.company_id = v_count.company_id
       and sb.object_id = v_count.object_id
       and sb.qty_base <> 0
       and not exists (
         select 1 from public.inventory_count_items i
          where i.company_id = v_count.company_id
            and i.inventory_count_id = v_count.id
            and i.material_id = sb.material_id
            and i.deleted_at is null
       )
  ),
  v as (
    select st.*, m.name as material_name, m.base_unit,
           round(st.expected * private.inventory_price(v_count.company_id, st.material_id), 2) as shortage_value,
           row_number() over (order by st.expected desc, st.material_id) as rn
      from st
      join public.materials m on m.company_id = v_count.company_id and m.id = st.material_id
     where st.expected > 0
  )
  select jsonb_agg(jsonb_build_object(
           'material_id', v.material_id, 'material_name', v.material_name, 'base_unit', v.base_unit,
           'expected', v.expected, 'shortage_value', v.shortage_value
         ) order by v.rn) filter (where v.rn <= 20),
         count(*)::integer,
         sum(v.shortage_value)
    into v_nc_list, v_nc_pos, v_total_nc
    from v;

  select count(*)::integer into v_nc_count
    from public.stock_balances sb
   where sb.company_id = v_count.company_id
     and sb.object_id = v_count.object_id
     and sb.qty_base <> 0
     and not exists (
       select 1 from public.inventory_count_items i
        where i.company_id = v_count.company_id
          and i.inventory_count_id = v_count.id
          and i.material_id = sb.material_id
          and i.deleted_at is null
     );

  -- A3: sanash davomida (hisob yaratilgandan keyin) kiritilgan harakatlar
  select coalesce(jsonb_agg(jsonb_build_object(
           'material_id', x.material_id, 'material_name', x.name, 'count', x.n)
           order by x.n desc, x.name, x.material_id), '[]'::jsonb),
         coalesce(sum(x.n), 0)::integer
    into v_late, v_late_n
    from (
      select m.material_id, mt.name, count(*)::integer as n
        from public.movements m
        join public.materials mt on mt.company_id = m.company_id and mt.id = m.material_id
       where m.company_id = v_count.company_id
         and m.object_id = v_count.object_id
         and m.deleted_at is null
         and m.created_at > v_count.created_at
         and m.material_id in (
           select i.material_id from public.inventory_count_items i
            where i.company_id = v_count.company_id
              and i.inventory_count_id = v_count.id
              and i.deleted_at is null)
       group by m.material_id, mt.name
    ) x;

  select sum(x) into v_total from (values (v_total_i), (v_total_nc)) t(x);

  if v_n > 0 or v_nc_pos > 0 then
    insert into public.alerts (company_id, type, severity, object_id, inventory_count_id, details)
    values (v_count.company_id, 'inventarizatsiya_kamomadi',
            case when v_total >= 1000000 then 'jiddiy' else 'ogohlantirish' end::public.alert_severity,
            v_count.object_id, v_count.id,
            jsonb_build_object('count_id', v_count.id,
                               'items', coalesce(v_list, '[]'::jsonb),
                               'more_count', greatest(v_n - 20, 0),
                               'not_counted', coalesce(v_nc_list, '[]'::jsonb),
                               'not_counted_more', greatest(v_nc_pos - 20, 0),
                               'total_shortage_value', v_total,
                               'movements_during_count', v_late,
                               'movements_during_count_total', v_late_n));
  end if;

  perform set_config('terron.inventory_rpc', 'off', true);
  return jsonb_build_object('has_shortage', v_n > 0 or v_nc_pos > 0,
                            'not_counted_count', v_nc_count,
                            'movements_during_count', v_late_n);
end;
$$;

-- A4. apply_inventory_adjustments (Batch 10 versiyasi) — inventory_adjust harakatlari
-- endi faqat RPC GUC ichida (terron.inventory_rpc).
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
  if v_count.submitted_at is not null and v_count.submitted_at < now() - interval '7 days' then
    raise exception 'Inventarizatsiya 7 kundan oldin yakunlangan — qoldiqni tuzatish uchun qayta sanang'
      using errcode = '55000', hint = 'inventory_apply_expired';
  end if;

  perform set_config('terron.inventory_rpc', 'on', true);

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

  update public.alerts a
     set details = a.details || jsonb_build_object(
           'applied_at', now(),
           'applied_by_name', (select p.full_name from public.profiles p where p.id = v_me))
   where a.company_id = v_count.company_id
     and a.inventory_count_id = v_count.id
     and a.type = 'inventarizatsiya_kamomadi'
     and a.deleted_at is null;

  perform set_config('terron.inventory_rpc', 'off', true);
  return v_n;
end;
$$;

-- ----------------------------------------------------------------------------
-- A5 + B14. receive_transfer (Batch 8 versiyasi):
--   * transfer_in o'tkazma birligida; birlik o'chirilgan bo'lsa — asosiy birlikda
--     (factor 1, qty_input = qty_base);
--   * qabul > yuborilgan: faqat admin / super_admin va izoh bilan, aks holda
--     22023 transfer_over_receipt.
-- ----------------------------------------------------------------------------
create or replace function public.receive_transfer(
  p_transfer_id          uuid,
  p_qty_received_input   text default null,
  p_note                 text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_num_re   constant text := '^\s*[+]?([0-9]+(\.[0-9]*)?|\.[0-9]+)\s*$';
  v_me       uuid := private.my_profile_id();
  v_t        public.transfers%rowtype;
  v_qty      numeric;
  v_factor   numeric;
  v_base_q   numeric(20,6);
  v_received numeric(20,6);
  v_mv       uuid;
  v_note     text := nullif(btrim(p_note), '');
  v_unit     text;
  v_from     text;
  v_to       text;
  v_unit_id  uuid;
  v_ins_qty  numeric;
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Izoh juda uzun (500 belgigacha)'
      using errcode = '22023', hint = 'transfer_invalid';
  end if;
  if p_qty_received_input is not null and btrim(p_qty_received_input) <> '' then
    if p_qty_received_input !~ c_num_re then
      raise exception 'Miqdor raqam emas' using errcode = '22023', hint = 'transfer_invalid';
    end if;
    v_qty := round(btrim(p_qty_received_input)::numeric, 6);
    if v_qty >= 1e14 then
      raise exception 'Miqdor juda katta' using errcode = '22023', hint = 'transfer_invalid';
    end if;
  end if;

  select t.* into v_t
    from public.transfers t
   where t.id = p_transfer_id and t.deleted_at is null
     for update;
  if not found or not private.can_access_company(v_t.company_id) then
    raise exception 'O''tkazma topilmadi' using errcode = 'P0002', hint = 'transfer_not_found';
  end if;

  if not (private.has_role('super_admin', 'admin')
          or (private.has_role('prorab', 'omborchi') and v_t.to_object_id in (select private.my_object_ids()))) then
    raise exception 'Bu o''tkazmani qabul qilishga ruxsat yo''q'
      using errcode = '42501', hint = 'transfer_forbidden';
  end if;

  v_qty := coalesce(v_qty, v_t.qty_input);
  select mu.factor into v_factor
    from public.material_units mu
   where mu.company_id = v_t.company_id and mu.id = v_t.unit_id;
  v_base_q := round(v_qty * v_factor, 6);

  if v_t.status = 'qabul_qilindi' then
    if p_qty_received_input is null or btrim(p_qty_received_input) = ''
       or v_base_q = v_t.received_qty_base then
      return;
    end if;
    raise exception 'O''tkazma allaqachon boshqa miqdor bilan qabul qilingan'
      using errcode = '55000', hint = 'transfer_already_received';
  end if;
  if v_t.status <> 'yuborildi' then
    raise exception 'O''tkazma bekor qilingan' using errcode = '55000', hint = 'transfer_not_open';
  end if;

  -- B14: yuborilgandan ko'p qabul — faqat admin, izoh bilan
  if v_base_q > v_t.qty_base then
    if not private.has_role('super_admin', 'admin') then
      raise exception 'Yuborilgandan ko''p qabul qilib bo''lmaydi (yuborilgan miqdorni kiriting)'
        using errcode = '22023', hint = 'transfer_over_receipt';
    end if;
    if v_note is null then
      raise exception 'Yuborilgandan ko''p qabul qilish uchun izoh majburiy'
        using errcode = '22023', hint = 'transfer_over_receipt';
    end if;
  end if;

  -- A5: birlik o'chirilgan bo'lsa — asosiy birlikda
  select mu.id into v_unit_id
    from public.material_units mu
   where mu.company_id = v_t.company_id and mu.id = v_t.unit_id and mu.deleted_at is null;
  if v_unit_id is not null then
    v_ins_qty := v_qty;
  else
    select mu.id into v_unit_id
      from public.material_units mu
      join public.materials m on m.company_id = mu.company_id and m.id = mu.material_id
     where mu.company_id = v_t.company_id and mu.material_id = v_t.material_id
       and mu.unit = m.base_unit and mu.factor = 1 and mu.variant is null and mu.deleted_at is null
     limit 1;
    v_ins_qty := v_base_q;
  end if;

  perform set_config('terron.transfer_rpc', 'on', true);

  v_received := 0;
  if v_qty > 0 then
    insert into public.movements
      (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base,
       transfer_id, note, created_by)
    values
      (v_t.company_id, 'transfer_in', v_t.to_object_id, v_t.material_id, v_unit_id, v_ins_qty, '-',
       0, v_t.id, v_note, v_me)
    returning id, qty_base into v_mv, v_received;
  end if;

  update public.transfers
     set status            = 'qabul_qilindi',
         received_qty_base = v_received,
         received_at       = now(),
         received_by       = case when v_t.company_id = private.my_company_id() then v_me end
   where id = v_t.id;

  if v_received <> v_t.qty_base then
    select m.base_unit into v_unit from public.materials m
     where m.company_id = v_t.company_id and m.id = v_t.material_id;
    select o.name into v_from from public.objects o where o.company_id = v_t.company_id and o.id = v_t.from_object_id;
    select o.name into v_to   from public.objects o where o.company_id = v_t.company_id and o.id = v_t.to_object_id;
    insert into public.alerts (company_id, type, severity, object_id, material_id, movement_id, details)
    values (v_t.company_id, 'otkazma_farqi', 'ogohlantirish', v_t.to_object_id, v_t.material_id, v_mv,
            jsonb_build_object(
              'transfer_id',       v_t.id,
              'sent_qty_base',     v_t.qty_base,
              'received_qty_base', v_received,
              'diff_qty_base',     (v_received - v_t.qty_base)::numeric(20,6),
              'direction',         case when v_received < v_t.qty_base then 'under' else 'over' end,
              'base_unit',         v_unit,
              'from_object_name',  v_from,
              'to_object_name',    v_to));
  end if;

  if v_t.created_by = v_me then
    insert into public.alerts (company_id, type, severity, object_id, material_id, movement_id, details)
    values (v_t.company_id, 'ozi_qabul_qilgan', 'belgi', v_t.to_object_id, v_t.material_id, v_mv,
            jsonb_build_object('transfer_id', v_t.id, 'qty_base', v_received, 'buyer_id', null,
                               'receiver_id', v_me, 'kind', 'transfer'));
  end if;

  perform private.close_transfer_alerts(v_t.company_id, v_t.id, 'transfer_received');

  perform set_config('terron.transfer_rpc', 'off', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- A8. Qoida 3 (Batch 5 versiyasi) — meta kalitlar saqlanadi, solishtirishga kirmaydi.
-- ----------------------------------------------------------------------------
create or replace function private.evaluate_purchase_price(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p        public.purchases%rowtype;
  v_r        record;
  v_details  jsonb;
  v_alert    public.alerts%rowtype;
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
      array['narx_ogishi']::public.alert_type[], 'purchase_deleted');
    return;
  end if;

  select * into v_r
    from private.price_check(v_p.company_id, v_p.material_id, v_p.price_per_base,
                             v_p.purchased_at, v_p.created_at, v_p.id);

  v_details := jsonb_build_object(
    'avg_n',         v_r.avg_n,
    'diff_n',        v_r.diff_n,
    'avg_90',        v_r.avg_90,
    'diff_90',       v_r.diff_90,
    'price',         v_p.price_per_base,
    'direction',     v_r.direction,
    'window_size',   v_r.window_size,
    'threshold_pct', v_r.threshold_pct
  );

  select a.* into v_alert
    from public.alerts a
   where a.company_id = v_p.company_id
     and a.purchase_id = v_p.id
     and a.type = 'narx_ogishi'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null;

  if v_r.direction = 'ok' then
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

  if v_alert.id is not null then
    if (v_alert.details - private.alert_meta_keys()) = v_details
       and v_alert.object_id is not distinct from v_p.object_id
       and v_alert.material_id is not distinct from v_p.material_id then
      return;
    end if;
    update public.alerts
       set details     = v_details || private.alert_meta(v_alert.details),
           object_id   = v_p.object_id,
           material_id = v_p.material_id
     where id = v_alert.id;
  else
    insert into public.alerts
      (company_id, type, severity, object_id, material_id, purchase_id, details)
    values
      (v_p.company_id, 'narx_ogishi', 'ogohlantirish', v_p.object_id, v_p.material_id, v_p.id, v_details);
  end if;
end;
$$;

-- A8. Qoida 4 (Batch 8 versiyasi) — meta kalitlar saqlanadi.
create or replace function private.evaluate_norm(p_company_id uuid, p_object_id uuid, p_material_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v         record;
  v_state   text;
  v_over    numeric;
  v_sev     public.alert_severity;
  v_details jsonb;
  v_alert   public.alerts%rowtype;
  v_new_lvl integer;
begin
  if p_company_id is null or p_object_id is null or p_material_id is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'terron.norm:' || p_object_id::text || ':' || p_material_id::text, 0));

  select * into v from private.norm_numbers(p_company_id, p_object_id, p_material_id);

  update public.alerts a
     set status  = 'yopildi',
         details = a.details || jsonb_build_object(
           'auto_closed', true,
           'closed_reason', case when v.o_estimate_id is null then 'no_current_estimate' else 'estimate_changed' end,
           'closed_by_actor', private.my_profile_id())
   where a.company_id = p_company_id
     and a.object_id = p_object_id
     and a.material_id = p_material_id
     and a.type = 'normadan_oshish'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
     and (v.o_estimate_id is null or (a.details ->> 'estimate_id') is distinct from v.o_estimate_id::text);

  if v.o_estimate_id is null then
    return;
  end if;

  if v.o_norm_qty_base = 0 or v.o_allowed_qty_base = 0 then
    v_state := case when v.o_consumed_qty_base > 0 then 'not_in_estimate' else 'ok' end;
  elsif v.o_consumed_qty_base > v.o_allowed_qty_base then
    v_state := 'over';
    v_over := round((v.o_consumed_qty_base::numeric(20,6) - v.o_allowed_qty_base::numeric(20,6)) * 100
                    / v.o_allowed_qty_base::numeric(20,6), 2);
  else
    v_state := 'ok';
  end if;

  v_sev := case when v_state = 'over' and v_over >= 25 then 'jiddiy' else 'ogohlantirish' end;
  v_details := jsonb_build_object(
    'norm_qty_base',     v.o_norm_qty_base,
    'allowed_qty_base',  v.o_allowed_qty_base,
    'consumed_qty_base', v.o_consumed_qty_base,
    'over_pct',          v_over,
    'waste_pct',         v.o_waste_pct,
    'estimate_id',       v.o_estimate_id,
    'estimate_version',  v.o_estimate_version,
    'not_in_estimate',   v_state = 'not_in_estimate',
    'base_unit',         v.o_base_unit
  );

  select a.* into v_alert
    from public.alerts a
   where a.company_id = p_company_id
     and a.object_id = p_object_id
     and a.material_id = p_material_id
     and a.type = 'normadan_oshish'
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

  if v_alert.id is not null then
    if v_alert.severity = v_sev and (v_alert.details - private.alert_meta_keys()) = v_details then
      return;
    end if;
    update public.alerts
       set severity = v_sev,
           details  = v_details || private.alert_meta(v_alert.details)
     where id = v_alert.id;
    v_new_lvl := private.norm_escalation_level(v_sev, v_over);
    if v_new_lvl > private.norm_escalation_level(v_alert.severity, (v_alert.details ->> 'over_pct')::numeric) then
      perform private.enqueue_alert_escalation(v_alert.id, v_new_lvl);
    end if;
    return;
  end if;

  if exists (
    select 1 from public.alerts a
     where a.company_id = p_company_id
       and a.object_id = p_object_id
       and a.material_id = p_material_id
       and a.type = 'normadan_oshish'
       and a.status = 'yopildi'
       and a.deleted_at is null
       and coalesce((a.details ->> 'auto_closed')::boolean, false) = false
       and (a.details ->> 'estimate_id') = v.o_estimate_id::text
       and (a.details ->> 'allowed_qty_base')::numeric = v.o_allowed_qty_base
       and (a.details ->> 'consumed_qty_base')::numeric = v.o_consumed_qty_base
  ) then
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, material_id, details)
  values (p_company_id, 'normadan_oshish', v_sev, p_object_id, p_material_id, v_details);
end;
$$;

-- A8. Qoida 6 (Batch 8 versiyasi) — meta kalitlar saqlanadi.
create or replace function private.evaluate_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r       public.material_requests%rowtype;
  v         record;
  v_other   numeric(20,6);
  v_avail   numeric;
  v_overq   numeric;
  v_over    boolean;
  v_nie     boolean;
  v_details jsonb;
  v_alert   public.alerts%rowtype;
begin
  select r.* into v_r from public.material_requests r where r.id = p_request_id;
  if not found then
    return;
  end if;

  if v_r.deleted_at is not null or v_r.status = 'rad' then
    update public.alerts a
       set status  = 'yopildi',
           details = a.details || jsonb_build_object(
             'auto_closed', true,
             'closed_reason', case when v_r.deleted_at is not null then 'request_deleted' else 'request_rejected' end,
             'closed_by_actor', private.my_profile_id())
     where a.company_id = v_r.company_id
       and a.request_id = v_r.id
       and a.type = 'smetadan_ortiq_sorov'
       and a.status in ('yangi', 'korildi')
       and a.deleted_at is null;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('terron.request:' || v_r.object_id::text || ':' || v_r.material_id::text));

  select * into v from private.norm_numbers(v_r.company_id, v_r.object_id, v_r.material_id);

  if v.o_estimate_id is null then
    update public.alerts a
       set status  = 'yopildi',
           details = a.details || jsonb_build_object(
             'auto_closed', true, 'closed_reason', 'no_current_estimate',
             'closed_by_actor', private.my_profile_id())
     where a.company_id = v_r.company_id
       and a.request_id = v_r.id
       and a.type = 'smetadan_ortiq_sorov'
       and a.status in ('yangi', 'korildi')
       and a.deleted_at is null;
    return;
  end if;

  select coalesce(sum(r.qty_base), 0)::numeric(20,6) into v_other
    from public.material_requests r
   where r.company_id = v_r.company_id
     and r.object_id = v_r.object_id
     and r.material_id = v_r.material_id
     and r.id <> v_r.id
     and r.status in ('kutilmoqda', 'tasdiqlandi')
     and r.deleted_at is null;

  v_nie   := v.o_norm_qty_base = 0;
  v_avail := v.o_allowed_qty_base::numeric(20,6)
             - greatest(v.o_consumed_qty_base::numeric(20,6), v.o_delivered_qty_base::numeric(20,6))
             - v_other::numeric(20,6);
  v_over  := v_r.qty_base > v_avail;
  v_overq := case when v_over then v_r.qty_base - v_avail else 0 end;

  v_details := jsonb_build_object(
    'requested_qty_base',  v_r.qty_base,
    'allowed_qty_base',    v.o_allowed_qty_base,
    'consumed_qty_base',   v.o_consumed_qty_base,
    'delivered_qty_base',  v.o_delivered_qty_base,
    'other_open_qty_base', v_other,
    'available_qty_base',  v_avail,
    'over_qty_base',       v_overq,
    'estimate_version',    v.o_estimate_version,
    'not_in_estimate',     v_nie,
    'base_unit',           v.o_base_unit
  );

  select a.* into v_alert
    from public.alerts a
   where a.company_id = v_r.company_id
     and a.request_id = v_r.id
     and a.type = 'smetadan_ortiq_sorov'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null;

  if not v_over then
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

  if v_alert.id is not null then
    if (v_alert.details - private.alert_meta_keys()) = v_details
       and v_alert.object_id is not distinct from v_r.object_id
       and v_alert.material_id is not distinct from v_r.material_id then
      return;
    end if;
    update public.alerts
       set details     = v_details || private.alert_meta(v_alert.details),
           object_id   = v_r.object_id,
           material_id = v_r.material_id
     where id = v_alert.id;
    return;
  end if;

  if exists (
    select 1 from public.alerts a
     where a.company_id = v_r.company_id
       and a.request_id = v_r.id
       and a.type = 'smetadan_ortiq_sorov'
       and a.status = 'yopildi'
       and a.deleted_at is null
       and coalesce((a.details ->> 'auto_closed')::boolean, false) = false
       and (a.details ->> 'requested_qty_base')::numeric = v_r.qty_base
       and (a.details ->> 'available_qty_base')::numeric = v_avail
  ) then
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, material_id, request_id, details)
  values (v_r.company_id, 'smetadan_ortiq_sorov', 'ogohlantirish', v_r.object_id, v_r.material_id,
          v_r.id, v_details);
end;
$$;

-- ----------------------------------------------------------------------------
-- A7. Ochiq so'rovlarni (kutilmoqda / tasdiqlandi) qayta baholash: obyekt bo'yicha
--   (p_material_id null — hammasi), p_exclude dan tashqari; material, id tartibida.
-- ----------------------------------------------------------------------------
create function private.reevaluate_open_requests(
  p_company_id  uuid,
  p_object_id   uuid,
  p_material_id uuid,
  p_exclude     uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select r.id
      from public.material_requests r
     where r.company_id = p_company_id
       and r.object_id = p_object_id
       and (p_material_id is null or r.material_id = p_material_id)
       and r.status in ('kutilmoqda', 'tasdiqlandi')
       and r.deleted_at is null
       and r.id is distinct from p_exclude
     order by r.material_id, r.id
  loop
    perform private.evaluate_request(v_id);
  end loop;
end;
$$;

-- Batch 8 versiyasi + A7: oxirida obyektning ochiq so'rovlari (qoida 6).
create or replace function private.evaluate_object_norms(p_company_id uuid, p_object_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mat uuid;
begin
  if auth.uid() is not null and not private.can_access_company(p_company_id) then
    raise exception 'Ruxsat yo''q' using errcode = '42501', hint = 'estimate_direct_edit';
  end if;
  for v_mat in
    select x.material_id from (
      select i.material_id
        from public.estimate_items i
        join public.estimates e on e.company_id = i.company_id and e.id = i.estimate_id
       where e.company_id = p_company_id and e.object_id = p_object_id
         and e.is_current and e.deleted_at is null
         and i.item_type = 'material' and i.deleted_at is null and i.material_id is not null
      union
      select mv.material_id
        from public.movements mv
       where mv.company_id = p_company_id and mv.object_id = p_object_id
         and mv.type = 'chiqim' and mv.deleted_at is null
      union
      select a.material_id
        from public.alerts a
       where a.company_id = p_company_id and a.object_id = p_object_id
         and a.type = 'normadan_oshish' and a.status in ('yangi', 'korildi')
         and a.deleted_at is null and a.material_id is not null
    ) x
    order by x.material_id
  loop
    perform private.evaluate_norm(p_company_id, p_object_id, v_mat);
  end loop;

  perform private.reevaluate_open_requests(p_company_id, p_object_id, null, null);
end;
$$;

-- Batch 8 versiyasi + A7: smeta qatori o'zgarsa — shu material bo'yicha so'rovlar ham.
create or replace function private.tg_estimate_items_norm_eval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obj uuid;
begin
  select e.object_id into v_obj
    from public.estimates e
   where e.company_id = new.company_id and e.id = new.estimate_id
     and e.is_current and e.deleted_at is null;
  if found then
    perform private.evaluate_norm(new.company_id, v_obj, new.material_id);
    perform private.reevaluate_open_requests(new.company_id, v_obj, new.material_id, null);
  end if;
  return null;
end;
$$;

-- Batch 8 versiyasi + A7: so'rov holati o'zgarsa (yoki o'chirilsa / tiklansa) —
-- shu obyekt+materialdagi boshqa ochiq so'rovlar ham qayta baholanadi.
create or replace function private.tg_requests_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.deleted_at is not null
     or new.status = 'rad'
     or old.deleted_at is not null
     or old.status = 'rad'
     or new.qty_base    is distinct from old.qty_base
     or new.object_id   is distinct from old.object_id
     or new.material_id is distinct from old.material_id then
    perform private.evaluate_request(new.id);
  end if;

  if tg_op = 'UPDATE'
     and (new.status is distinct from old.status or new.deleted_at is distinct from old.deleted_at) then
    perform private.reevaluate_open_requests(new.company_id, new.object_id, new.material_id, new.id);
    if new.object_id is distinct from old.object_id or new.material_id is distinct from old.material_id then
      perform private.reevaluate_open_requests(old.company_id, old.object_id, old.material_id, new.id);
    end if;
  end if;
  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- A14. set_current_estimate (Batch 8 versiyasi): obyekt qulfidan keyin maqsad smeta
--   qayta o'qiladi (for update) — parallel soft delete bilan poyga yo'q.
-- ----------------------------------------------------------------------------
create or replace function public.set_current_estimate(p_estimate_id uuid)
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

  -- qulfdan keyin qayta tekshirish (READ COMMITTED: yangi snapshot)
  perform 1
     from public.estimates e
    where e.id = p_estimate_id
      and e.deleted_at is null
      for update;
  if not found then
    raise exception 'Smeta topilmadi'
      using errcode = 'P0002', hint = 'estimate_not_found';
  end if;

  perform set_config('terron.estimate_rpc', 'on', true);

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
  perform private.evaluate_object_norms(v_company, v_object);

  perform set_config('terron.estimate_rpc', 'off', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- B11. private.estimate_alert (Batch 7 versiyasi) + firma tekshiruvi:
--   foydalanuvchi sessiyasida smeta boshqa firmaniki → estimate_direct_edit;
--   'current_deleted' — faqat trigger ichidan (pg_trigger_depth() > 0) va smeta
--   haqiqatan o'chirilgan bo'lsa.
-- ----------------------------------------------------------------------------
create or replace function private.estimate_alert(p_kind text, p_estimate_id uuid, p_prev_id uuid)
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
  if auth.uid() is not null and not private.is_super_admin()
     and v_est.company_id is distinct from private.my_company_id() then
    raise exception 'Smetaga ruxsat yo''q'
      using errcode = '42501', hint = 'estimate_direct_edit';
  end if;
  select e.version into v_prev_ver from public.estimates e
   where e.company_id = v_est.company_id and e.id = p_prev_id;

  if p_kind = 'current_deleted' then
    if v_est.deleted_at is null or (auth.uid() is not null and pg_trigger_depth() = 0) then
      return;
    end if;
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
    return;
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

-- ============================================================================
-- 5. Xavfsizlik qoidalari
-- ============================================================================

-- ----------------------------------------------------------------------------
-- B1. Joylashtirilgan (tirik) harakat / xarid foydalanuvchi sessiyasida o'zgartirilsa:
--   movements: type, object_id, material_id, unit_id, qty_input, qty_base, occurred_at, purchase_id;
--   purchases: object_id, material_id, unit_id, qty_input, qty_base, total_amount, unit_price,
--              price_per_base, purchased_at, buyer_id.
--   → yozuv_ozgartirildi (ogohlantirish, Telegram), details: before/after va aktyor.
--   Istisno: muallifning o'z tuzatishi public.correct_entry orqali (GUC terron.correct_mode
--   = 'author') → yozuv_tuzatildi (belgi). O'tkazma / inventarizatsiya RPC ichidagi va
--   tizim (auth.uid() yo'q) o'zgarishlari — alert yo'q. Soft delete / tiklash —
--   yozuv_ochirildi / yozuv_tiklandi (mavjud).
-- ----------------------------------------------------------------------------
create function private.tg_posted_change_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new     jsonb := to_jsonb(new);
  v_old     jsonb := to_jsonb(old);
  v_cols    text[];
  v_changed text[];
  v_before  jsonb := '{}'::jsonb;
  v_after   jsonb := '{}'::jsonb;
  v_me      uuid := private.my_profile_id();
  v_mode    text := coalesce(current_setting('terron.correct_mode', true), '');
  v_type    text;
  v_sev     text;
  c         text;
begin
  if auth.uid() is null or old.deleted_at is not null or new.deleted_at is not null
     or private.transfer_rpc_active() or private.inventory_rpc_active() then
    return null;
  end if;

  v_cols := case tg_table_name
    when 'movements' then array['type', 'object_id', 'material_id', 'unit_id', 'qty_input', 'qty_base',
                                'occurred_at', 'purchase_id']
    else array['object_id', 'material_id', 'unit_id', 'qty_input', 'qty_base', 'total_amount',
               'unit_price', 'price_per_base', 'purchased_at', 'buyer_id']
  end;
  select array_agg(k order by k) into v_changed
    from unnest(v_cols) k
   where v_new -> k is distinct from v_old -> k;
  if v_changed is null then
    return null;
  end if;

  foreach c in array v_changed || array['unit_input'] loop
    v_before := v_before || jsonb_build_object(c, v_old -> c);
    v_after  := v_after  || jsonb_build_object(c, v_new -> c);
  end loop;

  if v_mode = 'author' then
    v_type := 'yozuv_tuzatildi';
    v_sev  := 'belgi';
  else
    v_type := 'yozuv_ozgartirildi';
    v_sev  := 'ogohlantirish';
  end if;

  insert into public.alerts
    (company_id, type, severity, object_id, material_id, purchase_id, movement_id, details)
  values
    (new.company_id, v_type::public.alert_type, v_sev::public.alert_severity,
     (v_new ->> 'object_id')::uuid, (v_new ->> 'material_id')::uuid,
     case when tg_table_name = 'purchases' then new.id end,
     case when tg_table_name = 'movements' then new.id end,
     jsonb_build_object(
       'table',            tg_table_name,
       'record_id',        new.id,
       'changed',          to_jsonb(v_changed),
       'before',           v_before,
       'after',            v_after,
       'via',              case when v_mode <> '' then 'correct_entry' else 'direct' end,
       'actor_profile_id', v_me,
       'actor_name',       (select p.full_name from public.profiles p where p.id = v_me),
       'author_id',        v_new -> 'created_by',
       'author_name',      (select p.full_name from public.profiles p
                             where p.company_id = new.company_id and p.id = (v_new ->> 'created_by')::uuid),
       'material_name',    (select m.name from public.materials m
                             where m.company_id = new.company_id and m.id = (v_new ->> 'material_id')::uuid),
       'base_unit',        (select m.base_unit from public.materials m
                             where m.company_id = new.company_id and m.id = (v_new ->> 'material_id')::uuid),
       'movement_type',    case when tg_table_name = 'movements' then v_new -> 'type' end));
  return null;
end;
$$;

create trigger zz_posted_change after update on public.movements
  for each row execute function private.tg_posted_change_alert();
create trigger zz_posted_change after update on public.purchases
  for each row execute function private.tg_posted_change_alert();

-- ----------------------------------------------------------------------------
-- D1. public.correct_entry — muallif o'z yozuvini 30 daqiqa ichida tuzatadi (admin —
--   istalgan vaqtda). Faqat bog'lanmagan yozuv: harakat — kirim / chiqim, purchase_id,
--   transfer_id, inventory_count_id yo'q; xarid — bog'langan tirik kirimi yo'q.
--   Oddiy UPDATE (barcha guard va qoidalar, audit — UPDATE). null — o'zgarmaydi;
--   p_note '' — izohni tozalaydi. p_total_amount — faqat xaridda.
--   Hint'lar: auth_required, correct_invalid (22023), correct_not_found (P0002),
--   correct_forbidden (42501), correct_window_passed (55000), correct_linked (55000).
-- ----------------------------------------------------------------------------
create function public.correct_entry(
  p_table        text,
  p_id           uuid,
  p_qty_input    numeric,
  p_unit_id      uuid,
  p_total_amount numeric,
  p_note         text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.my_profile_id();
  v_admin   boolean := private.has_role('super_admin', 'admin');
  v_m       public.movements%rowtype;
  v_p       public.purchases%rowtype;
  v_company uuid;
  v_author  uuid;
  v_created timestamptz;
  v_object  uuid;
  v_note    text := nullif(btrim(p_note), '');
  v_own     boolean;
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  if p_table is null or p_table not in ('movements', 'purchases') or p_id is null
     or (p_qty_input is not null and (round(p_qty_input, 6) <= 0 or p_qty_input >= 1e14))
     or (p_total_amount is not null and (p_total_amount < 0 or p_total_amount >= 1e16))
     or (p_table = 'movements' and p_total_amount is not null)
     or (v_note is not null and char_length(v_note) > 500) then
    raise exception 'Tuzatish ma''lumotlari noto''g''ri'
      using errcode = '22023', hint = 'correct_invalid';
  end if;

  if p_table = 'movements' then
    select m.* into v_m from public.movements m where m.id = p_id and m.deleted_at is null for update;
    if not found or not private.can_access_company(v_m.company_id) then
      raise exception 'Yozuv topilmadi' using errcode = 'P0002', hint = 'correct_not_found';
    end if;
    v_company := v_m.company_id; v_author := v_m.created_by; v_created := v_m.created_at; v_object := v_m.object_id;
  else
    select p.* into v_p from public.purchases p where p.id = p_id and p.deleted_at is null for update;
    if not found or not private.can_access_company(v_p.company_id) then
      raise exception 'Yozuv topilmadi' using errcode = 'P0002', hint = 'correct_not_found';
    end if;
    v_company := v_p.company_id; v_author := v_p.created_by; v_created := v_p.created_at; v_object := v_p.object_id;
  end if;

  v_own := v_author = v_me and v_created >= now() - interval '30 minutes';

  if not v_admin then
    if v_author is distinct from v_me then
      raise exception 'Faqat o''zingiz kiritgan yozuvni tuzatish mumkin'
        using errcode = '42501', hint = 'correct_forbidden';
    end if;
    if not v_own then
      raise exception 'Tuzatish muddati (30 daqiqa) o''tgan — administratorga murojaat qiling'
        using errcode = '55000', hint = 'correct_window_passed';
    end if;
    if (p_table = 'movements' and not (private.has_role('prorab', 'omborchi') and private.can_access_object(v_object)))
       or (p_table = 'purchases' and not (private.has_role('taminotchi')
                                         or (private.has_role('prorab', 'haydovchi') and private.can_access_object(v_object)))) then
      raise exception 'Bu yozuvni tuzatishga ruxsat yo''q'
        using errcode = '42501', hint = 'correct_forbidden';
    end if;
  end if;

  if p_table = 'movements' then
    if v_m.type not in ('kirim', 'chiqim') or v_m.purchase_id is not null
       or v_m.transfer_id is not null or v_m.inventory_count_id is not null then
      raise exception 'Bog''langan yozuvni tuzatib bo''lmaydi (xarid, o''tkazma yoki inventarizatsiya)'
        using errcode = '55000', hint = 'correct_linked';
    end if;
  elsif exists (select 1 from public.movements m
                 where m.company_id = v_company and m.purchase_id = p_id
                   and m.type = 'kirim' and m.deleted_at is null) then
    raise exception 'Kirimga bog''langan xaridni tuzatib bo''lmaydi'
      using errcode = '55000', hint = 'correct_linked';
  end if;

  perform set_config('terron.correct_mode', case when v_own then 'author' else 'admin' end, true);

  if p_table = 'movements' then
    update public.movements m
       set qty_input = coalesce(p_qty_input, m.qty_input),
           unit_id   = coalesce(p_unit_id, m.unit_id),
           note      = case when p_note is null then m.note else v_note end
     where m.id = p_id;
  else
    update public.purchases p
       set qty_input    = coalesce(p_qty_input, p.qty_input),
           unit_id      = coalesce(p_unit_id, p.unit_id),
           total_amount = coalesce(p_total_amount, p.total_amount),
           note         = case when p_note is null then p.note else v_note end
     where p.id = p_id;
  end if;

  perform set_config('terron.correct_mode', '', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- B2. Firma sozlamasi o'zgarsa (foydalanuvchi sessiyasida) — sozlama_ozgardi
--   (ogohlantirish, direktor va admin'ga). Kuzatilmaydi: id, name, is_active,
--   created_by, created_at, updated_at, deleted_at.
--   details: {changes: [{key, before, after}], actor_profile_id, actor_name}.
-- ----------------------------------------------------------------------------
create function private.tg_companies_settings_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_skip    constant text[] := array['id', 'name', 'is_active', 'created_by', 'created_at', 'updated_at', 'deleted_at'];
  v_new     jsonb := to_jsonb(new);
  v_old     jsonb := to_jsonb(old);
  v_changes jsonb;
  v_me      uuid := private.my_profile_id();
begin
  if auth.uid() is null then
    return null;
  end if;
  select jsonb_agg(jsonb_build_object('key', k, 'before', v_old -> k, 'after', v_new -> k) order by k)
    into v_changes
    from jsonb_object_keys(v_new) k
   where not (k = any (v_skip))
     and v_new -> k is distinct from v_old -> k;
  if v_changes is null then
    return null;
  end if;

  insert into public.alerts (company_id, type, severity, details)
  values (new.id, 'sozlama_ozgardi'::public.alert_type, 'ogohlantirish',
          jsonb_build_object(
            'changes',          v_changes,
            'actor_profile_id', v_me,
            'actor_name',       (select p.full_name from public.profiles p where p.id = v_me)));
  return null;
end;
$$;

create trigger zz_settings_alert after update on public.companies
  for each row execute function private.tg_companies_settings_alert();

-- ----------------------------------------------------------------------------
-- A6. Podotchet belgisi (foydalanuvchi sessiyasidagi INSERT): qaytarish (qaytarildi)
--   va oynadan tashqari sana ([now − 3 kun, now + 5 daqiqa], admin kiritgan) —
--   podotchet_belgisi (belgi). Bitta yozuv — bitta alert, details.reasons massivi.
-- ----------------------------------------------------------------------------
create function private.tg_cash_advances_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reasons text[] := '{}';
  v_me      uuid := private.my_profile_id();
begin
  if auth.uid() is null or new.deleted_at is not null then
    return null;
  end if;
  if new.kind = 'qaytarildi' then
    v_reasons := array_append(v_reasons, 'qaytarildi');
  end if;
  if new.issued_at < now() - interval '3 days' or new.issued_at > now() + interval '5 minutes' then
    v_reasons := array_append(v_reasons, 'issued_at_outside_window');
  end if;
  if cardinality(v_reasons) = 0 then
    return null;
  end if;

  insert into public.alerts (company_id, type, severity, details)
  values (new.company_id, 'podotchet_belgisi'::public.alert_type, 'belgi',
          jsonb_build_object(
            'table',            'cash_advances',
            'record_id',        new.id,
            'reasons',          to_jsonb(v_reasons),
            'cash_kind',        new.kind,
            'amount',           new.amount,
            'issued_at',        new.issued_at,
            'recipient_id',     new.recipient_id,
            'recipient_name',   (select p.full_name from public.profiles p
                                  where p.company_id = new.company_id and p.id = new.recipient_id),
            'actor_profile_id', v_me,
            'actor_name',       (select p.full_name from public.profiles p where p.id = v_me)));
  return null;
end;
$$;

create trigger zz_cash_flag after insert on public.cash_advances
  for each row execute function private.tg_cash_advances_flag();

-- ----------------------------------------------------------------------------
-- B6. Sotuvchi STIR farqi (belgi): xarid seller_tin (chekdan) ≠ tanlangan sotuvchining
--   tin. Xarid bo'yicha bitta ochiq; shart yo'qolsa — yopiladi.
-- ----------------------------------------------------------------------------
create function private.evaluate_seller_tin(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p     public.purchases%rowtype;
  v_s_name text;
  v_s_tin  text;
  v_alert public.alerts%rowtype;
  v_bad   boolean := false;
  v_det   jsonb;
begin
  select p.* into v_p from public.purchases p where p.id = p_purchase_id;
  if not found then
    return;
  end if;
  perform private.alert_lock('sotuvchi_stir_farqi:' || v_p.id::text);

  if v_p.supplier_id is not null then
    select s.name, s.tin into v_s_name, v_s_tin
      from public.suppliers s
     where s.company_id = v_p.company_id and s.id = v_p.supplier_id;
  end if;
  v_bad := v_p.deleted_at is null and v_p.seller_tin is not null
           and v_s_tin is not null and v_s_tin <> v_p.seller_tin;

  select a.* into v_alert
    from public.alerts a
   where a.company_id = v_p.company_id
     and a.purchase_id = v_p.id
     and a.type::text = 'sotuvchi_stir_farqi'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
   limit 1;

  if not v_bad then
    if v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id,
        case when v_p.deleted_at is not null then 'purchase_deleted' else 'not_applicable' end);
    end if;
    return;
  end if;

  v_det := jsonb_build_object(
    'seller_tin',          v_p.seller_tin,
    'supplier_id',         v_p.supplier_id,
    'supplier_name',       v_s_name,
    'supplier_tin',        v_s_tin,
    'receipt_fiscal_sign', v_p.receipt_fiscal_sign);

  if v_alert.id is not null then
    if (v_alert.details - private.alert_meta_keys()) is distinct from v_det then
      update public.alerts set details = v_det || private.alert_meta(v_alert.details) where id = v_alert.id;
    end if;
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, material_id, purchase_id, details)
  values (v_p.company_id, 'sotuvchi_stir_farqi'::public.alert_type, 'belgi', v_p.object_id, v_p.material_id,
          v_p.id, v_det);
end;
$$;

create function private.tg_purchases_seller_tin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.evaluate_seller_tin(new.id);
  return null;
end;
$$;

create trigger zz_seller_tin_ins after insert on public.purchases
  for each row
  when (new.seller_tin is not null and new.supplier_id is not null)
  execute function private.tg_purchases_seller_tin();
create trigger zz_seller_tin_upd after update on public.purchases
  for each row
  when (old.seller_tin is distinct from new.seller_tin
     or old.supplier_id is distinct from new.supplier_id
     or old.deleted_at is distinct from new.deleted_at)
  execute function private.tg_purchases_seller_tin();

-- ----------------------------------------------------------------------------
-- B6. purchases guard (Batch 12 versiyasi). O'zgargani — (2) va (4):
--   receipt_verified = keshda chek bor VA (|kesh.total − total_amount| ≤ 1 so'm YOKI
--   chekda aynan bitta qator YOKI biror qator summasi (items[].sum) total_amount dan
--   ≤ 1 so'm farq qiladi) VA kesh.receipt_at purchased_at dan ±3 kun ichida.
--   Rasm talabidan ozod — faqat tasdiqlangan VA bir qatorli (ko'p qatorli emas) chek.
--   merge_suppliers ichida (terron.merge_rpc) rasm tekshiruvi qayta qilinmaydi.
-- ----------------------------------------------------------------------------
create or replace function private.tg_purchases_auto_guard()
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
  v_items    jsonb;
  v_n        integer := 0;
  v_multi    boolean := false;
  v_ok       boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_revived := old.deleted_at is not null and new.deleted_at is null;
  end if;

  -- (1)
  if new.receipt_photo_path is null then
    new.receipt_photo_sha256 := null;
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
      new.receipt_total := null;
      new.seller_tin    := null;
    end if;
  else
    select l.total, l.seller_tin, l.receipt_at, l.payload into v_lookup
      from public.receipt_lookups l
     where l.company_id = new.company_id
       and l.fiscal_sign = new.receipt_fiscal_sign
       and l.deleted_at is null;
    v_found := found;
    if v_found then
      v_items := case when jsonb_typeof(v_lookup.payload -> 'items') = 'array'
                      then v_lookup.payload -> 'items' else '[]'::jsonb end;
      v_n := jsonb_array_length(v_items);
      v_multi := v_n > 1;
      v_ok := (
                (v_lookup.total is not null and abs(v_lookup.total - new.total_amount) <= 1)
                or v_n = 1
                or exists (
                     select 1 from jsonb_array_elements(v_items) e
                      where jsonb_typeof(e) = 'object'
                        and (e ->> 'sum') ~ '^-?[0-9]+(\.[0-9]+)?$'
                        and abs((e ->> 'sum')::numeric - new.total_amount) <= 1)
              )
              and v_lookup.receipt_at is not null
              and abs(extract(epoch from (v_lookup.receipt_at - new.purchased_at))) <= 3 * 86400;
    end if;
    if auth.uid() is not null then
      new.receipt_verified := coalesce(v_found and v_ok, false);
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

  -- (4) ko'p qatorli chek rasm talabini bekor qilmaydi
  if new.deleted_at is null and new.receipt_photo_path is null
     and not (new.receipt_verified and not v_multi)
     and coalesce(current_setting('terron.merge_rpc', true), '') <> 'on' then
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

-- ----------------------------------------------------------------------------
-- B5. public.svc_set_photo_hash — rasm xeshini yozish (faqat service_role; Edge
--   Function rasmni yuklagandan keyin serverda hisoblaydi). Oq ro'yxat: movements
--   (photo_sha256), purchases (receipt_photo_sha256). Yozuv tirik va rasmi bo'lishi
--   shart. Xesh: 64 hex (katta harf / probel normallashadi), null — tozalaydi.
--   Qaytaradi: yozuvda shu xesh turibdimi (yozuv yo'q / rasmsiz — false).
--   Takroriy rasm qoidasi (takroriy_yozuv, kind = photo) shu UPDATE da ishlaydi.
-- ----------------------------------------------------------------------------
create function public.svc_set_photo_hash(p_table text, p_id uuid, p_sha256 text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sha text := nullif(lower(btrim(p_sha256)), '');
begin
  if p_table is null or p_table not in ('movements', 'purchases') or p_id is null then
    raise exception 'Jadval yoki yozuv noto''g''ri' using errcode = '22023', hint = 'photo_hash_invalid';
  end if;
  if v_sha is not null and v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'Rasm xeshi noto''g''ri formatda (SHA-256, 64 ta hex belgi)'
      using errcode = '23514', hint = 'photo_sha256_invalid';
  end if;

  if p_table = 'movements' then
    update public.movements m
       set photo_sha256 = v_sha
     where m.id = p_id and m.deleted_at is null and m.photo_path is not null
       and m.photo_sha256 is distinct from v_sha;
    return exists (select 1 from public.movements m
                    where m.id = p_id and m.deleted_at is null and m.photo_path is not null
                      and m.photo_sha256 is not distinct from v_sha);
  end if;

  update public.purchases p
     set receipt_photo_sha256 = v_sha
   where p.id = p_id and p.deleted_at is null and p.receipt_photo_path is not null
     and p.receipt_photo_sha256 is distinct from v_sha;
  return exists (select 1 from public.purchases p
                  where p.id = p_id and p.deleted_at is null and p.receipt_photo_path is not null
                    and p.receipt_photo_sha256 is not distinct from v_sha);
end;
$$;

-- ----------------------------------------------------------------------------
-- B3. public.svc_alert_login_set(p_target_profile, p_actor) — admin-users Edge Function
--   (mavjud loginni almashtirganda). login_ozgardi alerti (ogohlantirish → direktor,
--   admin) + login egasiga xabar (outbox kind login_changed, profile_id = egasi).
--   p_actor boshqa firmaniki / yo'q — aktyor null. Qaytaradi: alert id.
-- ----------------------------------------------------------------------------
create function public.svc_alert_login_set(p_target_profile uuid, p_actor uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_t      public.profiles%rowtype;
  v_actor  record;
  v_alert  uuid;
  v_coname text;
begin
  select p.* into v_t from public.profiles p where p.id = p_target_profile and p.deleted_at is null;
  if p_target_profile is null or not found then
    raise exception 'Profil topilmadi' using errcode = 'P0002', hint = 'login_target_not_found';
  end if;
  select p.id, p.full_name, p.role::text as role into v_actor
    from public.profiles p
   where p.id = p_actor and p.company_id = v_t.company_id;
  select c.name into v_coname from public.companies c where c.id = v_t.company_id;

  insert into public.alerts (company_id, type, severity, details)
  values (v_t.company_id, 'login_ozgardi'::public.alert_type, 'ogohlantirish',
          jsonb_build_object(
            'target_profile_id', v_t.id,
            'target_name',       v_t.full_name,
            'target_role',       v_t.role,
            'actor_profile_id',  v_actor.id,
            'actor_name',        v_actor.full_name,
            'actor_role',        v_actor.role,
            'changed_at',        now()))
  returning id into v_alert;

  perform private.enqueue_workflow(v_t.company_id, 'login_changed', v_alert, v_t.id,
    jsonb_build_object(
      'alert_id',     v_alert,
      'profile_id',   v_t.id,
      'profile_name', v_t.full_name,
      'company_name', v_coname,
      'actor_name',   v_actor.full_name,
      'changed_at',   now()));
  return v_alert;
end;
$$;

-- ----------------------------------------------------------------------------
-- D4. public.merge_suppliers(p_keep, p_merge) — admin / super_admin. p_merge ning
--   tirik xaridlari p_keep ga o'tkaziladi, p_merge soft delete qilinadi; p_keep da
--   bo'sh bo'lgan tin / phone / note p_merge dan olinadi. Qaytaradi: o'tkazilgan
--   xaridlar soni. Hint'lar: auth_required, supplier_merge_forbidden (42501),
--   supplier_merge_invalid (22023), supplier_not_found (P0002).
-- ----------------------------------------------------------------------------
create function public.merge_suppliers(p_keep uuid, p_merge uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me    uuid := private.my_profile_id();
  v_keep  public.suppliers%rowtype;
  v_merge public.suppliers%rowtype;
  v_n     integer;
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  if not private.has_role('super_admin', 'admin') then
    raise exception 'Sotuvchilarni birlashtirish faqat administratorga ruxsat etilgan'
      using errcode = '42501', hint = 'supplier_merge_forbidden';
  end if;
  if p_keep is null or p_merge is null or p_keep = p_merge then
    raise exception 'Ikki xil sotuvchini tanlang' using errcode = '22023', hint = 'supplier_merge_invalid';
  end if;

  perform 1 from public.suppliers s where s.id in (p_keep, p_merge) order by s.id for update;
  select s.* into v_keep from public.suppliers s where s.id = p_keep and s.deleted_at is null;
  select s.* into v_merge from public.suppliers s where s.id = p_merge and s.deleted_at is null;
  if v_keep.id is null or v_merge.id is null
     or not private.can_access_company(v_keep.company_id)
     or v_merge.company_id <> v_keep.company_id then
    raise exception 'Sotuvchi topilmadi' using errcode = 'P0002', hint = 'supplier_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('terron.suppliers:' || v_keep.company_id::text, 0));
  perform set_config('terron.merge_rpc', 'on', true);

  update public.purchases p
     set supplier_id = p_keep
   where p.company_id = v_keep.company_id
     and p.supplier_id = p_merge
     and p.deleted_at is null;
  get diagnostics v_n = row_count;

  update public.suppliers set deleted_at = now() where id = p_merge;

  if (v_keep.tin is null and v_merge.tin is not null)
     or (v_keep.phone is null and v_merge.phone is not null)
     or (v_keep.note is null and v_merge.note is not null) then
    update public.suppliers
       set tin   = coalesce(tin, v_merge.tin),
           phone = coalesce(phone, v_merge.phone),
           note  = coalesce(note, v_merge.note)
     where id = p_keep;
  end if;

  perform set_config('terron.merge_rpc', 'off', true);
  return v_n;
end;
$$;

-- ============================================================================
-- 6. Bildirishnomalar
-- ============================================================================

-- Outbox turlari: + request_created, request_decided, request_approved, transfer_sent,
-- purchase_for_object (D2), login_changed (B3). ref_id — manba yozuv.
alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox drop constraint notification_outbox_kind_ref_check;
alter table public.notification_outbox
  add constraint notification_outbox_kind_check
    check (kind in ('alert', 'daily_report', 'alert_reminder', 'request_overdue', 'cash_statement', 'bug_report',
                    'request_created', 'request_decided', 'request_approved', 'transfer_sent',
                    'purchase_for_object', 'login_changed')),
  add constraint notification_outbox_kind_ref_check check (
    (kind in ('alert', 'alert_reminder') and alert_id is not null and report_date is null and profile_id is null
       and ref_id is null)
    or (kind in ('daily_report', 'request_overdue') and report_date is not null and alert_id is null
       and profile_id is null and ref_id is null)
    or (kind = 'cash_statement' and report_date is not null and alert_id is null and profile_id is not null
       and ref_id is null)
    or (kind = 'bug_report' and alert_id is null and report_date is null and profile_id is null and ref_id is null)
    or (kind in ('request_created', 'request_approved', 'transfer_sent', 'purchase_for_object')
       and alert_id is null and report_date is null and profile_id is null and ref_id is not null)
    or (kind in ('request_decided', 'login_changed')
       and alert_id is null and report_date is null and profile_id is not null and ref_id is not null)
  );

-- Bir martalik ish oqimi xabarlari (request_decided va login_changed — takrorlanishi mumkin)
create unique index notification_outbox_workflow_key
  on public.notification_outbox (kind, ref_id)
  where kind in ('request_created', 'request_approved', 'transfer_sent', 'purchase_for_object');

-- ----------------------------------------------------------------------------
-- D2. Ish oqimi triggerlari (payloadlar — docs/audit-fixes.md "Bildirishnoma payloadlari").
-- ----------------------------------------------------------------------------
create function private.request_payload(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'request_id',      r.id,
           'company_name',    c.name,
           'status',          r.status,
           'object_id',       r.object_id,
           'object_name',     o.name,
           'material_id',     r.material_id,
           'material_name',   m.name,
           'qty_input',       r.qty_input,
           'unit_input',      r.unit_input,
           'qty_base',        r.qty_base,
           'base_unit',       m.base_unit,
           'needed_by',       to_char(r.needed_by, 'YYYY-MM-DD'),
           'note',            r.note,
           'decision_note',   r.decision_note,
           'created_by_name', cb.full_name,
           'decided_by_name', db.full_name,
           'created_at',      r.created_at,
           'decided_at',      r.decided_at)
    from public.material_requests r
    join public.companies c on c.id = r.company_id
    left join public.objects o on o.company_id = r.company_id and o.id = r.object_id
    left join public.materials m on m.company_id = r.company_id and m.id = r.material_id
    left join public.profiles cb on cb.company_id = r.company_id and cb.id = r.created_by
    left join public.profiles db on db.company_id = r.company_id and db.id = r.decided_by
   where r.id = p_request_id
$$;

create function private.tg_requests_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  if new.deleted_at is not null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'kutilmoqda' then
      perform private.enqueue_workflow(new.company_id, 'request_created', new.id, null,
                                       private.request_payload(new.id));
    end if;
    return null;
  end if;

  if new.status is distinct from old.status and new.status in ('tasdiqlandi', 'rad') then
    v_payload := private.request_payload(new.id);
    if new.created_by is not null and exists (
         select 1 from public.profiles p where p.company_id = new.company_id and p.id = new.created_by) then
      perform private.enqueue_workflow(new.company_id, 'request_decided', new.id, new.created_by, v_payload);
    end if;
    if new.status = 'tasdiqlandi' then
      perform private.enqueue_workflow(new.company_id, 'request_approved', new.id, null, v_payload);
    end if;
  end if;
  return null;
end;
$$;

create trigger zz_workflow_ins after insert on public.material_requests
  for each row execute function private.tg_requests_workflow();
create trigger zz_workflow_upd after update on public.material_requests
  for each row
  when (old.status is distinct from new.status)
  execute function private.tg_requests_workflow();

create function private.tg_transfers_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null or new.status <> 'yuborildi' then
    return null;
  end if;
  perform private.enqueue_workflow(new.company_id, 'transfer_sent', new.id, null,
    (select jsonb_build_object(
              'transfer_id',      new.id,
              'company_name',     c.name,
              'from_object_id',   new.from_object_id,
              'from_object_name', fo.name,
              'to_object_id',     new.to_object_id,
              'to_object_name',   tob.name,
              'material_id',      new.material_id,
              'material_name',    m.name,
              'qty_input',        new.qty_input,
              'unit_input',       new.unit_input,
              'qty_base',         new.qty_base,
              'base_unit',        m.base_unit,
              'note',             new.note,
              'sent_by_name',     pr.full_name,
              'created_at',       new.created_at)
       from public.companies c
       left join public.objects fo on fo.company_id = new.company_id and fo.id = new.from_object_id
       left join public.objects tob on tob.company_id = new.company_id and tob.id = new.to_object_id
       left join public.materials m on m.company_id = new.company_id and m.id = new.material_id
       left join public.profiles pr on pr.id = new.created_by
      where c.id = new.company_id));
  return null;
end;
$$;

create trigger zz_workflow after insert on public.transfers
  for each row execute function private.tg_transfers_workflow();

create function private.tg_purchases_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null then
    return null;
  end if;
  perform private.enqueue_workflow(new.company_id, 'purchase_for_object', new.id, null,
    (select jsonb_build_object(
              'purchase_id',   new.id,
              'company_name',  c.name,
              'object_id',     new.object_id,
              'object_name',   o.name,
              'material_id',   new.material_id,
              'material_name', m.name,
              'qty_input',     new.qty_input,
              'unit_input',    new.unit_input,
              'qty_base',      new.qty_base,
              'base_unit',     m.base_unit,
              'buyer_id',      new.buyer_id,
              'buyer_name',    pr.full_name,
              'supplier_name', s.name,
              'purchased_at',  new.purchased_at)
       from public.companies c
       left join public.objects o on o.company_id = new.company_id and o.id = new.object_id
       left join public.materials m on m.company_id = new.company_id and m.id = new.material_id
       left join public.profiles pr on pr.company_id = new.company_id and pr.id = new.buyer_id
       left join public.suppliers s on s.company_id = new.company_id and s.id = new.supplier_id
      where c.id = new.company_id));
  return null;
end;
$$;

create trigger zz_workflow after insert on public.purchases
  for each row execute function private.tg_purchases_workflow();

-- ----------------------------------------------------------------------------
-- Qabul qiluvchilar (Batch 11 versiyasi) + yangi turlar; bloklangan chat
-- (telegram_blocked_at) — hech qachon; ish oqimi turlari — notify_workflow = true.
--   request_created     → firma admin(lar)i;
--   request_decided     → so'rov muallifi (profile_id);
--   request_approved    → taminotchi(lar);
--   transfer_sent       → qabul qiluvchi obyektning prorab / omborchi a'zolari;
--   purchase_for_object → obyektning omborchi / prorab a'zolari, xaridordan tashqari;
--   login_changed       → login egasi (profile_id).
-- ----------------------------------------------------------------------------
create or replace function public.svc_outbox_recipients(p_outbox_id uuid)
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
  ),
  wf as (
    -- ish oqimi: obyekt / xaridor (payload biz yozgan — uuid formati kafolatlangan)
    select case o.kind
             when 'transfer_sent'       then (o.payload ->> 'to_object_id')::uuid
             when 'purchase_for_object' then (o.payload ->> 'object_id')::uuid
           end as object_id,
           case when o.kind = 'purchase_for_object' then (o.payload ->> 'buyer_id')::uuid end as buyer_id
      from o
     where o.kind in ('transfer_sent', 'purchase_for_object')
  )
  select distinct on (p.telegram_chat_id)
         p.id, p.telegram_chat_id, p.role::text
    from o
    join public.companies c on c.id = o.company_id
    join public.profiles p
      on p.company_id = o.company_id
      or (o.kind = 'bug_report' and p.role = 'super_admin')
    join public.companies pc on pc.id = p.company_id
   where c.is_active
     and c.deleted_at is null
     and pc.is_active
     and pc.deleted_at is null
     and p.is_active
     and p.deleted_at is null
     and p.telegram_chat_id is not null
     and p.telegram_blocked_at is null
     and (o.kind not in ('request_created', 'request_decided', 'request_approved', 'transfer_sent',
                         'purchase_for_object')
          or p.notify_workflow)
     and case o.kind
           when 'cash_statement'      then p.id = o.profile_id
           when 'login_changed'       then p.id = o.profile_id
           when 'request_decided'     then p.id = o.profile_id
           when 'request_overdue'     then p.company_id = o.company_id and p.role in ('taminotchi', 'admin')
           when 'bug_report'          then p.role = 'super_admin'
                                           or (p.company_id = o.company_id and p.role = 'admin')
           when 'request_created'     then p.company_id = o.company_id and p.role = 'admin'
           when 'request_approved'    then p.company_id = o.company_id and p.role = 'taminotchi'
           when 'transfer_sent'       then p.company_id = o.company_id
                                           and p.role in ('prorab', 'omborchi')
                                           and exists (select 1 from wf
                                                         join public.object_members om
                                                           on om.object_id = wf.object_id
                                                        where om.profile_id = p.id and om.deleted_at is null)
           when 'purchase_for_object' then p.company_id = o.company_id
                                           and p.role in ('prorab', 'omborchi')
                                           and exists (select 1 from wf
                                                         join public.object_members om
                                                           on om.object_id = wf.object_id
                                                        where om.profile_id = p.id and om.deleted_at is null
                                                          and p.id is distinct from wf.buyer_id)
           else p.company_id = o.company_id
                and (p.role in ('direktor', 'admin')
                     or (p.role = 'prorab' and exists (
                           select 1
                             from tr
                             join public.object_members om
                               on om.object_id in (tr.from_object_id, tr.to_object_id)
                            where om.profile_id = p.id
                              and om.deleted_at is null)))
         end
   order by p.telegram_chat_id, p.role, p.id;
$$;

-- Batch 6 RPC (eski tg-dispatch uchun) — bloklangan chatlarsiz.
create or replace function public.svc_notification_recipients(p_company_id uuid)
returns table (profile_id uuid, chat_id bigint, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (p.telegram_chat_id)
         p.id, p.telegram_chat_id, p.role::text
    from public.profiles p
    join public.companies c on c.id = p.company_id
   where p.company_id = p_company_id
     and c.is_active
     and c.deleted_at is null
     and p.is_active
     and p.deleted_at is null
     and p.role in ('direktor', 'admin')
     and p.telegram_chat_id is not null
     and p.telegram_blocked_at is null
   order by p.telegram_chat_id, p.role, p.id;
$$;

-- ----------------------------------------------------------------------------
-- C. Navbatdan olish (Batch 6 versiyasi) +:
--   (1) daily_report / request_overdue / alert_reminder / cash_statement qatorlari
--       36 soatdan eski bo'lsa (pending / sending) → failed, last_error = 'expired';
--   (2) tinch soatlar: alert va alert_reminder (severity jiddiy emas) firma tinch
--       oynasida bo'lsa — next_attempt_at := oyna oxiri (Toshkent), olinmaydi.
-- ----------------------------------------------------------------------------
create or replace function public.svc_claim_notifications(p_limit integer default 20)
returns setof public.notification_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_outbox o
     set status     = 'failed',
         last_error = 'expired'
   where o.status in ('pending', 'sending')
     and o.kind in ('daily_report', 'request_overdue', 'alert_reminder', 'cash_statement')
     and o.created_at < now() - interval '36 hours';

  update public.notification_outbox o
     set status     = 'failed',
         last_error = coalesce(o.last_error, 'stuck_in_sending')
   where o.status = 'sending'
     and o.updated_at < now() - interval '10 minutes'
     and o.attempts >= 6;

  update public.notification_outbox o
     set next_attempt_at = q.until
    from (
      select x.id, private.quiet_until(c.quiet_hours_start, c.quiet_hours_end, now()) as until
        from public.notification_outbox x
        join public.companies c on c.id = x.company_id
       where x.status = 'pending'
         and x.next_attempt_at <= now()
         and x.kind in ('alert', 'alert_reminder')
         and coalesce(x.payload ->> 'severity', '') <> 'jiddiy'
    ) q
   where o.id = q.id
     and q.until is not null;

  return query
  with c as (
    select o.id
      from public.notification_outbox o
     where (o.status = 'pending' and o.next_attempt_at <= now())
        or (o.status = 'sending' and o.updated_at < now() - interval '10 minutes')
     order by o.next_attempt_at, o.created_at, o.id
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
       for update skip locked
  )
  update public.notification_outbox o
     set status   = 'sending',
         attempts = o.attempts + 1
    from c
   where o.id = c.id
  returning o.*;
end;
$$;

-- ----------------------------------------------------------------------------
-- C. svc_complete_notification (Batch 6) + p_blocked_chat_ids (ixtiyoriy, oxirida):
--   shu chatlar profillariga telegram_blocked_at = now() (bot bloklangan / chat yo'q).
--   Eski chaqiruvlar (6 argument) o'zgarishsiz ishlaydi. retry_after — urinish
--   qaytariladi (claim'da qo'shilgan +1 olinadi).
-- ----------------------------------------------------------------------------
drop function public.svc_complete_notification(uuid, boolean, bigint[], text, integer, boolean);

create function public.svc_complete_notification(
  p_id               uuid,
  p_ok               boolean,
  p_delivered        bigint[] default '{}',
  p_error            text default null,
  p_retry_after_sec  integer default null,
  p_final            boolean default false,
  p_blocked_chat_ids bigint[] default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.notification_outbox%rowtype;
  v_error     text := left(nullif(btrim(coalesce(p_error, '')), ''), 1000);
  v_delivered bigint[];
  v_status    text;
  v_next      timestamptz;
  v_attempts  integer;
begin
  if p_blocked_chat_ids is not null and cardinality(p_blocked_chat_ids) > 0 then
    update public.profiles p
       set telegram_blocked_at = now()
     where p.telegram_chat_id = any (p_blocked_chat_ids)
       and p.telegram_blocked_at is null;
  end if;

  select o.* into v_row
    from public.notification_outbox o
   where o.id = p_id
     for update;
  if not found then
    return null;
  end if;
  if v_row.status <> 'sending' then
    return v_row.status;
  end if;

  select coalesce(array_agg(distinct x order by x), '{}')
    into v_delivered
    from unnest(v_row.delivered_chat_ids || coalesce(p_delivered, '{}')) as x
   where x is not null;

  v_attempts := v_row.attempts;
  v_next     := v_row.next_attempt_at;
  if coalesce(p_ok, false) then
    v_status := 'sent';
  elsif coalesce(p_final, false) then
    v_status := 'failed';
    v_error  := coalesce(v_error, 'permanent_error');
  elsif p_retry_after_sec is not null and p_retry_after_sec > 0 then
    v_status   := 'pending';
    v_attempts := greatest(v_row.attempts - 1, 0);
    v_next     := now() + make_interval(secs => least(p_retry_after_sec, 3600));
    v_error    := coalesce(v_error, 'rate_limited');
  elsif v_row.attempts >= 6 then
    v_status := 'failed';
    v_error  := coalesce(v_error, 'unknown_error');
  else
    v_status := 'pending';
    v_next   := now() + make_interval(mins => power(2, v_row.attempts)::integer);
    v_error  := coalesce(v_error, 'unknown_error');
  end if;

  update public.notification_outbox o
     set status             = v_status,
         attempts           = v_attempts,
         next_attempt_at    = v_next,
         delivered_chat_ids = v_delivered,
         sent_count         = cardinality(v_delivered),
         sent_at            = case when v_status = 'sent' then now() else o.sent_at end,
         last_error         = v_error
   where o.id = p_id;
  return v_status;
end;
$$;

-- C. Chat bloklangan / qayta ochilgan (tg-bot / tg-dispatch). Qaytaradi: profillar soni.
create function public.svc_mark_chat_blocked(p_chat_id bigint, p_blocked boolean)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_chat_id is null then
    return 0;
  end if;
  update public.profiles p
     set telegram_blocked_at = case when coalesce(p_blocked, false) then now() end
   where p.telegram_chat_id = p_chat_id
     and (case when coalesce(p_blocked, false) then p.telegram_blocked_at is null
               else p.telegram_blocked_at is not null end);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- C. pg_net: tg-dispatch javobini 60 s kutish (Batch 6 versiyasi, faqat timeout).
create or replace function private.wake_dispatch()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
  v_id     bigint;
begin
  if coalesce(current_setting('terron.dispatch_woken', true), '') = '1' then
    return null;
  end if;

  begin
    select s.value into v_url from private.app_settings s where s.key = 'dispatch_url';
    select ds.decrypted_secret into v_secret
      from vault.decrypted_secrets ds
     where ds.name = 'tg_dispatch_secret'
     limit 1;
    if v_url is null or v_secret is null or v_secret = '' then
      raise warning 'tg-dispatch uyg''otilmadi: dispatch_url yoki tg_dispatch_secret sozlanmagan';
      return null;
    end if;

    v_id := net.http_post(
      url                  := v_url,
      body                 := '{}'::jsonb,
      headers              := jsonb_build_object(
                                'Content-Type', 'application/json',
                                'x-dispatch-secret', v_secret),
      timeout_milliseconds := 60000
    );
  exception when others then
    raise warning 'tg-dispatch uyg''otilmadi: % (%)', sqlerrm, sqlstate;
    return null;
  end;

  perform set_config('terron.dispatch_woken', '1', true);
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- C. public.notification_health() — admin / super_admin (o'z firmasi):
--   {last_sent_at, stuck_pending_count, failed_7d_count,
--    last_errors: [{id, kind, status, last_error, attempts, updated_at}] (5 ta),
--    blocked_profiles: [{profile_id, full_name, role, telegram_blocked_at}]}.
--   stuck_pending_count — pending va next_attempt_at 15 daqiqadan oldin o'tgan,
--   yoki sending va 10 daqiqadan ko'p yangilanmagan.
-- ----------------------------------------------------------------------------
create function private.outbox_stuck_count(p_company_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.notification_outbox o
   where o.company_id = p_company_id
     and ((o.status = 'pending' and o.next_attempt_at < now() - interval '15 minutes')
          or (o.status = 'sending' and o.updated_at < now() - interval '10 minutes'))
$$;

create function private.outbox_failed_7d_count(p_company_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.notification_outbox o
   where o.company_id = p_company_id
     and o.status = 'failed'
     and o.updated_at >= now() - interval '7 days'
$$;

create function public.notification_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.my_company_id();
begin
  if v_company is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  if not private.has_role('super_admin', 'admin') then
    raise exception 'Bildirishnomalar holatini faqat administrator ko''radi'
      using errcode = '42501', hint = 'notification_health_forbidden';
  end if;

  return jsonb_build_object(
    'last_sent_at',        (select max(o.sent_at) from public.notification_outbox o
                             where o.company_id = v_company and o.status = 'sent'),
    'stuck_pending_count', private.outbox_stuck_count(v_company),
    'failed_7d_count',     private.outbox_failed_7d_count(v_company),
    'last_errors',         coalesce((
                             select jsonb_agg(jsonb_build_object(
                                      'id', x.id, 'kind', x.kind, 'status', x.status,
                                      'last_error', x.last_error, 'attempts', x.attempts,
                                      'updated_at', x.updated_at) order by x.updated_at desc, x.id)
                               from (select o.* from public.notification_outbox o
                                      where o.company_id = v_company and o.last_error is not null
                                      order by o.updated_at desc, o.id
                                      limit 5) x), '[]'::jsonb),
    'blocked_profiles',    coalesce((
                             select jsonb_agg(jsonb_build_object(
                                      'profile_id', p.id, 'full_name', p.full_name, 'role', p.role,
                                      'telegram_blocked_at', p.telegram_blocked_at)
                                      order by p.telegram_blocked_at desc, p.id)
                               from public.profiles p
                              where p.company_id = v_company
                                and p.deleted_at is null
                                and p.telegram_blocked_at is not null), '[]'::jsonb));
end;
$$;

-- ----------------------------------------------------------------------------
-- Kunlik hisobot (Batch 12 versiyasi) +:
--   alerts_new / alerts_by_type — private.alert_counts_as_new (A11);
--   backdated_count (A9) — oraliqda yaratilgan, sanasi (occurred_at / purchased_at)
--     oraliq boshidan oldin bo'lgan tirik harakat + xaridlar;
--   manual_closed_count (B2) — oraliqda foydalanuvchi yopgan alertlar;
--   stuck_pending_count, failed_7d_count (C) — joriy holat;
--   cash_outstanding_sum, cash_owed_to_staff_sum (A10) — musbat balanslar yig'indisi
--     va manfiy balanslar yig'indisi (musbat son), matn.
-- ----------------------------------------------------------------------------
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
  v_back_mv  integer;
  v_back_p   integer;
  v_manual   integer;
  v_pos      numeric(18,2);
  v_neg      numeric(18,2);
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

  select count(*) into v_back_mv
    from public.movements m
   where m.company_id = p_company_id
     and m.deleted_at is null
     and m.created_at >= v_from and m.created_at < v_to
     and m.occurred_at < v_from;
  select count(*) into v_back_p
    from public.purchases p
   where p.company_id = p_company_id
     and p.deleted_at is null
     and p.created_at >= v_from and p.created_at < v_to
     and p.purchased_at < v_from;

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

  select coalesce(jsonb_object_agg(x.type, x.n), '{}'::jsonb)
    into v_by_type
    from (
      select a.type::text as type, count(*)::integer as n
        from public.alerts a
       where a.company_id = p_company_id
         and a.deleted_at is null
         and a.created_at >= v_from and a.created_at < v_to
         and private.alert_counts_as_new(a.type::text, a.severity::text)
       group by a.type
    ) x;
  v_new := private.alerts_new_count(p_company_id, v_from, v_to, null);

  select count(*) filter (where a.type::text = 'ozi_qabul_qilgan'),
         count(*) filter (where a.type::text = 'yozuv_ochirildi'),
         count(*) filter (where a.type::text = 'yozuv_tiklandi')
    into v_self, v_deleted, v_restored
    from public.alerts a
   where a.company_id = p_company_id
     and a.deleted_at is null
     and a.created_at >= v_from and a.created_at < v_to;

  select count(*) into v_manual
    from public.alerts a
   where a.company_id = p_company_id
     and a.deleted_at is null
     and a.status = 'yopildi'
     and a.closed_at >= v_from and a.closed_at < v_to
     and a.details ? 'manual_closed_at';

  select count(*) into v_failed
    from public.notification_outbox o
   where o.company_id = p_company_id
     and o.status = 'failed'
     and o.updated_at >= v_from and o.updated_at < v_to;

  select coalesce(sum(y.b) filter (where y.b > 0), 0), coalesce(-sum(y.b) filter (where y.b < 0), 0)
    into v_pos, v_neg
    from (
      select x.pid, sum(x.amt) as b
        from (
          select ca.recipient_id as pid,
                 case when ca.kind = 'berildi' then ca.amount else -ca.amount end as amt
            from public.cash_advances ca
           where ca.company_id = p_company_id and ca.deleted_at is null
          union all
          select p.buyer_id, -p.total_amount
            from public.purchases p
           where p.company_id = p_company_id and p.deleted_at is null
        ) x
       group by x.pid
    ) y;

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
    'geo_unavailable_count', v_geo_mv_u + v_geo_p_u,
    'backdated_count',     v_back_mv + v_back_p,
    'manual_closed_count', v_manual,
    'stuck_pending_count', private.outbox_stuck_count(p_company_id),
    'failed_7d_count',     private.outbox_failed_7d_count(p_company_id),
    'cash_outstanding_sum',   v_pos::text,
    'cash_owed_to_staff_sum', v_neg::text
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- dashboard_summary (Batch 12 versiyasi) +:
--   alerts_new_in_period — private.alerts_new_count (A11, kunlik hisobot bilan bir xil ta'rif);
--   cash_outstanding_sum — Σ musbat balans; cash_owed_to_staff_sum — Σ manfiy balans
--   (musbat son). cash_on_hand_total (sof) — moslik uchun qoldi.
-- ----------------------------------------------------------------------------
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
  v_cash_pos  numeric(18,2);
  v_cash_neg  numeric(18,2);
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

  select coalesce(sum(cb.balance), 0),
         coalesce(sum(cb.balance) filter (where cb.balance > 0), 0),
         coalesce(-sum(cb.balance) filter (where cb.balance < 0), 0)
    into v_cash_hand, v_cash_pos, v_cash_neg
    from public.cash_balances cb
   where cb.company_id = v_company;

  select count(*) filter (where a.status in ('yangi', 'korildi')),
         count(*) filter (where a.status in ('yangi', 'korildi') and a.severity = 'jiddiy')
    into v_al_open, v_al_ser
    from public.alerts a
   where a.company_id = v_company
     and a.deleted_at is null
     and a.severity <> 'belgi'
     and a.status in ('yangi', 'korildi')
     and (p_object_id is null or a.object_id = p_object_id);
  v_al_new := coalesce(private.alerts_new_count(v_company, v_period.o_start, v_period.o_end, p_object_id), 0);

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
    'cash_outstanding_sum',       v_cash_pos::text,
    'cash_owed_to_staff_sum',     v_cash_neg::text,
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

-- C. cron.job_run_details — 7 kundan eski yozuvlar har kuni tozalanadi (03:30 UTC).
create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'terron-cron-purge') then
    perform cron.unschedule('terron-cron-purge');
  end if;
  perform cron.schedule('terron-cron-purge', '30 3 * * *',
    'delete from cron.job_run_details where end_time < now() - interval ''7 days''');
end $$;

-- ============================================================================
-- 7. RLS
-- ============================================================================

-- A4. movements INSERT — hamma rol uchun faqat kirim / chiqim (transfer_*,
-- inventory_adjust — faqat security definer RPC'lar).
drop policy movements_insert on public.movements;
create policy movements_insert on public.movements
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
    and type in ('kirim', 'chiqim')
    and (
      (select private.has_role('super_admin', 'admin'))
      or ((select private.has_role('prorab', 'omborchi')) and private.can_access_object(object_id))
    )
  );

-- B13. Ko'r-ko'rona sanash: tekshiruvchi o'tkazma, so'rov va smetani ko'rmaydi
-- (is_company_wide_ops — is_company_wide minus tekshiruvchi). estimate_items —
-- estimates RLS'i orqali.
drop policy transfers_select on public.transfers;
create policy transfers_select on public.transfers
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
    and (
      (select private.is_company_wide_ops())
      or (
        (select private.has_role('prorab', 'omborchi'))
        and (from_object_id in (select private.my_object_ids())
             or to_object_id in (select private.my_object_ids()))
      )
    )
  );

drop policy material_requests_select on public.material_requests;
create policy material_requests_select on public.material_requests
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor', 'taminotchi')))
    and (
      (select private.is_company_wide_ops())
      or ((select private.has_role('prorab')) and object_id in (select private.my_object_ids()))
    )
  );

drop policy estimates_select on public.estimates;
create policy estimates_select on public.estimates
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter')))
    and (
      (select private.is_company_wide_ops())
      or ((select private.has_role('prorab')) and object_id in (select private.my_object_ids()))
    )
  );

-- D3. Obyekt alertlari prorab / omborchiga (faqat o'qish): a'zo obyektlarning
-- normadan_oshish, manfiy_qoldiq, otkazma_farqi, smetadan_ortiq_sorov, smetasiz_chiqim
-- turlari. Firibgarlik turlari (xarid ≠ qabul, narx, o'chirish, ...) — faqat rahbariyat.
create policy alerts_select_site on public.alerts
  for select to authenticated
  using (
    company_id = (select private.my_company_id())
    and deleted_at is null
    and (select private.has_role('prorab', 'omborchi'))
    and object_id in (select private.my_object_ids())
    and type::text in ('normadan_oshish', 'manfiy_qoldiq', 'otkazma_farqi', 'smetadan_ortiq_sorov', 'smetasiz_chiqim')
  );

-- ----------------------------------------------------------------------------
-- Profillar: admin / super_admin — firma profillari to'liq (o'chirilganlar ham);
-- boshqa rollar — faqat o'z profili (to'liq). Boshqalarning id, ism, rol, faolligi —
-- public.profile_directory orqali (telefon, Telegram id, auth bog'lanishisiz).
-- ----------------------------------------------------------------------------
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
    and ((select private.has_role('super_admin', 'admin')) or id = (select private.my_profile_id()))
  );

-- D2. O'z profilida notify_workflow (b_profiles_protect boshqa ustunlarni rad etadi).
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select private.my_profile_id()))
  with check (id = (select private.my_profile_id()));
grant update (notify_workflow) on table public.profiles to authenticated;

-- Definer view (egasi postgres, BYPASSRLS) — o'z firmasi (super_admin — hammasi),
-- o'chirilganlar ham (tarixdagi ismlar uchun). Faqat id, firma, ism, rol, faollik.
create view public.profile_directory
with (security_barrier = true)
as
select p.id, p.company_id, p.full_name, p.role, p.is_active
  from public.profiles p
 where (select private.is_super_admin())
    or p.company_id = (select private.my_company_id());

comment on view public.profile_directory is
  'Firma xodimlari ro''yxati (id, ism, rol, faollik) — telefon va Telegram ma''lumotlarisiz. '
  'Admin bo''lmagan rollar boshqa profillarning ismini shu yerdan oladi.';

revoke all on public.profile_directory from public, anon, authenticated, service_role;
grant select on public.profile_directory to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Ism ko'rsatadigan invoker funksiyalar — profiles o'rniga profile_directory
-- (mantiq o'zgarmagan): open_purchases (Batch 5), spend_breakdown (Batch 9),
-- audit_record_label, audit_feed, deleted_records (Batch 10).
-- ----------------------------------------------------------------------------
create or replace function public.open_purchases(p_object_id uuid, p_material_id uuid)
returns table (
  id                  uuid,
  purchased_at        timestamptz,
  buyer_id            uuid,
  buyer_name          text,
  qty_base            numeric,
  received_qty_base   numeric,
  remaining_qty_base  numeric,
  unit_input          text,
  unit_variant        text,
  qty_input           numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id,
         p.purchased_at,
         p.buyer_id,
         pr.full_name,
         p.qty_base,
         r.received_qty_base,
         r.remaining_qty_base,
         p.unit_input,
         p.unit_variant,
         p.qty_input
    from public.purchase_receipts r
    join public.purchases p on p.company_id = r.company_id and p.id = r.purchase_id
    left join public.profile_directory pr on pr.company_id = p.company_id and pr.id = p.buyer_id
   where r.object_id = p_object_id
     and r.material_id = p_material_id
     and r.purchased_at >= now() - interval '14 days'
     and r.remaining_qty_base > 0
   order by p.purchased_at desc, p.created_at desc, p.id;
$$;

create or replace function public.spend_breakdown(
  p_from      date,
  p_to        date,
  p_object_id uuid default null,
  p_group     text default 'material'
)
returns table (key uuid, label text, purchases_sum text, purchases_count integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_period  record;
  v_company uuid;
begin
  if p_group is null or p_group not in ('material', 'object', 'buyer', 'supplier') then
    raise exception 'Guruhlash turi noto''g''ri: material, object, buyer yoki supplier bo''lishi kerak'
      using errcode = '22023', hint = 'report_group_invalid';
  end if;
  select * into v_period from private.report_period(p_from, p_to);
  v_company := private.report_company(p_object_id);

  return query
  select g.g_key,
         case p_group
           when 'material' then (select mt.name from public.materials mt
                                  where mt.company_id = v_company and mt.id = g.g_key)
           when 'object'   then (select o.name from public.objects o
                                  where o.company_id = v_company and o.id = g.g_key)
           when 'buyer'    then (select pr.full_name from public.profile_directory pr
                                  where pr.company_id = v_company and pr.id = g.g_key)
           else                 (select s.name from public.suppliers s
                                  where s.company_id = v_company and s.id = g.g_key)
         end::text,
         g.g_sum::numeric(18,2)::text,
         g.g_count
    from (
      select case p_group
               when 'material' then p.material_id
               when 'object'   then p.object_id
               when 'buyer'    then p.buyer_id
               else                 p.supplier_id
             end                  as g_key,
             sum(p.total_amount)  as g_sum,
             count(*)::integer    as g_count
        from public.purchases p
       where p.company_id = v_company
         and p.deleted_at is null
         and p.purchased_at >= v_period.o_start and p.purchased_at < v_period.o_end
         and (p_object_id is null or p.object_id = p_object_id)
       group by 1
    ) g
   order by g.g_sum desc, g.g_count desc, g.g_key nulls last;
end;
$$;

create or replace function private.audit_record_label(
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
    return (select p.full_name from public.profile_directory p where p.id = p_record_id);
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
                (select p.full_name from public.profile_directory p
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
                (select p.full_name from public.profile_directory p
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

create or replace function public.audit_feed(
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
  v_co    uuid := case when private.is_super_admin() then null else private.my_company_id() end;
begin
  select r.o_start, r.o_end into v_start, v_end from private.report_period(p_from, p_to) r;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'Sahifa hajmi 1 dan 200 gacha bo''lishi kerak'
      using errcode = '22023', hint = 'history_limit_invalid';
  end if;
  if v_co is null and not private.is_super_admin() then
    return;
  end if;

  return query execute
    'select a.id, a.created_at, a.table_name, a.record_id, a.action, a.actor_profile_id,
            pr.full_name,
            a.device, a.changed_fields, a.old_data, a.new_data,
            private.audit_record_label(a.table_name, a.record_id, a.new_data, a.old_data)
       from public.audit_log a
       left join public.profile_directory pr on pr.id = a.actor_profile_id
      where a.created_at >= $1 and a.created_at < $2'
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

create or replace function public.deleted_records(
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
    left join public.profile_directory pr on pr.id = la.actor_profile_id
   order by d.deleted_at desc, d.table_name, d.record_id
   limit p_limit offset p_offset;
end;
$$;

-- ============================================================================
-- 8. Ruxsatlar
-- ============================================================================

-- Trigger va ichki qoida funksiyalari — hech kimga
revoke execute on function
  private.alert_counts_as_new(text, text),
  private.quiet_until(time, time, timestamptz),
  private.stock_at(uuid, uuid, uuid, timestamptz),
  private.lock_stock(uuid, uuid),
  private.enqueue_workflow(uuid, text, uuid, uuid, jsonb),
  private.tg_movements_rpc_guard(),
  private.tg_check_qty(),
  private.tg_photo_hash_client(),
  private.tg_profiles_protect(),
  private.tg_alerts_close_note(),
  private.tg_inventory_items_counted_at(),
  private.receipt_candidates(uuid),
  private.evaluate_negative_stock(uuid, uuid, uuid, uuid, boolean),
  private.reevaluate_open_requests(uuid, uuid, uuid, uuid),
  private.tg_posted_change_alert(),
  private.tg_companies_settings_alert(),
  private.tg_cash_advances_flag(),
  private.evaluate_seller_tin(uuid),
  private.tg_purchases_seller_tin(),
  private.request_payload(uuid),
  private.tg_requests_workflow(),
  private.tg_transfers_workflow(),
  private.tg_purchases_workflow(),
  private.outbox_stuck_count(uuid),
  private.outbox_failed_7d_count(uuid)
from public, anon, authenticated, service_role;

-- dashboard_summary (invoker) chaqiradi
revoke execute on function private.alerts_new_count(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function private.alerts_new_count(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function private.alert_counts_as_new(text, text) to authenticated;

-- Foydalanuvchi RPC'lari
revoke execute on function
  public.correct_entry(text, uuid, numeric, uuid, numeric, text),
  public.merge_suppliers(uuid, uuid),
  public.notification_health()
from public, anon;
grant execute on function
  public.correct_entry(text, uuid, numeric, uuid, numeric, text),
  public.merge_suppliers(uuid, uuid),
  public.notification_health()
to authenticated;

-- Service RPC'lar — faqat service_role
revoke execute on function
  public.svc_set_photo_hash(text, uuid, text),
  public.svc_alert_login_set(uuid, uuid),
  public.svc_mark_chat_blocked(bigint, boolean),
  public.svc_complete_notification(uuid, boolean, bigint[], text, integer, boolean, bigint[]),
  public.svc_outbox_recipients(uuid),
  public.svc_notification_recipients(uuid),
  public.svc_claim_notifications(integer)
from public, anon, authenticated;
grant execute on function
  public.svc_set_photo_hash(text, uuid, text),
  public.svc_alert_login_set(uuid, uuid),
  public.svc_mark_chat_blocked(bigint, boolean),
  public.svc_complete_notification(uuid, boolean, bigint[], text, integer, boolean, bigint[]),
  public.svc_outbox_recipients(uuid),
  public.svc_notification_recipients(uuid),
  public.svc_claim_notifications(integer)
to service_role;
