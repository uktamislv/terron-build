import type { InventoryStatus, RequestStatus, TransferStatus } from '@/data/types'
import type { BadgeTone } from '@/components/ui'

// Reja holatlari (so'rov, o'tkazma, sanash) — muammo emas: `info` / `ok` / `neutral`.
// `warn` va `danger` faqat ogohlantirishlar (alerts) uchun (docs/design-system.md, "Holat semantikasi").

export const REQUEST_TONE: Record<RequestStatus, BadgeTone> = {
  kutilmoqda: 'info',
  tasdiqlandi: 'info',
  rad: 'neutral',
  xarid_qilindi: 'ok',
}

export const TRANSFER_TONE: Record<TransferStatus, BadgeTone> = {
  yuborildi: 'info',
  qabul_qilindi: 'ok',
  bekor: 'neutral',
}

export const INVENTORY_TONE: Record<InventoryStatus, BadgeTone> = {
  draft: 'neutral',
  submitted: 'info',
}
