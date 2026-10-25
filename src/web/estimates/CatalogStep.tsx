// Import ustasining 5-qadami: smetadagi nomlarni katalogga moslash.
import { useMemo, useState } from 'react'
import { StatusBadge } from '@/components/ui'
import { Button, Notice, TextField } from '@/components/ui'
import type { Material } from '@/data/types'
import { t } from '@/i18n'
import { Pager, SelectField } from '@/components/ui'
import { QUICK_BASE_UNITS } from '../materials/materialForm'
import { Checkbox } from './parts'
import { chipClass, pageSlice } from './styles'
import {
  aliasWorthSaving,
  catalogOf,
  effectiveDecision,
  matchGroup,
  newMaterialProblem,
  PAGE_SIZE,
  type Decision,
  type MatchInfo,
  type NameGroup,
} from './wizardModel'

const tw = t.estimates.wizard

function GroupCard({
  group,
  info,
  decision,
  materials,
  byId,
  canCatalog,
  onDecide,
}: {
  group: NameGroup
  info: MatchInfo
  decision: Decision | null
  materials: readonly Material[]
  byId: ReadonlyMap<string, Material>
  canCatalog: boolean
  onDecide: (d: Decision) => void
}) {
  const chooseMaterial = (id: string) => {
    const m = byId.get(id)
    if (!m) return
    // Muqobil nom standart o'chiq — foydalanuvchi ataylab belgilaydi (noto'g'ri moslik katalogga yozilmasin)
    onDecide({ kind: 'material', materialId: id, saveAlias: false })
  }
  const chosen = decision?.kind === 'material' ? byId.get(decision.materialId) : undefined
  const problem = decision ? newMaterialProblem(decision, materials) : null
  const otherBase = decision?.kind === 'new' && !QUICK_BASE_UNITS.includes(decision.baseUnit)

  let badge
  if (!decision) badge = <StatusBadge tone="danger">{tw.unmatched}</StatusBadge>
  else if (decision.kind === 'ish') badge = <StatusBadge tone="neutral">{tw.asWorkChosen}</StatusBadge>
  else if (decision.kind === 'new') badge = <StatusBadge tone="info">{tw.newChosen(decision.name)}</StatusBadge>
  else
    badge = (
      <StatusBadge tone="ok">
        {decision.materialId === info.exactId ? `${tw.exact}: ` : ''}
        {chosen?.name}
      </StatusBadge>
    )

  return (
    <li data-testid={`group-${group.key}`} className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{group.name}</p>
          <p className="text-sm text-muted">
            {group.unit} · {tw.occurrences(group.count)}
          </p>
        </div>
        {badge}
      </div>

      {info.suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-muted">{tw.suggestions}</p>
          <div className="flex flex-wrap gap-2">
            {info.suggestions.map((s) => {
              const m = byId.get(s.id)
              if (!m) return null
              const selected = decision?.kind === 'material' && decision.materialId === s.id
              return (
                <button key={s.id} type="button" aria-pressed={selected} className={chipClass(selected)} onClick={() => chooseMaterial(s.id)}>
                  {m.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <div className="md:w-72">
          <SelectField
            label={tw.chooseMaterial}
            value={decision?.kind === 'material' ? decision.materialId : ''}
            onChange={(v) => v && chooseMaterial(v)}
          >
            <option value="">{tw.pickPlaceholder}</option>
            {materials
              .filter((m) => m.is_active)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.base_unit})
                </option>
              ))}
          </SelectField>
        </div>
        <button
          type="button"
          aria-pressed={decision?.kind === 'ish'}
          className={chipClass(decision?.kind === 'ish')}
          onClick={() => onDecide({ kind: 'ish' })}
        >
          {tw.asWork}
        </button>
        {canCatalog && (
          <button
            type="button"
            aria-pressed={decision?.kind === 'new'}
            className={chipClass(decision?.kind === 'new')}
            onClick={() =>
              decision?.kind !== 'new' && onDecide({ kind: 'new', name: group.name, baseUnit: group.unit, saveAlias: false })
            }
          >
            {tw.newMaterial}
          </button>
        )}
      </div>

      {decision?.kind === 'material' && chosen && canCatalog && aliasWorthSaving(group.name, chosen) && (
        <Checkbox
          label={tw.saveAlias}
          hint={tw.saveAliasHint}
          checked={decision.saveAlias}
          onChange={(v) => onDecide({ ...decision, saveAlias: v })}
        />
      )}

      {decision?.kind === 'new' && (
        <div className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-ice/40 p-3">
          <TextField
            label={tw.newMaterialName}
            value={decision.name}
            onChange={(e) =>
              onDecide({ ...decision, name: e.target.value })
            }
            error={problem === 'name' ? t.materials.errName : problem === 'taken' ? tw.newMaterialNameTaken : null}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium text-muted">{tw.newMaterialBase}</legend>
            <div className="flex flex-wrap gap-2">
              {QUICK_BASE_UNITS.map((u) => (
                <button
                  key={u}
                  type="button"
                  aria-pressed={decision.baseUnit === u}
                  className={chipClass(decision.baseUnit === u)}
                  onClick={() => onDecide({ ...decision, baseUnit: u })}
                >
                  {u}
                </button>
              ))}
            </div>
            <TextField
              label={t.materials.otherUnitLabel}
              value={otherBase ? decision.baseUnit : ''}
              onChange={(e) => onDecide({ ...decision, baseUnit: e.target.value })}
              error={problem === 'base' ? t.materials.errBaseUnit : null}
            />
          </fieldset>
          {decision.name.trim() && decision.name.trim() !== group.name.trim() && (
            <Checkbox
              label={tw.saveAlias}
              hint={tw.saveAliasHint}
              checked={decision.saveAlias}
              onChange={(v) => onDecide({ ...decision, saveAlias: v })}
            />
          )}
        </div>
      )}
    </li>
  )
}

export function CatalogStep({
  groups,
  materials,
  decisions,
  onDecide,
  onBulkWork,
  canCatalog,
}: {
  groups: readonly NameGroup[]
  materials: readonly Material[]
  decisions: Readonly<Record<string, Decision>>
  onDecide: (key: string, d: Decision) => void
  onBulkWork: (keys: string[]) => void
  canCatalog: boolean
}) {
  const [onlyUnmatched, setOnlyUnmatched] = useState(false)
  const [page, setPage] = useState(0)
  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials])
  const catalog = useMemo(() => catalogOf(materials), [materials])
  const infos = useMemo(() => new Map(groups.map((g) => [g.key, matchGroup(g.name, catalog)])), [groups, catalog])

  const rows = groups.map((g) => {
    const info = infos.get(g.key) ?? { exactId: null, suggestions: [] }
    let d = effectiveDecision(g, decisions, info)
    if (d?.kind === 'new' && !canCatalog) d = null
    return { g, info, d }
  })
  const unmatched = rows.filter((r) => !r.d)
  const done = rows.length - unmatched.length
  const visible = onlyUnmatched ? unmatched : rows
  const lastPage = Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1)
  const current = Math.min(page, lastPage)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{tw.catalogHint}</p>
      {!canCatalog && <Notice tone="info">{tw.catalogAdminOnly}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={unmatched.length ? 'warn' : 'ok'}>{tw.matchedCount(done, rows.length)}</StatusBadge>
        <Checkbox
          label={tw.onlyUnmatched}
          checked={onlyUnmatched}
          onChange={(v) => {
            setOnlyUnmatched(v)
            setPage(0)
          }}
        />
        <Button variant="secondary" disabled={unmatched.length === 0} onClick={() => onBulkWork(unmatched.map((r) => r.g.key))}>
          {tw.allAsWork}
        </Button>
      </div>
      <ul className="flex flex-col gap-3" aria-label={tw.steps.catalog}>
        {pageSlice(visible, current, PAGE_SIZE).map(({ g, info, d }) => (
          <GroupCard
            key={g.key}
            group={g}
            info={info}
            decision={d}
            materials={materials}
            byId={byId}
            canCatalog={canCatalog}
            onDecide={(next) => onDecide(g.key, next)}
          />
        ))}
      </ul>
      {visible.length > PAGE_SIZE && <Pager page={current} pageSize={PAGE_SIZE} total={visible.length} onPage={setPage} />}
    </div>
  )
}
