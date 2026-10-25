import { useCallback, useEffect, useMemo, useState } from 'react'
import { Package } from 'lucide-react'
import { Badge, DataTable, EmptyState, EntryRow, FilterBar, Qty, RetryNotice, Spinner } from '@/components/ui'
import { listAllStock, listStock } from '@/data/stockRepo'
import type { Material, ObjectRow, StockBalance } from '@/data/types'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { formatDateTime } from '@/lib/format'
import { ExportButton } from '../ExportButton'
import { nameStock, type StockRow } from './stockRows'
import { stockSheet } from '../exports'

const to = t.ombor

export function StockTab({ objects, materials }: { objects: ObjectRow[]; materials: Material[] }) {
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
      <FilterBar
        label={to.filters}
        filters={[
          {
            kind: 'select',
            key: 'object',
            label: to.filterObject,
            value: objectId,
            onChange: setObjectId,
            options: [{ value: '', label: to.all }, ...objects.map((o) => ({ value: o.id, label: o.name }))],
          },
        ]}
        onClear={() => setObjectId('')}
        extra={<div className="md:ml-auto"><ExportButton run={runExport} /></div>}
      />

      {error && <RetryNotice message={error} onRetry={reload} />}
      {!rows && !error && <Spinner />}
      {rows && <StockTable rows={view} />}
    </div>
  )
}

/** Qoldiq jadvali (telefonda — qatorlar). Manfiy qoldiq qizil. */
export function StockTable({ rows }: { rows: StockRow[] }) {
  const qty = (r: StockRow, size: 'sm' | 'lg') => (
    <span data-testid="stock-qty" title={r.negative ? to.negative : undefined} className={r.negative ? 'text-danger' : undefined}>
      <Qty value={r.qty_base} unit={r.baseUnit} size={size} tone={r.negative ? 'danger' : undefined} />
    </span>
  )
  return (
    <DataTable
      caption={to.tabStock}
      rows={rows}
      rowKey={(r) => `${r.object_id}:${r.material_id}`}
      empty={<EmptyState icon={<Package strokeWidth={1.5} />} title={to.stockEmpty} text={to.stockEmptyHint} />}
      columns={[
        { key: 'object', header: to.colObject, cell: (r) => r.objectName },
        { key: 'material', header: to.colMaterial, cell: (r) => <span className="font-medium text-ink">{r.materialName}</span> },
        { key: 'qty', header: to.colStock, align: 'right', cell: (r) => qty(r, 'sm') },
        {
          key: 'last',
          header: to.colLastMovement,
          cell: (r) => <span className="tabular whitespace-nowrap text-muted">{r.last_movement_at ? formatDateTime(r.last_movement_at) : '—'}</span>,
        },
      ]}
      renderMobile={(r) => (
        <EntryRow
          kind={r.negative ? 'danger' : 'neutral'}
          icon={false}
          title={r.materialName}
          badge={r.negative ? <Badge tone="danger">{to.negative}</Badge> : undefined}
          meta={
            <>
              <span>{r.objectName}</span>
              {r.last_movement_at && <span className="tabular">{formatDateTime(r.last_movement_at)}</span>}
            </>
          }
          trailing={qty(r, 'lg')}
        />
      )}
    />
  )
}
