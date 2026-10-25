import { StatusBadge } from '@/components/StatusBadge'
import type { Purchase } from '@/data/types'
import { t } from '@/i18n'
import { formatQty } from '@/lib/format'
import { RECEIPT_TONE, receiptState } from './receiptStatus'

const tp = t.purchases

/** Qabul holati: "To'liq · 150 / 150 kg" — rang `evaluateReceipt` bo'yicha. */
export function ReceiptBadge({ p, thresholdPct, nowIso }: { p: Purchase; thresholdPct: string; nowIso: string }) {
  const state = receiptState(p, thresholdPct, nowIso)
  const tone = RECEIPT_TONE[state]
  if (!tone || !p.receipt) return <span className="text-slate-400">—</span>
  return (
    <span data-testid="receipt-badge" data-state={state}>
      <StatusBadge tone={tone}>
        {tp.receiptStatus[state]} ·{' '}
        {tp.receivedOf(formatQty(p.receipt.received_qty_base), formatQty(p.qty_base), p.base_unit ?? '')}
      </StatusBadge>
    </span>
  )
}
