// O'z yozuvini tuzatish (RPC `correct_entry`, docs/audit-fixes.md D1): muallif — 30 daqiqa ichida,
// admin — istalgan vaqtda. Faqat bog'lanmagan kirim/chiqim yoki kirimga bog'lanmagan xarid.
// O'z yozuvini bekor qilish (RPC `cancel_own_entry`) — xuddi shu 30 daqiqalik oynada, sabab majburiy.
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
  /** Tuzatish sababi (majburiy — UI tekshiradi). Audit va direktor xabariga boradi. */
  reason: string
  /** Yozuv izohi: null — eski izoh qoladi; '' — izoh o'chiriladi. */
  note?: string | null
  /** Muallif (30 daqiqa): boshqa material — birlik shu materialniki bo'lishi shart; null — o'zgarmaydi. */
  materialId?: string | null
  /** Muallif (30 daqiqa): boshqa obyekt; null — o'zgarmaydi. */
  objectId?: string | null
}

export const CORRECTION_NOTE_MAX = 500

function clip(v: string): string {
  return v.trim().slice(0, CORRECTION_NOTE_MAX)
}

export async function correctEntry(input: EntryCorrection): Promise<void> {
  const { error } = await getSupabase().rpc('correct_entry', {
    p_table: input.table,
    p_id: input.id,
    p_qty_input: input.qtyInput,
    p_unit_id: input.unitId,
    p_total_amount: input.table === 'purchases' ? (input.totalAmount ?? null) : null,
    p_reason: clip(input.reason),
    p_note: input.note == null ? null : clip(input.note),
    p_material_id: input.materialId ?? null,
    p_object_id: input.objectId ?? null,
  })
  if (error) throw toRepoError(error)
}

/** Muallif: o'z yozuvini 30 daqiqa ichida bekor qilish (soft delete), sabab majburiy. */
export async function cancelOwnEntry(table: CorrectableTable, id: string, reason: string): Promise<void> {
  const { error } = await getSupabase().rpc('cancel_own_entry', { p_table: table, p_id: id, p_reason: clip(reason) })
  if (error) throw toRepoError(error)
}
