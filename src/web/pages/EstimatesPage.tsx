import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { StatusBadge } from '@/components/StatusBadge'
import { Button, Notice, Spinner } from '@/components/ui'
import { listEstimateItems, listEstimates, setCurrentEstimate } from '@/data/estimatesRepo'
import { listObjects } from '@/data/objectsRepo'
import type { Estimate, EstimateItem, ObjectRow } from '@/data/types'
import { diffEstimates, type DiffResult } from '@/domain/estimate'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDate, formatSum } from '@/lib/format'
import { RetryNotice, SelectField } from '../fields'
import { DiffView } from '../estimates/DiffView'
import { EstimateItemsTable } from '../estimates/EstimateItemsTable'
import { ImportWizard } from '../estimates/ImportWizard'
import { MakeCurrentDialog } from '../estimates/MakeCurrentDialog'
import { estimateItemsToDiff } from '../estimates/wizardModel'
import { NormUsageTable } from '../norms/NormUsageTable'

const te = t.estimates

type View = { kind: 'list' } | { kind: 'version'; id: string } | { kind: 'import' }

function VersionView({
  estimate,
  canManage,
  busy,
  onBack,
  onMakeCurrent,
}: {
  estimate: Estimate
  canManage: boolean
  busy: boolean
  onBack: () => void
  onMakeCurrent: () => void
}) {
  const [items, setItems] = useState<EstimateItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let alive = true
    listEstimateItems(estimate.id)
      .then((list) => {
        if (!alive) return
        setItems(list)
        setError(null)
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    return () => {
      alive = false
    }
  }, [estimate.id, reloadKey])

  return (
    <section aria-label={estimate.title} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-brand-dark">
            {te.version(estimate.version)} · {estimate.title}
            {estimate.is_current && <StatusBadge tone="ok">{te.current}</StatusBadge>}
          </h2>
          <p className="text-sm text-slate-600">
            {estimate.estimate_date ? formatDate(estimate.estimate_date) : formatDate(estimate.created_at)}
            {estimate.source_file_name ? ` · ${estimate.source_file_name}` : ''} · {te.rowsCount(estimate.item_count)} ·{' '}
            {te.total}: <b>{formatSum(estimate.total_sum)}</b>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && !estimate.is_current && (
            <Button disabled={busy} onClick={onMakeCurrent}>
              {te.makeCurrent}
            </Button>
          )}
          <Button variant="secondary" onClick={onBack}>
            {te.backToList}
          </Button>
        </div>
      </div>
      {error && <RetryNotice message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
      {!items && !error && <Spinner />}
      {items && <EstimateItemsTable items={items} />}
    </section>
  )
}

function ComparePanel({ estimates }: { estimates: readonly Estimate[] }) {
  const [fromId, setFromId] = useState(estimates[1]?.id ?? '')
  const [toId, setToId] = useState(estimates[0]?.id ?? '')
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function compare() {
    if (!fromId || !toId || fromId === toId) {
      setError(te.compareSame)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const [a, b] = await Promise.all([listEstimateItems(fromId), listEstimateItems(toId)])
      setDiff(diffEstimates(estimateItemsToDiff(a), estimateItemsToDiff(b)))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const options = estimates.map((e) => (
    <option key={e.id} value={e.id}>
      {te.version(e.version)} · {e.title}
    </option>
  ))
  return (
    <section aria-label={te.compareTitle} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">{te.compareTitle}</h2>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <SelectField label={te.compareFrom} value={fromId} onChange={(v) => { setFromId(v); setDiff(null) }}>
          {options}
        </SelectField>
        <SelectField label={te.compareTo} value={toId} onChange={(v) => { setToId(v); setDiff(null) }}>
          {options}
        </SelectField>
        <Button variant="secondary" disabled={busy} onClick={() => void compare()}>
          {te.compare}
        </Button>
      </div>
      {error && <Notice>{error}</Notice>}
      {diff && <DiffView diff={diff} />}
    </section>
  )
}

/** Smeta: obyekt bo'yicha versiyalar, ko'rish, solishtirish, joriy qilish va Excel importi. */
export function EstimatesPage() {
  const { profile: me } = useAuth()
  const [objects, setObjects] = useState<ObjectRow[] | null>(null)
  const [objectId, setObjectId] = useState('')
  const [estimates, setEstimates] = useState<Estimate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    listObjects()
      .then((list) => {
        if (!alive) return
        setObjects(list)
        setObjectId((cur) => cur || list[0]?.id || '')
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!objectId) return
    let alive = true
    listEstimates(objectId)
      .then((list) => {
        if (!alive) return
        setEstimates(list)
        setError(null)
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    return () => {
      alive = false
    }
  }, [objectId, reloadKey])

  if (!me) return null
  const canManage = can(me.role, 'manage_estimates')
  const canCatalog = can(me.role, 'manage_catalog')

  async function makeCurrent(id: string) {
    setBusy(true)
    setActionError(null)
    try {
      await setCurrentEstimate(id)
      setConfirmId(null)
      reload()
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (view.kind === 'import' && objects) {
    return (
      <div className="mx-auto max-w-7xl">
        <ImportWizard
          companyId={me.company_id}
          objects={objects}
          initialObjectId={objectId}
          canCatalog={canCatalog}
          onCancel={() => setView({ kind: 'list' })}
          onSaved={(id, savedObjectId) => {
            setObjectId(savedObjectId)
            setEstimates(null)
            reload()
            setView({ kind: 'version', id })
          }}
        />
      </div>
    )
  }

  const list = estimates ?? []
  const opened = view.kind === 'version' ? list.find((e) => e.id === view.id) : undefined
  const confirming = confirmId ? list.find((e) => e.id === confirmId) : undefined

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-brand-dark">{te.title}</h1>
        {canManage && objects && objects.length > 0 && (
          <Button onClick={() => setView({ kind: 'import' })}>{te.upload}</Button>
        )}
      </div>
      {!canManage && <p className="text-sm text-slate-600">{te.readOnly}</p>}

      {objects && objects.length === 0 && <p className="text-slate-600">{te.noObjects}</p>}
      {objects && objects.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 md:w-96">
          <SelectField
            label={te.object}
            value={objectId}
            onChange={(v) => {
              setObjectId(v)
              setEstimates(null)
              setView({ kind: 'list' })
            }}
          >
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </SelectField>
        </div>
      )}

      {error && <RetryNotice message={error} onRetry={reload} />}
      {actionError && !confirming && <Notice>{actionError}</Notice>}
      {confirming && (
        <MakeCurrentDialog
          target={confirming}
          current={list.find((e) => e.is_current)}
          busy={busy}
          error={actionError}
          onCancel={() => setConfirmId(null)}
          onConfirm={() => void makeCurrent(confirming.id)}
        />
      )}
      {(!objects || (objectId && !estimates)) && !error && <Spinner />}

      {opened && (
        <VersionView
          estimate={opened}
          canManage={canManage}
          busy={busy}
          onBack={() => setView({ kind: 'list' })}
          onMakeCurrent={() => {
            setActionError(null)
            setConfirmId(opened.id)
          }}
        />
      )}

      {!opened && estimates && estimates.length === 0 && <p className="text-slate-600">{te.empty}</p>}
      {!opened && list.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm" aria-label={te.versions}>
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">{te.colVersion}</th>
                  <th className="px-3 py-2 font-medium">{te.colDate}</th>
                  <th className="px-3 py-2 font-medium">{te.colTitle}</th>
                  <th className="px-3 py-2 font-medium">{te.colFile}</th>
                  <th className="px-3 py-2 text-right font-medium">{te.colRows}</th>
                  <th className="px-3 py-2 text-right font-medium">{te.colTotal}</th>
                  <th className="px-3 py-2 font-medium">{te.colStatus}</th>
                  <th className="px-3 py-2 font-medium">{te.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id} data-testid="estimate-version" className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{te.version(e.version)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatDate(e.estimate_date ?? e.created_at)}
                    </td>
                    <td className="px-3 py-2">{e.title}</td>
                    <td className="px-3 py-2 text-slate-600">{e.source_file_name ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{e.item_count}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{formatSum(e.total_sum)}</td>
                    <td className="px-3 py-2">{e.is_current && <StatusBadge tone="ok">{te.current}</StatusBadge>}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button variant="ghost" onClick={() => setView({ kind: 'version', id: e.id })}>
                          {te.open}
                        </Button>
                        {canManage && !e.is_current && (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                              setActionError(null)
                              setConfirmId(e.id)
                            }}
                          >
                            {te.makeCurrent}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length > 1 && <ComparePanel key={objectId} estimates={list} />}
        </>
      )}
      {!opened && objectId && list.some((e) => e.is_current) && <NormUsageTable key={objectId} objectId={objectId} />}
    </div>
  )
}
