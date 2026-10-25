import type { InventoryStatus, RequestStatus, TransferStatus } from '@/data/types'
import type { BadgeTone } from './StatusBadge'

export const REQUEST_TONE: Record<RequestStatus, BadgeTone> = {
  kutilmoqda: 'warn',
  tasdiqlandi: 'info',
  rad: 'danger',
  xarid_qilindi: 'ok',
}

export const TRANSFER_TONE: Record<TransferStatus, BadgeTone> = {
  yuborildi: 'warn',
  qabul_qilindi: 'ok',
  bekor: 'neutral',
}

export const INVENTORY_TONE: Record<InventoryStatus, BadgeTone> = {
  draft: 'neutral',
  submitted: 'info',
}
