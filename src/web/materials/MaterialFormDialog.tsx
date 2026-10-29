import { useId, useState, type FormEvent } from 'react'
import { Button, Checkbox, choiceClass, Modal, Notice, TextField } from '@/components/ui'
import { createMaterial, updateMaterial } from '@/data/materialsRepo'
import type { Material } from '@/data/types'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatQty } from '@/lib/format'
import { isNameTaken } from './materialFilter'
import { parseWastePct, QUICK_BASE_UNITS } from './materialForm'

interface Errors {
  name?: 'missing' | 'taken'
  baseUnit?: boolean
  waste?: boolean
}

export function MaterialFormDialog({
  companyId,
  material,
  materials,
  categories,
  onClose,
  onSaved,
}: {
  companyId: string
  material?: Material
  /** Firmadagi barcha materiallar — nom dublikatini oldindan tekshirish uchun. */
  materials: readonly Material[]
  categories: string[]
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const listId = useId()
  const initialBase = material?.base_unit ?? ''
  const initialIsQuick = QUICK_BASE_UNITS.includes(initialBase)
  const [name, setName] = useState(material?.name ?? '')
  const [baseUnit, setBaseUnit] = useState(initialBase)
  const [otherOpen, setOtherOpen] = useState(Boolean(initialBase) && !initialIsQuick)
  const [category, setCategory] = useState(material?.category ?? '')
  const [waste, setWaste] = useState(material ? formatQty(material.waste_pct) : '')
  const [photoRequired, setPhotoRequired] = useState(Boolean(material?.photo_required))
  const [outsideEstimate, setOutsideEstimate] = useState(Boolean(material?.outside_estimate))
  const [errors, setErrors] = useState<Errors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const wastePct = parseWastePct(waste)
    const nameState = !name.trim() ? 'missing' : isNameTaken(materials, name, material?.id) ? 'taken' : undefined
    const next: Errors = { name: nameState, baseUnit: !baseUnit.trim(), waste: wastePct === null }
    setErrors(next)
    if (next.name || next.baseUnit || wastePct === null) return
    setSaving(true)
    setSaveError(null)
    try {
      if (material) {
        await updateMaterial(material.id, { name, baseUnit, category, wastePct, photoRequired, outsideEstimate })
        onSaved(material.id)
      } else {
        const created = await createMaterial({ companyId, name, baseUnit, category, wastePct, photoRequired, outsideEstimate })
        onSaved(created.id)
      }
    } catch (err) {
      setSaveError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  const chip = (selected: boolean) => choiceClass({ selected, shape: 'box' })

  return (
    <Modal title={material ? t.materials.editTitle : t.materials.addTitle} onClose={onClose}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {saveError && <Notice>{saveError}</Notice>}
        <TextField
          label={t.materials.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name === 'missing' ? t.materials.errName : errors.name === 'taken' ? t.materials.errNameTaken : null}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-muted">{t.materials.baseUnit}</legend>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {QUICK_BASE_UNITS.map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={!otherOpen && baseUnit === u}
                className={chip(!otherOpen && baseUnit === u)}
                onClick={() => {
                  setOtherOpen(false)
                  setBaseUnit(u)
                }}
              >
                {u}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={otherOpen}
              className={chip(otherOpen)}
              onClick={() => {
                setOtherOpen(true)
                if (QUICK_BASE_UNITS.includes(baseUnit)) setBaseUnit('')
              }}
            >
              {t.materials.otherUnit}
            </button>
          </div>
          {otherOpen && (
            <TextField
              label={t.materials.otherUnitLabel}
              value={baseUnit}
              onChange={(e) => setBaseUnit(e.target.value)}
            />
          )}
          <p className={`text-xs ${errors.baseUnit ? 'text-danger' : 'text-muted'}`}>
            {errors.baseUnit ? t.materials.errBaseUnit : t.materials.baseUnitHint}
          </p>
        </fieldset>
        <TextField
          label={t.materials.category}
          value={category}
          list={listId}
          onChange={(e) => setCategory(e.target.value)}
        />
        <datalist id={listId}>
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <TextField
          label={t.materials.wastePct}
          value={waste}
          inputMode="decimal"
          placeholder="0"
          onChange={(e) => setWaste(e.target.value)}
          error={errors.waste ? t.materials.errWaste : null}
        />
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-paper px-3 py-2.5">
          <Checkbox checked={photoRequired} onChange={(e) => setPhotoRequired(e.target.checked)} className="mt-0.5" />
          <span className="flex flex-col">
            <span className="text-sm font-medium text-ink">{t.materials.photoRequired}</span>
            <span className="text-xs text-muted">{t.materials.photoRequiredHint}</span>
          </span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-paper px-3 py-2.5">
          <Checkbox
            checked={outsideEstimate}
            onChange={(e) => setOutsideEstimate(e.target.checked)}
            className="mt-0.5"
            data-testid="material-outside-estimate"
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium text-ink">{t.materials.outsideEstimate}</span>
            <span className="text-xs text-muted">{t.materials.outsideEstimateHint}</span>
          </span>
        </label>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t.common.saving : t.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
