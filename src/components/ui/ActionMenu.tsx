import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { t } from '@/i18n'
import { IconButton } from './Button'
import { cx } from './cx'

export interface ActionItem {
  key: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  /** Xavfli amal (o'chirish) — qizil matn. */
  danger?: boolean
  disabled?: boolean
}

/**
 * Jadval qatori oxiridagi "⋯" menyusi (role="menu"). ↑/↓ bilan yuriladi, Esc / tashqariga bosish yopadi,
 * yopilganda fokus tugmaga qaytadi. Band bo'lmasa — hech narsa chizilmaydi.
 */
export function ActionMenu({ items, label = t.ui.actions }: { items: readonly (ActionItem | false | null | undefined)[]; label?: string }) {
  const list = items.filter((x): x is ActionItem => Boolean(x))
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (!open) return
    refs.current.find((el) => el && !el.disabled)?.focus()
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (list.length === 0) return null

  const close = (focusTrigger: boolean) => {
    setOpen(false)
    if (focusTrigger) trigger.current?.focus()
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = refs.current.filter((el): el is HTMLButtonElement => Boolean(el && !el.disabled))
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault()
      close(e.key === 'Escape')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      enabled[(i + 1) % enabled.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      enabled[(i - 1 + enabled.length) % enabled.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      enabled[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      enabled[enabled.length - 1]?.focus()
    }
  }

  return (
    <div ref={wrap} className="relative inline-flex">
      <IconButton
        ref={trigger}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        icon={<MoreHorizontal className="size-5" strokeWidth={1.75} />}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onKey}
          className="absolute top-full right-0 z-40 mt-1 flex min-w-48 animate-pop-in flex-col rounded-xl border border-line bg-paper p-1 text-left shadow-float"
        >
          {list.map((item, i) => (
            <button
              key={item.key}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                close(false)
                item.onSelect()
              }}
              className={cx(
                'flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap disabled:opacity-50 [&>svg]:size-[18px]',
                item.danger ? 'text-danger hover:bg-danger-bg' : 'text-ink hover:bg-ice',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
