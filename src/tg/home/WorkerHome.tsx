// Prorab / omborchi bosh ekrani: ikki katta "Kirim" / "Chiqim" plitkasi va bugungi yozuvlar.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, ChevronRight } from 'lucide-react'
import { cx, EntryRow, RetryNotice, SkeletonRows } from '@/components/ui'
import { listMyMovements } from '@/data/movementsRepo'
import type { Movement, Profile } from '@/data/types'
import type { EntryType } from '@/domain/movements'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { useLoad, type Loaded } from '@/lib/useLoad'
import { saveEntryType } from '../movement/prefs'
import { haptic } from '../telegram'
import { SectionTitle } from '../ui'
import { Greeting } from './Greeting'
import { todayOnly } from './usage'

const th = t.tg.home
const TODAY_LIMIT = 20

export function WorkerHome({ profile }: { profile: Profile }) {
  const recent = useLoad(() => listMyMovements(profile.id, TODAY_LIMIT), profile.id)
  return (
    <WorkerHomeView
      name={profile.full_name}
      roleLabel={t.roles[profile.role]}
      today={{ ...recent, data: recent.data ? todayOnly(recent.data) : null }}
      onStart={(type) => {
        haptic.tap()
        // Kirim/chiqim ekrani shu turni tanlangan holda ochiladi (eslab qolingan tur)
        saveEntryType(type)
      }}
    />
  )
}

function ActionTile({ type, onStart }: { type: EntryType; onStart: (type: EntryType) => void }) {
  const kirim = type === 'kirim'
  return (
    <Link
      to="/tg/movement"
      onClick={() => onStart(type)}
      className={cx(
        'flex min-h-24 flex-col justify-between rounded-2xl p-4 text-white transition-[filter] active:brightness-95',
        kirim ? 'bg-ok' : 'bg-brand',
      )}
    >
      <span className="flex items-center justify-between">
        <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-xl bg-white/15">
          {kirim ? <ArrowDownLeft className="size-6" strokeWidth={2} /> : <ArrowUpRight className="size-6" strokeWidth={2} />}
        </span>
        <ChevronRight aria-hidden className="size-5 opacity-70" strokeWidth={2} />
      </span>
      <span className="mt-3 flex flex-col">
        <span className="text-xl leading-tight font-semibold">{t.movements.types[type]}</span>
        <span className="text-sm text-white/80">{kirim ? th.kirimHint : th.chiqimHint}</span>
      </span>
    </Link>
  )
}

/** Bugungi yozuv qatori. */
export function MovementEntry({ m }: { m: Movement }): ReactNode {
  const kind = m.type === 'kirim' || m.type === 'transfer_in' ? 'kirim' : m.type === 'chiqim' || m.type === 'transfer_out' ? 'chiqim' : 'warn'
  return (
    <EntryRow
      as="li"
      kind={kind}
      deleted={Boolean(m.deleted_at)}
      title={m.material_name ?? ''}
      meta={
        <>
          <span>{m.object_name}</span>
          <span className="tabular">{formatDateTime(m.created_at).slice(-5)}</span>
        </>
      }
      qty={{ value: m.qty_input, unit: unitLabel({ unit: m.unit_input, variant: m.unit_variant }) }}
      baseQty={m.base_unit ? { value: m.qty_base, unit: m.base_unit } : undefined}
    />
  )
}

export function WorkerHomeView({
  name,
  roleLabel,
  today,
  onStart,
}: {
  name: string | null
  roleLabel?: string
  today: Loaded<Movement[]>
  onStart: (type: EntryType) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <Greeting name={name} sub={roleLabel} />
      <section aria-label={th.actions} className="grid grid-cols-2 gap-3">
        <ActionTile type="kirim" onStart={onStart} />
        <ActionTile type="chiqim" onStart={onStart} />
      </section>
      <section aria-label={th.today} className="flex flex-col gap-2">
        <SectionTitle>{th.today}</SectionTitle>
        {today.error && <RetryNotice message={today.error} onRetry={today.reload} />}
        {today.loading && <SkeletonRows rows={2} />}
        {today.data && today.data.length === 0 && <p className="text-sm text-muted">{th.todayEmpty}</p>}
        {today.data && today.data.length > 0 && (
          <ul className="flex flex-col gap-2">
            {today.data.map((m) => (
              <MovementEntry key={m.id} m={m} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
