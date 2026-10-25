import { cx } from './cx'

/** Chip uslubi (filtr, tanlov). Tanlanganda — `ice` fon + `brand` matn. */
export function chipClass(active: boolean): string {
  return cx(
    'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors',
    active ? 'border-brand/30 bg-ice text-brand' : 'border-line bg-paper text-ink hover:border-[#c5d0e3]',
  )
}
