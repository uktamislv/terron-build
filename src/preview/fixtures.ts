// Ko'rgazma uchun umumiy namuna ma'lumotlar (faqat DEV). Repo chaqirilmaydi.
import type { Material, ObjectRow, Profile } from '@/data/types'
import type { Role } from '@/domain/roles'

export const PREVIEW_COMPANY = '00000000-0000-0000-0000-0000000000c1'

const stamp = '2026-10-01T05:00:00Z'

export function previewProfile(role: Role, full_name = 'Aziz Karimov'): Profile {
  return {
    id: `pv-${role}`,
    company_id: PREVIEW_COMPANY,
    auth_user_id: `pv-u-${role}`,
    login_kind: 'web',
    role,
    full_name,
    phone: '+998901234567',
    telegram_user_id: null,
    is_active: true,
    created_by: null,
    created_at: stamp,
    updated_at: stamp,
    deleted_at: null,
  }
}

function obj(id: string, name: string, address: string): ObjectRow {
  return { id, company_id: PREVIEW_COMPANY, name, address, status: 'faol', radius_m: 300, created_by: null, created_at: stamp, updated_at: stamp, deleted_at: null }
}

export const previewObjects: ObjectRow[] = [
  obj('o-1', 'Chilonzor 12-uy', 'Chilonzor tumani, 12-mavze'),
  obj('o-2', 'Yunusobod maktab', 'Yunusobod, 4-kvartal'),
  obj('o-3', 'Sergeli ombor', 'Sergeli, sanoat zonasi'),
]

function mat(id: string, name: string, base_unit: string, waste = '0'): Material {
  return {
    id,
    company_id: PREVIEW_COMPANY,
    name,
    base_unit,
    category: null,
    waste_pct: waste,
    is_active: true,
    created_by: null,
    created_at: stamp,
    updated_at: stamp,
    units: [],
    aliases: [],
  }
}

export const previewMaterials: Material[] = [
  mat('m-1', 'Sement M400', 'kg', '2'),
  mat('m-2', 'G‘isht (pishiq)', 'dona', '3'),
  mat('m-3', 'Qum', 'm³'),
  mat('m-4', 'Shag‘al 5–20', 'm³'),
  mat('m-5', 'Armatura Ø12', 'kg', '1'),
  mat('m-6', 'Beton B25', 'm³'),
  mat('m-7', 'Kafel 30×30', 'm²', '5'),
]

/** Bugungi sana atrofidagi ISO vaqt (soat farqi bilan). */
export function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString()
}
