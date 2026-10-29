-- ============================================================================
-- Audit (3-tur) — baza tuzatishlari. Ro'yxat: docs/audit-fixes.md → "3-tur".
-- Oldingi migratsiyalar o'zgartirilmaydi; funksiyalar create or replace bilan,
-- o'zgarmagan qismlar oxirgi ta'riflardan aynan ko'chirilgan.
--
--   D1  Yangi firma — materiallar shabloni avtomatik (AFTER INSERT companies).
--   D2  public.create_company(name, admin_full_name, admin_phone) — faqat super_admin;
--       private.normalize_phone (E.164, _shared/phone.ts bilan bir xil).
--   D3  photos_select — ko'r sanovchi (tekshiruvchi) boshqalarning rasmini ko'rmaydi.
--   D4  Nazorat bayroqlari o'zgarsa (materials.outside_estimate / photo_required,
--       expense_categories.monthly_limit / photo_required / is_active) — sozlama_ozgardi.
--   D5  Haftalik podotchet hisoboti — faqat payment_source = 'podotchet' xaridlar.
--   D6  Qoida 1: kutish greatest(purchased_at, created_at) + 24 soat; tiklashda zanjir
--       rejimi; jiddiy — faqat chegara > 0 bo'lsa.
--   D7  cash_balances — ko'r sanovchi qo'riqchisi qaytarildi.
--   D8  Kesh topilmasa receipt_total / seller_tin foydalanuvchi sessiyasida null.
--   D9  xarajat_limiti so'rovlari — qisman indeks predikati (details ? 'category_id').
--   D10 Kunlik hisobot — har firma alohida (xato boshqalarni to'xtatmaydi).
--   D11 Xarajat to'lovchisi almashsa — payment_source qayta aniqlanadi.
--   D12 evaluate_duplicate — muallif bo'yicha advisory qulf.
--   D13 Qoida 3 — 0 so'mlik xaridlar o'rtachaga kirmaydi.
--   D14 check_purchase_price(p_material_id, p_price_per_base, p_purchased_at default now()).
--   D15 purchase_receipts.unlinked_qty_base — bog'lanmagan nomzod kirimlar.
--   D16 public.open_purchases_for_my_objects() — Mini App: obyektlarim bo'yicha ochiq xaridlar.
--   D17 o'tkazib yuborildi (docs/audit-fixes.md → "3-tur": LRV smetalarida 6 xonali raqamli
--       kod — haqiqiy resurs shifri).
--   D18 public.svc_phone_in_other_company(company_id, phone) — faqat service_role.
-- ============================================================================

-- ============================================================================
-- D1. Yangi firma — materiallar shabloni (zz_expense_categories kabi).
--   apply_material_template idempotent (nom bo'yicha), foydalanuvchi sessiyasida
--   faqat super_admin (firma qo'shish ham faqat super_admin — companies_insert).
-- ============================================================================
create function private.tg_companies_material_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null then
    perform private.apply_material_template(new.id);
  end if;
  return null;
end;
$$;
revoke execute on function private.tg_companies_material_template() from public, anon, authenticated;
create trigger zz_material_template after insert on public.companies
  for each row execute function private.tg_companies_material_template();

-- ============================================================================
-- D2. Firma yaratish (super_admin). Telefon — E.164 (supabase/functions/_shared/phone.ts
--   normalizePhone bilan bir xil qoida). Triggerlar: materiallar shabloni (D1) va
--   6 ta standart xarajat turi (zz_expense_categories).
-- ============================================================================
create function private.normalize_phone(p_input text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_s    text;
  v_intl boolean := false;
  v_d    text;
begin
  if p_input is null then
    return null;
  end if;
  v_s := regexp_replace(btrim(p_input), '[[:space:]().-]', '', 'g');
  if v_s = '' then
    return null;
  end if;
  if left(v_s, 1) = '+' then
    v_intl := true;
    v_s := substr(v_s, 2);
  elsif left(v_s, 2) = '00' then
    v_intl := true;
    v_s := substr(v_s, 3);
  end if;
  if v_s !~ '^[0-9]+$' then
    return null;
  end if;

  if v_intl then
    v_d := v_s;
  elsif length(v_s) = 12 and left(v_s, 3) = '998' then
    v_d := v_s;
  elsif length(v_s) = 9 then
    v_d := '998' || v_s;
  elsif length(v_s) = 10 and left(v_s, 1) = '8' then
    v_d := '998' || substr(v_s, 2);
  else
    return null;
  end if;

  if left(v_d, 3) = '998' and length(v_d) <> 12 then
    return null;
  end if;
  if left(v_d, 1) = '0' or ('+' || v_d) !~ '^\+[0-9]{9,15}$' then
    return null;
  end if;
  return '+' || v_d;
end;
$$;
revoke execute on function private.normalize_phone(text) from public, anon;
grant execute on function private.normalize_phone(text) to authenticated, service_role;

create function public.create_company(p_name text, p_admin_full_name text, p_admin_phone text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name    text := btrim(p_name);
  v_admin   text := btrim(p_admin_full_name);
  v_phone   text := private.normalize_phone(p_admin_phone);
  v_company uuid;
  v_profile uuid;
begin
  -- Foydalanuvchi sessiyasida faqat tizim egasi; tizim konteksti (SQL editor, service_role) — ruxsat
  if not private.is_super_admin()
     and (auth.uid() is not null or coalesce(auth.role(), '') in ('anon', 'authenticated')) then
    raise exception 'Firmani faqat tizim egasi qo''sha oladi'
      using errcode = '42501', hint = 'company_create_forbidden';
  end if;
  if v_name is null or v_name = '' or length(v_name) > 200 then
    raise exception 'Firma nomi bo''sh yoki juda uzun (200 belgigacha)'
      using errcode = '22023', hint = 'company_name_invalid';
  end if;
  if v_admin is null or v_admin = '' or length(v_admin) > 200 then
    raise exception 'Administrator ismi bo''sh yoki juda uzun (200 belgigacha)'
      using errcode = '22023', hint = 'profile_name_invalid';
  end if;
  if v_phone is null then
    raise exception 'Telefon raqami noto''g''ri'
      using errcode = '22023', hint = 'phone_invalid';
  end if;

  insert into public.companies (name) values (v_name) returning id into v_company;

  insert into public.profiles (company_id, role, full_name, phone)
  values (v_company, 'admin', v_admin, v_phone)
  returning id into v_profile;

  return jsonb_build_object('company_id', v_company, 'admin_profile_id', v_profile);
end;
$$;
revoke execute on function public.create_company(text, text, text) from public, anon;
grant execute on function public.create_company(text, text, text) to authenticated, service_role;

-- ============================================================================
-- D3. Rasm ko'rish: ko'r sanovchi (tekshiruvchi) faqat o'zi yuklaganini ko'radi —
--   is_company_wide() uni ham qamraydi, kirim/xarid rasmlari kutilgan qoldiqni ochib qo'yardi.
-- ============================================================================
drop policy photos_select on storage.objects;
create policy photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (
      (select private.is_super_admin())
      or (
        (storage.foldername(objects.name))[1] = (select private.my_company_id())::text
        and case
              -- Skrinshot: faqat yuklagan odam va firma admini
              when (storage.foldername(objects.name))[2] = 'bug' then
                (select private.has_role('admin'))
                or objects.owner_id = (select auth.uid())::text
              else
                objects.owner_id = (select auth.uid())::text
                or (
                  not (select private.is_blind_counter())
                  and (
                    (select private.is_company_wide())
                    or exists (select 1 from public.movements m where m.photo_path = objects.name)
                    or exists (select 1 from public.purchases p where p.receipt_photo_path = objects.name)
                    or exists (select 1 from public.expenses e where e.receipt_photo_path = objects.name)
                  )
                )
            end
      )
    )
  );

-- ============================================================================
-- D4. Nazorat bayroqlari o'zgarsa — sozlama_ozgardi (ogohlantirish, direktor va admin'ga).
--   Faqat foydalanuvchi sessiyasida (firma sozlamalari — tg_companies_settings_alert kabi).
--   details: {kind: 'material_control' | 'expense_category_control', target_id, target_name,
--             changes: [{key, before, after}], actor_profile_id, actor_name}.
--   Kalitlar: material_outside_estimate, material_photo_required, category_monthly_limit,
--             category_photo_required, category_is_active.
-- ============================================================================
create function private.tg_materials_control_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb;
  v_me      uuid := private.my_profile_id();
begin
  if auth.uid() is null then
    return null;
  end if;
  select jsonb_agg(jsonb_build_object('key', x.k, 'before', x.b, 'after', x.a) order by x.k)
    into v_changes
    from (values ('material_outside_estimate', to_jsonb(old.outside_estimate), to_jsonb(new.outside_estimate)),
                 ('material_photo_required',   to_jsonb(old.photo_required),   to_jsonb(new.photo_required))) x(k, b, a)
   where x.b is distinct from x.a;
  if v_changes is null then
    return null;
  end if;

  insert into public.alerts (company_id, type, severity, material_id, details)
  values (new.company_id, 'sozlama_ozgardi'::public.alert_type, 'ogohlantirish', new.id,
          jsonb_build_object(
            'kind',             'material_control',
            'target_id',        new.id,
            'target_name',      new.name,
            'material_id',      new.id,
            'material_name',    new.name,
            'changes',          v_changes,
            'actor_profile_id', v_me,
            'actor_name',       (select p.full_name from public.profiles p where p.id = v_me)));
  return null;
end;
$$;
revoke execute on function private.tg_materials_control_alert() from public, anon, authenticated;
create trigger zz_control_alert after update of outside_estimate, photo_required on public.materials
  for each row
  when (old.outside_estimate is distinct from new.outside_estimate
        or old.photo_required is distinct from new.photo_required)
  execute function private.tg_materials_control_alert();

create function private.tg_expense_categories_control_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb;
  v_me      uuid := private.my_profile_id();
begin
  if auth.uid() is null then
    return null;
  end if;
  select jsonb_agg(jsonb_build_object('key', x.k, 'before', x.b, 'after', x.a) order by x.k)
    into v_changes
    from (values ('category_monthly_limit',  to_jsonb(old.monthly_limit),  to_jsonb(new.monthly_limit)),
                 ('category_photo_required', to_jsonb(old.photo_required), to_jsonb(new.photo_required)),
                 ('category_is_active',      to_jsonb(old.is_active),      to_jsonb(new.is_active))) x(k, b, a)
   where x.b is distinct from x.a;
  if v_changes is null then
    return null;
  end if;

  insert into public.alerts (company_id, type, severity, details)
  values (new.company_id, 'sozlama_ozgardi'::public.alert_type, 'ogohlantirish',
          jsonb_build_object(
            'kind',             'expense_category_control',
            'target_id',        new.id,
            'target_name',      new.name,
            'category_id',      new.id,
            'category_name',    new.name,
            'changes',          v_changes,
            'actor_profile_id', v_me,
            'actor_name',       (select p.full_name from public.profiles p where p.id = v_me)));
  return null;
end;
$$;
revoke execute on function private.tg_expense_categories_control_alert() from public, anon, authenticated;
create trigger zz_control_alert after update of monthly_limit, photo_required, is_active on public.expense_categories
  for each row
  when (old.monthly_limit is distinct from new.monthly_limit
        or old.photo_required is distinct from new.photo_required
        or old.is_active is distinct from new.is_active)
  execute function private.tg_expense_categories_control_alert();

-- ============================================================================
-- D5. Haftalik podotchet hisoboti (20261111000001_expenses.sql versiyasi): firma
--   to'lagan xaridlar (payment_source = 'firma') "sarflandi" ga va qabul qiluvchilar
--   ro'yxatiga kirmaydi — cash_position / cash_balances bilan bir xil.
-- ============================================================================
create or replace function private.enqueue_cash_statements(
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
  v_ex    numeric(18,2);
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
                        where p.company_id = pr.company_id and p.buyer_id = pr.id and p.deleted_at is null
                          and p.payment_source = 'podotchet')
            or exists (select 1 from public.expenses e
                        where e.company_id = pr.company_id and e.payer_id = pr.id and e.deleted_at is null
                          and e.payment_source = 'podotchet'))
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
       and p.payment_source = 'podotchet'   -- firma to'lagan xarid qo'ldagi pulga kirmaydi (3-tur D5)
       and p.purchased_at >= v_start and p.purchased_at < v_end;
    select coalesce(sum(e.amount), 0) into v_ex
      from public.expenses e
     where e.company_id = r.company_id and e.payer_id = r.id and e.deleted_at is null
       and e.payment_source = 'podotchet'
       and e.spent_at >= v_start and e.spent_at < v_end;

    continue when v_pos.balance = 0 and v_iss = 0 and v_ret = 0 and v_sp = 0 and v_ex = 0;

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
              'spent_week',       (v_sp + v_ex)::numeric(18,2)::text,
              'expenses_week',    v_ex::text,
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
-- D6. Qoida 1 — xarid ≠ qabul (20261109000001_audit2_fixes.sql L11 versiyasi):
--   * "kam qabul" kutishi greatest(purchased_at, created_at) + 24 soat (orqa sana bilan
--     kiritilgan xarid darhol alert bermasin);
--   * severity: jiddiy — faqat chegara > 0 va farq >= 3 × chegara.
--   (klient: src/domain/alerts/receiptMismatch.ts → evaluateReceipt, createdAt).
-- ============================================================================
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
  select p.* into v_p from public.purchases p where p.id = p_purchase_id;
  if not found then
    return;
  end if;

  if v_p.deleted_at is not null then
    perform private.close_purchase_alerts(v_p.company_id, v_p.id,
      array['xarid_qabul_farqi']::public.alert_type[], 'purchase_deleted');
    return;
  end if;

  perform private.lock_receipt_alloc(v_p.object_id, v_p.material_id);
  select p.* into v_p from public.purchases p where p.id = p_purchase_id;

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
  -- 24 soatlik kutish: orqa sana bilan kiritilgan xaridda — kiritilgan vaqtdan (3-tur D6)
  elsif p_now >= greatest(v_p.purchased_at, v_p.created_at) + interval '24 hours' then
    if v_cand_qty > 0
       and round(abs(v_received + v_cand_qty - v_purchased) * 100 / v_purchased, 2) <= v_threshold then
      v_state := 'covered';
    else
      v_state := 'under';
    end if;
  else
    v_state := 'pending';
  end if;

  -- chegara 0 bo'lsa har qanday farq "jiddiy" bo'lib qolmasin (3-tur D6)
  v_severity := case when v_threshold > 0 and v_diff >= 3 * v_threshold then 'jiddiy' else 'ogohlantirish' end;
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
      select distinct (x ->> 'movement_id')::uuid from jsonb_array_elements(v_cand) x order by 1
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
  -- zanjir (reevaluate_receipt_chain) faqat mavjud alertlarni yangilaydi / yopadi;
  -- yangi alertni hourly cron (evaluate_due_purchases) yoki bevosita chaqiruv yaratadi
  if coalesce(current_setting('terron.receipt_chain', true), '') = 'on' then
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

-- Soatlik tekshiruv (Batch 5 versiyasi): kutish — greatest(purchased_at, created_at) + 24 soat.
create or replace function private.evaluate_due_purchases(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_n  integer := 0;
begin
  for v_id in
    select x.id
      from (
        select p.id, p.company_id, p.qty_base,
               c.receipt_mismatch_pct as threshold,
               (select coalesce(sum(m.qty_base), 0)::numeric(20,6)
                  from public.movements m
                 where m.company_id = p.company_id
                   and m.purchase_id = p.id
                   and m.type = 'kirim'
                   and m.deleted_at is null) as received
          from public.purchases p
          join public.companies c on c.id = p.company_id
         where p.deleted_at is null
           and c.deleted_at is null
           and c.is_active
           and greatest(p.purchased_at, p.created_at) <= p_now - interval '24 hours'
           and p.purchased_at >= p_now - interval '60 days'
      ) x
      left join lateral (
        select a.details
          from public.alerts a
         where a.company_id = x.company_id
           and a.purchase_id = x.id
           and a.type = 'xarid_qabul_farqi'
           and a.status in ('yangi', 'korildi')
           and a.deleted_at is null
      ) o on true
     where case
             when o.details is not null then
               -- ochiq alert: faqat raqamlar o'zgargan bo'lsa
               (o.details ->> 'received_qty_base')::numeric is distinct from x.received
               or (o.details ->> 'purchased_qty_base')::numeric is distinct from x.qty_base
             else
               round(abs(x.received - x.qty_base) * 100 / x.qty_base, 2) > x.threshold
               and not exists (
                 select 1 from public.alerts a
                  where a.company_id = x.company_id
                    and a.purchase_id = x.id
                    and a.type = 'xarid_qabul_farqi'
                    and a.status = 'yopildi'
                    and a.deleted_at is null
                    and coalesce((a.details ->> 'auto_closed')::boolean, false) = false
                    and (a.details ->> 'purchased_qty_base')::numeric = x.qty_base
                    and (a.details ->> 'received_qty_base')::numeric = x.received
               )
           end
     order by x.id
  loop
    perform private.evaluate_purchase_receipt(v_id, p_now);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- purchases AFTER (audit2 L2 versiyasi): tiklashda xaridning o'zi zanjir rejimida baholanadi.
create or replace function private.tg_purchases_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restored boolean;
  v_pair     record;
  v_prev     text;
begin
  if tg_op = 'INSERT' then
    perform private.evaluate_purchase_price(new.id);
    perform private.reevaluate_self_for_purchase(new.id);
    perform private.reevaluate_receipt_chain(new.company_id, new.object_id, new.material_id, new.purchased_at);
    return null;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    perform private.close_purchase_alerts(new.company_id, new.id, null, 'purchase_deleted');
    perform private.reevaluate_self_for_purchase(new.id);
    perform private.reevaluate_receipt_chain(new.company_id, old.object_id, old.material_id, old.purchased_at);
    return null;
  end if;
  if new.deleted_at is not null then
    return null;
  end if;

  v_restored := old.deleted_at is not null;

  if v_restored
     or new.qty_base     is distinct from old.qty_base
     or new.purchased_at is distinct from old.purchased_at
     or new.object_id    is distinct from old.object_id
     or new.material_id  is distinct from old.material_id then
    for v_pair in
      select distinct x.o, x.m, min(x.at) over (partition by x.o, x.m) as at
        from (select new.object_id as o, new.material_id as m, new.purchased_at as at
              union all
              select old.object_id, old.material_id, old.purchased_at) x
       order by 1, 2
    loop
      perform private.reevaluate_receipt_chain(new.company_id, v_pair.o, v_pair.m, v_pair.at);
    end loop;
    -- Tiklash: zanjir rejimi — faqat mavjud alert yangilanadi, yangisini soatlik cron yaratadi
    -- (tiklangan eski xarid darhol "kam qabul" xabarini bermasin, 3-tur D6).
    if v_restored then
      v_prev := coalesce(current_setting('terron.receipt_chain', true), '');
      perform set_config('terron.receipt_chain', 'on', true);
      perform private.evaluate_purchase_receipt(new.id);
      perform set_config('terron.receipt_chain', v_prev, true);
    else
      perform private.evaluate_purchase_receipt(new.id);
    end if;
  end if;

  if v_restored
     or new.total_amount is distinct from old.total_amount
     or new.qty_input    is distinct from old.qty_input
     or new.unit_id      is distinct from old.unit_id
     or new.material_id  is distinct from old.material_id
     or new.purchased_at is distinct from old.purchased_at then
    perform private.evaluate_purchase_price(new.id);
  end if;

  if v_restored
     or new.buyer_id     is distinct from old.buyer_id
     or new.object_id    is distinct from old.object_id
     or new.material_id  is distinct from old.material_id
     or new.purchased_at is distinct from old.purchased_at then
    perform private.reevaluate_self_for_purchase(new.id);
  end if;

  return null;
end;
$$;

-- ============================================================================
-- D7. cash_balances (expenses versiyasi) + ko'r sanovchi qo'riqchisi (audit2 versiyasidagi kabi).
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
     and p.payment_source = 'podotchet'
  union all
  select e.company_id,
         e.payer_id,
         0::numeric(18,2),
         e.amount,
         0::numeric(18,2),
         null::timestamptz,
         e.spent_at
    from public.expenses e
   where e.deleted_at is null
     and e.payment_source = 'podotchet'
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
 where not (current_user = 'authenticated' and (select private.is_blind_counter()))
   and (l.profile_id = (select private.my_profile_id())
        or (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter'))
        or current_user in ('service_role', 'postgres'))
 group by l.company_id, l.profile_id;

-- ============================================================================
-- D8. Chek qo'riqchilari (expenses versiyalari): fiskal belgi keshda topilmasa
--   foydalanuvchi sessiyasida receipt_total va seller_tin null (klient yozolmaydi).
-- ============================================================================
create or replace function private.tg_purchases_auto_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revived  boolean := false;
  v_merge    boolean := coalesce(current_setting('terron.merge_rpc', true), '') = 'on';
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

  if tg_op = 'UPDATE' and v_merge then
    new.receipt_verified := old.receipt_verified;
    new.receipt_total    := old.receipt_total;
    new.seller_tin       := old.seller_tin;
  elsif new.receipt_fiscal_sign is null then
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
      else
        -- Kesh yo'q: chek summasi va STIR faqat serverdan (soliq.uz) keladi (3-tur D8)
        new.receipt_total := null;
        new.seller_tin    := null;
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
    if not found then
      select e.created_at, pr.full_name into v_other
        from public.expenses e
        left join public.profiles pr on pr.company_id = e.company_id and pr.id = e.payer_id
       where e.company_id = new.company_id
         and e.receipt_fiscal_sign = new.receipt_fiscal_sign
         and e.deleted_at is null
       order by e.created_at
       limit 1;
    end if;
    if found then
      raise exception 'Bu chek allaqachon ishlatilgan: %, %',
        coalesce(v_other.full_name, '—'),
        to_char(v_other.created_at at time zone 'Asia/Tashkent', 'DD.MM.YYYY HH24:MI')
        using errcode = '23505', hint = 'receipt_already_used';
    end if;
  end if;

  -- (4) rasm: tasdiqlangan, bir qatorli va summasi ma'lum chek — ozod
  if new.deleted_at is null and new.receipt_photo_path is null
     and not (new.receipt_verified and not v_multi and new.receipt_total is not null)
     and not v_merge then
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

create or replace function private.tg_expenses_auto_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revived boolean := false;
  v_merge   boolean := coalesce(current_setting('terron.merge_rpc', true), '') = 'on';
  v_lookup  record;
  v_found   boolean;
  v_other   record;
  v_limit   numeric;
  v_cat_req boolean;
  v_check   boolean;
  v_items   jsonb;
  v_n       integer := 0;
  v_multi   boolean := false;
  v_ok      boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_revived := old.deleted_at is not null and new.deleted_at is null;
  end if;

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

  new.receipt_fiscal_sign := nullif(btrim(new.receipt_fiscal_sign), '');
  new.receipt_terminal_id := nullif(btrim(new.receipt_terminal_id), '');
  new.receipt_no          := nullif(btrim(new.receipt_no), '');
  new.seller_tin          := nullif(btrim(new.seller_tin), '');

  if tg_op = 'UPDATE' and v_merge then
    new.receipt_verified := old.receipt_verified;
    new.receipt_total    := old.receipt_total;
    new.seller_tin       := old.seller_tin;
  elsif new.receipt_fiscal_sign is null then
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
                (v_lookup.total is not null and abs(v_lookup.total - new.amount) <= 1)
                or exists (
                     select 1 from jsonb_array_elements(v_items) e
                      where jsonb_typeof(e) = 'object'
                        and (e ->> 'sum') ~ '^-?[0-9]+(\.[0-9]+)?$'
                        and abs((e ->> 'sum')::numeric - new.amount) <= 1)
              )
              and v_lookup.receipt_at is not null
              and abs(extract(epoch from (v_lookup.receipt_at - new.spent_at))) <= 3 * 86400;
    end if;
    if auth.uid() is not null then
      new.receipt_verified := coalesce(v_found and v_ok, false);
      if v_found then
        if v_lookup.total is not null then
          new.receipt_total := v_lookup.total;
        end if;
        new.seller_tin := coalesce(v_lookup.seller_tin, new.seller_tin);
      else
        -- Kesh yo'q: chek summasi va STIR faqat serverdan (soliq.uz) keladi (3-tur D8)
        new.receipt_total := null;
        new.seller_tin    := null;
      end if;
    elsif v_found then
      new.receipt_total := coalesce(new.receipt_total, v_lookup.total);
      new.seller_tin    := coalesce(new.seller_tin, v_lookup.seller_tin);
    end if;
  end if;

  -- Bitta chek — bitta tirik yozuv (xaridlar va xarajatlar birga)
  if new.receipt_fiscal_sign is not null and new.deleted_at is null
     and (tg_op = 'INSERT' or v_revived or new.receipt_fiscal_sign is distinct from old.receipt_fiscal_sign) then
    perform pg_advisory_xact_lock(hashtextextended(
      'terron.receipt:' || new.company_id::text || ':' || new.receipt_fiscal_sign, 0));
    select x.created_at, x.full_name into v_other
      from (
        select p.created_at, pr.full_name
          from public.purchases p
          left join public.profiles pr on pr.company_id = p.company_id and pr.id = p.buyer_id
         where p.company_id = new.company_id
           and p.receipt_fiscal_sign = new.receipt_fiscal_sign
           and p.deleted_at is null
        union all
        select e.created_at, pr.full_name
          from public.expenses e
          left join public.profiles pr on pr.company_id = e.company_id and pr.id = e.payer_id
         where e.company_id = new.company_id
           and e.receipt_fiscal_sign = new.receipt_fiscal_sign
           and e.deleted_at is null
           and e.id <> new.id
      ) x
     order by x.created_at
     limit 1;
    if found then
      raise exception 'Bu chek allaqachon ishlatilgan: %, %',
        coalesce(v_other.full_name, '—'),
        to_char(v_other.created_at at time zone 'Asia/Tashkent', 'DD.MM.YYYY HH24:MI')
        using errcode = '23505', hint = 'receipt_already_used';
    end if;
  end if;

  -- Rasm: summa chegarasi yoki tur bayrog'i; tasdiqlangan, bir qatorli, summasi ma'lum chek — ozod
  if new.deleted_at is null and new.receipt_photo_path is null
     and not (new.receipt_verified and not v_multi and new.receipt_total is not null)
     and not v_merge then
    if tg_op = 'INSERT' then
      v_check := true;
    else
      v_check := new.amount is distinct from old.amount
              or new.category_id is distinct from old.category_id
              or old.receipt_photo_path is not null
              or new.receipt_verified is distinct from old.receipt_verified;
    end if;
    if v_check then
      select c.photo_required_amount into v_limit from public.companies c where c.id = new.company_id;
      select ec.photo_required into v_cat_req
        from public.expense_categories ec
       where ec.company_id = new.company_id and ec.id = new.category_id;
      if (v_limit is not null and new.amount >= v_limit) or coalesce(v_cat_req, false) then
        raise exception 'Chek rasmi majburiy (summa chegaradan katta yoki xarajat turi uchun rasm talab qilinadi)'
          using errcode = '23514', hint = 'photo_required';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- D9. Oylik limit (expenses versiyasi): alerts_company_category_month_idx predikati
--   (details ? 'category_id') so'rovlarda — qisman indeks ishlatiladi.
-- ============================================================================
create or replace function private.evaluate_expense_limit(p_company_id uuid, p_category_id uuid, p_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat    public.expense_categories%rowtype;
  v_from   timestamptz;
  v_to     timestamptz;
  v_spent  numeric(18,2);
  v_count  integer;
  v_last   uuid;
  v_alert  public.alerts%rowtype;
  v_det    jsonb;
  v_reason text;
  v_month  text;
begin
  if p_company_id is null or p_category_id is null or p_month is null then
    return;
  end if;
  v_month := to_char(p_month, 'YYYY-MM');
  perform private.alert_lock('xarajat_limiti:' || p_category_id::text || ':' || v_month);

  select c.* into v_cat from public.expense_categories c where c.company_id = p_company_id and c.id = p_category_id;
  if not found then
    return;
  end if;
  v_from := date_trunc('month', p_month)::timestamp at time zone 'Asia/Tashkent';
  v_to   := (date_trunc('month', p_month) + interval '1 month')::timestamp at time zone 'Asia/Tashkent';

  select coalesce(sum(e.amount), 0)::numeric(18,2), count(*)::integer,
         (array_agg(e.id order by e.spent_at desc, e.created_at desc, e.id desc))[1]
    into v_spent, v_count, v_last
    from public.expenses e
   where e.company_id = p_company_id
     and e.category_id = p_category_id
     and e.deleted_at is null
     and e.spent_at >= v_from and e.spent_at < v_to;

  select a.* into v_alert
    from public.alerts a
   where a.company_id = p_company_id
     and a.details ? 'category_id'   -- alerts_company_category_month_idx (qisman indeks, 3-tur D9)
     and (a.details ->> 'category_id') = p_category_id::text
     and (a.details ->> 'month') = v_month
     and a.type::text = 'xarajat_limiti'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
   order by a.created_at
   limit 1;

  v_reason := case
                when v_cat.deleted_at is not null then 'category_deleted'
                when v_cat.monthly_limit is null then 'not_applicable'
                when v_spent <= v_cat.monthly_limit then 'within_threshold'
              end;

  v_det := jsonb_build_object(
    'category_id',     p_category_id,
    'category_name',   v_cat.name,
    'month',           v_month,
    'limit',           v_cat.monthly_limit,
    'spent',           v_spent,
    'over',            case when v_cat.monthly_limit is not null then (v_spent - v_cat.monthly_limit)::numeric(18,2) end,
    'over_pct',        case when v_cat.monthly_limit is not null
                            then round((v_spent - v_cat.monthly_limit) * 100 / v_cat.monthly_limit, 2) end,
    'expense_count',   v_count,
    'last_expense_id', v_last);

  if v_reason is not null then
    if v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id, v_reason, v_det);
    end if;
    return;
  end if;

  if v_alert.id is not null then
    if (v_alert.details - private.alert_meta_keys()) is distinct from v_det then
      update public.alerts set details = v_det || private.alert_meta(v_alert.details) where id = v_alert.id;
    end if;
    return;
  end if;

  if exists (
    select 1 from public.alerts a
     where a.company_id = p_company_id
       and a.details ? 'category_id'
       and (a.details ->> 'category_id') = p_category_id::text
       and (a.details ->> 'month') = v_month
       and a.type::text = 'xarajat_limiti'
       and a.status = 'yopildi'
       and a.deleted_at is null
       and coalesce((a.details ->> 'auto_closed')::boolean, false) = false
       and (a.details ->> 'limit')::numeric = v_cat.monthly_limit
       and (a.details ->> 'spent')::numeric >= v_spent
  ) then
    return;
  end if;

  insert into public.alerts (company_id, type, severity, details)
  values (p_company_id, 'xarajat_limiti'::public.alert_type, 'ogohlantirish', v_det);
end;
$$;

create or replace function private.tg_expense_categories_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mon date;
begin
  for v_mon in
    select distinct x.m
      from (
        select private.tashkent_month(now()) as m
        union all
        select to_date(a.details ->> 'month', 'YYYY-MM')
          from public.alerts a
         where a.company_id = new.company_id
           and a.details ? 'category_id'   -- qisman indeks (3-tur D9)
           and (a.details ->> 'category_id') = new.id::text
           and a.details ? 'month'
           and a.type::text = 'xarajat_limiti'
           and a.status in ('yangi', 'korildi')
           and a.deleted_at is null
      ) x
     order by 1
  loop
    perform private.evaluate_expense_limit(new.company_id, new.id, v_mon);
  end loop;
  return null;
end;
$$;

-- ============================================================================
-- D10. Kunlik hisobot (Batch 6 versiyasi): har firma alohida, xatoda ogohlantirish.
-- ============================================================================
create or replace function private.enqueue_daily_reports(
  p_date date default (now() at time zone 'Asia/Tashkent')::date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end   timestamptz := (p_date + time '20:00') at time zone 'Asia/Tashkent';
  v_start timestamptz := v_end - interval '24 hours';
  v_n     integer := 0;
  v_k     integer;
  v_c     uuid;
begin
  -- Har firma alohida (3-tur D10): bitta firmadagi xato (masalan statistikada) qolganlarini
  -- to'xtatmaydi — o'sha firma uchun faqat ogohlantirish yoziladi.
  for v_c in
    select c.id
      from public.companies c
     where c.is_active
       and c.deleted_at is null
     order by c.id
  loop
    begin
      insert into public.notification_outbox (company_id, kind, report_date, payload)
      values (v_c, 'daily_report', p_date, private.daily_report_stats(v_c, v_start, v_end))
      on conflict (company_id, report_date) where kind = 'daily_report' do nothing;
      get diagnostics v_k = row_count;
      v_n := v_n + v_k;
    exception when others then
      raise warning 'enqueue_daily_reports: firma % — % (%)', v_c, sqlerrm, sqlstate;
    end;
  end loop;

  if v_n > 0 then
    perform private.wake_dispatch();
  end if;
  return v_n;
end;
$$;

-- ============================================================================
-- D11. Xarajat to'lovchisi (expenses versiyasi): admin payer_id ni almashtirib,
--   payment_source ni o'zgartirmasa — manba yangi to'lovchi bo'yicha qayta aniqlanadi.
-- ============================================================================
create or replace function private.tg_expenses_payer_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  boolean := auth.uid() is not null;
  v_admin boolean := private.has_role('super_admin', 'admin', 'buxgalter');
  v_rule  text;
begin
  if v_user and new.deleted_at is null
     and private.has_role('super_admin', 'admin')
     and new.payer_id is distinct from new.created_by
     and (tg_op = 'INSERT' or new.payer_id is distinct from old.payer_id)
     and exists (select 1 from public.profiles pr where pr.company_id = new.company_id and pr.id = new.payer_id)
     and not exists (
       select 1 from public.profiles pr
        where pr.company_id = new.company_id
          and pr.id = new.payer_id
          and pr.deleted_at is null
          and pr.is_active
          and pr.role in ('haydovchi', 'taminotchi', 'prorab', 'admin', 'buxgalter')) then
    raise exception 'To''lovchi faqat faol haydovchi, ta''minotchi, prorab, buxgalter yoki administrator bo''lishi mumkin'
      using errcode = '23514', hint = 'expense_payer_invalid';
  end if;

  if tg_op = 'UPDATE' and v_user and not v_admin then
    new.payment_source := old.payment_source;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.payment_source is null then
    new.payment_source := old.payment_source;
  end if;
  -- Admin to'lovchini almashtirdi, manbani esa o'zgartirmadi — manba yangi to'lovchi
  -- bo'yicha qayta aniqlanadi (aks holda firma puli podotchetga yoki aksincha o'tib ketadi, 3-tur D11).
  if tg_op = 'UPDATE' and new.payer_id is distinct from old.payer_id
     and new.payment_source is not distinct from old.payment_source then
    new.payment_source := case
      when exists (select 1 from public.cash_advances ca
                    where ca.company_id = new.company_id and ca.recipient_id = new.payer_id
                      and ca.kind = 'berildi' and ca.deleted_at is null) then 'podotchet'
      else 'firma'
    end;
  end if;
  if tg_op = 'INSERT' and (new.payment_source is null or (v_user and not v_admin)) then
    if not v_user then
      v_rule := 'podotchet';
    elsif exists (select 1 from public.cash_advances ca
                   where ca.company_id = new.company_id and ca.recipient_id = new.payer_id
                     and ca.kind = 'berildi' and ca.deleted_at is null) then
      v_rule := 'podotchet';
    else
      v_rule := 'firma';
    end if;
    new.payment_source := v_rule;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- D12. Takroriy yozuv (expenses versiyasi): bir muallifning parallel yozuvlari —
--   qidiruvdan oldin muallif bo'yicha advisory qulf.
-- ============================================================================
create or replace function private.evaluate_duplicate(p_table text, p_id uuid)
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
  v_category uuid;
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
  elsif p_table = 'expenses' then
    select e.company_id, e.created_by, e.object_id, null, null, e.amount, null, e.category_id,
           e.created_at, e.deleted_at
      into v_company, v_by, v_object, v_material, v_qty, v_total, v_type, v_category, v_created, v_deleted
      from public.expenses e where e.id = p_id;
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

  -- Bir odamning parallel yozuvlari bir-birini ko'rishi uchun: qidiruvdan oldin muallif bo'yicha
  -- tranzaksiya qulfi (ikkinchisi birinchisi commit bo'lgach qidiradi, 3-tur D12).
  perform private.alert_lock('takroriy_yozuv:by:' || v_by::text);

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
  elsif p_table = 'expenses' then
    select e.id into v_first
      from public.expenses e
     where e.company_id = v_company
       and e.created_by = v_by
       and e.category_id = v_category
       and e.object_id is not distinct from v_object
       and e.amount = v_total
       and e.deleted_at is null
       and e.id <> p_id
       and e.created_at <= v_created
       and e.created_at >= v_created - make_interval(mins => v_window)
     order by e.created_at, e.id
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
            'movement_type',  v_type)
          || case when p_table = 'expenses' then jsonb_build_object('category_id', v_category) else '{}'::jsonb end);
end;
$$;

-- ============================================================================
-- D13. Qoida 3 (Batch 5 versiyasi): total_amount = 0 xaridlar o'rtachaga kirmaydi
--   (klient: src/domain/alerts/priceDeviation.ts → weightedAverage).
-- ============================================================================
create or replace function private.price_check(
  p_company_id      uuid,
  p_material_id     uuid,
  p_price           numeric,
  p_before_at       timestamptz,
  p_before_created  timestamptz,
  p_exclude_id      uuid,
  out avg_n         numeric,
  out diff_n        numeric,
  out avg_90        numeric,
  out diff_90       numeric,
  out direction     text,
  out window_size   integer,
  out threshold_pct numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n   integer;
  v_n90 integer;
begin
  select c.price_deviation_pct, c.price_avg_window into threshold_pct, window_size
    from public.companies c
   where c.id = p_company_id;

  select count(*), round(sum(x.total_amount) / nullif(sum(x.qty_base), 0), 4)
    into v_n, avg_n
    from (
      select q.total_amount, q.qty_base
        from public.purchases q
       where q.company_id = p_company_id
         and q.material_id = p_material_id
         and q.deleted_at is null
         and q.id is distinct from p_exclude_id
         and q.total_amount > 0   -- bepul (0 so'm) xaridlar o'rtachani tushirmasin (3-tur D13)
         and (q.purchased_at, q.created_at) < (p_before_at, p_before_created)
       order by q.purchased_at desc, q.created_at desc, q.id desc
       limit window_size
    ) x;
  if v_n < 2 then
    avg_n := null;
  end if;

  select count(*), round(sum(q.total_amount) / nullif(sum(q.qty_base), 0), 4)
    into v_n90, avg_90
    from public.purchases q
   where q.company_id = p_company_id
     and q.material_id = p_material_id
     and q.deleted_at is null
     and q.id is distinct from p_exclude_id
     and q.total_amount > 0
     and (q.purchased_at, q.created_at) < (p_before_at, p_before_created)
     and q.purchased_at >= p_before_at - interval '90 days';
  if v_n90 < 2 then
    avg_90 := null;
  end if;

  if avg_n <> 0 then
    diff_n := round((p_price - avg_n) * 100 / avg_n, 2);
  end if;
  if avg_90 <> 0 then
    diff_90 := round((p_price - avg_90) * 100 / avg_90, 2);
  end if;

  direction := case
    when diff_n > threshold_pct or diff_90 > threshold_pct then 'high'
    when diff_n <= -50 or diff_90 <= -50 then 'low'
    else 'ok'
  end;
end;
$$;

-- ============================================================================
-- D14. Narx oldindan tekshiruvi (audit2 S8 versiyasi) + p_purchased_at: orqa sanali
--   xarid server bahosi (evaluate_purchase_price) bilan bir xil oynada tekshiriladi.
--   Imzo o'zgardi — eski (uuid, numeric) o'chiriladi (2 argumentli chaqiruv ishlayveradi).
-- ============================================================================
drop function public.check_purchase_price(uuid, numeric);
create function public.check_purchase_price(
  p_material_id    uuid,
  p_price_per_base numeric,
  p_purchased_at   timestamptz default now()
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.my_company_id();
  v_r       record;
begin
  if v_company is null then
    return 'ok';
  end if;
  perform private.rate_limit_hit('check_purchase_price', 30, interval '10 minutes');
  if p_material_id is null or p_price_per_base is null or p_price_per_base < 0 then
    return 'ok';
  end if;
  if not exists (
    select 1 from public.materials m
     where m.company_id = v_company and m.id = p_material_id and m.deleted_at is null
  ) then
    return 'ok';
  end if;
  select * into v_r
    from private.price_check(v_company, p_material_id, round(p_price_per_base, 4),
                             coalesce(p_purchased_at, now()), 'infinity'::timestamptz, null);
  return v_r.direction;
end;
$$;
revoke execute on function public.check_purchase_price(uuid, numeric, timestamptz) from public, anon;
grant execute on function public.check_purchase_price(uuid, numeric, timestamptz) to authenticated;

-- ============================================================================
-- D15. purchase_receipts.unlinked_qty_base — xaridga bog'lanmagan, lekin server qoida 1
--   "covered" holatida hisoblaydigan nomzod kirimlar ulushi (receipt_candidates, asosiy
--   birlikda). Faqat to'liq qabul qilinmagan xaridda hisoblanadi, aks holda 0.
--   Ustun so'ralmasa hisoblanmaydi (view so'rovga yoyiladi).
-- ============================================================================
create function private.purchase_unlinked_qty(p_company_id uuid, p_purchase_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(c.qty_base), 0)::numeric(20,6)
    from private.receipt_candidates(p_purchase_id) c
   where auth.uid() is null or private.can_access_company(p_company_id);
$$;
revoke execute on function private.purchase_unlinked_qty(uuid, uuid) from public, anon;
grant execute on function private.purchase_unlinked_qty(uuid, uuid) to authenticated, service_role;

create or replace view public.purchase_receipts
with (security_invoker = true)
as
select p.id                                              as purchase_id,
       p.company_id,
       p.object_id,
       p.material_id,
       p.buyer_id,
       p.purchased_at,
       p.qty_base,
       s.received_qty_base::numeric(20,6)                as received_qty_base,
       (p.qty_base - s.received_qty_base)::numeric(20,6) as remaining_qty_base,
       s.receipt_count,
       s.last_received_at,
       (case when p.qty_base > s.received_qty_base
             then private.purchase_unlinked_qty(p.company_id, p.id)
             else 0 end)::numeric(20,6)                  as unlinked_qty_base
  from public.purchases p
  cross join lateral private.purchase_receipt_stats(p.company_id, p.id) s
 where p.deleted_at is null;

comment on view public.purchase_receipts is
  'Har (o''chirilmagan) xarid uchun qabul: bog''langan o''chirilmagan kirimlar yig''indisi, '
  'qolgan miqdor (manfiy — ortiqcha), kirimlar soni, oxirgi kirim vaqti, bog''lanmagan '
  'nomzod kirimlar ulushi (unlinked_qty_base — qoida 1 "covered"). Asosiy birlikda.';

-- ============================================================================
-- D16. Mini App: chaqiruvchining obyektlaridagi to'liq qabul qilinmagan xaridlar.
--   prorab / omborchi — a'zo obyektlar; admin / super_admin — o'z firmasi bo'yicha;
--   boshqa rollar va ko'r sanovchi — bo'sh. Oyna: oxirgi 60 kun (qoida 1 soatlik
--   tekshiruvi bilan bir xil). security invoker — purchases / movements RLS amal qiladi.
-- ============================================================================
create function public.open_purchases_for_my_objects()
returns table (
  purchase_id        uuid,
  object_id          uuid,
  object_name        text,
  material_id        uuid,
  material_name      text,
  base_unit          text,
  qty_base           numeric,
  received_qty_base  numeric,
  remaining_qty_base numeric,
  purchased_at       timestamptz,
  buyer_id           uuid,
  buyer_name         text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.purchase_id,
         r.object_id,
         o.name,
         r.material_id,
         mt.name,
         mt.base_unit,
         r.qty_base,
         r.received_qty_base,
         r.remaining_qty_base,
         r.purchased_at,
         r.buyer_id,
         pd.full_name
    from public.purchase_receipts r
    join public.objects o on o.company_id = r.company_id and o.id = r.object_id and o.deleted_at is null
    join public.materials mt on mt.company_id = r.company_id and mt.id = r.material_id
    left join public.profile_directory pd on pd.company_id = r.company_id and pd.id = r.buyer_id
   where r.company_id = (select private.my_company_id())
     and not (select private.is_blind_counter())
     and r.remaining_qty_base > 0
     and r.purchased_at >= now() - interval '60 days'
     and (
       (select private.has_role('super_admin', 'admin'))
       or ((select private.has_role('prorab', 'omborchi')) and r.object_id in (select private.my_object_ids()))
     )
   order by o.name, r.object_id, r.purchased_at desc, r.purchase_id;
$$;
revoke execute on function public.open_purchases_for_my_objects() from public, anon;
grant execute on function public.open_purchases_for_my_objects() to authenticated;

-- ============================================================================
-- D18. Telefon boshqa firmadagi profilga tegishlimi (admin-users Edge Function:
--   telefon → login email global, firmalar orasida to'qnashuv bo'lmasin).
--   Hisobga olinadi: tirik profil yoki auth akkaunti bog'langan (o'chirilgan) profil.
--   Faqat service_role.
-- ============================================================================
create function public.svc_phone_in_other_company(p_company_id uuid, p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.phone = coalesce(private.normalize_phone(p_phone), btrim(p_phone))
       and p.company_id is distinct from p_company_id
       and (p.deleted_at is null or p.auth_user_id is not null)
  );
$$;
revoke execute on function public.svc_phone_in_other_company(uuid, text) from public, anon, authenticated;
grant execute on function public.svc_phone_in_other_company(uuid, text) to service_role;
