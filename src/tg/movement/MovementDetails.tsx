// Kirim/chiqim: tanlangan material uchun forma (taqdimot komponenti — holat sahifada, MovementPage).
import type { ReactNode } from 'react'
import { Button, Notice, RetryNotice } from '@/components/ui'
import type { Material, MaterialUnit, OpenPurchase } from '@/data/types'
import type { DraftErrorCode, EntryType, MovementWarning } from '@/domain/movements'
import { t } from '@/i18n'
import { formatQty } from '@/lib/format'
import { BaseQtyBox } from '../entry/BaseQtyBox'
import { DuplicateWarning } from '../entry/DuplicateWarning'
import type { LastEntry } from '../entry/lastEntry'
import { LastQtyChip } from '../entry/LastQtyChip'
import { PhotoErrorBox, PhotoField, type PickedPhoto } from '../entry/PhotoPicker'
import { BigNumberInput, MaterialHeader, NoteField } from '../entry/QtyField'
import { UnitChips } from '../entry/UnitChips'
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
  /** Batch 12 (A): yagona ochiq xarid avtomatik tanlangan. */
  autoLinked?: boolean
  /** Batch 12 (L): oxirgi miqdor taklifi. */
  lastEntry?: LastEntry | null
  onUseLast?: (qty: string, unitId: string) => void
  /** Batch 12 (E): rasm majburiy bo'lsa — sabab. */
  photoRequiredReason?: string | null
  /** Batch 12 (C): takroriy yozuv ogohlantirishi (daqiqa) — null yo'q. */
  duplicateMinutes?: number | null
  onConfirmDuplicate?: () => void
  onCancelDuplicate?: () => void
  /** Admin: "Shu yerni obyekt joyi qilish" va boshqa qo'shimchalar. */
  extra?: ReactNode
  /** "Bugun / Kecha / Boshqa sana" (standart — bugun, qo'shimcha bosishsiz). */
  dateField?: ReactNode
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

      <BigNumberInput
        id="movement-qty"
        label={tm.qty}
        value={p.qty}
        onChange={p.onQty}
        suffix={p.unit?.unit ?? null}
        error={p.qtyError ? tm.errors.qty[p.qtyError] : null}
      />
      {p.qty.trim() === '' && p.onUseLast && (
        <LastQtyChip last={p.lastEntry ?? null} units={material.units} onUse={p.onUseLast} />
      )}

      <UnitChips units={material.units} selectedId={p.unitId} onPick={p.onUnit} errorId={p.unitError ? 'movement-unit-error' : undefined} />
      {p.unitError && (
        <p id="movement-unit-error" role="alert" className="text-sm text-danger">
          {tm.errors.unit}
        </p>
      )}

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
          autoLinked={Boolean(p.autoLinked)}
          baseUnit={material.base_unit}
          onSelect={p.onSelectLinked}
        />
      )}

      {p.dateField}

      <PhotoField
        label={tm.photo}
        photo={p.photo.photo}
        busy={p.photo.preparing || p.saving}
        preparing={p.photo.preparing}
        notice={p.photo.notice}
        requiredReason={p.photoRequiredReason ?? null}
        onPick={p.onPickPhoto}
        onRemove={p.onRemovePhoto}
      />

      <NoteField label={tm.note} value={p.note} placeholder={tm.notePlaceholder} onChange={p.onNote} />

      {p.extra}
      {p.objectError && <Notice>{tm.errors.object}</Notice>}
      {p.duplicateMinutes != null && (
        <DuplicateWarning
          minutes={p.duplicateMinutes}
          busy={p.saving}
          onConfirm={() => p.onConfirmDuplicate?.()}
          onCancel={() => p.onCancelDuplicate?.()}
        />
      )}
      {p.saveError && <RetryNotice message={p.saveError} onRetry={p.onSave} />}
      {p.photo.error && (
        <PhotoErrorBox message={p.photo.error} busy={p.saving} onRetry={p.onSave} onWithoutPhoto={p.photoRequiredReason ? null : p.onSaveWithoutPhoto} />
      )}

      {p.showSaveButton && (
        <Button size="lg" onClick={p.onSave} disabled={p.photo.preparing || Boolean(p.photoRequiredReason && !p.photo.photo)} loading={p.saving}>
          {p.saving ? t.common.saving : tm.save}
        </Button>
      )}
    </section>
  )
}
