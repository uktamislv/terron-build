import { errorCodeOf, RepoError } from '@/data/errors'
import { formatDateTime, formatQty } from '@/lib/format'
import { t } from './index'

/**
 * Repo xatosini foydalanuvchiga ko'rsatiladigan matnga aylantiradi. Server xabari xom ko'rsatilmaydi:
 * parametrli kalitlarda (`RepoError.params`) — `errorsWith` shabloni, aks holda `errors` matni.
 */
export function errorText(error: unknown): string {
  if (error instanceof RepoError && error.params) {
    const p = error.params
    switch (error.code) {
      case 'catalog_material_has_stock':
        return t.errorsWith.catalog_material_has_stock(p[0] ?? '')
      case 'estimate_item_invalid':
        return t.errorsWith.estimate_item_invalid(p[0] ?? '')
      case 'estimate_materials_invalid':
        return t.errorsWith.estimate_materials_invalid(p[0] ?? '')
      case 'estimate_aliases_invalid':
        return t.errorsWith.estimate_aliases_invalid(p[0] ?? '')
      case 'transfer_insufficient_stock':
        return t.errorsWith.transfer_insufficient_stock(formatQty(p[0] ?? '0'), p[1] ?? '')
      case 'ops_occurred_at_range':
        // Server: eng erta ruxsat etilgan vaqt (UTC) — dd.mm.yyyy HH:mm, Toshkent
        return t.errorsWith.ops_occurred_at_range(formatDateTime(p[0] ?? ''))
      case 'receipt_already_used':
        return t.errorsWith.receipt_already_used(p[0] ?? '', p[1] ?? '')
      default:
        break
    }
  }
  return t.errors[errorCodeOf(error)]
}
