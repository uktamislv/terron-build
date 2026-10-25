import { useEffect, useState, type ReactNode } from 'react'
import { cx } from './cx'

function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])
  return scrolled
}

/**
 * Sahifa sarlavhasi (28 px) va o'ngda amallar. Telefonda qotgan (sticky): aylantirilganda kichrayadi
 * va ostida chiziq chiqadi. Joylashuv balandligi `--header-h` (layout tepa paneli) ostidan.
 */
export function PageHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  const scrolled = useScrolled()
  return (
    <header
      className={cx(
        '-mx-4 flex items-center gap-3 px-4 transition-[padding,box-shadow] max-md:sticky max-md:top-[var(--header-h,0px)] max-md:z-20 max-md:bg-canvas/95 max-md:backdrop-blur md:mx-0 md:px-0',
        scrolled ? 'max-md:py-2 max-md:shadow-[0_1px_0_var(--color-line)]' : 'py-1 md:py-0',
        className,
      )}
    >
      {icon && (
        <span aria-hidden className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-ice text-brand md:inline-flex [&>svg]:size-6">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className={cx('truncate font-semibold tracking-tight text-ink transition-[font-size]', scrolled ? 'text-lg md:text-[28px]' : 'text-2xl md:text-[28px]')}>
          {title}
        </h1>
        {description && <p className={cx('truncate text-sm text-muted', scrolled && 'max-md:hidden')}>{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Kartochka bo'limi (radius 16, 1 px chegara, soyasiz). */
export function Card({
  title,
  actions,
  children,
  className,
  bodyClassName,
  as: Tag = 'section',
  labelledBy,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  as?: 'section' | 'div'
  labelledBy?: string
}) {
  return (
    <Tag aria-labelledby={labelledBy} className={cx('rounded-2xl border border-line bg-paper', className)}>
      {(title || actions) && (
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 md:px-5">
          {title && (
            <h2 id={labelledBy} className="text-base font-semibold text-ink md:text-lg">
              {title}
            </h2>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cx('p-4 md:p-5', bodyClassName)}>{children}</div>
    </Tag>
  )
}
