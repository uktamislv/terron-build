import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { MovementPhoto } from '@/components/MovementPhoto'
import { StatusBadge } from '@/components/StatusBadge'
import { Notice, Spinner } from '@/components/ui'
import { listMyMovements } from '@/data/movementsRepo'
import type { Movement } from '@/data/types'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDateTime, formatQty } from '@/lib/format'
import { haptic } from '../telegram'
import { useBackButton } from '../useTelegramButtons'

const tm = t.tg.mine
const MINE_LIMIT = 50

function inputQty(m: Movement): string {
  return `${formatQty(m.qty_input)} ${unitLabel({ unit: m.unit_input, variant: m.unit_variant })}`
}

function baseQty(m: Movement): string {
  return `${formatQty(m.qty_base)} ${m.base_unit ?? ''}`.trim()
}

/** Kirim — yashil "+", chiqim — "−", boshqalari — "↔". */
function typeMark(m: Movement): { sign: string; tone: string } {
  if (m.type === 'kirim' || m.type === 'transfer_in') return { sign: '+', tone: 'bg-ok/10 text-ok' }
  if (m.type === 'chiqim' || m.type === 'transfer_out') return { sign: '−', tone: 'bg-brand-light text-brand' }
  return { sign: '±', tone: 'bg-warn/10 text-warn' }
}

export function MinePage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Movement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const profileId = profile?.id

  useEffect(() => {
    if (!profileId) return
    let alive = true
    listMyMovements(profileId, MINE_LIMIT)
      .then((list) => {
        if (!alive) return
        setRows(list)
        setError(null)
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err))
      })
    return () => {
      alive = false
    }
  }, [profileId, reloadKey])

  const close = useCallback(() => setOpenId(null), [])
  const open = rows?.find((r) => r.id === openId) ?? null
  useBackButton(open ? close : null)

  if (!profile) return null

  if (open) {
    const mark = typeMark(open)
    return (
      <article className="flex flex-col gap-4" aria-label={tm.detail}>
        <button type="button" onClick={close} className="min-h-11 self-start text-sm font-medium text-brand">
          ← {t.common.back}
        </button>
        <div className="flex items-center gap-3">
          <span className={`inline-flex size-11 items-center justify-center rounded-full text-xl font-bold ${mark.tone}`}>
            {mark.sign}
          </span>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{t.movements.types[open.type]}</h1>
            {open.deleted_at && <StatusBadge tone="danger">{t.movements.deleted}</StatusBadge>}
          </div>
        </div>
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">{tm.material}</dt>
          <dd className="font-medium text-slate-900">{open.material_name}</dd>
          <dt className="text-slate-500">{tm.qty}</dt>
          <dd className="font-medium text-slate-900">
            {inputQty(open)} <span className="text-slate-500">(= {baseQty(open)})</span>
          </dd>
          <dt className="text-slate-500">{tm.object}</dt>
          <dd className="text-slate-900">{open.object_name}</dd>
          <dt className="text-slate-500">{tm.time}</dt>
          <dd className="text-slate-900">{formatDateTime(open.occurred_at)}</dd>
          {open.note && (
            <>
              <dt className="text-slate-500">{t.movements.note}</dt>
              <dd className="whitespace-pre-wrap text-slate-900">{open.note}</dd>
            </>
          )}
        </dl>
        {open.photo_path ? (
          <MovementPhoto path={open.photo_path} alt={t.movements.photo} />
        ) : (
          <p className="text-sm text-slate-500">{t.movements.noPhoto}</p>
        )}
      </article>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-brand-dark">{tm.title}</h1>
      {error && (
        <Notice>
          {error}{' '}
          <button type="button" className="ml-1 inline-flex min-h-11 items-center px-1 font-semibold underline" onClick={() => setReloadKey((k) => k + 1)}>
            {t.common.retry}
          </button>
        </Notice>
      )}
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && <p className="text-slate-600">{tm.empty}</p>}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={tm.title}>
          {rows.map((m) => {
            const mark = typeMark(m)
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    haptic.tap()
                    setOpenId(m.id)
                  }}
                  className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border border-slate-200 p-3 text-left ${
                    m.deleted_at ? 'opacity-60' : ''
                  }`}
                >
                  <span
                    aria-label={t.movements.types[m.type]}
                    className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-bold ${mark.tone}`}
                  >
                    {mark.sign}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-900">{m.material_name}</span>
                    <span className="block text-sm text-slate-700">
                      {inputQty(m)} <span className="text-slate-500">· {baseQty(m)}</span>
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {m.object_name} · {formatDateTime(m.occurred_at)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {m.photo_path && <span aria-label={t.movements.hasPhoto}>📷</span>}
                    {m.deleted_at && <StatusBadge tone="danger">{t.movements.deleted}</StatusBadge>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
