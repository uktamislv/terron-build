import { useCallback, useEffect, useId, useState } from 'react'
import { ArrowLeftRight, ArrowRight, X } from 'lucide-react'
import { TRANSFER_TONE } from '@/components/statusTones'
import {
  ActionMenu,
  Badge,
  Button,
  DataTable,
  DetailRows,
  DetailSheet,
  EmptyState,
  EntryRow,
  FilterBar,
  Modal,
  Notice,
  Pager,
  Qty,
  RetryNotice,
  Spinner,
} from '@/components/ui'
import { CANCEL_REASON_MAX, TRANSFERS_PAGE_SIZE, cancelTransfer, listTransfers } from '@/data/transfersRepo'
import { TRANSFER_STATUSES, type ObjectRow, type Transfer, type TransferStatus } from '@/data/types'
import { cmp, isZero, sub } from '@/domain/decimal'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDateTime, formatQty } from '@/lib/format'

const tt = t.ombor.transfers

/** Qabul qilingan − yuborilgan (asosiy birlikda); qabul qilinmagan — null. */
function diffOf(r: Transfer): string | null {
  if (r.received_qty_base === null) return null
  return sub(r.received_qty_base, r.qty_base)
}

function inputUnit(r: Transfer): string {
  return unitLabel({ unit: r.unit_input, variant: r.unit_variant })
}

function Route({ r }: { r: Transfer }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {r.from_object_name ?? tt.otherObject}
      <ArrowRight aria-hidden className="size-3.5 text-muted" strokeWidth={2} />
      {r.to_object_name ?? tt.otherObject}
    </span>
  )
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
    <Modal
      title={tt.cancelTitle}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t.common.close}
          </Button>
          <Button
            variant="danger"
            loading={busy}
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
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <EntryRow
          kind="transfer"
          title={transfer.material_name ?? '—'}
          meta={<Route r={transfer} />}
          trailing={<Qty value={transfer.qty_input} unit={inputUnit(transfer)} size="lg" />}
        />
        <p className="text-sm text-muted">{tt.cancelText}</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-sm font-medium text-ink">
            {tt.cancelReason}
          </label>
          <textarea
            id={id}
            rows={3}
            maxLength={CANCEL_REASON_MAX}
            value={reason}
            aria-invalid={missing || undefined}
            onChange={(e) => {
              setReason(e.target.value)
              setMissing(false)
            }}
            className={`min-h-11 rounded-xl border bg-paper px-3 py-2 text-base outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 ${
              missing ? 'border-danger' : 'border-line'
            }`}
          />
          {missing && <p className="text-xs text-danger">{tt.cancelReasonRequired}</p>}
        </div>
        {error && <Notice>{error}</Notice>}
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
  const [detail, setDetail] = useState<Transfer | null>(null)
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

  const received = (r: Transfer, size: 'sm' | 'md' = 'sm') =>
    r.received_qty_base !== null ? <Qty value={r.received_qty_base} unit={r.base_unit} size={size} /> : <span className="text-muted">—</span>
  const diffCell = (r: Transfer) => {
    const d = diffOf(r)
    if (d === null) return <span className="text-muted">—</span>
    if (isZero(d)) return <span className="font-semibold text-ok">0</span>
    return (
      <span data-testid="transfer-diff" className="tabular font-semibold whitespace-nowrap text-danger">
        {cmp(d, '0') > 0 ? '+' : ''}
        {formatQty(d)} {r.base_unit ?? ''}
      </span>
    )
  }
  const statusCell = (r: Transfer) => (
    <span className="flex flex-col items-start gap-1">
      <Badge tone={TRANSFER_TONE[r.status]}>{t.transfers.statuses[r.status]}</Badge>
      {r.received_at && <span className="tabular text-xs text-muted">{formatDateTime(r.received_at)}</span>}
      {r.cancel_reason && (
        <span className="text-xs text-muted">
          {tt.cancelReasonLabel}: {r.cancel_reason}
        </span>
      )}
    </span>
  )
  const startCancel = (r: Transfer) => {
    setActionError(null)
    setCancelling(r)
  }
  const canCancel = (r: Transfer) => canManage && r.status === 'yuborildi'
  /** Jadvalda — "⋯" menyusi; telefonda amal tafsilot varag'ida. */
  const action = (r: Transfer) => (
    <ActionMenu
      items={[
        canCancel(r) && {
          key: 'cancel',
          label: tt.cancel,
          icon: <X aria-hidden className="size-5" strokeWidth={1.75} />,
          danger: true,
          onSelect: () => startCancel(r),
        },
      ]}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        label={t.ombor.filters}
        onClear={() => {
          setStatus('')
          setObjectId('')
          setPage(0)
        }}
        filters={[
          {
            kind: 'select',
            key: 'status',
            label: tt.filterStatus,
            value: status,
            onChange: (v) => {
              setStatus(v as '' | TransferStatus)
              setPage(0)
            },
            options: [{ value: '', label: t.ombor.all }, ...TRANSFER_STATUSES.map((s) => ({ value: s, label: t.transfers.statuses[s] }))],
          },
          {
            kind: 'select',
            key: 'object',
            label: tt.filterObject,
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
          caption={t.ombor.tabTransfers}
          rows={data.rows}
          rowKey={(r) => r.id}
          rowTestId="transfer-row"
          empty={<EmptyState icon={<ArrowLeftRight strokeWidth={1.5} />} title={tt.empty} />}
          columns={[
            {
              key: 'date',
              header: tt.colDate,
              cell: (r) => (
                <span className="flex flex-col">
                  <span className="tabular whitespace-nowrap">{formatDateTime(r.created_at)}</span>
                  {r.created_by_name && <span className="text-xs text-muted">{r.created_by_name}</span>}
                </span>
              ),
            },
            { key: 'from', header: tt.colFrom, cell: (r) => r.from_object_name ?? tt.otherObject },
            { key: 'to', header: tt.colTo, cell: (r) => r.to_object_name ?? tt.otherObject },
            { key: 'material', header: tt.colMaterial, cell: (r) => <span className="font-medium text-ink">{r.material_name ?? '—'}</span> },
            {
              key: 'sent',
              header: tt.colSent,
              align: 'right',
              cell: (r) => (
                <span className="flex flex-col items-end">
                  <Qty value={r.qty_base} unit={r.base_unit} size="sm" />
                  <Qty value={r.qty_input} unit={inputUnit(r)} size="sm" tone="muted" className="text-xs" />
                </span>
              ),
            },
            { key: 'received', header: tt.colReceived, align: 'right', cell: (r) => received(r) },
            { key: 'diff', header: tt.colDiff, align: 'right', cell: diffCell },
            { key: 'status', header: tt.colStatus, cell: statusCell },
            canManage && { key: 'actions', header: tt.colActions, srHeader: true, cell: action },
          ]}
          renderMobile={(r) => (
            <EntryRow
              kind="transfer"
              title={r.material_name ?? '—'}
              badge={<Badge tone={TRANSFER_TONE[r.status]}>{t.transfers.statuses[r.status]}</Badge>}
              meta={
                <>
                  <Route r={r} />
                  <span className="tabular">{formatDateTime(r.created_at)}</span>
                  {r.received_qty_base !== null && (
                    <span>
                      {tt.colReceived}: {received(r)}
                    </span>
                  )}
                  {diffOf(r) !== null && (
                    <span>
                      {tt.colDiff}: {diffCell(r)}
                    </span>
                  )}
                  {r.cancel_reason && (
                    <span>
                      {tt.cancelReasonLabel}: {r.cancel_reason}
                    </span>
                  )}
                </>
              }
              qty={{ value: r.qty_base, unit: r.base_unit }}
              baseQty={{ value: r.qty_input, unit: inputUnit(r) }}
              qtySize="lg"
              onClick={() => setDetail(r)}
            />
          )}
          footer={<Pager page={page} pageSize={TRANSFERS_PAGE_SIZE} total={data.total} onPage={setPage} />}
        />
      )}
      {detail && (
        <DetailSheet
          title={detail.material_name ?? tt.cancelTitle}
          onClose={() => setDetail(null)}
          footer={
            canCancel(detail) && (
              <Button
                variant="danger"
                className="flex-1"
                icon={<X aria-hidden className="size-5" strokeWidth={1.75} />}
                onClick={() => {
                  setDetail(null)
                  startCancel(detail)
                }}
              >
                {tt.cancel}
              </Button>
            )
          }
        >
          <div className="flex flex-col gap-3">
            <Badge tone={TRANSFER_TONE[detail.status]}>{t.transfers.statuses[detail.status]}</Badge>
            <Qty value={detail.qty_base} unit={detail.base_unit} size="hero" />
            <DetailRows
              items={[
                { label: `${tt.colFrom} → ${tt.colTo}`, value: <Route r={detail} /> },
                detail.created_by_name ? { label: tt.colAuthor, value: detail.created_by_name } : null,
                { label: tt.colDate, value: <span className="tabular">{formatDateTime(detail.created_at)}</span> },
                detail.received_qty_base !== null && { label: tt.colReceived, value: received(detail) },
                diffOf(detail) !== null && { label: tt.colDiff, value: diffCell(detail) },
                detail.cancel_reason ? { label: tt.cancelReasonLabel, value: detail.cancel_reason } : null,
              ]}
            />
          </div>
        </DetailSheet>
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
