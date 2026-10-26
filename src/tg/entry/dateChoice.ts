// "Bugun / Kecha / Boshqa sana" chiplari qiymati (komponent — DateChips.tsx).
import type { EntryDateChoice } from '@/domain/entryDate'

export interface DateChipsValue {
  choice: EntryDateChoice
  /** "Boshqa sana" tanlansa — `yyyy-mm-dd` yoki ''. */
  other: string
}

export const TODAY_CHOICE: DateChipsValue = { choice: 'today', other: '' }
