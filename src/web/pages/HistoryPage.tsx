// O'zgarishlar tarixi (Batch 10, docs/history-design.md): "Tarix" (audit_feed, keyset "Yana yuklash")
// va "O'chirilganlar" (deleted_records, tiklash). Filtrlar URL bilan sinxron; hammasi RLS orqali.
// Taqdimot qismlari — ../history/HistoryView.tsx (ko'rgazma ham shularni ishlatadi).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { Notice, useToast } from '@/components/ui'
import {
  emptyRefNames,
  getRecordDate,
  listAllAuditFeed,
  listAuditFeed,
  listDeletedRecords,
  loadRefNames,
  restoreRecord,
  type AuditEntry,
  type DeletedRecord,
  type RefNames,
} from '@/data/historyRepo'
import { listDirectory } from '@/data/profileDirectory'
import type { PersonRef } from '@/data/types'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { exportFileName, exportWorkbook } from '@/lib/excelExport'
import { tashkentIsoDate } from '@/lib/format'
import { useLoad } from '@/lib/useLoad'
import { ExportButton } from '../ExportButton'
import { historySheet } from '../exports'
import { collectRefIds, entryChanges, entryRecordDate, entryTitle, hasRefIds, restoredLater, tableLabel } from '../history/historyFormat'
import { historySearch, readHistoryQuery, toAuditFilters, type HistoryQuery, type HistoryTab } from '../history/historyQuery'
import {
  DeletedList,
  EntryDetail,
  FeedList,
  HistoryFilters,
  HistoryShell,
  RecordChip,
  RestoreConfirm,
  type HistoryPatch,
} from '../history/HistoryView'

const th = t.history

interface ListState<T> {
  key: string
  rows: T[] | null
  hasMore: boolean
  error: string | null
  moreError: string | null
  loadingMore: boolean
}

function initial<T>(key: string): ListState<T> {
  return { key, rows: null, hasMore: false, error: null, moreError: null, loadingMore: false }
}

/**
 * Ro'yxat + "Yana yuklash": `key` o'zgarsa — boshidan; `more(rows)` — keyingi sahifa
 * (eskirgan javob tashlanadi).
 */
function usePaged<T>(key: string, first: () => Promise<{ rows: T[]; hasMore: boolean }>, more: (rows: T[]) => Promise<{ rows: T[]; hasMore: boolean }>) {
  const [version, setVersion] = useState(0)
  const fullKey = `${key}#${version}`
  const [state, setState] = useState<ListState<T>>(() => initial(fullKey))
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let alive = true
    first()
      .then((p) => alive && setState({ ...initial<T>(fullKey), rows: p.rows, hasMore: p.hasMore }))
      .catch((err: unknown) => alive && setState({ ...initial<T>(fullKey), error: errorText(err) }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- faqat kalit bo'yicha
  }, [fullKey])

  const current = state.key === fullKey ? state : initial<T>(fullKey)

  const loadMore = () => {
    const rows = current.rows
    if (!rows || current.loadingMore) return
    setState((s) => (s.key === fullKey ? { ...s, loadingMore: true, moreError: null } : s))
    more(rows)
      .then((p) =>
        setState((s) =>
          s.key === fullKey ? { ...s, rows: [...(s.rows ?? []), ...p.rows], hasMore: p.hasMore, loadingMore: false } : s,
        ),
      )
      .catch((err: unknown) =>
        setState((s) => (s.key === fullKey ? { ...s, loadingMore: false, moreError: errorText(err) } : s)),
      )
  }

  const update = (fn: (rows: T[]) => T[]) =>
    setState((s) => (s.key === fullKey && s.rows ? { ...s, rows: fn(s.rows) } : s))

  return { ...current, reload, loadMore, update }
}

type Restore = { from: 'feed' | 'deleted'; table: string; id: string; label: string; recordDate: string | null } | null

export function HistoryPage() {
  const { profile: me } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const todayIso = useMemo(() => tashkentIsoDate(), [])
  const query = useMemo(() => readHistoryQuery(params, todayIso), [params, todayIso])
  const profiles = useLoad<PersonRef[]>(listDirectory, 'profiles', Boolean(me))

  const setQuery = useCallback(
    (patch: HistoryPatch) => setParams(historySearch({ ...query, ...patch }), { replace: true }),
    [query, setParams],
  )

  if (!me) return null
  const canRestore = can(me.role, 'restore_records')

  return (
    <HistoryBody
      query={query}
      todayIso={todayIso}
      profiles={profiles.data ?? []}
      canRestore={canRestore}
      onQuery={setQuery}
      onRestored={(table) => {
        if (table === 'profiles') toast.show(th.restoredProfile, 'ok', { label: th.restoredProfileLink, to: '/users' })
        else if (table === 'estimates') toast.show(th.restoredEstimate, 'ok')
        else toast.show(th.restored, 'ok')
      }}
    />
  )
}

function HistoryBody({
  query,
  todayIso,
  profiles,
  canRestore,
  onQuery,
  onRestored,
}: {
  query: HistoryQuery
  todayIso: string
  profiles: PersonRef[]
  canRestore: boolean
  onQuery: (patch: HistoryPatch) => void
  onRestored: (table: string) => void
}) {
  const filters = toAuditFilters(query)
  const feedKey = JSON.stringify(filters)
  const feed = usePaged<AuditEntry>(
    query.tab === 'feed' ? feedKey : 'off',
    () => (query.tab === 'feed' ? listAuditFeed(filters) : Promise.resolve({ rows: [], hasMore: false })),
    (rows) => listAuditFeed(filters, rows[rows.length - 1]?.id ?? null),
  )
  const deletedFilters = { from: query.from, to: query.to, table: query.table || undefined }
  const deleted = usePaged<DeletedRecord>(
    query.tab === 'deleted' ? JSON.stringify(deletedFilters) : 'off',
    () => (query.tab === 'deleted' ? listDeletedRecords(deletedFilters) : Promise.resolve({ rows: [], hasMore: false })),
    (rows) => listDeletedRecords(deletedFilters, rows.length),
  )

  const [detail, setDetail] = useState<AuditEntry | null>(null)
  const [names, setNames] = useState<{ id: number; names: RefNames | null; error: string | null } | null>(null)
  const [restore, setRestore] = useState<Restore>(null)
  const [busy, setBusy] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const openDetail = (e: AuditEntry) => {
    setDetail(e)
    const ids = collectRefIds([{ table: e.table_name, changes: entryChanges(e) }])
    if (!hasRefIds(ids)) {
      setNames({ id: e.id, names: emptyRefNames(), error: null })
      return
    }
    setNames({ id: e.id, names: null, error: null })
    loadRefNames(ids)
      .then((n) => setNames((s) => (s?.id === e.id ? { id: e.id, names: n, error: null } : s)))
      // Nomlar yuklanmasa ham diff ko'rinadi ("—")
      .catch((err: unknown) => setNames((s) => (s?.id === e.id ? { id: e.id, names: emptyRefNames(), error: errorText(err) } : s)))
  }

  const confirmRestore = async () => {
    if (!restore) return
    setBusy(true)
    setRestoreError(null)
    try {
      await restoreRecord(restore.table, restore.id)
      if (restore.from === 'deleted') deleted.update((rows) => rows.filter((r) => !(r.table_name === restore.table && r.record_id === restore.id)))
      else feed.reload()
      setRestore(null)
      onRestored(restore.table)
    } catch (err) {
      setRestoreError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const runExport = async (signal: AbortSignal) => {
    const rows = await listAllAuditFeed(filters, signal)
    const ids = collectRefIds(rows.map((e) => ({ table: e.table_name, changes: entryChanges(e) })))
    const refNames = hasRefIds(ids) ? await loadRefNames(ids) : emptyRefNames()
    await exportWorkbook({ fileName: exportFileName(th.exportSection), sheets: [historySheet(rows, refNames)], signal })
  }

  const recordLabel = query.recordId
    ? (feed.rows?.find((e) => e.record_label)?.record_label ?? (query.table ? tableLabel(query.table) : query.recordId.slice(0, 8)))
    : null

  return (
    <HistoryShell
      tab={query.tab}
      onTab={(tab: HistoryTab) => onQuery({ tab })}
      actions={query.tab === 'feed' && <ExportButton run={runExport} />}
    >
      <HistoryFilters
        query={query}
        todayIso={todayIso}
        profiles={profiles}
        onQuery={onQuery}
        withFeedFilters={query.tab === 'feed'}
        extra={query.tab === 'feed' && recordLabel && <RecordChip label={recordLabel} onClear={() => onQuery({ recordId: '' })} />}
      />
      {query.invalid && <Notice tone="warn">{t.reports.rangeErrors[query.invalid]}</Notice>}

      {query.tab === 'feed' ? (
        <FeedList
          rows={feed.rows}
          hasMore={feed.hasMore}
          loadingMore={feed.loadingMore}
          error={feed.error}
          moreError={feed.moreError}
          onRetry={feed.reload}
          onLoadMore={feed.loadMore}
          onOpen={openDetail}
        />
      ) : (
        <DeletedList
          rows={deleted.rows}
          hasMore={deleted.hasMore}
          loadingMore={deleted.loadingMore}
          error={deleted.error}
          moreError={deleted.moreError}
          canRestore={canRestore}
          busy={busy}
          onRetry={deleted.reload}
          onLoadMore={deleted.loadMore}
          onRestore={(r) => {
            setRestoreError(null)
            const target = { from: 'deleted' as const, table: r.table_name, id: r.record_id, label: entryTitle(r), recordDate: null }
            setRestore(target)
            // Yozuv sanasi (o'tgan davr ogohlantirishi uchun); topilmasa — sanasiz
            getRecordDate(r.table_name, r.record_id)
              .then((date) => setRestore((cur) => (cur && cur.id === target.id && cur.table === target.table ? { ...cur, recordDate: date } : cur)))
              .catch(() => undefined)
          }}
        />
      )}

      {detail && !restore && (
        <EntryDetail
          entry={detail}
          names={names?.id === detail.id ? names.names : null}
          namesError={names?.id === detail.id ? names.error : null}
          canRestore={canRestore}
          showWholeHistory={query.recordId !== detail.record_id}
          restoredLater={restoredLater(detail, feed.rows ?? [])}
          onRestore={() => {
            setRestoreError(null)
            setRestore({ from: 'feed', table: detail.table_name, id: detail.record_id, label: entryTitle(detail), recordDate: entryRecordDate(detail) })
            setDetail(null)
          }}
          onClose={() => setDetail(null)}
        />
      )}
      {restore && (
        <RestoreConfirm
          label={restore.label}
          table={restore.table}
          recordDate={restore.recordDate}
          todayIso={todayIso}
          busy={busy}
          error={restoreError}
          onConfirm={() => void confirmRestore()}
          onClose={() => setRestore(null)}
        />
      )}
    </HistoryShell>
  )
}
