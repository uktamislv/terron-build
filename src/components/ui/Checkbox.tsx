import type { InputHTMLAttributes } from 'react'
import { Check } from 'lucide-react'
import { cx } from './cx'

/**
 * Yagona checkbox: 20 px quti, chegara `line-strong` (≥ 3:1 kontrast), belgilanganda `brand` fon va oq belgi.
 * Native input saqlanadi (klaviatura, forma, ekran o'quvchi), faqat ko'rinishi almashtiriladi.
 * Yorliq chaqiruvchi tomonda — `<label>` ichiga qo'yiladi (bosiladigan joy ≥ 44 px label'da).
 */
export function Checkbox({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <span className={cx('relative inline-flex size-5 shrink-0', className)}>
      <input
        {...props}
        type="checkbox"
        className={cx(
          'peer size-5 cursor-pointer appearance-none rounded-md border-2 border-line-strong bg-paper transition-colors',
          'checked:border-brand checked:bg-brand',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3.5 text-white opacity-0 peer-checked:opacity-100"
      />
    </span>
  )
}
