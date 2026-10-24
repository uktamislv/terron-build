-- ============================================================================
-- Batch 1 · 05 — grantlar, RLS va siyosatlar.
--
-- Qoidalar (docs/db-design.md → RLS):
--  * har public jadval: enable + force row level security;
--  * anon: hech narsa; authenticated: select/insert/update (DELETE yo'q);
--    service_role: to'liq (DELETE baribir trigger bilan bloklangan);
--  * DELETE siyosati yo'q;
--  * yordamchi funksiyalar har doim `(select private.fn())` ko'rinishida;
--  * firma sharti: `(select private.is_super_admin()) or company_id = (select private.my_company_id())`;
--  * o'chirilgan qatorlar: admin, direktor, super_admin (+ jadvalni o'zgartira oladigan rollar) ko'radi.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Funksiyalarga ruxsat
-- ----------------------------------------------------------------------------
revoke execute on function
  private.my_profile_id(),
  private.my_company_id(),
  private.my_role(),
  private.is_super_admin(),
  private.has_role(public.user_role[]),
  private.is_company_wide(),
  private.can_access_company(uuid),
  private.my_object_ids(),
  private.can_access_object(uuid)
from public, anon;

grant execute on function
  private.my_profile_id(),
  private.my_company_id(),
  private.my_role(),
  private.is_super_admin(),
  private.has_role(public.user_role[]),
  private.is_company_wide(),
  private.can_access_company(uuid),
  private.my_object_ids(),
  private.can_access_object(uuid)
to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Jadvallar: RLS + grantlar
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- audit_log: faqat o'qish (yozuvni faqat trigger qiladi)
revoke insert, update, delete on table public.audit_log from authenticated, service_role;

-- profiles: identifikatsiya ustunlari (auth_user_id, telegram_user_id, telegram_chat_id)
-- faqat service_role (Batch 2: tg-auth / bog'lash). authenticated — ustun darajasida.
revoke insert, update on table public.profiles from authenticated;
grant insert (id, company_id, role, full_name, phone, is_active, created_by)
  on table public.profiles to authenticated;
grant update (role, full_name, phone, is_active, deleted_at, updated_at)
  on table public.profiles to authenticated;

-- Ketma-ketliklar (audit_log identity): hech kimga to'g'ridan-to'g'ri kerak emas
revoke all on all sequences in schema public from public, anon, authenticated;

-- ============================================================================
-- companies
-- ============================================================================
create policy companies_select on public.companies
  for select to authenticated
  using (
    (select private.is_super_admin())
    or (
      id = (select private.my_company_id())
      and (deleted_at is null or (select private.has_role('admin', 'direktor')))
    )
  );

create policy companies_insert on public.companies
  for insert to authenticated
  with check (
    (select private.is_super_admin())
    and deleted_at is null
    and created_by = (select private.my_profile_id())
  );

create policy companies_update on public.companies
  for update to authenticated
  using (
    (select private.is_super_admin())
    or (id = (select private.my_company_id()) and deleted_at is null and (select private.has_role('admin')))
  )
  with check (
    (select private.is_super_admin())
    or (id = (select private.my_company_id()) and (select private.has_role('admin')))
  );

-- ============================================================================
-- profiles — admin super_admin profilini yarata/o'zgartira olmaydi
-- ============================================================================
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
  );

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
    and (role <> 'super_admin' or (select private.is_super_admin()))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
    and (role <> 'super_admin' or (select private.is_super_admin()))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
    and (role <> 'super_admin' or (select private.is_super_admin()))
  );

-- ============================================================================
-- objects
-- ============================================================================
create policy objects_select on public.objects
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
    and ((select private.is_company_wide()) or id in (select private.my_object_ids()))
  );

create policy objects_insert on public.objects
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
  );

create policy objects_update on public.objects
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  );

-- ============================================================================
-- object_members
-- ============================================================================
create policy object_members_select on public.object_members
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
    and ((select private.is_company_wide()) or profile_id = (select private.my_profile_id()))
  );

create policy object_members_insert on public.object_members
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
  );

create policy object_members_update on public.object_members
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  );

-- ============================================================================
-- Katalog: materials, material_units, material_aliases, suppliers
-- Ko'rish — firma a'zolari; qo'shish/o'zgartirish — admin.
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['materials', 'material_units', 'material_aliases', 'suppliers'] loop
    execute format($p$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (
          ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
          and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
        )
    $p$, t);
    execute format($p$
      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (
          ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
          and (select private.has_role('super_admin', 'admin'))
          and deleted_at is null
          and created_by = (select private.my_profile_id())
        )
    $p$, t);
    execute format($p$
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (
          ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
          and (select private.has_role('super_admin', 'admin'))
        )
        with check (
          ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
          and (select private.has_role('super_admin', 'admin'))
        )
    $p$, t);
  end loop;
end $$;

-- ============================================================================
-- cash_advances — admin/direktor/buxgalter hammasini, boshqalar o'ziga berilganini
-- ============================================================================
create policy cash_advances_select on public.cash_advances
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter')))
    and (
      (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter'))
      or recipient_id = (select private.my_profile_id())
    )
  );

create policy cash_advances_insert on public.cash_advances
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'buxgalter'))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
  );

create policy cash_advances_update on public.cash_advances
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'buxgalter'))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'buxgalter'))
  );

-- ============================================================================
-- purchases
--  ko'rish: firma rollari — hammasi; prorab, omborchi — a'zo obyektlar;
--           har kim — o'zi xarid qilgani (buyer_id)
--  qo'shish: admin — istalgan xaridor; taminotchi — o'zi (istalgan obyekt);
--            prorab, haydovchi — o'zi va a'zo obyektga
--  o'zgartirish: admin
-- ============================================================================
create policy purchases_select on public.purchases
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
    and (
      (select private.is_company_wide())
      or buyer_id = (select private.my_profile_id())
      or ((select private.has_role('prorab', 'omborchi')) and object_id in (select private.my_object_ids()))
    )
  );

create policy purchases_insert on public.purchases
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
    and (
      (select private.has_role('super_admin', 'admin'))
      or (
        buyer_id = (select private.my_profile_id())
        and (
          (select private.has_role('taminotchi'))
          or ((select private.has_role('prorab', 'haydovchi')) and private.can_access_object(object_id))
        )
      )
    )
  );

create policy purchases_update on public.purchases
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  );

-- ============================================================================
-- movements
--  ko'rish: firma rollari — hammasi; prorab, omborchi — a'zo obyektlar
--  qo'shish: admin — har qanday tur; prorab, omborchi — faqat kirim/chiqim, a'zo obyekt
--  (transfer_* va inventory_adjust keyingi batch'larda funksiyalar orqali yaratiladi)
--  o'zgartirish: admin
-- ============================================================================
create policy movements_select on public.movements
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
    and (
      (select private.is_company_wide())
      or ((select private.has_role('prorab', 'omborchi')) and object_id in (select private.my_object_ids()))
    )
  );

create policy movements_insert on public.movements
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
    and (
      (select private.has_role('super_admin', 'admin'))
      or (
        (select private.has_role('prorab', 'omborchi'))
        and type in ('kirim', 'chiqim')
        and private.can_access_object(object_id)
      )
    )
  );

create policy movements_update on public.movements
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  );

-- ============================================================================
-- inventory_counts
--  ko'rish: firma rollari; prorab, omborchi — a'zo obyektlar
--  qo'shish: admin, tekshiruvchi
--  o'zgartirish: admin; tekshiruvchi — o'zi yaratgan va status = 'draft'
--  status draft → submitted — faqat public.submit_inventory_count() (trigger bloklaydi)
-- ============================================================================
create policy inventory_counts_select on public.inventory_counts
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor', 'tekshiruvchi')))
    and (
      (select private.is_company_wide())
      or ((select private.has_role('prorab', 'omborchi')) and object_id in (select private.my_object_ids()))
    )
  );

create policy inventory_counts_insert on public.inventory_counts
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'tekshiruvchi'))
    and status = 'draft'
    and deleted_at is null
    and created_by = (select private.my_profile_id())
  );

create policy inventory_counts_update on public.inventory_counts
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (
      (select private.has_role('super_admin', 'admin'))
      or (
        (select private.has_role('tekshiruvchi'))
        and created_by = (select private.my_profile_id())
        and status = 'draft'
        and deleted_at is null
      )
    )
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (
      (select private.has_role('super_admin', 'admin'))
      or ((select private.has_role('tekshiruvchi')) and created_by = (select private.my_profile_id()))
    )
  );

-- ============================================================================
-- inventory_count_items — ko'rinish ota-yozuv (inventory_counts) RLS'i orqali
-- ============================================================================
create policy inventory_count_items_select on public.inventory_count_items
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor', 'tekshiruvchi')))
    and exists (
      select 1 from public.inventory_counts c
       where c.company_id = inventory_count_items.company_id
         and c.id = inventory_count_items.inventory_count_id
    )
  );

create policy inventory_count_items_insert on public.inventory_count_items
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
    and (
      (select private.has_role('super_admin', 'admin'))
      or (
        (select private.has_role('tekshiruvchi'))
        and exists (
          select 1 from public.inventory_counts c
           where c.company_id = inventory_count_items.company_id
             and c.id = inventory_count_items.inventory_count_id
             and c.status = 'draft'
             and c.deleted_at is null
             and c.created_by = (select private.my_profile_id())
        )
      )
    )
  );

create policy inventory_count_items_update on public.inventory_count_items
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (
      (select private.has_role('super_admin', 'admin'))
      or (
        (select private.has_role('tekshiruvchi'))
        and exists (
          select 1 from public.inventory_counts c
           where c.company_id = inventory_count_items.company_id
             and c.id = inventory_count_items.inventory_count_id
             and c.status = 'draft'
             and c.deleted_at is null
             and c.created_by = (select private.my_profile_id())
        )
      )
    )
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (
      (select private.has_role('super_admin', 'admin'))
      or (
        (select private.has_role('tekshiruvchi'))
        and exists (
          select 1 from public.inventory_counts c
           where c.company_id = inventory_count_items.company_id
             and c.id = inventory_count_items.inventory_count_id
             and c.status = 'draft'
             and c.deleted_at is null
             and c.created_by = (select private.my_profile_id())
        )
      )
    )
  );

-- ============================================================================
-- estimates — firma rollari; prorab — a'zo obyektlar. Yozish: admin, buxgalter
-- ============================================================================
create policy estimates_select on public.estimates
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter')))
    and (
      (select private.is_company_wide())
      or ((select private.has_role('prorab')) and object_id in (select private.my_object_ids()))
    )
  );

create policy estimates_insert on public.estimates
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'buxgalter'))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
  );

create policy estimates_update on public.estimates
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'buxgalter'))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'buxgalter'))
  );

-- estimate_items — ko'rinish ota-yozuv (estimates) RLS'i orqali
create policy estimate_items_select on public.estimate_items
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter')))
    and exists (
      select 1 from public.estimates e
       where e.company_id = estimate_items.company_id
         and e.id = estimate_items.estimate_id
    )
  );

create policy estimate_items_insert on public.estimate_items
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'buxgalter'))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
  );

create policy estimate_items_update on public.estimate_items
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'buxgalter'))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'buxgalter'))
  );

-- ============================================================================
-- material_requests — firma rollari; prorab — a'zo obyektlar.
-- Qo'shish: admin; prorab (a'zo obyekt, status = kutilmoqda). O'zgartirish: admin, taminotchi
-- ============================================================================
create policy material_requests_select on public.material_requests
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor', 'taminotchi')))
    and (
      (select private.is_company_wide())
      or ((select private.has_role('prorab')) and object_id in (select private.my_object_ids()))
    )
  );

create policy material_requests_insert on public.material_requests
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
    and (
      (select private.has_role('super_admin', 'admin'))
      or (
        (select private.has_role('prorab'))
        and status = 'kutilmoqda'
        and decided_by is null
        and private.can_access_object(object_id)
      )
    )
  );

create policy material_requests_update on public.material_requests
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'taminotchi'))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'taminotchi'))
  );

-- ============================================================================
-- transfers — firma rollari; prorab, omborchi — qaysidir tomoni a'zo obyekt.
-- Qo'shish: admin; prorab (from_object a'zo, status = yuborildi). O'zgartirish: admin
-- ============================================================================
create policy transfers_select on public.transfers
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
    and (
      (select private.is_company_wide())
      or (
        (select private.has_role('prorab', 'omborchi'))
        and (from_object_id in (select private.my_object_ids())
             or to_object_id in (select private.my_object_ids()))
      )
    )
  );

create policy transfers_insert on public.transfers
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
    and (
      (select private.has_role('super_admin', 'admin'))
      or (
        (select private.has_role('prorab'))
        and status = 'yuborildi'
        and private.can_access_object(from_object_id)
      )
    )
  );

create policy transfers_update on public.transfers
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  );

-- ============================================================================
-- alerts — ko'rish: admin, direktor, buxgalter; qo'shish: faqat tizim
-- (service_role / trigger); o'zgartirish: admin
-- ============================================================================
create policy alerts_select on public.alerts
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter'))
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
  );

create policy alerts_update on public.alerts
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  );

-- ============================================================================
-- audit_log — ko'rish: admin, direktor (o'z firmasi), super_admin (hammasi)
-- ============================================================================
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    (select private.is_super_admin())
    or (
      company_id = (select private.my_company_id())
      and (select private.has_role('admin', 'direktor'))
    )
  );
