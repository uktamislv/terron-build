import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { SegmentedControl } from '@/components/ui'
import type { EntryType } from '@/domain/movements'
import { t } from '@/i18n'

const ic = { 'aria-hidden': true, strokeWidth: 2 } as const

/** Kirim | Chiqim almashtirgichi: tanlangan bo'lak tur rangida (kirim — yashil, chiqim — ko'k). */
export function EntryTypeSwitch({ value, onChange }: { value: EntryType; onChange: (type: EntryType) => void }) {
  return (
    <SegmentedControl
      label={t.tg.movement.typeLabel}
      value={value}
      onChange={onChange}
      size="lg"
      options={[
        { value: 'kirim', label: t.movements.types.kirim, tone: 'ok', icon: <ArrowDownLeft {...ic} /> },
        { value: 'chiqim', label: t.movements.types.chiqim, tone: 'brand', icon: <ArrowUpRight {...ic} /> },
      ]}
    />
  )
}
