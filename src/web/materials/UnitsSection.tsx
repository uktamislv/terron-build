import { useState, type FormEvent } from 'react'
import { Button, Notice, TextField } from '@/components/ui'
import { isBaseUnit } from '@/data/materialsRepo'
import { addMaterialUnit, softDeleteMaterialUnit, updateMaterialUnit } from '@/data/materialUnitsRepo'
import { errorCodeOf, type RepoErrorCode } from '@/data/errors'
import type { Material, MaterialUnit } from '@/data/types'
import { normalizeAlias } from '@/domain/aliases'
import { conversionHint, unitLabel, validateFactor } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatQty } from '@/lib/format'
import { isUnitTaken, toUnitDef } from './materialFilter'

const tu = t.materials.units

/** Birlik qo'shish/tahrirlash formasi — koeffitsient jonli tekshiriladi va "1 X = N base" ko'rsatiladi. */
function UnitForm({
  material,
  unit,
  onCancel,
  onSaved,
  onAddNew,
}: {
  material: Material
  unit?: MaterialUnit
  onCancel: () => void
  onSaved: () => void
  /** Ishlatilgan birlikni tahrirlab bo'lmasa — yangi birlik qo'shishga o'tish. */
  onAddNew?: () => void
}) {
  const [name, setName] = useState(unit?.unit ?? '')
  const [factor, setFactor] = useState(unit ? formatQty(unit.factor).replace(/\s/g, '') : '')
  const [variant, setVariant] = useState(unit?.variant ?? '')
  const [submitted, setSubmitted] = useState(false)
  const [saveError, setSaveError] = useState<{ text: string; code: RepoErrorCode } | null>(null)
  const [saving, setSaving] = useState(false)

  const factorCheck = validateFactor(factor)
  const showFactorError = !factorCheck.ok && (submitted || factor.trim() !== '')
  const nameMissing = !name.trim()
  // Bazada birlik nomi normallashtirilgan unique ("KG" = "kg") — shu qoidada oldindan tekshiramiz.
  const sameAsBase =
    !nameMissing && normalizeAlias(name) === normalizeAlias(material.base_unit) && !normalizeAlias(variant)
  const duplicate = !nameMissing && !sameAsBase && isUnitTaken(material.units, name, variant || null, unit?.id)
  const nameError =
    submitted && nameMissing ? tu.errUnit : sameAsBase ? tu.errSameAsBase : duplicate ? tu.errDuplicate : null
  const preview =
    factorCheck.ok && !nameMissing
      ? conversionHint(
          { id: '', materialId: material.id, unit: name, factor: factorCheck.value, variant: variant.trim() || null },
          material.base_unit,
        )
      : null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (nameMissing || sameAsBase || duplicate || !factorCheck.ok) return
    setSaving(true)
    setSaveError(null)
    try {
      if (unit) {
        await updateMaterialUnit(unit.id, { unit: name, factor: factorCheck.value, variant })
      } else {
        await addMaterialUnit({
          companyId: material.company_id,
          materialId: material.id,
          unit: name,
          factor: factorCheck.value,
          variant,
        })
      }
      onSaved()
    } catch (err) {
      setSaveError({ text: errorText(err), code: errorCodeOf(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      aria-label={unit ? tu.editTitle : tu.addTitle}
      className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-brand-light/40 p-3"
    >
      <p className="text-sm font-semibold text-brand-dark">{unit ? tu.editTitle : tu.addTitle}</p>
      {saveError && (
        <Notice>
          <span className="block">{saveError.text}</span>
          {saveError.code === 'catalog_unit_in_use' && onAddNew && (
            <Button variant="secondary" className="mt-2" onClick={onAddNew}>
              {tu.add}
            </Button>
          )}
        </Notice>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={tu.unit}
          placeholder={tu.unitPlaceholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError}
        />
        <TextField
          label={tu.factor}
          inputMode="decimal"
          value={factor}
          onChange={(e) => setFactor(e.target.value)}
          error={showFactorError && !factorCheck.ok ? tu.factorErrors[factorCheck.reason] : null}
          hint={`${tu.factorHint} (${material.base_unit})`}
        />
      </div>
      <TextField
        label={tu.variant}
        placeholder={tu.variantPlaceholder}
        value={variant}
        onChange={(e) => setVariant(e.target.value)}
      />
      {preview && (
        <p role="status" className="rounded-lg bg-white px-3 py-2 text-sm text-brand-dark">
          {tu.preview}: <span className="font-semibold">{preview}</span>
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? t.common.saving : t.common.save}
        </Button>
      </div>
    </form>
  )
}

type Editing = { kind: 'add' } | { kind: 'edit'; id: string } | null

export function UnitsSection({
  material,
  canManage,
  onChanged,
}: {
  material: Material
  canManage: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<Editing>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove(id: string) {
    setBusy(true)
    setError(null)
    try {
      await softDeleteMaterialUnit(id)
      setConfirmId(null)
      onChanged()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const saved = () => {
    setEditing(null)
    onChanged()
  }

  return (
    <section aria-label={tu.title} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{tu.title}</h3>
        {canManage && editing?.kind !== 'add' && (
          <Button variant="ghost" onClick={() => setEditing({ kind: 'add' })}>
            {tu.add}
          </Button>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
      {editing?.kind === 'add' && <UnitForm material={material} onCancel={() => setEditing(null)} onSaved={saved} />}
      <ul className="flex flex-col gap-2">
        {material.units.map((u) => {
          const base = isBaseUnit(material, u)
          if (editing?.kind === 'edit' && editing.id === u.id) {
            return (
              <li key={u.id}>
                <UnitForm
                  material={material}
                  unit={u}
                  onCancel={() => setEditing(null)}
                  onSaved={saved}
                  onAddNew={() => setEditing({ kind: 'add' })}
                />
              </li>
            )
          }
          return (
            <li
              key={u.id}
              data-testid={`unit-${u.id}`}
              className={`flex flex-col gap-2 rounded-xl border px-3 py-2 sm:flex-row sm:items-center sm:justify-between ${
                base ? 'border-brand/30 bg-brand-light/50' : 'border-slate-200'
              }`}
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                  {unitLabel(u)}
                  {base && (
                    <span title={tu.baseLocked} className="rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-white">
                      {tu.base}
                    </span>
                  )}
                </p>
                <p className="text-sm text-slate-600">{conversionHint(toUnitDef(u), material.base_unit)}</p>
              </div>
              {canManage && !base && (
                <div className="flex flex-wrap gap-2">
                  {confirmId === u.id ? (
                    <>
                      <span className="self-center text-sm text-slate-700">{tu.deleteConfirm}</span>
                      <Button variant="danger" disabled={busy} onClick={() => void remove(u.id)}>
                        {t.common.yes}
                      </Button>
                      <Button variant="secondary" onClick={() => setConfirmId(null)}>
                        {t.common.no}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="secondary" onClick={() => setEditing({ kind: 'edit', id: u.id })}>
                        {t.common.edit}
                      </Button>
                      <Button variant="danger" onClick={() => setConfirmId(u.id)}>
                        {t.materials.delete}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {material.units.length <= 1 && <p className="text-sm text-slate-500">{tu.empty}</p>}
    </section>
  )
}
