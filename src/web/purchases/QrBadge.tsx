import { QrCode } from 'lucide-react'
import { Badge } from '@/components/ui'
import type { Purchase } from '@/data/types'
import { t } from '@/i18n'

const tp = t.purchases

/** Batch 12 (G): "QR tasdiqlangan" (soliq.uz) yoki faqat skanerlangan chek. QR yo'q — hech narsa. */
export function QrBadge({ p }: { p: Pick<Purchase, 'receipt_verified' | 'receipt_fiscal_sign'> }) {
  if (p.receipt_verified) {
    return (
      <Badge tone="ok" icon={<QrCode aria-hidden className="size-3.5" strokeWidth={2} />}>
        <span data-testid="qr-verified">{tp.qrVerified}</span>
      </Badge>
    )
  }
  if (p.receipt_fiscal_sign) {
    return (
      <Badge tone="neutral" icon={<QrCode aria-hidden className="size-3.5" strokeWidth={2} />}>
        {tp.qrScanned}
      </Badge>
    )
  }
  return null
}
