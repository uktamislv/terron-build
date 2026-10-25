import { useCallback, useEffect, useId, useState } from 'react'
import { StatusBadge } from '@/components/StatusBadge'
import { TRANSFER_TONE } from '@/components/statusTones'
import { Button, Modal, Notice, Spinner } from '@/components/ui'
import { CANCEL_REASON_MAX, TRANSFERS_PAGE_SIZE, cancelTransfer, listTransfers } from '@/data/transfersRepo'
import { TRANSFER_STATUSES, type ObjectRow, type Transfer, type TransferStatus } from '@/data/types'
import { cmp, isZero, sub } from '@/domain/decimal'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDateTime, formatQty } from '@/lib/format'
import { Pager, RetryNotice, SelectField } from '../fields'

const tt = t.ombor.transfers

/** Qabul qilingan − yuborilgan (asosiy birlikda); qabul qilinmagan — null. */
function diffOf(r: Transfer): string | null {
  if (r.received_qty_base === null) return null
  return sub(r.received_qty_base, r.qty_base)
}

function CancelDialog({
  transfer,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  transfer: Transfer
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const id = useId()
  const [reason, setReason] = useState('')
  const [missing, setMissing] = useState(false)
  return (
    <Modal title={tt.cancelTitle} onClose={onCancel}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-700">
          {transfer.material_name} · {formatQty(transfer.qty_input)} {unitLabel({ unit: transfer.unit_input, variant: transfer.unit_variant })}{' '}
          · {transfer.from_object_name ?? tt.otherObject} → {transfer.to_object_name ?? tt.otherObject}
        </p>
        <p className="text-sm text-slate-600">{tt.cancelText}</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-sm font-medium text-slate-700">
            {tt.cancelReason}
          </label>
          <textarea
            id={id}
            rows={3}
            maxLength={CANCEL_REASON_MAX}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setMissing(false)
            }}
            className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          {missing && <p className="text-xs text-danger">{tt.cancelReasonRequired}</p>}
        </div>
        {error && <Notice>{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t.common.close}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (!reason.trim()) {
                setMissing(true)
                return
              }
              onConfirm(reason)
            }}
          >
            {tt.cancel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** O'tkazmalar: holat, yuborilgan / qabul qilingan, farq (qizil); admin — "Bekor qilish". */
export function TransfersTab({ objects, canManage }: { objects: ObjectRow[]; canManage: boolean }) {
  const [status, setStatus] = useState<'' | TransferStatus>('')
  const [objectId, setObjectId] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ rows: Transfer[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<Transfer | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    listTransfers({ status: status || undefined, objectId: objectId || undefined }, page)
      .then((result) => {
        if (!alive) return
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    return () => {
      alive = false
    }
  }, [status, objectId, page, reloadKey])

  const confirmCancel = async (reason: string) => {
    if (!cancelling) return
    setBusy(true)
    setActionError(null)
    try {
      await cancelTransfer(cancelling.id, reason)
      setCancelling(null)
      reload()
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const sent = (r: Transfer) => `${formatQty(r.qty_base)} ${r.base_unit ?? ''}`.trim()
  const received = (r: Transfer) => (r.received_qty_base !== null ? `${formatQty(r.received_qty_base)} ${r.base_unit ?? ''}`.trim() : '—')
  const diffCell = (r: Transfer) => {
    const d = diffOf(r)
    if (d === null) return <span className="text-slate-400">—</span>
    if (isZero(d)) return <span className="text-ok">0</span>
    return (
      <span data-testid="transfer-diff" className="font-semibold text-danger">
        {cmp(d, '0') > 0 ? '+' : ''}
        {formatQty(d)} {r.base_unit ?? ''}
      </span>
    )
  }
  const statusCell = (r: Transfer) => (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone={TRANSFER_TONE[r.status]}>{t.transfers.statuses[r.status]}</StatusBadge>
      {r.received_at && <span className="text-xs text-slate-500">{formatDateTime(r.received_at)}</span>}
      {r.cancel_reason && (
        <span className="text-xs text-slate-600">
          {tt.cancelReasonLabel}: {r.cancel_reason}
        </span>
      )}
    </span>
  )
  const action = (r: Transfer) =>
    canManage && r.status === 'yuborildi' ? (
      <Button
        variant="danger"
        onClick={() => {
          setActionError(null)
          setCancelling(r)
        }}
      >
        {tt.cancel}
      </Button>
    ) : null

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:max-w-2xl">
        <SelectField
          label={tt.filterStatus}
          value={status}
          onChange={(v) => {
            setStatus(v as '' | TransferStatus)
            setPage(0)
          }}
        >
          <option value="">{t.ombor.all}</option>
          {TRANSFER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.transfers.statuses[s]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={tt.filterObject}
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
      {data && data.rows.length === 0 && <p className="text-slate-600">{tt.empty}</p>}
      {data && data.rows.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">{tt.colDate}</th>
                  <th className="px-3 py-2 font-medium">{tt.colFrom}</th>
                  <th className="px-3 py-2 font-medium">{tt.colTo}</th>
                  <th className="px-3 py-2 font-medium">{tt.colMaterial}</th>
                  <th className="px-3 py-2 text-right font-medium">{tt.colSent}</th>
                  <th className="px-3 py-2 text-right font-medium">{tt.colReceived}</th>
                  <th className="px-3 py-2 text-right font-medium">{tt.colDiff}</th>
                  <th className="px-3 py-2 font-medium">{tt.colStatus}</th>
                  {canManage && <th className="px-3 py-2 font-medium">{tt.colActions}</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} data-testid="transfer-row" className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatDateTime(r.created_at)}
                      {r.created_by_name && <span className="block text-xs text-slate-500">{r.created_by_name}</span>}
                    </td>
                    <td className="px-3 py-2">{r.from_object_name ?? tt.otherObject}</td>
                    <td className="px-3 py-2">{r.to_object_name ?? tt.otherObject}</td>
                    <td className="px-3 py-2 font-medium">{r.material_name ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {sent(r)}
                      <span className="block text-xs text-slate-500">
                        {formatQty(r.qty_input)} {unitLabel({ unit: r.unit_input, variant: r.unit_variant })}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{received(r)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{diffCell(r)}</td>
                    <td className="px-3 py-2">{statusCell(r)}</td>
                    {canManage && <td className="px-3 py-2">{action(r)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-3 md:hidden" aria-label={t.ombor.tabTransfers}>
            {data.rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-900">{r.material_name}</p>
                  {statusCell(r)}
                </div>
                <p className="text-sm text-slate-600">
                  {r.from_object_name ?? tt.otherObject} → {r.to_object_name ?? tt.otherObject}
                </p>
                <p className="text-sm">
                  {tt.colSent}: {sent(r)} · {tt.colReceived}: {received(r)} · {diffCell(r)}
                </p>
                <p className="text-xs text-slate-500">{formatDateTime(r.created_at)}</p>
                {action(r)}
              </li>
            ))}
          </ul>
          <Pager page={page} pageSize={TRANSFERS_PAGE_SIZE} total={data.total} onPage={setPage} />
        </>
      )}
      {cancelling && (
        <CancelDialog
          transfer={cancelling}
          busy={busy}
          error={actionError}
          onCancel={() => setCancelling(null)}
          onConfirm={(reason) => void confirmCancel(reason)}
        />
      )}
    </div>
  )
}
