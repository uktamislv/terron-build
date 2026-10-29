-- ============================================================================
-- Audit (3-tur) tekshiruvi — tasdiqlangan topilmalar (docs/audit-fixes.md → "3-tur
-- tekshiruvi"). Oldingi migratsiyalar o'zgartirilmaydi; funksiyalar oxirgi
-- ta'riflardan aynan ko'chirilgan, faqat izohda aytilgan joylar o'zgargan.
--
--   R2  Faol firma (super_admin) yozish RPC'larida:
--       * estimate_create_materials(p_items, p_company_id default null) — super_admin
--         tanlagan firma katalogida yaratadi (boshqalar uchun p_company_id e'tiborsiz);
--       * remember_estimate_aliases — firma smetaning o'zidan olinadi;
--       * check_purchase_price — firma materialning o'zidan olinadi.
--   R3  create_company — admin telefoni boshqa firmada bo'lsa 23505 phone_in_other_company.
--   R4  evaluate_duplicate — qidiruv ikki tomonlama (± oyna); belgi juftning keyingisiga.
--   R10 Hisobot va tarix RPC'lari: ixtiyoriy p_company_id (faqat super_admin uchun amal
--       qiladi) — dashboard_summary, dashboard_daily, spend_breakdown, norm_overview,
--       notification_health, audit_feed, deleted_records.
--   E9  private.used_init_data + public.svc_use_init_data (tg-auth: izolyatlararo
--       initData replay himoyasi) + pg_cron tozalash.
-- ============================================================================

-- ============================================================================
-- Yordamchi: faol firma. p_company_id faqat super_admin uchun amal qiladi; boshqa
-- rollar (va p_company_id null) — o'z firmasi. Xavfsizlik RLS / can_access_company'da.
-- ============================================================================
create function private.scope_company(p_company_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_company_id is not null and private.is_super_admin() then p_company_id
    else private.my_company_id()
  end
$$;
revoke execute on function private.scope_company(uuid) from public, anon;
grant execute on function private.scope_company(uuid) to authenticated, service_role;

-- report_company(p_object_id) ning faol firmali varianti: obyekt berilsa — shu firmada bo'lishi shart.
create function private.report_company(p_object_id uuid, p_company_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_object_id is null then private.scope_company(p_company_id)
    when exists (
      select 1 from public.objects o
       where o.id = p_object_id
         and o.company_id = private.scope_company(p_company_id)
    ) then private.scope_company(p_company_id)
  end
$$;
revoke execute on function private.report_company(uuid, uuid) from public, anon;
grant execute on function private.report_company(uuid, uuid) to authenticated;

-- ============================================================================
-- R10. Hisobot RPC'lari — + p_company_id (oxirgi parametr, default null).
-- ============================================================================
drop function public.dashboard_summary(date, date, uuid);
-- Manba: 20261111000001_expenses.sql:2934
create function public.dashboard_summary(
  p_from date, p_to date, p_object_id uuid default null, p_company_id uuid default null
)
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
  v_e_count   integer;
  v_e_sum     numeric(18,2);
  v_e_by_cat  jsonb;
begin
  select * into v_period from private.report_period(p_from, p_to);
  -- ko'r-ko'rona sanash: tekshiruvchiga qoldiq / harakat / xarid / pul hisoblanmaydi
  if private.is_blind_counter() then
    return private.dashboard_blind_summary();
  end if;
  v_company := private.report_company(p_object_id, p_company_id);

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

  select count(*), coalesce(sum(e.amount), 0)
    into v_e_count, v_e_sum
    from public.expenses e
   where e.company_id = v_company
     and e.deleted_at is null
     and e.spent_at >= v_period.o_start and e.spent_at < v_period.o_end
     and (p_object_id is null or e.object_id = p_object_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'category_id', x.category_id, 'category_name', x.name,
           'sum', x.s::numeric(18,2)::text, 'count', x.n) order by x.s desc, x.n desc, x.name, x.category_id), '[]'::jsonb)
    into v_e_by_cat
    from (
      select e.category_id, c.name, sum(e.amount) as s, count(*)::integer as n
        from public.expenses e
        join public.expense_categories c on c.company_id = e.company_id and c.id = e.category_id
       where e.company_id = v_company
         and e.deleted_at is null
         and e.spent_at >= v_period.o_start and e.spent_at < v_period.o_end
         and (p_object_id is null or e.object_id = p_object_id)
       group by e.category_id, c.name
       order by sum(e.amount) desc, count(*) desc, c.name, e.category_id
       limit 5
    ) x;

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
     and not exists (select 1 from public.materials mx
                      where mx.company_id = nu.company_id and mx.id = nu.material_id and mx.outside_estimate)
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
    'expense_count',              v_e_count,
    'expense_sum',                v_e_sum::text,
    'expense_by_category',        v_e_by_cat,
    'spend_total_sum',            (v_p_sum + v_e_sum)::numeric(18,2)::text,
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
    'objects_over_norm_count',    v_over,
    'telegram_blocked_count',     private.telegram_blocked_count(v_company),
    'telegram_me_blocked',        coalesce((select p.telegram_blocked_at is not null
                                              from public.profiles p
                                             where p.id = private.my_profile_id()), false)
  );
end;
$$;
revoke execute on function public.dashboard_summary(date, date, uuid, uuid) from public, anon;
grant execute on function public.dashboard_summary(date, date, uuid, uuid) to authenticated;

drop function public.dashboard_daily(date, date, uuid);
-- Manba: 20261102000001_reports.sql:270
create function public.dashboard_daily(
  p_from date, p_to date, p_object_id uuid default null, p_company_id uuid default null
)
returns table (day date, kirim_count integer, chiqim_count integer, purchases_sum text, alerts_count integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_period  record;
  v_company uuid;
begin
  select * into v_period from private.report_period(p_from, p_to);
  v_company := private.report_company(p_object_id, p_company_id);

  return query
  with days as (
    select (p_from + i)::date as d_day
      from generate_series(0, p_to - p_from) i
  ),
  mv as (
    select (m.occurred_at at time zone 'Asia/Tashkent')::date as d_day,
           count(*) filter (where m.type = 'kirim')::integer  as d_kirim,
           count(*) filter (where m.type = 'chiqim')::integer as d_chiqim
      from public.movements m
     where m.company_id = v_company
       and m.deleted_at is null
       and m.type in ('kirim', 'chiqim')
       and m.occurred_at >= v_period.o_start and m.occurred_at < v_period.o_end
       and (p_object_id is null or m.object_id = p_object_id)
     group by 1
  ),
  pu as (
    select (p.purchased_at at time zone 'Asia/Tashkent')::date as d_day,
           sum(p.total_amount) as d_sum
      from public.purchases p
     where p.company_id = v_company
       and p.deleted_at is null
       and p.purchased_at >= v_period.o_start and p.purchased_at < v_period.o_end
       and (p_object_id is null or p.object_id = p_object_id)
     group by 1
  ),
  al as (
    select (a.created_at at time zone 'Asia/Tashkent')::date as d_day,
           count(*)::integer as d_alerts
      from public.alerts a
     where a.company_id = v_company
       and a.deleted_at is null
       and a.severity <> 'belgi'
       and a.created_at >= v_period.o_start and a.created_at < v_period.o_end
       and (p_object_id is null or a.object_id = p_object_id)
     group by 1
  )
  select days.d_day,
         coalesce(mv.d_kirim, 0),
         coalesce(mv.d_chiqim, 0),
         coalesce(pu.d_sum, 0)::numeric(18,2)::text,
         coalesce(al.d_alerts, 0)
    from days
    left join mv on mv.d_day = days.d_day
    left join pu on pu.d_day = days.d_day
    left join al on al.d_day = days.d_day
   order by days.d_day;
end;
$$;
revoke execute on function public.dashboard_daily(date, date, uuid, uuid) from public, anon;
grant execute on function public.dashboard_daily(date, date, uuid, uuid) to authenticated;

drop function public.spend_breakdown(date, date, uuid, text);
-- Manba: 20261111000001_expenses.sql:3341
create function public.spend_breakdown(
  p_from      date,
  p_to        date,
  p_object_id uuid default null,
  p_group     text default 'material',
  p_company_id uuid default null
)
returns table (key uuid, label text, purchases_sum text, purchases_count integer,
               expenses_sum text, expenses_count integer, total_sum text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_period  record;
  v_company uuid;
begin
  if p_group is null or p_group not in ('material', 'object', 'buyer', 'supplier', 'category') then
    raise exception 'Guruhlash turi noto''g''ri: material, object, buyer, supplier yoki category bo''lishi kerak'
      using errcode = '22023', hint = 'report_group_invalid';
  end if;
  select * into v_period from private.report_period(p_from, p_to);
  v_company := private.report_company(p_object_id, p_company_id);

  return query
  select g.g_key,
         case p_group
           when 'material' then (select mt.name from public.materials mt
                                  where mt.company_id = v_company and mt.id = g.g_key)
           when 'object'   then (select o.name from public.objects o
                                  where o.company_id = v_company and o.id = g.g_key)
           when 'buyer'    then (select pr.full_name from public.profile_directory pr
                                  where pr.company_id = v_company and pr.id = g.g_key)
           when 'category' then (select c.name from public.expense_categories c
                                  where c.company_id = v_company and c.id = g.g_key)
           else                 (select s.name from public.suppliers s
                                  where s.company_id = v_company and s.id = g.g_key)
         end::text,
         g.p_sum::numeric(18,2)::text,
         g.p_count,
         g.e_sum::numeric(18,2)::text,
         g.e_count,
         (g.p_sum + g.e_sum)::numeric(18,2)::text
    from (
      select x.k as g_key,
             coalesce(sum(x.amt) filter (where x.src = 'p'), 0) as p_sum,
             (count(*) filter (where x.src = 'p'))::integer      as p_count,
             coalesce(sum(x.amt) filter (where x.src = 'e'), 0) as e_sum,
             (count(*) filter (where x.src = 'e'))::integer      as e_count
        from (
          select 'p'::text as src,
                 case p_group
                   when 'material' then p.material_id
                   when 'object'   then p.object_id
                   when 'buyer'    then p.buyer_id
                   else                 p.supplier_id
                 end as k,
                 p.total_amount as amt
            from public.purchases p
           where p_group <> 'category'
             and p.company_id = v_company
             and p.deleted_at is null
             and p.purchased_at >= v_period.o_start and p.purchased_at < v_period.o_end
             and (p_object_id is null or p.object_id = p_object_id)
          union all
          select 'e',
                 case p_group
                   when 'object'   then e.object_id
                   when 'buyer'    then e.payer_id
                   when 'category' then e.category_id
                   else                 e.supplier_id
                 end,
                 e.amount
            from public.expenses e
           where p_group <> 'material'
             and e.company_id = v_company
             and e.deleted_at is null
             and e.spent_at >= v_period.o_start and e.spent_at < v_period.o_end
             and (p_object_id is null or e.object_id = p_object_id)
        ) x
       group by x.k
    ) g
   order by (g.p_sum + g.e_sum) desc, (g.p_count + g.e_count) desc, g.g_key nulls last;
end;
$$;
revoke execute on function public.spend_breakdown(date, date, uuid, text, uuid) from public, anon;
grant execute on function public.spend_breakdown(date, date, uuid, text, uuid) to authenticated;

drop function public.norm_overview(uuid);
-- Manba: 20261111000001_expenses.sql:3847
create function public.norm_overview(p_object_id uuid default null, p_company_id uuid default null)
returns table (
  object_id         uuid,
  object_name       text,
  material_id       uuid,
  material_name     text,
  base_unit         text,
  norm_qty_base     text,
  allowed_qty_base  text,
  consumed_qty_base text,
  usage_pct         text,
  outside_estimate  boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select nu.object_id,
         o.name::text,
         nu.material_id,
         mt.name::text,
         mt.base_unit::text,
         nu.norm_qty_base::numeric(20,6)::text,
         nu.allowed_qty_base::numeric(20,6)::text,
         nu.consumed_qty_base::numeric(20,6)::text,
         nu.usage_pct::text,
         mt.outside_estimate
    from public.norm_usage nu
    join public.objects o
      on o.company_id = nu.company_id and o.id = nu.object_id and o.deleted_at is null
    join public.materials mt
      on mt.company_id = nu.company_id and mt.id = nu.material_id
   where nu.company_id = private.scope_company(p_company_id)
     and (p_object_id is null or nu.object_id = p_object_id)
   order by o.name, nu.object_id, mt.name, nu.material_id
$$;
revoke execute on function public.norm_overview(uuid, uuid) from public, anon;
grant execute on function public.norm_overview(uuid, uuid) to authenticated;

drop function public.notification_health();
-- Manba: 20261108000001_audit_fixes.sql:3544
create function public.notification_health(p_company_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.scope_company(p_company_id);
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
revoke execute on function public.notification_health(uuid) from public, anon;
grant execute on function public.notification_health(uuid) to authenticated;

-- ============================================================================
-- R10. Tarix RPC'lari — + p_company_id. audit_feed: super_admin firma tanlasa — faqat
--   o'sha firma (aks holda avvalgidek hammasi). deleted_records: firma filtri.
-- ============================================================================
drop function public.audit_feed(date, date, text, text, uuid, text, uuid, bigint, int);
-- Manba: 20261108000001_audit_fixes.sql:4240
create function public.audit_feed(
  p_from      date,
  p_to        date,
  p_table     text   default null,
  p_action    text   default null,
  p_actor     uuid   default null,
  p_device    text   default null,
  p_record_id uuid   default null,
  p_before_id bigint default null,
  p_limit     int    default 50,
  p_company_id uuid  default null
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
  v_co    uuid := case when private.is_super_admin() then p_company_id else private.my_company_id() end;
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
revoke execute on function public.audit_feed(date, date, text, text, uuid, text, uuid, bigint, int, uuid) from public, anon;
grant execute on function public.audit_feed(date, date, text, text, uuid, text, uuid, bigint, int, uuid) to authenticated;

drop function public.deleted_records(date, date, text, int, int);
-- Manba: 20261111000001_expenses.sql:2348
create function public.deleted_records(
  p_from   date,
  p_to     date,
  p_table  text default null,
  p_limit  int  default 100,
  p_offset int  default 0,
  p_company_id uuid default null
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
    union all select 'expense_categories', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.expense_categories t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'expense_categories')
    union all select 'expenses', t.company_id, t.id, t.deleted_at, to_jsonb(t) from public.expenses t
               where t.deleted_at >= v_start and t.deleted_at < v_end and (p_table is null or p_table = 'expenses')
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
   where (p_company_id is null or d.company_id = p_company_id)
   order by d.deleted_at desc, d.table_name, d.record_id
   limit p_limit offset p_offset;
end;
$$;
revoke execute on function public.deleted_records(date, date, text, int, int, uuid) from public, anon;
grant execute on function public.deleted_records(date, date, text, int, int, uuid) to authenticated;

-- ============================================================================
-- R2. Smeta: materiallar va muqobil nomlar faol firmada.
-- ============================================================================
drop function public.estimate_create_materials(jsonb);
-- Manba: 20261105000001_estimate_auto_fixes.sql:473
create function public.estimate_create_materials(p_items jsonb, p_company_id uuid default null)
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
  v_company   uuid := private.scope_company(p_company_id);
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
  -- Faol firma (super_admin): mavjud va o'chirilmagan bo'lishi shart
  if v_company is null or not exists (
    select 1 from public.companies c where c.id = v_company and c.deleted_at is null
  ) then
    raise exception 'Firma topilmadi'
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
revoke execute on function public.estimate_create_materials(jsonb, uuid) from public, anon;
grant execute on function public.estimate_create_materials(jsonb, uuid) to authenticated;

-- Manba: 20261105000001_estimate_auto_fixes.sql:62
create or replace function public.remember_estimate_aliases(p_estimate_id uuid, p_items jsonb)
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
     and (e.company_id = v_company or private.is_super_admin())
     and e.deleted_at is null;
  if not found then
    raise exception 'Smeta topilmadi'
      using errcode = 'P0002', hint = 'estimate_not_found';
  end if;
  -- Firma smetaning o'zidan (super_admin boshqa firmani tanlagan bo'lsa ham alias o'sha firmaga)
  v_company := v_est.company_id;
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

-- ============================================================================
-- R2. check_purchase_price — firma materialning o'zidan (super_admin boshqa firmani tanlasa
--   ham narx og'ishi jim yo'qolmaydi). Material ko'rinmasa (boshqa firma) — 'ok'.
-- ============================================================================
create or replace function public.check_purchase_price(
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
  v_company uuid;
  v_r       record;
begin
  if private.my_company_id() is null then
    return 'ok';
  end if;
  perform private.rate_limit_hit('check_purchase_price', 30, interval '10 minutes');
  if p_material_id is null or p_price_per_base is null or p_price_per_base < 0 then
    return 'ok';
  end if;
  select m.company_id into v_company
    from public.materials m
   where m.id = p_material_id
     and m.deleted_at is null
     and private.can_access_company(m.company_id);
  if v_company is null then
    return 'ok';
  end if;
  select * into v_r
    from private.price_check(v_company, p_material_id, round(p_price_per_base, 4),
                             coalesce(p_purchased_at, now()), 'infinity'::timestamptz, null);
  return v_r.direction;
end;
$$;

-- ============================================================================
-- R3. create_company — admin telefoni boshqa firmada (tirik profil yoki auth akkaunti
--   bog'langan o'chirilgan profil) bo'lsa rad: tg-bot bunday raqamni bog'lamaydi
--   (multipleCompanies), admin-users telefon loginini rad etadi (svc_phone_in_other_company
--   bilan bir xil shart).
-- ============================================================================
-- Manba: 20261112000001_audit3_fixes.sql:110
create or replace function public.create_company(p_name text, p_admin_full_name text, p_admin_phone text)
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

  -- Telefon boshqa firmada (yangi firma uchun — istalgan firmada) — rad
  if exists (
    select 1 from public.profiles p
     where p.phone = v_phone
       and (p.deleted_at is null or p.auth_user_id is not null)
  ) then
    raise exception 'Bu telefon raqami boshqa firmada ro''yxatdan o''tgan'
      using errcode = '23505', hint = 'phone_in_other_company';
  end if;

  insert into public.companies (name) values (v_name) returning id into v_company;

  insert into public.profiles (company_id, role, full_name, phone)
  values (v_company, 'admin', v_admin, v_phone)
  returning id into v_profile;

  return jsonb_build_object('company_id', v_company, 'admin_profile_id', v_profile);
end;
$$;

-- ============================================================================
-- R4. Takroriy yozuv — qidiruv ikki tomonlama. Muallif qulfi ikkinchi tranzaksiyani
--   birinchisi commit bo'lguncha kutdiradi, lekin keyinroq yaratilgan (created_at katta)
--   yozuv qulfni birinchi olsa, u eskisini ko'rmaydi; eskisi esa (created_at <= o'zi)
--   faqat orqaga qarar edi. Endi ikkala tomon ± oyna ichida qidiriladi va belgi juftning
--   KEYINGISIGA (created_at, id bo'yicha) qo'yiladi.
-- ============================================================================
-- Manba: 20261112000001_audit3_fixes.sql:1347
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
  v_first_at timestamptz;
  v_flag     uuid;   -- belgi qo'yiladigan (keyingi) yozuv
  v_orig     uuid;   -- uning juftidagi oldingi yozuv
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
    select m.id, m.created_at into v_first, v_first_at
      from public.movements m
     where m.company_id = v_company
       and m.created_by = v_by
       and m.object_id = v_object
       and m.material_id = v_material
       and m.type::text = v_type
       and m.qty_base = v_qty
       and m.deleted_at is null
       and m.id <> p_id
       and m.created_at <= v_created + make_interval(mins => v_window)
       and m.created_at >= v_created - make_interval(mins => v_window)
     order by m.created_at, m.id
     limit 1;
  elsif p_table = 'expenses' then
    select e.id, e.created_at into v_first, v_first_at
      from public.expenses e
     where e.company_id = v_company
       and e.created_by = v_by
       and e.category_id = v_category
       and e.object_id is not distinct from v_object
       and e.amount = v_total
       and e.deleted_at is null
       and e.id <> p_id
       and e.created_at <= v_created + make_interval(mins => v_window)
       and e.created_at >= v_created - make_interval(mins => v_window)
     order by e.created_at, e.id
     limit 1;
  else
    select p.id, p.created_at into v_first, v_first_at
      from public.purchases p
     where p.company_id = v_company
       and p.created_by = v_by
       and p.object_id = v_object
       and p.material_id = v_material
       and p.qty_base = v_qty
       and p.total_amount = v_total
       and p.deleted_at is null
       and p.id <> p_id
       and p.created_at <= v_created + make_interval(mins => v_window)
       and p.created_at >= v_created - make_interval(mins => v_window)
     order by p.created_at, p.id
     limit 1;
  end if;
  if v_first is null then
    return;
  end if;
  -- Juftning keyingisi belgilanadi. Topilgan eng erta mos yozuv bizdan keyin (created_at katta)
  -- bo'lsa — oynada bizdan oldingi mos yozuv yo'q: belgi o'sha keyingiga, jufti — biz.
  -- Vaqt teng (bir tranzaksiyadagi yozuvlar) — avvalgidek baholanayotgan yozuv belgilanadi.
  if v_first_at <= v_created then
    v_flag := p_id;
    v_orig := v_first;
  else
    v_flag := v_first;
    v_orig := p_id;
  end if;

  perform private.alert_lock('takroriy_yozuv:record:' || v_flag::text);
  if exists (
    select 1 from public.alerts a
     where a.company_id = v_company
       and a.type = 'takroriy_yozuv'
       and a.deleted_at is null
       and (a.details ->> 'record_id') = v_flag::text
       and (a.details ->> 'kind') = 'record'
  ) then
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, material_id, movement_id, purchase_id, details)
  values (v_company, 'takroriy_yozuv', 'belgi', v_object, v_material,
          case when p_table = 'movements' then v_flag end,
          case when p_table = 'purchases' then v_flag end,
          jsonb_build_object(
            'kind',           'record',
            'table',          p_table,
            'record_id',      v_flag,
            'first_id',       v_orig,
            'window_minutes', v_window,
            'qty_base',       v_qty,
            'total_amount',   v_total,
            'movement_type',  v_type)
          || case when p_table = 'expenses' then jsonb_build_object('category_id', v_category) else '{}'::jsonb end);
end;
$$;

-- ============================================================================
-- E9. tg-auth: initData replay himoyasi barcha izolyatlar uchun umumiy.
--   Bir xil `hash` bilan yangi sessiya: grace (p_grace_ms) ichida — ruxsat (Telegram
--   qayta yuborishi), keyin — rad, initData muddati (expires_at) tugaguncha.
--   Faqat service_role. Eskirgan qatorlar har soatda tozalanadi.
-- ============================================================================
create table private.used_init_data (
  hash          text        primary key,
  first_seen_at timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index used_init_data_expires_idx on private.used_init_data (expires_at);
alter table private.used_init_data enable row level security;
alter table private.used_init_data force row level security;
revoke all on private.used_init_data from public, anon, authenticated, service_role;

create function public.svc_use_init_data(p_hash text, p_expires_at timestamptz, p_grace_ms integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_first timestamptz;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{16,128}$' or p_expires_at is null
     or p_grace_ms is null or p_grace_ms < 0 then
    raise exception 'initData xeshi noto''g''ri'
      using errcode = '22023', hint = 'init_data_invalid';
  end if;
  insert into private.used_init_data as u (hash, first_seen_at, expires_at)
  values (p_hash, now(), p_expires_at)
  on conflict (hash) do update
     set first_seen_at = case when u.expires_at <= now() then now() else u.first_seen_at end,
         expires_at    = case when u.expires_at <= now() then excluded.expires_at else u.expires_at end
  returning u.first_seen_at into v_first;
  return now() - v_first <= make_interval(secs => p_grace_ms / 1000.0);
end;
$$;
revoke execute on function public.svc_use_init_data(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.svc_use_init_data(text, timestamptz, integer) to service_role;

create function private.purge_used_init_data()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from private.used_init_data where expires_at < now() - interval '1 hour';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function private.purge_used_init_data() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'terron-used-init-data-purge') then
    perform cron.unschedule('terron-used-init-data-purge');
  end if;
  perform cron.schedule('terron-used-init-data-purge', '17 * * * *', 'select private.purge_used_init_data()');
end $$;
