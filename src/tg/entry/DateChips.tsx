// "Bugun / Kecha / Boshqa sana" — yozuv sanasi (kirim/chiqim, xarid). Standart — "Bugun" (server
// `now()`), shuning uchun qo'shimcha bosish talab qilinmaydi. "Boshqa sana" — DateField, admin
// bo'lmaganlarga oxirgi 3 kun (bazadagi qoida).
import { useId, useState } from 'react'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { BottomSheet, Button, choiceClass, cx, DateField } from '@/components/ui'
import { isoDateToDisplay } from '@/lib/format'
import { entryDateBounds, type EntryDateChoice } from '@/domain/entryDate'
import type { DateChipsValue } from './dateChoice'
import { t } from '@/i18n'
import { haptic } from '../telegram'

const td = t.tg.date

export function DateChips({
  value,
  onChange,
  isAdmin,
  error,
  nowIso = new Date().toISOString(),
}: {
  value: DateChipsValue
  onChange: (next: DateChipsValue) => void
  isAdmin: boolean
  error?: string | null
  /** Test uchun. */
  nowIso?: string
}) {
  const labelId = useId()
  const bounds = entryDateBounds(nowIso, isAdmin)
  const chips: { key: EntryDateChoice; label: string }[] = [
    { key: 'today', label: td.today },
    { key: 'yesterday', label: td.yesterday },
    { key: 'other', label: td.other },
  ]
  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="text-sm font-medium text-ink">
        {td.label}
      </span>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={value.choice === c.key}
            className={choiceClass({ selected: value.choice === c.key, size: 'md' })}
            onClick={() => {
              haptic.select()
              onChange({ choice: c.key, other: c.key === 'other' ? value.other : '' })
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      {value.choice === 'other' && (
        <DateField
          label={td.pick}
          value={value.other}
          min={bounds.min}
          max={bounds.max}
          hint={isAdmin ? undefined : td.pickHint}
          error={error ?? null}
          onChange={(iso) => onChange({ choice: 'other', other: iso })}
        />
      )}
      {value.choice !== 'other' && error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Ixcham sana chipi ("Bugun ▾") — obyekt satrida turadi, klaviatura ochilganda ham yopilib qolmaydi.
 * Bosilsa — varaq: "Bugun / Kecha / Boshqa sana" (+ sana maydoni). "Bugun" — standart, bosish shart emas.
 */
export function DateChip({
  value,
  onChange,
  isAdmin,
  error,
  nowIso,
}: {
  value: DateChipsValue
  onChange: (next: DateChipsValue) => void
  isAdmin: boolean
  error?: string | null
  nowIso?: string
}) {
  const [open, setOpen] = useState(false)
  const label = value.choice === 'other' ? (value.other ? isoDateToDisplay(value.other) : td.other) : td[value.choice]
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${td.label}: ${label}`}
        aria-invalid={error ? true : undefined}
        data-testid="date-chip"
        onClick={() => {
          haptic.select()
          setOpen(true)
        }}
        className={cx(
          choiceClass({ selected: value.choice !== 'today', shape: 'pill', size: 'sm' }),
          'gap-1 px-3',
          error && 'border-danger text-danger',
        )}
      >
        <CalendarDays aria-hidden className="size-4" strokeWidth={1.75} />
        <span className="tabular">{label}</span>
        <ChevronDown aria-hidden className="size-4" strokeWidth={1.75} />
      </button>
      {open && (
        <BottomSheet
          title={td.label}
          onClose={() => setOpen(false)}
          footer={
            <Button className="flex-1" size="lg" onClick={() => setOpen(false)}>
              {t.ui.done}
            </Button>
          }
        >
          <div className="px-2 pt-1">
            <DateChips
              value={value}
              isAdmin={isAdmin}
              error={error}
              nowIso={nowIso}
              onChange={(next) => {
                onChange(next)
                // Bugun / Kecha — bir bosishda tanlanadi va varaq yopiladi
                if (next.choice !== 'other') setOpen(false)
              }}
            />
          </div>
        </BottomSheet>
      )}
    </>
  )
}
