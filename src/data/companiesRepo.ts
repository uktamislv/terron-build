import { toRepoError } from './errors'
import { getSupabase } from './supabaseClient'

/** Firma sozlamalari — farq qoidalari chegaralari (foizlar `numeric` → satr). */
export interface CompanySettings {
  receiptMismatchPct: string
  priceDeviationPct: string
  priceAvgWindow: number
}

/** Bazadagi standart qiymatlar (sozlama o'qilmasa — UI ogohlantirishi shular bilan). */
export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  receiptMismatchPct: '2',
  priceDeviationPct: '8',
  priceAvgWindow: 5,
}

export async function getCompanySettings(companyId: string): Promise<CompanySettings> {
  const { data, error } = await getSupabase()
    .from('companies')
    .select('receipt_mismatch_pct::text, price_deviation_pct::text, price_avg_window')
    .eq('id', companyId)
    .single()
  if (error) throw toRepoError(error)
  const row = data as unknown as { receipt_mismatch_pct: string; price_deviation_pct: string; price_avg_window: number }
  return {
    receiptMismatchPct: row.receipt_mismatch_pct,
    priceDeviationPct: row.price_deviation_pct,
    priceAvgWindow: Number(row.price_avg_window),
  }
}
