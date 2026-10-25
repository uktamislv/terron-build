import type { ReactNode } from 'react'
import { cx, Qty } from '@/components/ui'
import type { MaterialUnit } from '@/data/types'
import { cmp } from '@/domain/decimal'

/** Tanlangan birlik asosiy birlik emasmi (koeffitsient 1 emas yoki nomi boshqa). */
function isConverted(unit: Pick<MaterialUnit, 'unit' | 'factor'>, baseUnit: string): boolean {
  return unit.unit !== baseUnit || cmp(unit.factor, '1') !== 0
}

/**
 * "= 30 000 dona" — asosiy birlikdagi miqdor ("yuk xati" qahramon raqami). Birlik asosiy bo'lmasa katta
 * va ko'zga tashlanadigan qilib ko'rsatiladi (noto'g'ri birlik tanlash xatosini ushlash uchun).
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
    <div className={cx('flex flex-col gap-1.5 rounded-xl px-4 py-3', emphasized ? 'border-2 border-brand bg-ice' : 'border border-line bg-paper')}>
      {qtyBase !== null && (
        <p
          data-testid="base-qty"
          data-emphasized={emphasized ? 'true' : undefined}
          className={cx('flex items-baseline gap-2', emphasized ? 'text-navy' : 'text-ink')}
        >
          <span className={cx('font-semibold text-muted', emphasized ? 'text-2xl' : 'text-lg')}>
            =
          </span>{' '}
          <Qty value={qtyBase} unit={baseUnit} size={emphasized ? 'hero' : 'lg'} />
        </p>
      )}
      {children}
    </div>
  )
}
