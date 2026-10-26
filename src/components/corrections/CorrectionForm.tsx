// O'z yozuvini tuzatish (RPC `correct_entry`): miqdor, birlik, xaridda summa, majburiy sabab va ixtiyoriy izoh.
// Veb — admin dialogi va muallif (30 daqiqa). Telegram ilovasi — `src/tg/corrections/TgCorrectionForm.tsx`
// (katta raqam maydoni); holat va saqlash ikkalasida umumiy (`useCorrectionForm`).
import type { FormEvent } from 'react'
import { Button, choiceClass, Notice, RetryNotice, SkeletonRows, TextAreaField, TextField } from '@/components/ui'
import { CORRECTION_NOTE_MAX } from '@/data/correctionsRepo'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { MoveFields } from './MoveFields'
import { correctionErrorMessage, useCorrectionForm, type CorrectionTarget } from './useCorrectionForm'

export type { CorrectionTarget } from './useCorrectionForm'

const tc = t.correction

export function CorrectionForm({
  target,
  onDone,
  onCancel,
  remaining,
  size = 'sm',
  allowMove = false,
}: {
  target: CorrectionTarget
  onDone: () => void
  onCancel: () => void
  /** Muallif uchun qolgan butun daqiqalar; admin — yo'q. */
  remaining?: number | null
  /** Chip matni: sm — veb, md — Telegram ilovasi. */
  size?: 'sm' | 'md'
  /** Muallif (30 daqiqa): material va obyektni ham almashtira oladi. */
  allowMove?: boolean
}) {
  const f = useCorrectionForm(target, onDone, allowMove)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void f.submit()
  }

  const units = f.material?.units ?? []
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-label={tc.title}>
      <p className="text-sm text-muted">{target.table === 'purchases' ? tc.introPurchase : tc.introMovement}</p>
      {!allowMove && target.materialName && <p className="text-base font-semibold text-ink">{target.materialName}</p>}
      {allowMove && (
        <MoveFields choices={f.choices} materialId={f.materialId} objectId={f.objectId} onMaterial={f.setMaterialId} onObject={f.setObjectId} />
      )}
      {remaining != null && (
        <Notice tone="info">
          <span data-testid="correction-remaining">{tc.remaining(remaining)}</span>
        </Notice>
      )}
      <TextField
        label={tc.qty}
        inputMode="decimal"
        autoComplete="off"
        value={f.qty}
        suffix={f.unit ? unitLabel(f.unit) : undefined}
        error={f.errors.qty ? correctionErrorMessage('qty', f.errors.qty) : null}
        onChange={(e) => f.setQty(e.target.value)}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink">{tc.unit}</legend>
        {f.loadError && <RetryNotice message={f.loadError} onRetry={f.reload} />}
        {!f.material && !f.loadError && <SkeletonRows rows={1} />}
        {f.material && (
          <div className="flex flex-wrap gap-2">
            {units.map((u) => (
              <button
                key={u.id}
                type="button"
                aria-pressed={f.unitId === u.id}
                className={choiceClass({ selected: f.unitId === u.id, size })}
                onClick={() => f.setUnitId(u.id)}
              >
                {unitLabel(u)}
              </button>
            ))}
          </div>
        )}
        {f.errors.unit && (
          <p role="alert" className="text-sm text-danger">
            {correctionErrorMessage('unit', f.errors.unit)}
          </p>
        )}
      </fieldset>
      {target.table === 'purchases' && (
        <TextField
          label={tc.total}
          inputMode="numeric"
          autoComplete="off"
          value={f.total}
          suffix={t.ui.sum}
          error={f.errors.total ? correctionErrorMessage('total', f.errors.total) : null}
          onChange={(e) => f.setTotal(e.target.value)}
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
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button type="submit" loading={f.saving} disabled={f.saving}>
          {f.saving ? t.common.saving : tc.save}
        </Button>
      </div>
    </form>
  )
}
