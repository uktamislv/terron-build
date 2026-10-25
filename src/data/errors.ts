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
  | 'unknown'

export class RepoError extends Error {
  readonly code: RepoErrorCode

  constructor(code: RepoErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'RepoError'
    this.code = code
  }
}

interface PgLikeError {
  code?: string
  message?: string
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
  const override = overrides[code]
  if (override) return new RepoError(override, e.message)
  switch (code) {
    case '23505':
      return new RepoError('duplicate', e.message)
    case '42501':
      return new RepoError('forbidden', e.message)
    case '23514':
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
