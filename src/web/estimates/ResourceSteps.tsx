// Resurs smetasi (ЛРВ) rejimi: aniqlash banneri va katalog bosqichining yuqori qismi
// (asosiy materiallar ulushi, avtomatik moslash natijasi, bitta tugma bilan katalogga qo'shish).
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, FileSpreadsheet, PackagePlus, Settings2 } from 'lucide-react'
import { Button, LevelBar, Money, Notice, SegmentedControl, StatusBadge } from '@/components/ui'
import type { Dec } from '@/domain/decimal'
import { t } from '@/i18n'
import { formatQty } from '@/lib/format'
import { SHARE_OPTIONS, type MatchCounts, type ResourceSummary, type SharePct } from './resourceModel'

const tw = t.estimates.wizard
const tr = tw.resource

const KIND_ORDER = ['material', 'equipment', 'unknown', 'labor', 'machine'] as const

function KindTile({ label, rows, total }: { label: string; rows: number; total: Dec | null }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-paper p-3">
      <p className="text-sm text-muted">{label}</p>
      {total !== null ? <Money value={total} size="md" className="font-semibold" /> : <span className="text-muted">—</span>}
      <p className="tabular text-xs text-muted">{tr.rowsOf(rows)}</p>
    </div>
  )
}

/** "Resurs smetasi aniqlandi": ishlar, resurslar turlari bo'yicha, jami summalar (so'm). */
export function ResourceBanner({
  summary,
  dropped,
  onOpenSettings,
}: {
  summary: ResourceSummary
  dropped: number
  onOpenSettings: () => void
}) {
  // Qatori ham, jami ham bo'lmagan tur ko'rsatilmaydi (masalan, tur ustunlarisiz smetada uskuna)
  const kinds = KIND_ORDER.filter((k) => summary.byKind[k] > 0 || summary.totals[k] !== null)
  return (
    <section
      aria-label={tr.detected}
      data-testid="resource-banner"
      className="flex flex-col gap-3 rounded-2xl border border-brand/30 bg-ice/50 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-brand">
            <FileSpreadsheet aria-hidden className="size-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold text-navy">{tr.detected}</h3>
            <p className="text-sm text-muted">{tr.detectedHint}</p>
            <p className="tabular mt-1 text-sm text-ink">{tr.works(summary.works)}</p>
          </div>
        </div>
        <Button variant="secondary" icon={<Settings2 aria-hidden className="size-5" strokeWidth={1.75} />} onClick={onOpenSettings} title={tr.openSettingsHint}>
          {tr.openSettings}
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {kinds.map((k) => (
          <KindTile key={k} label={tr.kinds[k]} rows={summary.byKind[k]} total={summary.totals[k]} />
        ))}
        {summary.totals.grand !== null && (
          <div className="flex flex-col gap-1 rounded-xl border border-brand/40 bg-paper p-3">
            <p className="text-sm text-muted">{tr.grand}</p>
            <Money value={summary.totals.grand} size="md" className="font-semibold" />
          </div>
        )}
      </div>
      {summary.laborMachineRows > 0 && <p className="text-sm text-ink">{tr.skippedLaborMachine(summary.laborMachineRows)}</p>}
      {summary.byKind.unknown > 0 && <p className="text-sm text-ink">{tr.unknownNote(summary.byKind.unknown)}</p>}
      {summary.invalidRows > 0 && <Notice tone="warn">{tr.invalidRows(summary.invalidRows)}</Notice>}
      {dropped > 0 && <Notice tone="warn">{tr.dropped(dropped)}</Notice>}
    </section>
  )
}

/** Katalog bosqichi (resurs rejimi): ulush, moslash natijasi, katalogga qo'shish, yig'iladigan ro'yxat. */
export function ResourceCatalogPanel({
  totalMaterials,
  share,
  onShare,
  shareCount,
  sharePct,
  counts,
  newCount,
  canCatalog,
  creating,
  createNote,
  createError,
  onCreate,
  onNewAsWork,
  list,
}: {
  totalMaterials: number
  share: SharePct
  onShare: (s: SharePct) => void
  shareCount: number
  sharePct: Dec
  counts: MatchCounts
  /** Hali qarori yo'q yangi (asosiy, moslanmagan) materiallar. */
  newCount: number
  canCatalog: boolean
  creating: boolean
  createNote: string | null
  createError: string | null
  onCreate: () => void
  onNewAsWork: () => void
  /** Qatorma-qator moslash ro'yxati (standart yig'ilgan). */
  list: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const pctText = formatQty(sharePct, 1)
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={tr.shareLabel} className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-ink">{tr.shareLabel}</h3>
          <p className="tabular text-sm text-muted">{tr.materialsCount(totalMaterials)}</p>
        </div>
        <SegmentedControl
          label={tr.shareLabel}
          value={share}
          onChange={onShare}
          options={SHARE_OPTIONS.map((v) => ({ value: v, label: tr.shareOption(v) }))}
          className="max-w-md"
        />
        <p data-testid="resource-share" className="tabular font-semibold text-ink">
          {tr.shareResult(shareCount, pctText)}
        </p>
        <LevelBar value={Number(sharePct)} max={100} label={tr.shareResult(shareCount, pctText)} warnAt={2} showPercent={false} />
        <p className="text-sm text-muted">{tr.shareHint}</p>
      </section>

      <section aria-label={tr.materialsTitle} className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-4">
        <p data-testid="resource-match-summary" className="tabular font-semibold text-ink">
          {tr.matchSummary(counts.code, counts.name, counts.created)}
        </p>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={newCount > 0 ? 'warn' : 'ok'}>{tr.newCount(newCount)}</StatusBadge>
          {counts.minor > 0 && <StatusBadge tone="neutral">{tr.minorCount(counts.minor)}</StatusBadge>}
          {counts.unknown > 0 && <StatusBadge tone="neutral">{tr.unknownCount(counts.unknown)}</StatusBadge>}
          {counts.inactive > 0 && <StatusBadge tone="warn">{tr.inactiveCount(counts.inactive)}</StatusBadge>}
        </div>
        {newCount === 0 && <Notice tone="ok">{tr.allMatched}</Notice>}
        {newCount > 0 &&
          (canCatalog ? (
            <div>
              <Button
                loading={creating}
                disabled={creating}
                icon={<PackagePlus aria-hidden className="size-5" strokeWidth={1.75} />}
                onClick={onCreate}
              >
                {creating ? tr.creating : tr.create(newCount)}
              </Button>
            </div>
          ) : (
            <>
              <Notice tone="info">{tr.createAdminOnly}</Notice>
              <div>
                <Button variant="secondary" onClick={onNewAsWork}>
                  {tr.newAsWork(newCount)}
                </Button>
              </div>
            </>
          ))}
        {createNote && <Notice tone="ok">{createNote}</Notice>}
        {createError && <Notice>{createError}</Notice>}
      </section>

      <div className="flex flex-col gap-3">
        <div>
          <Button
            variant="ghost"
            aria-expanded={open}
            icon={open ? <ChevronUp aria-hidden className="size-5" strokeWidth={1.75} /> : <ChevronDown aria-hidden className="size-5" strokeWidth={1.75} />}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? tr.hide : tr.show}
          </Button>
          {!open && <span className="ml-2 text-sm text-muted">{tr.listHint}</span>}
        </div>
        {open && list}
      </div>
    </div>
  )
}
