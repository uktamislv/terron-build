-- ============================================================================
-- Batch 8 · 01 — so'rovlar, o'tkazmalar, inventarizatsiya, norma
-- (shartnoma: docs/requests-design.md)
--
--   0. alert_type ga 'otkazma_farqi' (faqat plpgsql ichida, runtime'da).
--   1. private.norm_numbers + view public.norm_usage (security_invoker), indekslar.
--   2. Qoida 4 (normadan_oshish): private.evaluate_norm / evaluate_object_norms;
--      triggerlar movements (chiqim), estimates (joriy versiya soft delete / tiklash),
--      estimate_items (soft delete / tiklash); import_estimate va set_current_estimate
--      (create or replace) oxirida obyekt bo'yicha qayta baholash.
--   3. Qoida 6 (smetadan_ortiq_sorov): private.evaluate_request + triggerlar.
--   4. material_requests: decision_note, purchase_id (kompozit FK); guard moslandi.
--   5. transfers: received_qty_base, received_at, received_by, cancel_reason;
--      RPC create_transfer / receive_transfer / cancel_transfer; to'g'ridan-to'g'ri
--      INSERT/UPDATE (authenticated) — faqat RPC ichida (GUC terron.transfer_rpc).
--   6. Inventarizatsiya: inventory_count_items.qty_input, unit_id; qty_counted
--      bazada; inventory_counts.applied_at, applied_by; qoida 5
--      (submit_inventory_count — create or replace); apply_inventory_adjustments.
--   7. unit_is_referenced: inventory_count_items.unit_id ham.
--
-- Oldingi migratsiyalar o'zgartirilmaydi. Xato shakli: errcode + barqaror `hint` +
-- o'zbekcha `message` (docs/db-design.md → "Xato kalitlari").
--
-- Formulalar src/domain/{norms,inventory}.ts bilan bit-bit bir xil:
--   allowed        = round(norm_qty_base * (1 + waste_pct / 100), 6)   -- waste_pct numeric(6,2)
--   over_pct       = round((consumed - allowed) * 100 / allowed, 2)    -- numeric(20,6) kontekst
--   usage_pct      = round(consumed * 100 / allowed, 1)
--   shortage_value = round(shortage * price_per_base, 2)               -- price numeric(18,4)
-- sum() natijalari formulaga kirishdan oldin ::numeric(20,6) ga cast qilinadi.
-- ============================================================================

-- ============================================================================
-- 0. Yangi alert turi
-- ============================================================================
alter type public.alert_type add value if not exists 'otkazma_farqi';

-- ============================================================================
-- 0a. Y1 — tekshiruvchi kutilgan qoldiqni ko'rmasligi uchun: firma bo'yicha keng
--     ko'rish (movements, purchases) — is_company_wide() minus tekshiruvchi.
--     stock_balances, norm_usage, purchase_receipts, cash_balances shu jadvallar
--     orqali (security_invoker) avtomatik toraydi.
-- ============================================================================
create function private.is_company_wide_ops()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.my_role() in ('super_admin', 'admin', 'direktor', 'buxgalter', 'taminotchi'),
    false
  )
$$;
revoke execute on function private.is_company_wide_ops() from public, anon;
grant execute on function private.is_company_wide_ops() to authenticated, service_role;

drop policy movements_select on public.movements;
create policy movements_select on public.movements
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
    and (
      (select private.is_company_wide_ops())
      or ((select private.has_role('prorab', 'omborchi')) and object_id in (select private.my_object_ids()))
    )
  );

drop policy purchases_select on public.purchases;
create policy purchases_select on public.purchases
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
    and (
      (select private.is_company_wide_ops())
      or buyer_id = (select private.my_profile_id())
      or ((select private.has_role('prorab', 'omborchi')) and object_id in (select private.my_object_ids()))
    )
  );

-- ============================================================================
-- 1. Norma hisob-kitobi
-- ============================================================================

-- Obyekt + material: joriy smeta, norma, isrof, ruxsat etilgan, sarf (asosiy birlikda).
-- security definer — RLS'dan qat'i nazar butun firma ma'lumoti (qoida funksiyalari uchun).
create function private.norm_numbers(
  p_company_id  uuid,
  p_object_id   uuid,
  p_material_id uuid,
  out o_estimate_id      uuid,
  out o_estimate_version integer,
  out o_norm_qty_base    numeric,
  out o_waste_pct        numeric,
  out o_allowed_qty_base numeric,
  out o_consumed_qty_base numeric,
  out o_base_unit        text,
  out o_delivered_qty_base numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_est   uuid;
  v_ver   integer;
  v_norm  numeric(20,6) := 0;
  v_waste numeric(6,2);
  v_unit  text;
  v_cons  numeric(20,6);
  v_deliv numeric(20,6);
begin
  select e.id, e.version into v_est, v_ver
    from public.estimates e
   where e.company_id = p_company_id
     and e.object_id = p_object_id
     and e.is_current
     and e.deleted_at is null;

  select m.waste_pct, m.base_unit into v_waste, v_unit
    from public.materials m
   where m.company_id = p_company_id and m.id = p_material_id;
  v_waste := coalesce(v_waste, 0);

  if v_est is not null then
    select coalesce(sum(i.norm_qty_base), 0)::numeric(20,6) into v_norm
      from public.estimate_items i
     where i.company_id = p_company_id
       and i.estimate_id = v_est
       and i.material_id = p_material_id
       and i.item_type = 'material'
       and i.deleted_at is null;
  end if;

  select coalesce(sum(mv.qty_base), 0)::numeric(20,6) into v_cons
    from public.movements mv
   where mv.company_id = p_company_id
     and mv.object_id = p_object_id
     and mv.material_id = p_material_id
     and mv.type = 'chiqim'
     and mv.deleted_at is null;

  o_estimate_id       := v_est;
  o_estimate_version  := v_ver;
  o_norm_qty_base     := v_norm;
  o_waste_pct         := v_waste;
  o_allowed_qty_base  := round(v_norm * (1 + v_waste / 100), 6);
  -- Yetkazilgan (Y5): kirim + transfer_in − transfer_out, o'chirilmaganlar, shu obyekt
  select coalesce(sum(case mv.type when 'transfer_out' then -mv.qty_base else mv.qty_base end), 0)::numeric(20,6)
    into v_deliv
    from public.movements mv
   where mv.company_id = p_company_id
     and mv.object_id = p_object_id
     and mv.material_id = p_material_id
     and mv.type in ('kirim', 'transfer_in', 'transfer_out')
     and mv.deleted_at is null;

  o_consumed_qty_base := v_cons;
  o_base_unit         := v_unit;
  o_delivered_qty_base := v_deliv;
end;
$$;

-- Indekslar: smeta qatori (material bo'yicha), chiqim yig'indisi, ochiq so'rovlar.
create index estimate_items_norm_idx on public.estimate_items (company_id, estimate_id, material_id)
  where item_type = 'material' and deleted_at is null;
create index movements_chiqim_idx on public.movements (company_id, object_id, material_id)
  where type = 'chiqim' and deleted_at is null;
create index material_requests_open_idx on public.material_requests (company_id, object_id, material_id)
  where status in ('kutilmoqda', 'tasdiqlandi') and deleted_at is null;

-- ----------------------------------------------------------------------------
-- public.norm_usage — joriy smetasi bor obyektlar: smetadagi materiallar va
-- smetada yo'q, lekin sarfi bor materiallar (norm_qty_base = 0).
-- security_invoker: estimates / movements / material_requests / materials RLS'i
-- chaqiruvchi huquqida (prorab — a'zo obyektlar; omborchi, haydovchi — hech narsa).
-- ----------------------------------------------------------------------------
create view public.norm_usage
with (security_invoker = true) as
select e.company_id,
       e.object_id,
       pm.material_id,
       e.id                                          as estimate_id,
       n.norm_qty_base,
       a.allowed_qty_base,
       k.consumed_qty_base,
       d.delivered_qty_base,
       r.requested_open_qty_base,
       (a.allowed_qty_base - k.consumed_qty_base)::numeric(20,6) as remaining_qty_base,
       case when a.allowed_qty_base > 0
            then round(k.consumed_qty_base * 100 / a.allowed_qty_base, 1) end as usage_pct
  from public.estimates e
  cross join lateral (
    select i.material_id
      from public.estimate_items i
     where i.company_id = e.company_id
       and i.estimate_id = e.id
       and i.item_type = 'material'
       and i.deleted_at is null
       and i.material_id is not null
    union
    select mv.material_id
      from public.movements mv
     where mv.company_id = e.company_id
       and mv.object_id = e.object_id
       and mv.type = 'chiqim'
       and mv.deleted_at is null
  ) pm
  join public.materials mt on mt.company_id = e.company_id and mt.id = pm.material_id
  cross join lateral (
    select coalesce(sum(i.norm_qty_base), 0)::numeric(20,6) as norm_qty_base
      from public.estimate_items i
     where i.company_id = e.company_id
       and i.estimate_id = e.id
       and i.material_id = pm.material_id
       and i.item_type = 'material'
       and i.deleted_at is null
  ) n
  cross join lateral (
    select coalesce(sum(mv.qty_base), 0)::numeric(20,6) as consumed_qty_base
      from public.movements mv
     where mv.company_id = e.company_id
       and mv.object_id = e.object_id
       and mv.material_id = pm.material_id
       and mv.type = 'chiqim'
       and mv.deleted_at is null
  ) k
  cross join lateral (
    select coalesce(sum(case mv.type when 'transfer_out' then -mv.qty_base else mv.qty_base end), 0)::numeric(20,6)
             as delivered_qty_base
      from public.movements mv
     where mv.company_id = e.company_id
       and mv.object_id = e.object_id
       and mv.material_id = pm.material_id
       and mv.type in ('kirim', 'transfer_in', 'transfer_out')
       and mv.deleted_at is null
  ) d
  cross join lateral (
    select coalesce(sum(rq.qty_base), 0)::numeric(20,6) as requested_open_qty_base
      from public.material_requests rq
     where rq.company_id = e.company_id
       and rq.object_id = e.object_id
       and rq.material_id = pm.material_id
       and rq.status in ('kutilmoqda', 'tasdiqlandi')
       and rq.deleted_at is null
  ) r
  cross join lateral (
    select round(n.norm_qty_base * (1 + mt.waste_pct / 100), 6) as allowed_qty_base
  ) a
 where e.is_current
   and e.deleted_at is null
   -- Y1: tekshiruvchi kutilgan qoldiq/sarfni ko'rmaydi (ko'r-ko'rona sanash)
   and not (select private.has_role('tekshiruvchi'));

comment on view public.norm_usage is
  'Joriy smeta bo''yicha norma va sarf (asosiy birlikda): norm, isrof bilan ruxsat, chiqim, '
  'ochiq so''rovlar (kutilmoqda + tasdiqlandi), qolgan (allowed − consumed), ishlatilish %.';

revoke all on public.norm_usage from public, anon, authenticated, service_role;
grant select on public.norm_usage to authenticated, service_role;

-- ============================================================================
-- 2. Qoida 4 — normadan oshish (normadan_oshish)
--   norm = 0 (yoki allowed = 0): sarf > 0 → not_in_estimate (ogohlantirish), aks holda ok;
--   consumed > allowed → over: over_pct ≥ 25 → jiddiy, aks holda ogohlantirish;
--   aks holda ok. Joriy smeta yo'q → ochiq alertlar yopiladi (no_current_estimate).
--   Bitta ochiq alert (obyekt, material); boshqa smeta uchun ochilgani yopiladi
--   (estimate_changed). Raqamlar o'zgarmasa — yozilmaydi. Admin qo'lda yopgan alert
--   bir xil (smeta, allowed, consumed) da qayta yaratilmaydi.
-- ============================================================================
create unique index alerts_open_norm_key on public.alerts (object_id, material_id)
  where type = 'normadan_oshish' and status in ('yangi', 'korildi') and deleted_at is null;

-- ----------------------------------------------------------------------------
-- O1 — kuchayish xabari. notification_outbox.escalation (0 — asosiy xabar);
-- unique (alert_id) → (alert_id, escalation). tg_alerts_notify (create or replace)
-- yangi conflict maqsadi bilan.
-- ----------------------------------------------------------------------------
alter table public.notification_outbox
  add column escalation integer not null default 0
    constraint notification_outbox_escalation_check check (escalation >= 0);
drop index public.notification_outbox_alert_key;
create unique index notification_outbox_alert_key
  on public.notification_outbox (alert_id, escalation) where alert_id is not null;

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
  on conflict (alert_id, escalation) where alert_id is not null do nothing;

  if found then
    perform private.wake_dispatch();
  end if;
  return null;
end;
$$;

-- Daraja: over_pct ≥ 100 → 3; ≥ 50 → 2; jiddiy → 1; aks holda 0.
create function private.norm_escalation_level(p_severity public.alert_severity, p_over_pct numeric)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_over_pct >= 100 then 3
    when p_over_pct >= 50 then 2
    when p_severity = 'jiddiy' then 1
    else 0
  end
$$;

-- Alertning joriy holati bilan outbox'ga kuchayish qatori (payload + escalation).
-- Shu daraja bor bo'lsa — hech narsa. Qo'shilsa — dispatch uyg'otiladi.
create function private.enqueue_alert_escalation(p_alert_id uuid, p_level integer)
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
  on conflict (alert_id, escalation) where alert_id is not null do nothing;

  if found then
    perform private.wake_dispatch();
  end if;
end;
$$;

create function private.evaluate_norm(p_company_id uuid, p_object_id uuid, p_material_id uuid)
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

  -- Boshqa smeta (yoki joriy smeta yo'q) uchun ochiq alertlar — yopiladi
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
             details = v_details || jsonb_build_object(
               'auto_closed', true, 'closed_reason', 'within_threshold',
               'closed_by_actor', private.my_profile_id())
       where id = v_alert.id;
    end if;
    return;
  end if;

  if v_alert.id is not null then
    if v_alert.severity = v_sev and v_alert.details = v_details then
      return;
    end if;
    update public.alerts
       set severity = v_sev,
           details  = v_details
     where id = v_alert.id;
    -- O1: kuchayish — ogohlantirish → jiddiy (1), over_pct ≥ 50 (2), ≥ 100 (3);
    -- har daraja bitta alert uchun bir marta (outbox unique (alert_id, escalation)).
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

-- Obyekt bo'yicha: joriy smeta materiallari ∪ chiqim materiallari ∪ ochiq alert
-- materiallari (material id tartibida). Foydalanuvchi sessiyasida (authenticated,
-- invoker RPC ichidan) faqat smeta RPC ichida va o'z firmasi uchun.
create function private.evaluate_object_norms(p_company_id uuid, p_object_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mat uuid;
begin
  -- Foydalanuvchi sessiyasida — faqat o'z firmasi (natija faqat qayta baholash, ma'lumot qaytarmaydi)
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
end;
$$;

-- movements (chiqim): INSERT; UPDATE (qty_base / deleted_at / type / object_id /
-- material_id) — eski va yangi (obyekt, material) juftligi.
create function private.tg_movements_norm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if tg_op = 'INSERT' then
    perform private.evaluate_norm(new.company_id, new.object_id, new.material_id);
    return null;
  end if;
  for r in
    select distinct x.o, x.m
      from (select old.object_id as o, old.material_id as m, old.type as t
            union all
            select new.object_id, new.material_id, new.type) x
     where x.t = 'chiqim'
     order by x.o, x.m
  loop
    perform private.evaluate_norm(new.company_id, r.o, r.m);
  end loop;
  return null;
end;
$$;

create trigger zz_norm_rules_ins after insert on public.movements
  for each row
  when (new.type = 'chiqim')
  execute function private.tg_movements_norm();
create trigger zz_norm_rules_upd after update on public.movements
  for each row
  when ((old.type = 'chiqim' or new.type = 'chiqim')
    and (old.qty_base    is distinct from new.qty_base
      or old.deleted_at  is distinct from new.deleted_at
      or old.type        is distinct from new.type
      or old.object_id   is distinct from new.object_id
      or old.material_id is distinct from new.material_id))
  execute function private.tg_movements_norm();

-- estimates: joriy versiya soft delete / tiklash → obyekt bo'yicha qayta baholash.
-- (is_current o'zgarishi — RPC'lar o'zi chaqiradi.)
create function private.tg_estimates_norm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.evaluate_object_norms(new.company_id, new.object_id);
  return null;
end;
$$;

create trigger zz_norm_rules after update on public.estimates
  for each row
  when (old.deleted_at is distinct from new.deleted_at and (old.is_current or new.is_current))
  execute function private.tg_estimates_norm();

-- estimate_items: material qatori soft delete / tiklash (joriy smetada) → (obyekt, material).
create function private.tg_estimate_items_norm_eval()
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
  end if;
  return null;
end;
$$;

create trigger zz_norm_rules after update on public.estimate_items
  for each row
  when (old.deleted_at is distinct from new.deleted_at and new.item_type = 'material'
        and new.material_id is not null)
  execute function private.tg_estimate_items_norm_eval();

-- ============================================================================
-- 3. Qoida 6 — smetadan ortiq so'rov (smetadan_ortiq_sorov), severity = ogohlantirish.
--   available = allowed − consumed − other_open; over: requested > available;
--   over_qty = requested − available. Obyektda joriy smeta yo'q → alert yo'q (ochig'i
--   yopiladi: no_current_estimate). Joriy smeta bor, material unda yo'q →
--   not_in_estimate = true (allowed = 0). So'rov bo'yicha bitta ochiq alert.
--   Rad etilsa / o'chirilsa — yopiladi (request_rejected / request_deleted).
-- ============================================================================
create unique index alerts_open_request_key on public.alerts (request_id)
  where type = 'smetadan_ortiq_sorov' and status in ('yangi', 'korildi') and deleted_at is null;

create function private.evaluate_request(p_request_id uuid)
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

  -- O7: shu obyekt + material bo'yicha so'rovlar ketma-ket baholanadi
  perform pg_advisory_xact_lock(hashtext('terron.request:' || v_r.object_id::text || ':' || v_r.material_id::text));

  select * into v from private.norm_numbers(v_r.company_id, v_r.object_id, v_r.material_id);

  -- Obyektda joriy smeta umuman yo'q — asos yo'q, alert yaratilmaydi (ochig'i yopiladi)
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
  -- Y5: yetkazilgan (xarid qilinib kelgan) miqdor ham hisobga olinadi
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
             details = v_details || jsonb_build_object(
               'auto_closed', true, 'closed_reason', 'within_threshold',
               'closed_by_actor', private.my_profile_id())
       where id = v_alert.id;
    end if;
    return;
  end if;

  if v_alert.id is not null then
    if v_alert.details = v_details
       and v_alert.object_id is not distinct from v_r.object_id
       and v_alert.material_id is not distinct from v_r.material_id then
      return;
    end if;
    update public.alerts
       set details     = v_details,
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

create function private.tg_requests_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.deleted_at is not null
     or new.status = 'rad'
     or old.deleted_at is not null                       -- tiklash
     or old.status = 'rad'                               -- raddan qaytarildi (admin)
     or new.qty_base    is distinct from old.qty_base
     or new.object_id   is distinct from old.object_id
     or new.material_id is distinct from old.material_id then
    perform private.evaluate_request(new.id);
  end if;
  return null;
end;
$$;

create trigger zz_alert_rules_ins after insert on public.material_requests
  for each row execute function private.tg_requests_alerts();
create trigger zz_alert_rules_upd after update on public.material_requests
  for each row
  when (old.deleted_at  is distinct from new.deleted_at
     or old.status      is distinct from new.status
     or old.qty_base    is distinct from new.qty_base
     or old.object_id   is distinct from new.object_id
     or old.material_id is distinct from new.material_id)
  execute function private.tg_requests_alerts();

-- ============================================================================
-- 4. material_requests: decision_note, purchase_id
-- ============================================================================
alter table public.material_requests
  add column decision_note text
    constraint material_requests_decision_note_length_check
    check (decision_note is null or char_length(decision_note) <= 500),
  add column purchase_id uuid,
  add constraint material_requests_purchase_fkey
    foreign key (company_id, purchase_id) references public.purchases (company_id, id),
  add constraint material_requests_purchase_status_check
    check (purchase_id is null or status = 'xarid_qilindi');
create index material_requests_company_purchase_idx on public.material_requests (company_id, purchase_id)
  where purchase_id is not null;

-- Guard (Batch 3 versiyasi + Batch 8):
--   admin bo'lmagan (taminotchi): status, note; holat 'xarid_qilindi' bo'lsa — purchase_id ham.
--   O'tishlar: admin bo'lmagan — faqat tasdiqlandi → xarid_qilindi (tasdiqlash/rad — admin).
--   decision_note — faqat admin (INSERT'da admin bo'lmasa — null).
--   purchase_id: faqat 'xarid_qilindi' holatida; xarid shu firmada, o'chirilmagan,
--   shu obyekt va materialniki — hamma uchun.
create or replace function private.tg_material_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free       text[] := array['status', 'note', 'updated_at', 'decided_by', 'decided_at'];
  v_user       boolean := auth.uid() is not null and not private.has_role('super_admin', 'admin');
  v_p_object   uuid;
  v_p_material uuid;
begin
  if tg_op = 'INSERT' then
    if v_user then
      new.decision_note := null;
    end if;
    if new.status = 'kutilmoqda' then
      new.decided_by := null;
      new.decided_at := null;
    else
      new.decided_by := private.my_profile_id();
      new.decided_at := now();
    end if;
  else
    if v_user then
      if new.status = 'xarid_qilindi' then
        v_free := v_free || array['purchase_id'];
      end if;
      if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
        raise exception 'So''rovda faqat holat va izohni o''zgartirish mumkin'
          using errcode = '42501', hint = 'request_fields_locked';
      end if;
      -- O2: tasdiqlash / rad etish — faqat admin; taminotchi — faqat tasdiqlandi → xarid_qilindi
      if new.status is distinct from old.status
         and not (old.status = 'tasdiqlandi' and new.status = 'xarid_qilindi') then
        raise exception 'So''rov holatini "%" dan "%" ga o''zgartirib bo''lmaydi', old.status, new.status
          using errcode = '42501', hint = 'request_status_transition';
      end if;
    end if;

    if new.status is distinct from old.status then
      new.decided_by := private.my_profile_id();
      new.decided_at := now();
    else
      new.decided_by := old.decided_by;
      new.decided_at := old.decided_at;
    end if;
  end if;

  if new.purchase_id is not null
     and (tg_op = 'INSERT'
          or new.purchase_id is distinct from old.purchase_id
          or new.object_id   is distinct from old.object_id
          or new.material_id is distinct from old.material_id
          or new.status      is distinct from old.status) then
    if new.status <> 'xarid_qilindi' then
      raise exception 'Xaridni faqat "xarid qilindi" holatidagi so''rovga bog''lash mumkin'
        using errcode = '23514', hint = 'request_purchase_invalid';
    end if;
    select p.object_id, p.material_id into v_p_object, v_p_material
      from public.purchases p
     where p.company_id = new.company_id
       and p.id = new.purchase_id
       and p.deleted_at is null;
    if not found then
      raise exception 'Bog''langan xarid topilmadi yoki o''chirilgan'
        using errcode = '23503', hint = 'purchase_not_open';
    end if;
    if v_p_object is distinct from new.object_id or v_p_material is distinct from new.material_id then
      raise exception 'Xarid boshqa obyekt yoki materialga tegishli'
        using errcode = '23514', hint = 'request_purchase_invalid';
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 5. O'tkazmalar
-- ============================================================================
alter table public.transfers
  add column received_qty_base numeric(20,6)
    constraint transfers_received_qty_check check (received_qty_base is null or received_qty_base >= 0),
  add column received_at timestamptz,
  add column received_by uuid,
  add column cancel_reason text
    constraint transfers_cancel_reason_length_check
    check (cancel_reason is null or char_length(cancel_reason) <= 500),
  add constraint transfers_received_by_fkey
    foreign key (company_id, received_by) references public.profiles (company_id, id);
create index transfers_company_received_by_idx on public.transfers (company_id, received_by)
  where received_by is not null;
create index transfers_open_to_idx on public.transfers (company_id, to_object_id)
  where status = 'yuborildi' and deleted_at is null;

-- RPC ichidami (tranzaksiya-lokal GUC; PostgREST klienti o'rnata olmaydi).
create function private.transfer_rpc_active()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('terron.transfer_rpc', true), '') = 'on'
$$;

-- Foydalanuvchi (auth.uid bor) transfers ga faqat RPC orqali yozadi.
-- auth.uid() yo'q (service_role, migratsiya, cron) — tizim.
-- Nom b_transfers_guard — b_check_material va b_compute_qty dan keyin.
create function private.tg_transfers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.transfer_rpc_active() then
    raise exception 'O''tkazma faqat "O''tkazma" ekrani orqali yaratiladi va o''zgartiriladi'
      using errcode = '42501', hint = 'transfer_direct_edit';
  end if;
  return new;
end;
$$;

create trigger b_transfers_guard before insert or update on public.transfers
  for each row execute function private.tg_transfers_guard();

-- ----------------------------------------------------------------------------
-- create_transfer — prorab (from obyekt a'zosi) yoki admin. Bitta tranzaksiyada
-- transfers (yuborildi) + transfer_out harakati. Idempotent (p_id).
-- ----------------------------------------------------------------------------
create function public.create_transfer(
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

-- ----------------------------------------------------------------------------
-- receive_transfer — qabul qiluvchi obyektning prorab/omborchisi yoki admin.
-- Miqdor — o'tkazma birligida (null → yuborilgan). > 0 bo'lsa transfer_in harakati.
-- Farq bo'lsa — otkazma_farqi alert (ogohlantirish). Takroriy chaqiruv shu miqdor
-- bilan — o'zgarishsiz; boshqa miqdor — transfer_already_received.
-- ----------------------------------------------------------------------------
create function public.receive_transfer(
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

  perform set_config('terron.transfer_rpc', 'on', true);

  v_received := 0;
  if v_qty > 0 then
    insert into public.movements
      (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base,
       transfer_id, note, created_by)
    values
      (v_t.company_id, 'transfer_in', v_t.to_object_id, v_t.material_id, v_t.unit_id, v_qty, '-',
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

  -- Y4: o'zi yuborib o'zi qabul qildi → belgi
  if v_t.created_by = v_me then
    insert into public.alerts (company_id, type, severity, object_id, material_id, movement_id, details)
    values (v_t.company_id, 'ozi_qabul_qilgan', 'belgi', v_t.to_object_id, v_t.material_id, v_mv,
            jsonb_build_object('transfer_id', v_t.id, 'qty_base', v_received, 'buyer_id', null,
                               'receiver_id', v_me, 'kind', 'transfer'));
  end if;

  -- Y3: "qabul qilinmagan" alerti avtomatik yopiladi
  perform private.close_transfer_alerts(v_t.company_id, v_t.id, 'transfer_received');

  perform set_config('terron.transfer_rpc', 'off', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- cancel_transfer — yuborgan odam yoki admin, faqat 'yuborildi' holatida.
-- transfer_out soft delete (yozuv_ochirildi alerti yaratilmaydi — o'tkazma o'zi
-- bekor holatida tarixda), holat 'bekor'. Takroriy chaqiruv — o'zgarishsiz.
-- ----------------------------------------------------------------------------
create function public.cancel_transfer(p_transfer_id uuid, p_reason text default null)
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
          or (v_t.created_by = v_me and v_t.from_object_id in (select private.my_object_ids()))) then
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

-- ----------------------------------------------------------------------------
-- transfer_target_objects — o'tkazma "qayerga" ro'yxati: chaqiruvchi firmasining
-- faol (status = 'faol'), o'chirilmagan obyektlari — faqat id va nom.
-- Prorab RLS bo'yicha faqat a'zo obyektlarini ko'radi, shuning uchun definer.
-- Faqat create_transfer qila oladigan rollar (admin, super_admin, prorab); boshqalar — 42501.
-- ----------------------------------------------------------------------------
create function public.transfer_target_objects()
returns table (id uuid, name text)
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
  if not private.has_role('super_admin', 'admin', 'prorab') then
    raise exception 'O''tkazma yuborishga ruxsat yo''q'
      using errcode = '42501', hint = 'transfer_forbidden';
  end if;
  return query
    select o.id, o.name
      from public.objects o
     where o.company_id = v_company
       and o.deleted_at is null
       and o.status = 'faol'
     order by o.name, o.id;
end;
$$;

revoke execute on function public.transfer_target_objects() from public, anon;
grant execute on function public.transfer_target_objects() to authenticated;

-- ----------------------------------------------------------------------------
-- Y3 — qabul qilinmagan o'tkazma. companies.transfer_receive_hours (standart 48).
-- private.evaluate_due_transfers(p_now): 'yuborildi' holatida shu soatdan ko'p
-- turgan har o'tkazma uchun bitta otkazma_farqi alerti (direction = 'not_received');
-- qabul / bekor qilinganda avtomatik yopiladi (transfer_received / transfer_cancelled). Soatlik cron.
-- ----------------------------------------------------------------------------
alter table public.companies
  add column transfer_receive_hours integer not null default 48
    constraint companies_transfer_receive_hours_check check (transfer_receive_hours between 1 and 8760);

create index alerts_company_transfer_idx on public.alerts (company_id, (details ->> 'transfer_id'))
  where details ? 'transfer_id';

create function private.close_transfer_alerts(p_company_id uuid, p_transfer_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.alerts a
     set status  = 'yopildi',
         details = a.details || jsonb_build_object(
           'auto_closed', true, 'closed_reason', p_reason, 'closed_by_actor', private.my_profile_id())
   where a.company_id = p_company_id
     and (a.details ->> 'transfer_id') = p_transfer_id::text
     and a.details ? 'transfer_id'
     and a.type::text = 'otkazma_farqi'
     and (a.details ->> 'direction') = 'not_received'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null;
end;
$$;

create function private.evaluate_due_transfers(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   record;
  v_n integer := 0;
begin
  for r in
    select t.*, c.transfer_receive_hours as hrs,
           m.base_unit,
           fo.name as from_name, tob.name as to_name
      from public.transfers t
      join public.companies c on c.id = t.company_id
      join public.materials m on m.company_id = t.company_id and m.id = t.material_id
      join public.objects fo on fo.company_id = t.company_id and fo.id = t.from_object_id
      join public.objects tob on tob.company_id = t.company_id and tob.id = t.to_object_id
     where t.status = 'yuborildi'
       and t.deleted_at is null
       and c.is_active
       and c.deleted_at is null
       and t.created_at <= p_now - make_interval(hours => c.transfer_receive_hours)
       and not exists (
         select 1 from public.alerts a
          where a.company_id = t.company_id
            and a.details ? 'transfer_id'
            and (a.details ->> 'transfer_id') = t.id::text
            and a.type::text = 'otkazma_farqi'
            and (a.details ->> 'direction') = 'not_received'
            and a.deleted_at is null
       )
     order by t.id
  loop
    -- receive_transfer / cancel_transfer bilan bir xil qator qulfi; keyin qayta tekshirish
    perform 1 from public.transfers t3 where t3.id = r.id for update;
    continue when exists (
      select 1 from public.transfers t2 where t2.id = r.id and t2.status <> 'yuborildi'
    ) or exists (
      select 1 from public.alerts a
       where a.company_id = r.company_id and a.details ? 'transfer_id'
         and (a.details ->> 'transfer_id') = r.id::text
         and a.type::text = 'otkazma_farqi' and (a.details ->> 'direction') = 'not_received'
         and a.deleted_at is null
    );
    insert into public.alerts (company_id, type, severity, object_id, material_id, details)
    values (r.company_id, 'otkazma_farqi', 'ogohlantirish', r.to_object_id, r.material_id,
            jsonb_build_object(
              'transfer_id',      r.id,
              'direction',        'not_received',
              'sent_qty_base',    r.qty_base,
              'base_unit',        r.base_unit,
              'from_object_name', r.from_name,
              'to_object_name',   r.to_name,
              'sent_at',          r.created_at,
              'hours',            floor(extract(epoch from (p_now - r.created_at)) / 3600)::integer));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'terron-evaluate-transfers') then
    perform cron.unschedule('terron-evaluate-transfers');
  end if;
  perform cron.schedule(
    'terron-evaluate-transfers',
    '17 * * * *',
    'select private.evaluate_due_transfers()'
  );
end $$;

-- Batch 5 tg_soft_delete_alert: o'tkazma RPC ichidagi transfer_* harakati
-- o'chirilishi (bekor qilish) — 'yozuv_ochirildi' alerti yaratilmaydi.
create or replace function private.tg_soft_delete_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     jsonb := to_jsonb(new);
  v_details jsonb;
begin
  if tg_table_name = 'movements' and private.transfer_rpc_active()
     and (v_row ->> 'transfer_id') is not null then
    return null;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    v_details := jsonb_build_object(
      'table',            tg_table_name,
      'record_id',        new.id,
      'actor_profile_id', private.my_profile_id(),
      'actor_name',       (select p.full_name from public.profiles p where p.id = private.my_profile_id()),
      'material_id',      v_row -> 'material_id',
      'material_name',    (select m.name from public.materials m where m.id = (v_row ->> 'material_id')::uuid),
      'object_id',        v_row -> 'object_id'
    );
    if tg_table_name = 'cash_advances' then
      v_details := v_details || jsonb_build_object(
        'amount', v_row -> 'amount', 'recipient_id', v_row -> 'recipient_id',
        'recipient_name', (select p.full_name from public.profiles p where p.id = (v_row ->> 'recipient_id')::uuid));
    elsif tg_table_name = 'purchases' then
      v_details := v_details || jsonb_build_object(
        'amount', v_row -> 'total_amount', 'qty_base', v_row -> 'qty_base', 'buyer_id', v_row -> 'buyer_id',
        'buyer_name', (select p.full_name from public.profiles p where p.id = (v_row ->> 'buyer_id')::uuid));
    else
      v_details := v_details || jsonb_build_object(
        'qty_base', v_row -> 'qty_base', 'movement_type', v_row -> 'type', 'purchase_id', v_row -> 'purchase_id');
    end if;

    insert into public.alerts
      (company_id, type, severity, object_id, material_id, purchase_id, movement_id, details)
    values
      (new.company_id, 'yozuv_ochirildi', 'ogohlantirish',
       (v_row ->> 'object_id')::uuid, (v_row ->> 'material_id')::uuid,
       case when tg_table_name = 'purchases' then new.id end,
       case when tg_table_name = 'movements' then new.id end,
       v_details);
  elsif old.deleted_at is not null and new.deleted_at is null then
    update public.alerts a
       set status  = 'yopildi',
           details = a.details || jsonb_build_object(
             'auto_closed', true, 'closed_reason', 'restored',
             'closed_by_actor', private.my_profile_id())
     where a.company_id = new.company_id
       and (a.details ->> 'record_id') = new.id::text
       and a.type = 'yozuv_ochirildi'
       and a.status in ('yangi', 'korildi')
       and a.deleted_at is null;
  end if;
  return null;
end;
$$;

-- ============================================================================
-- 6. Inventarizatsiya
-- ============================================================================
alter table public.inventory_count_items
  add column qty_input numeric(20,6)
    constraint inventory_count_items_qty_input_check check (qty_input is null or qty_input >= 0),
  add column unit_id uuid,
  add constraint inventory_count_items_unit_fkey
    foreign key (company_id, unit_id) references public.material_units (company_id, id),
  -- eski qatorlar: ikkalasi null; yangilari: ikkalasi bor (trigger to'ldiradi)
  add constraint inventory_count_items_unit_pair_check check ((unit_id is null) = (qty_input is null));
create index inventory_count_items_company_unit_idx on public.inventory_count_items (company_id, unit_id);
-- (inventory_count_id, material_id) unique o'chirilmaganlar orasida — Batch 1 dan
-- (inventory_count_items_count_material_key).

alter table public.inventory_counts
  add column applied_at timestamptz,
  add column applied_by uuid,
  add constraint inventory_counts_applied_by_fkey
    foreign key (company_id, applied_by) references public.profiles (company_id, id);
create index inventory_counts_company_applied_by_idx on public.inventory_counts (company_id, applied_by)
  where applied_by is not null;

-- ----------------------------------------------------------------------------
-- b_compute_counted: qty_counted = round(qty_input * factor, 6) bazada (klient
-- qiymati e'tiborsiz). Qulf tartibi: materials → material_units (for share).
--   INSERT: unit_id yo'q → asosiy birlik; qty_input yo'q → qty_counted (asosiy
--           birlikda kiritilgan deb olinadi — eski klientlar bilan moslik).
--   UPDATE: unit_id va qty_input ikkalasi null (eski qator) → qty_counted o'zgarmaydi.
--           qty_input bor, unit_id yo'q → asosiy birlik.
--   O'chirilgan birlik faqat eski (o'zgarmagan) qatorda qolishi mumkin.
-- Nom b_compute_counted — b_check_material dan keyin, b_inventory_items_guard dan oldin.
-- ----------------------------------------------------------------------------
create function private.tg_inventory_items_counted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_id  uuid := new.unit_id;
  v_old_unit uuid;
  v_material uuid;
  v_factor   numeric;
begin
  if tg_op = 'UPDATE' then
    v_old_unit := old.unit_id;
    if new.unit_id is null and new.qty_input is null then
      new.qty_counted := old.qty_counted;
      return new;
    end if;
  elsif new.qty_input is null and new.unit_id is null then
    new.qty_input := new.qty_counted;
  end if;

  perform 1
     from public.materials m
    where m.company_id = new.company_id
      and m.id = new.material_id
      for share;

  if v_unit_id is null then
    select mu.id into v_unit_id
      from public.material_units mu
      join public.materials m on m.company_id = mu.company_id and m.id = mu.material_id
     where mu.company_id = new.company_id
       and mu.material_id = new.material_id
       and mu.unit = m.base_unit
       and mu.factor = 1
       and mu.variant is null
       and mu.deleted_at is null;
  end if;

  select mu.material_id, mu.factor
    into v_material, v_factor
    from public.material_units mu
   where mu.company_id = new.company_id
     and mu.id = v_unit_id
     and (mu.deleted_at is null or mu.id = v_old_unit)
     for share;
  if not found then
    raise exception 'Birlik topilmadi yoki o''chirilgan'
      using errcode = '23503', hint = 'ops_unit_not_found';
  end if;
  if v_material is distinct from new.material_id then
    raise exception 'Tanlangan birlik bu materialga tegishli emas'
      using errcode = '23503', hint = 'ops_unit_material_mismatch';
  end if;

  new.unit_id     := v_unit_id;
  new.qty_counted := round(new.qty_input * v_factor, 6);
  return new;
end;
$$;

create trigger b_compute_counted before insert or update on public.inventory_count_items
  for each row execute function private.tg_inventory_items_counted();

-- inventory_counts guard: status va applied_* — faqat RPC (security definer).
create or replace function private.tg_inventory_counts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.applied_at := null;
    new.applied_by := null;
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'Inventarizatsiya holati faqat "Yuborish" orqali o''zgaradi'
      using errcode = '42501', hint = 'inventory_status_direct';
  end if;
  if new.applied_at is distinct from old.applied_at or new.applied_by is distinct from old.applied_by then
    raise exception 'Qoldiq faqat "Qoldiqni tuzatish" orqali tuzatiladi'
      using errcode = '42501', hint = 'inventory_apply_direct';
  end if;
  return new;
end;
$$;

create trigger b_inventory_counts_guard_ins before insert on public.inventory_counts
  for each row execute function private.tg_inventory_counts_guard();

-- ----------------------------------------------------------------------------
-- O5 — kutilgan qoldiq yashiriladi: qty_expected va price_per_base (yangi —
-- yuborish paytidagi 90 kunlik narx) ustunlarini authenticated o'qimaydi va
-- yozmaydi (column grant + guard). Ko'rish — public.inventory_count_details().
-- ----------------------------------------------------------------------------
alter table public.inventory_count_items
  add column price_per_base numeric(18,4)
    constraint inventory_count_items_price_check check (price_per_base is null or price_per_base >= 0);

revoke select on public.inventory_count_items from authenticated;
grant select (id, company_id, inventory_count_id, material_id, qty_counted, note,
              created_by, created_at, updated_at, deleted_at, qty_input, unit_id)
  on public.inventory_count_items to authenticated;

create or replace function private.tg_inventory_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.qty_expected   := null;
      new.price_per_base := null;
    else
      new.qty_expected   := old.qty_expected;
      new.price_per_base := old.price_per_base;
    end if;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- O4 — yuborilgan (draft emas) hisobning qatorlari qulflangan: INSERT/UPDATE
-- hamma uchun (service_role, superuser ham) rad — faqat inventarizatsiya RPC'lari
-- ichida (GUC terron.inventory_rpc). hint inventory_locked.
-- ----------------------------------------------------------------------------
create function private.inventory_rpc_active()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('terron.inventory_rpc', true), '') = 'on'
$$;

create function private.tg_inventory_items_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked boolean;
begin
  if private.inventory_rpc_active() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    select c.status <> 'draft' into v_locked
      from public.inventory_counts c
     where c.company_id = new.company_id and c.id = new.inventory_count_id;
  else
    select bool_or(c.status <> 'draft') into v_locked
      from public.inventory_counts c
     where c.company_id = new.company_id and c.id in (old.inventory_count_id, new.inventory_count_id);
  end if;
  if coalesce(v_locked, false) then
    raise exception 'Inventarizatsiya yakunlangan — qatorlarni o''zgartirib bo''lmaydi'
      using errcode = '42501', hint = 'inventory_locked';
  end if;
  return new;
end;
$$;

create trigger b_inventory_items_lock before insert or update on public.inventory_count_items
  for each row execute function private.tg_inventory_items_lock();

-- Material narxi (asosiy birlikda): oxirgi 90 kunlik xaridlar, miqdorga tortilgan.
create function private.inventory_price(p_company_id uuid, p_material_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select round(sum(pu.total_amount) / nullif(sum(pu.qty_base), 0), 4)::numeric(18,4)
    from public.purchases pu
   where pu.company_id = p_company_id
     and pu.material_id = p_material_id
     and pu.deleted_at is null
     and pu.purchased_at >= now() - interval '90 days'
$$;

-- ----------------------------------------------------------------------------
-- Qoida 5 — inventarizatsiya kamomadi (submit_inventory_count ichida).
--   (a) sanalgan qatorlar: qty_counted < qty_expected;
--   (b) Y2 — sanalmagan materiallar: obyektda qoldig'i > 0, lekin qatori yo'q
--       (expected = qoldiq, counted = 0).
--   Narx — private.inventory_price (yuborish paytida, qatorga price_per_base
--   sifatida saqlanadi); shortage_value = round(shortage * price_per_base, 2);
--   total = Σ shortage_value (a + b; hammasi null → null); ≥ 1 000 000 → jiddiy.
--   Ro'yxatlar 20 tagacha (kamomad kattasidan, material_id), qolgani *_more.
--   Natija (jsonb, raqamsiz): {has_shortage, not_counted_count} — not_counted_count:
--   qoldig'i ≠ 0, lekin sanalmagan materiallar soni.
-- ----------------------------------------------------------------------------
create unique index alerts_inventory_shortage_key on public.alerts (inventory_count_id)
  where type = 'inventarizatsiya_kamomadi' and deleted_at is null;

drop function public.submit_inventory_count(uuid);

create function public.submit_inventory_count(p_count_id uuid)
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
     set qty_expected = coalesce((
           select sb.qty_base
             from public.stock_balances sb
            where sb.company_id = v_count.company_id
              and sb.object_id = v_count.object_id
              and sb.material_id = i.material_id
         ), 0),
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
                               'total_shortage_value', v_total));
  end if;

  perform set_config('terron.inventory_rpc', 'off', true);
  return jsonb_build_object('has_shortage', v_n > 0 or v_nc_pos > 0, 'not_counted_count', v_nc_count);
end;
$$;

revoke execute on function public.submit_inventory_count(uuid) from public, anon;
grant execute on function public.submit_inventory_count(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- inventory_count_details — admin, direktor, buxgalter, super_admin: hisob
-- qatorlari kutilgan qoldiq, farq va kamomad qiymati bilan. shortage_value —
-- alert formulasi bilan aynan: round((expected − counted)::numeric(20,6) *
-- price_per_base, 2), narx — yuborish paytida saqlangan. Raqamlar — text (aniqlik saqlanadi).
-- ----------------------------------------------------------------------------
create function public.inventory_count_details(p_count_id uuid)
returns table (
  material_id    uuid,
  material_name  text,
  base_unit      text,
  qty_input      text,
  unit_id        uuid,
  qty_counted    text,
  qty_expected   text,
  diff           text,
  shortage_value text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if private.my_profile_id() is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  select c.company_id into v_company
    from public.inventory_counts c
   where c.id = p_count_id and c.deleted_at is null;
  if v_company is null or not private.can_access_company(v_company) then
    raise exception 'Inventarizatsiya topilmadi' using errcode = 'P0002', hint = 'inventory_not_found';
  end if;
  if not private.has_role('super_admin', 'admin', 'direktor', 'buxgalter') then
    raise exception 'Inventarizatsiya natijasini ko''rishga ruxsat yo''q'
      using errcode = '42501', hint = 'inventory_details_forbidden';
  end if;

  return query
    select i.material_id, m.name, m.base_unit, i.qty_input::text, i.unit_id, i.qty_counted::text,
           i.qty_expected::text,
           ((i.qty_counted - i.qty_expected)::numeric(20,6))::text,
           (case when i.qty_counted < i.qty_expected
                 then round((i.qty_expected - i.qty_counted)::numeric(20,6) * i.price_per_base, 2) end)::text
      from public.inventory_count_items i
      join public.materials m on m.company_id = i.company_id and m.id = i.material_id
     where i.company_id = v_company
       and i.inventory_count_id = p_count_id
       and i.deleted_at is null
     order by m.name, i.material_id;
end;
$$;

revoke execute on function public.inventory_count_details(uuid) from public, anon;
grant execute on function public.inventory_count_details(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- inventory_candidate_materials — tekshiruvchi / admin / super_admin: obyektda
-- qoldig'i ≠ 0 yoki joriy smetada bor (o'chirilmagan) materiallar — miqdorsiz.
-- ----------------------------------------------------------------------------
create function public.inventory_candidate_materials(p_object_id uuid)
returns table (material_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if private.my_profile_id() is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  select o.company_id into v_company
    from public.objects o
   where o.id = p_object_id and o.deleted_at is null;
  if v_company is null or not private.can_access_company(v_company) then
    raise exception 'Obyekt topilmadi' using errcode = 'P0002', hint = 'inventory_object_not_found';
  end if;
  if not private.has_role('super_admin', 'admin', 'tekshiruvchi') then
    raise exception 'Inventarizatsiyaga ruxsat yo''q' using errcode = '42501', hint = 'inventory_forbidden';
  end if;

  return query
    select x.mid
      from (
        select sb.material_id as mid
          from public.stock_balances sb
         where sb.company_id = v_company and sb.object_id = p_object_id and sb.qty_base <> 0
        union
        select i.material_id
          from public.estimate_items i
          join public.estimates e on e.company_id = i.company_id and e.id = i.estimate_id
         where e.company_id = v_company and e.object_id = p_object_id
           and e.is_current and e.deleted_at is null
           and i.item_type = 'material' and i.deleted_at is null and i.material_id is not null
      ) x
      join public.materials m on m.company_id = v_company and m.id = x.mid and m.deleted_at is null
     order by x.mid;
end;
$$;

revoke execute on function public.inventory_candidate_materials(uuid) from public, anon;
grant execute on function public.inventory_candidate_materials(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- apply_inventory_adjustments — admin. Yuborilgan (submitted), hali qo'llanmagan
-- hisob: har farq (counted − expected ≠ 0) uchun inventory_adjust harakati
-- (asosiy birlikda, ishorali, inventory_count_id bilan). Bitta tranzaksiya.
-- qty_expected null qatorlar (yuborilgandan keyin qo'shilgan) — o'tkazib yuboriladi.
-- Qaytaradi: yaratilgan harakatlar soni.
-- ----------------------------------------------------------------------------
create function public.apply_inventory_adjustments(p_count_id uuid)
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

  -- P5: kamomad alertiga tuzatish belgisi (alert yopilmaydi)
  update public.alerts a
     set details = a.details || jsonb_build_object(
           'applied_at', now(),
           'applied_by_name', (select p.full_name from public.profiles p where p.id = v_me))
   where a.company_id = v_count.company_id
     and a.inventory_count_id = v_count.id
     and a.type = 'inventarizatsiya_kamomadi'
     and a.deleted_at is null;

  return v_n;
end;
$$;

-- ============================================================================
-- 2a. Smeta RPC'lari (Batch 7, create or replace): o'zgarish faqat oxirida —
--     private.evaluate_object_norms (qoida 4, yangi joriy versiya bo'yicha).
-- ============================================================================
create or replace function public.import_estimate(
  p_id               uuid,
  p_object_id        uuid,
  p_title            text,
  p_source_file_name text,
  p_estimate_date    date,
  p_items            jsonb
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c_max_rows constant integer := 5000;
  c_uuid_re  constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_num_re   constant text := '^\s*[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]{1,3})?\s*$';
  v_me       uuid := private.my_profile_id();
  v_company  uuid;
  v_obj_del  timestamptz;
  v_ex_obj   uuid;
  v_title    text := btrim(p_title);
  v_file     text := nullif(btrim(p_source_file_name), '');
  v_n        integer;
  v_rows     jsonb;
  v_err      jsonb;
  v_version  integer;
  v_ex_hash  text;
  v_hash     text;
  v_prev_id  uuid;
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan'
      using errcode = '42501', hint = 'auth_required';
  end if;
  if not private.has_role('super_admin', 'admin', 'buxgalter') then
    raise exception 'Smeta yuklashga ruxsat yo''q'
      using errcode = '42501', hint = 'estimate_import_forbidden';
  end if;
  if p_id is null or p_object_id is null then
    raise exception 'Smeta yoki obyekt ko''rsatilmagan'
      using errcode = '22023', hint = 'estimate_invalid';
  end if;

  select o.company_id, o.deleted_at into v_company, v_obj_del
    from public.objects o
   where o.id = p_object_id;
  if not found or v_obj_del is not null then
    raise exception 'Obyekt topilmadi'
      using errcode = 'P0002', hint = 'estimate_object_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('terron.estimate_version:' || p_object_id::text, 0));

  v_hash := encode(extensions.digest(
              convert_to(jsonb_build_object('object_id', p_object_id, 'title', p_title,
                                            'items', p_items)::text, 'UTF8'),
              'sha256'), 'hex');
  select e.object_id, e.import_hash into v_ex_obj, v_ex_hash
    from public.estimates e
   where e.id = p_id;
  if found then
    if v_ex_obj is distinct from p_object_id then
      raise exception 'Bu smeta id boshqa obyektga tegishli'
        using errcode = '23505', hint = 'estimate_id_conflict';
    end if;
    if v_ex_hash is distinct from v_hash then
      raise exception 'Bu smeta id boshqa mazmun bilan allaqachon ishlatilgan'
        using errcode = '23505', hint = 'estimate_id_reused';
    end if;
    return p_id;
  end if;

  if p_estimate_date is not null
     and (p_estimate_date < date '2000-01-01'
          or p_estimate_date > ((now() at time zone 'Asia/Tashkent')::date + interval '1 year')::date) then
    raise exception 'Smeta sanasi noto''g''ri (01.01.2000 dan bugun + 1 yilgacha)'
      using errcode = '22023', hint = 'estimate_invalid';
  end if;

  if v_title is null or v_title = '' or length(v_title) > 200 then
    raise exception 'Smeta nomi bo''sh yoki juda uzun (200 belgigacha)'
      using errcode = '22023', hint = 'estimate_invalid';
  end if;
  if v_file is not null and length(v_file) > 255 then
    raise exception 'Fayl nomi juda uzun (255 belgigacha)'
      using errcode = '22023', hint = 'estimate_invalid';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Smeta qatorlari ro''yxat bo''lishi kerak'
      using errcode = '22023', hint = 'estimate_invalid';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n = 0 then
    raise exception 'Smetada qator yo''q'
      using errcode = '22023', hint = 'estimate_invalid';
  end if;
  if v_n > c_max_rows then
    raise exception 'Smetada qatorlar juda ko''p: % (ko''pi bilan %)', v_n, c_max_rows
      using errcode = '22023', hint = 'estimate_too_many_rows';
  end if;

  with src as (
    select e.ord::integer as idx, e.j
      from jsonb_array_elements(p_items) with ordinality as e(j, ord)
  ),
  t as (
    select s.idx,
           jsonb_typeof(s.j) = 'object'                         as is_obj,
           case when jsonb_typeof(s.j) = 'object' then s.j end  as j
      from src s
  ),
  f as (
    select t.idx, t.is_obj,
           t.j ->> 'item_type'                         as item_type,
           btrim(t.j ->> 'name')                       as name,
           nullif(btrim(t.j ->> 'unit'), '')           as unit,
           nullif(btrim(t.j ->> 'code'), '')           as code,
           nullif(btrim(t.j ->> 'material_id'), '')    as mat_t,
           nullif(btrim(t.j ->> 'unit_id'), '')        as unit_t,
           t.j ->> 'qty'                               as qty_t,
           nullif(btrim(t.j ->> 'unit_price'), '')     as price_t,
           t.j ->> 'row_number'                        as rn_t,
           t.j ->> 'sort_order'                        as so_t
      from t
  ),
  p as (
    select f.*,
           case when f.mat_t  ~ c_uuid_re then f.mat_t::uuid end                      as material_id,
           case when f.unit_t ~ c_uuid_re then f.unit_t::uuid end                     as unit_id,
           case when f.qty_t   ~ c_num_re then f.qty_t::numeric end                   as qty,
           case when f.price_t ~ c_num_re then f.price_t::numeric end                 as unit_price,
           case when f.rn_t ~ '^\s*[0-9]{1,9}\s*$' then f.rn_t::integer end           as row_number,
           case when f.so_t ~ '^\s*-?[0-9]{1,9}\s*$' then f.so_t::integer end         as sort_order
      from f
  ),
  v as (
    select p.*,
           m.id as m_id, m.name as m_name, m.deleted_at as m_deleted,
           u.id as u_id, u.material_id as u_material, u.deleted_at as u_deleted,
           case
             when not p.is_obj then 'qator noto''g''ri formatda'
             when p.item_type is null or p.item_type not in ('ish', 'material')
               then 'turi «ish» yoki «material» bo''lishi kerak'
             when p.name is null or p.name = '' then 'nomi bo''sh'
             when length(p.name) > 1000 then 'nomi juda uzun (1000 belgigacha)'
             when p.qty_t is null then 'miqdor ko''rsatilmagan'
             when p.qty is null then 'miqdor raqam emas'
             when round(p.qty, 6) <= 0 then 'miqdor 0 dan katta bo''lishi kerak'
             when p.qty >= 1e14 then 'miqdor juda katta'
             when p.price_t is not null and p.unit_price is null then 'narx raqam emas'
             when p.unit_price < 0 then 'narx manfiy bo''lishi mumkin emas'
             when p.unit_price >= 1e16 then 'narx juda katta'
             when p.unit is not null and length(p.unit) > 50 then 'birlik matni juda uzun (50 belgigacha)'
             when p.code is not null and length(p.code) > 100 then 'shifr juda uzun (100 belgigacha)'
             when p.rn_t is not null and (p.row_number is null or p.row_number < 1) then 'qator raqami noto''g''ri'
             when p.so_t is not null and p.sort_order is null then 'tartib raqami noto''g''ri'
             when p.item_type = 'ish' and (p.mat_t is not null or p.unit_t is not null)
               then 'ish qatorida material va birlik bo''lmaydi'
             when p.item_type = 'ish' then null
             when p.mat_t is null then 'material tanlanmagan'
             when m.id is null then 'material topilmadi'
             when m.deleted_at is not null then 'material o''chirilgan: ' || m.name
             when p.unit_t is null then 'birlik tanlanmagan'
             when u.id is null or u.deleted_at is not null then 'birlik topilmadi yoki o''chirilgan'
             when u.material_id is distinct from m.id then 'birlik bu materialga tegishli emas'
             when round(p.qty * u.factor, 6) >= 1e14 then 'asosiy birlikdagi miqdor juda katta'
           end as err
      from p
      left join public.materials m
        on p.item_type = 'material' and m.company_id = v_company and m.id = p.material_id
      left join public.material_units u
        on p.item_type = 'material' and u.company_id = v_company and u.id = p.unit_id
  )
  select
    jsonb_agg(jsonb_build_object(
      'idx', v.idx, 'item_type', v.item_type, 'name', v.name,
      'material_id', case when v.item_type = 'material' then v.material_id end,
      'unit_id',     case when v.item_type = 'material' then v.unit_id end,
      'unit', v.unit, 'qty', v.qty, 'unit_price', v.unit_price, 'code', v.code,
      'row_number', v.row_number, 'sort_order', coalesce(v.sort_order, v.idx)
    ) order by v.idx),
    (array_agg(jsonb_build_object('idx', v.idx, 'err', v.err,
                                  'row_number', case when v.row_number >= 1 then v.row_number end)
               order by v.idx)
       filter (where v.err is not null))[1]
  into v_rows, v_err
  from v;

  if v_err is not null then
    raise exception 'Qator %: %',
        coalesce(v_err ->> 'row_number', '#' || (v_err ->> 'idx')), v_err ->> 'err'
      using errcode = '22023', hint = 'estimate_item_invalid',
            detail = coalesce(v_err ->> 'row_number', v_err ->> 'idx');
  end if;

  perform set_config('terron.estimate_rpc', 'on', true);

  select e.id into v_prev_id
    from public.estimates e
   where e.company_id = v_company
     and e.object_id = p_object_id
     and e.is_current
     and e.deleted_at is null;

  select coalesce(max(e.version), 0) + 1 into v_version
    from public.estimates e
   where e.company_id = v_company
     and e.object_id = p_object_id;

  update public.estimates e
     set is_current = false
   where e.company_id = v_company
     and e.object_id = p_object_id
     and e.is_current;

  insert into public.estimates
    (id, company_id, object_id, version, title, estimate_date, source_file_name, is_current, import_hash, created_by)
  values
    (p_id, v_company, p_object_id, v_version, v_title, p_estimate_date, v_file, true, v_hash, v_me);

  insert into public.estimate_items
    (company_id, estimate_id, item_type, name, material_id, unit_id, unit, qty, unit_price,
     code, row_number, sort_order, created_by)
  select v_company, p_id, r.item_type::public.estimate_item_type, r.name, r.material_id, r.unit_id,
         r.unit, r.qty, r.unit_price, r.code, r.row_number, r.sort_order, v_me
    from jsonb_to_recordset(v_rows) as r(
           idx integer, item_type text, name text, material_id uuid, unit_id uuid, unit text,
           qty numeric, unit_price numeric, code text, row_number integer, sort_order integer)
   order by r.material_id nulls first, r.idx;

  perform private.estimate_alert('norm_increase', p_id, v_prev_id);
  -- Batch 8: qoida 4 — yangi joriy versiya bo'yicha qayta baholash
  perform private.evaluate_object_norms(v_company, p_object_id);

  perform set_config('terron.estimate_rpc', 'off', true);
  return p_id;
end;
$$;

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
  -- Batch 8: qoida 4 — joriy versiya bo'yicha qayta baholash (o'zgarmasa — yozuv yo'q)
  perform private.evaluate_object_norms(v_company, v_object);

  perform set_config('terron.estimate_rpc', 'off', true);
end;
$$;

-- ============================================================================
-- 7. unit_is_referenced: inventory_count_items.unit_id ham (o'chirilganlari ham)
-- ============================================================================
create or replace function private.unit_is_referenced(p_company_id uuid, p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.movements t             where t.company_id = p_company_id and t.unit_id = p_unit_id)
      or exists (select 1 from public.purchases t             where t.company_id = p_company_id and t.unit_id = p_unit_id)
      or exists (select 1 from public.transfers t             where t.company_id = p_company_id and t.unit_id = p_unit_id)
      or exists (select 1 from public.material_requests t     where t.company_id = p_company_id and t.unit_id = p_unit_id)
      or exists (select 1 from public.estimate_items t        where t.company_id = p_company_id and t.unit_id = p_unit_id)
      or exists (select 1 from public.inventory_count_items t where t.company_id = p_company_id and t.unit_id = p_unit_id);
$$;

-- ============================================================================
-- Ruxsatlar
-- ============================================================================
-- RPC'lar — faqat authenticated (ichida rol / firma / a'zolik tekshiruvi)
revoke execute on function
  public.create_transfer(uuid, uuid, uuid, uuid, uuid, numeric, text),
  public.receive_transfer(uuid, text, text),
  public.cancel_transfer(uuid, text),
  public.apply_inventory_adjustments(uuid)
from public, anon;
grant execute on function
  public.create_transfer(uuid, uuid, uuid, uuid, uuid, numeric, text),
  public.receive_transfer(uuid, text, text),
  public.cancel_transfer(uuid, text),
  public.apply_inventory_adjustments(uuid)
to authenticated;

-- import_estimate / set_current_estimate (create or replace) — grantlar saqlanadi;
-- ular invoker: evaluate_object_norms ni authenticated chaqiradi (o'z firmasi tekshiriladi).
revoke execute on function private.evaluate_object_norms(uuid, uuid) from public, anon, service_role;
grant execute on function private.evaluate_object_norms(uuid, uuid) to authenticated;

-- Trigger va qoida funksiyalari — hech kimga
revoke execute on function
  private.norm_numbers(uuid, uuid, uuid),
  private.evaluate_norm(uuid, uuid, uuid),
  private.evaluate_request(uuid),
  private.transfer_rpc_active(),
  private.tg_movements_norm(),
  private.tg_estimates_norm(),
  private.tg_estimate_items_norm_eval(),
  private.tg_requests_alerts(),
  private.tg_transfers_guard(),
  private.tg_inventory_items_counted(),
  private.tg_material_requests_guard(),
  private.tg_inventory_counts_guard(),
  private.tg_soft_delete_alert(),
  private.unit_is_referenced(uuid, uuid)
from public, anon, authenticated, service_role;

-- ============================================================================
-- O3 — kunlik hisobot (Batch 6 daily_report_stats, create or replace):
--   transfers_pending_count — hozir 'yuborildi' holatidagi o'tkazmalar;
--   chiqim_without_estimate_count — oraliqdagi chiqimlar, obyektida joriy smeta yo'q.
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
  v_tr_pend  integer;
  v_no_est   integer;
begin
  select c.name into v_name from public.companies c where c.id = p_company_id;

  select count(*) filter (where m.type = 'kirim'),
         count(*) filter (where m.type = 'chiqim'),
         count(*) filter (where m.type = 'chiqim' and not exists (
           select 1 from public.estimates e
            where e.company_id = m.company_id and e.object_id = m.object_id
              and e.is_current and e.deleted_at is null))
    into v_kirim, v_chiqim, v_no_est
    from public.movements m
   where m.company_id = p_company_id
     and m.deleted_at is null
     and m.occurred_at >= v_from and m.occurred_at < v_to;

  select count(*), coalesce(sum(p.total_amount), 0)
    into v_p_count, v_p_sum
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
         and a.type::text not in ('ozi_qabul_qilgan', 'yozuv_ochirildi')
       group by a.type
    ) x;

  select count(*) filter (where a.type::text = 'ozi_qabul_qilgan'),
         count(*) filter (where a.type::text = 'yozuv_ochirildi')
    into v_self, v_deleted
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
    'transfers_pending_count',       v_tr_pend,
    'chiqim_without_estimate_count', v_no_est
  );
end;
$$;

-- ============================================================================
-- P4 — materials.waste_pct o'zgarishi → smeta_ozgarishi alerti
--   (ogohlantirish, object_id null, material_id — material).
--   details: {kind: 'waste_changed', material_id, material_name, before, after, actor_name}.
-- ============================================================================
create function private.tg_materials_waste_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.alerts (company_id, type, severity, material_id, details)
  values (new.company_id, 'smeta_ozgarishi', 'ogohlantirish', new.id,
          jsonb_build_object(
            'kind', 'waste_changed', 'material_id', new.id, 'material_name', new.name,
            'before', old.waste_pct, 'after', new.waste_pct,
            'actor_name', (select p.full_name from public.profiles p where p.id = private.my_profile_id())));
  return null;
end;
$$;

create trigger zz_waste_alert after update of waste_pct on public.materials
  for each row
  when (old.waste_pct is distinct from new.waste_pct)
  execute function private.tg_materials_waste_alert();

-- ============================================================================
-- Ruxsatlar (review tuzatishlari)
-- ============================================================================
revoke execute on function
  private.norm_escalation_level(public.alert_severity, numeric),
  private.enqueue_alert_escalation(uuid, integer),
  private.close_transfer_alerts(uuid, uuid, text),
  private.evaluate_due_transfers(timestamptz),
  private.inventory_rpc_active(),
  private.tg_inventory_items_lock(),
  private.inventory_price(uuid, uuid),
  private.tg_materials_waste_alert(),
  private.tg_alerts_notify(),
  private.daily_report_stats(uuid, timestamptz, timestamptz)
from public, anon, authenticated, service_role;
revoke execute on function private.tg_inventory_items_guard() from public, anon, authenticated;
