import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Check } from 'lucide-react'
import { Button, choiceClass, cx, Notice } from '@/components/ui'
import { listNormUsage } from '@/data/normsRepo'
import { createRequest } from '@/data/requestsRepo'
import type { Material, NormUsage, ObjectRow, Profile } from '@/data/types'
import { defaultObjectId, validateMovementDraft, type DraftErrorCode, type DraftField } from '@/domain/movements'
import { toBaseQty, unitLabel, validateQtyInput } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDate, formatQty, tashkentIsoDate } from '@/lib/format'
import { errorCodeOf } from '@/data/errors'
import { draftFingerprint, useDraftId } from '../entry/useDraftId'
import { BaseQtyBox } from '../entry/BaseQtyBox'
import { MaterialGrid } from '../entry/MaterialGrid'
import { ObjectBar, ObjectChooser } from '../entry/ObjectPicker'
import { MaterialHeader, NoteField, QtyField } from '../entry/QtyField'
import { UnitChips } from '../entry/UnitChips'
import { loadLastObject, saveLastObject } from '../movement/prefs'
import { getWebApp, haptic } from '../telegram'
import { SavedBanner } from '../ui'
import { flashMainButtonSaved, useBackButton, useClosingConfirmation, useMainButton } from '../useTelegramButtons'
import { requestNormState } from '@/lib/requestNorm'
import { initialUnitId, loadLastEntry, rememberLastEntry } from '../entry/lastEntry'
import { LastQtyChip } from '../entry/LastQtyChip'
import type { RequestPrefill } from './prefill'

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
  pinnedIds,
  prefill = null,
  onSaved,
  onDirtyChange,
}: {
  profile: Profile
  objects: ObjectRow[]
  materials: Material[]
  /** Ko'p ishlatiladigan materiallar (to'r tepasida). */
  pinnedIds?: ReadonlySet<string>
  /** Batch 12 (K): "Tugayotganlar" dan — obyekt, material, miqdor (asosiy birlikda), izoh. */
  prefill?: RequestPrefill | null
  onSaved: () => void
  /** Formada kiritilgan ma'lumot bor/yo'q — sahifa chiqishdan oldin tasdiq so'raydi. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  // Prefill faqat ko'rinadigan obyekt va faol material bo'lsa qo'llanadi
  const [initial] = useState(() => {
    const m = prefill ? materials.find((x) => x.id === prefill.materialId) : undefined
    const o = prefill ? objects.find((x) => x.id === prefill.objectId) : undefined
    return prefill && m && o ? { prefill, material: m } : null
  })
  const [objectId, setObjectId] = useState<string | null>(() =>
    initial
      ? initial.prefill.objectId
      : defaultObjectId(
          objects.map((o) => o.id),
          loadLastObject(),
        ),
  )
  const [pickingObject, setPickingObject] = useState(false)
  const [materialId, setMaterialId] = useState<string | null>(initial?.material.id ?? null)
  // Prefill miqdori asosiy birlikda — birinchi (asosiy) birlik
  const [unitId, setUnitId] = useState<string | null>(initial ? (initial.material.units[0]?.id ?? null) : null)
  const [qty, setQty] = useState(initial?.prefill.qtyBase ?? '')
  const [prefilled, setPrefilled] = useState(initial !== null)
  const [neededBy, setNeededBy] = useState<string | null>(null)
  const [note, setNote] = useState(initial?.prefill.note ?? '')
  // Qoralama id'si: xatodan keyin obyekt, material, birlik yoki miqdor o'zgarsa — yangi id
  const draftIds = useDraftId()
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
  const normState =
    material && material.outside_estimate
      ? requestNormState([], material.id, qtyBase, undefined, { outsideEstimate: true })
      : objectNorms && materialId
        ? requestNormState(objectNorms, materialId, qtyBase)
        : null
  const neededOptions = useMemo(
    () => NEEDED_OPTIONS.map((o) => ({ key: o.key, value: o.offset === null ? null : tashkentIsoDate(o.offset) })),
    [],
  )

  const pickMaterial = (m: Material) => {
    haptic.tap()
    setMaterialId(m.id)
    setUnitId(initialUnitId(m.units, loadLastEntry(profile.id, m.id)))
    setQty('')
    setPrefilled(false)
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
    const draftId = draftIds.idFor(draftFingerprint([objectId, materialId, unitId, result.qtyInput]))
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
      flashMainButtonSaved()
      saveLastObject(objectId)
      rememberLastEntry(profile.id, materialId, unitId, result.qtyInput)
      setPrefilled(false)
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
      draftIds.renew()
      onSaved()
    } catch (err) {
      haptic.error()
      // Shu id bilan avval boshqa so'rov saqlangan — keyingi urinish yangi id bilan
      if (errorCodeOf(err) === 'draft_conflict') draftIds.renew()
      setSaveError(errorText(err))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [objectId, materialId, unitId, qty, draftIds, profile.company_id, profile.id, neededBy, note, onSaved])

  const onMain = useCallback(() => void save(), [save])
  const onBack = useCallback(() => {
    if (step === 'details') setMaterialId(null)
    else if (step === 'object') setPickingObject(false)
    else setPickingObject(true)
  }, [step])
  const canGoBack = step === 'details' || (step === 'object' && Boolean(objectId)) || (step === 'material' && manyObjects)
  useBackButton(canGoBack ? onBack : null)
  useMainButton(tr.save, step === 'details' ? onMain : null, false, saving)
  useClosingConfirmation(Boolean(materialId) || qty.trim() !== '' || note.trim() !== '')
  // Oldindan to'ldirilgan (Tugayotganlar) miqdor ham — foydalanuvchi ko'rgan ma'lumot
  const dirty = qty.trim() !== '' || note.trim() !== ''
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  const insideTelegram = getWebApp() !== null

  return (
    <div className="flex flex-col gap-4">
      {savedText && (
        <SavedBanner>{savedText}</SavedBanner>
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

      {step === 'material' && <MaterialGrid materials={materials} pinnedIds={pinnedIds} onPick={pickMaterial} />}

      {step === 'details' && material && (
        <section className="flex flex-col gap-4" aria-label={material.name}>
          <MaterialHeader name={material.name} onChange={() => setMaterialId(null)} />
          {prefilled && <Notice tone="info">{t.tg.auto.prefilled}</Notice>}
          <QtyField
            label={tm.qty}
            suffix={unit?.unit ?? null}
            value={qty}
            error={fieldErrors.qty}
            onChange={(v) => {
              setQty(v)
              setFieldErrors((e) => ({ ...e, qty: undefined }))
            }}
          />
          {qty.trim() === '' && (
            <LastQtyChip
              last={loadLastEntry(profile.id, material.id)}
              units={material.units}
              onUse={(v, uid) => {
                haptic.select()
                setQty(v)
                setUnitId(uid)
              }}
            />
          )}
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

          {normState?.kind === 'outside' && <Notice tone="info">{tr.outsideEstimate}</Notice>}
          {normState?.kind === 'not_in_estimate' && <Notice tone="warn">{tr.notInEstimate}</Notice>}
          {normState?.kind === 'no_estimate' && <Notice tone="warn">{tr.noEstimate}</Notice>}
          {normState && (normState.kind === 'ok' || normState.kind === 'over') && (
            <div
              data-testid="norm-left"
              data-over={normState.kind === 'over' ? 'true' : undefined}
              className={cx(
                'tabular rounded-xl border px-4 py-3 text-sm',
                normState.kind === 'over' ? 'border-warn/25 bg-warn-bg text-warn' : 'border-brand/15 bg-ice text-navy',
              )}
            >
              <p className="font-semibold">{tr.normLeft(formatQty(normState.available), material.base_unit)}</p>
              {normState.kind === 'over' && <p className="mt-1">{tr.normOver(formatQty(normState.overQty), material.base_unit)}</p>}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <CalendarDays aria-hidden className="size-4 text-muted" strokeWidth={1.75} />
              {tr.neededBy}
            </span>
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
                  className={cx(choiceClass({ selected: neededBy === o.value, shape: 'stack' }), 'relative')}
                >
                  {tr.needed[o.key]}
                  {o.value && <span className="tabular block text-xs font-normal text-muted">{formatDate(`${o.value}T12:00:00+05:00`)}</span>}
                  {neededBy === o.value && <Check aria-hidden className="absolute top-2 right-2 size-4" strokeWidth={2.5} />}
                </button>
              ))}
            </div>
          </div>

          <NoteField label={tm.note} value={note} placeholder={tr.notePlaceholder} onChange={setNote} />
          {fieldErrors.object && <Notice>{tm.errors.object}</Notice>}
          {saveError && <Notice>{saveError}</Notice>}
          {!insideTelegram && (
            <Button size="lg" onClick={onMain} loading={saving}>
              {saving ? t.common.saving : tr.save}
            </Button>
          )}
        </section>
      )}
    </div>
  )
}
