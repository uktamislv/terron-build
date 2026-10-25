import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
}

/**
 * Modal oyna / varaq / popover xatti-harakati: Esc bilan yopish, fokus tuzog'i (Tab aylanadi),
 * ochilganda fokus ichkariga, yopilganda — avvalgi elementga qaytadi. `lockScroll` — sahifa aylanmaydi.
 */
export function useOverlay(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  { trap = true, lockScroll = true }: { trap?: boolean; lockScroll?: boolean } = {},
) {
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const root = ref.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (root && !root.contains(document.activeElement)) {
      const first = root.querySelector<HTMLElement>('[data-autofocus]') ?? root
      first.focus({ preventScroll: true })
    }
    const onKey = (e: KeyboardEvent) => {
      // Ichma-ich oynalar: faqat eng ustidagi (oxirgi ochilgan) yopiladi
      if (e.defaultPrevented) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
        return
      }
      const node = ref.current
      if (!trap || e.key !== 'Tab' || !node) return
      const list = focusables(node)
      if (list.length === 0) {
        e.preventDefault()
        node.focus()
        return
      }
      const first = list[0]!
      const last = list[list.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === node || !node.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !node.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    // capture emas: ichki (keyinroq ochilgan) oyna o'z tinglovchisini oldinroq qo'shgan bo'lmaydi,
    // shuning uchun `stack` orqali faqat eng oxirgisi ishlaydi
    stack.push(onKey)
    const handler = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] === onKey) onKey(e)
    }
    document.addEventListener('keydown', handler)
    const prevOverflow = document.body.style.overflow
    if (lockScroll) document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      const i = stack.lastIndexOf(onKey)
      if (i >= 0) stack.splice(i, 1)
      if (lockScroll) document.body.style.overflow = prevOverflow
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [ref, trap, lockScroll])
}

const stack: ((e: KeyboardEvent) => void)[] = []
