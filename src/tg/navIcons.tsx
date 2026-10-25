import type { ReactNode } from 'react'
import { ArrowDownUp, ClipboardCheck, ClipboardList, House, ListChecks, ShoppingCart } from 'lucide-react'
import type { TgNavKey } from '@/domain/roles'

const p = { className: 'size-6', strokeWidth: 1.75, 'aria-hidden': true } as const

/** Mini App pastki menyu belgilari. */
export const tgNavIcons: Record<TgNavKey, ReactNode> = {
  home: <House {...p} />,
  movement: <ArrowDownUp {...p} />,
  purchase: <ShoppingCart {...p} />,
  request: <ClipboardList {...p} />,
  inventory: <ClipboardCheck {...p} />,
  mine: <ListChecks {...p} />,
}
