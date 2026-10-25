// Import ustasining 1–4 qadamlari: fayl, varaq va sarlavha, ustunlar, qatorlar.
import { useId, useState, type ChangeEvent } from 'react'
import { StatusBadge, type BadgeTone } from '@/components/StatusBadge'
import { Button, Notice, Spinner, TextField } from '@/components/ui'
import type { EstimateImportTemplate, ObjectRow } from '@/data/types'
import { cellText } from '@/domain/estimate'
import type { ParsedRow } from '@/domain/estimate'
import { ESTIMATE_FIELDS, REQUIRED_FIELDS, type Cell, type ColumnMapping, type EstimateField } from '@/domain/estimate'
import { t } from '@/i18n'
import { formatDateTime, formatQty, formatSum } from '@/lib/format'
import { DateField, Pager, SelectField } from '../fields'
import { Checkbox } from './parts'
import { ACCEPTED_EXTENSIONS, type ReadError, type SheetData } from './readWorkbook'
import { chipClass, pageSlice } from './styles'
import {
  columnLetter,
  duplicateColumns,
  estimateDateValid,
  fixFromRow,
  isRowSkipped,
  PAGE_SIZE,
  validateFix,
  type RowFix,
} from './wizardModel'

const tw = t.estimates.wizard

// ---------------------------------------------------------------------------
// 1. Fayl
// ---------------------------------------------------------------------------

export function FileStep({
  objects,
  objectId,
  onObject,
  fileName,
  reading,
  readError,
  onFile,
  title,
  onTitle,
  estimateDate,
  onDate,
  showErrors,
}: {
  objects: readonly ObjectRow[]
  objectId: string
  onObject: (id: string) => void
  fileName: string | null
  reading: boolean
  readError: ReadError | null
  onFile: (file: File) => void
  title: string
  onTitle: (v: string) => void
  estimateDate: string
  onDate: (v: string) => void
  showErrors: boolean
}) {
  const fileId = useId()
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
    e.target.value = ''
  }
  return (
    <div className="flex flex-col gap-4">
      <SelectField label={t.estimates.object} value={objectId} onChange={onObject}>
        <option value="">{t.estimates.chooseObject}</option>
        {objects.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </SelectField>
      {showErrors && !objectId && <p className="text-xs text-danger">{tw.needObject}</p>}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fileId} className="text-sm font-medium text-slate-700">
          {tw.file}
        </label>
        <input
          id={fileId}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(',')}
          onChange={onChange}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-brand-light file:px-3 file:font-medium file:text-brand-dark"
        />
        <p className="text-xs text-slate-500">{tw.fileHint}</p>
      </div>
      {reading && <Spinner label={tw.reading} />}
      {readError && <Notice>{tw.fileErrors[readError]}</Notice>}
      {fileName && !reading && <Notice tone="info">{tw.fileChosen(fileName)}</Notice>}
      {showErrors && !fileName && !reading && <p className="text-xs text-danger">{tw.needFile}</p>}
      <TextField
        label={tw.titleLabel}
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        error={showErrors && !title.trim() ? tw.needTitle : null}
      />
      <DateField label={tw.dateLabel} value={estimateDate} onChange={onDate} />
      {!estimateDateValid(estimateDate) && <p className="text-xs text-danger">{tw.dateInvalid}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2. Varaq va sarlavha
// ---------------------------------------------------------------------------

const PREVIEW_ROWS = 30
const PREVIEW_COLS = 12

function width(rows: readonly Cell[][]): number {
  let w = 0
  for (const r of rows) w = Math.max(w, r.length)
  return w
}

export function SheetStep({
  sheets,
  sheetIndex,
  onSheet,
  headerRow,
  headerAuto,
  onHeader,
}: {
  sheets: readonly SheetData[]
  sheetIndex: number
  onSheet: (i: number) => void
  headerRow: number | null
  headerAuto: boolean
  onHeader: (i: number) => void
}) {
  const sheet = sheets[sheetIndex]
  const rows = sheet ? sheet.rows.slice(0, PREVIEW_ROWS) : []
  const cols = Math.min(width(rows), PREVIEW_COLS)
  return (
    <div className="flex flex-col gap-4">
      {sheets.length > 1 && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">{tw.sheet}</legend>
          <div className="flex flex-wrap gap-2">
            {sheets.map((s, i) => (
              <button key={s.name} type="button" aria-pressed={i === sheetIndex} className={chipClass(i === sheetIndex)} onClick={() => onSheet(i)}>
                {s.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {headerRow !== null && headerAuto && <Notice tone="ok">{tw.headerDetected(headerRow + 1)}</Notice>}
      {headerRow === null && <Notice tone="warn">{tw.headerNotFound}</Notice>}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-xs" aria-label={tw.previewRows}>
          <tbody>
            {rows.map((r, i) => {
              const selected = i === headerRow
              return (
                <tr key={i} className={`border-t border-slate-100 ${selected ? 'bg-brand-light font-semibold text-brand-dark' : ''}`}>
                  <td className="w-14 px-1 py-1">
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={tw.headerPick(i + 1)}
                      onClick={() => onHeader(i)}
                      className={`min-h-11 w-12 rounded-lg border text-xs ${selected ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white'}`}
                    >
                      {i + 1}
                    </button>
                  </td>
                  {Array.from({ length: cols }, (_, c) => (
                    <td key={c} className="max-w-48 truncate px-2 py-1">
                      {cellText(r[c])}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 3. Ustunlar
// ---------------------------------------------------------------------------

export function ColumnsStep({
  rows,
  headerRow,
  mapping,
  onMapping,
  source,
  template,
  onTemplate,
  missing,
}: {
  rows: readonly Cell[][]
  headerRow: number
  mapping: ColumnMapping
  onMapping: (field: EstimateField, col: number | undefined) => void
  source: 'auto' | 'template' | 'manual'
  /** Imzo bo'yicha topilgan firma shabloni. */
  template: EstimateImportTemplate | null
  /** true — shablonni qo'llash, false — qo'lda (avtomatik taklifdan) moslash. */
  onTemplate: (apply: boolean) => void
  missing: readonly EstimateField[]
}) {
  const header = rows[headerRow] ?? []
  const sample = rows.slice(headerRow + 1, headerRow + 6)
  const cols = Math.max(width([header, ...sample]), 1)
  const fieldOf = (c: number) => ESTIMATE_FIELDS.find((f) => mapping[f] === c)
  return (
    <div className="flex flex-col gap-4">
      {template && (
        <div className="flex flex-col gap-2 rounded-xl border border-ok/20 bg-ok/5 px-4 py-3 text-sm text-ok" role="status">
          {source === 'template' && <span className="font-medium">{tw.templateApplied}</span>}
          <span className="text-slate-700">
            {tw.templateInfo(
              template.name,
              template.created_by_name ?? '',
              template.last_used_at || template.updated_at ? formatDateTime((template.last_used_at ?? template.updated_at) as string) : '',
            )}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={source === 'template'} onClick={() => onTemplate(true)}>
              {tw.templateApply}
            </Button>
            <Button variant="ghost" disabled={source !== 'template'} onClick={() => onTemplate(false)}>
              {tw.templateManual}
            </Button>
          </div>
        </div>
      )}
      {!template && source === 'auto' && <Notice tone="info">{tw.autoMapped}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ESTIMATE_FIELDS.map((f) => {
          const required = (REQUIRED_FIELDS as readonly string[]).includes(f)
          return (
            <SelectField
              key={f}
              label={`${tw.fields[f]} (${required ? tw.required : tw.optional})`}
              value={mapping[f] === undefined ? '' : String(mapping[f])}
              onChange={(v) => onMapping(f, v === '' ? undefined : Number(v))}
            >
              <option value="">{tw.noColumn}</option>
              {Array.from({ length: cols }, (_, c) => (
                <option key={c} value={c}>
                  {tw.column(columnLetter(c), cellText(header[c]))}
                </option>
              ))}
            </SelectField>
          )
        })}
      </div>
      {missing.length > 0 && <Notice tone="warn">{tw.missingFields(missing.map((f) => tw.fields[f]).join(', '))}</Notice>}
      {duplicateColumns(mapping) && <Notice tone="warn">{tw.duplicateColumn}</Notice>}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-xs" aria-label={tw.sample}>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {Array.from({ length: cols }, (_, c) => {
                const f = fieldOf(c)
                return (
                  <th key={c} className={`px-2 py-2 align-bottom font-medium ${f ? 'bg-brand-light text-brand-dark' : ''}`}>
                    <span className="block text-[11px] text-slate-500">{columnLetter(c)}</span>
                    {f && <span className="block font-semibold">{tw.fields[f]}</span>}
                    <span className="block max-w-48 truncate">{cellText(header[c])}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sample.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} className={`max-w-48 truncate px-2 py-1 ${fieldOf(c) ? 'bg-brand-light/40' : ''}`}>
                    {cellText(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 4. Qatorlar
// ---------------------------------------------------------------------------

function FixForm({ row, initial, onSave, onCancel }: { row: ParsedRow; initial: RowFix; onSave: (f: RowFix) => void; onCancel: () => void }) {
  const [fix, setFix] = useState<RowFix>(initial)
  const [submitted, setSubmitted] = useState(false)
  const valid = validateFix(fix) !== null
  const set = (patch: Partial<RowFix>) => setFix((f) => ({ ...f, ...patch }))
  return (
    <form
      noValidate
      aria-label={tw.fixTitle(row.rowNumber)}
      onSubmit={(e) => {
        e.preventDefault()
        setSubmitted(true)
        if (valid) onSave(fix)
      }}
      className="mt-2 flex flex-col gap-3 rounded-xl border border-brand/30 bg-brand-light/40 p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField label={tw.fixName} value={fix.name} onChange={(e) => set({ name: e.target.value })} />
        <TextField label={tw.fixUnit} value={fix.unit} onChange={(e) => set({ unit: e.target.value })} />
        <TextField label={tw.fixQty} inputMode="decimal" value={fix.qty} onChange={(e) => set({ qty: e.target.value })} />
        <TextField label={tw.fixPrice} inputMode="decimal" value={fix.price} onChange={(e) => set({ price: e.target.value })} />
      </div>
      {submitted && !valid && <p className="text-xs text-danger">{tw.fixInvalid}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button type="submit">{t.common.save}</Button>
      </div>
    </form>
  )
}

type RowState = 'item' | 'section' | 'total' | 'invalid' | 'fixed' | 'skipped'

const ROW_TONES: Record<RowState, BadgeTone> = {
  item: 'ok',
  section: 'neutral',
  total: 'neutral',
  invalid: 'danger',
  fixed: 'info',
  skipped: 'neutral',
}

export function RowsStep({
  parsed,
  fixes,
  skipped,
  hidden,
  onFix,
  onSkip,
  summary,
}: {
  parsed: readonly ParsedRow[]
  fixes: Readonly<Record<number, RowFix>>
  skipped: Readonly<Record<number, boolean>>
  hidden: ReadonlySet<number>
  onFix: (rowNumber: number, fix: RowFix | null) => void
  onSkip: (rowNumber: number, skip: boolean) => void
  summary: { items: number; skipped: number; invalid: number }
}) {
  const [onlyProblems, setOnlyProblems] = useState(summary.invalid > 0)
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<number | null>(null)

  const stateOf = (r: ParsedRow): RowState => {
    if (isRowSkipped(r.rowNumber, skipped, hidden)) return 'skipped'
    if (r.kind === 'invalid') return fixes[r.rowNumber] && validateFix(fixes[r.rowNumber] as RowFix) ? 'fixed' : 'invalid'
    return r.kind === 'empty' ? 'section' : r.kind
  }
  const visible = parsed.filter(
    (r) => r.kind !== 'empty' && (!onlyProblems || r.kind === 'invalid' || hidden.has(r.rowNumber)),
  )
  const lastPage = Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1)
  const current = Math.min(page, lastPage)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-700">{tw.rowsSummary(summary.items, summary.skipped, summary.invalid)}</p>
      {summary.invalid > 0 && <Notice tone="warn">{tw.unresolvedRows(summary.invalid)}</Notice>}
      <Checkbox
        label={tw.onlyProblems}
        checked={onlyProblems}
        onChange={(v) => {
          setOnlyProblems(v)
          setPage(0)
        }}
      />
      <ul className="flex flex-col gap-2" aria-label={tw.steps.rows}>
        {pageSlice(visible, current, PAGE_SIZE).map((r) => {
          const st = stateOf(r)
          const fix = fixes[r.rowNumber]
          const messages = [
            ...r.errors.map((e) => tw.rowErrors[e]),
            ...(r.kind === 'invalid' && !r.name ? [tw.rowErrors.name_missing] : []),
          ]
          return (
            <li key={r.rowNumber} data-testid={`row-${r.rowNumber}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-12 text-slate-500">{r.rowNumber}</span>
                <StatusBadge tone={ROW_TONES[st]}>{tw.kinds[st]}</StatusBadge>
                {hidden.has(r.rowNumber) && (
                  <span title={tw.hiddenHint}>
                    <StatusBadge tone="warn">{tw.hidden}</StatusBadge>
                  </span>
                )}
                <span className="min-w-0 flex-1 font-medium text-slate-900">{fix?.name || r.name || '—'}</span>
                {r.kind !== 'section' && r.kind !== 'total' && (
                  <span className="text-slate-700">
                    {r.qty !== null ? formatQty(r.qty) : '—'} {r.unit} · {r.price !== null ? formatSum(r.price) : '—'}
                  </span>
                )}
              </div>
              {messages.length > 0 && (
                <p className={`mt-1 text-xs ${r.kind === 'invalid' ? 'text-danger' : 'text-warn'}`}>{messages.join(', ')}</p>
              )}
              {(r.kind === 'invalid' || (r.kind === 'item' && hidden.has(r.rowNumber))) && editing !== r.rowNumber && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {st !== 'skipped' && r.kind === 'invalid' && (
                    <Button variant="secondary" onClick={() => setEditing(r.rowNumber)}>
                      {tw.fix}
                    </Button>
                  )}
                  {st === 'skipped' ? (
                    <Button variant="ghost" onClick={() => onSkip(r.rowNumber, false)}>
                      {tw.unskip}
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => onSkip(r.rowNumber, true)}>
                      {tw.skip}
                    </Button>
                  )}
                </div>
              )}
              {editing === r.rowNumber && (
                <FixForm
                  row={r}
                  initial={fix ?? fixFromRow(r)}
                  onCancel={() => setEditing(null)}
                  onSave={(f) => {
                    onFix(r.rowNumber, f)
                    setEditing(null)
                  }}
                />
              )}
            </li>
          )
        })}
      </ul>
      {visible.length > PAGE_SIZE && <Pager page={current} pageSize={PAGE_SIZE} total={visible.length} onPage={setPage} />}
    </div>
  )
}
