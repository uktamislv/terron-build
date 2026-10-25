-- ============================================================================
-- Batch 2 · 01 — kirish (auth) yordamchilari:
--   1. profiles.login_kind ('none' | 'tg' | 'web') — faqat service_role yozadi
--   2. telefon o'zgarsa / auth user o'chsa → login_kind = 'none'
--   3. audit_log.action ga auth hodisalari: SET_LOGIN, TG_LINK, TG_AUTH_USER_CREATED
--   4. private.log_auth_event(...)       — auth hodisasini audit_log ga yozadi
--   5. private.auth_user_id_by_email(..) — email bo'yicha auth user id
--   6. public.svc_* — yuqoridagi ikkisining Edge Function (PostgREST rpc) uchun
--      o'ramlari. `private` sxema PostgREST'da ochiq emas, shuning uchun o'ram
--      `public` da, lekin execute FAQAT service_role (anon/authenticated — yo'q).
-- Batch 1 migratsiyalari o'zgartirilmaydi.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profiles.login_kind
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column login_kind text not null default 'none'
    constraint profiles_login_kind_check check (login_kind in ('none', 'tg', 'web'));

-- Mavjud (Batch 1 da qo'lda bog'langan, masalan birinchi admin) akkauntlar — veb login.
update public.profiles set login_kind = 'web' where auth_user_id is not null;

-- Auth akkaunt bo'lmasa login turi ham yo'q.
alter table public.profiles
  add constraint profiles_login_kind_auth_check check (login_kind = 'none' or auth_user_id is not null);

-- authenticated uchun ustun grantlari (Batch 1: insert/update ustun darajasida) o'zgarmaydi —
-- login_kind ularga QO'SHILMAYDI. SELECT jadval darajasida — ustun ko'rinadi.

-- ----------------------------------------------------------------------------
-- 2. Telefon o'zgarsa bog'lanish uziladi (Batch 1) + login_kind = 'none'.
--    auth user o'chirilsa (FK on delete set null) ham shu trigger ishlaydi.
-- ----------------------------------------------------------------------------
create or replace function private.tg_profiles_phone_unlink()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.phone is distinct from old.phone then
    if new.auth_user_id is not distinct from old.auth_user_id then
      new.auth_user_id := null;
    end if;
    if new.telegram_user_id is not distinct from old.telegram_user_id then
      new.telegram_user_id := null;
    end if;
    if new.telegram_chat_id is not distinct from old.telegram_chat_id then
      new.telegram_chat_id := null;
    end if;
  end if;
  -- Auth akkaunt yo'q — login turi ham yo'q (telefon o'zgarishi, auth user o'chirilishi).
  if new.auth_user_id is null then
    new.login_kind := 'none';
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_profiles_phone_unlink() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. audit_log.action — auth hodisalari
-- ----------------------------------------------------------------------------
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('INSERT', 'UPDATE', 'SOFT_DELETE', 'RESTORE',
                    'SET_LOGIN', 'TG_LINK', 'TG_AUTH_USER_CREATED'));

-- ----------------------------------------------------------------------------
-- 4. private.log_auth_event — Edge Function'lar (service_role) auth hodisasini yozadi.
--    table_name = 'auth', record_id = maqsad profil, device = 'tizim'.
--    details dan parolga o'xshash kalitlar olib tashlanadi (himoya qatlami;
--    Edge Function parolni baribir uzatmaydi).
-- ----------------------------------------------------------------------------
create function private.log_auth_event(
  p_company_id        uuid,
  p_actor_profile_id  uuid,
  p_target_profile_id uuid,
  p_action            text,
  p_details           jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_action is null or p_action not in ('SET_LOGIN', 'TG_LINK', 'TG_AUTH_USER_CREATED') then
    raise exception 'log_auth_event: noma''lum action %', p_action using errcode = '22023';
  end if;
  if p_company_id is null or p_target_profile_id is null then
    raise exception 'log_auth_event: company_id va target_profile_id majburiy' using errcode = '22004';
  end if;

  insert into public.audit_log
    (company_id, table_name, record_id, action, old_data, new_data,
     changed_fields, actor_profile_id, actor_auth_uid, device)
  values
    (p_company_id, 'auth', p_target_profile_id, p_action, null,
     coalesce(p_details, '{}'::jsonb) - 'password' - 'new_password' - 'old_password',
     null, p_actor_profile_id, null, 'tizim')
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function private.log_auth_event(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function private.log_auth_event(uuid, uuid, uuid, text, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- 5. private.auth_user_id_by_email — yetim / band auth user'ni topish.
--    (auth.admin.generateLink user yaratib yuborgani, listUsers esa sahifalangani uchun.)
-- ----------------------------------------------------------------------------
create function private.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
   order by u.created_at
   limit 1
$$;

revoke execute on function private.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function private.auth_user_id_by_email(text) to service_role;

-- ----------------------------------------------------------------------------
-- 6. PostgREST (rpc) o'ramlari — faqat service_role.
--    security invoker: chaqiruvchi (service_role) private funksiyani o'z huquqi bilan chaqiradi.
-- ----------------------------------------------------------------------------
create function public.svc_log_auth_event(
  p_company_id        uuid,
  p_actor_profile_id  uuid,
  p_target_profile_id uuid,
  p_action            text,
  p_details           jsonb default '{}'::jsonb
)
returns bigint
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.log_auth_event(p_company_id, p_actor_profile_id, p_target_profile_id, p_action, p_details)
$$;

create function public.svc_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select private.auth_user_id_by_email(p_email)
$$;

revoke execute on function public.svc_log_auth_event(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.svc_auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.svc_log_auth_event(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.svc_auth_user_id_by_email(text) to service_role;
