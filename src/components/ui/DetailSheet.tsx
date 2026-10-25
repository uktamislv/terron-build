import type { ReactNode } from 'react'
import { BottomSheet } from './BottomSheet'
import { cx } from './cx'
import { Modal } from './Modal'
import { useIsMobile } from './useMediaQuery'

/** Yozuv tafsiloti: telefonda pastki varaq, kompyuterda modal oyna. Amallar — `footer`da. */
export function DetailSheet({
  title,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Kompyuterdagi modal kengligi. */
  size?: 'md' | 'lg'
}) {
  const mobile = useIsMobile()
  return mobile ? (
    <BottomSheet title={title} onClose={onClose} footer={footer}>
      <div className="px-2">{children}</div>
    </BottomSheet>
  ) : (
    <Modal title={title} onClose={onClose} footer={footer} size={size}>
      {children}
    </Modal>
  )
}

/** Tafsilot ro'yxati: chapda nom, o'ngda qiymat (alohida qatorlar). */
export function DetailRows({ items, className }: { items: readonly ({ label: string; value: ReactNode } | false | null | undefined)[]; className?: string }) {
  return (
    <dl className={cx('flex flex-col divide-y divide-line/70', className)}>
      {items
        .filter((x): x is { label: string; value: ReactNode } => Boolean(x))
        .map((x) => (
          <div key={x.label} className="flex min-h-11 items-center justify-between gap-4 py-2 text-sm">
            <dt className="text-muted">{x.label}</dt>
            <dd className="min-w-0 text-right font-medium text-ink">{x.value}</dd>
          </div>
        ))}
    </dl>
  )
}
