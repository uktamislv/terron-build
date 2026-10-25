import type { ReactNode } from 'react'
import type { Role } from '@/domain/roles'

/**
 * Ko'rgazma ekrani (faqat DEV, /__preview). `render` — haqiqiy sahifaning taqdimot komponentlari
 * fixture ma'lumot bilan (repo chaqirilmaydi).
 */
export interface PreviewView {
  /** URL qiymati: /__preview?view=<id> */
  id: string
  title: string
  /** web — WebLayout ichida, tg — TgLayout ichida. */
  surface: 'web' | 'tg'
  /** Layout'dagi menyu va foydalanuvchi bloki shu rol bilan. */
  role: Role
  render: () => ReactNode
}
