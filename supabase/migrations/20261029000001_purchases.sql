-- ============================================================================
-- Batch 5 · 01 — podotchet va xarid (shartnoma: docs/purchase-design.md)
--
--   0. alert_type ga 'yozuv_ochirildi' (faqat plpgsql ichida, runtime'da ishlatiladi).
--   1. b_compute_qty: bog'langan xarid topilmasa / o'chirilgan — hint purchase_not_open.
--   2. public.cash_balances (security_invoker) — har odamning qo'lidagi puli.
--   3. cash_advances: issued_at null → now(); amount, recipient_id o'zgarmaydi
--      (cash_amount_locked); oluvchi — xarid kiritadigan faol xodim (cash_recipient_role).
--   4. suppliers: xarid kiritadigan rollar yangi sotuvchi qo'sha oladi (admin bo'lmasa —
--      faqat nom); nom ≤ 120; dublikat (norm_name) — supplier_duplicate.
--   5. public.purchase_receipts (security_invoker) va public.open_purchases() RPC.
--   6. alerts: authenticated faqat status va close_note ni o'zgartiradi; tizim yopgan
--      alertda closed_by = null.
--   7. purchases: bog'langan kirimi bor xaridni o'chirish yoki obyekt/materialini
--      o'zgartirish — purchase_has_receipts.
--   8. Farq qoidalari 1–3 (private.*, security definer) va triggerlar; kunlik/soatlik
--      tekshiruv private.evaluate_due_purchases() (pg_cron, har soat).
--   9. public.check_purchase_price() — narx og'ishi belgisi (raqamsiz).
--  10. Soft delete (purchases, cash_advances, movements) → 'yozuv_ochirildi' alert.
--
-- Oldingi migratsiyalar o'zgartirilmaydi. Xato shakli: errcode + barqaror `hint` +
-- o'zbekcha `message` (docs/db-design.md → "Xato kalitlari").
-- ============================================================================

-- ============================================================================
-- 0. Yangi alert turi. ADD VALUE tranzaksiya ichida mumkin (PG 12+), lekin yangi
--    qiymat shu tranzaksiyada ishlatilmaydi — u faqat plpgsql funksiyalar ichida
--    (runtime'da, migratsiya commit qilingandan keyin) uchraydi. Indeks predikatlari
--    va SQL-funksiyalarda ishlatilmaydi.
-- ============================================================================
alter type public.alert_type add value if not exists 'yozuv_ochirildi';

-- ============================================================================
-- 1. b_compute_qty — Batch 3 versiyasi, faqat bog'langan xarid xatosi hint'i
--    o'zgardi: purchase_not_open (topilmadi / o'chirilgan).
-- ============================================================================
create or replace function private.tg_compute_qty()
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

  -- (1) material qatori qulfi (topilmasa — kompozit FK xato beradi)
  perform 1
     from public.materials m
    where m.company_id = new.company_id
      and m.id = new.material_id
      for share;

  -- (2) unit_id berilmagan bo'lsa — nom bo'yicha
  if v_unit_id is null then
    select mu.id into v_unit_id
      from public.material_units mu
     where mu.company_id = new.company_id
       and mu.material_id = new.material_id
       and private.norm_name(mu.unit) = private.norm_name(new.unit_input)
       and mu.variant is null
       and mu.deleted_at is null;
  end if;

  -- (3) birlik qatorini o'qish va qulflash — bitta so'rov.
  select mu.material_id, mu.unit, mu.variant, mu.factor
    into v_material, v_unit, v_variant, v_factor
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

  -- (4) hisoblash — qulflangan qatordan
  new.unit_id      := v_unit_id;
  new.unit_input   := v_unit;
  new.unit_variant := v_variant;
  new.qty_base     := round(new.qty_input * v_factor, 6);

  if tg_table_name = 'purchases' then
    new.unit_price     := coalesce(round(new.total_amount / nullif(new.qty_input, 0), 2), 0);
    new.price_per_base := coalesce(round(new.total_amount / nullif(new.qty_base, 0), 4), 0);
  end if;

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
        raise exception 'Bog''langan xarid topilmadi yoki o''chirilgan'
          using errcode = '23503', hint = 'purchase_not_open';
      end if;
      if v_p_material is distinct from new.material_id or v_p_object is distinct from new.object_id then
        raise exception 'Bog''langan xarid boshqa material yoki obyektga tegishli'
          using errcode = '23514', hint = 'ops_purchase_mismatch';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ============================================================================
-- 2. Qo'limdagi pul (podotchet balansi)
--
--    balance = Σ cash_advances.amount (recipient_id = odam, o'chirilmagan)
--            − Σ purchases.total_amount (buyer_id = odam, o'chirilmagan).
--    Manfiy bo'lishi mumkin (o'z pulidan sarflagan).
--
--    security_invoker — cash_advances va purchases RLS'i chaqiruvchi huquqida.
--    Ikki jadvalning ko'rinishi har xil: taminotchi BARCHA xaridlarni, cash_advances'dan
--    esa faqat o'ziga berilganini ko'radi — oddiy yig'indi unga boshqalar uchun
--    noto'g'ri balans ko'rsatardi. Qator faqat chaqiruvchi o'sha odamning podotchetini
--    TO'LIQ ko'ra oladigan holatda chiqadi (cash_advances_select sharti):
--      * super_admin, admin, direktor, buxgalter — hamma;
--      * qolganlar — faqat o'zi;
--      * service_role / postgres (bot, cron) — hamma.
-- ============================================================================
create view public.cash_balances
with (security_invoker = true)
as
with ledger as (
  select ca.company_id,
         ca.recipient_id        as profile_id,
         ca.amount              as issued,
         0::numeric(18,2)       as spent,
         ca.issued_at           as issued_ts,
         null::timestamptz      as spent_ts
    from public.cash_advances ca
   where ca.deleted_at is null
  union all
  select p.company_id,
         p.buyer_id,
         0::numeric(18,2),
         p.total_amount,
         null::timestamptz,
         p.purchased_at
    from public.purchases p
   where p.deleted_at is null
)
select l.company_id,
       l.profile_id,
       sum(l.issued)::numeric(18,2)                  as issued_total,
       sum(l.spent)::numeric(18,2)                   as spent_total,
       (sum(l.issued) - sum(l.spent))::numeric(18,2) as balance,
       max(l.issued_ts)                              as last_issued_at,
       max(l.spent_ts)                               as last_spent_at
  from ledger l
 where l.profile_id = (select private.my_profile_id())
    or (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter'))
    or current_user in ('service_role', 'postgres')
 group by l.company_id, l.profile_id;

comment on view public.cash_balances is
  'Qo''limdagi pul: berilgan (cash_advances) − sarflangan (purchases), o''chirilmaganlar. '
  'Qator faqat chaqiruvchi shu odamning podotchetini to''liq ko''ra olsa chiqadi '
  '(admin/direktor/buxgalter/super_admin — hamma, boshqalar — o''zi).';

revoke all on public.cash_balances from public, anon, authenticated, service_role;
grant select on public.cash_balances to authenticated, service_role;

-- ============================================================================
-- 3. cash_advances
--    issued_at: null → INSERT'da now(), UPDATE'da eski qiymat (sana cheklanmaydi).
--    amount, recipient_id: INSERT'dan keyin o'zgarmaydi — tuzatish = soft delete +
--    yangi yozuv (hamma uchun, service_role ham): cash_amount_locked.
--    Oluvchi (INSERT va tiklashda): shu firmaning o'chirilmagan, faol profili, roli
--    haydovchi / taminotchi / prorab / admin: cash_recipient_role.
-- ============================================================================
create function private.tg_cash_issued_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.issued_at is null then
    if tg_op = 'UPDATE' then
      new.issued_at := old.issued_at;
    else
      new.issued_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger b_issued_at before insert or update on public.cash_advances
  for each row execute function private.tg_cash_issued_at();

create function private.tg_cash_advances_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.amount is distinct from old.amount or new.recipient_id is distinct from old.recipient_id then
      raise exception 'Berilgan pul summasi va oluvchisini o''zgartirib bo''lmaydi — yozuvni o''chirib, yangisini kiriting'
        using errcode = 'P0001', hint = 'cash_amount_locked';
    end if;
    if not (old.deleted_at is not null and new.deleted_at is null) then
      return new;
    end if;
  end if;

  -- Ruxsatsiz foydalanuvchi — RLS rad etadi (xato kodi RLS'niki bo'lsin);
  -- boshqa firma profili — kompozit FK (23503) rad etadi.
  if new.deleted_at is not null
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

create trigger b_cash_advances_guard before insert or update on public.cash_advances
  for each row execute function private.tg_cash_advances_guard();

-- ============================================================================
-- 4. suppliers
--    INSERT: super_admin, admin (istalgan maydon); taminotchi, haydovchi, prorab —
--    faqat nom (phone, note — null). UPDATE / soft delete — admin (o'zgarmadi).
--    Nom: 1..120 belgi; dublikat — firma ichida, o'chirilmaganlar orasida,
--    norm_name bo'yicha (trigger + zaxira unique indeks).
-- ============================================================================
drop policy suppliers_insert on public.suppliers;
create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (
      (select private.has_role('super_admin', 'admin'))
      or (
        (select private.has_role('taminotchi', 'haydovchi', 'prorab'))
        and phone is null
        and note is null
      )
    )
    and deleted_at is null
    and created_by = (select private.my_profile_id())
  );

alter table public.suppliers
  add constraint suppliers_name_length_check check (char_length(name) between 1 and 120);

do $$
declare
  v text;
begin
  select string_agg(format('firma %s: "%s" (%s ta)', company_id, n, c), '; ') into v
    from (select company_id, private.norm_name(name) n, count(*) c
            from public.suppliers where deleted_at is null
           group by 1, 2 having count(*) > 1) d;
  if v is not null then
    raise exception 'Migratsiya to''xtatildi: normallashtirilgan nomi bir xil sotuvchilar bor — %', v;
  end if;
end $$;

create unique index suppliers_company_name_key
  on public.suppliers (company_id, private.norm_name(name))
  where deleted_at is null;
create index suppliers_company_idx on public.suppliers (company_id);

create function private.tg_suppliers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null
     and (tg_op = 'INSERT'
          or old.deleted_at is not null
          or private.norm_name(new.name) is distinct from private.norm_name(old.name)) then
    perform pg_advisory_xact_lock(hashtextextended('terron.suppliers:' || new.company_id::text, 0));
    if exists (
      select 1 from public.suppliers s
       where s.company_id = new.company_id
         and s.deleted_at is null
         and s.id <> new.id
         and private.norm_name(s.name) = private.norm_name(new.name)
    ) then
      raise exception '"%" nomli sotuvchi allaqachon bor — ro''yxatdan tanlang', new.name
        using errcode = '23505', hint = 'supplier_duplicate';
    end if;
  end if;
  return new;
end;
$$;

create trigger b_suppliers_guard before insert or update on public.suppliers
  for each row execute function private.tg_suppliers_guard();

-- ============================================================================
-- 5. Xarid qabul holati
--
--    private.purchase_receipt_stats — bitta xaridga bog'langan, o'chirilmagan
--    kirimlar yig'indisi. security definer: movements RLS'idan qat'i nazar (haydovchi
--    harakatlarni ko'rmaydi, lekin o'z xaridi qancha qabul qilinganini ko'rishi
--    kerak) — farq qoidasi 1 bilan bir xil raqam. Faqat yig'indi, faqat chaqiruvchi
--    firmasi uchun; xaridning o'zi ko'rinishi — view'dagi purchases RLS'i (invoker).
-- ============================================================================
create function private.purchase_receipt_stats(p_company_id uuid, p_purchase_id uuid)
returns table (received_qty_base numeric, receipt_count bigint, last_received_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(m.qty_base), 0)::numeric(20,6),
         count(m.id),
         max(m.occurred_at)
    from public.movements m
   where m.company_id = p_company_id
     and m.purchase_id = p_purchase_id
     and m.type = 'kirim'
     and m.deleted_at is null
     and (auth.uid() is null or private.can_access_company(p_company_id));
$$;

revoke execute on function private.purchase_receipt_stats(uuid, uuid) from public, anon;
grant execute on function private.purchase_receipt_stats(uuid, uuid) to authenticated, service_role;

-- remaining_qty_base = qty_base − received_qty_base (manfiy — ortiqcha qabul qilingan).
create view public.purchase_receipts
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
       s.last_received_at
  from public.purchases p
  cross join lateral private.purchase_receipt_stats(p.company_id, p.id) s
 where p.deleted_at is null;

comment on view public.purchase_receipts is
  'Har (o''chirilmagan) xarid uchun qabul: bog''langan o''chirilmagan kirimlar yig''indisi, '
  'qolgan miqdor (manfiy — ortiqcha), kirimlar soni, oxirgi kirim vaqti. Asosiy birlikda.';

revoke all on public.purchase_receipts from public, anon, authenticated, service_role;
grant select on public.purchase_receipts to authenticated, service_role;

-- Mini App kirim ekrani: shu obyekt va materialdagi oxirgi 14 kunlik, to'liq qabul
-- qilinmagan (remaining > 0) xaridlar, eng yangisi birinchi. RLS amal qiladi.
create function public.open_purchases(p_object_id uuid, p_material_id uuid)
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
    left join public.profiles pr on pr.company_id = p.company_id and pr.id = p.buyer_id
   where r.object_id = p_object_id
     and r.material_id = p_material_id
     and r.purchased_at >= now() - interval '14 days'
     and r.remaining_qty_base > 0
   order by p.purchased_at desc, p.created_at desc, p.id;
$$;

revoke execute on function public.open_purchases(uuid, uuid) from public, anon;
grant execute on function public.open_purchases(uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- 6. alerts
--    authenticated faqat status va close_note (yopish sababi, ≤ 500) ni o'zgartiradi
--    (ustun grant). details, deleted_at, bog'lanishlar — faqat tizim.
--    closed_by: foydalanuvchi (current_user = authenticated) yopsa — uning profili;
--    tizim (security definer qoida funksiyalari, service_role, cron) yopsa — null.
-- ============================================================================
alter table public.alerts
  add column close_note text
  constraint alerts_close_note_length_check check (close_note is null or char_length(close_note) <= 500);

revoke update on table public.alerts from authenticated;
grant update (status, close_note) on table public.alerts to authenticated;

create or replace function private.tg_alerts_close()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'yopildi' then
    if tg_op = 'INSERT' or old.status is distinct from 'yopildi' then
      new.closed_by := case when current_user = 'authenticated' then private.my_profile_id() end;
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

-- Bitta xarid uchun bitta ochiq "xarid ≠ qabul" va bitta ochiq "narx og'ishi" alert;
-- "o'zi qabul qilgan" — (xarid, kirim) juftligi uchun bitta (holatidan qat'i nazar).
create unique index alerts_open_receipt_key on public.alerts (purchase_id)
  where type = 'xarid_qabul_farqi' and status in ('yangi', 'korildi') and deleted_at is null;
create unique index alerts_open_price_key on public.alerts (purchase_id)
  where type = 'narx_ogishi' and status in ('yangi', 'korildi') and deleted_at is null;
create unique index alerts_self_receipt_key on public.alerts (purchase_id, movement_id)
  where type = 'ozi_qabul_qilgan' and deleted_at is null;
-- 'yozuv_ochirildi' alertini tiklashda topish (yozuv id — details.record_id)
create index alerts_company_record_idx on public.alerts (company_id, (details ->> 'record_id'));

-- ============================================================================
-- 7. purchases: bog'langan (o'chirilmagan) kirimi bor xaridni soft delete qilish
--    yoki object_id / material_id ni o'zgartirish — rad (hamma uchun).
--    Avval kirimni o'chirish yoki boshqa xaridga bog'lash kerak.
-- ============================================================================
create function private.tg_purchases_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if ((old.deleted_at is null and new.deleted_at is not null)
      or new.object_id is distinct from old.object_id
      or new.material_id is distinct from old.material_id)
     and exists (
       select 1 from public.movements m
        where m.company_id = new.company_id
          and m.purchase_id = new.id
          and m.type = 'kirim'
          and m.deleted_at is null
     ) then
    raise exception 'Xaridga bog''langan kirim bor — avval kirimni o''chiring yoki boshqa xaridga bog''lang'
      using errcode = 'P0001', hint = 'purchase_has_receipts';
  end if;
  return new;
end;
$$;

create trigger b_purchases_guard before update on public.purchases
  for each row execute function private.tg_purchases_guard();

-- ============================================================================
-- 8. Farq qoidalari. Hammasi private, security definer, search_path = ''.
--    Execute — hech kimga (triggerlar ichida va cron — postgres). Formulalar
--    src/domain/alerts/* bilan bit-bit bir xil. Alert aktyori (created_by, audit) —
--    triggerni chaqirgan foydalanuvchi; cron/service_role'da — null ('tizim').
--    Avtomatik yopishda details: auto_closed = true, closed_reason,
--    closed_by_actor = my_profile_id() (cron'da null).
-- ============================================================================

create function private.close_purchase_alerts(
  p_company_id  uuid,
  p_purchase_id uuid,
  p_types       public.alert_type[],
  p_reason      text
)
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
     and a.purchase_id = p_purchase_id
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
     and (p_types is null or a.type = any (p_types));
end;
$$;

-- ----------------------------------------------------------------------------
-- Qoida 1 — "Xarid ≠ qabul" (xarid_qabul_farqi).
--   diff_pct = round(abs(received − purchased) * 100 / purchased, 2)
--   (received, purchased — numeric(20,6)).
--   diff_pct <= chegara             → ok: ochiq alert avtomatik yopiladi;
--   received > purchased            → over: darhol;
--   received < purchased:
--     p_now >= purchased_at + 24 soat → under;
--     aks holda                       → pending: yangi alert yo'q, ochig'i yangilanadi.
--   severity: diff_pct >= 3 × chegara → jiddiy, aks holda ogohlantirish.
--   Bitta ochiq alert; raqamlar o'zgarmagan bo'lsa UPDATE qilinmaydi (tarix shovqini).
--   Admin qo'lda yopgan alert bilan bir xil raqamlar bo'lsa — qayta yaratilmaydi.
--   Bog'langan kirim bo'lmasa ham ishlaydi (received = 0) — evaluate_due_purchases.
-- ----------------------------------------------------------------------------
create function private.evaluate_purchase_receipt(p_purchase_id uuid, p_now timestamptz default now())
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
begin
  -- Xarid qatori qulfi: parallel baholashlar navbat bilan (FOR NO KEY UPDATE kirim
  -- FK'sining FOR KEY SHARE qulfi bilan to'qnashmaydi).
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

  v_purchased := v_p.qty_base;
  v_diff := round(abs(v_received - v_purchased) * 100 / v_purchased, 2);

  if v_diff <= v_threshold then
    v_state := 'ok';
  elsif v_received > v_purchased then
    v_state := 'over';
  elsif p_now >= v_p.purchased_at + interval '24 hours' then
    v_state := 'under';
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
             details = v_details || jsonb_build_object(
               'auto_closed', true, 'closed_reason', 'within_threshold',
               'closed_by_actor', private.my_profile_id())
       where id = v_alert.id;
    end if;
    return;
  end if;

  if v_alert.id is not null then
    if v_alert.severity = v_severity
       and (v_alert.details - 'evaluated_at') = (v_details - 'evaluated_at')
       and v_alert.object_id is not distinct from v_p.object_id
       and v_alert.material_id is not distinct from v_p.material_id
       and v_alert.movement_id is not distinct from v_last_mv then
      return;
    end if;
    update public.alerts
       set severity    = v_severity,
           details     = v_details,
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
-- Soatlik tekshiruv (pg_cron): o'chirilmagan, faol firmadagi, purchased_at ∈
-- [p_now − 60 kun, p_now − 24 soat] xaridlar — bog'langan kirimi YO'Q bo'lsa ham.
-- O'tkazib yuboriladi: farq chegarada va ochiq alert yo'q; ochiq alert raqamlari
-- o'zgarmagan; admin qo'lda yopgan alert bilan bir xil raqamlar.
-- Qaytaradi: baholangan xaridlar soni.
-- ----------------------------------------------------------------------------
create function private.evaluate_due_purchases(p_now timestamptz default now())
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
           and p.purchased_at <= p_now - interval '24 hours'
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

-- ----------------------------------------------------------------------------
-- Qoida 2 — "O'zi tekshirmagan" (ozi_qabul_qilgan, severity = belgi).
--   a) Bog'langan, o'chirilmagan kirim: movements.created_by = purchases.buyer_id
--      (xarid o'chirilmagan) → details.linked = true.
--   b) Bog'lanmagan kirim (evristika): kirimni kiritgan odam shu obyekt+material
--      uchun o'zi xaridor bo'lgan, o'chirilmagan xarid bor va
--      |purchased_at − occurred_at| <= 48 soat → eng yaqin xarid bilan juftlik,
--      details.linked = false.
--   Har (xarid, kirim) juftligi uchun bitta alert. Shart yo'qolsa — ochiq belgi
--   avtomatik yopiladi (not_applicable); qaytsa — avtomatik yopilgani qayta ochiladi
--   (qo'lda yopilgani — yo'q); ochiq bo'lsa details yangilanadi.
-- ----------------------------------------------------------------------------
create function private.evaluate_self_receipt(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m       public.movements%rowtype;
  v_buyer   uuid;
  v_target  uuid;
  v_linked  boolean;
  v_flag    boolean := false;
  v_details jsonb;
begin
  select m.* into v_m from public.movements m where m.id = p_movement_id;
  if not found then
    return;
  end if;

  if v_m.deleted_at is null and v_m.type = 'kirim' and v_m.created_by is not null then
    if v_m.purchase_id is not null then
      select p.buyer_id into v_buyer
        from public.purchases p
       where p.company_id = v_m.company_id
         and p.id = v_m.purchase_id
         and p.deleted_at is null;
      if found and v_buyer = v_m.created_by then
        v_flag := true;
        v_target := v_m.purchase_id;
        v_linked := true;
      end if;
    else
      select p.id into v_target
        from public.purchases p
       where p.company_id = v_m.company_id
         and p.buyer_id = v_m.created_by
         and p.object_id = v_m.object_id
         and p.material_id = v_m.material_id
         and p.deleted_at is null
         and p.purchased_at between v_m.occurred_at - interval '48 hours'
                                and v_m.occurred_at + interval '48 hours'
       order by abs(extract(epoch from (p.purchased_at - v_m.occurred_at))), p.id
       limit 1;
      if found then
        v_flag := true;
        v_linked := false;
        v_buyer := v_m.created_by;
      end if;
    end if;
  end if;

  update public.alerts a
     set status  = 'yopildi',
         details = a.details || jsonb_build_object(
           'auto_closed', true, 'closed_reason', 'not_applicable',
           'closed_by_actor', private.my_profile_id())
   where a.company_id = v_m.company_id
     and a.movement_id = v_m.id
     and a.type = 'ozi_qabul_qilgan'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
     and (not v_flag or a.purchase_id is distinct from v_target);

  if v_flag then
    v_details := jsonb_build_object(
      'buyer_id', v_buyer, 'receiver_id', v_m.created_by, 'qty_base', v_m.qty_base, 'linked', v_linked);
    insert into public.alerts
      (company_id, type, severity, object_id, material_id, purchase_id, movement_id, details)
    values
      (v_m.company_id, 'ozi_qabul_qilgan', 'belgi', v_m.object_id, v_m.material_id,
       v_target, v_m.id, v_details)
    on conflict (purchase_id, movement_id)
      where type = 'ozi_qabul_qilgan' and deleted_at is null
    do update
       set status  = case when alerts.status = 'yopildi' then 'yangi'::public.alert_status
                          else alerts.status end,
           details = excluded.details
     where (alerts.status <> 'yopildi' and alerts.details is distinct from excluded.details)
        or (alerts.status = 'yopildi' and coalesce((alerts.details ->> 'auto_closed')::boolean, false));
  end if;
end;
$$;

-- Xarid o'zgarganda 2-qoidani qayta baholash: bog'langan kirimlar, shu xarid bilan
-- belgisi bor kirimlar va evristika bo'yicha nomzod (bog'lanmagan) kirimlar.
create function private.reevaluate_self_for_purchase(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p  public.purchases%rowtype;
  v_mv uuid;
begin
  select p.* into v_p from public.purchases p where p.id = p_purchase_id;
  if not found then
    return;
  end if;
  for v_mv in
    select x.id from (
      select m.id from public.movements m
       where m.company_id = v_p.company_id and m.purchase_id = v_p.id
      union
      select a.movement_id from public.alerts a
       where a.company_id = v_p.company_id and a.purchase_id = v_p.id
         and a.type = 'ozi_qabul_qilgan' and a.movement_id is not null
      union
      select m.id from public.movements m
       where m.company_id = v_p.company_id
         and m.purchase_id is null
         and m.type = 'kirim'
         and m.deleted_at is null
         and m.created_by = v_p.buyer_id
         and m.object_id = v_p.object_id
         and m.material_id = v_p.material_id
         and m.occurred_at between v_p.purchased_at - interval '48 hours'
                               and v_p.purchased_at + interval '48 hours'
    ) x
    order by x.id
  loop
    perform private.evaluate_self_receipt(v_mv);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Qoida 3 — "Narx og'ishi" (narx_ogishi). Yagona hisoblash: private.price_check.
--   Oldingi xaridlar: shu firma, shu material, o'chirilmagan, (purchased_at,
--   created_at) bo'yicha (p_before_at, p_before_created) dan qat'iy oldin.
--   avg_n  = round(sum(total_amount) / sum(qty_base), 4) — oxirgi price_avg_window
--            tasi (miqdorga tortilgan); < 2 ta → null.
--   avg_90 = xuddi shunday, purchased_at >= p_before_at − 90 kun bo'lganlarning
--            hammasi; < 2 ta → null.
--   diff_x = round((price − avg_x) * 100 / avg_x, 2) (avg_x null yoki 0 → null).
--   direction: diff_n > chegara yoki diff_90 > chegara → 'high';
--              aks holda diff_n <= −50 yoki diff_90 <= −50 → 'low'; aks holda 'ok'.
-- ----------------------------------------------------------------------------
create function private.price_check(
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

create function private.evaluate_purchase_price(p_purchase_id uuid)
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
             details = v_details || jsonb_build_object(
               'auto_closed', true, 'closed_reason', 'within_threshold',
               'closed_by_actor', private.my_profile_id())
       where id = v_alert.id;
    end if;
    return;
  end if;

  if v_alert.id is not null then
    if v_alert.details = v_details
       and v_alert.object_id is not distinct from v_p.object_id
       and v_alert.material_id is not distinct from v_p.material_id then
      return;
    end if;
    update public.alerts
       set details     = v_details,
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

-- ============================================================================
-- 9. public.check_purchase_price — xarid formasida jonli belgi.
--    Xuddi shu mantiq (private.price_check), "oldingi" — hozirgacha kiritilgan
--    barcha xaridlar (purchased_at <= now()). security definer: firmaning butun
--    oynasi kerak (prorab/haydovchi boshqalar xaridini ko'rmaydi). Faqat chaqiruvchi
--    firmasi materiali; qaytaradi faqat 'ok' | 'high' | 'low' — o'rtacha va foiz
--    qaytarilmaydi (narxni chegaraga moslab "kalibrlash"ning oldini olish).
--    p_price_per_base — asosiy birlik narxi, 4 xonagacha yaxlitlanadi.
-- ============================================================================
create function public.check_purchase_price(p_material_id uuid, p_price_per_base numeric)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.my_company_id();
  v_r       record;
begin
  if v_company is null or p_material_id is null or p_price_per_base is null or p_price_per_base < 0 then
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
                             now(), 'infinity'::timestamptz, null);
  return v_r.direction;
end;
$$;

revoke execute on function public.check_purchase_price(uuid, numeric) from public, anon;
grant execute on function public.check_purchase_price(uuid, numeric) to authenticated;

-- ============================================================================
-- Triggerlar. Nomi zz_* — z_audit dan keyin ishlaydi (tarixda avval asl yozuv,
-- keyin alert). AFTER — qty_base, price_per_base (b_compute_qty) yakuniy.
-- ============================================================================

-- purchases:
--   INSERT                                  → qoida 3, qoida 2 (nomzod kirimlar);
--   soft delete                             → barcha ochiq alertlar yopiladi, qoida 2;
--   tiklash                                 → qoida 1, 3, 2;
--   qty_base / purchased_at o'zgarsa        → qoida 1;
--   total_amount / qty_input / unit_id / material_id / purchased_at → qoida 3;
--   buyer_id / object_id / material_id / purchased_at → qoida 2.
create function private.tg_purchases_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restored boolean;
begin
  if tg_op = 'INSERT' then
    perform private.evaluate_purchase_price(new.id);
    perform private.reevaluate_self_for_purchase(new.id);
    return null;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    perform private.close_purchase_alerts(new.company_id, new.id, null, 'purchase_deleted');
    perform private.reevaluate_self_for_purchase(new.id);
    return null;
  end if;
  if new.deleted_at is not null then
    return null;
  end if;

  v_restored := old.deleted_at is not null;

  if v_restored
     or new.qty_base is distinct from old.qty_base
     or new.purchased_at is distinct from old.purchased_at then
    perform private.evaluate_purchase_receipt(new.id);
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

create trigger zz_alert_rules_ins after insert on public.purchases
  for each row execute function private.tg_purchases_alerts();
create trigger zz_alert_rules_upd after update on public.purchases
  for each row
  when (old.deleted_at   is distinct from new.deleted_at
     or old.qty_base     is distinct from new.qty_base
     or old.purchased_at is distinct from new.purchased_at
     or old.total_amount is distinct from new.total_amount
     or old.qty_input    is distinct from new.qty_input
     or old.unit_id      is distinct from new.unit_id
     or old.material_id  is distinct from new.material_id
     or old.object_id    is distinct from new.object_id
     or old.buyer_id     is distinct from new.buyer_id)
  execute function private.tg_purchases_alerts();

-- movements (kirim):
--   INSERT → bog'langan xarid uchun qoida 1; qoida 2 (bog'langan yoki evristika);
--   UPDATE (qty_base / purchase_id / deleted_at / type / object_id / material_id /
--   occurred_at o'zgarsa) → eski va yangi xarid uchun qoida 1 (uuid tartibida —
--   qulf tartibi barqaror), kirim uchun qoida 2.
create function private.tg_movements_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pid uuid;
begin
  if tg_op = 'INSERT' then
    if new.purchase_id is not null then
      perform private.evaluate_purchase_receipt(new.purchase_id);
    end if;
    perform private.evaluate_self_receipt(new.id);
    return null;
  end if;

  for v_pid in
    select x.pid
      from (select old.purchase_id as pid union select new.purchase_id) x
     where x.pid is not null
     order by x.pid
  loop
    perform private.evaluate_purchase_receipt(v_pid);
  end loop;
  perform private.evaluate_self_receipt(new.id);
  return null;
end;
$$;

create trigger zz_alert_rules_ins after insert on public.movements
  for each row
  when (new.type = 'kirim')
  execute function private.tg_movements_alerts();
create trigger zz_alert_rules_upd after update on public.movements
  for each row
  when ((old.type = 'kirim' or new.type = 'kirim')
    and (old.qty_base    is distinct from new.qty_base
      or old.purchase_id is distinct from new.purchase_id
      or old.deleted_at  is distinct from new.deleted_at
      or old.type        is distinct from new.type
      or old.object_id   is distinct from new.object_id
      or old.material_id is distinct from new.material_id
      or old.occurred_at is distinct from new.occurred_at))
  execute function private.tg_movements_alerts();

-- ============================================================================
-- 10. Soft delete → 'yozuv_ochirildi' alert (purchases, cash_advances, movements),
--     kim o'chirganidan qat'i nazar. severity = ogohlantirish. details: table,
--     record_id, actor_profile_id, material_id, object_id va amount (pul) /
--     qty_base (miqdor). Tiklanganda — avtomatik yopiladi (closed_reason = restored).
--     Trigger nomi zz_deleted_alert — zz_alert_rules_upd dan keyin (xarid o'chirilganda
--     eski alertlar avval yopiladi, keyin o'chirish alerti yaratiladi).
-- ============================================================================
create function private.tg_soft_delete_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     jsonb := to_jsonb(new);
  v_details jsonb;
begin
  if old.deleted_at is null and new.deleted_at is not null then
    -- Ismlar o'chirish paytidagi holatda saqlanadi (UI "Xarid o'chirildi: Sement · 1 250 000 so'm (Ali)")
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

create trigger zz_deleted_alert after update on public.purchases
  for each row when (old.deleted_at is distinct from new.deleted_at)
  execute function private.tg_soft_delete_alert();
create trigger zz_deleted_alert after update on public.cash_advances
  for each row when (old.deleted_at is distinct from new.deleted_at)
  execute function private.tg_soft_delete_alert();
create trigger zz_deleted_alert after update on public.movements
  for each row when (old.deleted_at is distinct from new.deleted_at)
  execute function private.tg_soft_delete_alert();

-- ============================================================================
-- Ruxsatlar: trigger va qoida funksiyalari — hech kimga.
-- ============================================================================
revoke execute on function
  private.tg_compute_qty(),
  private.tg_cash_issued_at(),
  private.tg_cash_advances_guard(),
  private.tg_suppliers_guard(),
  private.tg_alerts_close(),
  private.tg_purchases_guard(),
  private.close_purchase_alerts(uuid, uuid, public.alert_type[], text),
  private.evaluate_purchase_receipt(uuid, timestamptz),
  private.evaluate_due_purchases(timestamptz),
  private.evaluate_self_receipt(uuid),
  private.reevaluate_self_for_purchase(uuid),
  private.price_check(uuid, uuid, numeric, timestamptz, timestamptz, uuid),
  private.evaluate_purchase_price(uuid),
  private.tg_purchases_alerts(),
  private.tg_movements_alerts(),
  private.tg_soft_delete_alert()
from public, anon, authenticated, service_role;

-- ============================================================================
-- pg_cron: har soatning 7-daqiqasida kam qabulni tekshirish (postgres nomidan).
-- Supabase: pg_cron pg_catalog sxemasiga o'rnatiladi, jadvallar — cron sxemasida.
-- Idempotent: shu nomdagi ish bo'lsa — avval o'chiriladi.
-- ============================================================================
create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'terron-evaluate-purchases') then
    perform cron.unschedule('terron-evaluate-purchases');
  end if;
  perform cron.schedule(
    'terron-evaluate-purchases',
    '7 * * * *',
    'select private.evaluate_due_purchases()'
  );
end $$;
