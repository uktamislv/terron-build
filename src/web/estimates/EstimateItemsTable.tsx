import { useState } from 'react'
import { StatusBadge } from '@/components/StatusBadge'
import type { EstimateItem } from '@/data/types'
import { itemSum } from '@/data/estimatesRepo'
import { t } from '@/i18n'
import { formatQty, formatSum } from '@/lib/format'
import { Pager } from '../fields'
import { pageSlice } from './styles'
import { PAGE_SIZE } from './wizardModel'

const te = t.estimates

/** Saqlangan versiya qatorlari — 100 tadan sahifalab. */
export function EstimateItemsTable({ items }: { items: readonly EstimateItem[] }) {
  const [page, setPage] = useState(0)
  if (items.length === 0) return <p className="text-slate-600">{te.itemsEmpty}</p>
  const lastPage = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1)
  const current = Math.min(page, lastPage)
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm" aria-label={te.versions}>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">{te.colRow}</th>
              <th className="px-3 py-2 font-medium">{te.colCode}</th>
              <th className="px-3 py-2 font-medium">{te.colName}</th>
              <th className="px-3 py-2 font-medium">{te.colType}</th>
              <th className="px-3 py-2 font-medium">{te.colMaterial}</th>
              <th className="px-3 py-2 text-right font-medium">{te.colQty}</th>
              <th className="px-3 py-2 text-right font-medium">{te.colBase}</th>
              <th className="px-3 py-2 text-right font-medium">{te.colPrice}</th>
              <th className="px-3 py-2 text-right font-medium">{te.colSum}</th>
            </tr>
          </thead>
          <tbody>
            {pageSlice(items, current, PAGE_SIZE).map((it) => (
              <tr key={it.id} data-testid="estimate-item" className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 text-slate-500">{it.row_number ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{it.code ?? ''}</td>
                <td className="px-3 py-2">{it.name}</td>
                <td className="px-3 py-2">
                  <StatusBadge tone={it.item_type === 'material' ? 'info' : 'neutral'}>{te.types[it.item_type]}</StatusBadge>
                </td>
                <td className="px-3 py-2">{it.material_name ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {formatQty(it.qty)} {it.unit ?? ''}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {it.norm_qty_base !== null ? `${formatQty(it.norm_qty_base)} ${it.base_unit ?? ''}` : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{it.unit_price !== null ? formatSum(it.unit_price) : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatSum(itemSum(it.qty, it.unit_price))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > PAGE_SIZE && <Pager page={current} pageSize={PAGE_SIZE} total={items.length} onPage={setPage} />}
    </div>
  )
}
