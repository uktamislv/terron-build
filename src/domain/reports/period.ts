// Hisobot davrlari — sof funksiyalar. Sanalar Toshkent kuni bo'yicha ISO `yyyy-mm-dd` satrlar;
// "bugun" har doim argument (`todayIso`) sifatida beriladi — `Date.now()` ishlatilmaydi.
// Ichki hisob UTC kun raqamlarida (vaqt zonasi va yozgi vaqtga bog'liq emas).

export type PeriodPreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth'

export const PERIOD_PRESETS: readonly PeriodPreset[] = ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'lastMonth']

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

/** ISO sana → 1970-01-01 dan beri kunlar soni; noto'g'ri sana (masalan 2026-02-30) → null. */
export function isoToDayNumber(iso: string): number | null {
  const m = ISO_RE.exec(iso)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1) return null
  const dt = new Date(0)
  dt.setUTCFullYear(y, mo - 1, d)
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return Math.round(dt.getTime() / MS_PER_DAY)
}

/** Kun raqami → ISO sana (yyyy-mm-dd). */
export function dayNumberToIso(day: number): string {
  const dt = new Date(day * MS_PER_DAY)
  const y = String(dt.getUTCFullYear()).padStart(4, '0')
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

function mustDay(iso: string): number {
  const n = isoToDayNumber(iso)
  if (n === null) throw new Error(`reports: noto'g'ri sana: ${JSON.stringify(iso)}`)
  return n
}

/** ISO sanaga `n` kun qo'shadi (manfiy ham bo'ladi). */
export function addDays(iso: string, n: number): string {
  return dayNumberToIso(mustDay(iso) + n)
}

/** `to − from` kunlarda (bir kun → 0, ketma-ket kunlar → 1). Noto'g'ri sana → xato. */
export function daysBetween(from: string, to: string): number {
  return mustDay(to) - mustDay(from)
}

/**
 * Tayyor davr chegaralari (ikkalasi ham kiradi). `last7` — bugun va oldingi 6 kun,
 * `last30` — bugun va oldingi 29 kun, `thisMonth` — oy boshidan bugungacha,
 * `lastMonth` — o'tgan oyning to'liq kunlari. Noto'g'ri `todayIso` → xato.
 */
export function periodRange(preset: PeriodPreset, todayIso: string): { from: string; to: string } {
  const today = mustDay(todayIso)
  switch (preset) {
    case 'today':
      return { from: todayIso, to: todayIso }
    case 'yesterday': {
      const y = dayNumberToIso(today - 1)
      return { from: y, to: y }
    }
    case 'last7':
      return { from: dayNumberToIso(today - 6), to: todayIso }
    case 'last30':
      return { from: dayNumberToIso(today - 29), to: todayIso }
    case 'thisMonth':
      return { from: `${todayIso.slice(0, 7)}-01`, to: todayIso }
    case 'lastMonth': {
      const lastPrev = dayNumberToIso(mustDay(`${todayIso.slice(0, 7)}-01`) - 1)
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev }
    }
  }
}

/**
 * Ixtiyoriy davrni tekshiradi. `maxDays` — kunlar soni (ikkala chegara ham kiradi):
 * 366 kunlik davr — 'ok', 367 — 'too_long'.
 */
export function validateRange(from: string, to: string, maxDays = 366): 'ok' | 'invalid' | 'reversed' | 'too_long' {
  const a = isoToDayNumber(from)
  const b = isoToDayNumber(to)
  if (a === null || b === null) return 'invalid'
  if (a > b) return 'reversed'
  if (b - a + 1 > maxDays) return 'too_long'
  return 'ok'
}
