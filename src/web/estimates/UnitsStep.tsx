// Import ustasining 6-qadami: katalogda topilmagan birliklar — har (material × birlik matni) bir marta.
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button, Notice, TextField } from '@/components/ui'
import { formatQty } from '@/lib/format'
import { conversionHint, validateFactor } from '@/domain/units'
import { t } from '@/i18n'
import { Pager } from '@/components/ui'
import { chipClass, pageSlice } from './styles'
import { PAGE_SIZE, type UnitAnswer, type UnitQuestion } from './wizardModel'

const tw = t.estimates.wizard
const tu = t.materials.units

function QuestionCard({
  q,
  answer,
  canCatalog,
  onAnswer,
  onWork,
  summary,
}: {
  q: UnitQuestion
  answer: UnitAnswer | undefined
  canCatalog: boolean
  onAnswer: (a: UnitAnswer) => void
  /** "Ish deb saqlash" — shu savol guruhlari Ish bo'ladi (birlik kerak emas). */
  onWork?: (groupKeys: string[]) => void
  /** Avtomatik javob xulosasi ("1 Т = 1 000 kg"). */
  summary?: string
}) {
  const isNew = answer?.kind === 'new'
  const factorCheck = isNew ? validateFactor(answer.factor) : null
  const preview =
    isNew && factorCheck?.ok && answer.unit.trim()
      ? conversionHint(
          { id: '', materialId: '', unit: answer.unit, factor: factorCheck.value, variant: answer.variant.trim() || null },
          q.baseUnit,
        )
      : null
  return (
    <li data-testid={`unitq-${q.key}`} className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-4">
      <p className="font-semibold text-ink">{tw.unitQuestion(q.unitText, q.materialName)}</p>
      {summary && (
        <p data-testid={`unitauto-${q.key}`} className="tabular rounded-lg bg-ice px-3 py-2 text-sm font-semibold text-navy">
          {summary}
        </p>
      )}
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-muted">{tw.useExisting}</legend>
        <div className="flex flex-wrap gap-2">
          {q.options.map((o) => {
            const selected = answer?.kind === 'existing' && answer.unitId === o.id
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={selected}
                className={chipClass(selected)}
                onClick={() => onAnswer({ kind: 'existing', unitId: o.id })}
              >
                {o.label}
              </button>
            )
          })}
          {canCatalog && (
            <button
              type="button"
              aria-pressed={isNew}
              className={chipClass(isNew)}
              onClick={() => !isNew && onAnswer({ kind: 'new', unit: q.unitText, factor: '', variant: '' })}
            >
              {tw.addUnit}
            </button>
          )}
          {onWork && (
            <button type="button" title={tw.unitAsWorkHint} className={chipClass(false)} onClick={() => onWork(q.groupKeys)}>
              {tw.unitAsWork}
            </button>
          )}
        </div>
      </fieldset>
      {isNew && (
        <div className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-ice/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={tw.unitName}
              value={answer.unit}
              onChange={(e) => onAnswer({ ...answer, unit: e.target.value })}
              error={!answer.unit.trim() ? tu.errUnit : null}
            />
            <TextField
              label={tu.factor}
              inputMode="decimal"
              value={answer.factor}
              onChange={(e) => onAnswer({ ...answer, factor: e.target.value })}
              error={factorCheck && !factorCheck.ok && answer.factor.trim() !== '' ? tu.factorErrors[factorCheck.reason] : null}
              hint={`${tu.factorHint} (${q.baseUnit})`}
            />
          </div>
          <TextField
            label={tu.variant}
            placeholder={tu.variantPlaceholder}
            value={answer.variant}
            onChange={(e) => onAnswer({ ...answer, variant: e.target.value })}
          />
          {preview && (
            <p role="status" className="tabular rounded-lg bg-ice px-3 py-2 text-sm text-navy">
              {tu.preview}: <span className="font-semibold">{preview}</span>
            </p>
          )}
        </div>
      )}
    </li>
  )
}

/** "1 Т = 1 000 kg" — javob bo'yicha (mavjud birlik koeffitsienti yoki yangi birlik koeffitsienti). */
function autoSummary(q: UnitQuestion, a: UnitAnswer | undefined): string | undefined {
  if (!a) return undefined
  if (a.kind === 'existing') {
    const o = q.options.find((x) => x.id === a.unitId)
    return o ? tw.resource.unitsAutoRow(q.unitText, formatQty(o.factor), q.baseUnit) : undefined
  }
  const f = validateFactor(a.factor)
  if (!f.ok) return undefined
  return `${tw.resource.unitsAutoRow(q.unitText, formatQty(f.value), q.baseUnit)} (${tw.resource.unitsAutoNew})`
}

export function UnitsStep({
  questions,
  answers,
  onAnswer,
  canCatalog,
  autoAnswers = {},
  onWork,
}: {
  questions: readonly UnitQuestion[]
  /** Amaldagi javoblar (foydalanuvchi javobi, bo'lmasa avtomatik). */
  answers: Readonly<Record<string, UnitAnswer>>
  onAnswer: (key: string, a: UnitAnswer) => void
  canCatalog: boolean
  /** Avtomatik aniqlangan javoblar — alohida yig'ilgan bo'limda, o'zgartirish mumkin. */
  autoAnswers?: Readonly<Record<string, UnitAnswer>>
  /** "Ish deb saqlash" (guruh qarorlari). Berilmasa — tugma yo'q. */
  onWork?: (groupKeys: string[]) => void
}) {
  const [page, setPage] = useState(0)
  const [autoOpen, setAutoOpen] = useState(false)
  const [autoPage, setAutoPage] = useState(0)
  const manual = questions.filter((q) => !(q.key in autoAnswers))
  const auto = questions.filter((q) => q.key in autoAnswers)
  const lastPage = Math.max(0, Math.ceil(manual.length / PAGE_SIZE) - 1)
  const current = Math.min(page, lastPage)
  const autoLast = Math.max(0, Math.ceil(auto.length / PAGE_SIZE) - 1)
  const autoCurrent = Math.min(autoPage, autoLast)
  return (
    <div className="flex flex-col gap-3">
      {manual.length === 0 ? (
        <Notice tone="ok">{tw.unitsNone}</Notice>
      ) : (
        <>
          <p className="text-sm text-muted">{tw.unitsHint}</p>
          {!canCatalog && <Notice tone="info">{tw.unitAdminOnly}</Notice>}
          <ul className="flex flex-col gap-3" aria-label={tw.steps.units}>
            {pageSlice(manual, current, PAGE_SIZE).map((q) => (
              <QuestionCard
                key={q.key}
                q={q}
                answer={answers[q.key]}
                canCatalog={canCatalog}
                onAnswer={(a) => onAnswer(q.key, a)}
                onWork={onWork}
              />
            ))}
          </ul>
          {manual.length > PAGE_SIZE && <Pager page={current} pageSize={PAGE_SIZE} total={manual.length} onPage={setPage} />}
        </>
      )}

      {auto.length > 0 && (
        <section aria-label={tw.resource.unitsAutoTitle(auto.length)} className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-ink">{tw.resource.unitsAutoTitle(auto.length)}</h3>
            <Button
              variant="ghost"
              aria-expanded={autoOpen}
              icon={
                autoOpen ? (
                  <ChevronUp aria-hidden className="size-5" strokeWidth={1.75} />
                ) : (
                  <ChevronDown aria-hidden className="size-5" strokeWidth={1.75} />
                )
              }
              onClick={() => setAutoOpen((v) => !v)}
            >
              {autoOpen ? tw.resource.hide : tw.resource.show}
            </Button>
          </div>
          <p className="text-sm text-muted">{tw.resource.unitsAutoHint}</p>
          {autoOpen && (
            <>
              <ul className="flex flex-col gap-3" aria-label={tw.resource.unitsAutoTitle(auto.length)}>
                {pageSlice(auto, autoCurrent, PAGE_SIZE).map((q) => (
                  <QuestionCard
                    key={q.key}
                    q={q}
                    answer={answers[q.key]}
                    canCatalog={canCatalog}
                    onAnswer={(a) => onAnswer(q.key, a)}
                    onWork={onWork}
                    summary={autoSummary(q, answers[q.key])}
                  />
                ))}
              </ul>
              {auto.length > PAGE_SIZE && <Pager page={autoCurrent} pageSize={PAGE_SIZE} total={auto.length} onPage={setAutoPage} />}
            </>
          )}
        </section>
      )}
    </div>
  )
}
