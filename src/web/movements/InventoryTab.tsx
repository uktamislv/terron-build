import { useCallback, useEffect, useMemo, useState } from 'react'
import { INVENTORY_TONE } from '@/components/statusTones'
import { ArrowLeft, ChevronRight, ClipboardCheck, Wrench } from 'lucide-react'
import { Badge, Button, DataTable, EmptyState, EntryRow, FilterBar, Modal, Money, Notice, Pager, Qty, RetryNotice, Spinner } from '@/components/ui'
import { listAlerts } from '@/data/alertsRepo'
import { COUNTS_PAGE_SIZE, applyAdjustments, getCount, getCountDetails, listCountItems, listCounts } from '@/data/inventoryRepo'
import type { Alert, InventoryCount, InventoryDetailRow, ObjectRow } from '@/data/types'
import { add, cmp, isZero } from '@/domain/decimal'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDateTime, formatQty, formatSum } from '@/lib/format'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { alertDetailText } from '../alerts/alertDetails'
import { ExportButton } from '../ExportButton'
import { inventorySheet } from '../exports'

const ti = t.ombor.inventory

/** Qoralama qatorlari (kutilgansiz) → tafsilot ko'rinishi. */
function draftRows(countId: string): Promise<InventoryDetailRow[]> {
  return listCountItems(countId).then((items) =>
    items.map((i) => ({
      material_id: i.material_id,
      material_name: i.material_name,
      base_unit: i.base_unit,
      qty_input: i.qty_input,
      unit_id: i.unit_id,
      qty_counted: i.qty_counted,
      qty_expected: null,
      diff: null,
      shortage_value: null,
    })),
  )
}

/**
 * Hisob tafsiloti (RPC `inventory_count_details`): kutilgan, sanalgan, farq, kamomad qiymati (bazada
 * hisoblangan); sanalmaganlar belgili; kamomad alerti matni. Admin — "Qoldiqni tuzatish".
 */
function CountDetail({ countId, canApply, onBack }: { countId: string; canApply: boolean; onBack: () => void }) {
  const [count, setCount] = useState<InventoryCount | null>(null)
  const [rows, setRows] = useState<InventoryDetailRow[] | null>(null)
  const [alert, setAlert] = useState<Alert | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    getCount(countId)
      .then(async (c) => {
        const list = c.status === 'submitted' ? await getCountDetails(countId) : await draftRows(countId)
        if (!alive) return
        setCount(c)
        setRows(list)
        setError(null)
        if (c.status === 'submitted') {
          // Alert — qo'shimcha (sanalmaganlar, tuzatilgani): xato bo'lsa jadval baribir ko'rsatiladi
          const found = await listAlerts({ inventoryCountId: countId, type: 'inventarizatsiya_kamomadi' }).catch(() => null)
          if (alive) setAlert(found?.rows[0] ?? null)
        }
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    return () => {
      alive = false
    }
  }, [countId, reloadKey])

  const submitted = count?.status === 'submitted'
  const view = rows ?? []
  const shortageCount = view.filter((r) => r.diff !== null && cmp(r.diff, '0') < 0).length
  const surplusCount = view.filter((r) => r.diff !== null && cmp(r.diff, '0') > 0).length
  const total = useMemo(
    () => (rows ?? []).reduce<string | null>((sum, r) => (r.shortage_value !== null ? add(sum ?? '0', r.shortage_value) : sum), null),
    [rows],
  )
  const diffCount = view.filter((r) => r.diff !== null && !isZero(r.diff)).length

  const apply = async () => {
    setBusy(true)
    setApplyError(null)
    try {
      await applyAdjustments(countId)
      setConfirming(false)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setApplyError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const diffCell = (d: string | null, unit: string) => {
    if (d === null) return <span className="text-muted">—</span>
    if (isZero(d)) return <span className="text-ok">0</span>
    const short = cmp(d, '0') < 0
    return (
      <span data-testid={short ? 'inventory-shortage' : 'inventory-surplus'} className={`font-semibold ${short ? 'text-danger' : 'text-warn'}`}>
        {short ? '' : '+'}
        {formatQty(d)} {unit}
        {!short && <span className="ml-1 text-xs font-normal">({ti.surplus})</span>}
      </span>
    )
  }

  return (
    <section className="flex flex-col gap-4" aria-label={count ? ti.detailTitle(count.object_name ?? '', formatDateTime(count.created_at)) : undefined}>
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Button variant="ghost" icon={<ArrowLeft aria-hidden className="size-5" strokeWidth={1.75} />} onClick={onBack} className="-ml-2">
            {ti.back}
          </Button>
          {submitted && count && rows && rows.length > 0 && (
            <ExportButton
              run={async (signal) => {
                await exportWorkbook({
                  fileName: exportFileName(t.excel.sections.inventory),
                  sheets: [inventorySheet(rows, { objectName: count.object_name, countedAt: count.counted_at })],
                  signal,
                })
              }}
            />
          )}
          {canApply && submitted && count && !count.applied_at && (
            <Button
              disabled={diffCount === 0}
              title={diffCount === 0 ? ti.applyNothing : undefined}
              icon={<Wrench aria-hidden className="size-5" strokeWidth={1.75} />}
              onClick={() => {
                setApplyError(null)
                setConfirming(true)
              }}
            >
              {ti.apply}
            </Button>
          )}
        </div>
        {count && (
          <div className="flex flex-col gap-1">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink md:text-xl">
              {ti.detailTitle(count.object_name ?? '—', formatDateTime(count.created_at))}
              <Badge tone={INVENTORY_TONE[count.status]}>{t.inventory.statuses[count.status]}</Badge>
              {count.applied_at && <Badge tone="ok">{ti.applied}</Badge>}
            </h2>
            {count.created_by_name && <p className="text-sm text-muted">{count.created_by_name}</p>}
            {count.applied_at && <p className="text-sm text-ok">{ti.appliedAt(formatDateTime(count.applied_at))}</p>}
          </div>
        )}
        {count && submitted && (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-danger-bg px-3 py-2 text-sm font-semibold text-danger">{ti.shortageCount(shortageCount)}</div>
            <div className="rounded-xl bg-warn-bg px-3 py-2 text-sm font-semibold text-warn">{ti.surplusCount(surplusCount)}</div>
            {total !== null && (
              <div data-testid="inventory-total" className="tabular rounded-xl bg-canvas px-3 py-2 text-sm font-semibold text-ink">
                {ti.totalShortage(formatSum(total))}
              </div>
            )}
          </div>
        )}
      </div>

      {error && <RetryNotice message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
      {(!count || !rows) && !error && <Spinner />}
      {count && !submitted && <Notice tone="info">{ti.draftNote}</Notice>}
      {alert && (
        <Notice tone="warn">
          <span data-testid="inventory-alert">{alertDetailText(alert)}</span>
        </Notice>
      )}
      {rows && view.length > 0 && (
        <DataTable
          caption={ti.colMaterial}
          rows={view}
          rowKey={(r) => r.material_id}
          rowTestId="inventory-item"
          columns={[
            { key: 'material', header: ti.colMaterial, cell: (r) => <span className="font-medium text-ink">{r.material_name ?? '—'}</span> },
            submitted && {
              key: 'expected',
              header: ti.colExpected,
              align: 'right',
              cell: (r) => (r.qty_expected !== null ? <Qty value={r.qty_expected} unit={r.base_unit} size="sm" tone="muted" /> : '—'),
            },
            {
              key: 'counted',
              header: ti.colCounted,
              align: 'right',
              cell: (r) =>
                r.qty_counted !== null ? <Qty value={r.qty_counted} unit={r.base_unit} size="sm" /> : <Badge tone="warn">{ti.notCountedMark}</Badge>,
            },
            submitted && { key: 'diff', header: ti.colDiff, align: 'right', cell: (r) => diffCell(r.diff, r.base_unit ?? '') },
            submitted && {
              key: 'value',
              header: ti.colValue,
              align: 'right',
              cell: (r) =>
                r.shortage_value !== null ? (
                  <Money value={r.shortage_value} size="sm" tone="danger" />
                ) : r.diff !== null && cmp(r.diff, '0') < 0 ? (
                  <span className="text-xs text-muted">{ti.noPrice}</span>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      )}

      {confirming && (
        <Modal
          title={ti.applyTitle}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t.common.cancel}
              </Button>
              <Button loading={busy} onClick={() => void apply()}>
                {ti.apply}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">{ti.applyText(diffCount)}</p>
            {applyError && <Notice>{applyError}</Notice>}
          </div>
        </Modal>
      )}
    </section>
  )
}

/** Inventarizatsiya hisoblari ro'yxati va tafsiloti. Tuzatish faqat admin (`apply_inventory`). */
export function InventoryTab({ objects, canApply }: { objects: ObjectRow[]; canApply: boolean }) {
  const [objectId, setObjectId] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ rows: InventoryCount[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    listCounts({ objectId: objectId || undefined }, page)
      .then((result) => {
        if (!alive) return
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    return () => {
      alive = false
    }
  }, [objectId, page, reloadKey])

  if (openId) {
    return (
      <CountDetail
        countId={openId}
        canApply={canApply}
        onBack={() => {
          setOpenId(null)
          reload()
        }}
      />
    )
  }

  const statusBadges = (c: InventoryCount) => (
    <span className="flex flex-wrap gap-1">
      <Badge tone={INVENTORY_TONE[c.status]}>{t.inventory.statuses[c.status]}</Badge>
      {c.applied_at && <Badge tone="ok">{ti.applied}</Badge>}
    </span>
  )

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        label={t.ombor.filters}
        onClear={() => {
          setObjectId('')
          setPage(0)
        }}
        filters={[
          {
            kind: 'select',
            key: 'object',
            label: ti.colObject,
            value: objectId,
            onChange: (v) => {
              setObjectId(v)
              setPage(0)
            },
            options: [{ value: '', label: t.ombor.all }, ...objects.map((o) => ({ value: o.id, label: o.name }))],
          },
        ]}
      />
      {error && <RetryNotice message={error} onRetry={reload} />}
      {!data && !error && <Spinner />}
      {data && (
        <DataTable
          caption={t.ombor.tabInventory}
          rows={data.rows}
          rowKey={(c) => c.id}
          rowTestId="inventory-count"
          empty={<EmptyState icon={<ClipboardCheck strokeWidth={1.5} />} title={ti.empty} />}
          columns={[
            { key: 'date', header: ti.colDate, cell: (c) => <span className="tabular whitespace-nowrap">{formatDateTime(c.created_at)}</span> },
            { key: 'object', header: ti.colObject, cell: (c) => <span className="font-medium text-ink">{c.object_name ?? '—'}</span> },
            { key: 'author', header: ti.colAuthor, cell: (c) => c.created_by_name ?? '—' },
            { key: 'items', header: ti.colItems, align: 'right', cell: (c) => c.item_count },
            { key: 'status', header: ti.colStatus, cell: statusBadges },
            {
              key: 'actions',
              header: ti.colActions,
              srHeader: true,
              cell: (c) => (
                <Button variant="ghost" size="sm" onClick={() => setOpenId(c.id)}>
                  {ti.open}
                  <ChevronRight aria-hidden className="size-5" strokeWidth={1.75} />
                </Button>
              ),
            },
          ]}
          renderMobile={(c) => (
            <EntryRow
              kind={c.applied_at ? 'ok' : c.status === 'draft' ? 'neutral' : 'warn'}
              icon={<ClipboardCheck className="size-5" strokeWidth={1.75} />}
              title={c.object_name ?? '—'}
              badge={statusBadges(c)}
              meta={
                <>
                  <span className="tabular">{formatDateTime(c.created_at)}</span>
                  {c.created_by_name && <span>{c.created_by_name}</span>}
                </>
              }
              trailing={<span className="tabular text-lg font-semibold">{c.item_count}</span>}
              trailingMeta={ti.colItems}
              onClick={() => setOpenId(c.id)}
            />
          )}
          footer={<Pager page={page} pageSize={COUNTS_PAGE_SIZE} total={data.total} onPage={setPage} />}
        />
      )}
    </div>
  )
}
