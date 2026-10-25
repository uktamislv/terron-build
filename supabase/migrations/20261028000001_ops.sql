-- ============================================================================
-- Batch 4 · 01 — kirim, chiqim, qoldiq (shartnoma: docs/ops-design.md)
--
--  1. Storage: `photos` bucket (private, 5 MB, jpeg/png/webp) va storage.objects
--     siyosatlari (photos_insert, photos_select). UPDATE/DELETE siyosati yo'q.
--  2. movements.photo_path / purchases.receipt_photo_path — format va firma papkasi
--     (b_photo_path trigger).
--  3. Operatsiya sanasi (movements.occurred_at, purchases.purchased_at,
--     inventory_counts.counted_at): null → now(); admin/super_admin bo'lmagan
--     foydalanuvchi uchun [now() − 3 kun, now() + 5 daqiqa] (b_op_date trigger).
--  4. public.my_material_usage(p_days) — Mini App'da materiallarni tartiblash uchun.
--  5. Muallif o'z o'chirilgan movements/purchases qatorlarini ko'radi (Mening yozuvlarim).
--  Rasm: faqat o'zi yuklagan (24 soat ichida) rasm biriktiriladi, bitta rasm — bitta yozuv.
--
-- Oldingi migratsiyalar o'zgartirilmaydi. Xato shakli: errcode + barqaror `hint` +
-- o'zbekcha `message` (docs/db-design.md → "Xato kalitlari").
-- ============================================================================

-- ============================================================================
-- 1. Storage
-- ============================================================================

-- Bucket: private (signed URL orqali ko'rsatiladi), 5 MB, faqat rasm.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Rasm yo'li bo'yicha qidiruv (photos_select) va bitta yo'l — bitta tirik yozuv.
create index movements_photo_path_idx on public.movements (photo_path) where photo_path is not null;
create index purchases_receipt_photo_path_idx on public.purchases (receipt_photo_path) where receipt_photo_path is not null;
create unique index movements_photo_path_key on public.movements (photo_path)
  where photo_path is not null and deleted_at is null;
create unique index purchases_receipt_photo_path_key on public.purchases (receipt_photo_path)
  where receipt_photo_path is not null and deleted_at is null;

-- Yo'l: {company_id}/{yyyy}/{mm}/{uuid}.{ext}. Birinchi papka — foydalanuvchi firmasi.
-- INSERT: rasm kiritadigan rollar (kirim/chiqim — prorab, omborchi; xarid — haydovchi,
-- taminotchi, prorab; admin, super_admin), faqat o'z firmasi papkasiga va to'g'ri formatda.
-- Format sharti b_photo_path trigger bilan bir xil (bazaga yozilmaydigan yo'l yuklanmasin).
create policy photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select private.my_company_id())::text
    and name ~ '^[0-9a-f-]{36}/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
    and (select private.has_role('super_admin', 'admin', 'prorab', 'omborchi', 'haydovchi', 'taminotchi'))
  );

-- SELECT (signed URL yaratish ham shu siyosatga tayanadi), faqat o'z firma papkasi:
--   * firma bo'yicha rollar (is_company_wide) — firmaning barcha rasmlari;
--   * qolganlar (prorab, omborchi, haydovchi) — o'zi yuklagan (owner_id) yoki o'zi
--     ko'ra oladigan yozuvga biriktirilgan rasm (movements/purchases RLS'i amal qiladi);
--   * super_admin — hammasi.
-- Faol bo'lmagan / o'chirilgan firma yoki profil — my_company_id() null → hech narsa.
create policy photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (
      (select private.is_super_admin())
      or (
        (storage.foldername(objects.name))[1] = (select private.my_company_id())::text
        and (
          (select private.is_company_wide())
          or objects.owner_id = (select auth.uid())::text
          or exists (select 1 from public.movements m where m.photo_path = objects.name)
          or exists (select 1 from public.purchases p where p.receipt_photo_path = objects.name)
        )
      )
    )
  );

-- UPDATE / DELETE siyosatlari ataylab yo'q: rasm o'zgarmaydi va o'chirilmaydi
-- (yozuv soft delete qilinsa ham rasm tarix uchun qoladi). Natija: klient `upsert: true`
-- bilan yuklay olmaydi (INSERT ... ON CONFLICT DO UPDATE UPDATE siyosatini talab qiladi).

-- ============================================================================
-- 2. Rasm yo'li. tg_argv[0] — ustun nomi (photo_path / receipt_photo_path).
--    Bo'sh satr ('' yoki faqat probel) → null.
--    INSERT yoki yo'l o'zgarganda (eski qatorlar qayta tekshirilmaydi):
--      a) format (ops_photo_path_format) va firma papkasi (ops_photo_path_company) —
--         hamma uchun (service_role ham);
--      b) foydalanuvchi sessiyasida (auth.uid() bor) admin/super_admin bo'lmasa:
--         rasm storage.objects da bor, o'zi yuklagan (owner_id) va 24 soatdan yangi
--         (ops_photo_not_owned). service_role — cheklovsiz.
--    INSERT, yo'l o'zgarishi yoki tiklashda (deleted_at → null): bitta yo'l — faqat bitta
--    tirik (o'chirilmagan) yozuvda, movements va purchases bo'ylab (ops_photo_reused).
--    Har jadvalda partial unique indeks — zaxira; jadvallar aro poyga — advisory lock.
--    security definer: storage.objects va ikkinchi jadvalni RLS'siz o'qiydi.
-- ============================================================================
create function private.tg_ops_photo_path()
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
                     and (tg_table_name <> 'purchases' or p.id <> new.id)) then
      raise exception 'Bu rasm boshqa yozuvga biriktirilgan — yangi rasm yuklang'
        using errcode = '23505', hint = 'ops_photo_reused';
    end if;
  end if;
  return new;
end;
$$;

create trigger b_photo_path before insert or update on public.movements
  for each row execute function private.tg_ops_photo_path('photo_path');
create trigger b_photo_path before insert or update on public.purchases
  for each row execute function private.tg_ops_photo_path('receipt_photo_path');

-- ============================================================================
-- 3. Operatsiya sanasi. tg_argv[0] — ustun nomi.
--    INSERT: null → now(). UPDATE: null → eski qiymat (ustun NOT NULL).
--    Foydalanuvchi sessiyasida (auth.uid() bor) va admin/super_admin bo'lmasa:
--    INSERT yoki sana o'zgarganda qiymat [now() − 3 kun, now() + 5 daqiqa] ichida
--    bo'lishi shart (chegaralar kiradi). service_role / cron / migratsiya — cheklovsiz.
--    now() — tranzaksiya boshlangan vaqt (domain `occurredAtAllowed` bilan bir xil qoida).
-- ============================================================================
create function private.tg_ops_op_date()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_col constant text := tg_argv[0];
  v_ts  timestamptz := (to_jsonb(new) ->> v_col)::timestamptz;
  v_old timestamptz;
begin
  if tg_op = 'UPDATE' then
    v_old := (to_jsonb(old) ->> v_col)::timestamptz;
  end if;

  if v_ts is null then
    v_ts := case when tg_op = 'UPDATE' then v_old else now() end;
    new := jsonb_populate_record(new, jsonb_build_object(v_col, v_ts));
  end if;

  if tg_op = 'UPDATE' and v_ts is not distinct from v_old then
    return new;
  end if;

  if auth.uid() is not null
     and not private.has_role('super_admin', 'admin')
     and (v_ts < now() - interval '3 days' or v_ts > now() + interval '5 minutes') then
    raise exception 'Sana ruxsat etilgan oraliqdan tashqarida: 3 kundan eski yoki kelajakdagi sanani faqat administrator kirita oladi'
      using errcode = '23514', hint = 'ops_occurred_at_range';
  end if;
  return new;
end;
$$;

create trigger b_op_date before insert or update on public.movements
  for each row execute function private.tg_ops_op_date('occurred_at');
create trigger b_op_date before insert or update on public.purchases
  for each row execute function private.tg_ops_op_date('purchased_at');
create trigger b_op_date before insert or update on public.inventory_counts
  for each row execute function private.tg_ops_op_date('counted_at');

revoke execute on function
  private.tg_ops_photo_path(),
  private.tg_ops_op_date()
from public, anon, authenticated;

-- ============================================================================
-- 4. Material ishlatilishi (joriy foydalanuvchi): oxirgi p_days kunda o'zi kiritgan
--    (created_by = my_profile_id) o'chirilmagan harakat va xaridlar, material bo'yicha.
--    Vaqt — created_at (foydalanuvchi qachon kiritgani). security invoker — RLS amal
--    qiladi (masalan obyektdan chiqarilgan prorab o'sha obyekt yozuvlarini ko'rmaydi).
--    Tartib: use_count desc, last_used_at desc, material_id.
-- ============================================================================
create function public.my_material_usage(p_days integer default 30)
returns table (material_id uuid, use_count bigint, last_used_at timestamptz)
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
  if v_me is null then
    return;
  end if;
  v_since := now() - make_interval(days => p_days);

  return query
    select u.material_id, count(*)::bigint, max(u.ts)
      from (
        select m.material_id, m.created_at as ts
          from public.movements m
         where m.created_by = v_me
           and m.deleted_at is null
           and m.created_at >= v_since
        union all
        select p.material_id, p.created_at
          from public.purchases p
         where p.created_by = v_me
           and p.deleted_at is null
           and p.created_at >= v_since
      ) u
     group by u.material_id
     order by 2 desc, 3 desc, 1;
end;
$$;

revoke execute on function public.my_material_usage(integer) from public, anon;
grant execute on function public.my_material_usage(integer) to authenticated;

create index movements_created_by_time_idx on public.movements (created_by, created_at desc)
  where deleted_at is null;
create index purchases_created_by_time_idx on public.purchases (created_by, created_at desc)
  where deleted_at is null;

-- ============================================================================
-- 5. "Mening yozuvlarim": muallif o'zining O'CHIRILGAN harakat va xaridlarini ko'radi
--    ("o'chirilgan" belgisi uchun). Qo'shimcha (permissive) SELECT siyosati — mavjud
--    siyosatlar bilan OR. Faqat deleted_at is not null: tirik qatorlarni kengaytirmaydi
--    (aks holda obyektdan chiqarilgan prorab stock_balances da o'sha obyektning qisman
--    "qoldig'ini" ko'rardi). Boshqa firma va boshqa odam yozuvlari ochilmaydi.
-- ============================================================================
create policy movements_select_own_deleted on public.movements
  for select to authenticated
  using (
    deleted_at is not null
    and created_by = (select private.my_profile_id())
    and company_id = (select private.my_company_id())
  );

create policy purchases_select_own_deleted on public.purchases
  for select to authenticated
  using (
    deleted_at is not null
    and created_by = (select private.my_profile_id())
    and company_id = (select private.my_company_id())
  );
