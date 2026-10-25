import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { StatusBadge } from '@/components/StatusBadge'
import { Button, Modal, Notice, Spinner } from '@/components/ui'
import {
  ALERTS_PAGE_SIZE,
  CLOSE_NOTE_MAX,
  closeAlert,
  listAlerts,
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
import { formatDateTime } from '@/lib/format'
import { alertDetailText, isAutoClosed } from '../alerts/alertDetails'
import { SEVERITY_TONE, STATUS_TONE } from '../alerts/alertTones'
import { Pager, RetryNotice, SelectField } from '../fields'

const tp = t.alertsPage
const ta = t.alertTexts

type StatusFilter = 'open' | 'all' | AlertStatus

interface FilterForm {
  status: StatusFilter
  type: '' | AlertType
  severity: '' | AlertSeverity
  objectId: string
}

const EMPTY: FilterForm = { status: 'open', type: '', severity: '', objectId: '' }

function toFilters(f: FilterForm): AlertFilters {
  return {
    statuses: f.status === 'open' ? ['yangi', 'korildi'] : f.status === 'all' ? undefined : [f.status],
    type: f.type || undefined,
    severity: f.severity || undefined,
    objectId: f.objectId || undefined,
  }
}

/** Ogohlantirishlar: admin — "Ko'rildi" / "Yopish"; direktor, buxgalter — faqat ko'rish. */
export function AlertsPage() {
  const { profile: me } = useAuth()
  const [objects, setObjects] = useState<ObjectRow[]>([])
  const [form, setForm] = useState<FilterForm>(EMPTY)
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ rows: Alert[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const canManage = me ? can(me.role, 'manage_alerts') : false
  const [closing, setClosing] = useState<Alert | null>(null)
  const [closeNote, setCloseNote] = useState('')
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

  const update = (patch: Partial<FilterForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setPage(0)
  }

  const act = async (id: string, action: (id: string) => Promise<void>): Promise<boolean> => {
    setBusyId(id)
    setActionError(null)
    try {
      await action(id)
      reload()
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
    const ok = await act(closing.id, (id) => closeAlert(id, closeNote))
    if (ok) setClosing(null)
  }

  if (!me) return null

  const actions = (a: Alert) =>
    canManage && a.status !== 'yopildi' ? (
      <div className="flex flex-wrap gap-2">
        {a.status === 'yangi' && (
          <Button variant="secondary" disabled={busyId === a.id} onClick={() => void act(a.id, markAlertSeen)}>
            {tp.markSeen}
          </Button>
        )}
        <Button
          variant="danger"
          disabled={busyId === a.id}
          onClick={() => {
            setActionError(null)
            setCloseNote('')
            setClosing(a)
          }}
        >
          {tp.close}
        </Button>
      </div>
    ) : null

  const statusCell = (a: Alert) => (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone={STATUS_TONE[a.status]}>{ta.statuses[a.status]}</StatusBadge>
      {a.status === 'yopildi' && isAutoClosed(a) && <span className="text-xs text-slate-500">{tp.autoClosed}</span>}
      {a.close_note && (
        <span className="text-xs text-slate-600">
          {tp.closeNoteLabel}: {a.close_note}
        </span>
      )}
    </span>
  )

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <h1 className="text-2xl font-bold text-brand-dark">{tp.title}</h1>

      <form
        aria-label={t.ombor.filters}
        onSubmit={(e) => e.preventDefault()}
        className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <SelectField label={tp.filterStatus} value={form.status} onChange={(v) => update({ status: v as StatusFilter })}>
          <option value="open">{tp.statusOpen}</option>
          {ALERT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ta.statuses[s]}
            </option>
          ))}
          <option value="all">{tp.all}</option>
        </SelectField>
        <SelectField label={tp.filterType} value={form.type} onChange={(v) => update({ type: v as FilterForm['type'] })}>
          <option value="">{tp.all}</option>
          {ALERT_TYPES.map((k) => (
            <option key={k} value={k}>
              {ta.types[k]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={tp.filterSeverity}
          value={form.severity}
          onChange={(v) => update({ severity: v as FilterForm['severity'] })}
        >
          <option value="">{tp.all}</option>
          {ALERT_SEVERITIES.map((k) => (
            <option key={k} value={k}>
              {ta.severities[k]}
            </option>
          ))}
        </SelectField>
        <SelectField label={tp.filterObject} value={form.objectId} onChange={(v) => update({ objectId: v })}>
          <option value="">{tp.all}</option>
          {objects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </SelectField>
      </form>

      {error && <RetryNotice message={error} onRetry={reload} />}
      {actionError && !closing && <Notice>{actionError}</Notice>}
      {!data && !error && <Spinner />}
      {data && data.rows.length === 0 && <p className="text-slate-600">{tp.empty}</p>}

      {data && data.rows.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">{tp.colDate}</th>
                  <th className="px-3 py-2 font-medium">{tp.colType}</th>
                  <th className="px-3 py-2 font-medium">{tp.colSeverity}</th>
                  <th className="px-3 py-2 font-medium">{tp.colObject}</th>
                  <th className="px-3 py-2 font-medium">{tp.colMaterial}</th>
                  <th className="px-3 py-2 font-medium">{tp.colDetails}</th>
                  <th className="px-3 py-2 font-medium">{tp.colStatus}</th>
                  {canManage && <th className="px-3 py-2 font-medium">{tp.colActions}</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((a) => (
                  <tr key={a.id} data-testid="alert-row" className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(a.created_at)}</td>
                    <td className="px-3 py-2 font-medium">{ta.types[a.type]}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={SEVERITY_TONE[a.severity]}>{ta.severities[a.severity]}</StatusBadge>
                    </td>
                    <td className="px-3 py-2">{a.object_name ?? '—'}</td>
                    <td className="px-3 py-2">{a.material_name ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{alertDetailText(a)}</td>
                    <td className="px-3 py-2">{statusCell(a)}</td>
                    {canManage && <td className="px-3 py-2">{actions(a)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 md:hidden" aria-label={tp.title}>
            {data.rows.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-900">{ta.types[a.type]}</p>
                  <StatusBadge tone={SEVERITY_TONE[a.severity]}>{ta.severities[a.severity]}</StatusBadge>
                </div>
                <p className="text-sm text-slate-600">
                  {a.object_name ?? '—'} · {a.material_name ?? '—'}
                </p>
                <p className="text-sm text-slate-800">{alertDetailText(a)}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">{formatDateTime(a.created_at)}</span>
                  {statusCell(a)}
                </div>
                {actions(a)}
              </li>
            ))}
          </ul>

          <Pager page={page} pageSize={ALERTS_PAGE_SIZE} total={data.total} onPage={setPage} />
        </>
      )}
      {closing && (
        <Modal title={tp.closeTitle} onClose={() => setClosing(null)}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-700">
              {ta.types[closing.type]} · {alertDetailText(closing)}
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="alert-close-note" className="text-sm font-medium text-slate-700">
                {tp.closeNote}
              </label>
              <textarea
                id="alert-close-note"
                rows={3}
                maxLength={CLOSE_NOTE_MAX}
                value={closeNote}
                onChange={(e) => setCloseNote(e.target.value)}
                className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <p className="text-xs text-slate-500">{tp.closeNoteHint}</p>
            </div>
            {actionError && <Notice>{actionError}</Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setClosing(null)}>
                {t.common.cancel}
              </Button>
              <Button variant="danger" disabled={busyId === closing.id} onClick={() => void confirmClose()}>
                {tp.close}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
