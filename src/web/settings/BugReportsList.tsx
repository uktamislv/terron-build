import { useState } from 'react'
import { Bug, Image as ImageIcon } from 'lucide-react'
import { MovementPhoto } from '@/components/MovementPhoto'
import { Badge, Button, chipClass, EmptyState, ErrorState, Modal, Notice, Pager, SkeletonRows, useToast, type BadgeTone } from '@/components/ui'
import {
  BUG_REPORT_STATUSES,
  BUG_REPORTS_PAGE_SIZE,
  listBugReports,
  setBugReportStatus,
  type BugReport,
  type BugReportStatus,
} from '@/data/bugReportsRepo'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDateTime } from '@/lib/format'
import { useLoad } from '@/lib/useLoad'

const tb = t.bugReports

const BUG_STATUS_TONE: Record<BugReportStatus, BadgeTone> = {
  yangi: 'danger',
  korildi: 'warn',
  hal_qilindi: 'ok',
}

/** Joriy holatdan keyingi amallar. */
function nextStatuses(status: BugReportStatus): { status: BugReportStatus; label: string }[] {
  if (status === 'yangi')
    return [
      { status: 'korildi', label: tb.markSeen },
      { status: 'hal_qilindi', label: tb.markResolved },
    ]
  if (status === 'korildi')
    return [
      { status: 'hal_qilindi', label: tb.markResolved },
      { status: 'yangi', label: tb.reopen },
    ]
  return [{ status: 'yangi', label: tb.reopen }]
}

function Meta({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex min-w-0 gap-1.5 text-xs">
      <dt className="shrink-0 text-muted">{label}:</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  )
}

/** Admin: firmaning xatolik xabarlari — holat filtri, holatni o'zgartirish, rasm. */
export function BugReportsList() {
  const toast = useToast()
  const [status, setStatus] = useState<BugReportStatus | null>(null)
  const [page, setPage] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [photo, setPhoto] = useState<BugReport | null>(null)
  const list = useLoad(() => listBugReports(status ? { status } : {}, page), `${status ?? 'all'}:${page}`)

  const pickStatus = (next: BugReportStatus | null) => {
    setStatus(next)
    setPage(0)
    setActionError(null)
  }

  const change = async (report: BugReport, next: BugReportStatus) => {
    if (busyId) return
    setBusyId(report.id)
    setActionError(null)
    try {
      await setBugReportStatus(report.id, next)
      toast.show(tb.statusSaved, 'ok')
      list.reload()
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusyId(null)
    }
  }

  const filters: { key: BugReportStatus | null; label: string }[] = [
    { key: null, label: tb.all },
    ...BUG_REPORT_STATUSES.map((s) => ({ key: s, label: tb.statuses[s] })),
  ]

  return (
    <section aria-label={tb.title} className="flex flex-col gap-4">
      <div role="group" aria-label={tb.statusFilter} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {filters.map((f) => (
          <button key={f.key ?? 'all'} type="button" aria-pressed={status === f.key} className={chipClass(status === f.key)} onClick={() => pickStatus(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {actionError && <Notice>{actionError}</Notice>}

      {list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <SkeletonRows rows={3} />
      ) : list.data.rows.length === 0 ? (
        <EmptyState icon={<Bug strokeWidth={1.5} />} title={tb.empty} text={tb.emptyHint} />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {list.data.rows.map((r) => (
              <li key={r.id} data-testid="bug-report" className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge tone={BUG_STATUS_TONE[r.status]}>{tb.statuses[r.status]}</Badge>
                  <span className="text-sm font-semibold text-ink">{r.author_name ?? tb.unknownAuthor}</span>
                  {r.author_role && <span className="text-sm text-muted">{t.roles[r.author_role]}</span>}
                  <span className="tabular ml-auto text-sm text-muted">{formatDateTime(r.created_at)}</span>
                </div>
                <p className="text-base break-words whitespace-pre-wrap text-ink">{r.message}</p>
                <dl className="flex flex-col gap-0.5">
                  <Meta label={tb.screen} value={r.screen} />
                  <Meta label={tb.client} value={r.client} />
                  <Meta label={tb.version} value={r.app_version} />
                </dl>
                <div className="flex flex-wrap gap-2">
                  {r.photo_path && (
                    <Button variant="secondary" icon={<ImageIcon aria-hidden className="size-5" strokeWidth={1.75} />} onClick={() => setPhoto(r)}>
                      {tb.showPhoto}
                    </Button>
                  )}
                  {nextStatuses(r.status).map((a) => (
                    <Button
                      key={a.status}
                      variant={a.status === 'yangi' ? 'ghost' : 'secondary'}
                      disabled={busyId !== null}
                      onClick={() => void change(r, a.status)}
                    >
                      {a.label}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {list.data.total > BUG_REPORTS_PAGE_SIZE && (
            <Pager page={page} pageSize={BUG_REPORTS_PAGE_SIZE} total={list.data.total} onPage={setPage} />
          )}
        </>
      )}

      {photo?.photo_path && (
        <Modal title={tb.photoTitle} onClose={() => setPhoto(null)} size="lg">
          <MovementPhoto path={photo.photo_path} alt={tb.photoTitle} />
        </Modal>
      )}
    </section>
  )
}
