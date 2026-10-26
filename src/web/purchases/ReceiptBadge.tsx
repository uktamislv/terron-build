import { CircleAlert, CircleCheck, Clock } from 'lucide-react'
import { Badge, LevelBar } from '@/components/ui'
import type { Purchase } from '@/data/types'
import { t } from '@/i18n'
import { formatQty } from '@/lib/format'
import { RECEIPT_TONE, receiptState } from './receiptStatus'

const tp = t.purchases
const ic = { strokeWidth: 2, 'aria-hidden': true } as const

/** Qabul holati: belgi ("To'liq") va ostida alohida qatorda "150 / 150 kg" — rang `evaluateReceipt` bo'yicha. `level` — daraja chizig'i. */
export function ReceiptBadge({
  p,
  thresholdPct,
  nowIso,
  level = false,
}: {
  p: Purchase
  thresholdPct: string
  nowIso: string
  level?: boolean
}) {
  const state = receiptState(p, thresholdPct, nowIso)
  const tone = RECEIPT_TONE[state]
  if (!tone || !p.receipt) return <span className="text-muted">—</span>
  const icon = tone === 'ok' ? <CircleCheck {...ic} /> : tone === 'warn' ? <Clock {...ic} /> : <CircleAlert {...ic} />
  // Faqat ko'rsatish uchun (hisob-kitob domain'da)
  const received = Number(p.receipt.received_qty_base)
  const purchased = Number(p.qty_base)
  return (
    <span data-testid="receipt-badge" data-state={state} className="inline-flex min-w-40 flex-col gap-1.5">
      <Badge tone={tone} icon={icon} className="self-start">
        {tp.receiptStatus[state]}
      </Badge>
      <span className="tabular text-xs text-muted">
        {tp.receivedOf(formatQty(p.receipt.received_qty_base), formatQty(p.qty_base), p.base_unit ?? '')}
      </span>
      {level && purchased > 0 && <LevelBar label={tp.receivedLevel} value={received} max={purchased} warnAt={2} showPercent={false} />}
    </span>
  )
}
