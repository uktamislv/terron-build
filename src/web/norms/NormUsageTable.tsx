import { useEffect, useMemo, useState } from 'react'
import { StatusBadge } from '@/components/StatusBadge'
import { Spinner } from '@/components/ui'
import { listMaterials } from '@/data/materialsRepo'
import { listNormUsage } from '@/data/normsRepo'
import type { Material, NormUsage } from '@/data/types'
import { isNegative } from '@/domain/decimal'
import { evaluateNorm, usagePct, type NormStatus } from '@/domain/norms'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatQty } from '@/lib/format'
import { RetryNotice } from '../fields'
import { NormProgress } from './NormProgress'

const tn = t.norms

interface Row extends NormUsage {
  name: string
  unit: string
  status: NormStatus
}

const ORDER: Record<NormStatus, number> = { over: 0, not_in_estimate: 1, ok: 2 }

/** Obyekt bo'yicha "Sarf va norma": norma, isrof bilan, sarf, qolgan, foiz; oshganlar qizil va birinchi. */
export function NormUsageTable({ objectId }: { objectId: string }) {
  const [rows, setRows] = useState<NormUsage[] | null>(null)
  const [materials, setMaterials] = useState<Material[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    Promise.all([listNormUsage({ objectId }), Promise.resolve(listMaterials()).catch(() => [] as Material[])])
      .then(([norms, mats]) => {
        if (!alive) return
        setRows(norms)
        setMaterials(mats ?? [])
        setError(null)
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    return () => {
      alive = false
    }
  }, [objectId, reloadKey])

  const view = useMemo<Row[]>(() => {
    const byId = new Map(materials.map((m) => [m.id, m]))
    return (rows ?? [])
      .map((r) => {
        const m = byId.get(r.material_id)
        const status = evaluateNorm({
          normQtyBase: r.norm_qty_base,
          wastePct: m?.waste_pct ?? '0',
          consumedQtyBase: r.consumed_qty_base,
        }).status
        return { ...r, name: m?.name ?? '—', unit: m?.base_unit ?? '', status }
      })
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name))
  }, [rows, materials])

  return (
    <section aria-label={tn.title} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <h2 className="font-semibold text-slate-900">{tn.title}</h2>
        <p className="text-sm text-slate-600">{tn.hint}</p>
      </div>
      {error && <RetryNotice message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
      {!rows && !error && <Spinner />}
      {rows && view.length === 0 && <p className="text-sm text-slate-600">{tn.empty}</p>}
      {view.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">{tn.colMaterial}</th>
                <th className="px-3 py-2 text-right font-medium">{tn.colNorm}</th>
                <th className="px-3 py-2 text-right font-medium">{tn.colAllowed}</th>
                <th className="px-3 py-2 text-right font-medium">{tn.colConsumed}</th>
                <th className="px-3 py-2 text-right font-medium">{tn.colRemaining}</th>
                <th className="px-3 py-2 font-medium">{tn.colUsage}</th>
              </tr>
            </thead>
            <tbody>
              {view.map((r) => {
                const bad = r.status !== 'ok'
                return (
                  <tr key={r.material_id} data-testid="norm-row" data-status={r.status} className="border-t border-slate-100">
                    <td className={`px-3 py-2 font-medium ${bad ? 'text-danger' : ''}`}>
                      {r.name}
                      {r.status === 'over' && (
                        <span className="ml-2">
                          <StatusBadge tone="danger">{tn.over}</StatusBadge>
                        </span>
                      )}
                      {r.status === 'not_in_estimate' && (
                        <span className="ml-2">
                          <StatusBadge tone="warn">{tn.notInEstimate}</StatusBadge>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {formatQty(r.norm_qty_base)} {r.unit}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {formatQty(r.allowed_qty_base)} {r.unit}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right ${bad ? 'font-semibold text-danger' : ''}`}>
                      {formatQty(r.consumed_qty_base)} {r.unit}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 text-right ${isNegative(r.remaining_qty_base) ? 'font-semibold text-danger' : ''}`}
                    >
                      {formatQty(r.remaining_qty_base)} {r.unit}
                    </td>
                    <td className="px-3 py-2">
                      <NormProgress pct={r.usage_pct ?? usagePct(r.consumed_qty_base, r.allowed_qty_base)} label={r.name} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
