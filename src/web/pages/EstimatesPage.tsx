import { useCallback, useEffect, useState } from 'react'
import { useCompanyId } from '@/auth/activeCompany'
import { useAuth } from '@/auth/authContext'
import { ArrowLeft, Building2, CalendarDays, FileSpreadsheet, GitCompare, Rows3, Upload } from 'lucide-react'
import { Badge, Button, DataTable, EmptyState, EntryRow, FilterBar, Money, Notice, PageHeader, SkeletonRows } from '@/components/ui'
import { listEstimateItems, listEstimates, setCurrentEstimate } from '@/data/estimatesRepo'
import { listObjects } from '@/data/objectsRepo'
import type { Estimate, EstimateItem, ObjectRow } from '@/data/types'
import { diffEstimates, type DiffResult } from '@/domain/estimate'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDate } from '@/lib/format'
import { RetryNotice, SelectField } from '@/components/ui'
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
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-line bg-paper p-4 md:p-5">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-ink">
            <span className="rounded-lg bg-ice px-2 py-0.5 text-sm text-navy">{te.version(estimate.version)}</span>
            {estimate.title}
            {estimate.is_current && <Badge tone="ok">{te.current}</Badge>}
          </h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span className="tabular inline-flex items-center gap-1.5">
              <CalendarDays aria-hidden className="size-4" strokeWidth={1.75} />
              {estimate.estimate_date ? formatDate(estimate.estimate_date) : formatDate(estimate.created_at)}
            </span>
            {estimate.source_file_name && (
              <span className="inline-flex items-center gap-1.5">
                <FileSpreadsheet aria-hidden className="size-4" strokeWidth={1.75} />
                {estimate.source_file_name}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Rows3 aria-hidden className="size-4" strokeWidth={1.75} />
              {te.rowsCount(estimate.item_count)}
            </span>
          </div>
          <p className="flex items-baseline gap-2 text-sm text-muted">
            {te.total}: <Money value={estimate.total_sum} size="lg" />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && !estimate.is_current && (
            <Button disabled={busy} onClick={onMakeCurrent}>
              {te.makeCurrent}
            </Button>
          )}
          <Button variant="secondary" icon={<ArrowLeft aria-hidden className="size-5" strokeWidth={1.75} />} onClick={onBack}>
            {te.backToList}
          </Button>
        </div>
      </div>
      {error && <RetryNotice message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
      {!items && !error && <SkeletonRows rows={4} />}
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
    <section aria-label={te.compareTitle} className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-4 md:p-5">
      <h2 className="flex items-center gap-2 text-xl font-semibold text-ink">
        <GitCompare aria-hidden className="size-5 text-brand" strokeWidth={1.75} />
        {te.compareTitle}
      </h2>
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
  // super_admin — faol firma (yon menyudagi tanlagich), boshqalar — o'z firmasi
  const companyId = useCompanyId()
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

  if (!me || !companyId) return null
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
      <div>
        <ImportWizard
          companyId={companyId}
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
    <div className="flex flex-col gap-5">
      <PageHeader
        title={te.title}
        icon={<FileSpreadsheet strokeWidth={1.75} />}
        description={!canManage ? te.readOnly : undefined}
        actions={
          canManage &&
          objects &&
          objects.length > 0 && (
            <Button icon={<Upload aria-hidden className="size-5" strokeWidth={1.75} />} onClick={() => setView({ kind: 'import' })}>
              {te.upload}
            </Button>
          )
        }
      />

      {objects && objects.length === 0 && <EmptyState icon={<Building2 strokeWidth={1.5} />} title={te.noObjects} />}
      {objects && objects.length > 0 && (
        <FilterBar
          filters={[
            {
              kind: 'select',
              key: 'object',
              label: te.object,
              value: objectId,
              onChange: (v) => {
                setObjectId(v)
                setEstimates(null)
                setView({ kind: 'list' })
              },
              options: objects.map((o) => ({ value: o.id, label: o.name })),
              emptyValue: objectId,
            },
          ]}
        />
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
      {(!objects || (objectId && !estimates)) && !error && <SkeletonRows rows={3} />}

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

      {!opened && estimates && estimates.length === 0 && (
        <EmptyState icon={<FileSpreadsheet strokeWidth={1.5} />} title={te.empty} />
      )}
      {!opened && list.length > 0 && (
        <>
          <DataTable
            caption={te.versions}
            rows={list}
            rowKey={(e) => e.id}
            rowTestId="estimate-version"
            columns={[
              { key: 'v', header: te.colVersion, cell: (e) => <span className="font-semibold whitespace-nowrap">{te.version(e.version)}</span> },
              { key: 'date', header: te.colDate, cell: (e) => <span className="tabular whitespace-nowrap">{formatDate(e.estimate_date ?? e.created_at)}</span> },
              { key: 'title', header: te.colTitle, cell: (e) => <span className="font-medium text-ink">{e.title}</span> },
              { key: 'file', header: te.colFile, cell: (e) => <span className="text-muted">{e.source_file_name ?? '—'}</span> },
              { key: 'rows', header: te.colRows, align: 'right', cell: (e) => e.item_count },
              { key: 'total', header: te.colTotal, align: 'right', cell: (e) => <Money value={e.total_sum} size="sm" /> },
              { key: 'status', header: te.colStatus, cell: (e) => e.is_current && <Badge tone="ok">{te.current}</Badge> },
              { key: 'actions', header: te.colActions, srHeader: true, cell: (e) => versionActions(e) },
            ]}
            renderMobile={(e) => (
              <EntryRow
                kind={e.is_current ? 'ok' : 'neutral'}
                icon={<FileSpreadsheet className="size-5" strokeWidth={1.75} />}
                title={`${te.version(e.version)} — ${e.title}`}
                badge={e.is_current && <Badge tone="ok">{te.current}</Badge>}
                meta={
                  <>
                    <span className="tabular">{formatDate(e.estimate_date ?? e.created_at)}</span>
                    <span>{te.rowsCount(e.item_count)}</span>
                  </>
                }
                trailing={<Money value={e.total_sum} size="sm" />}
                actions={versionActions(e)}
              />
            )}
          />
          {list.length > 1 && <ComparePanel key={objectId} estimates={list} />}
        </>
      )}
      {!opened && objectId && list.some((e) => e.is_current) && <NormUsageTable key={objectId} objectId={objectId} />}
    </div>
  )

  function versionActions(e: Estimate) {
    return (
      <div className="flex flex-wrap justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={() => setView({ kind: 'version', id: e.id })}>
          {te.open}
        </Button>
        {canManage && !e.is_current && (
          <Button
            variant="secondary"
            size="sm"
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
    )
  }
}
