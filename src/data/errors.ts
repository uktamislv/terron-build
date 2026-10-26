// Supabase/PostgREST xatolarini foydalanuvchiga tushunarli kodlarga aylantirish.
// Kodlar matnga src/i18n/uz.ts dagi `errors` bo'limida aylanadi.

export type RepoErrorCode =
  | 'not_configured'
  | 'network'
  | 'forbidden'
  | 'phone_taken'
  | 'phone_format'
  | 'already_member'
  | 'duplicate'
  | 'invalid_value'
  | 'not_found'
  | 'login_taken'
  | 'weak_password'
  | 'password_too_long'
  | 'email_invalid'
  | 'email_reserved'
  | 'invalid_request'
  | 'conflict'
  | 'session_expired'
  | 'material_name_taken'
  | 'unit_taken'
  | 'alias_taken'
  | 'photo_too_large'
  | 'photo_type'
  | 'photo_upload_failed'
  | 'export_too_large'
  | 'receipt_url_invalid'
  | 'receipt_unreadable'
  // Edge Function kalitlari (docs/audit-fixes.md): admin-users — boshqa firma / himoyalangan profil;
  // receipt-lookup — so'rovlar chegarasi (429)
  | 'forbidden_target'
  | 'rate_limited'
  | ServerHintCode
  | 'unknown'

/**
 * Server biznes qoidalari: `hint` — barqaror kalit (to'liq ro'yxat docs/db-design.md da; masalan
 * supabase/migrations/20261027000001_catalog_guards.sql). YAGONA RO'YXAT — yangi kalitlar
 * (masalan Batch 4 dagi `ops_*`) shu yerga qo'shiladi; har biriga i18n'da `errors.<kalit>` matni.
 *
 * Server `message` foydalanuvchiga HECH QACHON xom ko'rsatilmaydi (`showServerMessage` — doim false).
 * Aniq nom yoki raqam kerak bo'lgan kalitlar (`HINT_PARAMS`) uchun parametrlar `details` (bo'lsa) yoki
 * xabardan qat'iy shablon bilan ajratiladi va uz.ts dagi `errorsWith.<kalit>` shabloniga qo'yiladi;
 * ajratib bo'lmasa — oddiy `errors.<kalit>` matni.
 */
export const SERVER_HINTS = {
  catalog_base_unit_in_use: { showServerMessage: false },
  catalog_base_unit_conflict: { showServerMessage: false },
  catalog_base_unit_locked: { showServerMessage: false },
  catalog_unit_in_use: { showServerMessage: false },
  catalog_name_alias_conflict: { showServerMessage: false },
  catalog_material_has_stock: { showServerMessage: false },
  catalog_material_deleted: { showServerMessage: false },
  catalog_material_inactive: { showServerMessage: false },
  catalog_unit_duplicate: { showServerMessage: false },
  catalog_name_duplicate: { showServerMessage: false },
  catalog_alias_duplicate: { showServerMessage: false },
  soft_delete_only: { showServerMessage: false },
  truncate_blocked: { showServerMessage: false },
  audit_append_only: { showServerMessage: false },
  immutable_column: { showServerMessage: false },
  restore_admin_only: { showServerMessage: false },
  company_status_super_admin_only: { showServerMessage: false },
  ops_unit_not_found: { showServerMessage: false },
  ops_unit_material_mismatch: { showServerMessage: false },
  ops_purchase_not_found: { showServerMessage: false },
  ops_purchase_mismatch: { showServerMessage: false },
  ops_occurred_at_range: { showServerMessage: false },
  ops_photo_path_company: { showServerMessage: false },
  ops_photo_path_format: { showServerMessage: false },
  ops_usage_days_range: { showServerMessage: false },
  ops_photo_not_owned: { showServerMessage: false },
  ops_photo_reused: { showServerMessage: false },
  request_fields_locked: { showServerMessage: false },
  request_status_transition: { showServerMessage: false },
  inventory_status_direct: { showServerMessage: false },
  auth_required: { showServerMessage: false },
  inventory_not_found: { showServerMessage: false },
  inventory_submit_forbidden: { showServerMessage: false },
  inventory_already_submitted: { showServerMessage: false },
  template_super_admin_only: { showServerMessage: false },
  template_company_not_found: { showServerMessage: false },
  supplier_duplicate: { showServerMessage: false },
  purchase_has_receipts: { showServerMessage: false },
  purchase_not_open: { showServerMessage: false },
  cash_amount_locked: { showServerMessage: false },
  cash_recipient_role: { showServerMessage: false },
  estimate_import_forbidden: { showServerMessage: false },
  estimate_invalid: { showServerMessage: false },
  estimate_object_not_found: { showServerMessage: false },
  estimate_id_conflict: { showServerMessage: false },
  estimate_not_found: { showServerMessage: false },
  estimate_direct_edit: { showServerMessage: false },
  estimate_id_reused: { showServerMessage: false },
  estimate_restore_conflict: { showServerMessage: false },
  estimate_too_many_rows: { showServerMessage: false },
  estimate_item_invalid: { showServerMessage: false },
  estimate_materials_forbidden: { showServerMessage: false },
  estimate_materials_invalid: { showServerMessage: false },
  estimate_aliases_invalid: { showServerMessage: false },
  inventory_locked: { showServerMessage: false },
  inventory_forbidden: { showServerMessage: false },
  inventory_object_not_found: { showServerMessage: false },
  inventory_details_forbidden: { showServerMessage: false },
  request_purchase_invalid: { showServerMessage: false },
  transfer_direct_edit: { showServerMessage: false },
  transfer_invalid: { showServerMessage: false },
  transfer_object_not_found: { showServerMessage: false },
  transfer_forbidden: { showServerMessage: false },
  transfer_id_reused: { showServerMessage: false },
  transfer_not_found: { showServerMessage: false },
  transfer_not_open: { showServerMessage: false },
  transfer_already_received: { showServerMessage: false },
  inventory_apply_direct: { showServerMessage: false },
  inventory_apply_forbidden: { showServerMessage: false },
  inventory_not_submitted: { showServerMessage: false },
  inventory_already_applied: { showServerMessage: false },
  report_period_invalid: { showServerMessage: false },
  report_group_invalid: { showServerMessage: false },
  restore_table_invalid: { showServerMessage: false },
  restore_not_found: { showServerMessage: false },
  restore_not_deleted: { showServerMessage: false },
  restore_transfer_movement: { showServerMessage: false },
  restore_conflict: { showServerMessage: false },
  history_limit_invalid: { showServerMessage: false },
  inventory_apply_expired: { showServerMessage: false },
  // Batch 12 (docs/automation-design.md). Xabarda mavjud qoldiq / kim va qachon ishlatgani bor.
  transfer_insufficient_stock: { showServerMessage: false },
  photo_required: { showServerMessage: false },
  receipt_already_used: { showServerMessage: false },
  alert_action_forbidden: { showServerMessage: false },
  alert_not_found: { showServerMessage: false },
  photo_sha256_invalid: { showServerMessage: false },
  purchase_request_invalid: { showServerMessage: false },
  supplier_tin_duplicate: { showServerMessage: false },
  receipt_lookup_invalid: { showServerMessage: false },
  // Batch 11 (docs/handoff-design.md): xatolik xabarlari — 10 daqiqada ≤ 5 ta
  bug_report_rate_limited: { showServerMessage: false },
  bug_report_invalid: { showServerMessage: false },
  // Audit tuzatishlari (docs/audit-fixes.md, "Yangi hint'lar")
  movement_rpc_only: { showServerMessage: false },
  qty_too_small: { showServerMessage: false },
  qty_too_large: { showServerMessage: false },
  price_too_large: { showServerMessage: false },
  transfer_over_receipt: { showServerMessage: false },
  alert_close_note_required: { showServerMessage: false },
  profile_protected: { showServerMessage: false },
  login_target_not_found: { showServerMessage: false },
  photo_hash_invalid: { showServerMessage: false },
  correct_invalid: { showServerMessage: false },
  correct_not_found: { showServerMessage: false },
  correct_forbidden: { showServerMessage: false },
  correct_window_passed: { showServerMessage: false },
  correct_linked: { showServerMessage: false },
  supplier_merge_forbidden: { showServerMessage: false },
  supplier_merge_invalid: { showServerMessage: false },
  supplier_not_found: { showServerMessage: false },
  notification_health_forbidden: { showServerMessage: false },
  // Audit 2 (20261109000001_audit2_fixes.sql). cancel_own_entry — correct_* kalitlari bilan.
  chat_reset_forbidden: { showServerMessage: false },
  profile_not_found: { showServerMessage: false },
  purchase_buyer_invalid: { showServerMessage: false },
  alert_close_note_locked: { showServerMessage: false },
  // check_purchase_price (54000) — narx tekshiruvi chegarasi
  rate_limited: { showServerMessage: false },
} as const satisfies Record<string, { showServerMessage: boolean }>

export type ServerHintCode = keyof typeof SERVER_HINTS

export function isServerHint(x: unknown): x is ServerHintCode {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(SERVER_HINTS, x)
}

export class RepoError extends Error {
  readonly code: RepoErrorCode
  /**
   * Matn shabloni uchun parametrlar (`HINT_PARAMS`): masalan obyekt nomi, qator raqami, mavjud qoldiq.
   * null — parametr yo'q (oddiy i18n matni).
   */
  readonly params: readonly string[] | null

  constructor(code: RepoErrorCode, message?: string, params: readonly string[] | null = null) {
    super(message ?? code)
    this.name = 'RepoError'
    this.code = code
    this.params = params
  }
}

interface PgLikeError {
  code?: string
  message?: string
  /** PostgreSQL `DETAIL` (PostgREST: `details`). */
  details?: string | null
  hint?: string | null
  status?: number
}

/** Ism / nom parametri: bo'sh emas, boshqaruv belgilarisiz, ko'pi bilan 120 belgi. */
function cleanName(v: string | undefined): string | null {
  // eslint-disable-next-line no-control-regex -- boshqaruv belgilarini olib tashlash
  const x = (v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return x && x.length <= 120 ? x : null
}

/** Qator raqami: faqat raqamlar — `details` dan, bo'lmasa xabar boshidagi "Qator N:". */
function rowNo(details: string | null | undefined, message: string | undefined): string | null {
  const d = (details ?? '').trim()
  if (/^\d{1,6}$/.test(d)) return d
  const m = /^Qator (\d{1,6}):/.exec(message ?? '')
  return m?.[1] ?? null
}

type ParamSource = { message?: string; details?: string | null }

/**
 * Parametrli kalitlar: server `details` (ustun) yoki xabardan qat'iy shablon bilan. Natija — faqat
 * tekshirilgan qiymatlar (raqam, sana, nom); mos kelmasa — null (oddiy matn).
 */
export const HINT_PARAMS: Partial<Record<ServerHintCode, (e: ParamSource) => string[] | null>> = {
  // 'Materialni o''chirib bo''lmaydi: "<obyekt>" obyektida qoldig''i bor. …'
  catalog_material_has_stock: (e) => {
    const name = cleanName(/"(.+?)" obyektida/.exec(e.message ?? '')?.[1])
    return name ? [name] : null
  },
  // detail = qator raqami (yoki xabar "Qator N: …")
  estimate_item_invalid: (e) => {
    const r = rowNo(e.details, e.message)
    return r ? [r] : null
  },
  estimate_materials_invalid: (e) => {
    const r = rowNo(e.details, e.message)
    return r ? [r] : null
  },
  estimate_aliases_invalid: (e) => {
    const r = rowNo(e.details, e.message)
    return r ? [r] : null
  },
  // detail = mavjud qoldiq (numeric, manfiy bo'lishi mumkin); birlik — xabar oxirida ("… mavjud 120 kg")
  transfer_insufficient_stock: (e) => {
    const qty = (e.details ?? '').trim()
    if (!/^-?\d+(\.\d+)?$/.test(qty)) return null
    const unit = cleanName(/mavjud \S+ (.+)$/.exec(e.message ?? '')?.[1]) ?? ''
    return [qty.startsWith('-') ? '0' : qty, unit]
  },
  // detail = eng erta ruxsat etilgan vaqt (UTC ISO) — Toshkent vaqtida ko'rsatiladi
  ops_occurred_at_range: (e) => {
    const at = (e.details ?? '').trim()
    return at && Number.isFinite(Date.parse(at)) && /^\d{4}-\d{2}-\d{2}T/.test(at) ? [at] : null
  },
  // 'Bu chek allaqachon ishlatilgan: <ism>, <dd.mm.yyyy hh:mi>'
  receipt_already_used: (e) => {
    const m = /ishlatilgan: (.+), (\d{2}\.\d{2}\.\d{4} \d{2}:\d{2})$/.exec((e.message ?? '').trim())
    const name = cleanName(m?.[1])
    return m && name ? [name, m[2] ?? ''] : null
  },
}

/**
 * Postgres xato kodi → RepoErrorCode.
 * `overrides` — jadvalga xos ma'no (masalan profiles da 23505 = telefon band).
 */
export function toRepoError(
  error: unknown,
  overrides: Partial<Record<string, RepoErrorCode>> = {},
): RepoError {
  if (error instanceof RepoError) return error
  const e = (error ?? {}) as PgLikeError
  const code = e.code ?? ''
  // Barqaror kalit (`hint`) → shu kod, errcode qanday bo'lishidan qat'i nazar (P0001, 23505, 42501...);
  // server xabari ko'rsatilmaydi — faqat ajratilgan parametrlar (HINT_PARAMS)
  if (isServerHint(e.hint)) {
    const params = HINT_PARAMS[e.hint]?.({ message: e.message, details: e.details }) ?? null
    return new RepoError(e.hint, e.message, params)
  }
  const override = overrides[code]
  if (override) return new RepoError(override, e.message)
  switch (code) {
    case '23505':
      return new RepoError('duplicate', e.message)
    case '42501':
      return new RepoError('forbidden', e.message)
    case '23514':
    case 'P0001':
    case '22P02':
    case '23502':
      return new RepoError('invalid_value', e.message)
    case 'PGRST116':
    case 'P0002':
      return new RepoError('not_found', e.message)
    default:
      break
  }
  if (e.status === 401 || e.status === 403) return new RepoError('forbidden', e.message)
  if (error instanceof TypeError || /fetch|network/i.test(e.message ?? '')) {
    return new RepoError('network', e.message)
  }
  return new RepoError('unknown', e.message)
}

export function errorCodeOf(error: unknown): RepoErrorCode {
  return error instanceof RepoError ? error.code : 'unknown'
}

/**
 * Shu `id` bilan qator allaqachon bor (oldingi urinish saqlangan, javob yo'qolgan): 23505, hint'siz
 * va aynan berilgan birlamchi kalit (masalan `movements_pkey`). Hint'li 23505 (masalan
 * `ops_photo_reused`) — oddiy xato.
 */
export function isPkeyConflict(error: unknown, constraint: string): boolean {
  const e = (error ?? {}) as { code?: string; hint?: string | null; message?: string; details?: string | null }
  if (e.code !== '23505' || e.hint) return false
  return `${e.message ?? ''} ${e.details ?? ''}`.includes(constraint)
}
