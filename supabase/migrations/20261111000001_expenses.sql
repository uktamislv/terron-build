-- ============================================================================
-- Xarajatlar (ombordan tashqari) va "smetaga kirmaydi" materiallar.
-- Shartnoma: docs/expenses-design.md; baza tomoni — docs/db-design.md → "Xarajatlar".
--
--   1. alert_type ∪ xarajat_limiti (faqat plpgsql runtime'da ishlatiladi).
--   2. materials.outside_estimate.
--   3. public.expense_categories (+ har firmaga standart turlar).
--   4. public.expenses (RLS, guardlar, chek, rasm, takroriy yozuv, oylik limit,
--      boshqa nomidan, o'zgartirish/o'chirish/tiklash alertlari).
--   5. Pul: cash_balances, cash_position, podotchet muddati, haftalik hisob — podotchet xarajatlar.
--   6. Hisobotlar: dashboard_summary, spend_breakdown (drop + create), kunlik hisobot.
--   7. Tarix: history_tables, deleted_records, audit_record_label; photo-hash navbati.
--   8. Outbox: expense_on_your_name; bug_report — faqat super_admin.
-- Oldingi funksiyalar create or replace bilan; o'zgarmagan qismlar aynan ko'chirilgan
-- (20261109000001_audit2_fixes.sql va oldingilardan oxirgi ta'riflar).
-- ============================================================================

-- ============================================================================
-- 1. Enum
-- ============================================================================
alter type public.alert_type add value if not exists 'xarajat_limiti';

-- ============================================================================
-- 2. "Smetaga kirmaydi" belgisi (admin — materials_update RLS)
-- ============================================================================
alter table public.materials
  add column outside_estimate boolean not null default false;

comment on column public.materials.outside_estimate is
  'Smetaga kirmaydi: qoida 4 (normadan_oshish, not_in_estimate), qoida 6 (smetadan_ortiq_sorov) '
  'va smetasiz_chiqim bu materialni hisobga olmaydi. Ombor, xarid, narx og''ishi — oddiy material kabi.';

-- ============================================================================
-- 3. Xarajat turlari
-- ============================================================================
create table public.expense_categories (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id),
  name          text not null
                  constraint expense_categories_name_length_check check (char_length(btrim(name)) between 1 and 80),
  monthly_limit numeric(18,2)
                  constraint expense_categories_monthly_limit_check check (monthly_limit > 0),
  photo_required boolean not null default false,
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint expense_categories_company_id_id_key unique (company_id, id)
);

create unique index expense_categories_company_name_key
  on public.expense_categories (company_id, private.norm_name(name)) where deleted_at is null;
create index expense_categories_company_sort_idx
  on public.expense_categories (company_id, sort_order, name) where deleted_at is null;
create index expense_categories_created_by_idx on public.expense_categories (created_by);
create index expense_categories_company_deleted_idx
  on public.expense_categories (company_id, deleted_at) where deleted_at is not null;

create trigger a_block_delete before delete on public.expense_categories
  for each row execute function private.tg_block_delete();
create trigger a_block_truncate before truncate on public.expense_categories
  for each statement execute function private.tg_block_truncate();
create trigger a_before_insert before insert on public.expense_categories
  for each row execute function private.tg_before_insert();
create trigger a_before_update before update on public.expense_categories
  for each row execute function private.tg_before_update();
create trigger z_audit after insert or update on public.expense_categories
  for each row execute function private.audit_row();

-- Nom: btrim, firma ichida norm_name bo'yicha takrorlanmaydi (insert, qayta nomlash, tiklash).
create function private.tg_expense_categories_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if new.deleted_at is null
     and (tg_op = 'INSERT' or old.deleted_at is not null
          or private.norm_name(new.name) is distinct from private.norm_name(old.name)) then
    perform pg_advisory_xact_lock(hashtextextended('terron.expense_categories:' || new.company_id::text, 0));
    if exists (select 1 from public.expense_categories c
                where c.company_id = new.company_id
                  and private.norm_name(c.name) = private.norm_name(new.name)
                  and c.deleted_at is null
                  and c.id <> new.id) then
      raise exception 'Bu nomdagi xarajat turi allaqachon bor'
        using errcode = '23505', hint = 'expense_category_duplicate';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.tg_expense_categories_guard() from public, anon;
create trigger b_expense_categories_guard before insert or update on public.expense_categories
  for each row execute function private.tg_expense_categories_guard();

alter table public.expense_categories enable row level security;
alter table public.expense_categories force row level security;

-- Ko'rish: firma a'zolari (tekshiruvchidan tashqari); o'chirilganlar — admin, direktor, super_admin.
create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and not (select private.is_blind_counter())
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
  );
create policy expense_categories_insert on public.expense_categories
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
  );
create policy expense_categories_update on public.expense_categories
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  );

revoke all on public.expense_categories from public, anon, authenticated, service_role;
grant select, insert, update on public.expense_categories to authenticated;
grant select, insert, update, delete on public.expense_categories to service_role;

-- Standart turlar: idempotent (norm_name bo'yicha). Yangi firma — trigger, mavjudlar — pastda.
create function private.seed_expense_categories(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  r   record;
begin
  for r in
    select x.name, x.ord
      from (values ('Oziq-ovqat', 1), ('Yoqilg''i', 2), ('Transport va yetkazish', 3),
                   ('Asbob-uskuna ijarasi', 4), ('Kommunal xizmatlar', 5), ('Boshqa', 6)) as x(name, ord)
     order by x.ord
  loop
    if not exists (select 1 from public.expense_categories c
                    where c.company_id = p_company_id
                      and private.norm_name(c.name) = private.norm_name(r.name)
                      and c.deleted_at is null) then
      insert into public.expense_categories (company_id, name, sort_order) values (p_company_id, r.name, r.ord);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke execute on function private.seed_expense_categories(uuid) from public, anon, authenticated;

create function private.tg_companies_expense_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_expense_categories(new.id);
  return null;
end;
$$;
revoke execute on function private.tg_companies_expense_categories() from public, anon;
create trigger zz_expense_categories after insert on public.companies
  for each row execute function private.tg_companies_expense_categories();

select private.seed_expense_categories(c.id) from public.companies c order by c.id;

-- ============================================================================
-- 4. Xarajatlar
-- ============================================================================
create table public.expenses (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id),
  category_id          uuid not null,
  object_id            uuid,
  amount               numeric(18,2) not null constraint expenses_amount_check check (amount > 0),
  spent_at             timestamptz not null default now(),
  payer_id             uuid not null,
  payment_source       text not null
                         constraint expenses_payment_source_check check (payment_source in ('podotchet', 'firma')),
  supplier_id          uuid,
  note                 text constraint expenses_note_length_check check (char_length(note) <= 500),
  receipt_photo_path   text,
  receipt_photo_sha256 text constraint expenses_receipt_photo_sha256_check check (receipt_photo_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_fiscal_sign  text constraint expenses_receipt_fiscal_sign_check check (receipt_fiscal_sign ~ '^[0-9A-Za-z]{1,64}$'),
  receipt_terminal_id  text constraint expenses_receipt_terminal_id_check
                         check (char_length(receipt_terminal_id) between 1 and 64),
  receipt_no           text constraint expenses_receipt_no_check check (char_length(receipt_no) between 1 and 64),
  receipt_verified     boolean not null default false,
  receipt_total        numeric(18,2) constraint expenses_receipt_total_check check (receipt_total >= 0),
  seller_tin           text constraint expenses_seller_tin_check check (seller_tin ~ '^[0-9]{9,14}$'),
  geo_lat              numeric(9,6) constraint expenses_geo_lat_check check (geo_lat between -90 and 90),
  geo_lng              numeric(9,6) constraint expenses_geo_lng_check check (geo_lng between -180 and 180),
  geo_accuracy_m       integer constraint expenses_geo_accuracy_check check (geo_accuracy_m between 0 and 100000),
  geo_status           text constraint expenses_geo_status_check check (geo_status in ('ok', 'denied', 'unavailable')),
  created_by           uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  constraint expenses_company_id_id_key unique (company_id, id),
  constraint expenses_category_fkey foreign key (company_id, category_id)
    references public.expense_categories (company_id, id),
  constraint expenses_object_fkey foreign key (company_id, object_id) references public.objects (company_id, id),
  constraint expenses_payer_fkey foreign key (company_id, payer_id) references public.profiles (company_id, id),
  constraint expenses_supplier_fkey foreign key (company_id, supplier_id) references public.suppliers (company_id, id),
  constraint expenses_geo_check check (
    (geo_lat is null) = (geo_lng is null)
    and (geo_lat is null or geo_status = 'ok')
    and (geo_status is distinct from 'ok' or geo_lat is not null)
    and (geo_accuracy_m is null or geo_lat is not null))
);

comment on table public.expenses is
  'Ombordan tashqari xarajatlar (oziq-ovqat, yoqilg''i, transport ...). Qoldiqqa ta''sir qilmaydi; '
  'payment_source = podotchet bo''lsa to''lovchining qo''lidagi puldan ayiriladi. docs/expenses-design.md.';

create index expenses_company_category_idx on public.expenses (company_id, category_id);
create index expenses_company_object_idx on public.expenses (company_id, object_id);
create index expenses_company_payer_idx on public.expenses (company_id, payer_id);
create index expenses_company_supplier_idx on public.expenses (company_id, supplier_id);
create index expenses_created_by_idx on public.expenses (created_by);
create index expenses_company_spent_idx on public.expenses (company_id, spent_at) where deleted_at is null;
create index expenses_company_category_spent_idx
  on public.expenses (company_id, category_id, spent_at) where deleted_at is null;
create index expenses_company_object_spent_idx
  on public.expenses (company_id, object_id, spent_at) where deleted_at is null;
create index expenses_company_payer_source_idx
  on public.expenses (company_id, payer_id, payment_source) where deleted_at is null;
create index expenses_created_by_time_idx on public.expenses (created_by, created_at desc) where deleted_at is null;
create index expenses_company_deleted_idx on public.expenses (company_id, deleted_at) where deleted_at is not null;
create index expenses_receipt_photo_path_idx on public.expenses (receipt_photo_path) where receipt_photo_path is not null;
create unique index expenses_receipt_photo_path_key
  on public.expenses (receipt_photo_path) where receipt_photo_path is not null and deleted_at is null;
create unique index expenses_receipt_fiscal_sign_key
  on public.expenses (company_id, receipt_fiscal_sign) where receipt_fiscal_sign is not null and deleted_at is null;
create index expenses_receipt_sha_idx
  on public.expenses (company_id, receipt_photo_sha256) where receipt_photo_sha256 is not null and deleted_at is null;
-- Alertlar: xarajat_limiti — tur + oy bo'yicha qidiruv
create index alerts_company_category_month_idx
  on public.alerts (company_id, (details ->> 'category_id'), (details ->> 'month')) where details ? 'category_id';

alter table public.expenses enable row level security;
alter table public.expenses force row level security;

-- Ko'rish: admin, direktor, buxgalter, taminotchi (super_admin) — hammasi; boshqalar — o'zi to'lagan
-- yoki o'zi kiritgan. Tekshiruvchi — hech narsa. O'chirilganlar — admin, direktor, super_admin.
create policy expenses_select on public.expenses
  for select to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and not (select private.is_blind_counter())
    and (deleted_at is null or (select private.has_role('super_admin', 'admin', 'direktor')))
    and ((select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter', 'taminotchi'))
         or payer_id = (select private.my_profile_id())
         or created_by = (select private.my_profile_id()))
  );
-- "Mening yozuvlarim": muallif o'zi kiritgan o'chirilgan xarajatni ko'radi.
create policy expenses_select_own_deleted on public.expenses
  for select to authenticated
  using (
    deleted_at is not null
    and created_by = (select private.my_profile_id())
    and company_id = (select private.my_company_id())
    and not (select private.is_blind_counter())
  );
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and deleted_at is null
    and created_by = (select private.my_profile_id())
    and (select private.has_role('super_admin', 'admin', 'buxgalter', 'taminotchi', 'prorab', 'haydovchi'))
    and ((select private.has_role('super_admin', 'admin')) or payer_id = (select private.my_profile_id()))
    and (object_id is null or private.can_access_object(object_id))
  );
create policy expenses_update on public.expenses
  for update to authenticated
  using (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  )
  with check (
    ((select private.is_super_admin()) or company_id = (select private.my_company_id()))
    and (select private.has_role('super_admin', 'admin'))
  );

revoke all on public.expenses from public, anon, authenticated, service_role;
grant select, insert, update on public.expenses to authenticated;
grant select, insert, update, delete on public.expenses to service_role;

-- Alert details uchun xarajat qo'shimchasi (boshqa jadvallarda — bo'sh obyekt).
create function private.expense_alert_extra(p_table text, p_row jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_table = 'expenses' then
    jsonb_build_object(
      'expense_id',     p_row -> 'id',
      'category_id',    p_row -> 'category_id',
      'category_name',  (select c.name from public.expense_categories c
                          where c.company_id = (p_row ->> 'company_id')::uuid and c.id = (p_row ->> 'category_id')::uuid),
      'payer_id',       p_row -> 'payer_id',
      'payer_name',     (select p.full_name from public.profiles p
                          where p.company_id = (p_row ->> 'company_id')::uuid and p.id = (p_row ->> 'payer_id')::uuid),
      'payment_source', p_row -> 'payment_source',
      'spent_at',       p_row -> 'spent_at')
  else '{}'::jsonb end
$$;
revoke execute on function private.expense_alert_extra(text, jsonb) from public, anon, authenticated;

-- Toshkent oyi (oyning birinchi kuni).
create function private.tashkent_month(p_ts timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', p_ts at time zone 'Asia/Tashkent')::date
$$;
revoke execute on function private.tashkent_month(timestamptz) from public, anon;
grant execute on function private.tashkent_month(timestamptz) to authenticated, service_role;

-- ============================================================================
-- 6. Umumiy triggerlar — expenses qo'shildi (create or replace; mantiq o'zgarmagan)
-- ============================================================================

-- Rasm yo'li: bitta yo'l — bitta tirik yozuv, endi expenses bilan birga.
create or replace function private.tg_ops_photo_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_col     constant text := tg_argv[0];
  v_path    text := to_jsonb(new) ->> v_col;
  v_changed boolean;
  v_revived boolean := false;
  v_uid     uuid := auth.uid();
begin
  if v_path is not null and btrim(v_path) = '' then
    new := jsonb_populate_record(new, jsonb_build_object(v_col, null));
    v_path := null;
  end if;

  if v_path is null then
    return new;
  end if;
  v_changed := tg_op = 'INSERT' or v_path is distinct from (to_jsonb(old) ->> v_col);
  if tg_op = 'UPDATE' then
    v_revived := old.deleted_at is not null and new.deleted_at is null;
  end if;
  if not v_changed and not v_revived then
    return new;
  end if;

  if v_changed then
    if v_path !~ '^[0-9a-f-]{36}/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$' then
      raise exception 'Rasm yo''li noto''g''ri formatda'
        using errcode = '23514', hint = 'ops_photo_path_format';
    end if;
    if split_part(v_path, '/', 1) <> new.company_id::text then
      raise exception 'Rasm boshqa firma papkasida — uni bu yozuvga biriktirib bo''lmaydi'
        using errcode = '23514', hint = 'ops_photo_path_company';
    end if;

    if v_uid is not null and not private.has_role('super_admin', 'admin') then
      if not exists (
        select 1 from storage.objects o
         where o.bucket_id = 'photos'
           and o.name = v_path
           and o.owner_id = v_uid::text
           and o.created_at > now() - interval '24 hours'
      ) then
        raise exception 'Rasm topilmadi yoki uni siz yuklamagansiz (rasm 24 soat ichida biriktirilishi kerak)'
          using errcode = '42501', hint = 'ops_photo_not_owned';
      end if;
    end if;
  end if;

  if new.deleted_at is null then
    perform pg_advisory_xact_lock(hashtextextended('terron.photo_path:' || v_path, 0));
    if exists (select 1 from public.movements m
                where m.photo_path = v_path and m.deleted_at is null
                  and (tg_table_name <> 'movements' or m.id <> new.id))
       or exists (select 1 from public.purchases p
                   where p.receipt_photo_path = v_path and p.deleted_at is null
                     and (tg_table_name <> 'purchases' or p.id <> new.id))
       or exists (select 1 from public.expenses e
                   where e.receipt_photo_path = v_path and e.deleted_at is null
                     and (tg_table_name <> 'expenses' or e.id <> new.id)) then
      raise exception 'Bu rasm boshqa yozuvga biriktirilgan — yangi rasm yuklang'
        using errcode = '23505', hint = 'ops_photo_reused';
    end if;
  end if;
  return new;
end;
$$;

-- Xarid chek qo'riqchisi: fiskal belgi endi xarajatlar bilan birga tekshiriladi (receipt_already_used).
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

-- ============================================================================
-- 7. Xarajat triggerlari
-- ============================================================================

-- Tur: yangi xarajat / tiklash / tur almashtirish — o'chirilgan yoki nofaol turga yo'q.
-- Izoh btrim (bo'sh — null).
create function private.tg_expenses_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active  boolean;
  v_deleted timestamptz;
begin
  new.note := nullif(btrim(new.note), '');
  if new.deleted_at is null
     and (tg_op = 'INSERT' or old.deleted_at is not null or new.category_id is distinct from old.category_id) then
    select c.is_active, c.deleted_at into v_active, v_deleted
      from public.expense_categories c
     where c.company_id = new.company_id and c.id = new.category_id
       for share;
    -- topilmasa — kompozit FK (23503)
    if found and (v_deleted is not null or not v_active) then
      raise exception 'Xarajat turi o''chirilgan yoki nofaol'
        using errcode = 'P0001', hint = 'expense_category_inactive';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.tg_expenses_guard() from public, anon;

-- To'lovchi va to'lov manbai (xariddagi b_buyer_guard bilan bir xil qoida).
create function private.tg_expenses_payer_guard()
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
revoke execute on function private.tg_expenses_payer_guard() from public, anon;

-- Chek, rasm xeshi, fiskal belgi (xaridlar bilan birga), rasm majburiyligi — c_purchases_auto bilan bir xil.
create function private.tg_expenses_auto_guard()
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
revoke execute on function private.tg_expenses_auto_guard() from public, anon;

-- chek_farqi (G): chekdagi jami ≠ kiritilgan summa (> 1 so'm). Ko'p qatorli chek — taqqoslanmaydi.
create function private.evaluate_expense_receipt_total(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e       public.expenses%rowtype;
  v_alert   public.alerts%rowtype;
  v_details jsonb;
  v_multi   boolean;
begin
  select e.* into v_e from public.expenses e where e.id = p_expense_id;
  if not found then
    return;
  end if;
  perform private.alert_lock('chek_farqi:' || v_e.id::text);

  select a.* into v_alert
    from public.alerts a
   where a.company_id = v_e.company_id
     and (a.details ->> 'record_id') = v_e.id::text
     and (a.details ->> 'table') = 'expenses'
     and a.type = 'chek_farqi'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
   limit 1;

  if v_e.receipt_fiscal_sign is not null then
    select case when jsonb_typeof(l.payload -> 'items') = 'array'
                then jsonb_array_length(l.payload -> 'items') > 1 else false end
      into v_multi
      from public.receipt_lookups l
     where l.company_id = v_e.company_id
       and l.fiscal_sign = v_e.receipt_fiscal_sign
       and l.deleted_at is null;
  end if;
  v_multi := coalesce(v_multi, false);

  if v_e.deleted_at is not null or v_e.receipt_total is null or v_multi
     or abs(v_e.receipt_total - v_e.amount) <= 1 then
    if v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id,
        case when v_e.deleted_at is not null then 'expense_deleted'
             when v_multi then 'multi_line_receipt'
             else 'within_threshold' end);
    end if;
    return;
  end if;

  v_details := jsonb_build_object(
    'table',               'expenses',
    'record_id',           v_e.id,
    'expense_id',          v_e.id,
    'receipt_total',       v_e.receipt_total,
    'total_amount',        v_e.amount,
    'diff',                v_e.amount - v_e.receipt_total,
    'receipt_fiscal_sign', v_e.receipt_fiscal_sign,
    'receipt_verified',    v_e.receipt_verified);

  if v_alert.id is not null then
    if (v_alert.details - private.alert_meta_keys()) is distinct from v_details then
      update public.alerts
         set details = v_alert.details || v_details, object_id = v_e.object_id
       where id = v_alert.id;
    end if;
    return;
  end if;

  if exists (
    select 1 from public.alerts a
     where a.company_id = v_e.company_id
       and (a.details ->> 'record_id') = v_e.id::text
       and (a.details ->> 'table') = 'expenses'
       and a.type = 'chek_farqi'
       and a.status = 'yopildi'
       and a.deleted_at is null
       and coalesce((a.details ->> 'auto_closed')::boolean, false) = false
       and (a.details ->> 'receipt_total')::numeric = v_e.receipt_total
       and (a.details ->> 'total_amount')::numeric = v_e.amount
  ) then
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, details)
  values (v_e.company_id, 'chek_farqi', 'ogohlantirish', v_e.object_id, v_details);
end;
$$;
revoke execute on function private.evaluate_expense_receipt_total(uuid) from public, anon, authenticated;

-- sotuvchi_stir_farqi (belgi): chekdagi STIR ≠ tanlangan sotuvchi STIR'i.
create function private.evaluate_expense_seller_tin(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e      public.expenses%rowtype;
  v_s_name text;
  v_s_tin  text;
  v_alert  public.alerts%rowtype;
  v_bad    boolean := false;
  v_det    jsonb;
begin
  select e.* into v_e from public.expenses e where e.id = p_expense_id;
  if not found then
    return;
  end if;
  perform private.alert_lock('sotuvchi_stir_farqi:' || v_e.id::text);

  if v_e.supplier_id is not null then
    select s.name, s.tin into v_s_name, v_s_tin
      from public.suppliers s
     where s.company_id = v_e.company_id and s.id = v_e.supplier_id;
  end if;
  v_bad := v_e.deleted_at is null and v_e.seller_tin is not null
           and v_s_tin is not null and v_s_tin <> v_e.seller_tin;

  select a.* into v_alert
    from public.alerts a
   where a.company_id = v_e.company_id
     and (a.details ->> 'record_id') = v_e.id::text
     and (a.details ->> 'table') = 'expenses'
     and a.type::text = 'sotuvchi_stir_farqi'
     and a.status in ('yangi', 'korildi')
     and a.deleted_at is null
   limit 1;

  if not v_bad then
    if v_alert.id is not null then
      perform private.auto_close_alert(v_alert.id,
        case when v_e.deleted_at is not null then 'expense_deleted' else 'not_applicable' end);
    end if;
    return;
  end if;

  v_det := jsonb_build_object(
    'table',               'expenses',
    'record_id',           v_e.id,
    'expense_id',          v_e.id,
    'seller_tin',          v_e.seller_tin,
    'supplier_id',         v_e.supplier_id,
    'supplier_name',       v_s_name,
    'supplier_tin',        v_s_tin,
    'receipt_fiscal_sign', v_e.receipt_fiscal_sign);

  if v_alert.id is not null then
    if (v_alert.details - private.alert_meta_keys()) is distinct from v_det then
      update public.alerts set details = v_det || private.alert_meta(v_alert.details) where id = v_alert.id;
    end if;
    return;
  end if;

  insert into public.alerts (company_id, type, severity, object_id, details)
  values (v_e.company_id, 'sotuvchi_stir_farqi'::public.alert_type, 'belgi', v_e.object_id, v_det);
end;
$$;
revoke execute on function private.evaluate_expense_seller_tin(uuid) from public, anon, authenticated;

-- Oylik limit (xarajat_limiti, ogohlantirish): tur + Toshkent oyi bo'yicha bitta ochiq alert.
--   spent > limit → alert (bor bo'lsa details yangilanadi);
--   spent <= limit → within_threshold; limit yo'q → not_applicable; tur o'chirilgan → category_deleted.
--   Admin qo'lda yopgan alert: shu limit va spent <= yopilgandagi spent bo'lsa qayta ochilmaydi.
create function private.evaluate_expense_limit(p_company_id uuid, p_category_id uuid, p_month date)
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
revoke execute on function private.evaluate_expense_limit(uuid, uuid, date) from public, anon, authenticated;

-- AFTER: chek_farqi, sotuvchi STIR, takroriy yozuv (C), rasm takrori, oylik limit.
create function private.tg_expenses_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if tg_op = 'INSERT'
     or new.receipt_total is distinct from old.receipt_total
     or new.amount is distinct from old.amount
     or new.receipt_fiscal_sign is distinct from old.receipt_fiscal_sign
     or new.deleted_at is distinct from old.deleted_at then
    perform private.evaluate_expense_receipt_total(new.id);
  end if;

  if (tg_op = 'INSERT' and new.seller_tin is not null and new.supplier_id is not null)
     or (tg_op = 'UPDATE' and (new.seller_tin is distinct from old.seller_tin
                               or new.supplier_id is distinct from old.supplier_id
                               or new.deleted_at is distinct from old.deleted_at)) then
    perform private.evaluate_expense_seller_tin(new.id);
  end if;

  if tg_op = 'INSERT' then
    perform private.evaluate_duplicate('expenses', new.id);
  end if;
  if new.receipt_photo_sha256 is not null
     and (tg_op = 'INSERT' or new.receipt_photo_sha256 is distinct from old.receipt_photo_sha256
          or (old.deleted_at is not null and new.deleted_at is null)) then
    perform private.evaluate_duplicate_photo('expenses', new.id);
  end if;

  if tg_op = 'INSERT'
     or new.amount is distinct from old.amount
     or new.category_id is distinct from old.category_id
     or new.spent_at is distinct from old.spent_at
     or new.deleted_at is distinct from old.deleted_at then
    for r in
      select distinct x.cat, x.mon
        from (select new.category_id as cat, private.tashkent_month(new.spent_at) as mon
              union all
              select old.category_id, private.tashkent_month(old.spent_at) where tg_op = 'UPDATE') x
       order by 1, 2
    loop
      perform private.evaluate_expense_limit(new.company_id, r.cat, r.mon);
    end loop;
  end if;
  return null;
end;
$$;
revoke execute on function private.tg_expenses_rules() from public, anon;

-- Boshqa odam nomidan (admin): xarid_boshqa_nomidan (details.table = 'expenses') + to'lovchiga expense_on_your_name.
create function private.tg_expenses_other_payer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := private.my_profile_id();
  v_payer text;
  v_actor text;
  v_obj   text;
  v_cat   text;
  v_alert uuid;
begin
  if auth.uid() is null or new.deleted_at is not null or new.payer_id is null
     or new.payer_id is not distinct from coalesce(v_me, new.created_by) then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.payer_id is not distinct from old.payer_id then
    return null;
  end if;

  select p.full_name into v_payer from public.profiles p where p.company_id = new.company_id and p.id = new.payer_id;
  select p.full_name into v_actor from public.profiles p where p.id = v_me;
  select o.name into v_obj from public.objects o where o.company_id = new.company_id and o.id = new.object_id;
  select c.name into v_cat from public.expense_categories c where c.company_id = new.company_id and c.id = new.category_id;

  insert into public.alerts (company_id, type, severity, object_id, details)
  values (new.company_id, 'xarid_boshqa_nomidan'::public.alert_type, 'ogohlantirish', new.object_id,
          jsonb_build_object(
            'table',            'expenses',
            'record_id',        new.id,
            'expense_id',       new.id,
            'purchase_id',      null,
            'buyer_id',         new.payer_id,
            'buyer_name',       v_payer,
            'payer_id',         new.payer_id,
            'payer_name',       v_payer,
            'actor_profile_id', v_me,
            'actor_name',       v_actor,
            'amount',           new.amount,
            'object_id',        new.object_id,
            'object_name',      v_obj,
            'category_id',      new.category_id,
            'category_name',    v_cat,
            'material_id',      null,
            'material_name',    null,
            'spent_at',         new.spent_at,
            'payment_source',   new.payment_source,
            'via',              lower(tg_op)))
  returning id into v_alert;

  perform private.enqueue_workflow(new.company_id, 'expense_on_your_name', new.id, new.payer_id,
    jsonb_build_object(
      'expense_id',     new.id,
      'alert_id',       v_alert,
      'company_name',   (select c.name from public.companies c where c.id = new.company_id),
      'payer_id',       new.payer_id,
      'payer_name',     v_payer,
      'actor_name',     v_actor,
      'object_id',      new.object_id,
      'object_name',    v_obj,
      'category_id',    new.category_id,
      'category_name',  v_cat,
      'amount',         new.amount,
      'payment_source', new.payment_source,
      'note',           new.note,
      'spent_at',       new.spent_at));
  return null;
end;
$$;
revoke execute on function private.tg_expenses_other_payer() from public, anon;

-- Trigger tartibi (alifbo): a_* → b_expenses_guard → b_op_date → b_payer_guard → b_photo_hash_client
-- → b_photo_path → c_expenses_auto → z_audit → zz_*.
create trigger a_block_delete before delete on public.expenses
  for each row execute function private.tg_block_delete();
create trigger a_block_truncate before truncate on public.expenses
  for each statement execute function private.tg_block_truncate();
create trigger a_before_insert before insert on public.expenses
  for each row execute function private.tg_before_insert();
create trigger a_before_update before update on public.expenses
  for each row execute function private.tg_before_update();
create trigger b_expenses_guard before insert or update on public.expenses
  for each row execute function private.tg_expenses_guard();
create trigger b_op_date before insert or update on public.expenses
  for each row execute function private.tg_ops_op_date('spent_at');
create trigger b_payer_guard before insert or update on public.expenses
  for each row execute function private.tg_expenses_payer_guard();
create trigger b_photo_hash_client before insert or update on public.expenses
  for each row execute function private.tg_photo_hash_client('receipt_photo_sha256', 'receipt_photo_path');
create trigger b_photo_path before insert or update on public.expenses
  for each row execute function private.tg_ops_photo_path('receipt_photo_path');
create trigger c_expenses_auto before insert or update on public.expenses
  for each row execute function private.tg_expenses_auto_guard();
create trigger z_audit after insert or update on public.expenses
  for each row execute function private.audit_row();
create trigger zz_deleted_alert after update on public.expenses
  for each row when (old.deleted_at is distinct from new.deleted_at)
  execute function private.tg_soft_delete_alert();
create trigger zz_expense_rules_ins after insert on public.expenses
  for each row execute function private.tg_expenses_rules();
create trigger zz_expense_rules_upd after update on public.expenses
  for each row when (old.deleted_at is distinct from new.deleted_at
                     or old.amount is distinct from new.amount
                     or old.category_id is distinct from new.category_id
                     or old.spent_at is distinct from new.spent_at
                     or old.receipt_total is distinct from new.receipt_total
                     or old.receipt_fiscal_sign is distinct from new.receipt_fiscal_sign
                     or old.receipt_photo_sha256 is distinct from new.receipt_photo_sha256
                     or old.seller_tin is distinct from new.seller_tin
                     or old.supplier_id is distinct from new.supplier_id)
  execute function private.tg_expenses_rules();
create trigger zz_other_payer_ins after insert on public.expenses
  for each row execute function private.tg_expenses_other_payer();
create trigger zz_other_payer_upd after update on public.expenses
  for each row when (old.payer_id is distinct from new.payer_id)
  execute function private.tg_expenses_other_payer();
create trigger zz_photo_hash_ins after insert on public.expenses
  for each row when (new.receipt_photo_path is not null and new.receipt_photo_sha256 is null and new.deleted_at is null)
  execute function private.tg_photo_hash_enqueue('receipt_photo_path');
create trigger zz_photo_hash_upd after update on public.expenses
  for each row when (new.receipt_photo_path is not null and new.receipt_photo_sha256 is null and new.deleted_at is null
                     and (old.receipt_photo_path is distinct from new.receipt_photo_path
                          or old.receipt_photo_sha256 is not null
                          or old.deleted_at is not null))
  execute function private.tg_photo_hash_enqueue('receipt_photo_path');
create trigger zz_posted_change after update on public.expenses
  for each row execute function private.tg_posted_change_alert();

-- Tur: limit / o'chirish / tiklash / nom o'zgarsa — joriy oy va ochiq alertli oylar qayta baholanadi.
create function private.tg_expense_categories_limit()
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
revoke execute on function private.tg_expense_categories_limit() from public, anon;
create trigger zz_limit_reeval after update on public.expense_categories
  for each row when (old.monthly_limit is distinct from new.monthly_limit
                     or old.deleted_at is distinct from new.deleted_at
                     or old.name is distinct from new.name)
  execute function private.tg_expense_categories_limit();

-- ============================================================================
-- 8. Takroriy yozuv (C) — expenses: shu created_by, tur, obyekt (null = umumiy), summa,
--    duplicate_window_minutes ichida. Rasm xeshi takrori — harakat/xarid/xarajat birga.
--    movements / purchases tarmoqlari o'zgarmagan.
-- ============================================================================
create or replace function private.duplicate_matches(p_table text, p_record uuid, p_first uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window integer;
begin
  if p_table = 'movements' then
    select c.duplicate_window_minutes into v_window
      from public.movements r join public.companies c on c.id = r.company_id where r.id = p_record;
    return exists (
      select 1
        from public.movements r
        join public.movements f on f.company_id = r.company_id and f.id = p_first
       where r.id = p_record
         and r.deleted_at is null and f.deleted_at is null
         and r.created_by = f.created_by
         and r.object_id = f.object_id and r.material_id = f.material_id
         and r.type = f.type and r.type in ('kirim', 'chiqim')
         and r.qty_base = f.qty_base
         and f.created_at <= r.created_at
         and f.created_at >= r.created_at - make_interval(mins => coalesce(v_window, 0)));
  end if;
  if p_table = 'expenses' then
    select c.duplicate_window_minutes into v_window
      from public.expenses r join public.companies c on c.id = r.company_id where r.id = p_record;
    return exists (
      select 1
        from public.expenses r
        join public.expenses f on f.company_id = r.company_id and f.id = p_first
       where r.id = p_record
         and r.deleted_at is null and f.deleted_at is null
         and r.created_by = f.created_by
         and r.category_id = f.category_id
         and r.object_id is not distinct from f.object_id
         and r.amount = f.amount
         and f.created_at <= r.created_at
         and f.created_at >= r.created_at - make_interval(mins => coalesce(v_window, 0)));
  end if;
  select c.duplicate_window_minutes into v_window
    from public.purchases r join public.companies c on c.id = r.company_id where r.id = p_record;
  return exists (
    select 1
      from public.purchases r
      join public.purchases f on f.company_id = r.company_id and f.id = p_first
     where r.id = p_record
       and r.deleted_at is null and f.deleted_at is null
       and r.created_by = f.created_by
       and r.object_id = f.object_id and r.material_id = f.material_id
       and r.qty_base = f.qty_base and r.total_amount = f.total_amount
       and f.created_at <= r.created_at
       and f.created_at >= r.created_at - make_interval(mins => coalesce(v_window, 0)));
end;
$$;

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

create or replace function private.evaluate_duplicate_photo(p_table text, p_id uuid)
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
  elsif p_table = 'expenses' then
    select e.company_id, e.object_id, null, e.receipt_photo_sha256, e.deleted_at
      into v_company, v_object, v_material, v_sha, v_deleted
      from public.expenses e where e.id = p_id;
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
      union all
      select 'expenses', e.id, e.created_at
        from public.expenses e
       where e.company_id = v_company and e.receipt_photo_sha256 = v_sha and e.deleted_at is null
         and not (p_table = 'expenses' and e.id = p_id)
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

create or replace function private.reevaluate_duplicate(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  v_company uuid;
  v_by     uuid;
  v_created timestamptz;
  v_window integer;
  v_id     uuid;
begin
  if p_table = 'movements' then
    select m.company_id, m.created_by, m.created_at into v_company, v_by, v_created
      from public.movements m where m.id = p_id;
  elsif p_table = 'expenses' then
    select e.company_id, e.created_by, e.created_at into v_company, v_by, v_created
      from public.expenses e where e.id = p_id;
  else
    select p.company_id, p.created_by, p.created_at into v_company, v_by, v_created
      from public.purchases p where p.id = p_id;
  end if;
  if v_company is null then
    return;
  end if;

  for a in
    select x.id, (x.details ->> 'record_id')::uuid as rec, (x.details ->> 'first_id')::uuid as fst
      from public.alerts x
     where x.company_id = v_company
       and x.type = 'takroriy_yozuv'
       and x.status in ('yangi', 'korildi')
       and x.deleted_at is null
       and (x.details ->> 'kind') = 'record'
       and (x.details ->> 'table') = p_table
       and ((x.details ->> 'record_id') = p_id::text or (x.details ->> 'first_id') = p_id::text)
     order by x.id
  loop
    if not private.duplicate_matches(p_table, a.rec, a.fst) then
      perform private.auto_close_alert(a.id, 'not_applicable');
    end if;
  end loop;

  -- (2) avtomatik yopilgan "record" alerti bo'lsa va yana mos kelsa — qayta ochiladi
  for a in
    select x.id, (x.details ->> 'first_id')::uuid as fst
      from public.alerts x
     where x.company_id = v_company
       and x.type = 'takroriy_yozuv'
       and x.status = 'yopildi'
       and x.deleted_at is null
       and coalesce((x.details ->> 'auto_closed')::boolean, false)
       and (x.details ->> 'kind') = 'record'
       and (x.details ->> 'record_id') = p_id::text
     order by x.created_at desc
     limit 1
  loop
    if private.duplicate_matches(p_table, p_id, a.fst) then
      update public.alerts
         set status = 'yangi',
             details = (details - 'auto_closed' - 'closed_reason' - 'closed_by_actor')
                       || jsonb_build_object('reopened_at', now())
       where id = a.id;
    end if;
  end loop;
  perform private.evaluate_duplicate(p_table, p_id);

  select c.duplicate_window_minutes into v_window from public.companies c where c.id = v_company;
  if p_table = 'movements' then
    for v_id in
      select m.id from public.movements m
       where m.company_id = v_company and m.created_by = v_by and m.id <> p_id and m.deleted_at is null
         and m.created_at > v_created and m.created_at <= v_created + make_interval(mins => coalesce(v_window, 0))
       order by m.created_at, m.id
    loop
      perform private.evaluate_duplicate('movements', v_id);
    end loop;
  elsif p_table = 'expenses' then
    for v_id in
      select e.id from public.expenses e
       where e.company_id = v_company and e.created_by = v_by and e.id <> p_id and e.deleted_at is null
         and e.created_at > v_created and e.created_at <= v_created + make_interval(mins => coalesce(v_window, 0))
       order by e.created_at, e.id
    loop
      perform private.evaluate_duplicate('expenses', v_id);
    end loop;
  else
    for v_id in
      select p.id from public.purchases p
       where p.company_id = v_company and p.created_by = v_by and p.id <> p_id and p.deleted_at is null
         and p.created_at > v_created and p.created_at <= v_created + make_interval(mins => coalesce(v_window, 0))
       order by p.created_at, p.id
    loop
      perform private.evaluate_duplicate('purchases', v_id);
    end loop;
  end if;
end;
$$;

-- yozuv_ozgartirildi / yozuv_tuzatildi — expenses ustunlari.
create or replace function private.tg_posted_change_alert()
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
  v_reason  text := nullif(coalesce(current_setting('terron.correct_reason', true), ''), '');
  v_type    text;
  v_sev     text;
  c         text;
begin
  if auth.uid() is null or old.deleted_at is not null or new.deleted_at is not null
     or private.transfer_rpc_active() or private.inventory_rpc_active()
     or coalesce(current_setting('terron.merge_rpc', true), '') = 'on' then
    return null;
  end if;

  v_cols := case tg_table_name
    when 'movements' then array['type', 'object_id', 'material_id', 'unit_id', 'qty_input', 'qty_base',
                                'occurred_at', 'purchase_id', 'photo_path',
                                'geo_lat', 'geo_lng', 'geo_accuracy_m', 'geo_status']
    when 'expenses' then array['category_id', 'object_id', 'amount', 'spent_at', 'payer_id', 'payment_source',
                               'supplier_id', 'receipt_photo_path', 'receipt_fiscal_sign', 'seller_tin',
                               'geo_lat', 'geo_lng', 'geo_accuracy_m', 'geo_status']
    else array['object_id', 'material_id', 'unit_id', 'qty_input', 'qty_base', 'total_amount',
               'unit_price', 'price_per_base', 'purchased_at', 'buyer_id',
               'receipt_photo_path', 'receipt_fiscal_sign', 'supplier_id', 'seller_tin', 'request_id',
               'geo_lat', 'geo_lng', 'geo_accuracy_m', 'geo_status', 'payment_source']
  end;
  select array_agg(k order by k) into v_changed
    from unnest(v_cols) k
   where v_new -> k is distinct from v_old -> k;
  if v_changed is null then
    return null;
  end if;

  foreach c in array v_changed || case when tg_table_name = 'expenses' then '{}'::text[] else array['unit_input'] end loop
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
       'reason',           v_reason,
       'actor_profile_id', v_me,
       'actor_name',       (select p.full_name from public.profiles p where p.id = v_me),
       'author_id',        v_new -> 'created_by',
       'author_name',      (select p.full_name from public.profiles p
                             where p.company_id = new.company_id and p.id = (v_new ->> 'created_by')::uuid),
       'material_name',    (select m.name from public.materials m
                             where m.company_id = new.company_id and m.id = (v_new ->> 'material_id')::uuid),
       'base_unit',        (select m.base_unit from public.materials m
                             where m.company_id = new.company_id and m.id = (v_new ->> 'material_id')::uuid),
       'movement_type',    case when tg_table_name = 'movements' then v_new -> 'type' end)
     || private.expense_alert_extra(tg_table_name, v_new));
  return null;
end;
$$;

-- yozuv_ochirildi / yozuv_tiklandi / cancel_own_entry — expenses tarmog'i.
create or replace function private.tg_soft_delete_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     jsonb := to_jsonb(new);
  v_details jsonb;
  v_me      uuid;
  v_occ     timestamptz;
  v_days    integer;
  v_sev     text;
begin
  if tg_table_name = 'movements' and private.transfer_rpc_active()
     and (v_row ->> 'transfer_id') is not null then
    return null;
  end if;

  if old.deleted_at is null and new.deleted_at is not null
     and coalesce(current_setting('terron.correct_mode', true), '') = 'cancel'
     and tg_table_name in ('movements', 'purchases', 'expenses') then
    v_me := private.my_profile_id();
    insert into public.alerts
      (company_id, type, severity, object_id, material_id, purchase_id, movement_id, details)
    values
      (new.company_id, 'yozuv_tuzatildi'::public.alert_type, 'belgi',
       (v_row ->> 'object_id')::uuid, (v_row ->> 'material_id')::uuid,
       case when tg_table_name = 'purchases' then new.id end,
       case when tg_table_name = 'movements' then new.id end,
       jsonb_build_object(
         'table',            tg_table_name,
         'record_id',        new.id,
         'changed',          jsonb_build_array('deleted_at'),
         'via',              'cancel_own_entry',
         'reason',           nullif(current_setting('terron.correct_reason', true), ''),
         'actor_profile_id', v_me,
         'actor_name',       (select p.full_name from public.profiles p where p.id = v_me),
         'author_id',        v_row -> 'created_by',
         'material_name',    (select m.name from public.materials m
                               where m.company_id = new.company_id and m.id = (v_row ->> 'material_id')::uuid),
         'base_unit',        (select m.base_unit from public.materials m
                               where m.company_id = new.company_id and m.id = (v_row ->> 'material_id')::uuid),
         'qty_base',         v_row -> 'qty_base',
         'amount',           case when tg_table_name = 'expenses' then v_row -> 'amount' else v_row -> 'total_amount' end,
         'movement_type',    case when tg_table_name = 'movements' then v_row -> 'type' end,
         'purchase_id',      case when tg_table_name = 'movements' then v_row -> 'purchase_id' end)
       || private.expense_alert_extra(tg_table_name, v_row));
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
    elsif tg_table_name = 'expenses' then
      v_details := v_details || jsonb_build_object('amount', v_row -> 'amount')
                   || private.expense_alert_extra(tg_table_name, v_row);
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
    v_me := private.my_profile_id();

    update public.alerts a
       set status  = 'yopildi',
           details = a.details || jsonb_build_object(
             'auto_closed', true, 'closed_reason', 'restored',
             'closed_by_actor', v_me)
     where a.company_id = new.company_id
       and (a.details ->> 'record_id') = new.id::text
       and a.type = 'yozuv_ochirildi'
       and a.status in ('yangi', 'korildi')
       and a.deleted_at is null;

    v_occ := (v_row ->> case tg_table_name
                          when 'movements' then 'occurred_at'
                          when 'purchases' then 'purchased_at'
                          when 'expenses'  then 'spent_at'
                          else 'issued_at'
                        end)::timestamptz;
    v_days := floor(extract(epoch from (now() - old.deleted_at)) / 86400)::integer;
    v_sev := case
               when v_days >= 7
                 or (v_occ at time zone 'Asia/Tashkent')::date
                    < date_trunc('month', now() at time zone 'Asia/Tashkent')::date
               then 'jiddiy'
               else 'ogohlantirish'
             end;

    v_details := jsonb_build_object(
      'table',             tg_table_name,
      'record_id',         new.id,
      'actor_profile_id',  v_me,
      'actor_name',        (select p.full_name from public.profiles p where p.id = v_me),
      'material_name',     (select m.name from public.materials m
                             where m.company_id = new.company_id and m.id = (v_row ->> 'material_id')::uuid),
      'amount',            case tg_table_name
                             when 'purchases'     then v_row -> 'total_amount'
                             when 'cash_advances' then v_row -> 'amount'
                             when 'expenses'      then v_row -> 'amount'
                           end,
      'qty_base',          case when tg_table_name in ('purchases', 'movements') then v_row -> 'qty_base' end,
      'base_unit',         (select m.base_unit from public.materials m
                             where m.company_id = new.company_id and m.id = (v_row ->> 'material_id')::uuid),
      'buyer_name',        (select p.full_name from public.profiles p
                             where p.company_id = new.company_id and p.id = (v_row ->> 'buyer_id')::uuid),
      'recipient_name',    (select p.full_name from public.profiles p
                             where p.company_id = new.company_id and p.id = (v_row ->> 'recipient_id')::uuid),
      'movement_type',     case when tg_table_name = 'movements' then v_row -> 'type' end,
      'occurred_at',       v_occ,
      'deleted_at_before', old.deleted_at,
      'days_since',        v_days
    ) || private.expense_alert_extra(tg_table_name, v_row);

    insert into public.alerts
      (company_id, type, severity, object_id, material_id, purchase_id, movement_id, details)
    values
      (new.company_id, 'yozuv_tiklandi', v_sev::public.alert_severity,
       (v_row ->> 'object_id')::uuid, (v_row ->> 'material_id')::uuid,
       case when tg_table_name = 'purchases' then new.id end,
       case when tg_table_name = 'movements' then new.id end,
       v_details);
  end if;
  return null;
end;
$$;

-- correct_entry: expenses — summa (p_total_amount > 0), obyekt (p_object_id), izoh, sabab.
-- p_qty_input / p_unit_id / p_material_id xarajatda — correct_invalid.
create or replace function public.correct_entry(
  p_table        text,
  p_id           uuid,
  p_qty_input    numeric default null,
  p_unit_id      uuid    default null,
  p_total_amount numeric default null,
  p_note         text    default null,
  p_reason       text    default null,
  p_material_id  uuid    default null,
  p_object_id    uuid    default null
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
  v_e       public.expenses%rowtype;
  v_company uuid;
  v_author  uuid;
  v_created timestamptz;
  v_object  uuid;
  v_mat     uuid;
  v_new_mat uuid;
  v_new_obj uuid;
  v_note    text := nullif(btrim(p_note), '');
  v_reason  text := nullif(btrim(p_reason), '');
  v_own     boolean;
  v_move    boolean;
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  if p_table is null or p_table not in ('movements', 'purchases', 'expenses') or p_id is null
     or (p_qty_input is not null and (round(p_qty_input, 6) <= 0 or p_qty_input >= 1e14))
     or (p_total_amount is not null and (p_total_amount < 0 or p_total_amount >= 1e16))
     or (p_table = 'movements' and p_total_amount is not null)
     or (p_table = 'expenses' and (p_qty_input is not null or p_unit_id is not null or p_material_id is not null
                                   or (p_total_amount is not null and round(p_total_amount, 2) <= 0)))
     or (v_note is not null and char_length(v_note) > 500)
     or (v_reason is not null and char_length(v_reason) > 500) then
    raise exception 'Tuzatish ma''lumotlari noto''g''ri'
      using errcode = '22023', hint = 'correct_invalid';
  end if;

  if p_table = 'movements' then
    select m.* into v_m from public.movements m where m.id = p_id and m.deleted_at is null for update;
    if not found or not private.can_access_company(v_m.company_id) then
      raise exception 'Yozuv topilmadi' using errcode = 'P0002', hint = 'correct_not_found';
    end if;
    v_company := v_m.company_id; v_author := v_m.created_by; v_created := v_m.created_at;
    v_object := v_m.object_id; v_mat := v_m.material_id;
  elsif p_table = 'purchases' then
    select p.* into v_p from public.purchases p where p.id = p_id and p.deleted_at is null for update;
    if not found or not private.can_access_company(v_p.company_id) then
      raise exception 'Yozuv topilmadi' using errcode = 'P0002', hint = 'correct_not_found';
    end if;
    v_company := v_p.company_id; v_author := v_p.created_by; v_created := v_p.created_at;
    v_object := v_p.object_id; v_mat := v_p.material_id;
  else
    select e.* into v_e from public.expenses e where e.id = p_id and e.deleted_at is null for update;
    if not found or not private.can_access_company(v_e.company_id) then
      raise exception 'Yozuv topilmadi' using errcode = 'P0002', hint = 'correct_not_found';
    end if;
    v_company := v_e.company_id; v_author := v_e.created_by; v_created := v_e.created_at;
    v_object := v_e.object_id; v_mat := null;
  end if;

  v_own := v_author = v_me and v_created >= now() - interval '30 minutes';
  v_new_mat := coalesce(p_material_id, v_mat);
  v_new_obj := coalesce(p_object_id, v_object);
  v_move := v_new_mat is distinct from v_mat or v_new_obj is distinct from v_object;

  if not v_admin then
    if v_author is distinct from v_me then
      raise exception 'Faqat o''zingiz kiritgan yozuvni tuzatish mumkin'
        using errcode = '42501', hint = 'correct_forbidden';
    end if;
    if not v_own then
      raise exception 'Tuzatish muddati (30 daqiqa) o''tgan — administratorga murojaat qiling'
        using errcode = '55000', hint = 'correct_window_passed';
    end if;
    if (p_table = 'movements' and not (private.has_role('prorab', 'omborchi')
                                       and private.can_access_object(v_object)
                                       and private.can_access_object(v_new_obj)))
       or (p_table = 'purchases' and not (private.has_role('taminotchi')
                                         or (private.has_role('prorab', 'haydovchi')
                                             and private.can_access_object(v_object)
                                             and private.can_access_object(v_new_obj))))
       or (p_table = 'expenses' and not (private.has_role('taminotchi', 'buxgalter')
                                        or (private.has_role('prorab', 'haydovchi')
                                            and (v_object is null or private.can_access_object(v_object))
                                            and (v_new_obj is null or private.can_access_object(v_new_obj))))) then
      raise exception 'Bu yozuvni tuzatishga ruxsat yo''q'
        using errcode = '42501', hint = 'correct_forbidden';
    end if;
  elsif v_move and not v_own then
    -- material / obyektni almashtirish — faqat muallifning o'z tuzatishi
    if v_author is distinct from v_me then
      raise exception 'Material yoki obyektni faqat yozuv muallifi almashtira oladi'
        using errcode = '42501', hint = 'correct_forbidden';
    end if;
    raise exception 'Tuzatish muddati (30 daqiqa) o''tgan — administratorga murojaat qiling'
      using errcode = '55000', hint = 'correct_window_passed';
  end if;

  if p_table = 'movements' then
    if v_m.type not in ('kirim', 'chiqim') or v_m.transfer_id is not null or v_m.inventory_count_id is not null
       or (v_m.purchase_id is not null and v_move) then
      raise exception 'Bog''langan yozuvni tuzatib bo''lmaydi (xarid, o''tkazma yoki inventarizatsiya)'
        using errcode = '55000', hint = 'correct_linked';
    end if;
  elsif p_table = 'purchases' and exists (select 1 from public.movements m
                 where m.company_id = v_company and m.purchase_id = p_id
                   and m.type = 'kirim' and m.deleted_at is null) then
    raise exception 'Kirimga bog''langan xaridni tuzatib bo''lmaydi'
      using errcode = '55000', hint = 'correct_linked';
  end if;

  if v_move and p_table = 'expenses' then
    if not exists (select 1 from public.objects o
                    where o.company_id = v_company and o.id = v_new_obj and o.deleted_at is null) then
      raise exception 'Obyekt topilmadi'
        using errcode = '22023', hint = 'correct_invalid';
    end if;
  elsif v_move then
    if v_new_mat is distinct from v_mat and p_unit_id is null then
      raise exception 'Material almashtirilganda birlikni ham tanlang'
        using errcode = '22023', hint = 'correct_invalid';
    end if;
    if not exists (select 1 from public.materials mt
                    where mt.company_id = v_company and mt.id = v_new_mat
                      and mt.deleted_at is null and mt.is_active)
       or not exists (select 1 from public.objects o
                       where o.company_id = v_company and o.id = v_new_obj and o.deleted_at is null) then
      raise exception 'Material yoki obyekt topilmadi'
        using errcode = '22023', hint = 'correct_invalid';
    end if;
  end if;
  if p_unit_id is not null and not exists (
       select 1 from public.material_units mu
        where mu.company_id = v_company and mu.id = p_unit_id
          and mu.material_id = v_new_mat and mu.deleted_at is null) then
    raise exception 'Birlik shu materialga tegishli emas'
      using errcode = '22023', hint = 'correct_invalid';
  end if;

  perform set_config('terron.correct_mode', case when v_own then 'author' else 'admin' end, true);
  perform set_config('terron.correct_reason', coalesce(v_reason, ''), true);

  if p_table = 'movements' then
    update public.movements m
       set qty_input   = coalesce(p_qty_input, m.qty_input),
           unit_id     = coalesce(p_unit_id, m.unit_id),
           material_id = v_new_mat,
           object_id   = v_new_obj,
           note        = case when p_note is null then m.note else v_note end
     where m.id = p_id;
    if v_m.purchase_id is not null then
      perform private.evaluate_purchase_receipt(v_m.purchase_id);
      perform private.reevaluate_receipt_chain(v_company, v_object, v_mat, v_m.occurred_at - interval '72 hours');
    end if;
  elsif p_table = 'expenses' then
    update public.expenses e
       set amount    = coalesce(round(p_total_amount, 2), e.amount),
           object_id = v_new_obj,
           note      = case when p_note is null then e.note else v_note end
     where e.id = p_id;
  else
    update public.purchases p
       set qty_input    = coalesce(p_qty_input, p.qty_input),
           unit_id      = coalesce(p_unit_id, p.unit_id),
           material_id  = v_new_mat,
           object_id    = v_new_obj,
           total_amount = coalesce(p_total_amount, p.total_amount),
           note         = case when p_note is null then p.note else v_note end
     where p.id = p_id;
  end if;

  perform private.reevaluate_duplicate(p_table, p_id);

  perform set_config('terron.correct_mode', '', true);
  perform set_config('terron.correct_reason', '', true);
end;
$$;

-- cancel_own_entry: expenses (muallif, 30 daqiqa; rol — xarajat kiritadiganlar).
create or replace function public.cancel_own_entry(p_table text, p_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.my_profile_id();
  v_m       public.movements%rowtype;
  v_p       public.purchases%rowtype;
  v_e       public.expenses%rowtype;
  v_company uuid;
  v_author  uuid;
  v_created timestamptz;
  v_object  uuid;
  v_reason  text := nullif(btrim(p_reason), '');
begin
  if v_me is null then
    raise exception 'Tizimga kirilmagan' using errcode = '42501', hint = 'auth_required';
  end if;
  if p_table is null or p_table not in ('movements', 'purchases', 'expenses') or p_id is null
     or v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Bekor qilish ma''lumotlari noto''g''ri (sabab majburiy)'
      using errcode = '22023', hint = 'correct_invalid';
  end if;

  if p_table = 'movements' then
    select m.* into v_m from public.movements m where m.id = p_id and m.deleted_at is null for update;
    if not found or not private.can_access_company(v_m.company_id) then
      raise exception 'Yozuv topilmadi' using errcode = 'P0002', hint = 'correct_not_found';
    end if;
    v_company := v_m.company_id; v_author := v_m.created_by; v_created := v_m.created_at; v_object := v_m.object_id;
  elsif p_table = 'purchases' then
    select p.* into v_p from public.purchases p where p.id = p_id and p.deleted_at is null for update;
    if not found or not private.can_access_company(v_p.company_id) then
      raise exception 'Yozuv topilmadi' using errcode = 'P0002', hint = 'correct_not_found';
    end if;
    v_company := v_p.company_id; v_author := v_p.created_by; v_created := v_p.created_at; v_object := v_p.object_id;
  else
    select e.* into v_e from public.expenses e where e.id = p_id and e.deleted_at is null for update;
    if not found or not private.can_access_company(v_e.company_id) then
      raise exception 'Yozuv topilmadi' using errcode = 'P0002', hint = 'correct_not_found';
    end if;
    v_company := v_e.company_id; v_author := v_e.created_by; v_created := v_e.created_at; v_object := v_e.object_id;
  end if;

  if v_author is distinct from v_me then
    raise exception 'Faqat o''zingiz kiritgan yozuvni bekor qilish mumkin'
      using errcode = '42501', hint = 'correct_forbidden';
  end if;
  if v_created < now() - interval '30 minutes' then
    raise exception 'Bekor qilish muddati (30 daqiqa) o''tgan — administratorga murojaat qiling'
      using errcode = '55000', hint = 'correct_window_passed';
  end if;
  if not private.has_role('super_admin', 'admin')
     and ((p_table = 'movements' and not (private.has_role('prorab', 'omborchi') and private.can_access_object(v_object)))
          or (p_table = 'purchases' and not (private.has_role('taminotchi')
                                            or (private.has_role('prorab', 'haydovchi') and private.can_access_object(v_object))))
          or (p_table = 'expenses' and not (private.has_role('taminotchi', 'buxgalter')
                                           or (private.has_role('prorab', 'haydovchi')
                                               and (v_object is null or private.can_access_object(v_object)))))) then
    raise exception 'Bu yozuvni bekor qilishga ruxsat yo''q'
      using errcode = '42501', hint = 'correct_forbidden';
  end if;

  if p_table = 'movements' then
    if v_m.type not in ('kirim', 'chiqim') or v_m.transfer_id is not null or v_m.inventory_count_id is not null then
      raise exception 'Bog''langan yozuvni bekor qilib bo''lmaydi (o''tkazma yoki inventarizatsiya)'
        using errcode = '55000', hint = 'correct_linked';
    end if;
  elsif p_table = 'purchases' and exists (select 1 from public.movements m
                 where m.company_id = v_company and m.purchase_id = p_id
                   and m.type = 'kirim' and m.deleted_at is null) then
    raise exception 'Kirimga bog''langan xaridni bekor qilib bo''lmaydi'
      using errcode = '55000', hint = 'correct_linked';
  end if;

  perform set_config('terron.correct_mode', 'cancel', true);
  perform set_config('terron.correct_reason', v_reason, true);
  if p_table = 'movements' then
    update public.movements set deleted_at = now() where id = p_id;
  elsif p_table = 'purchases' then
    update public.purchases set deleted_at = now() where id = p_id;
  else
    update public.expenses set deleted_at = now() where id = p_id;
  end if;
  perform set_config('terron.correct_mode', '', true);
  perform set_config('terron.correct_reason', '', true);
end;
$$;

-- ============================================================================
-- 9. Tarix va tiklash — expense_categories, expenses
-- ============================================================================
create or replace function private.history_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'profiles', 'objects', 'object_members',
    'materials', 'material_units', 'material_aliases', 'suppliers',
    'cash_advances', 'purchases', 'movements', 'material_requests',
    'inventory_counts', 'inventory_count_items',
    'estimates', 'estimate_items', 'estimate_import_templates',
    'expense_categories', 'expenses'
  ]::text[]
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
    when 'expense_categories' then d ->> 'name'
    when 'expenses' then
      concat_ws(' · ',
                (select c.name from public.expense_categories c
                  where c.company_id = v_co and c.id = (d ->> 'category_id')::uuid),
                private.history_money((d ->> 'amount')::numeric) || ' so''m',
                coalesce(v_obj, case when d ->> 'object_id' is null then 'Umumiy' end))
    when 'alerts' then
      concat_ws(' · ', d ->> 'type', v_obj, v_mat)
    else null
  end;
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
   order by d.deleted_at desc, d.table_name, d.record_id
   limit p_limit offset p_offset;
end;
$$;

-- ============================================================================
-- 10. Rasm xeshi (photo-hash navbati) — expenses
-- ============================================================================
alter table private.photo_hash_queue drop constraint photo_hash_queue_table_name_check;
alter table private.photo_hash_queue
  add constraint photo_hash_queue_table_name_check check (table_name in ('movements', 'purchases', 'expenses'));

create or replace function public.svc_set_photo_hash(
  p_table         text,
  p_id            uuid,
  p_sha256        text,
  p_expected_path text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sha  text := nullif(lower(btrim(p_sha256)), '');
  v_path text;
  v_ok   boolean;
begin
  if p_table is null or p_table not in ('movements', 'purchases', 'expenses') or p_id is null then
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
       and (p_expected_path is null or m.photo_path = p_expected_path)
       and m.photo_sha256 is distinct from v_sha;
    select m.photo_path, (m.photo_sha256 is not distinct from v_sha) into v_path, v_ok
      from public.movements m
     where m.id = p_id and m.deleted_at is null and m.photo_path is not null
       and (p_expected_path is null or m.photo_path = p_expected_path);
  elsif p_table = 'expenses' then
    update public.expenses e
       set receipt_photo_sha256 = v_sha
     where e.id = p_id and e.deleted_at is null and e.receipt_photo_path is not null
       and (p_expected_path is null or e.receipt_photo_path = p_expected_path)
       and e.receipt_photo_sha256 is distinct from v_sha;
    select e.receipt_photo_path, (e.receipt_photo_sha256 is not distinct from v_sha) into v_path, v_ok
      from public.expenses e
     where e.id = p_id and e.deleted_at is null and e.receipt_photo_path is not null
       and (p_expected_path is null or e.receipt_photo_path = p_expected_path);
  else
    update public.purchases p
       set receipt_photo_sha256 = v_sha
     where p.id = p_id and p.deleted_at is null and p.receipt_photo_path is not null
       and (p_expected_path is null or p.receipt_photo_path = p_expected_path)
       and p.receipt_photo_sha256 is distinct from v_sha;
    select p.receipt_photo_path, (p.receipt_photo_sha256 is not distinct from v_sha) into v_path, v_ok
      from public.purchases p
     where p.id = p_id and p.deleted_at is null and p.receipt_photo_path is not null
       and (p_expected_path is null or p.receipt_photo_path = p_expected_path);
  end if;
  v_ok := coalesce(v_ok, false);

  if v_ok and v_sha is not null then
    update private.photo_hash_queue q
       set status = 'done', done_at = now(), updated_at = now()
     where q.table_name = p_table and q.record_id = p_id and q.photo_path = v_path
       and q.status in ('pending', 'sending');
  end if;
  return v_ok;
end;
$$;

create or replace function public.svc_claim_photo_hash_jobs(p_limit integer default 20)
returns table (
  job_id     uuid,
  company_id uuid,
  table_name text,
  record_id  uuid,
  photo_path text,
  attempts   integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update private.photo_hash_queue q
     set status     = case when x.cur_path = q.photo_path and x.has_hash then 'done' else 'stale' end,
         done_at    = now(),
         updated_at = now()
    from (
      select q2.id as qid,
             coalesce(m.photo_path, p.receipt_photo_path, e.receipt_photo_path) as cur_path,
             coalesce(m.photo_sha256, p.receipt_photo_sha256, e.receipt_photo_sha256) is not null as has_hash,
             coalesce(m.deleted_at, p.deleted_at, e.deleted_at) as del,
             (m.id is null and p.id is null and e.id is null) as missing
        from private.photo_hash_queue q2
        left join public.movements m on q2.table_name = 'movements' and m.id = q2.record_id
        left join public.purchases p on q2.table_name = 'purchases' and p.id = q2.record_id
        left join public.expenses e on q2.table_name = 'expenses' and e.id = q2.record_id
       where q2.status in ('pending', 'sending')
    ) x
   where q.id = x.qid
     and (x.missing or x.del is not null or x.cur_path is distinct from q.photo_path or x.has_hash);

  update private.photo_hash_queue q
     set status = 'failed', last_error = coalesce(q.last_error, 'stuck_in_sending'), updated_at = now()
   where q.status = 'sending'
     and q.updated_at < now() - interval '10 minutes'
     and q.attempts >= 6;

  return query
  with c as (
    select q.id as cid
      from private.photo_hash_queue q
     where (q.status = 'pending' and q.next_attempt_at <= now())
        or (q.status = 'sending' and q.updated_at < now() - interval '10 minutes')
     order by q.next_attempt_at, q.created_at, q.id
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
       for update skip locked
  )
  update private.photo_hash_queue q
     set status = 'sending', attempts = q.attempts + 1, updated_at = now()
    from c
   where q.id = c.cid
  returning q.id, q.company_id, q.table_name, q.record_id, q.photo_path, q.attempts;
end;
$$;

-- ============================================================================
-- 11. Storage va pul
-- ============================================================================

-- Rasm yuklash: + buxgalter (xarajat chekini kiritadi). Ko'rish: + expenses.receipt_photo_path
-- (invoker exists — RLS: o'zi to'lagan / kiritgan xarajat cheki). Qolgan shartlar o'zgarmagan.
drop policy photos_insert on storage.objects;
create policy photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select private.my_company_id())::text
    and (
      (
        name ~ '^[0-9a-f-]{36}/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
        and (select private.has_role('super_admin', 'admin', 'prorab', 'omborchi', 'haydovchi', 'taminotchi',
                                     'buxgalter'))
      )
      -- Xatolik skrinshoti: istalgan faol foydalanuvchi (my_company_id() null emas)
      or name ~ '^[0-9a-f-]{36}/bug/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
    )
  );

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
                (select private.is_company_wide())
                or objects.owner_id = (select auth.uid())::text
                or exists (select 1 from public.movements m where m.photo_path = objects.name)
                or exists (select 1 from public.purchases p where p.receipt_photo_path = objects.name)
                or exists (select 1 from public.expenses e where e.receipt_photo_path = objects.name)
            end
      )
    )
  );

-- Qo'limdagi pul: + podotchet xarajatlar "sarflandi" (spent_total, last_spent_at).
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
 where l.profile_id = (select private.my_profile_id())
    or (select private.has_role('super_admin', 'admin', 'direktor', 'buxgalter'))
    or current_user in ('service_role', 'postgres')
 group by l.company_id, l.profile_id;

create or replace function private.cash_position(
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

  select (coalesce((select sum(p.total_amount)
                      from public.purchases p
                     where p.company_id = p_company_id
                       and p.buyer_id = p_profile_id
                       and p.deleted_at is null
                       and p.payment_source = 'podotchet'), 0)
          + coalesce((select sum(e.amount)
                        from public.expenses e
                       where e.company_id = p_company_id
                         and e.payer_id = p_profile_id
                         and e.deleted_at is null
                         and e.payment_source = 'podotchet'), 0))::numeric(18,2)
    into spent_total;

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

create or replace function private.evaluate_cash_advances(p_now timestamptz default now())
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
        select e.company_id, e.payer_id from public.expenses e
         where e.deleted_at is null and e.payment_source = 'podotchet'
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
                        where p.company_id = pr.company_id and p.buyer_id = pr.id and p.deleted_at is null)
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
-- 13. Hisobotlar: dashboard_summary (+ expense_count, expense_sum, expense_by_category,
--     spend_total_sum), kunlik hisobot (+ expenses_count, expenses_sum, expense_limit_alerts),
--     spend_breakdown (drop + create: + category guruhi, xarajat ustunlari).
-- ============================================================================

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
  v_e_count   integer;
  v_e_sum     numeric(18,2);
  v_e_by_cat  jsonb;
begin
  select * into v_period from private.report_period(p_from, p_to);
  -- ko'r-ko'rona sanash: tekshiruvchiga qoldiq / harakat / xarid / pul hisoblanmaydi
  if private.is_blind_counter() then
    return private.dashboard_blind_summary();
  end if;
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

create or replace function private.dashboard_blind_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kirim_count', 0, 'chiqim_count', 0, 'purchases_count', 0, 'purchases_sum', '0.00',
    'expense_count', 0, 'expense_sum', '0.00', 'expense_by_category', '[]'::jsonb, 'spend_total_sum', '0.00',
    'cash_issued_sum', '0.00', 'cash_returned_sum', '0.00', 'cash_on_hand_total', '0.00',
    'cash_outstanding_sum', '0.00', 'cash_owed_to_staff_sum', '0.00',
    'alerts_open', 0, 'alerts_serious_open', 0, 'alerts_new_in_period', 0,
    'unreceived_purchases_count', 0, 'pending_transfers_count', 0, 'pending_requests_count', 0,
    'objects_over_norm_count', 0, 'telegram_blocked_count', null,
    'telegram_me_blocked', coalesce((select p.telegram_blocked_at is not null from public.profiles p
                                      where p.id = private.my_profile_id()), false))
$$;

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
  v_e_count  integer;
  v_e_sum    numeric(18,2);
  v_e_geo    integer;
  v_e_geo_u  integer;
  v_back_e   integer;
  v_limit_al integer;
begin
  select c.name into v_name from public.companies c where c.id = p_company_id;

  select count(*) filter (where m.type = 'kirim'),
         count(*) filter (where m.type = 'chiqim'),
         count(*) filter (where m.type = 'chiqim' and not exists (
           select 1 from public.estimates e
            where e.company_id = m.company_id and e.object_id = m.object_id
              and e.is_current and e.deleted_at is null)
           and not exists (
           select 1 from public.materials mx
            where mx.company_id = m.company_id and mx.id = m.material_id and mx.outside_estimate)),
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

  select count(*), coalesce(sum(e.amount), 0),
         count(*) filter (where e.geo_status = 'denied'),
         count(*) filter (where e.geo_status = 'unavailable')
    into v_e_count, v_e_sum, v_e_geo, v_e_geo_u
    from public.expenses e
   where e.company_id = p_company_id
     and e.deleted_at is null
     and e.spent_at >= v_from and e.spent_at < v_to;
  select count(*) into v_back_e
    from public.expenses e
   where e.company_id = p_company_id
     and e.deleted_at is null
     and e.created_at >= v_from and e.created_at < v_to
     and e.spent_at < v_from;
  select count(*) into v_limit_al
    from public.alerts a
   where a.company_id = p_company_id
     and a.deleted_at is null
     and a.type::text = 'xarajat_limiti'
     and a.created_at >= v_from and a.created_at < v_to;

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
             and p.payment_source = 'podotchet'
          union all
          select e.payer_id, -e.amount
            from public.expenses e
           where e.company_id = p_company_id and e.deleted_at is null
             and e.payment_source = 'podotchet'
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
    'expenses_count',      v_e_count,
    'expenses_sum',        v_e_sum::text,
    'expense_limit_alerts', v_limit_al,
    'requests_count',      v_requests,
    'alerts_new',          v_new,
    'alerts_by_type',      v_by_type,
    'self_received_count', v_self,
    'deleted_count',       v_deleted,
    'restored_count',      v_restored,
    'transfers_pending_count',       v_tr_pend,
    'chiqim_without_estimate_count', v_no_est,
    'low_stock_count',     private.low_stock_count(p_company_id),
    'geo_denied_count',    v_geo_mv + v_geo_p + v_e_geo,
    'geo_unavailable_count', v_geo_mv_u + v_geo_p_u + v_e_geo_u,
    'backdated_count',     v_back_mv + v_back_p + v_back_e,
    'manual_closed_count', v_manual,
    'stuck_pending_count', private.outbox_stuck_count(p_company_id),
    'failed_7d_count',     private.outbox_failed_7d_count(p_company_id),
    'cash_outstanding_sum',   v_pos::text,
    'cash_owed_to_staff_sum', v_neg::text
  );
end;
$$;

-- spend_breakdown: qaytarish turi o'zgardi (drop + create). purchases_* — avvalgidek (faqat xaridlar);
-- expenses_* — xarajatlar; total_sum — ikkalasi. Guruhlar: material (faqat xaridlar), object
-- (xarajat obyektsiz — key null "Umumiy"), buyer (xaridor / to'lovchi), supplier, category (faqat xarajatlar).
drop function public.spend_breakdown(date, date, uuid, text);
create function public.spend_breakdown(
  p_from      date,
  p_to        date,
  p_object_id uuid default null,
  p_group     text default 'material'
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
revoke execute on function public.spend_breakdown(date, date, uuid, text) from public, anon;
grant execute on function public.spend_breakdown(date, date, uuid, text) to authenticated;

-- ============================================================================
-- 12. "Smetaga kirmaydi" materiallar: qoida 4, 6 va smetasiz_chiqim ularni hisobga olmaydi
-- ============================================================================
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

  -- Smetaga kirmaydigan material: norma ogohlantirishi yo'q, ochig'i yopiladi
  if exists (select 1 from public.materials mx
              where mx.company_id = p_company_id and mx.id = p_material_id and mx.outside_estimate) then
    update public.alerts a
       set status  = 'yopildi',
           details = a.details || jsonb_build_object(
             'auto_closed', true, 'closed_reason', 'outside_estimate',
             'closed_by_actor', private.my_profile_id())
     where a.company_id = p_company_id
       and a.object_id = p_object_id
       and a.material_id = p_material_id
       and a.type = 'normadan_oshish'
       and a.status in ('yangi', 'korildi')
       and a.deleted_at is null;
    return;
  end if;

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

  -- Smetaga kirmaydigan material: qoida 6 ishlamaydi
  if exists (select 1 from public.materials mx
              where mx.company_id = v_r.company_id and mx.id = v_r.material_id and mx.outside_estimate) then
    update public.alerts a
       set status  = 'yopildi',
           details = a.details || jsonb_build_object(
             'auto_closed', true, 'closed_reason', 'outside_estimate',
             'closed_by_actor', private.my_profile_id())
     where a.company_id = v_r.company_id
       and a.request_id = v_r.id
       and a.type = 'smetadan_ortiq_sorov'
       and a.status in ('yangi', 'korildi')
       and a.deleted_at is null;
    return;
  end if;

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

create or replace function private.evaluate_no_estimate_chiqim(
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
       and m.company_id = p_company_id and m.object_id = p_object_id
       and not exists (select 1 from public.materials mx
                      where mx.company_id = m.company_id and mx.id = m.material_id and mx.outside_estimate);
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
     and m.occurred_at >= v_from
     and not exists (select 1 from public.materials mx
                      where mx.company_id = m.company_id and mx.id = m.material_id and mx.outside_estimate);

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
         and not exists (select 1 from public.materials mx
                      where mx.company_id = m.company_id and mx.id = m.material_id and mx.outside_estimate)
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

-- norm_overview: + outside_estimate (drop + create — qaytarish turi o'zgardi). "Smetaga kirmaydi"
-- materiallarning sarfi ko'rinadi, ogohlantirish yo'q.
drop function public.norm_overview(uuid);
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
   where nu.company_id = private.my_company_id()
     and (p_object_id is null or nu.object_id = p_object_id)
   order by o.name, nu.object_id, mt.name, nu.material_id
$$;
revoke execute on function public.norm_overview(uuid) from public, anon;
grant execute on function public.norm_overview(uuid) to authenticated;

-- Belgi o'zgarsa: shu materialning norma alertlari va ochiq so'rovlari qayta baholanadi
-- (true → outside_estimate bilan yopiladi; false → oddiy qoidalar).
create function private.tg_materials_outside_estimate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obj uuid;
begin
  for v_obj in
    select distinct x.o
      from (
        select a.object_id as o
          from public.alerts a
         where a.company_id = new.company_id and a.material_id = new.id
           and a.type in ('normadan_oshish', 'smetadan_ortiq_sorov')
           and a.status in ('yangi', 'korildi') and a.deleted_at is null and a.object_id is not null
        union
        select m.object_id
          from public.movements m
         where m.company_id = new.company_id and m.material_id = new.id
           and m.type = 'chiqim' and m.deleted_at is null
        union
        select r.object_id
          from public.material_requests r
         where r.company_id = new.company_id and r.material_id = new.id
           and r.status in ('kutilmoqda', 'tasdiqlandi') and r.deleted_at is null
      ) x
     order by 1
  loop
    perform private.evaluate_norm(new.company_id, v_obj, new.id);
    perform private.reevaluate_open_requests(new.company_id, v_obj, new.id, null);
  end loop;
  return null;
end;
$$;
revoke execute on function private.tg_materials_outside_estimate() from public, anon;
create trigger zz_outside_estimate after update of outside_estimate on public.materials
  for each row when (old.outside_estimate is distinct from new.outside_estimate)
  execute function private.tg_materials_outside_estimate();

-- ============================================================================
-- 14. Sotuvchilar: STIR qayta baholash va birlashtirish — xarajatlar ham
-- ============================================================================

create or replace function private.tg_suppliers_tin_reeval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select p.id from public.purchases p
     where p.company_id = new.company_id
       and p.supplier_id = new.id
       and p.seller_tin is not null
     order by p.id
  loop
    perform private.evaluate_seller_tin(v_id);
  end loop;
  for v_id in
    select e.id from public.expenses e
     where e.company_id = new.company_id
       and e.supplier_id = new.id
       and e.seller_tin is not null
     order by e.id
  loop
    perform private.evaluate_expense_seller_tin(v_id);
  end loop;
  return null;
end;
$$;

-- merge_suppliers: xarajatlar ham ko'chiriladi (details.moved_expense_count — faqat > 0 bo'lsa).
create or replace function public.merge_suppliers(p_keep uuid, p_merge uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.my_profile_id();
  v_keep   public.suppliers%rowtype;
  v_merge  public.suppliers%rowtype;
  v_live   uuid[];
  v_dead   uuid[];
  v_filled text[] := '{}';
  v_exp    integer;
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

  update public.suppliers set deleted_at = now(), merged_into = p_keep where id = p_merge;

  if v_keep.tin is null and v_merge.tin is not null then v_filled := array_append(v_filled, 'tin'); end if;
  if v_keep.phone is null and v_merge.phone is not null then v_filled := array_append(v_filled, 'phone'); end if;
  if v_keep.note is null and v_merge.note is not null then v_filled := array_append(v_filled, 'note'); end if;
  if cardinality(v_filled) > 0 then
    update public.suppliers
       set tin   = coalesce(tin, v_merge.tin),
           phone = coalesce(phone, v_merge.phone),
           note  = coalesce(note, v_merge.note)
     where id = p_keep;
  end if;

  select coalesce(array_agg(p.id order by p.id) filter (where p.deleted_at is null), '{}'),
         coalesce(array_agg(p.id order by p.id) filter (where p.deleted_at is not null), '{}')
    into v_live, v_dead
    from public.purchases p
   where p.company_id = v_keep.company_id
     and p.supplier_id = p_merge;

  update public.purchases p
     set supplier_id = p_keep
   where p.company_id = v_keep.company_id
     and p.supplier_id = p_merge;

  update public.expenses e
     set supplier_id = p_keep
   where e.company_id = v_keep.company_id
     and e.supplier_id = p_merge;
  get diagnostics v_exp = row_count;

  insert into public.alerts (company_id, type, severity, details)
  values (v_keep.company_id, 'sotuvchi_birlashtirildi'::public.alert_type, 'belgi',
          jsonb_build_object(
            'keep_supplier_id',    v_keep.id,
            'keep_name',           v_keep.name,
            'merged_supplier_id',  v_merge.id,
            'merged_name',         v_merge.name,
            'moved_count',         cardinality(v_live),
            'moved_deleted_count', cardinality(v_dead),
            'moved_purchase_ids',  to_jsonb(v_live || v_dead),
            'filled',              to_jsonb(v_filled),
            'actor_profile_id',    v_me,
            'actor_name',          (select p.full_name from public.profiles p where p.id = v_me))
          || case when v_exp > 0 then jsonb_build_object('moved_expense_count', v_exp) else '{}'::jsonb end);

  perform set_config('terron.merge_rpc', 'off', true);
  return cardinality(v_live);
end;
$$;

-- ============================================================================
-- 15. Bildirishnomalar
--   expense_on_your_name — admin boshqa odam nomidan xarajat kiritdi (profile_id = to'lovchi,
--   ref_id = xarajat; (xarajat, to'lovchi) bo'yicha bir marta; notify_workflow ga qaramaydi,
--   tinch oynada ushlanmaydi — purchase_on_your_name kabi).
--   bug_report — endi FAQAT faol super_admin'lar (istalgan firma), firma adminlari emas.
-- ============================================================================
alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox drop constraint notification_outbox_kind_ref_check;
alter table public.notification_outbox
  add constraint notification_outbox_kind_check
    check (kind in ('alert', 'daily_report', 'alert_reminder', 'request_overdue', 'cash_statement', 'bug_report',
                    'request_created', 'request_decided', 'request_approved', 'transfer_sent',
                    'purchase_for_object', 'login_changed',
                    'transfer_cancelled', 'transfer_received', 'purchase_deleted',
                    'purchase_on_your_name', 'inventory_applied', 'alerts_digest',
                    'expense_on_your_name')),
  add constraint notification_outbox_kind_ref_check check (
    (kind in ('alert', 'alert_reminder') and alert_id is not null and report_date is null and profile_id is null
       and ref_id is null)
    or (kind in ('daily_report', 'request_overdue') and report_date is not null and alert_id is null
       and profile_id is null and ref_id is null)
    or (kind = 'cash_statement' and report_date is not null and alert_id is null and profile_id is not null
       and ref_id is null)
    or (kind in ('bug_report', 'alerts_digest') and alert_id is null and report_date is null and profile_id is null
       and ref_id is null)
    or (kind in ('request_created', 'request_approved', 'transfer_sent', 'purchase_for_object',
                 'transfer_cancelled', 'purchase_deleted')
       and alert_id is null and report_date is null and profile_id is null and ref_id is not null)
    or (kind in ('request_decided', 'login_changed', 'transfer_received', 'purchase_on_your_name', 'inventory_applied',
                 'expense_on_your_name')
       and alert_id is null and report_date is null and profile_id is not null and ref_id is not null)
  );

create unique index notification_outbox_expense_payer_key
  on public.notification_outbox (kind, ref_id, profile_id)
  where kind = 'expense_on_your_name';

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
    -- payload biz yozgan — uuid formati kafolatlangan
    select case
             when o.kind in ('transfer_sent', 'transfer_cancelled') then (o.payload ->> 'to_object_id')::uuid
             when o.kind in ('purchase_for_object', 'purchase_deleted', 'request_approved')
               then (o.payload ->> 'object_id')::uuid
           end as object_id,
           case
             when o.kind in ('purchase_for_object', 'purchase_deleted') then (o.payload ->> 'buyer_id')::uuid
             when o.kind = 'transfer_cancelled' then (o.payload ->> 'cancelled_by_id')::uuid
           end as exclude_id
      from o
     where o.kind in ('transfer_sent', 'transfer_cancelled', 'purchase_for_object', 'purchase_deleted',
                      'request_approved')
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
                         'purchase_for_object', 'transfer_cancelled', 'transfer_received',
                         'purchase_deleted', 'inventory_applied')
          or p.notify_workflow)
     and case
           when o.kind in ('cash_statement', 'login_changed', 'request_decided', 'transfer_received',
                           'purchase_on_your_name', 'expense_on_your_name', 'inventory_applied')
             then p.id = o.profile_id
           when o.kind = 'request_overdue' then p.company_id = o.company_id and p.role in ('taminotchi', 'admin')
           when o.kind = 'bug_report'      then p.role = 'super_admin'
           when o.kind = 'request_created' then p.company_id = o.company_id and p.role = 'admin'
           when o.kind = 'request_approved'
             then p.company_id = o.company_id
                  and (p.role = 'taminotchi'
                       or (p.role = 'haydovchi'
                           and exists (select 1 from wf
                                         join public.object_members om on om.object_id = wf.object_id
                                        where om.profile_id = p.id and om.deleted_at is null)))
           when o.kind in ('transfer_sent', 'transfer_cancelled', 'purchase_for_object', 'purchase_deleted')
             then p.company_id = o.company_id
                  and p.role in ('prorab', 'omborchi')
                  and exists (select 1 from wf
                                join public.object_members om on om.object_id = wf.object_id
                               where om.profile_id = p.id and om.deleted_at is null
                                 and p.id is distinct from wf.exclude_id)
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

-- ============================================================================
-- 16. Mini App: ko'p ishlatilgan xarajat turlari (tugmalar tartibi)
-- ============================================================================
create function public.my_expense_category_usage(p_days integer default 30)
returns table (category_id uuid, use_count bigint, last_used_at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_me    uuid := private.my_profile_id();
  v_since timestamptz;
begin
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Kunlar soni 1 dan 365 gacha bo''lishi kerak'
      using errcode = '22023', hint = 'ops_usage_days_range';
  end if;
  if v_me is null or private.is_blind_counter() then
    return;
  end if;
  v_since := now() - make_interval(days => p_days);

  return query
    select e.category_id, count(*)::bigint, max(e.created_at)
      from public.expenses e
     where e.created_by = v_me
       and e.deleted_at is null
       and e.created_at >= v_since
     group by e.category_id
     order by 2 desc, 3 desc, 1;
end;
$$;
revoke execute on function public.my_expense_category_usage(integer) from public, anon;
grant execute on function public.my_expense_category_usage(integer) to authenticated;
