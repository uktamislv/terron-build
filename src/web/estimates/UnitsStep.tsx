// Import ustasining 6-qadami: katalogda topilmagan birliklar — har (material × birlik matni) bir marta.
import { useState } from 'react'
import { Notice, TextField } from '@/components/ui'
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
}: {
  q: UnitQuestion
  answer: UnitAnswer | undefined
  canCatalog: boolean
  onAnswer: (a: UnitAnswer) => void
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

export function UnitsStep({
  questions,
  answers,
  onAnswer,
  canCatalog,
}: {
  questions: readonly UnitQuestion[]
  answers: Readonly<Record<string, UnitAnswer>>
  onAnswer: (key: string, a: UnitAnswer) => void
  canCatalog: boolean
}) {
  const [page, setPage] = useState(0)
  if (questions.length === 0) return <Notice tone="ok">{tw.unitsNone}</Notice>
  const lastPage = Math.max(0, Math.ceil(questions.length / PAGE_SIZE) - 1)
  const current = Math.min(page, lastPage)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{tw.unitsHint}</p>
      {!canCatalog && <Notice tone="info">{tw.unitAdminOnly}</Notice>}
      <ul className="flex flex-col gap-3" aria-label={tw.steps.units}>
        {pageSlice(questions, current, PAGE_SIZE).map((q) => (
          <QuestionCard key={q.key} q={q} answer={answers[q.key]} canCatalog={canCatalog} onAnswer={(a) => onAnswer(q.key, a)} />
        ))}
      </ul>
      {questions.length > PAGE_SIZE && <Pager page={current} pageSize={PAGE_SIZE} total={questions.length} onPage={setPage} />}
    </div>
  )
}
