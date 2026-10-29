import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Building2, Check, ChevronRight, Package, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import { useAuth } from '@/auth/authContext'
import { Badge, Button, EmptyState, EntryRow, FilterBar, Modal, Notice, PageHeader, Pager, RetryNotice, Spinner, TextAreaField } from '@/components/ui'
import {
  ALERTS_PAGE_SIZE,
  CLOSE_NOTE_MAX,
  closeAlert,
  listAlerts,
  listAllAlerts,
  markAlertSeen,
  type AlertFilters,
} from '@/data/alertsRepo'
import { listObjects } from '@/data/objectsRepo'
import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TYPES,
  type Alert,
  type AlertSeverity,
  type AlertStatus,
  type AlertType,
  type ObjectRow,
} from '@/data/types'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { formatDateTime } from '@/lib/format'
import { ExportButton } from '../ExportButton'
import { alertsSheet } from '../exports'
import { paramId, paramOneOf } from '../urlFilters'
import { alertDetailText, autoCloseReason, expenseAlertHref, isAutoClosed } from '../alerts/alertDetails'
import { SEVERITY_ENTRY_KIND, SEVERITY_TONE, STATUS_TONE } from '../alerts/alertTones'
import { AlertTypeIcon } from '../alerts/AlertTypeIcon'

const tp = t.alertsPage
const ta = t.alertTexts
const ic = { className: 'size-5', strokeWidth: 1.75, 'aria-hidden': true } as const

type StatusFilter = 'open' | 'all' | AlertStatus

export interface AlertFilterForm {
  status: StatusFilter
  type: '' | AlertType
  severity: '' | AlertSeverity
  objectId: string
}

const EMPTY: AlertFilterForm = { status: 'open', type: '', severity: '', objectId: '' }

function toFilters(f: AlertFilterForm): AlertFilters {
  return {
    statuses: f.status === 'open' ? ['yangi', 'korildi'] : f.status === 'all' ? undefined : [f.status],
    type: f.type || undefined,
    severity: f.severity || undefined,
    objectId: f.objectId || undefined,
  }
}

export interface AlertsViewProps {
  rows: Alert[] | null
  total: number
  page: number
  onPage: (page: number) => void
  form: AlertFilterForm
  onFilter: (patch: Partial<AlertFilterForm>) => void
  objects: ObjectRow[]
  canManage: boolean
  busyId?: string | null
  error?: string | null
  actionError?: string | null
  onRetry?: () => void
  onMarkSeen?: (a: Alert) => void
  onClose?: (a: Alert) => void
  exportSlot?: ReactNode
}

/** Ogohlantirishlar ro'yxati: tur belgisi, jiddiylik — chap chiziq rangi. Ma'lumot props orqali. */
export function AlertsView({
  rows,
  total,
  page,
  onPage,
  form,
  onFilter,
  objects,
  canManage,
  busyId = null,
  error,
  actionError,
  onRetry,
  onMarkSeen,
  onClose,
  exportSlot,
}: AlertsViewProps) {
  const actions = (a: Alert) =>
    canManage && a.status !== 'yopildi' ? (
      <>
        {a.status === 'yangi' && (
          <Button variant="ghost" size="sm" icon={<Check {...ic} />} disabled={busyId === a.id} onClick={() => onMarkSeen?.(a)}>
            {tp.markSeen}
          </Button>
        )}
        <Button variant="ghost" size="sm" className="text-danger! hover:bg-danger-bg!" icon={<X {...ic} />} disabled={busyId === a.id} onClick={() => onClose?.(a)}>
          {tp.close}
        </Button>
      </>
    ) : undefined

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={tp.title} icon={<TriangleAlert strokeWidth={1.75} />} actions={exportSlot} />
      <FilterBar
        label={t.ombor.filters}
        onClear={() => onFilter(EMPTY)}
        filters={[
          {
            kind: 'select',
            key: 'status',
            label: tp.filterStatus,
            value: form.status,
            emptyValue: EMPTY.status,
            onChange: (v) => onFilter({ status: v as StatusFilter }),
            options: [
              { value: 'open', label: tp.statusOpen },
              ...ALERT_STATUSES.map((s) => ({ value: s, label: ta.statuses[s] })),
              { value: 'all', label: tp.all },
            ],
          },
          {
            kind: 'select',
            key: 'type',
            label: tp.filterType,
            value: form.type,
            onChange: (v) => onFilter({ type: v as AlertFilterForm['type'] }),
            options: [{ value: '', label: tp.all }, ...ALERT_TYPES.map((k) => ({ value: k, label: ta.types[k] }))],
          },
          {
            kind: 'select',
            key: 'severity',
            label: tp.filterSeverity,
            value: form.severity,
            onChange: (v) => onFilter({ severity: v as AlertFilterForm['severity'] }),
            options: [{ value: '', label: tp.all }, ...ALERT_SEVERITIES.map((k) => ({ value: k, label: ta.severities[k] }))],
          },
          {
            kind: 'select',
            key: 'object',
            label: tp.filterObject,
            value: form.objectId,
            onChange: (v) => onFilter({ objectId: v }),
            options: [{ value: '', label: tp.all }, ...objects.map((o) => ({ value: o.id, label: o.name }))],
          },
        ]}
      />

      {error && <RetryNotice message={error} onRetry={onRetry ?? (() => undefined)} />}
      {actionError && <Notice>{actionError}</Notice>}
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && <EmptyState icon={<ShieldCheck strokeWidth={1.5} />} title={tp.empty} text={tp.emptyHint} />}

      {rows && rows.length > 0 && (
        <>
          <ul className="flex flex-col gap-2" aria-label={tp.title}>
            {rows.map((a) => (
              <EntryRow
                key={a.id}
                as="li"
                testId="alert-row"
                kind={a.status === 'yopildi' ? 'neutral' : SEVERITY_ENTRY_KIND[a.severity]}
                icon={<AlertTypeIcon type={a.type} />}
                title={ta.types[a.type]}
                badge={
                  <>
                    <Badge tone={SEVERITY_TONE[a.severity]}>{ta.severities[a.severity]}</Badge>
                    <Badge tone={STATUS_TONE[a.status]}>{ta.statuses[a.status]}</Badge>
                  </>
                }
                meta={
                  <>
                    <span className="text-sm text-ink">{alertDetailText(a)}</span>
                    {(a.object_name || a.material_name) && (
                      <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {a.object_name && (
                          <span className="inline-flex items-center gap-1">
                            <Building2 aria-hidden className="size-3.5" strokeWidth={1.75} />
                            {a.object_name}
                          </span>
                        )}
                        {a.material_name && (
                          <span className="inline-flex items-center gap-1">
                            <Package aria-hidden className="size-3.5" strokeWidth={1.75} />
                            {a.material_name}
                          </span>
                        )}
                      </span>
                    )}
                    {a.status === 'yopildi' && isAutoClosed(a) && (
                      <span>
                        {tp.autoClosed}
                        {autoCloseReason(a) ? `: ${autoCloseReason(a)}` : ''}
                      </span>
                    )}
                    {a.close_note && (
                      <span>
                        {tp.closeNoteLabel}: {a.close_note}
                      </span>
                    )}
                    {expenseAlertHref(a) && (
                      <Link
                        to={expenseAlertHref(a) ?? '/purchases'}
                        data-testid="alert-expense-link"
                        className="inline-flex min-h-11 items-center gap-1 self-start rounded-lg font-semibold text-brand hover:underline"
                      >
                        {a.type === 'xarajat_limiti' ? t.expenses.openCategoryMonth : t.expenses.openExpense}
                        <ChevronRight aria-hidden className="size-4" strokeWidth={1.75} />
                      </Link>
                    )}
                  </>
                }
                trailing={<span className="tabular text-xs whitespace-nowrap text-muted">{formatDateTime(a.created_at)}</span>}
                actions={actions(a)}
              />
            ))}
          </ul>
          <Pager page={page} pageSize={ALERTS_PAGE_SIZE} total={total} onPage={onPage} />
        </>
      )}
    </div>
  )
}

/** Ogohlantirishlar: admin — "Ko'rildi" / "Yopish"; direktor, buxgalter — faqat ko'rish. */
export function AlertsPage() {
  const { profile: me } = useAuth()
  const [objects, setObjects] = useState<ObjectRow[]>([])
  const [params] = useSearchParams()
  // Bosh sahifa havolalari: ?status=open&severity=jiddiy&object=...
  const [form, setForm] = useState<AlertFilterForm>(() => ({
    status: paramOneOf<StatusFilter>(params, 'status', ['open', 'all', ...ALERT_STATUSES], EMPTY.status) || EMPTY.status,
    type: paramOneOf(params, 'type', ALERT_TYPES, ''),
    severity: paramOneOf(params, 'severity', ALERT_SEVERITIES, ''),
    objectId: paramId(params, 'object'),
  }))
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ rows: Alert[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const canManage = me ? can(me.role, 'manage_alerts') : false
  const [closing, setClosing] = useState<Alert | null>(null)
  const [closeNote, setCloseNote] = useState('')
  // Sabab majburiy (baza: alert_close_note_required) — bo'sh yuborilmaydi
  const [closeNoteError, setCloseNoteError] = useState(false)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    listObjects()
      .then((list) => alive && setObjects(list))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    listAlerts(toFilters(form), page)
      .then((result) => {
        if (!alive) return
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    return () => {
      alive = false
    }
  }, [form, page, reloadKey])

  const update = (patch: Partial<AlertFilterForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setPage(0)
  }

  /** `nextStatus` — amaldan keyingi holat: joriy filtrga kirmasa, qator ro'yxatdan chiqadi. */
  const act = async (id: string, action: (id: string) => Promise<void>, nextStatus: AlertStatus): Promise<boolean> => {
    setBusyId(id)
    setActionError(null)
    try {
      await action(id)
      const statuses = toFilters(form).statuses
      const leavesPage = statuses !== undefined && !statuses.includes(nextStatus)
      // Oxirgi sahifadagi yagona qator ketdi — oldingi sahifaga (bo'sh sahifa qolmasin)
      if (leavesPage && page > 0 && data?.rows.length === 1) setPage((p) => p - 1)
      else reload()
      return true
    } catch (err) {
      setActionError(errorText(err))
      return false
    } finally {
      setBusyId(null)
    }
  }

  const confirmClose = async () => {
    if (!closing) return
    if (!closeNote.trim()) {
      setCloseNoteError(true)
      return
    }
    const ok = await act(closing.id, (id) => closeAlert(id, closeNote), 'yopildi')
    if (ok) setClosing(null)
  }

  if (!me) return null

  return (
    <>
      <AlertsView
        rows={data?.rows ?? null}
        total={data?.total ?? 0}
        page={page}
        onPage={setPage}
        form={form}
        onFilter={update}
        objects={objects}
        canManage={canManage}
        busyId={busyId}
        error={error}
        actionError={closing ? null : actionError}
        onRetry={reload}
        onMarkSeen={(a) => void act(a.id, markAlertSeen, 'korildi')}
        onClose={(a) => {
          setActionError(null)
          setCloseNote('')
          setCloseNoteError(false)
          setClosing(a)
        }}
        exportSlot={
          <ExportButton
            run={async (signal) => {
              const rows = await listAllAlerts(toFilters(form), signal)
              await exportWorkbook({
                fileName: exportFileName(t.excel.sections.alerts),
                sheets: [alertsSheet(rows)],
                signal,
              })
            }}
          />
        }
      />
      {closing && (
        <Modal
          title={tp.closeTitle}
          onClose={() => setClosing(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setClosing(null)}>
                {t.common.cancel}
              </Button>
              <Button variant="danger" loading={busyId === closing.id} onClick={() => void confirmClose()}>
                {tp.close}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <EntryRow
              kind={SEVERITY_ENTRY_KIND[closing.severity]}
              icon={<AlertTypeIcon type={closing.type} />}
              title={ta.types[closing.type]}
              meta={<span className="text-sm text-ink">{alertDetailText(closing)}</span>}
            />
            <TextAreaField
              id="alert-close-note"
              label={tp.closeNote}
              rows={3}
              maxLength={CLOSE_NOTE_MAX}
              value={closeNote}
              required
              aria-required="true"
              hint={tp.closeNoteHint}
              error={closeNoteError ? tp.closeNoteRequired : null}
              onChange={(e) => {
                setCloseNote(e.target.value)
                setCloseNoteError(false)
              }}
            />
            {actionError && <Notice>{actionError}</Notice>}
          </div>
        </Modal>
      )}
    </>
  )
}
