import { useContext, useEffect, useId, useRef, type FocusEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { t } from '@/i18n'
import { IconButton } from './Button'
import { SheetChromeContext } from './sheetChrome'
import { useOverlay } from './useOverlay'
import { cx } from './cx'

/** Matn kiritiladigan maydon (klaviatura ochiladi). */
function isTextEntry(el: EventTarget | null): el is HTMLElement {
  if (el instanceof HTMLTextAreaElement) return true
  if (!(el instanceof HTMLInputElement)) return false
  return !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'range', 'color', 'hidden'].includes(el.type)
}

/** Klaviatura ochilib bo'lgach (iOS animatsiyasi ~300 ms) fokusdagi maydonni ko'rinadigan joyga aylantirish. */
const KEYBOARD_SETTLE_MS = 300

/**
 * Telefon: pastdan chiqadigan varaq (Esc, fon bosilsa yopiladi, fokus tuzog'i).
 * iOS klaviaturasi: varaq ko'rinadigan oyna (visualViewport) ichida qoladi — balandligi va joyi
 * `--vv-h` / `--vv-top` CSS o'zgaruvchilari orqali yangilanadi; fokusdagi maydon ko'rinadigan joyga aylantiriladi.
 */
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
  // Mini App: Telegram BackButton faqat shu varaqni yopadi, MainButton varaq ochiqligida yashirin
  const registerSheet = useContext(SheetChromeContext)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => registerSheet?.(() => closeRef.current()), [registerSheet])
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const vv = window.visualViewport
    const root = rootRef.current
    if (!vv || !root) return
    const update = () => {
      root.style.setProperty('--vv-h', `${vv.height}px`)
      root.style.setProperty('--vv-top', `${vv.offsetTop}px`)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])
  const onFocusIn = (e: FocusEvent<HTMLDivElement>) => {
    const target = e.target
    if (!isTextEntry(target)) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => target.scrollIntoView?.({ block: 'nearest' }), KEYBOARD_SETTLE_MS)
  }
  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-x-0 top-[var(--vv-top,0px)] z-50 flex h-[var(--vv-h,100dvh)] items-end justify-center"
    >
      <div aria-hidden className="absolute inset-0 animate-fade-in bg-navy/40" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onFocus={onFocusIn}
        className="relative flex max-h-[min(85dvh,calc(var(--vv-h,100dvh)-0.5rem))] w-full max-w-lg animate-sheet-in flex-col rounded-t-2xl bg-paper shadow-float outline-none"
      >
        <span aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" />
        <div className="flex items-center justify-between gap-2 py-1 pr-2 pl-5">
          <h2 id={titleId} className="text-lg font-semibold text-ink">
            {title}
          </h2>
          <IconButton label={t.common.close} icon={<X className="size-5" strokeWidth={1.75} />} onClick={onClose} />
        </div>
        <div
          className={cx(
            'overflow-y-auto overscroll-contain px-3',
            footer ? 'pb-3' : 'pb-[max(0.75rem,env(safe-area-inset-bottom),var(--tg-safe-area-inset-bottom,0px))]',
          )}
        >
          {children}
        </div>
        {footer && (
          <div className="flex gap-2 border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom),var(--tg-safe-area-inset-bottom,0px))]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
