import { useEffect, useState } from 'react'
import { listMaterials } from '@/data/materialsRepo'
import { listObjects } from '@/data/objectsRepo'
import type { Material, ObjectRow } from '@/data/types'
import { errorText } from '@/i18n/errorText'

export interface EntryData {
  /** Faol obyektlar (o'z firmasi; prorab/omborchi — RLS bo'yicha a'zo bo'lganlari). */
  objects: ObjectRow[] | null
  /** Faol materiallar (o'z firmasi). */
  materials: Material[] | null
  error: string | null
  reload: () => void
}

/** Mini App formalari uchun obyekt va materiallar (super_admin ham faqat o'z firmasida ishlaydi). */
export function useEntryData(companyId: string | undefined): EntryData {
  const [objects, setObjects] = useState<ObjectRow[] | null>(null)
  const [materials, setMaterials] = useState<Material[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!companyId) return
    let alive = true
    Promise.all([listObjects(), listMaterials()])
      .then(([objs, mats]) => {
        if (!alive) return
        setObjects(objs.filter((o) => o.status === 'faol' && o.company_id === companyId))
        setMaterials(mats.filter((m) => m.is_active && m.company_id === companyId))
        setError(null)
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err))
      })
    return () => {
      alive = false
    }
  }, [companyId, reloadKey])

  return { objects, materials, error, reload: () => setReloadKey((k) => k + 1) }
}
