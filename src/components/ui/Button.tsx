import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-[#1a52e0] active:bg-[#1747c4] disabled:bg-brand/45',
  secondary: 'border border-line bg-paper text-ink hover:border-[#c5d0e3] hover:bg-canvas disabled:text-muted/70',
  ghost: 'text-brand hover:bg-ice disabled:text-muted/70',
  danger: 'border border-danger/25 bg-paper text-danger hover:bg-danger-bg disabled:opacity-60',
}

// sm faqat zich jadval amallari uchun — baribir 44 px bosiladigan maydon (min-h-11)
const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 text-sm',
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-13 px-5 text-base',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Yuklanish: tugma bloklanadi, chapda aylanuvchi belgi. */
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, className, type = 'button', disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <LoaderCircle aria-hidden className="size-5 animate-spin" strokeWidth={1.75} /> : icon}
      {children}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Ekran o'quvchi uchun nom (majburiy) — tooltip sifatida ham chiqadi. */
  label: string
  icon: ReactNode
  variant?: 'ghost' | 'secondary' | 'onDark'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'ghost' && 'text-muted hover:bg-ice hover:text-brand',
        variant === 'secondary' && 'border border-line bg-paper text-ink hover:bg-canvas',
        variant === 'onDark' && 'text-white/80 hover:bg-white/10 hover:text-white',
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  )
})
