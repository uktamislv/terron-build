// Miqdor maydoni ostidagi tasdiq qatori (domen: `thousandsAmbiguity`).
import { thousandsAmbiguity } from '@/domain/units'
import { t } from '@/i18n'
import { formatQty } from '@/lib/format'

/**
 * "1,500" kiritilgan — ilova 1,5 deb o'qiydi: "1,5 kg deb saqlanadi (1 500 emas)" tasdiq qatori.
 * Noaniq bo'lmasa — null.
 */
export function qtyAmbiguityHint(input: string, unit: string | null | undefined): string | null {
  const a = thousandsAmbiguity(input)
  return a ? t.tg.movement.ambiguousQty(formatQty(a.value), (unit ?? '').trim(), formatQty(a.thousands)) : null
}
