import { useEffect, useState } from 'react'

/** Joriy vaqt (ISO), har `intervalMs` da yangilanadi — sanoq (masalan tuzatish oynasi) uchun. */
export function useNow(intervalMs = 15_000, enabled = true): string {
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(new Date().toISOString()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, enabled])
  return now
}
