import { useState, type ReactNode } from 'react'
import { Calendar, Check, ChevronDown, Search, X } from 'lucide-react'
import { formatDate } from '@/lib/format'
import { t } from '@/i18n'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { Chip } from './Chip'
import { chipClass } from './chipClass'
import { cx } from './cx'
import { DateField } from './fields'
import { useIsMobile } from './useMediaQuery'

export interface FilterOption {
  value: string
  label: string
}

interface Base {
  key: string
  label: string
}

/** Variantlardan bittasi. `options` — "Hammasi" ham shu ro'yxatda (qiymati `emptyValue`). */
export interface SelectFilter extends Base {
  kind: 'select'
  value: string
  onChange: (value: string) => void
  options: FilterOption[]
  /** "Tanlanmagan" qiymat (standart ''). */
  emptyValue?: string
}

export interface DateRangeFilter extends Base {
  kind: 'dateRange'
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  fromLabel: string
  toLabel: string
}

export interface ToggleFilter extends Base {
  kind: 'toggle'
  checked: boolean
  onChange: (checked: boolean) => void
}

export interface SearchFilter extends Base {
  kind: 'search'
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

export type FilterDef = SelectFilter | DateRangeFilter | ToggleFilter | SearchFilter

function isActive(f: FilterDef): boolean {
  switch (f.kind) {
    case 'select':
      return f.value !== (f.emptyValue ?? '')
    case 'dateRange':
      return Boolean(f.from || f.to)
    case 'toggle':
      return f.checked
    case 'search':
      return f.value.trim() !== ''
  }
}

function selectedLabel(f: SelectFilter): string {
  return f.options.find((o) => o.value === f.value)?.label ?? f.value
}

function rangeText(f: DateRangeFilter): string {
  if (!f.from && !f.to) return t.ui.all
  const a = f.from ? formatDate(`${f.from}T12:00:00`) : '…'
  const b = f.to ? formatDate(`${f.to}T12:00:00`) : '…'
  return `${a} – ${b}`
}

/**
 * Filtrlar qatori. Kompyuterda — chiplar bir qatorda (ichida haqiqiy `select`/`input`, klaviatura va
 * ekran o'quvchi bilan), telefonda (< 768 px) — gorizontal aylanuvchi chiplar, bosilganda `BottomSheet`.
 */
export function FilterBar({
  filters,
  onClear,
  label = t.ui.filters,
  extra,
  className,
}: {
  filters: FilterDef[]
  /** Berilsa va biror filtr faol bo'lsa — "Tozalash". */
  onClear?: () => void
  /** Forma nomi (role="form"). */
  label?: string
  /** Qator oxiridagi qo'shimcha element (masalan, tugma). */
  extra?: ReactNode
  className?: string
}) {
  const mobile = useIsMobile()
  const anyActive = filters.some((f) => f.kind !== 'search' && isActive(f))
  const clear = onClear && anyActive && (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-semibold text-brand hover:bg-ice"
    >
      <X aria-hidden className="size-4" strokeWidth={2} />
      {t.ui.clearFilters}
    </button>
  )

  return (
    <form aria-label={label} onSubmit={(e) => e.preventDefault()} className={className}>
      {mobile ? <MobileBar filters={filters} clear={clear} extra={extra} /> : <DesktopBar filters={filters} clear={clear} extra={extra} />}
    </form>
  )
}

function DesktopBar({ filters, clear, extra }: { filters: FilterDef[]; clear: ReactNode; extra: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((f) => {
        const active = isActive(f)
        switch (f.kind) {
          case 'search':
            return <SearchBox key={f.key} f={f} className="w-full max-w-xs" />
          case 'select':
            return (
              <div key={f.key} className={cx(chipClass(active), 'relative pr-2')}>
                <span aria-hidden className={active ? 'text-brand/80' : 'text-muted'}>
                  {f.label}:
                </span>
                <select
                  aria-label={f.label}
                  value={f.value}
                  onChange={(e) => f.onChange(e.target.value)}
                  className="max-w-52 cursor-pointer appearance-none bg-transparent pr-6 font-semibold text-inherit outline-none"
                >
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute right-3 size-4 opacity-70" strokeWidth={1.75} />
              </div>
            )
          case 'dateRange':
            return (
              <div key={f.key} role="group" aria-label={f.label} className={cx(chipClass(active), 'gap-1 pr-1.5')}>
                <Calendar aria-hidden className="size-4 opacity-70" strokeWidth={1.75} />
                <input
                  type="date"
                  aria-label={f.fromLabel}
                  value={f.from}
                  max={f.to || undefined}
                  onChange={(e) => f.onFrom(e.target.value)}
                  className="tabular min-h-9 rounded-md bg-transparent px-1 text-sm outline-none"
                />
                <span aria-hidden className="text-muted">
                  –
                </span>
                <input
                  type="date"
                  aria-label={f.toLabel}
                  value={f.to}
                  min={f.from || undefined}
                  onChange={(e) => f.onTo(e.target.value)}
                  className="tabular min-h-9 rounded-md bg-transparent px-1 text-sm outline-none"
                />
              </div>
            )
          case 'toggle':
            return (
              <label key={f.key} className={cx(chipClass(f.checked), 'cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand')}>
                <input type="checkbox" className="peer sr-only" checked={f.checked} onChange={(e) => f.onChange(e.target.checked)} />
                <span
                  aria-hidden
                  className={cx(
                    'inline-flex size-4 items-center justify-center rounded border',
                    f.checked ? 'border-brand bg-brand text-white' : 'border-[#b8c4d8] bg-paper',
                  )}
                >
                  {f.checked && <Check className="size-3" strokeWidth={3} />}
                </span>
                {f.label}
              </label>
            )
        }
      })}
      {extra}
      {clear}
    </div>
  )
}

function SearchBox({ f, className }: { f: SearchFilter; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" strokeWidth={1.75} />
      <input
        type="search"
        aria-label={f.label}
        placeholder={f.placeholder ?? f.label}
        value={f.value}
        onChange={(e) => f.onChange(e.target.value)}
        className="min-h-11 w-full rounded-full border border-line bg-paper pr-4 pl-10 text-base outline-none placeholder:text-muted/70 focus:border-brand focus:ring-3 focus:ring-brand/15"
      />
    </div>
  )
}

function MobileBar({ filters, clear, extra }: { filters: FilterDef[]; clear: ReactNode; extra: ReactNode }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const open = filters.find((f) => f.key === openKey) ?? null
  const close = () => setOpenKey(null)
  const search = filters.filter((f): f is SearchFilter => f.kind === 'search')
  const rest = filters.filter((f) => f.kind !== 'search')

  return (
    <div className="flex flex-col gap-2">
      {search.map((f) => (
        <SearchBox key={f.key} f={f} />
      ))}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5">
        {rest.map((f) => {
          const active = isActive(f)
          if (f.kind === 'toggle')
            return (
              <Chip key={f.key} label={f.label} active={f.checked} caret={false} aria-pressed={f.checked} onClick={() => f.onChange(!f.checked)}
                icon={f.checked ? <Check aria-hidden className="size-4" strokeWidth={2.25} /> : undefined}
              />
            )
          if (f.kind === 'select')
            return (
              <Chip
                key={f.key}
                label={f.label}
                value={selectedLabel(f)}
                active={active}
                aria-haspopup="dialog"
                onClick={() => setOpenKey(f.key)}
              />
            )
          if (f.kind === 'dateRange')
            return (
              <Chip
                key={f.key}
                label={f.label}
                value={rangeText(f)}
                active={active}
                icon={<Calendar aria-hidden className="size-4" strokeWidth={1.75} />}
                aria-haspopup="dialog"
                onClick={() => setOpenKey(f.key)}
              />
            )
          return null
        })}
        {extra}
        {clear}
      </div>
      {open?.kind === 'select' && (
        <BottomSheet title={open.label} onClose={close}>
          <div role="radiogroup" aria-label={open.label} className="flex flex-col">
            {open.options.map((o) => {
              const selected = o.value === open.value
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    open.onChange(o.value)
                    close()
                  }}
                  className={cx(
                    'flex min-h-12 items-center justify-between gap-3 rounded-xl px-3 text-left text-base',
                    selected ? 'bg-ice font-semibold text-brand' : 'text-ink hover:bg-canvas',
                  )}
                >
                  {o.label}
                  {selected && <Check aria-hidden className="size-5" strokeWidth={2} />}
                </button>
              )
            })}
          </div>
        </BottomSheet>
      )}
      {open?.kind === 'dateRange' && (
        <BottomSheet
          title={open.label}
          onClose={close}
          footer={
            <Button className="flex-1" size="lg" onClick={close}>
              {t.ui.done}
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-3 px-2 pt-1">
            <DateField label={open.fromLabel} value={open.from} onChange={open.onFrom} max={open.to || undefined} />
            <DateField label={open.toLabel} value={open.to} onChange={open.onTo} min={open.from || undefined} />
          </div>
        </BottomSheet>
      )}
    </div>
  )
}
