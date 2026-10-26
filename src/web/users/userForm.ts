// Foydalanuvchi formasi validatsiyasi va yordamchilar (sof funksiyalar).
import { normalizePhone } from '@shared/phone'
import { ROLES, isRole, type Role } from '@/domain/roles'

/**
 * Obyekt bo'yicha ishlaydigan rollar (docs/db-design.md "Rollar"): prorab, omborchi —
 * faqat biriktirilgan obyektlarda; haydovchi — o'zi biriktirilgan obyektlar.
 */
export const OBJECT_SCOPED_ROLES: readonly Role[] = ['prorab', 'omborchi', 'haydovchi']
/** Obyektsiz ishlay olmaydigan rollar — kamida bitta obyekt majburiy. */
export const OBJECT_REQUIRED_ROLES: readonly Role[] = ['prorab', 'omborchi']

export function isObjectScoped(role: Role | ''): boolean {
  return role !== '' && OBJECT_SCOPED_ROLES.includes(role)
}

/** Admin super_admin rolini bera olmaydi (RLS ham rad etadi). */
export function assignableRoles(actor: Role): Role[] {
  return actor === 'super_admin' ? [...ROLES] : ROLES.filter((r) => r !== 'super_admin')
}

export interface UserFormValues {
  fullName: string
  phone: string
  role: Role | ''
  objectIds: string[]
}

export type UserFormErrors = Partial<Record<'fullName' | 'phone' | 'role' | 'objectIds', 'required' | 'invalid'>>

export interface ValidUserForm {
  fullName: string
  phone: string
  role: Role
  objectIds: string[]
}

export function validateUserForm(
  values: UserFormValues,
  actor: Role,
): { ok: true; value: ValidUserForm } | { ok: false; errors: UserFormErrors } {
  const errors: UserFormErrors = {}
  const fullName = values.fullName.trim().replace(/\s+/g, ' ')
  if (!fullName) errors.fullName = 'required'

  const phone = normalizePhone(values.phone)
  if (!values.phone.trim()) errors.phone = 'required'
  else if (!phone) errors.phone = 'invalid'

  const role = values.role
  if (!isRole(role)) errors.role = 'required'
  else if (!assignableRoles(actor).includes(role)) errors.role = 'invalid'

  const objectIds = isRole(role) && isObjectScoped(role) ? [...new Set(values.objectIds)] : []
  if (isRole(role) && OBJECT_REQUIRED_ROLES.includes(role) && objectIds.length === 0) {
    errors.objectIds = 'required'
  }

  if (Object.keys(errors).length > 0 || !phone || !isRole(role)) return { ok: false, errors }
  return { ok: true, value: { fullName, phone, role, objectIds } }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateLoginForm(email: string, password: string): { email?: 'invalid'; password?: 'invalid' } {
  const errors: { email?: 'invalid'; password?: 'invalid' } = {}
  if (email.trim() && !EMAIL_RE.test(email.trim())) errors.email = 'invalid'
  if (password.length < 8) errors.password = 'invalid'
  return errors
}
