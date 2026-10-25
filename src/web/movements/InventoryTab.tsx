import { useCallback, useEffect, useMemo, useState } from 'react'
import { StatusBadge } from '@/components/StatusBadge'
import { INVENTORY_TONE } from '@/components/statusTones'
import { Button, Modal, Notice, Spinner } from '@/components/ui'
import { listAlerts } from '@/data/alertsRepo'
import { COUNTS_PAGE_SIZE, applyAdjustments, getCount, getCountDetails, listCountItems, listCounts } from '@/data/inventoryRepo'
import type { Alert, InventoryCount, InventoryDetailRow, ObjectRow } from '@/data/types'
import { add, cmp, isZero } from '@/domain/decimal'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDateTime, formatQty, formatSum } from '@/lib/format'
import { alertDetailText } from '../alerts/alertDetails'
import { Pager, RetryNotice, SelectField } from '../fields'

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
    if (d === null) return <span className="text-slate-400">—</span>
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
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-1">
          {count && (
            <>
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-brand-dark">
                {ti.detailTitle(count.object_name ?? '—', formatDateTime(count.created_at))}
                <StatusBadge tone={INVENTORY_TONE[count.status]}>{t.inventory.statuses[count.status]}</StatusBadge>
                {count.applied_at && <StatusBadge tone="ok">{ti.applied}</StatusBadge>}
              </h2>
              {count.created_by_name && <p className="text-sm text-slate-600">{count.created_by_name}</p>}
              {count.applied_at && <p className="text-sm text-ok">{ti.appliedAt(formatDateTime(count.applied_at))}</p>}
              {submitted && (
                <p className="text-sm text-slate-700">
                  {ti.shortageCount(shortageCount)} · {ti.surplusCount(surplusCount)}
                  {total !== null && (
                    <>
                      {' '}
                      · <b data-testid="inventory-total">{ti.totalShortage(formatSum(total))}</b>
                    </>
                  )}
                </p>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canApply && submitted && count && !count.applied_at && (
            <Button
              disabled={diffCount === 0}
              title={diffCount === 0 ? ti.applyNothing : undefined}
              onClick={() => {
                setApplyError(null)
                setConfirming(true)
              }}
            >
              {ti.apply}
            </Button>
          )}
          <Button variant="secondary" onClick={onBack}>
            {ti.back}
          </Button>
        </div>
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
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">{ti.colMaterial}</th>
                {submitted && <th className="px-3 py-2 text-right font-medium">{ti.colExpected}</th>}
                <th className="px-3 py-2 text-right font-medium">{ti.colCounted}</th>
                {submitted && <th className="px-3 py-2 text-right font-medium">{ti.colDiff}</th>}
                {submitted && <th className="px-3 py-2 text-right font-medium">{ti.colValue}</th>}
              </tr>
            </thead>
            <tbody>
              {view.map((r) => {
                const unit = r.base_unit ?? ''
                const isShort = r.diff !== null && cmp(r.diff, '0') < 0
                return (
                  <tr key={r.material_id} data-testid="inventory-item" className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{r.material_name ?? '—'}</td>
                    {submitted && (
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {r.qty_expected !== null ? `${formatQty(r.qty_expected)} ${unit}` : '—'}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {r.qty_counted !== null ? (
                        `${formatQty(r.qty_counted)} ${unit}`
                      ) : (
                        <StatusBadge tone="warn">{ti.notCountedMark}</StatusBadge>
                      )}
                    </td>
                    {submitted && <td className="whitespace-nowrap px-3 py-2 text-right">{diffCell(r.diff, unit)}</td>}
                    {submitted && (
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {r.shortage_value !== null ? (
                          <span className="font-semibold text-danger">{formatSum(r.shortage_value)}</span>
                        ) : isShort ? (
                          <span className="text-xs text-slate-500">{ti.noPrice}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirming && (
        <Modal title={ti.applyTitle} onClose={() => setConfirming(false)}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-700">{ti.applyText(diffCount)}</p>
            {applyError && <Notice>{applyError}</Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t.common.cancel}
              </Button>
              <Button disabled={busy} onClick={() => void apply()}>
                {ti.apply}
              </Button>
            </div>
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

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:max-w-sm">
        <SelectField
          label={ti.colObject}
          value={objectId}
          onChange={(v) => {
            setObjectId(v)
            setPage(0)
          }}
        >
          <option value="">{t.ombor.all}</option>
          {objects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </SelectField>
      </div>
      {error && <RetryNotice message={error} onRetry={reload} />}
      {!data && !error && <Spinner />}
      {data && data.rows.length === 0 && <p className="text-slate-600">{ti.empty}</p>}
      {data && data.rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">{ti.colDate}</th>
                  <th className="px-3 py-2 font-medium">{ti.colObject}</th>
                  <th className="px-3 py-2 font-medium">{ti.colAuthor}</th>
                  <th className="px-3 py-2 text-right font-medium">{ti.colItems}</th>
                  <th className="px-3 py-2 font-medium">{ti.colStatus}</th>
                  <th className="px-3 py-2 font-medium">{ti.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((c) => (
                  <tr key={c.id} data-testid="inventory-count" className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(c.created_at)}</td>
                    <td className="px-3 py-2">{c.object_name ?? '—'}</td>
                    <td className="px-3 py-2">{c.created_by_name ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{c.item_count}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        <StatusBadge tone={INVENTORY_TONE[c.status]}>{t.inventory.statuses[c.status]}</StatusBadge>
                        {c.applied_at && <StatusBadge tone="ok">{ti.applied}</StatusBadge>}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Button variant="ghost" onClick={() => setOpenId(c.id)}>
                        {ti.open}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={COUNTS_PAGE_SIZE} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  )
}
