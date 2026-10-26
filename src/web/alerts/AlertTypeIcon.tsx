import {
  ArchiveRestore,
  BadgeAlert,
  FilePen,
  KeyRound,
  PencilLine,
  SlidersHorizontal,
  WalletCards,
  ArrowLeftRight,
  ClipboardList,
  CopyX,
  FileDiff,
  FileQuestion,
  Gauge,
  HandCoins,
  MapPinOff,
  MinusCircle,
  PackageSearch,
  PackageX,
  ReceiptText,
  Scale,
  ShoppingBasket,
  TimerOff,
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
    case 'yozuv_tiklandi':
      return <ArchiveRestore {...p} />
    case 'kirim_manbasiz':
      return <PackageSearch {...p} />
    case 'manfiy_qoldiq':
      return <MinusCircle {...p} />
    case 'takroriy_yozuv':
      return <CopyX {...p} />
    case 'joylashuv_farqi':
      return <MapPinOff {...p} />
    case 'smetasiz_chiqim':
      return <FileQuestion {...p} />
    case 'chek_farqi':
      return <ReceiptText {...p} />
    case 'sorovdan_ortiq_xarid':
      return <ShoppingBasket {...p} />
    case 'podotchet_muddati':
      return <TimerOff {...p} />
    case 'podotchet_manfiy':
      return <HandCoins {...p} />
    case 'yozuv_ozgartirildi':
      return <FilePen {...p} />
    case 'yozuv_tuzatildi':
      return <PencilLine {...p} />
    case 'sozlama_ozgardi':
      return <SlidersHorizontal {...p} />
    case 'login_ozgardi':
      return <KeyRound {...p} />
    case 'podotchet_belgisi':
      return <WalletCards {...p} />
    case 'sotuvchi_stir_farqi':
      return <BadgeAlert {...p} />
  }
}
