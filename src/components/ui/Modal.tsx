import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { t } from '@/i18n'
import { IconButton } from './Button'
import { cx } from './cx'
import { useOverlay } from './useOverlay'

/** Dialog: kompyuterda markazda, telefonda pastdan chiqadigan varaq ko'rinishida. */
export function Modal({
  title,
  onClose,
  children,
  size = 'md',
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  /** md — formalar, lg — ko'p bo'limli karta (masalan material). */
  size?: 'md' | 'lg'
  /** Pastki qotgan amallar qatori. */
  footer?: ReactNode
}) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(ref, onClose)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div aria-hidden className="absolute inset-0 animate-fade-in bg-navy/40" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'relative flex max-h-[92dvh] w-full animate-sheet-in flex-col rounded-t-2xl bg-paper shadow-float outline-none sm:animate-pop-in sm:rounded-2xl',
          size === 'lg' ? 'max-w-2xl' : 'max-w-lg',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line py-2 pr-2 pl-5">
          <h2 id={titleId} className="text-lg font-semibold text-ink">
            {title}
          </h2>
          <IconButton label={t.common.close} icon={<X className="size-5" strokeWidth={1.75} />} onClick={onClose} />
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
