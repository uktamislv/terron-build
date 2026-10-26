import { Search } from 'lucide-react'
import { cx } from './cx'
import { inputClass } from './inputClass'

/**
 * Qidiruv maydoni (yagona): chapda belgi, 16 px matn. `size="lg"` — Mini App (48 px),
 * `md` — veb filtrlari (44 px).
 */
export function SearchBox({
  label,
  value,
  onChange,
  placeholder,
  size = 'lg',
  className,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  size?: 'md' | 'lg'
  className?: string
}) {
  return (
    <div className={cx('relative', className)}>
      <Search
        aria-hidden
        className={cx('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted', size === 'lg' ? 'left-3.5 size-5' : 'left-3.5 size-4')}
        strokeWidth={1.75}
      />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(inputClass({ size }), size === 'lg' ? 'pl-11' : 'pl-10')}
      />
    </div>
  )
}
