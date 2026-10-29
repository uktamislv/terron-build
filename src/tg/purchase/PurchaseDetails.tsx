// Xarid: balans kartasi va tanlangan material uchun forma (taqdimot — holat PurchasePage'da).
import type { ReactNode, Ref } from 'react'
import { ChevronRight, Wallet } from 'lucide-react'
import { Button, cx, Money, Notice, RetryNotice } from '@/components/ui'
import type { Material, MaterialUnit, Supplier } from '@/data/types'
import { isNegative } from '@/domain/decimal'
import type { PriceCheck } from '@/data/purchasesRepo'
import { t } from '@/i18n'
import { BaseQtyBox } from '../entry/BaseQtyBox'
import { DuplicateWarning } from '../entry/DuplicateWarning'
import type { LastEntry } from '../entry/lastEntry'
import { LastQtyChip } from '../entry/LastQtyChip'
import { PhotoErrorBox, PhotoField, type PickedPhoto } from '../entry/PhotoPicker'
import { BigNumberInput, MaterialHeader, NoteField } from '../entry/QtyField'
import { qtyAmbiguityHint } from '../entry/qtyHint'
import { UnitChips } from '../entry/UnitChips'
import { SupplierPicker, type SupplierChoice } from './SupplierPicker'

const tm = t.tg.movement
const tp = t.tg.purchase
const SUM_INPUT_ID = 'purchase-sum'

/**
 * "Qo'limdagi pul": summa katta, manfiy — qizil. `balance` null — yuklanmoqda. `onOpen` berilsa — butun
 * karta tugma (pul tarixi ochiladi).
 */
export function BalanceCard({
  balance,
  onOpen,
}: {
  balance: { value: string | null; failed: boolean } | null
  onOpen?: () => void
}) {
  const negative = balance?.value != null && isNegative(balance.value)
  const Tag = onOpen ? 'button' : 'div'
  return (
    <Tag
      {...(onOpen ? { type: 'button' as const, onClick: onOpen } : {})}
      className={cx(
        'flex w-full items-center gap-3 rounded-2xl border border-line bg-paper px-4 py-3 text-left',
        onOpen && 'min-h-11 transition-colors hover:border-line-hover active:bg-ice',
      )}
    >
      <span aria-hidden className={cx('inline-flex size-11 shrink-0 items-center justify-center rounded-xl', negative ? 'bg-danger-bg text-danger' : 'bg-ice text-navy')}>
        <Wallet className="size-6" strokeWidth={1.75} />
      </span>
      {balance === null ? (
        <span className="text-sm text-muted">{t.common.loading}</span>
      ) : balance.failed || balance.value === null ? (
        <span className="text-sm text-muted">{tp.balanceUnknown}</span>
      ) : (
        // Balans ekran o'quvchiga ham o'qiladi (aria-label bilan yashirilmaydi)
        <span data-testid="cash-balance" data-negative={negative ? 'true' : undefined} className="flex flex-col">
          <span className="text-sm text-muted">{tp.balance}: </span>
          <Money value={balance.value} size="lg" />
        </span>
      )}
      {onOpen && <span className="sr-only">, {t.tg.cashHistory.openSr}</span>}
      {onOpen && <ChevronRight aria-hidden className="ml-auto size-5 shrink-0 text-muted" strokeWidth={1.75} />}
    </Tag>
  )
}

export type PurchaseFieldErrors = {
  object?: boolean
  unit?: boolean
  qty?: keyof typeof tm.errors.qty
  sum?: 'sumRequired' | 'sumInvalid'
  supplier?: boolean
}

export interface PurchaseDetailsProps {
  material: Material
  unitId: string | null
  unit: MaterialUnit | null
  qty: string
  sum: string
  sumRef?: Ref<HTMLInputElement>
  errors: PurchaseFieldErrors
  qtyBase: string | null
  /** "1 kg narxi: …" — tayyor matn (formatlangan). */
  perBaseText: string | null
  priceVerdict: PriceCheck | null
  suppliers: Supplier[]
  supplier: SupplierChoice
  note: string
  photo: { photo: PickedPhoto | null; notice: string | null; error: string | null; preparing: boolean }
  saving: boolean
  saveError: string | null
  showSaveButton: boolean
  /** Batch 12: chek kartasi, so'rov belgisi (material sarlavhasi ostida). */
  top?: ReactNode
  /** "Bugun / Kecha / Boshqa sana" (chekdagi sana bo'lsa — ko'rsatilmaydi). */
  dateField?: ReactNode
  lastEntry?: LastEntry | null
  onUseLast?: (qty: string, unitId: string) => void
  /** Batch 12 (E): rasm majburiy bo'lsa — sabab. */
  photoRequiredReason?: string | null
  /** Batch 12 (C): takroriy yozuv (daqiqa) — null yo'q. */
  duplicateMinutes?: number | null
  onConfirmDuplicate?: () => void
  onCancelDuplicate?: () => void
  onQty: (v: string) => void
  onUnit: (id: string) => void
  onSum: (raw: string, caret: number | null) => void
  onSupplier: (next: SupplierChoice) => void
  onNote: (v: string) => void
  onChangeMaterial: () => void
  onPickPhoto: (file: File) => void
  onRemovePhoto: () => void
  onSave: () => void
  onSaveWithoutPhoto: () => void
}

export function PurchaseDetails({ sumRef, ...p }: PurchaseDetailsProps) {
  const { material, errors } = p
  return (
    <section className="flex flex-col gap-4" aria-label={material.name}>
      <MaterialHeader name={material.name} onChange={p.onChangeMaterial} />
      {p.top}

      <BigNumberInput
        id="purchase-qty"
        label={tm.qty}
        value={p.qty}
        onChange={(v) => p.onQty(v)}
        suffix={p.unit?.unit ?? null}
        error={errors.qty ? tm.errors.qty[errors.qty] : null}
        hint={qtyAmbiguityHint(p.qty, p.unit?.unit)}
        // Klaviaturadagi "Keyingi" — summa maydoniga (klaviatura yopilmaydi)
        onEnter={() => document.getElementById(SUM_INPUT_ID)?.focus()}
      />
      {p.qty.trim() === '' && p.onUseLast && <LastQtyChip last={p.lastEntry ?? null} units={material.units} onUse={p.onUseLast} />}

      <UnitChips units={material.units} selectedId={p.unitId} onPick={p.onUnit} errorId={errors.unit ? 'purchase-unit-error' : undefined} />
      {errors.unit && (
        <p id="purchase-unit-error" role="alert" className="text-sm text-danger">
          {tm.errors.unit}
        </p>
      )}

      <BigNumberInput
        id={SUM_INPUT_ID}
        inputRef={sumRef}
        label={tp.sum}
        value={p.sum}
        onChange={p.onSum}
        inputMode="numeric"
        autoFocus={false}
        suffix={t.ui.sum}
        error={errors.sum ? tp.errors[errors.sum] : null}
      />

      {(p.qtyBase !== null || p.perBaseText !== null) && (
        <BaseQtyBox qtyBase={p.qtyBase} unit={p.unit} baseUnit={material.base_unit}>
          {p.perBaseText !== null && <p className="tabular text-base font-semibold text-ink">{p.perBaseText}</p>}
        </BaseQtyBox>
      )}
      {p.priceVerdict === 'high' && <Notice tone="warn">{tp.priceHigh}</Notice>}
      {p.priceVerdict === 'low' && <Notice tone="warn">{tp.priceLow}</Notice>}

      <SupplierPicker suppliers={p.suppliers} value={p.supplier} error={Boolean(errors.supplier)} onChange={p.onSupplier} />

      {p.dateField}

      <PhotoField
        label={tp.photo}
        photo={p.photo.photo}
        busy={p.photo.preparing || p.saving}
        preparing={p.photo.preparing}
        notice={p.photo.notice}
        requiredReason={p.photoRequiredReason ?? null}
        onPick={p.onPickPhoto}
        onRemove={p.onRemovePhoto}
      />

      <NoteField label={tp.note} value={p.note} placeholder={tp.notePlaceholder} onChange={p.onNote} />

      {errors.object && <Notice>{tm.errors.object}</Notice>}
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
        <Button
          size="lg"
          onClick={p.onSave}
          disabled={p.photo.preparing}
          loading={p.saving}
        >
          {p.saving ? t.common.saving : tp.save}
        </Button>
      )}
    </section>
  )
}
