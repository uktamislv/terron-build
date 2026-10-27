import { useEffect, useMemo, useState } from 'react'
import { Gauge } from 'lucide-react'
import { Badge, type Column, cx, DataTable, EmptyState, EntryRow, Qty, RetryNotice, Spinner } from '@/components/ui'
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

/** `outside` — material "smetaga kirmaydi": sarf ko'rinadi, ogohlantirish (qizil, sariq) yo'q. */
type RowStatus = NormStatus | 'outside'

interface Row extends NormUsage {
  name: string
  unit: string
  status: RowStatus
}

const ORDER: Record<RowStatus, number> = { over: 0, not_in_estimate: 1, ok: 2, outside: 3 }

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
        const status: RowStatus = m?.outside_estimate
          ? 'outside'
          : evaluateNorm({
              normQtyBase: r.norm_qty_base,
              wastePct: m?.waste_pct ?? '0',
              consumedQtyBase: r.consumed_qty_base,
            }).status
        return { ...r, name: m?.name ?? '—', unit: m?.base_unit ?? '', status }
      })
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name))
  }, [rows, materials])

  const qty = (v: string, unit: string, danger = false) => <Qty value={v} unit={unit} size="sm" tone={danger ? 'danger' : undefined} />
  const pctOf = (r: Row) => r.usage_pct ?? usagePct(r.consumed_qty_base, r.allowed_qty_base)
  const statusBadge = (r: Row) =>
    r.status === 'over' ? (
      <Badge tone="danger">{tn.over}</Badge>
    ) : r.status === 'not_in_estimate' ? (
      <Badge tone="warn">{tn.notInEstimate}</Badge>
    ) : r.status === 'outside' ? (
      <span title={tn.outsideEstimateHint}>
        <Badge tone="neutral">{tn.outsideEstimate}</Badge>
      </span>
    ) : null
  const remainingDanger = (r: Row) => r.status !== 'outside' && isNegative(r.remaining_qty_base)
  const progress = (r: Row) => (r.status === 'outside' ? null : <NormProgress pct={pctOf(r)} label={r.name} />)

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: tn.colMaterial,
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          {/* Nom qizil faqat normadan oshganda; smetada yo'q — belgi bilan */}
          <span className={cx('font-medium', r.status === 'over' ? 'text-danger' : 'text-ink')}>{r.name}</span>
          {statusBadge(r)}
        </span>
      ),
    },
    { key: 'norm', header: tn.colNorm, align: 'right', cell: (r) => qty(r.norm_qty_base, r.unit) },
    { key: 'allowed', header: tn.colAllowed, align: 'right', cell: (r) => qty(r.allowed_qty_base, r.unit) },
    { key: 'consumed', header: tn.colConsumed, align: 'right', cell: (r) => qty(r.consumed_qty_base, r.unit, r.status === 'over') },
    {
      key: 'remaining',
      header: tn.colRemaining,
      align: 'right',
      cell: (r) => qty(r.remaining_qty_base, r.unit, remainingDanger(r)),
    },
    { key: 'usage', header: tn.colUsage, className: 'min-w-40', cell: (r) => progress(r) },
  ]

  return (
    <section aria-label={tn.title} className="flex flex-col rounded-2xl border border-line bg-paper">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 md:px-5">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-ice text-brand">
            <Gauge className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-ink">{tn.title}</h2>
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
          <DataTable
            caption={tn.title}
            columns={columns}
            rows={view}
            rowKey={(r) => r.material_id}
            rowTestId="norm-row"
            rowData={(r) => ({ 'data-status': r.status })}
            renderMobile={(r) => (
              <EntryRow
                kind={r.status === 'over' ? 'danger' : r.status === 'not_in_estimate' ? 'warn' : 'neutral'}
                icon={false}
                title={<span className={r.status === 'over' ? 'text-danger' : undefined}>{r.name}</span>}
                badge={statusBadge(r)}
                meta={
                  <>
                    <span>
                      {tn.colAllowed}: {qty(r.allowed_qty_base, r.unit)}
                    </span>
                    <span>
                      {tn.colRemaining}: {qty(r.remaining_qty_base, r.unit, remainingDanger(r))}
                    </span>
                    {progress(r)}
                  </>
                }
                trailing={qty(r.consumed_qty_base, r.unit, r.status === 'over')}
              />
            )}
          />
        )}
      </div>
    </section>
  )
}
