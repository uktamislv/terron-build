import { cx } from './cx'

/**
 * Input o'lchami:
 * - `md` — oddiy maydon (44 px, 16 px matn — iOS kattalashtirmasin);
 * - `lg` — Mini App matn maydoni (48 px);
 * - `hero` — katta raqam maydoni (miqdor, summa: 64 px, 40 px qalin raqam).
 */
export type InputSize = 'md' | 'lg' | 'hero'

const sizes: Record<InputSize, string> = {
  md: 'min-h-11 px-3 text-base placeholder:text-muted',
  lg: 'min-h-12 px-3 text-base placeholder:text-muted',
  hero: 'tabular min-h-16 px-4 text-hero leading-none font-bold placeholder:text-muted/40',
}

/**
 * Yagona input/textarea uslubi. Chegara — `line-strong` (3:1 kontrast), fokusda `brand` + halqa,
 * xato — `danger`. `textarea` uchun `multiline` — vertikal padding.
 */
export function inputClass({ size = 'md', error = false, multiline = false }: { size?: InputSize; error?: boolean; multiline?: boolean } = {}): string {
  return cx(
    'w-full rounded-xl border bg-paper text-ink outline-none transition-colors focus:border-brand focus:ring-3 focus:ring-brand/15 disabled:bg-canvas disabled:text-muted',
    sizes[size],
    multiline && 'py-2',
    error ? 'border-danger' : 'border-line-strong',
  )
}
