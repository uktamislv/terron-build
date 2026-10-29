import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, choiceClass, Notice } from '@/components/ui'
import { getStock } from '@/data/stockRepo'
import { createTransfer } from '@/data/transfersRepo'
import type { Material, ObjectRow } from '@/data/types'
import { defaultObjectId, movementWarnings, validateMovementDraft, type DraftErrorCode, type DraftField } from '@/domain/movements'
import { toBaseQty, unitLabel, validateQtyInput } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatQty } from '@/lib/format'
import { errorCodeOf } from '@/data/errors'
import { draftFingerprint, useDraftId } from '../entry/useDraftId'
import { BaseQtyBox } from '../entry/BaseQtyBox'
import { MaterialGrid } from '../entry/MaterialGrid'
import { ObjectBar, ObjectChooser } from '../entry/ObjectPicker'
import { MaterialHeader, NoteField, QtyField } from '../entry/QtyField'
import { UnitChips } from '../entry/UnitChips'
import { initialUnitId, loadLastEntry, rememberLastEntry } from '../entry/lastEntry'
import { LastQtyChip } from '../entry/LastQtyChip'
import { loadLastObject } from '../movement/prefs'
import { getWebApp, haptic } from '../telegram'
import { SavedBanner, SectionTitle } from '../ui'
import { flashMainButtonSaved, useBackButton, useClosingConfirmation, useMainButton } from '../useTelegramButtons'

const tt = t.tg.transfer
const tm = t.tg.movement

type FieldErrors = Partial<Record<DraftField | 'to', DraftErrorCode>>

/**
 * O'tkazma: qayerdan (a'zo obyekt, avtomatik) → material → qayerga (firma obyektlari, tugmalar),
 * miqdor + birlik (joriy qoldiq ko'rinadi), izoh → RPC `create_transfer` (idempotent).
 * `targets` — qabul qiluvchi bo'la oladigan obyektlar (RPC `transfer_target_objects`; joriy `from` chiqariladi).
 */
export function TransferForm({
  profileId,
  objects,
  targets,
  materials,
  pinnedIds,
  onSaved,
  onDirtyChange,
}: {
  /** Formada kiritilgan ma'lumot bor/yo'q — sahifa chiqishdan oldin tasdiq so'raydi. */
  onDirtyChange?: (dirty: boolean) => void
  /** Batch 12 (L): oxirgi birlik/miqdor uchun. */
  profileId: string
  objects: ObjectRow[]
  targets: { id: string; name: string }[]
  materials: Material[]
  /** Ko'p ishlatiladigan materiallar (to'r tepasida). */
  pinnedIds?: ReadonlySet<string>
  onSaved: () => void
}) {
  const [fromId, setFromId] = useState<string | null>(() =>
    defaultObjectId(
      objects.map((o) => o.id),
      loadLastObject(),
    ),
  )
  const [pickingFrom, setPickingFrom] = useState(false)
  const [toId, setToId] = useState<string | null>(null)
  const [materialId, setMaterialId] = useState<string | null>(null)
  const [unitId, setUnitId] = useState<string | null>(null)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  // Qoralama id'si: xatodan keyin qayerdan/qayerga, material, birlik yoki miqdor o'zgarsa — yangi id
  const draftIds = useDraftId()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedText, setSavedText] = useState<string | null>(null)
  const [stock, setStock] = useState<{ key: string; value: string } | null>(null)

  const material = materials.find((m) => m.id === materialId) ?? null
  const unit = material?.units.find((u) => u.id === unitId) ?? null
  const from = objects.find((o) => o.id === fromId) ?? null
  const manyFrom = objects.length > 1
  const toOptions = targets.filter((o) => o.id !== fromId)
  // Yagona qabul qiluvchi obyekt — avtomatik tanlanadi (bir bosish kam)
  const selectedToId = toId ?? (toOptions.length === 1 ? (toOptions[0]?.id ?? null) : null)
  const step = (!fromId || pickingFrom) && manyFrom ? 'object' : !material ? 'material' : 'details'

  const stockKey = fromId && materialId ? `${fromId}:${materialId}` : null
  useEffect(() => {
    if (!fromId || !materialId) return
    let alive = true
    const key = `${fromId}:${materialId}`
    getStock(fromId, materialId)
      .then((value) => alive && setStock({ key, value }))
      .catch(() => alive && setStock(null))
    return () => {
      alive = false
    }
  }, [fromId, materialId])
  const currentStock = stock && stock.key === stockKey ? stock.value : null

  const parsed = validateQtyInput(qty)
  const qtyBase = parsed.ok && unit ? toBaseQty(parsed.value, unit.factor) : null
  const exceeds =
    qtyBase !== null && currentStock !== null
      ? movementWarnings({ type: 'chiqim', qtyBase, currentStock }).includes('exceeds_stock')
      : false

  const save = useCallback(async () => {
    if (savingRef.current) return
    const result = validateMovementDraft({ type: 'chiqim', objectId: fromId, materialId, unitId, qtyInput: qty })
    const errors: FieldErrors = result.ok ? {} : { ...result.errors }
    const to = toOptions.find((o) => o.id === selectedToId) ?? null
    if (!to) errors.to = 'required'
    if (!result.ok || !to || !fromId || !materialId || !unitId) {
      setFieldErrors(errors)
      haptic.error()
      return
    }
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    const draftId = draftIds.idFor(draftFingerprint([fromId, to.id, materialId, unitId, result.qtyInput]))
    try {
      await createTransfer({
        id: draftId,
        fromObjectId: fromId,
        toObjectId: to.id,
        materialId,
        unitId,
        qtyInput: result.qtyInput,
        note,
      })
      haptic.success()
      flashMainButtonSaved()
      rememberLastEntry(profileId, materialId, unitId, result.qtyInput)
      setSavedText(
        tt.saved(formatQty(result.qtyInput), unit ? unitLabel(unit) : '', material?.name ?? '', to.name),
      )
      setMaterialId(null)
      setUnitId(null)
      setToId(null)
      setQty('')
      setNote('')
      setFieldErrors({})
      draftIds.renew()
      onSaved()
    } catch (err) {
      haptic.error()
      // Shu id bilan avval boshqa o'tkazma saqlangan (server `transfer_id_reused`) — keyingi urinish yangi id bilan
      if (errorCodeOf(err) === 'transfer_id_reused') draftIds.renew()
      setSaveError(errorText(err))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [fromId, materialId, unitId, qty, toOptions, selectedToId, draftIds, note, unit, material, onSaved, profileId])

  const onMain = useCallback(() => void save(), [save])
  const onBack = useCallback(() => {
    if (step === 'details') setMaterialId(null)
    else if (step === 'object') setPickingFrom(false)
    else setPickingFrom(true)
  }, [step])
  const canGoBack = step === 'details' || (step === 'object' && Boolean(fromId)) || (step === 'material' && manyFrom)
  useBackButton(canGoBack ? onBack : null)
  useMainButton(tt.save, step === 'details' && toOptions.length > 0 ? onMain : null, false, saving)
  useClosingConfirmation(Boolean(materialId) || qty.trim() !== '' || note.trim() !== '')
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
          selectedId={fromId}
          lastUsed={loadLastObject()}
          onPick={(id) => {
            haptic.tap()
            setFromId(id)
            setPickingFrom(false)
            setToId(null)
          }}
        />
      ) : (
        from && <ObjectBar object={from} onChange={manyFrom ? () => setPickingFrom(true) : null} />
      )}

      {step === 'material' && (
        <MaterialGrid
          materials={materials}
          pinnedIds={pinnedIds}
          onPick={(m) => {
            haptic.tap()
            setMaterialId(m.id)
            setUnitId(initialUnitId(m.units, loadLastEntry(profileId, m.id)))
            setQty('')
            setFieldErrors({})
            setSaveError(null)
            setSavedText(null)
          }}
        />
      )}

      {step === 'details' && material && (
        <section className="flex flex-col gap-4" aria-label={material.name}>
          <MaterialHeader name={material.name} onChange={() => setMaterialId(null)} />

          <div className="flex flex-col gap-2">
            <SectionTitle>{tt.chooseTo}</SectionTitle>
            {toOptions.length === 0 ? (
              <Notice tone="warn">{tt.noTargets}</Notice>
            ) : (
              <div role="group" aria-label={tt.to} className="grid grid-cols-2 gap-2">
                {toOptions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={o.id === selectedToId}
                    onClick={() => {
                      haptic.select()
                      setToId(o.id)
                      setFieldErrors((e) => ({ ...e, to: undefined }))
                    }}
                    className={choiceClass({ selected: o.id === selectedToId, shape: 'box', size: 'md' })}
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            )}
            {fieldErrors.to && (
              <p role="alert" className="text-sm text-danger">
                {tt.errorTo}
              </p>
            )}
          </div>

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
              last={loadLastEntry(profileId, material.id)}
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
          <BaseQtyBox qtyBase={qtyBase} unit={unit} baseUnit={material.base_unit}>
            {currentStock !== null && (
              <p data-testid="transfer-stock" className="tabular text-sm text-muted">
                {tt.stock(formatQty(currentStock), material.base_unit)}
              </p>
            )}
          </BaseQtyBox>
          {exceeds && <Notice tone="warn">{tt.exceeds}</Notice>}

          <NoteField label={tm.note} value={note} onChange={setNote} />
          {saveError && <Notice>{saveError}</Notice>}
          {!insideTelegram && toOptions.length > 0 && (
            <Button size="lg" onClick={onMain} loading={saving}>
              {saving ? t.common.saving : tt.save}
            </Button>
          )}
        </section>
      )}
    </div>
  )
}
