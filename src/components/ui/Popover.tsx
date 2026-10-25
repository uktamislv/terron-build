import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cx } from './cx'
import { useOverlay } from './useOverlay'

export interface PopoverTriggerProps {
  open: boolean
  toggle: () => void
  'aria-expanded': boolean
  'aria-controls': string | undefined
  'aria-haspopup': 'dialog'
}

/**
 * Kompyuter: tugma ostida ochiladigan panel. Esc va tashqariga bosish yopadi; fokus ichida aylanadi.
 * `trigger` — render-prop (aria-expanded va aria-controls beriladi).
 */
export function Popover({
  trigger,
  children,
  label,
  align = 'start',
  className,
}: {
  trigger: (props: PopoverTriggerProps) => ReactNode
  children: (close: () => void) => ReactNode
  label: string
  align?: 'start' | 'end'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = () => setOpen(false)
  return (
    <div ref={wrap} className="relative">
      {trigger({
        open,
        toggle: () => setOpen((o) => !o),
        'aria-expanded': open,
        'aria-controls': open ? id : undefined,
        'aria-haspopup': 'dialog',
      })}
      {open && (
        <PopoverPanel id={id} label={label} align={align} className={className} onClose={close}>
          {children(close)}
        </PopoverPanel>
      )}
    </div>
  )
}

function PopoverPanel({
  id,
  label,
  align,
  className,
  onClose,
  children,
}: {
  id: string
  label: string
  align: 'start' | 'end'
  className?: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(ref, onClose, { lockScroll: false })
  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={cx(
        'absolute top-full z-40 mt-2 min-w-56 animate-pop-in rounded-xl border border-line bg-paper p-2 shadow-float outline-none',
        align === 'end' ? 'right-0' : 'left-0',
        className,
      )}
    >
      {children}
    </div>
  )
}
