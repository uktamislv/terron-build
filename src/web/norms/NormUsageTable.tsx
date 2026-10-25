import { useEffect, useMemo, useState } from 'react'
import { Gauge } from 'lucide-react'
import { Badge, EmptyState, Qty, RetryNotice, Spinner } from '@/components/ui'
import { listMaterials } from '@/data/materialsRepo'
import { listNormUsage } from '@/data/normsRepo'
import type { Material, NormUsage } from '@/data/types'
import { isNegative } from '@/domain/decimal'
import { evaluateNorm, usagePct, type NormStatus } from '@/domain/norms'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { ExportButton } from '../ExportButton'
import { normsSheet } from '../exports'
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

  const qty = (v: string, unit: string, danger = false) => <Qty value={v} unit={unit} size="sm" tone={danger ? 'danger' : undefined} />
  const th = 'sticky top-0 border-b border-line bg-canvas px-3 py-2.5 text-xs font-semibold whitespace-nowrap text-muted first:pl-4 last:pr-4'

  return (
    <section aria-label={tn.title} className="flex flex-col rounded-2xl border border-line bg-paper">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 md:px-5">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-ice text-brand">
            <Gauge className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="text-base font-semibold text-ink md:text-lg">{tn.title}</h2>
            <p className="text-sm text-muted">{tn.hint}</p>
          </div>
        </div>
        {view.length > 0 && (
          <ExportButton
            run={(signal) =>
              exportWorkbook({ fileName: exportFileName(t.excel.sections.norms), sheets: [normsSheet(view)], signal })
            }
          />
        )}
      </div>
      <div className="flex flex-col gap-3 p-4 md:p-5">
        {error && <RetryNotice message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
        {!rows && !error && <Spinner />}
        {rows && view.length === 0 && <EmptyState compact icon={<Gauge strokeWidth={1.5} />} title={tn.empty} />}
        {view.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className={`${th} text-left`}>
                    {tn.colMaterial}
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    {tn.colNorm}
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    {tn.colAllowed}
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    {tn.colConsumed}
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    {tn.colRemaining}
                  </th>
                  <th scope="col" className={`${th} min-w-40 text-left`}>
                    {tn.colUsage}
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.map((r) => {
                  const bad = r.status !== 'ok'
                  return (
                    <tr
                      key={r.material_id}
                      data-testid="norm-row"
                      data-status={r.status}
                      className="border-b border-line/70 transition-colors last:border-0 hover:bg-ice/35"
                    >
                      <td className="px-3 py-2.5 pl-4">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={`font-medium ${bad ? 'text-danger' : 'text-ink'}`}>{r.name}</span>
                          {r.status === 'over' && <Badge tone="danger">{tn.over}</Badge>}
                          {r.status === 'not_in_estimate' && <Badge tone="warn">{tn.notInEstimate}</Badge>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">{qty(r.norm_qty_base, r.unit)}</td>
                      <td className="px-3 py-2.5 text-right">{qty(r.allowed_qty_base, r.unit)}</td>
                      <td className="px-3 py-2.5 text-right">{qty(r.consumed_qty_base, r.unit, bad)}</td>
                      <td className="px-3 py-2.5 text-right">{qty(r.remaining_qty_base, r.unit, isNegative(r.remaining_qty_base))}</td>
                      <td className="px-3 py-2.5 pr-4">
                        <NormProgress pct={r.usage_pct ?? usagePct(r.consumed_qty_base, r.allowed_qty_base)} label={r.name} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
