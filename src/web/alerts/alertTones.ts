import type { BadgeTone, EntryKind } from '@/components/ui'
import type { AlertSeverity, AlertStatus } from '@/data/types'

export const SEVERITY_TONE: Record<AlertSeverity, BadgeTone> = {
  belgi: 'neutral',
  ogohlantirish: 'warn',
  jiddiy: 'danger',
}

export const STATUS_TONE: Record<AlertStatus, BadgeTone> = {
  // Holat — jarayon (yangi/ko'rildi), xavf darajasi emas: qizil faqat jiddiylik uchun
  yangi: 'info',
  korildi: 'neutral',
  yopildi: 'ok',
}

/** Jiddiylik → kartochkaning chap chizig'i va belgi rangi. */
export const SEVERITY_ENTRY_KIND: Record<AlertSeverity, EntryKind> = {
  belgi: 'neutral',
  ogohlantirish: 'warn',
  jiddiy: 'danger',
}
