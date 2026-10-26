// O'z yozuvini tuzatish (RPC `correct_entry`): miqdor, birlik, xaridda summa va majburiy sabab.
// Telegram ilovasida — pastki varaq ("Yozuvlarim", muallif, 30 daqiqa), vebda — admin dialogi.
import { useEffect, useState, type FormEvent } from 'react'
import { Button, choiceClass, Notice, RetryNotice, SkeletonRows, TextAreaField, TextField } from '@/components/ui'
import { correctEntry, CORRECTION_NOTE_MAX, type CorrectableTable } from '@/data/correctionsRepo'
import { getMaterial } from '@/data/materialsRepo'
import type { Material } from '@/data/types'
import { formatSumInput } from '@/domain/cash'
import { validateCorrection, type CorrectionError, type CorrectionErrorField } from '@/domain/corrections'
import { formatDecUz, unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'

const tc = t.correction

export interface CorrectionTarget {
  table: CorrectableTable
  id: string
  materialId: string
  materialName: string | null
  qtyInput: string
  unitId: string
  /** Faqat xarid. */
  totalAmount?: string | null
  note: string | null
}

function errorMessage(field: CorrectionErrorField, code: CorrectionError): string {
  if (field === 'note') return tc.errNote
  if (field === 'unit') return tc.errUnit
  if (field === 'total') return code === 'required' ? tc.errTotalRequired : tc.errTotal
  return code === 'required' ? tc.errQtyRequired : (t.tg.movement.errors.qty[code as keyof typeof t.tg.movement.errors.qty] ?? tc.errQty)
}

export function CorrectionForm({
  target,
  onDone,
  onCancel,
  remaining,
  size = 'sm',
}: {
  target: CorrectionTarget
  onDone: () => void
  onCancel: () => void
  /** Muallif uchun qolgan vaqt matni ("12:30"); admin — yo'q. */
  remaining?: string | null
  /** Chip matni: sm — veb, md — Telegram ilovasi. */
  size?: 'sm' | 'md'
}) {
  const [material, setMaterial] = useState<Material | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [qty, setQty] = useState(() => formatDecUz(target.qtyInput).replace(/\u202F/g, ''))
  const [unitId, setUnitId] = useState<string>(target.unitId)
  const [total, setTotal] = useState(() => (target.totalAmount ? formatSumInput(target.totalAmount.replace('.', ',')) : ''))
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Partial<Record<CorrectionErrorField, CorrectionError>>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getMaterial(target.materialId)
      .then((m) => {
        if (!alive) return
        setMaterial(m)
        setLoadError(null)
      })
      .catch((err: unknown) => alive && setLoadError(errorText(err)))
    return () => {
      alive = false
    }
  }, [target.materialId, reloadKey])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    const result = validateCorrection({
      table: target.table,
      original: { qtyInput: target.qtyInput, unitId: target.unitId, totalAmount: target.totalAmount ?? null },
      qtyInput: qty,
      unitId,
      totalInput: target.table === 'purchases' ? total : undefined,
      note,
    })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await correctEntry({
        table: target.table,
        id: target.id,
        qtyInput: result.value.qtyInput,
        unitId: result.value.unitId,
        totalAmount: result.value.totalAmount,
        note: result.value.note,
      })
      onDone()
    } catch (err) {
      setSaveError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  const units = material?.units ?? []
  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" aria-label={tc.title}>
      <p className="text-sm text-muted">{target.table === 'purchases' ? tc.introPurchase : tc.introMovement}</p>
      {target.materialName && <p className="text-base font-semibold text-ink">{target.materialName}</p>}
      {remaining && (
        <Notice tone="info">
          <span data-testid="correction-remaining">{tc.remaining(remaining)}</span>
        </Notice>
      )}
      <TextField
        label={tc.qty}
        inputMode="decimal"
        autoComplete="off"
        value={qty}
        error={errors.qty ? errorMessage('qty', errors.qty) : null}
        onChange={(e) => {
          setQty(e.target.value)
          setErrors((er) => ({ ...er, qty: undefined }))
        }}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink">{tc.unit}</legend>
        {loadError && <RetryNotice message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />}
        {!material && !loadError && <SkeletonRows rows={1} />}
        {material && (
          <div className="flex flex-wrap gap-2">
            {units.map((u) => (
              <button
                key={u.id}
                type="button"
                aria-pressed={unitId === u.id}
                className={choiceClass({ selected: unitId === u.id, size })}
                onClick={() => {
                  setUnitId(u.id)
                  setErrors((er) => ({ ...er, unit: undefined }))
                }}
              >
                {unitLabel(u)}
              </button>
            ))}
          </div>
        )}
        {errors.unit && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage('unit', errors.unit)}
          </p>
        )}
      </fieldset>
      {target.table === 'purchases' && (
        <TextField
          label={tc.total}
          inputMode="numeric"
          autoComplete="off"
          value={total}
          error={errors.total ? errorMessage('total', errors.total) : null}
          onChange={(e) => {
            setTotal(formatSumInput(e.target.value))
            setErrors((er) => ({ ...er, total: undefined }))
          }}
        />
      )}
      <TextAreaField
        label={tc.note}
        required
        aria-required="true"
        rows={2}
        maxLength={CORRECTION_NOTE_MAX}
        placeholder={tc.notePlaceholder}
        value={note}
        hint={tc.noteHint}
        error={errors.note ? errorMessage('note', errors.note) : null}
        onChange={(e) => {
          setNote(e.target.value)
          setErrors((er) => ({ ...er, note: undefined }))
        }}
      />
      {saveError && <Notice>{saveError}</Notice>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button type="submit" loading={saving} disabled={saving}>
          {saving ? t.common.saving : tc.save}
        </Button>
      </div>
    </form>
  )
}
