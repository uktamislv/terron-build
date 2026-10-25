import type { ReactNode } from 'react'
import {
  Building2,
  ClipboardList,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  Package,
  ShoppingCart,
  TriangleAlert,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react'
import type { WebNavKey } from '@/domain/roles'

const p = { className: 'size-5 shrink-0', strokeWidth: 1.75, 'aria-hidden': true } as const

/** Yon menyu belgilari (Lucide, 20 px, chiziq 1.75). */
export const webNavIcons: Record<WebNavKey, ReactNode> = {
  dashboard: <LayoutDashboard {...p} />,
  materials: <Package {...p} />,
  movements: <Warehouse {...p} />,
  purchases: <ShoppingCart {...p} />,
  cash: <Wallet {...p} />,
  estimates: <FileSpreadsheet {...p} />,
  requests: <ClipboardList {...p} />,
  alerts: <TriangleAlert {...p} />,
  history: <History {...p} />,
  users: <Users {...p} />,
  objects: <Building2 {...p} />,
}
