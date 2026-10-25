import type { BadgeTone } from '@/components/StatusBadge'
import type { AlertSeverity, AlertStatus } from '@/data/types'

export const SEVERITY_TONE: Record<AlertSeverity, BadgeTone> = {
  belgi: 'neutral',
  ogohlantirish: 'warn',
  jiddiy: 'danger',
}

export const STATUS_TONE: Record<AlertStatus, BadgeTone> = {
  yangi: 'danger',
  korildi: 'info',
  yopildi: 'ok',
}
