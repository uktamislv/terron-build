-- ============================================================================
-- Test topilmalari (tester, 26.10.2026) — NULL'ga chidamsiz rol tekshiruvlari.
--
-- `if not (has_role(admin) or (created_by = v_me and ...)) then raise` — yozuvning
-- created_by si NULL bo'lsa (tizim / seed / service_role yaratgan qator) ifoda NULL
-- bo'ladi, `not NULL` ham NULL, IF esa uni "false" deb o'tkazib yuboradi: ruxsat
-- tekshiruvi umuman ishlamaydi. Natija:
--   1. cancel_transfer — firmaning istalgan foydalanuvchisi (haydovchi, omborchi,
--      prorab, tekshiruvchi, direktor emas) created_by = NULL o'tkazmani bekor qila
--      olardi (role_matrix.sql.test.ts → "RPC / holat o'tishi — cancel_transfer").
--   2. submit_inventory_count — tekshiruvchi boshqa (created_by = NULL) sanashni
--      yubora olardi (own_entry_edit.sql.test.ts).
-- Tuzatish: coalesce(created_by = v_me, false). Mantiqning qolgan qismi o'zgarmagan
-- (funksiyalar 20261101000001_requests.sql va 20261109000001_audit2_fixes.sql dan
-- aynan ko'chirilgan). create or replace — grantlar saqlanadi.
-- ============================================================================

create or replace function public.cancel_transfer(p_transfer_id uuid, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.my_profile_id();
  v_t      public.transfers%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Sabab juda uzun (500 belgigacha)'
      using errcode = '22023', hint = 'transfer_invalid';
  end if;

  select t.* into v_t
    from public.transfers t
   where t.id = p_transfer_id and t.deleted_at is null
     for update;
  if not found or not private.can_access_company(v_t.company_id) then
    raise exception 'O''tkazma topilmadi' using errcode = 'P0002', hint = 'transfer_not_found';
  end if;
  -- P9: yaratuvchi hali `from` obyekt a'zosi bo'lishi shart (yoki admin)
  if not (private.has_role('super_admin', 'admin')
          or (coalesce(v_t.created_by = v_me, false)
              and v_t.from_object_id in (select private.my_object_ids()))) then
    raise exception 'Bu o''tkazmani bekor qilishga ruxsat yo''q'
      using errcode = '42501', hint = 'transfer_forbidden';
  end if;

  if v_t.status = 'bekor' then
    return;
  end if;
  if v_t.status <> 'yuborildi' then
    raise exception 'Qabul qilingan o''tkazmani bekor qilib bo''lmaydi'
      using errcode = '55000', hint = 'transfer_not_open';
  end if;

  perform set_config('terron.transfer_rpc', 'on', true);

  update public.movements m
     set deleted_at = now()
   where m.company_id = v_t.company_id
     and m.transfer_id = v_t.id
     and m.type = 'transfer_out'
     and m.deleted_at is null;

  update public.transfers
     set status = 'bekor', cancel_reason = v_reason
   where id = v_t.id;

  perform private.close_transfer_alerts(v_t.company_id, v_t.id, 'transfer_cancelled');

  perform set_config('terron.transfer_rpc', 'off', true);
end;
$$;

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
          or (private.has_role('tekshiruvchi') and coalesce(v_count.created_by = v_me, false))) then
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
  if not private.has_role('super_admin', 'admin') then
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('has_shortage', v_n > 0 or v_nc_pos > 0,
                            'not_counted_count', v_nc_count,
                            'movements_during_count', v_late_n);
end;
$$;
