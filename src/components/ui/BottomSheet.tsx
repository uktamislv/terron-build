import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { t } from '@/i18n'
import { IconButton } from './Button'
import { useOverlay } from './useOverlay'

/** Telefon: pastdan chiqadigan varaq (Esc, fon bosilsa yopiladi, fokus tuzog'i). */
export function BottomSheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(ref, onClose)
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div aria-hidden className="absolute inset-0 animate-fade-in bg-navy/40" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[85dvh] w-full max-w-lg animate-sheet-in flex-col rounded-t-2xl bg-paper shadow-float outline-none"
      >
        <span aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" />
        <div className="flex items-center justify-between gap-2 py-1 pr-2 pl-5">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
          </h2>
          <IconButton label={t.common.close} icon={<X className="size-5" strokeWidth={1.75} />} onClick={onClose} />
        </div>
        <div className="overflow-y-auto px-3 pb-3">{children}</div>
        {footer && <div className="flex gap-2 border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
