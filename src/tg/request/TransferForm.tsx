import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Notice } from '@/components/ui'
import { getStock } from '@/data/stockRepo'
import { createTransfer } from '@/data/transfersRepo'
import type { Material, ObjectRow } from '@/data/types'
import { defaultObjectId, movementWarnings, validateMovementDraft, type DraftErrorCode, type DraftField } from '@/domain/movements'
import { toBaseQty, unitLabel, validateQtyInput } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatQty } from '@/lib/format'
import { uuid } from '@/lib/uuid'
import { BaseQtyBox } from '../entry/BaseQtyBox'
import { MaterialGrid } from '../entry/MaterialGrid'
import { ObjectBar, ObjectChooser } from '../entry/ObjectPicker'
import { MaterialHeader, NoteField, QtyField } from '../entry/QtyField'
import { UnitChips } from '../entry/UnitChips'
import { loadLastObject } from '../movement/prefs'
import { getWebApp, haptic } from '../telegram'
import { SavedBanner, SectionTitle } from '../ui'
import { useBackButton, useMainButton } from '../useTelegramButtons'

const tt = t.tg.transfer
const tm = t.tg.movement

type FieldErrors = Partial<Record<DraftField | 'to', DraftErrorCode>>

/**
 * O'tkazma: qayerdan (a'zo obyekt, avtomatik) → material → qayerga (firma obyektlari, tugmalar),
 * miqdor + birlik (joriy qoldiq ko'rinadi), izoh → RPC `create_transfer` (idempotent).
 * `targets` — qabul qiluvchi bo'la oladigan obyektlar (RPC `transfer_target_objects`; joriy `from` chiqariladi).
 */
export function TransferForm({
  objects,
  targets,
  materials,
  onSaved,
}: {
  objects: ObjectRow[]
  targets: { id: string; name: string }[]
  materials: Material[]
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
  const [draftId, setDraftId] = useState(() => uuid())
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
    const to = toOptions.find((o) => o.id === toId) ?? null
    if (!to) errors.to = 'required'
    if (!result.ok || !to || !fromId || !materialId || !unitId) {
      setFieldErrors(errors)
      haptic.error()
      return
    }
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
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
      setSavedText(
        tt.saved(formatQty(result.qtyInput), unit ? unitLabel(unit) : '', material?.name ?? '', to.name),
      )
      setMaterialId(null)
      setUnitId(null)
      setToId(null)
      setQty('')
      setNote('')
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
  }, [fromId, materialId, unitId, qty, toOptions, toId, draftId, note, unit, material, onSaved])

  const onMain = useCallback(() => void save(), [save])
  const onBack = useCallback(() => {
    if (step === 'details') setMaterialId(null)
    else if (step === 'object') setPickingFrom(false)
    else setPickingFrom(true)
  }, [step])
  const canGoBack = step === 'details' || (step === 'object' && Boolean(fromId)) || (step === 'material' && manyFrom)
  useBackButton(canGoBack ? onBack : null)
  useMainButton(tt.save, step === 'details' && toOptions.length > 0 ? onMain : null, false, saving)
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
          onPick={(m) => {
            haptic.tap()
            setMaterialId(m.id)
            setUnitId(m.units[0]?.id ?? null)
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
                    aria-pressed={o.id === toId}
                    onClick={() => {
                      haptic.select()
                      setToId(o.id)
                      setFieldErrors((e) => ({ ...e, to: undefined }))
                    }}
                    className={`min-h-13 rounded-xl border px-3 text-left text-sm font-semibold transition-colors ${
                      o.id === toId ? 'border-brand bg-ice text-brand' : 'border-line bg-paper text-ink active:bg-ice'
                    }`}
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            )}
            {fieldErrors.to && <p className="text-sm text-danger">{tt.errorTo}</p>}
          </div>

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
