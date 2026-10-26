import { MIN_PASSWORD_LENGTH } from './authRepo'
import { RepoError, type RepoErrorCode } from './errors'
import { invokeFunction } from './functions'
import type { LoginKind } from './types'

export interface SetLoginInput {
  profileId: string
  /** Bo'sh bo'lsa — telefondan sintetik login (foydalanuvchi telefon bilan kiradi). */
  email?: string
  password: string
}

/** `admin-users` javobidagi `{ error }` kodlari (shartnoma). */
const BODY_ERRORS: Record<string, RepoErrorCode> = {
  invalid_request: 'invalid_request',
  weak_password: 'weak_password',
  password_too_long: 'password_too_long',
  email_invalid: 'email_invalid',
  email_reserved: 'email_reserved',
  unauthorized: 'session_expired',
  forbidden: 'forbidden',
  not_found: 'not_found',
  login_taken: 'login_taken',
  conflict: 'conflict',
  forbidden_target: 'forbidden_target',
}

/** Kod bo'lmasa yoki noma'lum bo'lsa — HTTP status bo'yicha. */
const STATUS_ERRORS: Record<number, RepoErrorCode> = {
  400: 'invalid_request',
  401: 'session_expired',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
}

export function setLoginErrorCode(status: number, bodyError: string | undefined): RepoErrorCode {
  if (status === 401) return 'session_expired'
  const byBody = bodyError ? BODY_ERRORS[bodyError] : undefined
  return byBody ?? STATUS_ERRORS[status] ?? 'unknown'
}

/**
 * Veb login berish yoki parolni tiklash — `admin-users` Edge Function.
 * Parol javobda qaytmaydi; natija — login (email yoki telefon).
 */
export async function setLogin(
  input: SetLoginInput,
): Promise<{ login: string; loginKind: LoginKind; existingLoginReplaced: boolean }> {
  if (input.password.length < MIN_PASSWORD_LENGTH) throw new RepoError('weak_password')
  const email = input.email?.trim().toLowerCase()
  const result = await invokeFunction<{ ok: true; login: string; login_kind?: LoginKind; existing_login_replaced?: boolean }>('admin-users', {
    action: 'set_login',
    profile_id: input.profileId,
    ...(email ? { email } : {}),
    password: input.password,
  })
  if (result.ok) {
    return {
      login: result.data.login,
      loginKind: result.data.login_kind ?? 'web',
      // Avvalgi login almashtirildi — egasiga Telegram'da xabar boradi (login_changed)
      existingLoginReplaced: result.data.existing_login_replaced === true,
    }
  }
  if (result.network) throw new RepoError('network')
  throw new RepoError(setLoginErrorCode(result.status, result.body?.error), result.body?.error)
}
