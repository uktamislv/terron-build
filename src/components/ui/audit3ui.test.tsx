// Audit 3 (umumiy UI, Mini App ehtiyojlari): chip kengligi, telefonda fokus qaytarish, BottomSheet va klaviatura.
import { render, screen } from '@testing-library/react'
import { BottomSheet } from './BottomSheet'
import { choiceClass } from './choiceClass'
import { shouldRestoreFocus } from './useOverlay'

describe('choiceClass — ma\'lumotdan kelgan uzun nom chip', () => {
  it('pill ota-ona kengligidan chiqmaydi (max-w-full, min-w-0) — ichidagi matn truncate bo\'la oladi', () => {
    const cls = choiceClass({ selected: false, size: 'md' }).split(' ')
    expect(cls).toContain('max-w-full')
    expect(cls).toContain('min-w-0')
    // whitespace-nowrap faqat max-w bilan birga (gorizontal aylantirish chizig'i chiqmasin)
    expect(cls.includes('whitespace-nowrap') ? cls.includes('max-w-full') : true).toBe(true)
  })
})

describe('shouldRestoreFocus — varaq yopilganda klaviatura qayta ochilmasin', () => {
  it('sensorli qurilmada matn maydoniga qaytarilmaydi; tugmaga — qaytariladi', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    const button = document.createElement('button')
    expect(shouldRestoreFocus(input, true)).toBe(false)
    expect(shouldRestoreFocus(textarea, true)).toBe(false)
    expect(shouldRestoreFocus(checkbox, true)).toBe(true)
    expect(shouldRestoreFocus(button, true)).toBe(true)
  })
  it('sichqonchali qurilmada — har doim qaytariladi (klaviatura bilan ishlash)', () => {
    expect(shouldRestoreFocus(document.createElement('input'), false)).toBe(true)
  })
})

describe('BottomSheet — iOS klaviatura va xavfsiz hudud', () => {
  it('ko\'rinadigan oyna balandligi CSS o\'zgaruvchisiga yoziladi va o\'zgarsa yangilanadi', () => {
    const listeners: Record<string, () => void> = {}
    const vv = {
      height: 700,
      width: 390,
      offsetTop: 0,
      addEventListener: (type: string, cb: () => void) => {
        listeners[type] = cb
      },
      removeEventListener: () => undefined,
    }
    const prev = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
    try {
      render(
        <BottomSheet title="Varaq" onClose={() => undefined}>
          <p>ichi</p>
        </BottomSheet>,
      )
      const root = screen.getByRole('dialog').parentElement as HTMLElement
      expect(root.style.getPropertyValue('--vv-h')).toBe('700px')
      vv.height = 380
      vv.offsetTop = 120
      listeners.resize?.()
      expect(root.style.getPropertyValue('--vv-h')).toBe('380px')
      expect(root.style.getPropertyValue('--vv-top')).toBe('120px')
      expect(screen.getByRole('dialog').className).toContain('var(--vv-h')
      // Pastki bo'shliq: iOS env() va Telegram --tg-safe-area-inset-bottom — kattasi
      expect(screen.getByText('ichi').parentElement?.className).toContain('var(--tg-safe-area-inset-bottom,0px)')
    } finally {
      if (prev) Object.defineProperty(window, 'visualViewport', prev)
      else delete (window as { visualViewport?: unknown }).visualViewport
    }
  })
})
