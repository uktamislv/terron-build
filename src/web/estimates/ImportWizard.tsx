// Smeta import ustasi (docs/estimate-design.md, "Oqim" 1–8). Bosqichlar ko'rinadi, orqaga qaytish
// mumkin — barcha tanlovlar shu komponent holatida saqlanadi.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Notice, Spinner } from '@/components/ui'
import { listEstimateItems, listEstimates } from '@/data/estimatesRepo'
import { findTemplateBySignature } from '@/data/estimateTemplatesRepo'
import { listMaterials } from '@/data/materialsRepo'
import { errorCodeOf } from '@/data/errors'
import type { EstimateImportTemplate, Material, ObjectRow } from '@/data/types'
import {
  autoMapColumns,
  detectHeaderRow,
  headerSignature,
  parseRows,
  validateMapping,
  type Cell,
  type ColumnMapping,
  type DiffItem,
  type EstimateField,
} from '@/domain/estimate'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { uuid } from '@/lib/uuid'
import { CatalogStep } from './CatalogStep'
import { readWorkbook, WorkbookError, type ReadError, type SheetData } from './readWorkbook'
import { ReviewStep } from './ReviewStep'
import { emptyProgress, saveImport, type SaveProgress, type SaveStep } from './saveImport'
import { UnitsStep } from './UnitsStep'
import {
  buildPlan,
  collectItems,
  duplicateColumns,
  estimateDateValid,
  estimateItemsToDiff,
  MAX_IMPORT_ROWS,
  shiftRowNumbers,
  mappingRecord,
  newMaterialProblem,
  sanitizeMapping,
  titleFromFileName,
  type Decision,
  type RowFix,
  type UnitAnswer,
} from './wizardModel'
import { ColumnsStep, FileStep, RowsStep, SheetStep } from './wizardSteps'

const tw = t.estimates.wizard

const STEPS = ['file', 'sheet', 'columns', 'rows', 'catalog', 'units', 'review', 'save'] as const
type StepKey = (typeof STEPS)[number]

const EMPTY_ROWS: Cell[][] = []

type SaveState = { status: 'saving'; step: SaveStep } | { status: 'error'; message: string; idReused: boolean } | null

export function ImportWizard({
  companyId,
  objects,
  initialObjectId,
  canCatalog,
  onCancel,
  onSaved,
}: {
  companyId: string
  objects: readonly ObjectRow[]
  initialObjectId: string
  /** Yangi material / birlik / muqobil nom yaratish (admin). */
  canCatalog: boolean
  onCancel: () => void
  onSaved: (estimateId: string, objectId: string) => void
}) {
  const [step, setStep] = useState(0)
  const [maxStep, setMaxStep] = useState(0)
  const [showErrors, setShowErrors] = useState(false)

  const [objectId, setObjectId] = useState(initialObjectId)
  const [fileName, setFileName] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<ReadError | null>(null)
  const [sheets, setSheets] = useState<SheetData[] | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [headerRow, setHeaderRow] = useState<number | null>(null)
  const [headerAuto, setHeaderAuto] = useState(false)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [mappingSource, setMappingSource] = useState<'auto' | 'template' | 'manual'>('auto')
  const [template, setTemplate] = useState<EstimateImportTemplate | null>(null)
  const [title, setTitle] = useState('')
  const [estimateDate, setEstimateDate] = useState('')
  const [fixes, setFixes] = useState<Record<number, RowFix>>({})
  const [skipped, setSkipped] = useState<Record<number, boolean>>({})
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [answers, setAnswers] = useState<Record<string, UnitAnswer>>({})

  const [materials, setMaterials] = useState<Material[] | null>(null)
  const [materialsError, setMaterialsError] = useState<string | null>(null)
  const [prev, setPrev] = useState<{ objectId: string; items: DiffItem[] | 'none' } | null>(null)
  const [prevError, setPrevError] = useState<string | null>(null)
  const [save, setSave] = useState<SaveState>(null)

  // Klient id (import_estimate idempotent) va yaratilganlar — qayta urinishda takrorlanmaydi
  const [estimateId, setEstimateId] = useState(() => uuid())
  const progressRef = useRef<SaveProgress>(emptyProgress())
  // Shablon javobi kech kelsa — faqat shu sarlavha hali tanlangan va qo'lda o'zgartirilmagan bo'lsa
  const signatureRef = useRef<string | null>(null)
  const touchedRef = useRef(false)

  useEffect(() => {
    let alive = true
    listMaterials()
      .then((list) => alive && setMaterials(list))
      .catch((err: unknown) => alive && setMaterialsError(errorText(err)))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!objectId) return
    let alive = true
    listEstimates(objectId)
      .then(async (list) => {
        const current = list.find((e) => e.is_current)
        const items = current ? estimateItemsToDiff(await listEstimateItems(current.id)) : 'none'
        if (alive) setPrev({ objectId, items })
      })
      .catch((err: unknown) => alive && setPrevError(errorText(err)))
    return () => {
      alive = false
    }
  }, [objectId])

  const sheet = sheets?.[sheetIndex]
  const rows = sheet?.rows ?? EMPTY_ROWS
  const rowOffset = sheet?.rowOffset ?? 0
  const hidden = useMemo(() => new Set(sheet?.hiddenRows ?? []), [sheet])
  const missing = validateMapping(mapping)
  const parsed = useMemo(
    () =>
      headerRow === null || validateMapping(mapping).length > 0
        ? []
        : shiftRowNumbers(parseRows(rows, headerRow, mapping), rowOffset),
    [rows, headerRow, mapping, rowOffset],
  )
  const collected = useMemo(() => collectItems(parsed, fixes, skipped, hidden), [parsed, fixes, skipped, hidden])
  const plan = useMemo(
    () => buildPlan({ items: collected.items, materials: materials ?? [], decisions, answers, canCatalog }),
    [collected.items, materials, decisions, answers, canCatalog],
  )
  const newProblems = useMemo(
    () => Object.values(decisions).filter((d) => newMaterialProblem(d, materials ?? []) !== null).length,
    [decisions, materials],
  )

  function applyHeader(sheetRows: Cell[][], h: number | null) {
    touchedRef.current = false
    if (h === null) {
      signatureRef.current = null
      setTemplate(null)
      setMapping({})
      setMappingSource('auto')
      return
    }
    const header = sheetRows[h] ?? []
    const signature = headerSignature(header)
    signatureRef.current = signature
    setMapping(autoMapColumns(header))
    setMappingSource('auto')
    setTemplate(null)
    findTemplateBySignature(companyId, signature)
      .then((tpl) => {
        if (!tpl || signatureRef.current !== signature || touchedRef.current) return
        const m = sanitizeMapping(tpl.mapping, Math.max(header.length, 1))
        if (validateMapping(m).length > 0) return
        setTemplate(tpl)
        setMapping(m)
        setMappingSource('template')
      })
      .catch(() => undefined)
  }

  function selectSheet(all: SheetData[], i: number) {
    const sheetRows = all[i]?.rows ?? []
    const h = detectHeaderRow(sheetRows)
    setSheetIndex(i)
    setHeaderRow(h)
    setHeaderAuto(h !== null)
    setFixes({})
    setSkipped({})
    applyHeader(sheetRows, h)
  }

  function onFile(file: File) {
    setReading(true)
    setReadError(null)
    readWorkbook(file)
      .then((all) => {
        const prevDefault = fileName ? titleFromFileName(fileName) : ''
        setSheets(all)
        setFileName(file.name)
        setTitle((cur) => (cur.trim() === '' || cur === prevDefault ? titleFromFileName(file.name) : cur))
        selectSheet(all, 0)
      })
      .catch((err: unknown) => setReadError(err instanceof WorkbookError ? err.reason : 'file_unreadable'))
      .finally(() => setReading(false))
  }

  const stepKey: StepKey = STEPS[step] ?? 'file'
  const canNext: Record<StepKey, boolean> = {
    file: Boolean(objectId && sheets && title.trim()) && !reading && estimateDateValid(estimateDate),
    sheet: headerRow !== null,
    columns: missing.length === 0 && !duplicateColumns(mapping),
    rows: collected.openInvalid === 0 && collected.items.length > 0,
    catalog: materials !== null && plan.unresolvedGroups === 0 && newProblems === 0,
    units: plan.unresolvedQuestions === 0,
    review: plan.rows.length > 0 && plan.rows.length <= MAX_IMPORT_ROWS,
    save: false,
  }

  function go(next: number) {
    setStep(next)
    setMaxStep((m) => Math.max(m, next))
  }

  function onNext() {
    if (!canNext[stepKey]) {
      setShowErrors(true)
      return
    }
    setShowErrors(false)
    go(step + 1)
  }

  async function runSave() {
    go(STEPS.indexOf('save'))
    setSave({ status: 'saving', step: 'materials' })
    try {
      const header = headerRow !== null ? rows[headerRow] ?? [] : []
      const id = await saveImport(
        {
          plan,
          companyId,
          estimateId,
          objectId,
          title,
          sourceFileName: fileName,
          estimateDate: estimateDate || null,
          template:
            headerRow !== null
              ? {
                  signature: headerSignature(header),
                  mapping: mappingRecord(mapping),
                  sheetName: sheets?.[sheetIndex]?.name ?? null,
                  headerRow,
                  name: tw.templateName(fileName ?? ''),
                }
              : null,
        },
        progressRef.current,
        (s) => setSave({ status: 'saving', step: s }),
      )
      setSave(null)
      onSaved(id, objectId)
    } catch (err) {
      setSave({ status: 'error', message: errorText(err), idReused: errorCodeOf(err) === 'estimate_id_reused' })
    }
  }

  const blockedMessage: Partial<Record<StepKey, string | null>> = {
    rows:
      collected.openInvalid > 0
        ? tw.unresolvedRows(collected.openInvalid)
        : collected.items.length === 0 && parsed.length > 0
          ? tw.noItems
          : null,
    catalog: plan.unresolvedGroups > 0 ? tw.unresolvedMatches(plan.unresolvedGroups) : null,
    units: plan.unresolvedQuestions > 0 ? tw.unresolvedUnits(plan.unresolvedQuestions) : null,
    review: plan.rows.length > MAX_IMPORT_ROWS ? tw.tooManyRows(plan.rows.length, MAX_IMPORT_ROWS) : null,
  }
  const saving = save?.status === 'saving'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-brand-dark">{tw.title}</h1>
        <Button variant="secondary" disabled={saving} onClick={onCancel}>
          {tw.cancel}
        </Button>
      </div>

      <nav aria-label={tw.title}>
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((key, i) => {
            const active = i === step
            const reachable = i <= maxStep && !saving && key !== 'save'
            return (
              <li key={key}>
                <button
                  type="button"
                  disabled={!reachable || active}
                  aria-current={active ? 'step' : undefined}
                  onClick={() => setStep(i)}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-medium ${
                    active
                      ? 'border-brand bg-brand text-white'
                      : reachable
                        ? 'border-brand/30 bg-brand-light text-brand-dark hover:bg-brand-light/70'
                        : 'border-slate-200 bg-white text-slate-400'
                  }`}
                >
                  <span>{i + 1}</span>
                  <span>{tw.steps[key]}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <section aria-label={tw.steps[stepKey]} className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
        <div>
          <p className="text-xs text-slate-500">{tw.stepOf(step + 1, STEPS.length)}</p>
          <h2 className="text-lg font-semibold text-brand-dark">{tw.steps[stepKey]}</h2>
        </div>
        {materialsError && <Notice>{materialsError}</Notice>}

        {stepKey === 'file' && (
          <FileStep
            objects={objects}
            objectId={objectId}
            onObject={(id) => {
              setObjectId(id)
              setPrevError(null)
            }}
            fileName={fileName}
            reading={reading}
            readError={readError}
            onFile={onFile}
            title={title}
            onTitle={setTitle}
            estimateDate={estimateDate}
            onDate={setEstimateDate}
            showErrors={showErrors}
          />
        )}
        {stepKey === 'sheet' && sheets && (
          <SheetStep
            sheets={sheets}
            sheetIndex={sheetIndex}
            onSheet={(i) => selectSheet(sheets, i)}
            headerRow={headerRow}
            headerAuto={headerAuto}
            onHeader={(i) => {
              setHeaderRow(i)
              setHeaderAuto(false)
              setFixes({})
              setSkipped({})
              applyHeader(rows, i)
            }}
          />
        )}
        {stepKey === 'columns' && headerRow !== null && (
          <ColumnsStep
            rows={rows}
            headerRow={headerRow}
            mapping={mapping}
            source={mappingSource}
            template={template}
            onTemplate={(apply) => {
              const header = rows[headerRow] ?? []
              touchedRef.current = true
              if (apply && template) {
                setMapping(sanitizeMapping(template.mapping, Math.max(header.length, 1)))
                setMappingSource('template')
              } else {
                setMapping(autoMapColumns(header))
                setMappingSource('manual')
              }
            }}
            missing={missing}
            onMapping={(field: EstimateField, col) => {
              touchedRef.current = true
              setMappingSource('manual')
              setMapping((m) => {
                const next = { ...m }
                if (col === undefined) delete next[field]
                else next[field] = col
                return next
              })
            }}
          />
        )}
        {stepKey === 'rows' && (
          <RowsStep
            parsed={parsed}
            fixes={fixes}
            skipped={skipped}
            hidden={hidden}
            summary={{
              items: collected.items.length,
              skipped: collected.autoSkipped + collected.userSkipped,
              invalid: collected.openInvalid,
            }}
            onFix={(n, f) =>
              setFixes((cur) => {
                const next = { ...cur }
                if (f) next[n] = f
                else delete next[n]
                return next
              })
            }
            onSkip={(n, s) => setSkipped((cur) => ({ ...cur, [n]: s }))}
          />
        )}
        {stepKey === 'catalog' &&
          (materials ? (
            <CatalogStep
              groups={plan.groups}
              materials={materials}
              decisions={decisions}
              canCatalog={canCatalog}
              onDecide={(key, d) => setDecisions((cur) => ({ ...cur, [key]: d }))}
              onBulkWork={(keys) =>
                setDecisions((cur) => {
                  const next = { ...cur }
                  for (const k of keys) next[k] = { kind: 'ish' }
                  return next
                })
              }
            />
          ) : (
            !materialsError && <Spinner />
          ))}
        {stepKey === 'units' && (
          <UnitsStep
            questions={plan.questions}
            answers={answers}
            canCatalog={canCatalog}
            onAnswer={(key, a) => setAnswers((cur) => ({ ...cur, [key]: a }))}
          />
        )}
        {stepKey === 'review' && (
          <ReviewStep
            plan={plan}
            skippedCount={collected.autoSkipped + collected.userSkipped}
            prevItems={prev && prev.objectId === objectId ? prev.items : null}
            prevError={prevError}
          />
        )}
        {stepKey === 'save' && (
          <div className="flex flex-col gap-3">
            {save?.status === 'saving' && <Spinner label={tw.saveSteps[save.step]} />}
            {save?.status === 'error' && (
              <>
                <Notice>
                  <span className="block font-medium">{save.message}</span>
                  <span className="block">{tw.saveFailed}</span>
                </Notice>
                <div className="flex flex-wrap gap-2">
                  {save.idReused ? (
                    <Button
                      onClick={() => {
                        progressRef.current.estimateId = null
                        setEstimateId(uuid())
                        setSave(null)
                        setStep(STEPS.indexOf('review'))
                      }}
                    >
                      {tw.newId}
                    </Button>
                  ) : (
                    <Button onClick={() => void runSave()}>{tw.retry}</Button>
                  )}
                  <Button variant="secondary" onClick={() => setStep(STEPS.indexOf('review'))}>
                    {tw.back}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {blockedMessage[stepKey] && <Notice tone="warn">{blockedMessage[stepKey]}</Notice>}

        {stepKey !== 'save' && (
          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-between">
            <Button variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
              {tw.back}
            </Button>
            {stepKey === 'review' ? (
              <Button disabled={!canNext.review} onClick={() => void runSave()}>
                {tw.saveButton}
              </Button>
            ) : (
              <Button onClick={onNext} disabled={stepKey !== 'file' && !canNext[stepKey]}>
                {tw.next}
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
