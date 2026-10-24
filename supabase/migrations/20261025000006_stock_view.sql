-- ============================================================================
-- Batch 1 · 06 — qoldiq: movements dan hisoblanadi (alohida jadval yo'q).
-- security_invoker = true → movements RLS'i chaqiruvchi huquqida qo'llanadi.
-- ============================================================================

create view public.stock_balances
with (security_invoker = true)
as
select
  m.company_id,
  m.object_id,
  m.material_id,
  sum(
    case m.type
      when 'kirim'            then m.qty_base
      when 'transfer_in'      then m.qty_base
      when 'chiqim'           then -m.qty_base
      when 'transfer_out'     then -m.qty_base
      when 'inventory_adjust' then m.qty_base   -- ishorali
    end
  )::numeric(20,6) as qty_base,
  max(m.occurred_at) as last_movement_at
from public.movements m
where m.deleted_at is null
group by m.company_id, m.object_id, m.material_id;

comment on view public.stock_balances is
  'Qoldiq (asosiy birlikda) = kirim + transfer_in − chiqim − transfer_out + inventory_adjust; faqat o''chirilmagan harakatlar.';

revoke all on public.stock_balances from public, anon, authenticated, service_role;
grant select on public.stock_balances to authenticated, service_role;

-- ============================================================================
-- Inventarizatsiyani yuborish: draft → submitted. Har qator uchun qty_expected
-- shu paytdagi hisob qoldig'idan (stock_balances) to'ldiriladi. Statusni
-- o'zgartirishning yagona yo'li (authenticated uchun to'g'ridan-to'g'ri UPDATE
-- trigger bilan bloklangan).
-- Ruxsat: admin / super_admin yoki shu hisobni yaratgan tekshiruvchi.
-- ============================================================================
create function public.submit_inventory_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.my_profile_id();
  v_count   public.inventory_counts%rowtype;
begin
  if v_me is null then
    raise exception 'submit_inventory_count: not authenticated' using errcode = '42501';
  end if;

  select * into v_count
    from public.inventory_counts c
   where c.id = p_count_id
     and c.deleted_at is null
   for update;
  if not found or not private.can_access_company(v_count.company_id) then
    raise exception 'submit_inventory_count: count % not found', p_count_id using errcode = 'P0002';
  end if;

  if not (private.has_role('super_admin', 'admin')
          or (private.has_role('tekshiruvchi') and v_count.created_by = v_me)) then
    raise exception 'submit_inventory_count: not allowed' using errcode = '42501';
  end if;

  if v_count.status <> 'draft' then
    raise exception 'submit_inventory_count: count % is already %', p_count_id, v_count.status
      using errcode = '55000';
  end if;

  update public.inventory_count_items i
     set qty_expected = coalesce((
           select sb.qty_base
             from public.stock_balances sb
            where sb.company_id = v_count.company_id
              and sb.object_id = v_count.object_id
              and sb.material_id = i.material_id
         ), 0)
   where i.company_id = v_count.company_id
     and i.inventory_count_id = v_count.id
     and i.deleted_at is null;

  update public.inventory_counts
     set status = 'submitted'
   where id = v_count.id;
end;
$$;

revoke execute on function public.submit_inventory_count(uuid) from public, anon;
grant execute on function public.submit_inventory_count(uuid) to authenticated;
