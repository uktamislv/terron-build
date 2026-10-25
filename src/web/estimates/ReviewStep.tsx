// Import ustasining 7-qadami: tekshirish — jami, ogohlantirishlar, avvalgi versiya bilan farq.
import { useMemo, useState } from 'react'
import { StatusBadge } from '@/components/StatusBadge'
import { Notice, Spinner } from '@/components/ui'
import { diffEstimates, type DiffItem } from '@/domain/estimate'
import { t } from '@/i18n'
import { formatQty, formatSum } from '@/lib/format'
import { Pager } from '../fields'
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
}: {
  plan: Plan
  skippedCount: number
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
        <section aria-label={tw.newAliases} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="font-semibold text-slate-900">
            {tw.newAliases}: {plan.aliases.length}
          </h3>
          <ul className="flex flex-col gap-1 text-sm text-slate-700">
            {plan.aliases.map((a) => (
              <li key={`${a.materialKey}|${a.alias}`}>
                «{a.alias}» → <b>{a.materialName}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label={te.diff.title} className="flex flex-col gap-2">
        <h3 className="font-semibold text-slate-900">{te.diff.title}</h3>
        {prevError && <Notice>{prevError}</Notice>}
        {prevItems === null && !prevError && <Spinner />}
        {prevItems === 'none' && <p className="text-sm text-slate-600">{te.diff.noPrev}</p>}
        {diff && <DiffView diff={diff} />}
      </section>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm" aria-label={tw.steps.review}>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">{te.colRow}</th>
              <th className="px-3 py-2 font-medium">{te.colName}</th>
              <th className="px-3 py-2 font-medium">{te.colMaterial}</th>
              <th className="px-3 py-2 font-medium">{te.colUnit}</th>
              <th className="px-3 py-2 text-right font-medium">{te.colQty}</th>
              <th className="px-3 py-2 text-right font-medium">{te.colBase}</th>
              <th className="px-3 py-2 text-right font-medium">{te.colPrice}</th>
              <th className="px-3 py-2 text-right font-medium">{te.colSum}</th>
              <th className="px-3 py-2 font-medium">{tw.reviewWarnings}</th>
            </tr>
          </thead>
          <tbody>
            {pageSlice(plan.rows, current, PAGE_SIZE).map((r) => (
              <tr key={r.item.rowNumber} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 text-slate-500">{r.item.rowNumber}</td>
                <td className="px-3 py-2">{r.item.name}</td>
                <td className="px-3 py-2">
                  {r.itemType === 'ish' ? <StatusBadge tone="neutral">{te.types.ish}</StatusBadge> : r.materialName}
                </td>
                <td className="px-3 py-2">{r.unitText}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatQty(r.item.qty)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {r.qtyBase !== null ? `${formatQty(r.qtyBase)} ${r.baseUnit ?? ''}` : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{r.item.price !== null ? formatSum(r.item.price) : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatSum(r.sum)}</td>
                <td className="px-3 py-2">
                  {r.warnings.map((w) => (
                    <span key={w} className="mr-1 inline-block">
                      <StatusBadge tone="warn">{tw.warnings[w]}</StatusBadge>
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {plan.rows.length > PAGE_SIZE && <Pager page={current} pageSize={PAGE_SIZE} total={plan.rows.length} onPage={setPage} />}
    </div>
  )
}
