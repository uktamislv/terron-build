import { useState } from 'react'
import { ListX } from 'lucide-react'
import { Badge, DataTable, EmptyState, EntryRow, Money, Pager, Qty } from '@/components/ui'
import type { EstimateItem } from '@/data/types'
import { itemSum } from '@/data/estimatesRepo'
import { t } from '@/i18n'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { ExportButton } from '../ExportButton'
import { estimateItemsSheet } from '../exports'
import { pageSlice } from './styles'
import { PAGE_SIZE } from './wizardModel'

const te = t.estimates

/** Saqlangan versiya qatorlari — 100 tadan sahifalab. */
export function EstimateItemsTable({ items }: { items: readonly EstimateItem[] }) {
  const [page, setPage] = useState(0)
  if (items.length === 0) return <EmptyState icon={<ListX strokeWidth={1.5} />} title={te.itemsEmpty} />
  const lastPage = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1)
  const current = Math.min(page, lastPage)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <ExportButton
          run={async (signal) => {
            await exportWorkbook({ fileName: exportFileName(t.excel.sections.estimate), sheets: [estimateItemsSheet([...items])], signal })
          }}
        />
      </div>
      <DataTable
        caption={te.versions}
        rows={pageSlice(items, current, PAGE_SIZE)}
        rowKey={(it) => it.id}
        rowTestId="estimate-item"
        columns={[
          { key: 'row', header: te.colRow, cell: (it) => <span className="tabular text-muted">{it.row_number ?? '—'}</span> },
          { key: 'code', header: te.colCode, cell: (it) => <span className="text-muted">{it.code ?? ''}</span> },
          { key: 'name', header: te.colName, cell: (it) => <span className="font-medium text-ink">{it.name}</span> },
          {
            key: 'type',
            header: te.colType,
            cell: (it) => <Badge tone={it.item_type === 'material' ? 'info' : 'neutral'}>{te.types[it.item_type]}</Badge>,
          },
          { key: 'material', header: te.colMaterial, cell: (it) => it.material_name ?? '—' },
          { key: 'qty', header: te.colQty, align: 'right', cell: (it) => <Qty value={it.qty} unit={it.unit} size="sm" /> },
          {
            key: 'base',
            header: te.colBase,
            align: 'right',
            cell: (it) => (it.norm_qty_base !== null ? <Qty value={it.norm_qty_base} unit={it.base_unit} size="sm" /> : '—'),
          },
          { key: 'price', header: te.colPrice, align: 'right', cell: (it) => (it.unit_price !== null ? <Money value={it.unit_price} size="sm" /> : '—') },
          { key: 'sum', header: te.colSum, align: 'right', cell: (it) => <Money value={itemSum(it.qty, it.unit_price, it.line_sum)} size="sm" /> },
        ]}
        renderMobile={(it) => (
          <EntryRow
            kind={it.item_type === 'material' ? 'chiqim' : 'neutral'}
            icon={false}
            title={it.name}
            badge={<Badge tone={it.item_type === 'material' ? 'info' : 'neutral'}>{te.types[it.item_type]}</Badge>}
            meta={
              <>
                {it.material_name && <span>{it.material_name}</span>}
                {it.norm_qty_base !== null && (
                  <span>
                    {te.colBase}: <Qty value={it.norm_qty_base} unit={it.base_unit} size="sm" tone="muted" />
                  </span>
                )}
              </>
            }
            trailing={<Qty value={it.qty} unit={it.unit} />}
            trailingMeta={<Money value={itemSum(it.qty, it.unit_price, it.line_sum)} size="sm" />}
          />
        )}
        footer={items.length > PAGE_SIZE && <Pager page={current} pageSize={PAGE_SIZE} total={items.length} onPage={setPage} />}
      />
    </div>
  )
}
