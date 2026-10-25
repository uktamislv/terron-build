import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { ArrowLeftRight, ClipboardList } from 'lucide-react'
import { Notice, PageHeader, SegmentedControl, SkeletonRows } from '@/components/ui'
import { listTransferTargets } from '@/data/transfersRepo'
import { t } from '@/i18n'
import { useEntryData } from '../entry/useEntryData'
import { MyRequests } from '../request/MyRequests'
import { RequestForm } from '../request/RequestForm'
import { TransferForm } from '../request/TransferForm'
import { haptic } from '../telegram'
import { LoadError } from '../ui'

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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={tr.title} />
      <SegmentedControl
        label={tr.tabsLabel}
        value={tab}
        size="lg"
        onChange={(next) => {
          haptic.select()
          setTab(next)
        }}
        options={[
          { value: 'request', label: tr.tabRequest, icon: <ClipboardList aria-hidden strokeWidth={1.75} /> },
          { value: 'transfer', label: tr.tabTransfer, tone: 'transfer', icon: <ArrowLeftRight aria-hidden strokeWidth={1.75} /> },
        ]}
      />

      {error && <LoadError message={error} onRetry={reload} />}
      {!error && (!objects || !materials) && <SkeletonRows rows={3} />}
      {objects && objects.length === 0 && <Notice tone="warn">{t.tg.movement.noObjects}</Notice>}
      {objects && objects.length > 0 && materials && (
        tab === 'request' ? (
          <RequestForm key="request" profile={profile} objects={objects} materials={materials} onSaved={onSaved} />
        ) : (
          targets ? (
            <TransferForm key="transfer" objects={objects} targets={targets} materials={materials} onSaved={onSaved} />
          ) : (
            <SkeletonRows rows={2} />
          )
        )
      )}

      <MyRequests profileId={profile.id} reloadKey={mineKey} />
    </div>
  )
}
