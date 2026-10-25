-- ============================================================================
-- Batch 9 · 01 — hisobot RPC'lari (shartnoma: docs/reports-design.md → "RPC'lar")
--
--   public.dashboard_summary(p_from, p_to, p_object_id)          → jsonb
--   public.dashboard_daily(p_from, p_to, p_object_id)            → table (har Toshkent kuni)
--   public.spend_breakdown(p_from, p_to, p_object_id, p_group)   → table (guruh bo'yicha xarid)
--   public.norm_overview(p_object_id)                            → table (norm_usage + nomlar)
--
-- Hammasi `security invoker`, `stable`, `search_path = ''`: RLS chaqiruvchi huquqida
-- amal qiladi (prorab — a'zo obyektlar; tekshiruvchi movements/purchases ni ko'rmaydi;
-- alerts — faqat admin/direktor/buxgalter/super_admin). Execute — faqat authenticated.
--
-- Qo'shimcha qoidalar:
--   * Doim chaqiruvchining O'Z firmasi (`private.my_company_id()`) — super_admin ham
--     (RLS'dagi `is_super_admin() or …` OR-sharti indeksga tushmaydi; aniq company_id
--     sharti (company_id, vaqt) indekslarini ishlatadi). Profil yo'q / nofaol → nollar.
--   * `deleted_at is null` har jadvalda aniq (admin/direktor RLS bo'yicha o'chirilganlarni
--     ham ko'radi — hisobotga kirmaydi).
--   * Davr — Toshkent kunlari: [p_from 00:00, p_to + 1 00:00) Asia/Tashkent.
--     p_from/p_to null, p_from > p_to yoki p_to − p_from > 365 (ko'pi bilan 366 kun, ikkala chegara kiradi) → 22023 report_period_invalid.
--   * p_object_id chaqiruvchiga ko'rinmasa (RLS) yoki boshqa firmaniki — natija nol / bo'sh
--     (xato emas, mavjudligi sizmaydi).
--   * Pul va miqdor — `text` (aniq numeric qiymat).
--
-- Oldingi migratsiyalar o'zgartirilmaydi.
-- ============================================================================

-- ============================================================================
-- 0. Indekslar (davr bo'yicha firma kesimi; obyekt + vaqt kompozitlari)
--    Mavjudlar: movements_company_object_time_idx (company_id, object_id, occurred_at desc),
--    alerts_company_status_idx (company_id, status, created_at desc),
--    alerts_company_object_idx (company_id, object_id), transfers_open_to_idx,
--    material_requests_company_object_idx (company_id, object_id, status).
-- ============================================================================
create index movements_company_occurred_idx on public.movements (company_id, occurred_at)
  where deleted_at is null;
create index purchases_company_purchased_idx on public.purchases (company_id, purchased_at)
  where deleted_at is null;
create index purchases_company_object_purchased_idx on public.purchases (company_id, object_id, purchased_at)
  where deleted_at is null;
create index alerts_company_created_idx on public.alerts (company_id, created_at)
  where deleted_at is null;
create index cash_advances_company_issued_idx on public.cash_advances (company_id, issued_at)
  where deleted_at is null;

-- ============================================================================
-- 1. Yordamchilar
-- ============================================================================

-- Davr tekshiruvi va Toshkent kun chegaralari (UTC timestamptz).
create function private.report_period(
  p_from date,
  p_to   date,
  out o_start timestamptz,
  out o_end   timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'Davr noto''g''ri: boshlanish sanasi tugash sanasidan keyin bo''lmasligi va davr 366 kundan oshmasligi kerak'
      using errcode = '22023', hint = 'report_period_invalid';
  end if;
  o_start := p_from::timestamp at time zone 'Asia/Tashkent';
  o_end   := (p_to + 1)::timestamp at time zone 'Asia/Tashkent';
end;
$$;

-- Hisobot firmasi: chaqiruvchining o'z firmasi; p_object_id berilgan bo'lsa — u
-- chaqiruvchiga RLS bo'yicha ko'rinishi va shu firmaniki bo'lishi shart, aks holda null
-- (→ barcha yig'indilar nol). security invoker — objects RLS'i amal qiladi.
create function private.report_company(p_object_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_object_id is null then private.my_company_id()
    when exists (
      select 1 from public.objects o
       where o.id = p_object_id
         and o.company_id = private.my_company_id()
    ) then private.my_company_id()
  end
$$;

-- Xaridga bog'langan o'chirilmagan kirim bormi. security definer: movements RLS'idan
-- qat'i nazar (haydovchi harakatlarni ko'rmaydi, lekin o'z xaridining qabul holatini
-- ko'rishi kerak). Faqat chaqiruvchi firmasi (super_admin — istalgan); aks holda null.
-- Faqat boolean — miqdor sizmaydi. movements_company_purchase_idx ishlatiladi.
create function private.purchase_has_receipt(p_company_id uuid, p_purchase_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_company_id = private.my_company_id() or private.is_super_admin() then
      exists (
        select 1 from public.movements m
         where m.company_id = p_company_id
           and m.purchase_id = p_purchase_id
           and m.type = 'kirim'
           and m.deleted_at is null
      )
  end
$$;

revoke execute on function private.purchase_has_receipt(uuid, uuid) from public, anon;
grant execute on function private.purchase_has_receipt(uuid, uuid) to authenticated;

revoke execute on function private.report_period(date, date) from public, anon;
revoke execute on function private.report_company(uuid) from public, anon;
grant execute on function private.report_period(date, date) to authenticated;
grant execute on function private.report_company(uuid) to authenticated;

-- ============================================================================
-- 2. dashboard_summary
--   kirim_count, chiqim_count            — davrdagi harakatlar (occurred_at)
--   purchases_count, purchases_sum       — davrdagi xaridlar (purchased_at), summa text
--   cash_issued_sum                      — davrda berilgan podotchet (issued_at), text; obyektsiz
--   cash_on_hand_total                   — Σ cash_balances.balance (RLS ko'rgan qatorlar), text;
--                                          joriy holat, obyektsiz
--   alerts_open                          — ochiq (yangi | korildi), severity <> 'belgi'
--   alerts_serious_open                  — ochiq, severity = 'jiddiy'
--   alerts_new_in_period                 — davrda yaratilgan, severity <> 'belgi'
--   unreceived_purchases_count           — 24 soatdan eski, 90 kundan yangi, bog'langan tirik kirimi
--                                          yo'q xaridlar (private.purchase_has_receipt; joriy holat)
--   pending_transfers_count              — status = 'yuborildi' (obyekt: from yoki to)
--   pending_requests_count               — status = 'kutilmoqda'
--   objects_over_norm_count              — norm_usage: consumed > allowed materiali bor obyektlar (norm = 0 va sarf > 0 ham)
-- Obyekt filtri: obyektga bog'langan ko'rsatkichlarga; alerts — object_id = p_object_id.
-- ============================================================================
create function public.dashboard_summary(p_from date, p_to date, p_object_id uuid default null)
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

  select coalesce(sum(ca.amount), 0)
    into v_cash_iss
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

  -- Normadan oshgan (yoki smetada yo'q, lekin sarfi bor) materiali bor obyektlar —
  -- norm_usage (RLS: prorab a'zo obyektlari; tekshiruvchi/omborchi/haydovchi — 0).
  select count(distinct nu.object_id)
    into v_over
    from public.norm_usage nu
    join public.objects o
      on o.company_id = nu.company_id and o.id = nu.object_id and o.deleted_at is null
   where nu.company_id = v_company
     and nu.consumed_qty_base > nu.allowed_qty_base
     and (p_object_id is null or nu.object_id = p_object_id);

  -- Qabul qilinmagan: 24 soatdan eski, 90 kundan yangi, bog'langan tirik kirimi yo'q.
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
-- 3. dashboard_daily — har Toshkent kuni (p_from..p_to, bo'sh kunlar nol bilan):
--   kirim_count, chiqim_count (occurred_at), purchases_sum (purchased_at, text),
--   alerts_count (created_at, severity <> 'belgi'; obyekt filtri — alerts.object_id).
-- ============================================================================
create function public.dashboard_daily(p_from date, p_to date, p_object_id uuid default null)
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
  v_company := private.report_company(p_object_id);

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

-- ============================================================================
-- 4. spend_breakdown — davrdagi xaridlar guruh bo'yicha (purchases_sum desc).
--   p_group: material | object | buyer | supplier (boshqasi / null → 22023
--   report_group_invalid). key — guruh id (supplier yo'q xaridlar: key = null);
--   label — nom (RLS ko'rmasa yoki yo'q bo'lsa — null).
-- ============================================================================
create function public.spend_breakdown(
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
           when 'buyer'    then (select pr.full_name from public.profiles pr
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

-- ============================================================================
-- 5. norm_overview — norm_usage (joriy smetali obyektlar) + obyekt/material nomlari.
--   O'chirilgan obyektlar chiqmaydi. Miqdor va foiz — text. usage_pct null — ruxsat = 0.
--   norm_usage o'zi tekshiruvchiga bo'sh; estimates RLS — prorab a'zo obyektlari,
--   omborchi/haydovchi — hech narsa.
-- ============================================================================
create function public.norm_overview(p_object_id uuid default null)
returns table (
  object_id         uuid,
  object_name       text,
  material_id       uuid,
  material_name     text,
  base_unit         text,
  norm_qty_base     text,
  allowed_qty_base  text,
  consumed_qty_base text,
  usage_pct         text
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
         nu.usage_pct::text
    from public.norm_usage nu
    join public.objects o
      on o.company_id = nu.company_id and o.id = nu.object_id and o.deleted_at is null
    join public.materials mt
      on mt.company_id = nu.company_id and mt.id = nu.material_id
   where nu.company_id = private.my_company_id()
     and (p_object_id is null or nu.object_id = p_object_id)
   order by o.name, nu.object_id, mt.name, nu.material_id
$$;

-- ============================================================================
-- 6. Ruxsatlar
-- ============================================================================
revoke all on function
  public.dashboard_summary(date, date, uuid),
  public.dashboard_daily(date, date, uuid),
  public.spend_breakdown(date, date, uuid, text),
  public.norm_overview(uuid)
from public, anon;

grant execute on function
  public.dashboard_summary(date, date, uuid),
  public.dashboard_daily(date, date, uuid),
  public.spend_breakdown(date, date, uuid, text),
  public.norm_overview(uuid)
to authenticated;
