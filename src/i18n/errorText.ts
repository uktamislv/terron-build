import { errorCodeOf, RepoError } from '@/data/errors'
import { t } from './index'

/**
 * Repo xatosini foydalanuvchiga ko'rsatiladigan matnga aylantiradi.
 * Server xabari faqat `SERVER_HINTS` da ruxsat berilgan kalitlarda (`userMessage`), aks holda i18n matni.
 */
export function errorText(error: unknown): string {
  if (error instanceof RepoError && error.userMessage) return error.userMessage
  return t.errors[errorCodeOf(error)]
}
