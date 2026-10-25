import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Notice } from '@/components/ui'
import { listNormUsage } from '@/data/normsRepo'
import { createRequest } from '@/data/requestsRepo'
import type { Material, NormUsage, ObjectRow, Profile } from '@/data/types'
import { defaultObjectId, validateMovementDraft, type DraftErrorCode, type DraftField } from '@/domain/movements'
import { toBaseQty, unitLabel, validateQtyInput } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDate, formatQty, tashkentIsoDate } from '@/lib/format'
import { uuid } from '@/lib/uuid'
import { BaseQtyBox } from '../entry/BaseQtyBox'
import { MaterialGrid } from '../entry/MaterialGrid'
import { ObjectBar, ObjectChooser } from '../entry/ObjectPicker'
import { MaterialHeader, NoteField, QtyField } from '../entry/QtyField'
import { UnitChips } from '../entry/UnitChips'
import { loadLastObject, saveLastObject } from '../movement/prefs'
import { getWebApp, haptic } from '../telegram'
import { useBackButton, useMainButton } from '../useTelegramButtons'
import { requestNormState } from '@/lib/requestNorm'

const tr = t.tg.request
const tm = t.tg.movement
const NEEDED_OPTIONS = [
  { key: 'none', offset: null },
  { key: 'today', offset: 0 },
  { key: 'tomorrow', offset: 1 },
  { key: 'in3', offset: 3 },
] as const

type FieldErrors = Partial<Record<DraftField, DraftErrorCode>>

/** So'rov: obyekt (avtomatik) → material → miqdor + birlik, kerakli sana, izoh. Idempotent saqlash. */
export function RequestForm({
  profile,
  objects,
  materials,
  onSaved,
}: {
  profile: Profile
  objects: ObjectRow[]
  materials: Material[]
  onSaved: () => void
}) {
  const [objectId, setObjectId] = useState<string | null>(() =>
    defaultObjectId(
      objects.map((o) => o.id),
      loadLastObject(),
    ),
  )
  const [pickingObject, setPickingObject] = useState(false)
  const [materialId, setMaterialId] = useState<string | null>(null)
  const [unitId, setUnitId] = useState<string | null>(null)
  const [qty, setQty] = useState('')
  const [neededBy, setNeededBy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [draftId, setDraftId] = useState(() => uuid())
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedText, setSavedText] = useState<string | null>(null)
  // Obyektning barcha norma qatorlari: bo'sh — joriy smeta yo'q, material yo'q — smetada yo'q
  const [norms, setNorms] = useState<{ objectId: string; rows: NormUsage[] } | null>(null)

  const material = materials.find((m) => m.id === materialId) ?? null
  const unit = material?.units.find((u) => u.id === unitId) ?? null
  const object = objects.find((o) => o.id === objectId) ?? null
  const manyObjects = objects.length > 1
  const step = (!objectId || pickingObject) && manyObjects ? 'object' : !material ? 'material' : 'details'

  useEffect(() => {
    if (!objectId) return
    let alive = true
    listNormUsage({ objectId })
      .then((rows) => alive && setNorms({ objectId, rows }))
      .catch(() => alive && setNorms(null))
    return () => {
      alive = false
    }
  }, [objectId])
  const objectNorms = norms && norms.objectId === objectId ? norms.rows : null

  const parsed = validateQtyInput(qty)
  const qtyBase = parsed.ok && unit ? toBaseQty(parsed.value, unit.factor) : null
  const normState = objectNorms && materialId ? requestNormState(objectNorms, materialId, qtyBase) : null
  const neededOptions = useMemo(
    () => NEEDED_OPTIONS.map((o) => ({ key: o.key, value: o.offset === null ? null : tashkentIsoDate(o.offset) })),
    [],
  )

  const pickMaterial = (m: Material) => {
    haptic.tap()
    setMaterialId(m.id)
    setUnitId(m.units[0]?.id ?? null)
    setQty('')
    setFieldErrors({})
    setSaveError(null)
    setSavedText(null)
  }

  const save = useCallback(async () => {
    if (savingRef.current) return
    const result = validateMovementDraft({ type: 'kirim', objectId, materialId, unitId, qtyInput: qty })
    if (!result.ok || !objectId || !materialId || !unitId) {
      setFieldErrors(result.ok ? {} : result.errors)
      haptic.error()
      return
    }
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      const row = await createRequest({
        id: draftId,
        companyId: profile.company_id,
        objectId,
        materialId,
        unitId,
        qtyInput: result.qtyInput,
        neededBy,
        note,
      })
      haptic.success()
      saveLastObject(objectId)
      setSavedText(
        tr.saved(
          formatQty(row.qty_input),
          unitLabel({ unit: row.unit_input, variant: row.unit_variant }),
          row.material_name ?? '',
        ),
      )
      setMaterialId(null)
      setUnitId(null)
      setQty('')
      setNote('')
      setNeededBy(null)
      setFieldErrors({})
      setDraftId(uuid())
      onSaved()
    } catch (err) {
      haptic.error()
      setSaveError(errorText(err))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [objectId, materialId, unitId, qty, draftId, profile.company_id, neededBy, note, onSaved])

  const onMain = useCallback(() => void save(), [save])
  const onBack = useCallback(() => {
    if (step === 'details') setMaterialId(null)
    else if (step === 'object') setPickingObject(false)
    else setPickingObject(true)
  }, [step])
  const canGoBack = step === 'details' || (step === 'object' && Boolean(objectId)) || (step === 'material' && manyObjects)
  useBackButton(canGoBack ? onBack : null)
  useMainButton(tr.save, step === 'details' ? onMain : null, false, saving)
  const insideTelegram = getWebApp() !== null

  return (
    <div className="flex flex-col gap-4">
      {savedText && (
        <div role="status" className="rounded-2xl border border-ok/30 bg-ok/5 p-4 font-semibold text-ok">
          ✓ {savedText}
        </div>
      )}
      {step === 'object' ? (
        <ObjectChooser
          objects={objects}
          selectedId={objectId}
          lastUsed={loadLastObject()}
          onPick={(id) => {
            haptic.tap()
            setObjectId(id)
            setPickingObject(false)
          }}
        />
      ) : (
        object && <ObjectBar object={object} onChange={manyObjects ? () => setPickingObject(true) : null} />
      )}

      {step === 'material' && <MaterialGrid materials={materials} onPick={pickMaterial} />}

      {step === 'details' && material && (
        <section className="flex flex-col gap-4" aria-label={material.name}>
          <MaterialHeader name={material.name} onChange={() => setMaterialId(null)} />
          <QtyField
            label={tm.qty}
            value={qty}
            error={fieldErrors.qty}
            onChange={(v) => {
              setQty(v)
              setFieldErrors((e) => ({ ...e, qty: undefined }))
            }}
          />
          <UnitChips
            units={material.units}
            selectedId={unitId}
            onPick={(id) => {
              haptic.select()
              setUnitId(id)
            }}
          />
          {fieldErrors.unit && <p className="text-sm text-danger">{tm.errors.unit}</p>}
          {qtyBase !== null && <BaseQtyBox qtyBase={qtyBase} unit={unit} baseUnit={material.base_unit} />}

          {normState?.kind === 'not_in_estimate' && <Notice tone="warn">{tr.notInEstimate}</Notice>}
          {normState?.kind === 'no_estimate' && <Notice tone="warn">{tr.noEstimate}</Notice>}
          {normState && (normState.kind === 'ok' || normState.kind === 'over') && (
            <div
              data-testid="norm-left"
              data-over={normState.kind === 'over' ? 'true' : undefined}
              className={`rounded-xl border px-4 py-3 text-sm ${
                normState.kind === 'over' ? 'border-warn/30 bg-warn/5 text-warn' : 'border-brand/20 bg-brand-light text-brand-dark'
              }`}
            >
              <p className="font-semibold">{tr.normLeft(formatQty(normState.available), material.base_unit)}</p>
              {normState.kind === 'over' && <p className="mt-1">{tr.normOver(formatQty(normState.overQty), material.base_unit)}</p>}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">{tr.neededBy}</span>
            <div role="group" aria-label={tr.neededBy} className="grid grid-cols-2 gap-2">
              {neededOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={neededBy === o.value}
                  onClick={() => {
                    haptic.select()
                    setNeededBy(o.value)
                  }}
                  className={`min-h-11 rounded-xl border px-3 text-sm font-medium ${
                    neededBy === o.value ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-800'
                  }`}
                >
                  {tr.needed[o.key]}
                  {o.value && <span className="block text-xs opacity-80">{formatDate(`${o.value}T12:00:00+05:00`)}</span>}
                </button>
              ))}
            </div>
          </div>

          <NoteField label={tm.note} value={note} placeholder={tr.notePlaceholder} onChange={setNote} />
          {fieldErrors.object && <Notice>{tm.errors.object}</Notice>}
          {saveError && <Notice>{saveError}</Notice>}
          {!insideTelegram && (
            <Button className="min-h-12 text-base" onClick={onMain} disabled={saving}>
              {saving ? t.common.saving : tr.save}
            </Button>
          )}
        </section>
      )}
    </div>
  )
}
