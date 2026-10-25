// Import ustasining 7-qadami: tekshirish — jami, ogohlantirishlar, avvalgi versiya bilan farq.
import { useMemo, useState } from 'react'
import { Badge, DataTable, EntryRow, Money, Notice, Qty, Spinner } from '@/components/ui'
import { diffEstimates, type DiffItem } from '@/domain/estimate'
import { t } from '@/i18n'
import { formatQty, formatSum } from '@/lib/format'
import { Pager } from '@/components/ui'
import type { ReviewWarning } from './wizardModel'
import { DiffView } from './DiffView'
import { Stat } from './parts'
import { pageSlice } from './styles'
import { PAGE_SIZE, planToDiffItems, totalsDiffer, type Plan } from './wizardModel'

const tw = t.estimates.wizard
const te = t.estimates

export function ReviewStep({
  plan,
  skippedCount,
  prevItems,
  prevError,
  minorKeys,
}: {
  plan: Plan
  skippedCount: number
  /** Resurs smetasi: katalogga qo'shilmagan kam summali materiallar (guruh kalitlari) — "Ish" bo'lib saqlanadi. */
  minorKeys?: ReadonlySet<string>
  /** Joriy versiya qatorlari; null — yuklanmoqda; [] bilan `noPrev` — joriy versiya yo'q. */
  prevItems: DiffItem[] | null | 'none'
  prevError: string | null
}) {
  const [page, setPage] = useState(0)
  const diff = useMemo(
    () => (Array.isArray(prevItems) ? diffEstimates(prevItems, planToDiffItems(plan)) : null),
    [prevItems, plan],
  )
  const lastPage = Math.max(0, Math.ceil(plan.rows.length / PAGE_SIZE) - 1)
  const current = Math.min(page, lastPage)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={tw.reviewRows} value={plan.rows.length} />
        <Stat label={tw.reviewTotal} value={<span data-testid="review-total">{formatSum(plan.total)}</span>} />
        <Stat label={tw.reviewWarnings} value={plan.warningCount} tone={plan.warningCount ? 'warn' : 'ok'} />
        <Stat label={tw.reviewSkipped} value={skippedCount} />
      </div>
      {minorKeys && minorKeys.size > 0 && <Notice tone="info">{tw.resource.minorNotice(minorKeys.size)}</Notice>}
      {totalsDiffer(plan) && (
        <Notice tone="warn">{tw.totalsDiffer(formatSum(plan.fileTotal), formatSum(plan.total))}</Notice>
      )}
      {(plan.newMaterials.length > 0 || plan.newUnits.length > 0) && (
        <Notice tone="info">
          {plan.newMaterials.length > 0 && (
            <span className="block">
              {tw.newMaterials}: {plan.newMaterials.map((m) => `${m.name} (${m.baseUnit})`).join(', ')}
            </span>
          )}
          {plan.newUnits.length > 0 && (
            <span className="block">
              {tw.newUnits}: {plan.newUnits.map((u) => `${u.materialName}: 1 ${u.unit} = ${formatQty(u.factor)}`).join(', ')}
            </span>
          )}
        </Notice>
      )}
      {plan.aliases.length > 0 && (
        <section aria-label={tw.newAliases} className="flex flex-col gap-2 rounded-xl border border-line bg-paper p-4">
          <h3 className="font-semibold text-ink">
            {tw.newAliases}: {plan.aliases.length}
          </h3>
          <ul className="flex flex-col gap-1 text-sm text-muted">
            {plan.aliases.map((a) => (
              <li key={`${a.materialKey}|${a.alias}`}>
                «{a.alias}» → <b>{a.materialName}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label={te.diff.title} className="flex flex-col gap-2">
        <h3 className="font-semibold text-ink">{te.diff.title}</h3>
        {prevError && <Notice>{prevError}</Notice>}
        {prevItems === null && !prevError && <Spinner />}
        {prevItems === 'none' && <p className="text-sm text-muted">{te.diff.noPrev}</p>}
        {diff && <DiffView diff={diff} />}
      </section>

      <DataTable
        caption={tw.steps.review}
        rows={pageSlice(plan.rows, current, PAGE_SIZE)}
        rowKey={(r) => String(r.item.rowNumber)}
        columns={[
          { key: 'row', header: te.colRow, cell: (r) => <span className="tabular text-muted">{r.item.rowNumber}</span> },
          { key: 'name', header: te.colName, cell: (r) => <span className="font-medium text-ink">{r.item.name}</span> },
          {
            key: 'material',
            header: te.colMaterial,
            cell: (r) =>
              r.itemType === 'ish' ? (
                <span className="flex flex-wrap items-center gap-1">
                  <Badge tone="neutral">{te.types.ish}</Badge>
                  {minorKeys?.has(r.groupKey) && <span className="text-xs text-muted">{tw.resource.minorBadge}</span>}
                </span>
              ) : (
                r.materialName
              ),
          },
          { key: 'unit', header: te.colUnit, cell: (r) => r.unitText },
          { key: 'qty', header: te.colQty, align: 'right', cell: (r) => <Qty value={r.item.qty} size="sm" /> },
          {
            key: 'base',
            header: te.colBase,
            align: 'right',
            cell: (r) => (r.qtyBase !== null ? <Qty value={r.qtyBase} unit={r.baseUnit} size="sm" /> : '—'),
          },
          { key: 'price', header: te.colPrice, align: 'right', cell: (r) => (r.item.price !== null ? <Money value={r.item.price} size="sm" /> : '—') },
          { key: 'sum', header: te.colSum, align: 'right', cell: (r) => <Money value={r.sum} size="sm" /> },
          { key: 'warn', header: tw.reviewWarnings, cell: (r) => <Warnings list={r.warnings} /> },
        ]}
        renderMobile={(r) => (
          <EntryRow
            kind={r.warnings.length > 0 ? 'warn' : r.itemType === 'ish' ? 'neutral' : 'chiqim'}
            icon={false}
            title={r.item.name}
            badge={r.itemType === 'ish' ? <Badge tone="neutral">{te.types.ish}</Badge> : undefined}
            meta={
              <>
                {r.itemType !== 'ish' && r.materialName && <span>{r.materialName}</span>}
                {r.itemType === 'ish' && minorKeys?.has(r.groupKey) && <span>{tw.resource.minorBadge}</span>}
                {r.warnings.length > 0 && <Warnings list={r.warnings} />}
              </>
            }
            trailing={<Qty value={r.item.qty} unit={r.unitText} />}
            trailingMeta={<Money value={r.sum} size="sm" />}
          />
        )}
        footer={plan.rows.length > PAGE_SIZE && <Pager page={current} pageSize={PAGE_SIZE} total={plan.rows.length} onPage={setPage} />}
      />
    </div>
  )
}

function Warnings({ list }: { list: readonly ReviewWarning[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((w) => (
        <Badge key={w} tone="warn">
          {tw.warnings[w]}
        </Badge>
      ))}
    </span>
  )
}
