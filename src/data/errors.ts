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
  | ServerHintCode
  | 'unknown'

/**
 * Server biznes qoidalari: `hint` — barqaror kalit (to'liq ro'yxat docs/db-design.md da; masalan
 * supabase/migrations/20261027000001_catalog_guards.sql). YAGONA RO'YXAT — yangi kalitlar
 * (masalan Batch 4 dagi `ops_*`) shu yerga qo'shiladi; har biriga i18n'da `errors.<kalit>` matni.
 *
 * `showServerMessage: true` — serverdagi `message` (o'zbekcha, aniq nomlar bilan, masalan qaysi
 * obyektda qoldiq bor) foydalanuvchiga ko'rsatiladi; aks holda i18n matni.
 * Ro'yxatda yo'q kalit yoki hint'siz xato uchun server `message` hech qachon ko'rsatilmaydi.
 */
export const SERVER_HINTS = {
  catalog_base_unit_in_use: { showServerMessage: false },
  catalog_base_unit_conflict: { showServerMessage: false },
  catalog_base_unit_locked: { showServerMessage: false },
  catalog_unit_in_use: { showServerMessage: false },
  catalog_name_alias_conflict: { showServerMessage: false },
  catalog_material_has_stock: { showServerMessage: true },
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
} as const satisfies Record<string, { showServerMessage: boolean }>

export type ServerHintCode = keyof typeof SERVER_HINTS

export function isServerHint(x: unknown): x is ServerHintCode {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(SERVER_HINTS, x)
}

export class RepoError extends Error {
  readonly code: RepoErrorCode
  /**
   * Foydalanuvchiga ko'rsatiladigan server xabari — faqat `SERVER_HINTS` da
   * `showServerMessage: true` bo'lgan kalitlar uchun to'ldiriladi.
   */
  readonly userMessage: string | null

  constructor(code: RepoErrorCode, message?: string, userMessage: string | null = null) {
    super(message ?? code)
    this.name = 'RepoError'
    this.code = code
    this.userMessage = userMessage
  }
}

interface PgLikeError {
  code?: string
  message?: string
  hint?: string | null
  status?: number
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
  // server xabari faqat ro'yxatda ruxsat berilgan bo'lsa.
  if (isServerHint(e.hint)) {
    const text = e.message?.trim()
    const userMessage = SERVER_HINTS[e.hint].showServerMessage && text ? text : null
    return new RepoError(e.hint, e.message, userMessage)
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
