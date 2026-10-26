// Tarix sahifasining taqdimot qismlari (ma'lumot props orqali — ko'rgazmada ham ishlatiladi).
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArchiveRestore,
  History,
  KeyRound,
  ListTree,
  Monitor,
  Pencil,
  Plus,
  RotateCcw,
  Server,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  DetailRows,
  DetailSheet,
  EmptyState,
  EntryRow,
  Modal,
  Notice,
  PageHeader,
  RetryNotice,
  SkeletonRows,
  Spinner,
  Tabs,
  type BadgeTone,
  type EntryKind,
  type FilterDef,
  type TabItem,
} from '@/components/ui'
import { AUDIT_ACTIONS, AUDIT_DEVICES, type AuditDevice, type AuditEntry, type DeletedRecord, type RefNames } from '@/data/historyRepo'
import type { PersonRef } from '@/data/types'
import { actionKind, type ActionKind } from '@/domain/history'
import { t } from '@/i18n'
import { formatDate, formatDateTime } from '@/lib/format'
import { PeriodBar } from '../dashboard/PeriodBar'
import {
  actionLabel,
  entryChanges,
  entryTitle,
  fieldLabel,
  formatValue,
  isPastPeriod,
  isRestorable,
  isTransferMovement,
  tableLabel,
} from './historyFormat'
import { HISTORY_FILTER_TABLES, historyHref, type HistoryQuery, type HistoryTab } from './historyQuery'

const th = t.history
const ic = { strokeWidth: 1.75, 'aria-hidden': true } as const

/** Amal → chap chiziq rangi: qo'shildi yashil, o'zgartirildi ko'k, o'chirildi qizil, tiklandi navy, kirish kulrang. */
const ACTION_ENTRY_KIND: Record<ActionKind, EntryKind> = {
  create: 'ok',
  update: 'chiqim',
  delete: 'danger',
  restore: 'xarid',
  auth: 'neutral',
}

const ACTION_BADGE: Record<ActionKind, BadgeTone> = {
  create: 'ok',
  update: 'info',
  delete: 'danger',
  restore: 'info',
  auth: 'neutral',
}

const iconCls = 'size-[18px]'
const ACTION_ICON: Record<ActionKind, ReactNode> = {
  create: <Plus className={iconCls} strokeWidth={2} />,
  update: <Pencil className={iconCls} strokeWidth={1.75} />,
  delete: <Trash2 className={iconCls} strokeWidth={1.75} />,
  restore: <RotateCcw className={iconCls} strokeWidth={1.75} />,
  auth: <KeyRound className={iconCls} strokeWidth={1.75} />,
}

function DeviceTag({ device }: { device: AuditDevice | null }) {
  if (!device) return null
  const Icon = device === 'veb' ? Monitor : device === 'mobil' ? Smartphone : Server
  return (
    <span data-device={device}>
      <Icon className="size-3.5" {...ic} />
      {th.devices[device]}
    </span>
  )
}

export function ActionBadge({ action }: { action: string }) {
  return <Badge tone={ACTION_BADGE[actionKind(action)]}>{actionLabel(action)}</Badge>
}

const TABS: readonly TabItem<HistoryTab>[] = [
  { key: 'feed', label: th.tabFeed, icon: <History {...ic} /> },
  { key: 'deleted', label: th.tabDeleted, icon: <ArchiveRestore {...ic} /> },
]

export function HistoryShell({
  tab,
  onTab,
  actions,
  children,
}: {
  tab: HistoryTab
  onTab: (tab: HistoryTab) => void
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={th.title} icon={<History strokeWidth={1.75} />} actions={actions} />
      <Tabs label={th.tabs} items={TABS} value={tab} onChange={onTab} />
      {children}
    </div>
  )
}

export type HistoryPatch = Partial<Omit<HistoryQuery, 'preset' | 'invalid'>>

const tableOptions = () => [
  { value: '', label: th.all },
  ...HISTORY_FILTER_TABLES.map((tb) => ({ value: tb, label: tableLabel(tb) })),
]

/** Davr (Batch 9 tugmalari) + jadval/amal/kim/qurilma filtrlari. */
export function HistoryFilters({
  query,
  todayIso,
  profiles,
  onQuery,
  withFeedFilters,
  extra,
}: {
  query: HistoryQuery
  todayIso: string
  profiles: readonly PersonRef[]
  onQuery: (patch: HistoryPatch) => void
  /** Tarix tabi: amal, kim, qurilma; O'chirilganlar — faqat davr va jadval. */
  withFeedFilters: boolean
  extra?: ReactNode
}) {
  const filters: FilterDef[] = [
    {
      kind: 'select',
      key: 'table',
      label: th.filterTable,
      value: query.table,
      onChange: (v) => onQuery({ table: v }),
      options: tableOptions(),
    },
  ]
  if (withFeedFilters)
    filters.push(
      {
        kind: 'select',
        key: 'action',
        label: th.filterAction,
        value: query.action,
        onChange: (v) => onQuery({ action: v }),
        options: [{ value: '', label: th.all }, ...AUDIT_ACTIONS.map((a) => ({ value: a, label: actionLabel(a) }))],
      },
      {
        kind: 'select',
        key: 'actor',
        label: th.filterActor,
        value: query.actorId,
        onChange: (v) => onQuery({ actorId: v }),
        options: [{ value: '', label: th.all }, ...profiles.map((p) => ({ value: p.id, label: p.full_name }))],
      },
      {
        kind: 'select',
        key: 'device',
        label: th.filterDevice,
        value: query.device,
        onChange: (v) => onQuery({ device: v as HistoryQuery['device'] }),
        options: [{ value: '', label: th.all }, ...AUDIT_DEVICES.map((d) => ({ value: d, label: th.devices[d] }))],
      },
    )
  return (
    <PeriodBar
      key={`${query.from}|${query.to}`}
      query={{ from: query.from, to: query.to, objectId: '', preset: query.preset }}
      todayIso={todayIso}
      objects={[]}
      onChange={({ from, to }) => onQuery({ from, to })}
      filters={filters}
      onClear={() => onQuery({ table: '', action: '', actorId: '', device: '', recordId: '' })}
      extra={extra}
    />
  )
}

/** "Bitta yozuv tarixi: …" chipi (yopish — barcha yozuvlar). */
export function RecordChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-full bg-ice pr-1 pl-3 text-sm font-semibold text-brand">
      <ListTree className="size-4 shrink-0" {...ic} />
      <span className="truncate">
        {th.recordFilter}: {label}
      </span>
      <button
        type="button"
        aria-label={th.recordFilterClear}
        title={th.recordFilterClear}
        onClick={onClear}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-brand/10"
      >
        <X className="size-4" strokeWidth={2} aria-hidden />
      </button>
    </span>
  )
}

function LoadMore({ hasMore, loading, onLoadMore }: { hasMore: boolean; loading: boolean; onLoadMore: () => void }) {
  if (!hasMore) return null
  return (
    <div className="flex justify-center">
      <Button variant="secondary" loading={loading} onClick={onLoadMore}>
        {loading ? th.loadingMore : th.loadMore}
      </Button>
    </div>
  )
}

export function FeedList({
  rows,
  hasMore,
  loadingMore,
  error,
  moreError,
  onRetry,
  onLoadMore,
  onOpen,
}: {
  rows: AuditEntry[] | null
  hasMore: boolean
  loadingMore: boolean
  error?: string | null
  /** "Yana yuklash" xatosi (ro'yxat saqlanadi). */
  moreError?: string | null
  onRetry: () => void
  onLoadMore: () => void
  onOpen: (e: AuditEntry) => void
}) {
  if (error) return <RetryNotice message={error} onRetry={onRetry} />
  if (!rows) return <SkeletonRows rows={6} />
  if (rows.length === 0) return <EmptyState icon={<History strokeWidth={1.5} />} title={th.empty} text={th.emptyHint} />
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2" aria-label={th.tabFeed}>
        {rows.map((e) => {
          const kind = actionKind(e.action)
          return (
            <EntryRow
              key={e.id}
              as="li"
              testId="history-row"
              kind={ACTION_ENTRY_KIND[kind]}
              icon={ACTION_ICON[kind]}
              title={entryTitle(e)}
              badge={<ActionBadge action={e.action} />}
              meta={
                <>
                  <span>{tableLabel(e.table_name)}</span>
                  <span>{e.actor_name ?? (e.device === 'tizim' ? th.system : th.noActor)}</span>
                  <span className="tabular">{formatDateTime(e.created_at)}</span>
                  <DeviceTag device={e.device} />
                </>
              }
              onClick={() => onOpen(e)}
            />
          )
        })}
      </ul>
      {moreError && <RetryNotice message={moreError} onRetry={onLoadMore} />}
      <LoadMore hasMore={hasMore} loading={loadingMore} onLoadMore={onLoadMore} />
    </div>
  )
}

/** Yozuv tafsiloti: "Maydon | Oldin | Keyin", butun tarix havolasi, o'chirilgan bo'lsa — "Tiklash". */
export function EntryDetail({
  entry,
  names,
  namesError,
  canRestore,
  showWholeHistory,
  restoredLater = false,
  onRestore,
  onClose,
}: {
  entry: AuditEntry
  /** Bog'langan nomlar; null — yuklanmoqda. */
  names: RefNames | null
  namesError?: string | null
  canRestore: boolean
  showWholeHistory: boolean
  /** Yuklangan tarixda keyinroq tiklangan. */
  restoredLater?: boolean
  onRestore: () => void
  onClose: () => void
}) {
  const changes = entryChanges(entry)
  const isInsert = !entry.old_data
  const restorable =
    canRestore && entry.action === 'SOFT_DELETE' && isRestorable(entry.table_name) && !isTransferMovement(entry) && !restoredLater
  const footer =
    (showWholeHistory || restorable) && (
      <>
        {showWholeHistory && (
          <Link
            to={historyHref(entry.table_name === 'auth' ? null : entry.table_name, entry.record_id)}
            onClick={onClose}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-paper px-4 text-sm font-semibold text-ink hover:bg-canvas sm:flex-none"
          >
            <ListTree className="size-5" {...ic} />
            {th.wholeHistory}
          </Link>
        )}
        {restorable && (
          <Button className="flex-1 sm:flex-none" icon={<RotateCcw className="size-5" {...ic} />} onClick={onRestore}>
            {th.restore}
          </Button>
        )}
      </>
    )

  return (
    <DetailSheet title={entryTitle(entry)} onClose={onClose} size="lg" footer={footer}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <ActionBadge action={entry.action} />
          <Badge tone="neutral">{tableLabel(entry.table_name)}</Badge>
        </div>
        <DetailRows
          items={[
            { label: th.colWho, value: entry.actor_name ?? (entry.device === 'tizim' ? th.system : th.noActor) },
            { label: th.colWhen, value: <span className="tabular">{formatDateTime(entry.created_at)}</span> },
            entry.device ? { label: th.colDevice, value: th.devices[entry.device] } : null,
          ]}
        />
        {restoredLater && entry.action === 'SOFT_DELETE' && <Notice tone="info">{th.restoredLater}</Notice>}
        {namesError && <Notice tone="warn">{namesError}</Notice>}
        {changes.length === 0 ? (
          <p className="text-sm text-muted">{th.noChanges}</p>
        ) : !names ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm" data-testid="history-diff">
              <thead className="bg-canvas text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {th.colField}
                  </th>
                  {!isInsert && (
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {th.colBefore}
                    </th>
                  )}
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {isInsert ? th.colValue : th.colAfter}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {changes.map((c) => (
                  <tr key={c.field} data-field={c.field}>
                    <th scope="row" className="px-3 py-2 text-left font-normal text-muted">
                      {fieldLabel(c.field)}
                    </th>
                    {!isInsert && (
                      <td className="tabular px-3 py-2 break-words text-muted line-through decoration-muted/40">
                        {formatValue(entry.table_name, c.field, c.before, names)}
                      </td>
                    )}
                    <td className="tabular px-3 py-2 font-medium break-words text-ink">
                      {formatValue(entry.table_name, c.field, c.after, names)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DetailSheet>
  )
}

export function DeletedList({
  rows,
  hasMore,
  loadingMore,
  error,
  moreError,
  canRestore,
  busy,
  onRetry,
  onLoadMore,
  onRestore,
}: {
  rows: DeletedRecord[] | null
  hasMore: boolean
  loadingMore: boolean
  error?: string | null
  moreError?: string | null
  canRestore: boolean
  busy?: boolean
  onRetry: () => void
  onLoadMore: () => void
  onRestore: (r: DeletedRecord) => void
}) {
  if (error) return <RetryNotice message={error} onRetry={onRetry} />
  if (!rows) return <SkeletonRows rows={6} />
  if (rows.length === 0)
    return <EmptyState icon={<ArchiveRestore strokeWidth={1.5} />} title={th.deletedEmpty} text={th.deletedEmptyHint} />
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2" aria-label={th.tabDeleted}>
        {rows.map((r) => (
          <EntryRow
            key={`${r.table_name}:${r.record_id}`}
            as="li"
            testId="deleted-row"
            kind="danger"
            deleted
            icon={<Trash2 className={iconCls} strokeWidth={1.75} />}
            title={entryTitle(r)}
            meta={
              <>
                <span>{tableLabel(r.table_name)}</span>
                <span>
                  {th.colDeletedBy}: {r.deleted_by_name ?? th.noActor}
                </span>
                <span className="tabular">{formatDateTime(r.deleted_at)}</span>
              </>
            }
            actions={
              <>
                <Link
                  to={historyHref(r.table_name, r.record_id)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-brand hover:bg-ice"
                >
                  <History className="size-[18px]" {...ic} />
                  {th.link}
                </Link>
                {canRestore && isRestorable(r.table_name) && (
                  <Button variant="ghost" size="sm" disabled={busy} icon={<RotateCcw className="size-[18px]" {...ic} />} onClick={() => onRestore(r)}>
                    {th.restore}
                  </Button>
                )}
              </>
            }
          />
        ))}
      </ul>
      {moreError && <RetryNotice message={moreError} onRetry={onLoadMore} />}
      <LoadMore hasMore={hasMore} loading={loadingMore} onLoadMore={onLoadMore} />
    </div>
  )
}

/** Tiklash tasdig'i: direktorga xabar, profil — nofaol holda, eski sanali yozuv — o'tgan davr o'zgaradi. */
export function RestoreConfirm({
  label,
  table,
  recordDate,
  todayIso,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  label: string
  table: string
  /** Yozuv sanasi (xarid / podotchet / harakat); null — sanasiz yoki noma'lum. */
  recordDate: string | null
  todayIso: string
  busy: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  const past = recordDate !== null && isPastPeriod(recordDate, todayIso)
  return (
    <Modal
      title={th.restoreTitle}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.common.no}
          </Button>
          <Button loading={busy} icon={<RotateCcw className="size-5" {...ic} />} onClick={onConfirm}>
            {th.restore}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">{th.restoreConfirm(label)}</p>
        {recordDate && <p className="tabular text-sm text-ink">{th.restoreDate(formatDate(recordDate))}</p>}
        {table === 'profiles' && <Notice tone="warn">{th.restoreProfileNote}</Notice>}
        {past && <Notice tone="warn">{th.restorePastPeriod}</Notice>}
        <Notice tone="info">{th.restoreNotify}</Notice>
        {error && <Notice>{error}</Notice>}
      </div>
    </Modal>
  )
}
