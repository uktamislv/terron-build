// Smeta import ustasi (docs/estimate-design.md, "Oqim" 1–8). Bosqichlar ko'rinadi, orqaga qaytish
// mumkin — barcha tanlovlar shu komponent holatida saqlanadi.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, FileSpreadsheet, Save } from 'lucide-react'
import { Button, Notice, Spinner, useToast } from '@/components/ui'
import { createEstimateMaterials, listEstimateItems, listEstimates, rememberEstimateAliases } from '@/data/estimatesRepo'
import { findTemplateBySignature } from '@/data/estimateTemplatesRepo'
import { listMaterials } from '@/data/materialsRepo'
import { errorCodeOf } from '@/data/errors'
import type { EstimateImportTemplate, Material, ObjectRow } from '@/data/types'
import {
  aggregateMaterials,
  autoMapColumns,
  detectHeaderRow,
  detectResourceLayout,
  parseResourceEstimate,
  selectMainMaterials,
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
import {
  autoDecisions,
  autoUnitAnswer,
  classifyResources,
  createMaterialsPayload,
  DEFAULT_SHARE,
  matchCounts,
  rememberPayload,
  RESOURCE_PAGE_SIZE,
  resourceItems,
  resourceSummary,
  shareStats,
  unknownKeysOf,
  type SharePct,
} from './resourceModel'
import { ResourceBanner, ResourceCatalogPanel } from './ResourceSteps'
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
  STEPS,
  titleFromFileName,
  type Decision,
  type RowFix,
  type StepKey,
  type UnitAnswer,
} from './wizardModel'
import { WizardFrame } from './wizardChrome'
import { ColumnsStep, FileStep, RowsStep, SheetStep } from './wizardSteps'

const tw = t.estimates.wizard
const tr = tw.resource

/** Resurs smetasida varaq, sarlavha, ustun va qator bosqichlari yo'q. */
const RESOURCE_STEPS: readonly StepKey[] = STEPS.filter((k) => k !== 'sheet' && k !== 'columns' && k !== 'rows')

/** Resurs smetasi tuzilishi bor birinchi varaq (bo'lmasa 0). */
function resourceSheetIndex(all: readonly SheetData[]): number {
  const i = all.findIndex((s) => detectResourceLayout(s.rows) !== null)
  return i < 0 ? 0 : i
}


const EMPTY_ROWS: Cell[][] = []
/** Barqaror bo'sh katalog (moslik keshi massiv identifikatori bo'yicha). */
const EMPTY_MATERIALS: Material[] = []

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
  const toast = useToast()

  // Resurs smetasi rejimi
  const [forceClassic, setForceClassic] = useState(false)
  const [share, setShare] = useState<SharePct>(DEFAULT_SHARE)
  /** Agregat kaliti → shu importda katalogga qo'shilgan (yoki topilgan) material id. */
  const [created, setCreated] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [createNote, setCreateNote] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)

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
  const layout = useMemo(() => (sheet ? detectResourceLayout(rows) : null), [sheet, rows])
  const resource = useMemo(() => {
    if (!layout || forceClassic) return null
    const parsedRes = parseResourceEstimate(rows, layout)
    // Turi aniqlanmagan resurslar ham olinadi — moslanmasa "Ish" bo'lib saqlanadi (jami yo'qolmaydi)
    const aggregated = aggregateMaterials(parsedRes.resources, ['material', 'equipment', 'unknown'])
    const { items, kept, dropped } = resourceItems(aggregated, rowOffset)
    return { summary: resourceSummary(parsedRes), items, kept, dropped, unknownKeys: unknownKeysOf(kept, parsedRes.resources) }
  }, [layout, forceClassic, rows, rowOffset])
  const resourceMode = resource !== null
  const steps = resourceMode ? RESOURCE_STEPS : STEPS
  const main = useMemo(() => (resource ? selectMainMaterials(resource.kept, share) : new Set<string>()), [resource, share])
  const shareInfo = useMemo(() => (resource ? shareStats(resource.kept, main) : null), [resource, main])
  const matches = useMemo(
    () => (resource ? classifyResources(resource.kept, materials ?? [], main, created, resource.unknownKeys) : []),
    [resource, materials, main, created],
  )
  const counts = useMemo(() => matchCounts(matches), [matches])
  const effDecisions = useMemo(
    () => (resourceMode ? { ...autoDecisions(matches), ...decisions } : decisions),
    [resourceMode, matches, decisions],
  )
  const pendingNew = useMemo(() => matches.filter((m) => m.source === 'new' && !decisions[m.groupKey]), [matches, decisions])
  const minorKeys = useMemo(
    () => new Set(matches.filter((m) => m.source === 'minor' && effDecisions[m.groupKey]?.kind === 'ish').map((m) => m.groupKey)),
    [matches, effDecisions],
  )
  const parsed = useMemo(
    () =>
      headerRow === null || validateMapping(mapping).length > 0
        ? []
        : shiftRowNumbers(parseRows(rows, headerRow, mapping), rowOffset),
    [rows, headerRow, mapping, rowOffset],
  )
  const collected = useMemo(() => collectItems(parsed, fixes, skipped, hidden), [parsed, fixes, skipped, hidden])
  const planItems = resource ? resource.items : collected.items
  const materialsById = useMemo(() => new Map((materials ?? []).map((m) => [m.id, m])), [materials])
  // Bitta o'tish: resurs smetasida guruhlar allaqachon tasniflangan (qisman moslik qidirilmaydi),
  // smetadagi birlik ("М3", "100ШТ", "Т") material birligiga avtomatik — faqat noma'lumlari so'raladi
  const plan = useMemo(
    () =>
      buildPlan({
        items: planItems,
        materials: materials ?? EMPTY_MATERIALS,
        decisions: effDecisions,
        answers,
        canCatalog,
        skipMatch: resourceMode,
        autoAnswer: resourceMode ? (q) => autoUnitAnswer(q, materialsById.get(q.materialKey), canCatalog) : undefined,
      }),
    [planItems, materials, materialsById, effDecisions, answers, canCatalog, resourceMode],
  )
  const effAnswers = useMemo(() => ({ ...plan.autoAnswers, ...answers }), [plan.autoAnswers, answers])
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
    setMapping(autoMapColumns(header, sheetRows[h + 1]))
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
        setForceClassic(false)
        setCreated({})
        setCreateNote(null)
        setCreateError(null)
        selectSheet(all, resourceSheetIndex(all))
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
    go(neighbour(1))
  }

  /** Ko'rinadigan bosqichlar bo'yicha qo'shni bosqich (resurs rejimida varaq/ustun/qator o'tkaziladi). */
  function neighbour(delta: 1 | -1): number {
    const pos = steps.indexOf(stepKey)
    const key = steps[Math.min(Math.max(pos + delta, 0), steps.length - 1)] ?? stepKey
    return STEPS.indexOf(key)
  }

  /** Resurs rejimidan oddiy oqimga: varaq, sarlavha va ustunlar qo'lda. */
  function openSettings() {
    setForceClassic(true)
    const i = STEPS.indexOf('sheet')
    setStep(i)
    setMaxStep(i)
  }

  function backToResource() {
    setForceClassic(false)
    const i = STEPS.indexOf('catalog')
    setStep(i)
    setMaxStep(i)
  }

  async function createNewMaterials() {
    const list = pendingNew.map((m) => m.item)
    if (list.length === 0) return
    setCreating(true)
    setCreateError(null)
    setCreateNote(null)
    try {
      const res = await createEstimateMaterials(createMaterialsPayload(list))
      const next = { ...created }
      let added = 0
      let found = 0
      for (const r of res) {
        const it = list[Number(r.key)]
        if (!it) continue
        next[it.key] = r.material_id
        if (r.created) added++
        else found++
      }
      // Yangi materiallar (birliklari va shifr alias'lari bilan) katalogdan qayta o'qiladi
      const fresh = await listMaterials()
      setMaterials(fresh)
      setCreated(next)
      setCreateNote(tr.created(added, found))
    } catch (err) {
      setCreateError(errorText(err))
    } finally {
      setCreating(false)
    }
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
            headerRow !== null && !resourceMode
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
      if (resourceMode) {
        // Shifr va asl nomlar katalogga — keyingi import shifr bo'yicha avtomatik moslanadi.
        // Smeta allaqachon saqlangan: xato bo'lsa faqat ogohlantirish.
        setSave({ status: 'saving', step: 'aliases' })
        try {
          await rememberEstimateAliases(id, rememberPayload(plan.rows, progressRef.current.materials))
        } catch {
          toast.show(tr.rememberFailed, 'info')
        }
      }
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
    <WizardFrame stepKey={stepKey} step={step} maxStep={maxStep} saving={saving} onStep={setStep} onCancel={onCancel} steps={steps}>
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
        {stepKey === 'file' && resource && (
          <ResourceBanner summary={resource.summary} dropped={resource.dropped.length} onOpenSettings={openSettings} />
        )}
        {stepKey === 'sheet' && layout && forceClassic && (
          <div>
            <Button variant="secondary" icon={<FileSpreadsheet aria-hidden className="size-5" strokeWidth={1.75} />} onClick={backToResource}>
              {tr.backToResource}
            </Button>
          </div>
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
                setMapping(autoMapColumns(header, rows[headerRow + 1]))
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
        {stepKey === 'catalog' && resource && (
          <ResourceBanner summary={resource.summary} dropped={resource.dropped.length} onOpenSettings={openSettings} />
        )}
        {stepKey === 'catalog' && resource && materials && shareInfo && (
          <ResourceCatalogPanel
            totalMaterials={resource.kept.length}
            share={share}
            onShare={setShare}
            shareCount={shareInfo.count}
            sharePct={shareInfo.pct}
            counts={counts}
            newCount={pendingNew.length}
            canCatalog={canCatalog}
            creating={creating}
            createNote={createNote}
            createError={createError}
            onCreate={() => void createNewMaterials()}
            onNewAsWork={() =>
              setDecisions((cur) => {
                const next = { ...cur }
                for (const m of pendingNew) next[m.groupKey] = { kind: 'ish' }
                return next
              })
            }
            list={
              <CatalogStep
                groups={plan.groups}
                materials={materials}
                decisions={plan.decided}
                canCatalog={canCatalog}
                pageSize={RESOURCE_PAGE_SIZE}
                searchable
                onDecide={(key, d) => setDecisions((cur) => ({ ...cur, [key]: d }))}
                onBulkWork={(keys) =>
                  setDecisions((cur) => {
                    const next = { ...cur }
                    for (const k of keys) next[k] = { kind: 'ish' }
                    return next
                  })
                }
              />
            }
          />
        )}
        {stepKey === 'catalog' && resource && !materials && !materialsError && <Spinner />}
        {stepKey === 'catalog' &&
          !resource &&
          (materials ? (
            <CatalogStep
              groups={plan.groups}
              materials={materials}
              decisions={plan.decided}
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
            answers={effAnswers}
            autoAnswers={plan.autoAnswers}
            canCatalog={canCatalog}
            onAnswer={(key, a) => setAnswers((cur) => ({ ...cur, [key]: a }))}
            onWork={(keys) =>
              setDecisions((cur) => {
                const next = { ...cur }
                for (const k of keys) next[k] = { kind: 'ish' }
                return next
              })
            }
          />
        )}
        {stepKey === 'review' && (
          <ReviewStep
            plan={plan}
            skippedCount={
              resource
                ? resource.summary.laborMachineRows + resource.summary.invalidRows + resource.dropped.length
                : collected.autoSkipped + collected.userSkipped
            }
            minorKeys={resource ? minorKeys : undefined}
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
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-between">
            <Button variant="secondary" disabled={step === 0} icon={<ArrowLeft aria-hidden className="size-5" strokeWidth={1.75} />} onClick={() => setStep(neighbour(-1))}>
              {tw.back}
            </Button>
            {stepKey === 'review' ? (
              <Button disabled={!canNext.review} icon={<Save aria-hidden className="size-5" strokeWidth={1.75} />} onClick={() => void runSave()}>
                {tw.saveButton}
              </Button>
            ) : (
              <Button onClick={onNext} disabled={stepKey !== 'file' && !canNext[stepKey]}>
                {tw.next}
                <ArrowRight aria-hidden className="size-5" strokeWidth={1.75} />
              </Button>
            )}
          </div>
        )}
    </WizardFrame>
  )
}
