import type { ReactNode } from 'react'
import type { MaterialUnit } from '@/data/types'
import { cmp } from '@/domain/decimal'
import { t } from '@/i18n'
import { formatQty } from '@/lib/format'

/** Tanlangan birlik asosiy birlik emasmi (koeffitsient 1 emas yoki nomi boshqa). */
function isConverted(unit: Pick<MaterialUnit, 'unit' | 'factor'>, baseUnit: string): boolean {
  return unit.unit !== baseUnit || cmp(unit.factor, '1') !== 0
}

/**
 * "= 30 000 dona" — asosiy birlikdagi miqdor. Birlik asosiy bo'lmasa katta va ko'zga tashlanadigan
 * qilib ko'rsatiladi (noto'g'ri birlik tanlash xatosini ushlash uchun). Ostida qo'shimcha qatorlar.
 */
export function BaseQtyBox({
  qtyBase,
  unit,
  baseUnit,
  children,
}: {
  qtyBase: string | null
  unit: Pick<MaterialUnit, 'unit' | 'factor'> | null
  baseUnit: string
  children?: ReactNode
}) {
  if (qtyBase === null && !children) return null
  const emphasized = qtyBase !== null && unit !== null && isConverted(unit, baseUnit)
  return (
    <div
      className={`rounded-xl px-4 py-3 ${emphasized ? 'border-2 border-brand bg-brand-light' : 'bg-slate-50'}`}
    >
      {qtyBase !== null && (
        <p
          data-testid="base-qty"
          data-emphasized={emphasized ? 'true' : undefined}
          className={emphasized ? 'text-3xl font-bold text-brand-dark' : 'text-lg font-semibold text-slate-900'}
        >
          {t.tg.movement.equals(formatQty(qtyBase), baseUnit)}
        </p>
      )}
      {children}
    </div>
  )
}
