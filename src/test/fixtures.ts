import type { ObjectMember, ObjectRow, Profile } from '@/data/types'
import type { Role } from '@/domain/roles'

export const COMPANY_ID = '00000000-0000-0000-0000-00000000c001'

export function makeProfile(role: Role, overrides: Partial<Profile> = {}): Profile {
  return {
    id: `p-${role}`,
    company_id: COMPANY_ID,
    auth_user_id: `u-${role}`,
    login_kind: 'web',
    role,
    full_name: `Test ${role}`,
    phone: '+998901234567',
    telegram_user_id: null,
    is_active: true,
    created_by: null,
    created_at: '2026-10-01T05:00:00Z',
    updated_at: '2026-10-01T05:00:00Z',
    deleted_at: null,
    ...overrides,
  }
}

export function makeObject(id: string, name: string): ObjectRow {
  return {
    id,
    company_id: COMPANY_ID,
    name,
    address: null,
    status: 'faol',
    created_by: null,
    created_at: '2026-10-01T05:00:00Z',
    updated_at: '2026-10-01T05:00:00Z',
    deleted_at: null,
  }
}

export function makeMember(id: string, objectId: string, profileId: string): ObjectMember {
  return {
    id,
    company_id: COMPANY_ID,
    object_id: objectId,
    profile_id: profileId,
    created_by: null,
    created_at: '2026-10-01T05:00:00Z',
    updated_at: '2026-10-01T05:00:00Z',
    deleted_at: null,
  }
}
