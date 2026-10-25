import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Notice, Spinner } from '@/components/ui'
import { listAllStock, listStock } from '@/data/stockRepo'
import type { Material, ObjectRow, StockBalance } from '@/data/types'
import { isNegative } from '@/domain/decimal'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { formatDateTime, formatQty } from '@/lib/format'
import { ExportButton } from '../ExportButton'
import { stockSheet } from '../exports'

const to = t.ombor

interface StockRow extends StockBalance {
  objectName: string
  materialName: string
  baseUnit: string
  negative: boolean
}

function nameStock(rows: StockBalance[], objects: ObjectRow[], materials: Material[]): StockRow[] {
  const objName = new Map(objects.map((o) => [o.id, o.name]))
  const mat = new Map(materials.map((m) => [m.id, m]))
  return rows
    .map((r) => ({
      ...r,
      objectName: objName.get(r.object_id) ?? '—',
      materialName: mat.get(r.material_id)?.name ?? '—',
      baseUnit: mat.get(r.material_id)?.base_unit ?? '',
      negative: isNegative(r.qty_base),
    }))
    .sort((a, b) => a.objectName.localeCompare(b.objectName) || a.materialName.localeCompare(b.materialName))
}

export function StockTab({ objects, materials }: { objects: ObjectRow[]; materials: Material[] }) {
  const selectId = useId()
  const [objectId, setObjectId] = useState('')
  const [rows, setRows] = useState<StockBalance[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    listStock({ objectId: objectId || undefined })
      .then((list) => {
        if (!alive) return
        setRows(list)
        setError(null)
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err))
      })
    return () => {
      alive = false
    }
  }, [objectId, reloadKey])

  const view = useMemo<StockRow[]>(() => nameStock(rows ?? [], objects, materials), [rows, objects, materials])

  const runExport = async (signal: AbortSignal) => {
    const all = await listAllStock({ objectId: objectId || undefined }, signal)
    await exportWorkbook({
      fileName: exportFileName(t.excel.sections.stock),
      sheets: [stockSheet(nameStock(all, objects, materials))],
      signal,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full flex-col gap-1.5 rounded-2xl border border-slate-200 bg-white p-4 sm:max-w-sm">
          <label htmlFor={selectId} className="text-sm font-medium text-slate-700">
            {to.filterObject}
          </label>
          <select
            id={selectId}
            value={objectId}
            onChange={(e) => setObjectId(e.target.value)}
            className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base"
          >
            <option value="">{to.all}</option>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <ExportButton run={runExport} />
      </div>

      {error && (
        <Notice>
          {error}{' '}
          <button type="button" className="ml-1 inline-flex min-h-11 items-center px-1 font-semibold underline" onClick={reload}>
            {t.common.retry}
          </button>
        </Notice>
      )}
      {!rows && !error && <Spinner />}
      {rows && view.length === 0 && <p className="text-slate-600">{to.stockEmpty}</p>}

      {view.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">{to.colObject}</th>
                  <th className="px-3 py-2 font-medium">{to.colMaterial}</th>
                  <th className="px-3 py-2 text-right font-medium">{to.colStock}</th>
                  <th className="px-3 py-2 font-medium">{to.colLastMovement}</th>
                </tr>
              </thead>
              <tbody>
                {view.map((r) => (
                  <tr key={`${r.object_id}:${r.material_id}`} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.objectName}</td>
                    <td className="px-3 py-2">{r.materialName}</td>
                    <td
                      data-testid="stock-qty"
                      className={`whitespace-nowrap px-3 py-2 text-right font-medium ${r.negative ? 'text-danger' : ''}`}
                      title={r.negative ? to.negative : undefined}
                    >
                      {formatQty(r.qty_base)} {r.baseUnit}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {r.last_movement_at ? formatDateTime(r.last_movement_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 md:hidden" aria-label={to.tabStock}>
            {view.map((r) => (
              <li
                key={`${r.object_id}:${r.material_id}`}
                className={`flex items-center justify-between gap-3 rounded-2xl border bg-white p-4 ${
                  r.negative ? 'border-danger/40' : 'border-slate-200'
                }`}
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{r.materialName}</p>
                  <p className="text-sm text-slate-600">{r.objectName}</p>
                </div>
                <p className={`whitespace-nowrap text-right font-semibold ${r.negative ? 'text-danger' : 'text-slate-900'}`}>
                  {formatQty(r.qty_base)} {r.baseUnit}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
