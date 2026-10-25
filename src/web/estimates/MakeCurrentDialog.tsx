import { useEffect, useState } from 'react'
import { Button, Modal, Notice, Spinner } from '@/components/ui'
import { listEstimateItems } from '@/data/estimatesRepo'
import type { Estimate } from '@/data/types'
import { diffEstimates, type DiffResult } from '@/domain/estimate'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { DiffView } from './DiffView'
import { estimateItemsToDiff } from './wizardModel'

const te = t.estimates

/** "Joriy qilish" tasdig'i: joriy versiya bilan farq va direktorga xabar ogohlantirishi. */
export function MakeCurrentDialog({
  target,
  current,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  target: Estimate
  current: Estimate | undefined
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([current ? listEstimateItems(current.id) : Promise.resolve([]), listEstimateItems(target.id)])
      .then(([before, after]) => {
        if (alive) setDiff(diffEstimates(estimateItemsToDiff(before), estimateItemsToDiff(after)))
      })
      .catch((err: unknown) => alive && setLoadError(errorText(err)))
    return () => {
      alive = false
    }
  }, [target.id, current])

  return (
    <Modal title={te.makeCurrentTitle(te.version(target.version))} onClose={onCancel} size="lg">
      <div className="flex flex-col gap-4">
        <Notice tone="warn">{te.makeCurrentWarn}</Notice>
        {!current && <p className="text-sm text-slate-600">{te.makeCurrentNoCurrent}</p>}
        {current && (
          <p className="text-sm text-slate-700">
            {te.diff.title}: {te.version(current.version)} → {te.version(target.version)}
          </p>
        )}
        {loadError && <Notice>{loadError}</Notice>}
        {!diff && !loadError && <Spinner />}
        {diff && <DiffView diff={diff} />}
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel}>
            {t.common.cancel}
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            {te.makeCurrentConfirm}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
