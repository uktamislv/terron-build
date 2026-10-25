import {
  ArrowLeftRight,
  ClipboardList,
  FileDiff,
  Gauge,
  PackageX,
  Scale,
  TrendingUp,
  Trash2,
  UserCheck,
} from 'lucide-react'
import type { AlertType } from '@/data/types'

const p = { className: 'size-[18px]', strokeWidth: 1.75, 'aria-hidden': true } as const

/** Ogohlantirish turi belgisi. */
export function AlertTypeIcon({ type }: { type: AlertType }) {
  switch (type) {
    case 'xarid_qabul_farqi':
      return <Scale {...p} />
    case 'ozi_qabul_qilgan':
      return <UserCheck {...p} />
    case 'narx_ogishi':
      return <TrendingUp {...p} />
    case 'normadan_oshish':
      return <Gauge {...p} />
    case 'inventarizatsiya_kamomadi':
      return <PackageX {...p} />
    case 'smetadan_ortiq_sorov':
      return <ClipboardList {...p} />
    case 'yozuv_ochirildi':
      return <Trash2 {...p} />
    case 'smeta_ozgarishi':
      return <FileDiff {...p} />
    case 'otkazma_farqi':
      return <ArrowLeftRight {...p} />
  }
}
