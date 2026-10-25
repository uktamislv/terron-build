import { useEffect, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { Notice } from '@/components/ui'
import { listMaterials } from '@/data/materialsRepo'
import { listObjects } from '@/data/objectsRepo'
import { listProfiles } from '@/data/profilesRepo'
import type { Material, ObjectRow, Profile } from '@/data/types'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { MovementsTab } from '../movements/MovementsTab'
import { StockTab } from '../movements/StockTab'

const to = t.ombor
type Tab = 'movements' | 'stock'

/** Ombor: harakatlar jadvali va qoldiq. Ko'rinish RLS bilan cheklanadi. */
export function MovementsPage() {
  const { profile: me } = useAuth()
  const [tab, setTab] = useState<Tab>('movements')
  const [objects, setObjects] = useState<ObjectRow[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
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
    listProfiles()
      .then((list) => alive && setProfiles(list))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  if (!me) return null
  const isAdmin = me.role === 'admin' || me.role === 'super_admin'
  const tabs: { key: Tab; label: string }[] = [
    { key: 'movements', label: to.tabMovements },
    { key: 'stock', label: to.tabStock },
  ]

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <h1 className="text-2xl font-bold text-brand-dark">{to.title}</h1>
      <div role="tablist" aria-label={to.title} className="grid max-w-sm grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        {tabs.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={tab === x.key}
            onClick={() => setTab(x.key)}
            className={`min-h-11 rounded-lg px-3 text-sm font-medium ${
              tab === x.key ? 'bg-white text-brand shadow-sm' : 'text-slate-600'
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {refError && <Notice>{refError}</Notice>}
      {tab === 'movements' ? (
        <MovementsTab
          objects={objects}
          materials={materials}
          profiles={profiles}
          isAdmin={isAdmin}
          canSeeDeleted={isAdmin || me.role === 'direktor'}
        />
      ) : (
        <StockTab objects={objects} materials={materials} />
      )}
    </div>
  )
}
