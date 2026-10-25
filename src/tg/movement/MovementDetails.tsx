// Kirim/chiqim: tanlangan material uchun forma (taqdimot komponenti — holat sahifada, MovementPage).
import { Button, Notice } from '@/components/ui'
import type { Material, MaterialUnit, OpenPurchase } from '@/data/types'
import type { DraftErrorCode, EntryType, MovementWarning } from '@/domain/movements'
import { t } from '@/i18n'
import { formatQty } from '@/lib/format'
import { BaseQtyBox } from '../entry/BaseQtyBox'
import { PhotoErrorBox, PhotoField, type PickedPhoto } from '../entry/PhotoPicker'
import { MaterialHeader, NoteField } from '../entry/QtyField'
import { bigInputClass } from '../entry/styles'
import { UnitChips } from '../entry/UnitChips'
import { LoadError } from '../ui'
import { LinkedPurchases } from './LinkedPurchases'

const tm = t.tg.movement

export interface MovementDetailsProps {
  type: EntryType
  material: Material
  unitId: string | null
  unit: MaterialUnit | null
  qty: string
  qtyError?: DraftErrorCode
  unitError?: boolean
  objectError?: boolean
  /** Asosiy birlikdagi miqdor (to'g'ri kiritilgan bo'lsa). */
  qtyBase: string | null
  /** Chiqimda: joriy qoldiq va chiqimdan keyingisi. */
  stock: { current: string; after: string } | null
  warning: MovementWarning | null
  openPurchases: OpenPurchase[]
  linkedPurchaseId: string | null
  note: string
  photo: { photo: PickedPhoto | null; notice: string | null; error: string | null; preparing: boolean }
  saving: boolean
  saveError: string | null
  /** Telegram tashqarisida (brauzer) — oddiy "Saqlash" tugmasi. */
  showSaveButton: boolean
  onQty: (v: string) => void
  onUnit: (id: string) => void
  onNote: (v: string) => void
  onChangeMaterial: () => void
  onSelectLinked: (id: string | null) => void
  onPickPhoto: (file: File) => void
  onRemovePhoto: () => void
  onSave: () => void
  onSaveWithoutPhoto: () => void
}

export function MovementDetails(p: MovementDetailsProps) {
  const { material } = p
  return (
    <section className="flex flex-col gap-4" aria-label={material.name}>
      <MaterialHeader name={material.name} onChange={p.onChangeMaterial} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="movement-qty" className="text-sm font-medium text-ink">
          {tm.qty}
        </label>
        <input
          id="movement-qty"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={p.qty}
          aria-invalid={p.qtyError ? true : undefined}
          onChange={(e) => p.onQty(e.target.value)}
          className={bigInputClass(Boolean(p.qtyError))}
        />
        {p.qtyError && <p className="text-sm text-danger">{tm.errors.qty[p.qtyError]}</p>}
      </div>

      <UnitChips units={material.units} selectedId={p.unitId} onPick={p.onUnit} />
      {p.unitError && <p className="text-sm text-danger">{tm.errors.unit}</p>}

      {p.qtyBase !== null && (
        <BaseQtyBox qtyBase={p.qtyBase} unit={p.unit} baseUnit={material.base_unit}>
          {p.type === 'chiqim' && p.stock && (
            <p className="tabular text-sm text-muted">
              {tm.stock(formatQty(p.stock.current), formatQty(p.stock.after), material.base_unit)}
            </p>
          )}
        </BaseQtyBox>
      )}
      {p.warning && <Notice tone="warn">{tm.warnings[p.warning]}</Notice>}

      {p.type === 'kirim' && (
        <LinkedPurchases
          rows={p.openPurchases}
          selectedId={p.linkedPurchaseId}
          baseUnit={material.base_unit}
          onSelect={p.onSelectLinked}
        />
      )}

      <PhotoField
        label={tm.photo}
        photo={p.photo.photo}
        busy={p.photo.preparing || p.saving}
        preparing={p.photo.preparing}
        notice={p.photo.notice}
        onPick={p.onPickPhoto}
        onRemove={p.onRemovePhoto}
      />

      <NoteField label={tm.note} value={p.note} placeholder={tm.notePlaceholder} onChange={p.onNote} />

      {p.objectError && <Notice>{tm.errors.object}</Notice>}
      {p.saveError && <LoadError message={p.saveError} onRetry={p.onSave} />}
      {p.photo.error && (
        <PhotoErrorBox message={p.photo.error} busy={p.saving} onRetry={p.onSave} onWithoutPhoto={p.onSaveWithoutPhoto} />
      )}

      {p.showSaveButton && (
        <Button size="lg" onClick={p.onSave} disabled={p.photo.preparing} loading={p.saving}>
          {p.saving ? t.common.saving : tm.save}
        </Button>
      )}
    </section>
  )
}
