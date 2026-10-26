// O'z yozuvini tuzatish (RPC `correct_entry`, docs/audit-fixes.md D1): muallif — 30 daqiqa ichida,
// admin — istalgan vaqtda. Faqat bog'lanmagan kirim/chiqim yoki kirimga bog'lanmagan xarid.
import { toRepoError } from './errors'
import { getSupabase } from './supabaseClient'

export type CorrectableTable = 'movements' | 'purchases'

export interface EntryCorrection {
  table: CorrectableTable
  id: string
  /** Dec satr, kiritilgan birlikda; null — o'zgarmaydi. */
  qtyInput: string | null
  /** null — o'zgarmaydi. */
  unitId: string | null
  /** Faqat xaridda: Dec satr, so'm; null — o'zgarmaydi. */
  totalAmount?: string | null
  /** Tuzatish sababi (majburiy — UI tekshiradi). */
  note: string
}

export const CORRECTION_NOTE_MAX = 500

export async function correctEntry(input: EntryCorrection): Promise<void> {
  const { error } = await getSupabase().rpc('correct_entry', {
    p_table: input.table,
    p_id: input.id,
    p_qty_input: input.qtyInput,
    p_unit_id: input.unitId,
    p_total_amount: input.table === 'purchases' ? (input.totalAmount ?? null) : null,
    p_note: input.note.trim().slice(0, CORRECTION_NOTE_MAX),
  })
  if (error) throw toRepoError(error)
}
