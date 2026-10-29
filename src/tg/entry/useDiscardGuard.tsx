// To'ldirilgan formani tasodifan tashlab ketmaslik: pastki menyu / sarlavha havolasi orqali boshqa
// bo'limga o'tish (router `useBlocker`) yoki ekran ichidagi bo'lim almashtirish ("So'rov | O'tkazma",
// "Material | Xarajat") — avval tasdiq varag'i. Bitta sahifada bitta chaqiriladi (router bitta blocker).
import { useCallback, useState, type ReactNode } from 'react'
import { useBlocker } from 'react-router'
import { BottomSheet, Button } from '@/components/ui'
import { t } from '@/i18n'
import { haptic } from '../telegram'

const td = t.tg.discard

/**
 * `dirty` — formada foydalanuvchi kiritgan ma'lumot bor. `guard(action)` — ekran ichidagi almashtirish:
 * toza bo'lsa darhol, aks holda tasdiqdan keyin. `element` — tasdiq varag'i (sahifada chizish kerak).
 */
export function useDiscardGuard(dirty: boolean): { guard: (action: () => void) => void; element: ReactNode } {
  // Faqat boshqa yo'lga o'tish (?transfer= kabi parametr o'zgarishi — emas)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  const [pending, setPending] = useState<{ run: () => void } | null>(null)

  const guard = useCallback(
    (action: () => void) => {
      if (!dirty) {
        action()
        return
      }
      haptic.error()
      setPending({ run: action })
    },
    [dirty],
  )

  const blocked = blocker.state === 'blocked'
  const stay = () => {
    if (blocker.state === 'blocked') blocker.reset()
    setPending(null)
  }
  const leave = () => {
    haptic.tap()
    if (blocker.state === 'blocked') {
      blocker.proceed()
      return
    }
    const action = pending
    setPending(null)
    action?.run()
  }

  const element =
    blocked || pending ? (
      <BottomSheet
        title={td.title}
        onClose={stay}
        footer={
          <>
            <Button variant="secondary" size="lg" className="flex-1" onClick={stay}>
              {td.stay}
            </Button>
            <Button variant="danger" size="lg" className="flex-1" onClick={leave}>
              {td.leave}
            </Button>
          </>
        }
      >
        <p data-testid="discard-confirm" className="px-2 pb-2 text-base text-ink">
          {td.text}
        </p>
      </BottomSheet>
    ) : null

  return { guard, element }
}
