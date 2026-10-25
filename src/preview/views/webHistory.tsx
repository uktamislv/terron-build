/* eslint-disable react-refresh/only-export-components -- ko'rgazma: ekranlar ro'yxati va ularning kichik o'ramlari bitta faylda */
// Ko'rgazma: veb "O'zgarishlar tarixi" (faqat DEV). Haqiqiy taqdimot komponentlari fixture bilan — repo chaqirilmaydi.
import { useMemo, useState } from 'react'
import { emptyRefNames, type AuditEntry, type DeletedRecord, type RefNames } from '@/data/historyRepo'
import { tashkentIsoDate } from '@/lib/format'
import { DeletedList, EntryDetail, FeedList, HistoryFilters, HistoryShell, type HistoryPatch } from '@/web/history/HistoryView'
import { readHistoryQuery, type HistoryQuery } from '@/web/history/historyQuery'
import { hoursAgo, previewObjects, previewProfile } from '../fixtures'
import type { PreviewView } from '../types'

const M_SEMENT = '11111111-1111-4111-8111-111111111111'
const O_1 = '22222222-2222-4222-8222-222222222222'
const O_2 = '33333333-3333-4333-8333-333333333333'
const U_QOP = '44444444-4444-4444-8444-444444444444'

const names: RefNames = {
  ...emptyRefNames(),
  materials: { [M_SEMENT]: 'Sement M400' },
  objects: { [O_1]: previewObjects[0]?.name ?? '', [O_2]: previewObjects[1]?.name ?? '' },
  units: { [U_QOP]: 'qop' },
}

let seq = 1000
function entry(p: Partial<AuditEntry>): AuditEntry {
  seq -= 1
  return {
    id: seq,
    created_at: hoursAgo(seq % 30),
    table_name: 'movements',
    record_id: '55555555-5555-4555-8555-555555555555',
    action: 'UPDATE',
    actor_profile_id: 'pv-admin',
    actor_name: 'Aziz Karimov',
    device: 'veb',
    changed_fields: null,
    old_data: null,
    new_data: null,
    record_label: null,
    ...p,
  }
}

const mv = { material_id: M_SEMENT, object_id: O_1, unit_id: U_QOP, type: 'kirim', qty_input: '30', qty_base: '1500', note: null }

const feed: AuditEntry[] = [
  entry({
    record_label: 'Sement M400 · 30 qop kirim',
    old_data: { ...mv, qty_input: '20', qty_base: '1000', object_id: O_2 },
    new_data: mv,
    changed_fields: ['qty_input', 'qty_base', 'object_id'],
  }),
  entry({ action: 'INSERT', device: 'mobil', actor_name: 'Bekzod (prorab)', record_label: 'Sement M400 · 30 qop kirim', new_data: mv }),
  entry({
    table_name: 'purchases',
    action: 'SOFT_DELETE',
    record_label: 'Sement M400 · 2 500 000 so‘m',
    old_data: { deleted_at: null },
    new_data: { deleted_at: hoursAgo(5) },
    changed_fields: ['deleted_at'],
  }),
  entry({ table_name: 'materials', action: 'RESTORE', record_label: 'Armatura Ø12', old_data: { deleted_at: hoursAgo(30) }, new_data: { deleted_at: null }, changed_fields: ['deleted_at'] }),
  entry({ table_name: 'auth', action: 'TG_LINK', device: 'tizim', actor_name: null, record_label: 'Bekzod (prorab)', new_data: {} }),
]

const deleted: DeletedRecord[] = [
  { table_name: 'purchases', record_id: '66666666-6666-4666-8666-666666666666', record_label: 'Sement M400 · 2 500 000 so‘m', deleted_at: hoursAgo(5), deleted_by_name: 'Aziz Karimov' },
  { table_name: 'movements', record_id: '77777777-7777-4777-8777-777777777777', record_label: 'Qum · 4 m³ chiqim', deleted_at: hoursAgo(26), deleted_by_name: 'Aziz Karimov' },
]

function HistoryPreview() {
  const todayIso = useMemo(() => tashkentIsoDate(), [])
  const [query, setQuery] = useState<HistoryQuery>(() => readHistoryQuery(new URLSearchParams(), todayIso))
  const [open, setOpen] = useState<AuditEntry | null>(null)
  const onQuery = (patch: HistoryPatch) => setQuery((q) => ({ ...q, ...patch }))
  return (
    <HistoryShell tab={query.tab} onTab={(tab) => onQuery({ tab })}>
      <HistoryFilters
        query={query}
        todayIso={todayIso}
        profiles={[previewProfile('admin'), previewProfile('prorab', 'Bekzod (prorab)')]}
        onQuery={onQuery}
        withFeedFilters={query.tab === 'feed'}
      />
      {query.tab === 'feed' ? (
        <FeedList rows={feed} hasMore loadingMore={false} onRetry={() => undefined} onLoadMore={() => undefined} onOpen={setOpen} />
      ) : (
        <DeletedList rows={deleted} hasMore={false} loadingMore={false} canRestore onRetry={() => undefined} onLoadMore={() => undefined} onRestore={() => undefined} />
      )}
      {open && (
        <EntryDetail entry={open} names={names} canRestore showWholeHistory onRestore={() => setOpen(null)} onClose={() => setOpen(null)} />
      )}
    </HistoryShell>
  )
}

export const views: PreviewView[] = [{ id: 'web-history', title: 'O‘zgarishlar tarixi', surface: 'web', role: 'admin', render: () => <HistoryPreview /> }]
