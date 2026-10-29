import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { useAuth } from '@/auth/authContext'
import { ArrowLeftRight, ClipboardList } from 'lucide-react'
import { Notice, RetryNotice, SegmentedControl, SkeletonRows } from '@/components/ui'
import { listTransferTargets } from '@/data/transfersRepo'
import { t } from '@/i18n'
import { useEntryData } from '../entry/useEntryData'
import { useRankedMaterialsWithPins } from '../entry/useRankedMaterials'
import { readPrefill } from '../request/prefill'
import { MyRequests } from '../request/MyRequests'
import { RequestForm } from '../request/RequestForm'
import { TransferForm } from '../request/TransferForm'
import { haptic } from '../telegram'
import { useDiscardGuard } from '../entry/useDiscardGuard'

const tr = t.tg.request
type Tab = 'request' | 'transfer'

/** Mini App: so'rov (smeta holati bilan) va obyektlar orasida o'tkazma. Pastda — mening so'rovlarim. */
export function RequestPage() {
  const { profile } = useAuth()
  const { objects, materials: catalog, error, reload } = useEntryData(profile?.company_id)
  // Batch 12 (L): materiallar foydalanish bo'yicha (kirim/chiqim ekranidagidek)
  const { ranked: materials, pinned } = useRankedMaterialsWithPins(catalog)
  // Batch 12 (K): bosh ekrandagi "Tugayotganlar" dan to'ldirish
  const location = useLocation()
  const prefill = readPrefill(location.state)
  const [tab, setTab] = useState<Tab>('request')
  const [mineKey, setMineKey] = useState(0)
  const onSaved = useCallback(() => setMineKey((k) => k + 1), [])
  // To'ldirilgan forma — bo'lim almashtirish va boshqa bo'limga o'tishdan oldin tasdiq
  const [formDirty, setFormDirty] = useState(false)
  const discard = useDiscardGuard(formDirty)
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
      <SegmentedControl
        label={tr.tabsLabel}
        value={tab}
        size="lg"
        onChange={(next) => {
          haptic.select()
          discard.guard(() => setTab(next))
        }}
        options={[
          { value: 'request', label: tr.tabRequest, icon: <ClipboardList aria-hidden strokeWidth={1.75} /> },
          { value: 'transfer', label: tr.tabTransfer, tone: 'transfer', icon: <ArrowLeftRight aria-hidden strokeWidth={1.75} /> },
        ]}
      />

      {error && <RetryNotice message={error} onRetry={reload} />}
      {!error && (!objects || !materials) && <SkeletonRows rows={3} />}
      {objects && objects.length === 0 && <Notice tone="warn">{t.tg.movement.noObjects}</Notice>}
      {objects && objects.length > 0 && materials && (
        tab === 'request' ? (
          <RequestForm
            key="request"
            profile={profile}
            objects={objects}
            materials={materials}
            pinnedIds={pinned}
            prefill={prefill}
            onSaved={onSaved}
            onDirtyChange={setFormDirty}
          />
        ) : (
          targets ? (
            <TransferForm
              key="transfer"
              profileId={profile.id}
              objects={objects}
              targets={targets}
              materials={materials}
              pinnedIds={pinned}
              onSaved={onSaved}
              onDirtyChange={setFormDirty}
            />
          ) : (
            <SkeletonRows rows={2} />
          )
        )
      )}

      <MyRequests profileId={profile.id} reloadKey={mineKey} />
      {discard.element}
    </div>
  )
}
