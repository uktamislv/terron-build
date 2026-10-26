// Batch 12 (H): obyektning tasdiqlangan so'rovlari — chip; bosilsa xarid to'ladi.
import { ClipboardCheck, X } from 'lucide-react'
import type { MaterialRequest } from '@/data/types'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { formatQty } from '@/lib/format'
import { SectionTitle } from '../ui'

const ta = t.tg.auto

function label(r: MaterialRequest): string {
  return `${formatQty(r.qty_input)} ${unitLabel({ unit: r.unit_input, variant: r.unit_variant })}`
}

function Chips({ requests, onPick }: { requests: MaterialRequest[]; onPick: (r: MaterialRequest) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {requests.map((r) => (
          <button
            key={r.id}
            type="button"
            data-testid="approved-request"
            onClick={() => onPick(r)}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-brand/30 bg-ice px-4 text-left text-sm font-semibold text-navy active:bg-brand/10"
          >
            <ClipboardCheck aria-hidden className="size-4 shrink-0 text-brand" strokeWidth={2} />
            <span>{r.material_name}</span>
            <span className="tabular font-normal text-muted">{label(r)}</span>
          </button>
      ))}
    </div>
  )
}

/** Obyekt bo'yicha guruhlash (kiritilgan tartib saqlanadi). */
function byObject(requests: MaterialRequest[]): { objectId: string; name: string; rows: MaterialRequest[] }[] {
  const groups = new Map<string, { objectId: string; name: string; rows: MaterialRequest[] }>()
  for (const r of requests) {
    const g = groups.get(r.object_id) ?? { objectId: r.object_id, name: r.object_name ?? '', rows: [] }
    g.rows.push(r)
    groups.set(r.object_id, g)
  }
  return [...groups.values()]
}

/**
 * Tasdiqlangan so'rovlar chiplari. `groupByObject` — ta'minotchi: barcha obyektlar, obyekt nomi ostida
 * guruhlangan; bosilsa obyekt ham tanlanadi.
 */
export function ApprovedRequestChips({
  requests,
  onPick,
  groupByObject = false,
}: {
  requests: MaterialRequest[]
  onPick: (r: MaterialRequest) => void
  groupByObject?: boolean
}) {
  if (requests.length === 0) return null
  return (
    <section aria-label={ta.approvedRequests} className="flex flex-col gap-2">
      <SectionTitle>{ta.approvedRequests}</SectionTitle>
      <p className="text-sm text-muted">{ta.approvedRequestsHint}</p>
      {groupByObject ? (
        byObject(requests).map((g) => (
          <div key={g.objectId} role="group" aria-label={g.name} data-testid="approved-group" className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold text-ink">{g.name}</p>
            <Chips requests={g.rows} onPick={onPick} />
          </div>
        ))
      ) : (
        <Chips requests={requests} onPick={onPick} />
      )}
    </section>
  )
}

/** Tanlangan so'rov belgisi va "So'rovsiz". */
export function RequestTag({ request, onClear }: { request: MaterialRequest; onClear: () => void }) {
  return (
    <div data-testid="request-tag" className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-brand/20 bg-ice px-3 py-1.5">
      <span className="flex items-center gap-2 text-sm font-semibold text-navy">
        <ClipboardCheck aria-hidden className="size-4 text-brand" strokeWidth={2} />
        {ta.byRequest(formatQty(request.qty_input), unitLabel({ unit: request.unit_input, variant: request.unit_variant }))}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-brand hover:bg-paper"
      >
        <X aria-hidden className="size-4" strokeWidth={2} />
        {ta.clearRequest}
      </button>
    </div>
  )
}
