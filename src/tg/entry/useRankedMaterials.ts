import { useEffect, useMemo, useState } from 'react'
import type { Material } from '@/data/types'
import { getMyMaterialUsage } from '@/data/usageRepo'
import { rankMaterials, type UsageStat } from '@/domain/movements'

const USAGE_DAYS = 30

/**
 * Batch 12 (L): materiallar `my_material_usage` bo'yicha (kirim/chiqim ekranidagidek).
 * Statistika bo'lmasa — nom bo'yicha.
 */
export function useRankedMaterials(materials: Material[] | null): Material[] | null {
  const [usage, setUsage] = useState<UsageStat[]>([])
  const enabled = materials !== null
  useEffect(() => {
    if (!enabled) return
    let alive = true
    Promise.resolve()
      .then(() => getMyMaterialUsage(USAGE_DAYS))
      .then((rows) => {
        if (alive && Array.isArray(rows)) setUsage(rows)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [enabled])
  return useMemo(() => (materials ? rankMaterials(materials, usage, new Date().toISOString()) : null), [materials, usage])
}
