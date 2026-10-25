// ============================================================================
// SQL test harness — supabase/migrations/*.sql ni PGlite (WASM Postgres) da
// qo'llaydi va Supabase muhitini taqlid qiladi. Docker / lokal Supabase kerak
// emas. Faqat `npm run test:sql` (vitest.sql.config.ts) ishga tushiradi.
//
// DIQQAT: bu SIMULYATSIYA. Taqlid qilinadi: anon/authenticated/service_role
// rollari, auth sxemasi (users, uid(), role(), jwt()), Supabase default
// grantlari, storage sxemasi (minimal), pg_cron/pg_net/Vault (stub). PostgREST,
// GoTrue, haqiqiy Storage va pg_cron ishlamaydi.
// ============================================================================

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SUPABASE_DIR = join(HERE, '..', '..')
export const MIGRATIONS_DIR = join(SUPABASE_DIR, 'migrations')
export const SEED_FILE = join(SUPABASE_DIR, 'seed.sql')

export type Db = PGlite
export type Tx = Transaction
/** `db` ham, `asUser` ichidagi `tx` ham. */
export type Queryable = PGlite | Transaction
export type Row = Record<string, unknown>
export type Device = 'veb' | 'mobil'

// PGlite'da yo'q yoki Supabase'ga xos kengaytmalar: `create extension` jimgina o'tkazib yuboriladi.
// pg_cron va pg_net o'rniga quyida stub sxemalar yaratiladi.
const STUBBED_EXTENSIONS = [
  'pg_cron',
  'pg_net',
  'pg_graphql',
  'pg_stat_statements',
  'supabase_vault',
  'pgsodium',
  'pgjwt',
]

// ----------------------------------------------------------------------------
// Supabase muhiti
// ----------------------------------------------------------------------------

const SUPABASE_BOOTSTRAP_SQL = `
  -- Rollar (Supabase'dagidek: NOLOGIN, service_role RLS'ni chetlab o'tadi)
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  grant anon, authenticated, service_role to postgres;

  -- Kengaytmalar 'extensions' sxemasida (Supabase kabi)
  create schema if not exists extensions;
  grant usage on schema extensions to anon, authenticated, service_role;
  create extension if not exists pgcrypto with schema extensions;

  -- public sxema grantlari va default privileges (Supabase shunday sozlaydi;
  -- migratsiyalar keraksizini o'zi REVOKE qiladi)
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  -- auth sxemasi (GoTrue jadvalining kerakli qismi)
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    instance_id uuid,
    aud varchar(255) default 'authenticated',
    role varchar(255) default 'authenticated',
    email varchar(255),
    phone text,
    encrypted_password varchar(255),
    email_confirmed_at timestamptz,
    phone_confirmed_at timestamptz,
    last_sign_in_at timestamptz,
    raw_app_meta_data jsonb default '{}'::jsonb,
    raw_user_meta_data jsonb default '{}'::jsonb,
    is_super_admin boolean,
    is_anonymous boolean not null default false,
    is_sso_user boolean not null default false,
    banned_until timestamptz,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    deleted_at timestamptz
  );
  create function auth.jwt() returns jsonb language sql stable as $f$
    select coalesce(
      nullif(current_setting('request.jwt.claim', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
  $f$;
  create function auth.uid() returns uuid language sql stable as $f$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $f$;
  create function auth.role() returns text language sql stable as $f$
    select coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    )::text
  $f$;
  create function auth.email() returns text language sql stable as $f$
    select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')::text
  $f$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  grant all on auth.users to service_role;

  -- storage sxemasi (minimal: Batch 4 rasm siyosatlari uchun)
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key,
    name text not null unique,
    owner uuid,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text,
    owner uuid,
    owner_id text,
    metadata jsonb,
    user_metadata jsonb,
    version text,
    path_tokens text[] generated always as (string_to_array(name, '/')) stored,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    last_accessed_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  alter table storage.buckets enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $f$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $f$;
  create function storage.filename(name text) returns text language sql immutable as $f$
    select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
  $f$;
  create function storage.extension(name text) returns text language sql immutable as $f$
    select reverse(split_part(reverse(storage.filename(name)), '.', 1))
  $f$;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
  grant execute on all functions in schema storage to anon, authenticated, service_role;

  -- pg_cron stub (jadvalga yozadi, hech narsani ishga tushirmaydi)
  create schema if not exists cron;
  create table cron.job (
    jobid bigserial primary key,
    schedule text,
    command text,
    nodename text default 'localhost',
    nodeport integer default 5432,
    database text default 'postgres',
    username text default 'postgres',
    active boolean default true,
    jobname text
  );
  create function cron.schedule(job_name text, schedule text, command text) returns bigint
    language plpgsql as $f$
    declare v bigint;
    begin
      delete from cron.job j where j.jobname = job_name;
      insert into cron.job (schedule, command, jobname) values (schedule, command, job_name)
        returning jobid into v;
      return v;
    end $f$;
  create function cron.schedule(schedule text, command text) returns bigint
    language plpgsql as $f$
    declare v bigint;
    begin
      insert into cron.job (schedule, command) values (schedule, command) returning jobid into v;
      return v;
    end $f$;
  create function cron.unschedule(job_name text) returns boolean
    language plpgsql as $f$
    begin delete from cron.job j where j.jobname = job_name; return found; end $f$;
  create function cron.unschedule(job_id bigint) returns boolean
    language plpgsql as $f$
    begin delete from cron.job j where j.jobid = job_id; return found; end $f$;

  -- pg_net stub (so'rovlar jadvalga yoziladi — testda tekshirish mumkin)
  create schema if not exists net;
  create table net.http_request_queue (
    id bigserial primary key,
    method text,
    url text,
    headers jsonb,
    body jsonb,
    timeout_milliseconds integer,
    created_at timestamptz default now()
  );
  create function net.http_post(
    url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
    headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds integer default 5000
  ) returns bigint language plpgsql as $f$
    declare v bigint;
    begin
      insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds)
        values ('POST', url, headers, body, timeout_milliseconds) returning id into v;
      return v;
    end $f$;
  -- Supabase Vault (supabase_vault) minimal taqlidi: shifrlash yo'q, API bir xil —
  -- vault.create_secret(), vault.secrets, vault.decrypted_secrets.
  create schema if not exists vault;
  revoke all on schema vault from public;
  create table vault.secrets (
    id uuid primary key default gen_random_uuid(),
    name text unique,
    description text not null default '',
    secret text not null,
    key_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create view vault.decrypted_secrets as
    select id, name, description, secret, secret as decrypted_secret, key_id, created_at, updated_at
      from vault.secrets;
  create function vault.create_secret(
    new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null
  ) returns uuid language plpgsql as $f$
    declare v uuid;
    begin
      insert into vault.secrets (secret, name, description, key_id)
        values (new_secret, new_name, coalesce(new_description, ''), new_key_id) returning id into v;
      return v;
    end $f$;
  revoke all on all tables in schema vault from public;
  revoke execute on all functions in schema vault from public;

  create function net.http_get(
    url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb,
    timeout_milliseconds integer default 5000
  ) returns bigint language plpgsql as $f$
    declare v bigint;
    begin
      insert into net.http_request_queue (method, url, headers, timeout_milliseconds)
        values ('GET', url, headers, timeout_milliseconds) returning id into v;
      return v;
    end $f$;
`

export interface CreateDbOptions {
  /** Migratsiyalarni qo'llash (standart: true). */
  migrations?: boolean
  /** Faqat nomi shu qiymatdan kichik migratsiyalarni qo'llash (masalan, oldingi holatni sinash). */
  migrationsBefore?: string
  /** `supabase/seed.sql` ni qo'llash, agar mavjud bo'lsa (standart: false). */
  seed?: boolean
}

/** Yangi PGlite baza: Supabase muhiti + migratsiyalar (+ ixtiyoriy seed). */
export async function createDb(opts: CreateDbOptions = {}): Promise<Db> {
  const db = await PGlite.create({
    extensions: { pgcrypto, uuid_ossp, citext, pg_trgm, unaccent },
  })
  await db.exec(SUPABASE_BOOTSTRAP_SQL)
  // Supabase: search_path = "$user", public, extensions; baza vaqti UTC.
  await db.exec(`set search_path to "$user", public, extensions; set timezone to 'UTC';`)

  if (opts.migrations ?? true) {
    await applyMigrations(db, listMigrations(opts.migrationsBefore))
  }
  if (opts.seed) await applySeed(db)
  return db
}

/** `supabase/migrations/*.sql` nom tartibida (papka bo'lmasa — bo'sh ro'yxat). */
export function listMigrations(before?: string): string[] {
  if (!existsSync(MIGRATIONS_DIR)) return []
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && (before === undefined || f < before))
    .sort()
}

function prepareSql(sql: string): string {
  const names = STUBBED_EXTENSIONS.join('|')
  const re = new RegExp(`create\\s+extension\\s+(if\\s+not\\s+exists\\s+)?"?(${names})"?[^;]*;`, 'gi')
  return sql.replace(re, 'select 1;')
}

async function applySqlFile(db: Db, path: string, label: string): Promise<void> {
  const sql = prepareSql(readFileSync(path, 'utf8'))
  try {
    await db.exec(sql)
  } catch (e) {
    throw new Error(`${label} qo'llanmadi: ${errorText(e)}`, { cause: e })
  } finally {
    // Fayl ichidagi `set role` / `begin` qoldiqlari keyingi faylga o'tmasin.
    await db.exec('reset role').catch(() => undefined)
  }
}

/** Berilgan migratsiya fayllarini (`listMigrations()` nomlari) tartib bilan qo'llaydi. */
export async function applyMigrations(db: Db, files: string[]): Promise<void> {
  for (const f of files) await applySqlFile(db, join(MIGRATIONS_DIR, f), `Migratsiya ${f}`)
}

/** `supabase/seed.sql` (bo'lmasa — hech narsa qilmaydi). Qo'llangan bo'lsa true. */
export async function applySeed(db: Db): Promise<boolean> {
  if (!existsSync(SEED_FILE)) return false
  await applySqlFile(db, SEED_FILE, 'seed.sql')
  return true
}

// ----------------------------------------------------------------------------
// Rol bilan bajarish
// ----------------------------------------------------------------------------

export interface AsOptions {
  /** `request.headers` dagi `x-client-device`. `null` — sarlavha yo'q. */
  device?: Device | string | null
  /** true — tranzaksiya commit qilinadi; standart — rollback (test izolyatsiyasi). */
  commit?: boolean
  /** JWT claims'ga qo'shimcha maydonlar (masalan `app_metadata`, `email`). */
  claims?: Row
  /** Qo'shimcha HTTP sarlavhalar (`request.headers`). */
  headers?: Record<string, string>
}

type DbRole = 'anon' | 'authenticated' | 'service_role'

async function runAs<T>(
  db: Db,
  role: DbRole,
  claims: Row,
  defaultDevice: Device | null,
  fn: (tx: Tx) => Promise<T>,
  opts: AsOptions,
): Promise<T> {
  const device = opts.device === undefined ? defaultDevice : opts.device
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (device !== null) headers['x-client-device'] = device
  const allClaims = { ...claims, ...(opts.claims ?? {}) }

  return db.transaction(async (tx) => {
    // Rol nomi whitelist'dan (DbRole) — parametr sifatida berib bo'lmaydi.
    await tx.exec(`set local role ${role}`)
    await tx.query(
      `select set_config('request.jwt.claims', $1, true),
              set_config('request.jwt.claim.sub', $2, true),
              set_config('request.jwt.claim.role', $3, true),
              set_config('request.headers', $4, true),
              set_config('request.method', 'POST', true)`,
      [
        JSON.stringify(allClaims),
        typeof allClaims.sub === 'string' ? allClaims.sub : '',
        role,
        JSON.stringify(headers),
      ],
    )
    const result = await fn(tx)
    if (!opts.commit) await tx.rollback()
    return result
  })
}

/**
 * `authenticated` roli, `auth.uid() = authUid`. Standart: `device = 'veb'`, oxirida rollback.
 * `fn` xato tashlasa — tranzaksiya rollback qilinadi va xato qayta tashlanadi.
 */
export function asUser<T>(db: Db, authUid: string, fn: (tx: Tx) => Promise<T>, opts: AsOptions = {}): Promise<T> {
  return runAs(db, 'authenticated', { sub: authUid, role: 'authenticated', aud: 'authenticated' }, 'veb', fn, opts)
}

/** `anon` roli (kirmagan foydalanuvchi). */
export function asAnon<T>(db: Db, fn: (tx: Tx) => Promise<T>, opts: AsOptions = {}): Promise<T> {
  return runAs(db, 'anon', { role: 'anon' }, 'veb', fn, opts)
}

/** `service_role` (BYPASSRLS; Edge Function / cron). Standart: device sarlavhasi yo'q → audit 'tizim'. */
export function asService<T>(db: Db, fn: (tx: Tx) => Promise<T>, opts: AsOptions = {}): Promise<T> {
  return runAs(db, 'service_role', { role: 'service_role' }, null, fn, opts)
}

// ----------------------------------------------------------------------------
// So'rov yordamchilari
// ----------------------------------------------------------------------------

export interface SqlErr {
  ok: false
  code: string | null
  msg: string
}
export type SqlResult<T = Row> = { ok: true; rows: T[] } | SqlErr

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isTx(q: Queryable): q is Tx {
  return 'rollback' in q && !('close' in q)
}

/**
 * So'rovni bajaradi, xatoni qaytaradi (tashlamaydi). Tranzaksiya ichida SAVEPOINT bilan
 * o'raladi — RLS/constraint xatosidan keyin ham `tx` ishlashda davom etadi.
 */
export async function tryQuery<T = Row>(q: Queryable, sql: string, params?: unknown[]): Promise<SqlResult<T>> {
  const inTx = isTx(q)
  if (inTx) await q.exec('savepoint harness_try')
  try {
    const r = await q.query<T>(sql, params)
    if (inTx) await q.exec('release savepoint harness_try')
    return { ok: true, rows: r.rows }
  } catch (e) {
    if (inTx) await q.exec('rollback to savepoint harness_try')
    const err = e as { code?: string }
    return { ok: false, code: err.code ?? null, msg: errorText(e) }
  }
}

export async function rows<T = Row>(q: Queryable, sql: string, params?: unknown[]): Promise<T[]> {
  return (await q.query<T>(sql, params)).rows
}

/** Bitta qator; bo'lmasa xato. */
export async function one<T = Row>(q: Queryable, sql: string, params?: unknown[]): Promise<T> {
  const r = await rows<T>(q, sql, params)
  const row = r[0]
  if (row === undefined) throw new Error(`So'rov qator qaytarmadi: ${sql.slice(0, 100)}`)
  return row
}

/** Birinchi qatorning birinchi ustuni. */
export async function scalar<T = unknown>(q: Queryable, sql: string, params?: unknown[]): Promise<T> {
  const row = await one(q, sql, params)
  return Object.values(row)[0] as T
}

// ----------------------------------------------------------------------------
// Test ma'lumot yaratuvchilar (superuser sifatida, RLS'siz).
// `extra` — sxemada qo'shimcha majburiy ustunlar bo'lsa.
// ----------------------------------------------------------------------------

let seq = 0
const next = (): number => ++seq

const IDENT = /^[a-z_][a-z0-9_]*$/

/** `insert into <table> (...) values (...) returning *` — superuser sifatida. */
export async function insertRow<T = Row>(db: Db, table: string, values: Row): Promise<T> {
  const parts = table.split('.')
  const cols = Object.keys(values)
  for (const name of [...parts, ...cols]) {
    if (!IDENT.test(name)) throw new Error(`Noto'g'ri identifikator: ${name}`)
  }
  const sql =
    `insert into ${parts.map((p) => `"${p}"`).join('.')} (${cols.map((c) => `"${c}"`).join(', ')}) ` +
    `values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`
  return one<T>(db, sql, Object.values(values))
}

export async function createCompany(db: Db, opts: { name?: string; extra?: Row } = {}): Promise<string> {
  const r = await insertRow<{ id: string }>(db, 'companies', {
    name: opts.name ?? `Test firma ${next()}`,
    ...opts.extra,
  })
  return r.id
}

/** `auth.users` ga qator; id qaytaradi. */
export async function createAuthUser(
  db: Db,
  opts: { id?: string; email?: string; phone?: string } = {},
): Promise<string> {
  const n = next()
  const r = await insertRow<{ id: string }>(db, 'auth.users', {
    ...(opts.id ? { id: opts.id } : {}),
    email: opts.email ?? `user${n}@test.local`,
    phone: opts.phone ?? null,
  })
  return r.id
}

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'direktor'
  | 'buxgalter'
  | 'taminotchi'
  | 'prorab'
  | 'omborchi'
  | 'haydovchi'
  | 'tekshiruvchi'

export interface CreateProfileOptions {
  companyId: string
  role: UserRole
  /** `null` — auth akkauntsiz profil (admin oldindan qo'shgan). */
  authUserId?: string | null
  fullName?: string
  phone?: string
  extra?: Row
}

export async function createProfile(db: Db, opts: CreateProfileOptions): Promise<string> {
  const n = next()
  const r = await insertRow<{ id: string }>(db, 'profiles', {
    company_id: opts.companyId,
    role: opts.role,
    auth_user_id: opts.authUserId ?? null,
    full_name: opts.fullName ?? `${opts.role} ${n}`,
    phone: opts.phone ?? `+99890${String(1_000_000 + n).slice(-7)}`,
    ...opts.extra,
  })
  return r.id
}

export interface TestUser {
  authUid: string
  profileId: string
  companyId: string
  role: UserRole
}

/** auth user + profil (rol bilan). */
export async function createUser(
  db: Db,
  opts: Omit<CreateProfileOptions, 'authUserId'> & { email?: string },
): Promise<TestUser> {
  const authUid = await createAuthUser(db, { email: opts.email, phone: opts.phone })
  const profileId = await createProfile(db, { ...opts, authUserId: authUid })
  return { authUid, profileId, companyId: opts.companyId, role: opts.role }
}

export async function createObject(db: Db, opts: { companyId: string; name?: string; extra?: Row }): Promise<string> {
  const r = await insertRow<{ id: string }>(db, 'objects', {
    company_id: opts.companyId,
    name: opts.name ?? `Obyekt ${next()}`,
    ...opts.extra,
  })
  return r.id
}

export async function addObjectMember(
  db: Db,
  opts: { companyId: string; objectId: string; profileId: string; extra?: Row },
): Promise<string> {
  const r = await insertRow<{ id: string }>(db, 'object_members', {
    company_id: opts.companyId,
    object_id: opts.objectId,
    profile_id: opts.profileId,
    ...opts.extra,
  })
  return r.id
}

export async function createMaterial(
  db: Db,
  opts: { companyId: string; name?: string; baseUnit?: string; extra?: Row },
): Promise<string> {
  const r = await insertRow<{ id: string }>(db, 'materials', {
    company_id: opts.companyId,
    name: opts.name ?? `Material ${next()}`,
    base_unit: opts.baseUnit ?? 'kg',
    ...opts.extra,
  })
  return r.id
}
