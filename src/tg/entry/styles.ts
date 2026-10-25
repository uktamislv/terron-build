import { cx } from '@/components/ui'

/** Katta raqam maydoni klasslari (40 px raqam — qahramon). Kirim/chiqim, xarid, sanash uchun umumiy. */
export function bigInputClass(error: boolean): string {
  return cx(
    'tabular min-h-16 w-full rounded-xl border bg-paper px-4 text-[40px] leading-none font-bold text-ink outline-none placeholder:text-line focus:border-brand focus:ring-3 focus:ring-brand/15',
    error ? 'border-danger' : 'border-line',
  )
}

/** Oddiy matn maydoni (izoh, nom). */
export const textInputClass =
  'min-h-12 w-full rounded-xl border bg-paper px-3 text-base outline-none placeholder:text-muted/70 focus:border-brand focus:ring-3 focus:ring-brand/15'
