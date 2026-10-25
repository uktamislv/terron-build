import { useCallback, useSyncExternalStore } from 'react'

/** Telefon chegarasi (design-system: < 768 px). */
export const MOBILE_QUERY = '(max-width: 767px)'

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

/** CSS media so'rovi. `matchMedia` bo'lmasa (jsdom) — `false` (kompyuter ko'rinishi). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
      const mql = window.matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => matches(query),
    () => false,
  )
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}
