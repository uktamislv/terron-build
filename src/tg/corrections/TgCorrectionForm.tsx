// Telegram ilovasi: o'z yozuvini tuzatish varag'i — kirim/chiqim formasi bilan bir xil uslub:
// katta raqam maydoni (ichida birlik / "so'm"), ostida birlik chiplari va "= … asosiy birlikda".
// Holat va saqlash — veb bilan umumiy (`useCorrectionForm`).
import type { FormEvent } from 'react'
import { Button, Notice, RetryNotice, SkeletonRows, TextAreaField } from '@/components/ui'
import { correctionErrorMessage, useCorrectionForm, type CorrectionTarget } from '@/components/corrections/useCorrectionForm'
import { MoveFields } from '@/components/corrections/MoveFields'
import { CORRECTION_NOTE_MAX } from '@/data/correctionsRepo'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { BaseQtyBox } from '../entry/BaseQtyBox'
import { BigNumberInput } from '../entry/QtyField'
import { UnitChips } from '../entry/UnitChips'
import { haptic } from '../telegram'
import { useClosingConfirmation } from '../useTelegramButtons'

const tc = t.correction

export function TgCorrectionForm({
  target,
  onDone,
  onCancel,
  remaining,
}: {
  target: CorrectionTarget
  onDone: () => void
  onCancel: () => void
  /** Qolgan butun daqiqalar. */
  remaining: number | null
}) {
  // Muallif tuzatishi — material va obyektni ham almashtira oladi
  const f = useCorrectionForm(target, onDone, true)
  // Qoralama o'zgargan — Telegram yopishdan oldin tasdiq so'raydi
  useClosingConfirmation(f.dirty)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await f.submit()
    if (ok) haptic.success()
    else haptic.error()
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" aria-label={tc.title}>
      <p className="text-sm text-muted">{target.table === 'purchases' ? tc.introPurchase : tc.introMovement}</p>
      <MoveFields choices={f.choices} materialId={f.materialId} objectId={f.objectId} onMaterial={f.setMaterialId} onObject={f.setObjectId} />
      {remaining !== null && (
        <Notice tone="info">
          <span data-testid="correction-remaining">{tc.remaining(remaining)}</span>
        </Notice>
      )}
      {f.loadError && <RetryNotice message={f.loadError} onRetry={f.reload} />}
      {!f.material && !f.loadError && <SkeletonRows rows={2} />}
      {f.material && (
        <>
          <div className="flex flex-col gap-2">
            <BigNumberInput
              id="correction-qty"
              label={tc.qty}
              value={f.qty}
              autoFocus={false}
              onChange={(v) => f.setQty(v)}
              suffix={f.unit ? unitLabel(f.unit) : null}
              error={f.errors.qty ? correctionErrorMessage('qty', f.errors.qty) : null}
            />
            <UnitChips
              units={f.material.units}
              selectedId={f.unitId}
              errorId={f.errors.unit ? 'correction-unit-error' : undefined}
              onPick={(id) => {
                haptic.select()
                f.setUnitId(id)
              }}
            />
            {f.errors.unit && (
              <p id="correction-unit-error" role="alert" className="text-sm text-danger">
                {correctionErrorMessage('unit', f.errors.unit)}
              </p>
            )}
          </div>
          <BaseQtyBox qtyBase={f.qtyBase} unit={f.unit} baseUnit={f.material.base_unit} />
        </>
      )}
      {target.table === 'purchases' && (
        <BigNumberInput
          id="correction-total"
          label={tc.total}
          inputMode="numeric"
          autoFocus={false}
          value={f.total}
          suffix={t.ui.sum}
          onChange={(v) => f.setTotal(v)}
          error={f.errors.total ? correctionErrorMessage('total', f.errors.total) : null}
        />
      )}
      <TextAreaField
        label={tc.reason}
        required
        aria-required="true"
        rows={2}
        maxLength={CORRECTION_NOTE_MAX}
        placeholder={tc.reasonPlaceholder}
        value={f.reason}
        hint={tc.reasonHint}
        error={f.errors.reason ? correctionErrorMessage('reason', f.errors.reason) : null}
        onChange={(e) => f.setReason(e.target.value)}
      />
      <TextAreaField
        label={tc.note}
        rows={2}
        maxLength={CORRECTION_NOTE_MAX}
        value={f.note}
        hint={tc.noteHint}
        onChange={(e) => f.setNote(e.target.value)}
      />
      {f.saveError && <Notice>{f.saveError}</Notice>}
      <div className="flex flex-col-reverse gap-2">
        <Button variant="secondary" size="lg" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button type="submit" size="lg" loading={f.saving} disabled={f.saving}>
          {f.saving ? t.common.saving : tc.save}
        </Button>
      </div>
    </form>
  )
}
