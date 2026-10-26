import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowLeftRight, ClipboardCheck, List, Package, Warehouse } from 'lucide-react'
import { useAuth } from '@/auth/authContext'
import { Notice, PageHeader, Tabs, type TabItem } from '@/components/ui'
import { listMaterials } from '@/data/materialsRepo'
import { listObjects } from '@/data/objectsRepo'
import { listDirectory } from '@/data/profileDirectory'
import type { Material, ObjectRow, PersonRef } from '@/data/types'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { MovementsTab } from '../movements/MovementsTab'
import { InventoryTab } from '../movements/InventoryTab'
import { StockTab } from '../movements/StockTab'
import { TransfersTab } from '../movements/TransfersTab'
import { initialMovementFilters } from '../movements/movementFilters'
import { paramOneOf } from '../urlFilters'

const to = t.ombor
export type OmborTab = 'movements' | 'stock' | 'transfers' | 'inventory'
const TABS: readonly OmborTab[] = ['movements', 'stock', 'transfers', 'inventory']
const ic = { strokeWidth: 1.75, 'aria-hidden': true } as const

const OMBOR_TABS: readonly TabItem<OmborTab>[] = [
  { key: 'movements', label: to.tabMovements, icon: <List {...ic} /> },
  { key: 'stock', label: to.tabStock, icon: <Package {...ic} /> },
  { key: 'transfers', label: to.tabTransfers, icon: <ArrowLeftRight {...ic} /> },
  { key: 'inventory', label: to.tabInventory, icon: <ClipboardCheck {...ic} /> },
]

/** Ombor sahifasi qobig'i: sarlavha va bo'limlar (ko'rgazmada ham ishlatiladi). */
export function OmborShell({ tab, onTab, children }: { tab: OmborTab; onTab: (tab: OmborTab) => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={to.title} icon={<Warehouse strokeWidth={1.75} />} />
      <Tabs label={to.title} items={OMBOR_TABS} value={tab} onChange={onTab} />
      {children}
    </div>
  )
}

/** Ombor: harakatlar jadvali va qoldiq. Ko'rinish RLS bilan cheklanadi. */
export function MovementsPage() {
  const { profile: me } = useAuth()
  const [params] = useSearchParams()
  // Bosh sahifa havolalari: ?tab=transfers, ?type=kirim&from=...&to=...&object=...
  const [tab, setTab] = useState<OmborTab>(() => paramOneOf(params, 'tab', TABS, 'movements') || 'movements')
  const [initialFilters] = useState(() => initialMovementFilters(params))
  const [objects, setObjects] = useState<ObjectRow[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [profiles, setProfiles] = useState<PersonRef[]>([])
  const [refError, setRefError] = useState<string | null>(null)

  // Filtrlar uchun ro'yxatlar; xato bo'lsa ham jadvallar ishlaydi
  useEffect(() => {
    let alive = true
    listObjects()
      .then((list) => alive && setObjects(list))
      .catch((err: unknown) => alive && setRefError(errorText(err)))
    listMaterials()
      .then((list) => alive && setMaterials(list))
      .catch((err: unknown) => alive && setRefError(errorText(err)))
    listDirectory()
      .then((list) => alive && setProfiles(list))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  if (!me) return null
  // O'chirish va tiklash — faqat admin (movements_update RLS)
  const isAdmin = can(me.role, 'restore_records')

  return (
    <OmborShell tab={tab} onTab={setTab}>
      {refError && <Notice>{refError}</Notice>}
      {tab === 'transfers' && <TransfersTab objects={objects} canManage={can(me.role, 'manage_transfers')} />}
      {tab === 'inventory' && <InventoryTab objects={objects} canApply={can(me.role, 'apply_inventory')} />}
      {tab === 'movements' && (
        <MovementsTab
          objects={objects}
          materials={materials}
          profiles={profiles}
          initial={initialFilters}
          isAdmin={isAdmin}
          canSeeDeleted={isAdmin || me.role === 'direktor'}
        />
      )}
      {tab === 'stock' && <StockTab objects={objects} materials={materials} />}
    </OmborShell>
  )
}
