import { useCallback, useEffect, useState } from 'react'
import { errorText } from '@/i18n/errorText'

export interface Loaded<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/**
 * Oddiy yuklash: `key` o'zgarsa — qayta yuklanadi, eski javob tashlanadi. `enabled: false` — so'rov yo'q.
 * `load` har renderda yangi bo'lishi mumkin — faqat `key` hisobga olinadi.
 */
export function useLoad<T>(load: () => Promise<T>, key: string, enabled = true): Loaded<T> {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({
    key: '',
    data: null,
    error: null,
  })
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    if (!enabled) return
    let alive = true
    const full = `${key}#${version}`
    load()
      .then((data) => alive && setState({ key: full, data, error: null }))
      .catch((err: unknown) => alive && setState({ key: full, data: null, error: errorText(err) }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- faqat kalit bo'yicha
  }, [key, version, enabled])

  const current = state.key === `${key}#${version}`
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: enabled && !current,
    reload,
  }
}
