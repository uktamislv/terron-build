import { useAuth } from '@/auth/authContext'
import { can } from '@/domain/roles'
import { historyHref } from './historyHref'

/** `(jadval, id) → /history?record=…` yoki ruxsat bo'lmasa (faqat admin / direktor) — null. */
export function useHistoryHref(): (table: string | null, id: string) => string | null {
  const { profile } = useAuth()
  const allowed = Boolean(profile && can(profile.role, 'view_audit'))
  return (table, id) => (allowed ? historyHref(table, id) : null)
}
