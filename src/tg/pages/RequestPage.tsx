import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { Notice, Spinner } from '@/components/ui'
import { listTransferTargets } from '@/data/transfersRepo'
import { t } from '@/i18n'
import { useEntryData } from '../entry/useEntryData'
import { MyRequests } from '../request/MyRequests'
import { RequestForm } from '../request/RequestForm'
import { TransferForm } from '../request/TransferForm'
import { haptic } from '../telegram'

const tr = t.tg.request
type Tab = 'request' | 'transfer'

/** Mini App: so'rov (smeta holati bilan) va obyektlar orasida o'tkazma. Pastda — mening so'rovlarim. */
export function RequestPage() {
  const { profile } = useAuth()
  const { objects, materials, error, reload } = useEntryData(profile?.company_id)
  const [tab, setTab] = useState<Tab>('request')
  const [mineKey, setMineKey] = useState(0)
  const onSaved = useCallback(() => setMineKey((k) => k + 1), [])
  // "Qayerga" — firmaning faol obyektlari (prorab boshqa obyektlarni RLS orqali ko'rmaydi)
  const [targets, setTargets] = useState<{ id: string; name: string }[] | null>(null)
  const needTargets = tab === 'transfer' && targets === null
  useEffect(() => {
    if (!needTargets) return
    let alive = true
    listTransferTargets()
      .then((list) => alive && setTargets(list))
      .catch(() => alive && setTargets([]))
    return () => {
      alive = false
    }
  }, [needTargets])

  if (!profile) return null
  const tabs: { key: Tab; label: string }[] = [
    { key: 'request', label: tr.tabRequest },
    { key: 'transfer', label: tr.tabTransfer },
  ]

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-brand-dark">{tr.title}</h1>
      <div role="group" aria-label={tr.tabsLabel} className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
        {tabs.map((x) => (
          <button
            key={x.key}
            type="button"
            aria-pressed={tab === x.key}
            onClick={() => {
              haptic.select()
              setTab(x.key)
            }}
            className={`min-h-12 rounded-xl text-base font-semibold ${tab === x.key ? 'bg-brand text-white' : 'text-slate-600'}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {error && (
        <Notice>
          {error}
          <button type="button" className="ml-1 inline-flex min-h-11 items-center px-1 font-semibold underline" onClick={reload}>
            {t.common.retry}
          </button>
        </Notice>
      )}
      {!error && (!objects || !materials) && <Spinner />}
      {objects && objects.length === 0 && <Notice tone="warn">{t.tg.movement.noObjects}</Notice>}
      {objects && objects.length > 0 && materials && (
        tab === 'request' ? (
          <RequestForm key="request" profile={profile} objects={objects} materials={materials} onSaved={onSaved} />
        ) : (
          targets ? (
            <TransferForm key="transfer" objects={objects} targets={targets} materials={materials} onSaved={onSaved} />
          ) : (
            <Spinner />
          )
        )
      )}

      <MyRequests profileId={profile.id} reloadKey={mineKey} />
    </div>
  )
}
