import { errorCodeOf } from '@/data/errors'
import { t } from './index'

/** Repo xatosini foydalanuvchiga ko'rsatiladigan matnga aylantiradi. */
export function errorText(error: unknown): string {
  return t.errors[errorCodeOf(error)]
}
