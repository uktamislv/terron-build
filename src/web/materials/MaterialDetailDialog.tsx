import { useState } from 'react'
import { Pencil, Power, Trash2 } from 'lucide-react'
import { Badge, Button, Modal, Notice } from '@/components/ui'
import { errorCodeOf, type RepoErrorCode } from '@/data/errors'
import { softDeleteMaterial, updateMaterial } from '@/data/materialsRepo'
import type { Material } from '@/data/types'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatQty } from '@/lib/format'
import { AliasesSection } from './AliasesSection'
import { UnitCalculator } from './UnitCalculator'
import { UnitsSection } from './UnitsSection'

const tm = t.materials

/** Material kartasi: asosiy ma'lumot, birliklar, muqobil nomlar, kalkulyator. */
export function MaterialDetailDialog({
  material,
  materials,
  canManage,
  onClose,
  onEdit,
  onChanged,
  onDeleted,
}: {
  material: Material
  materials: readonly Material[]
  canManage: boolean
  onClose: () => void
  onEdit: () => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; code: RepoErrorCode } | null>(null)

  async function run(action: () => Promise<unknown>, after: () => void) {
    setBusy(true)
    setError(null)
    try {
      await action()
      after()
    } catch (err) {
      setError({ text: errorText(err), code: errorCodeOf(err) })
      setConfirmDelete(false)
    } finally {
      setBusy(false)
    }
  }

  const deactivate = () => void run(() => updateMaterial(material.id, { isActive: false }), onChanged)

  return (
    <Modal title={material.name} onClose={onClose} size="lg">
      <div className="flex flex-col gap-5">
        {error && (
          <Notice>
            <span className="block">{error.text}</span>
            {/* Qoldig'i bor material o'chirilmaydi — o'rniga nofaol qilishni taklif qilamiz */}
            {error.code === 'catalog_material_has_stock' && canManage && material.is_active && (
              <Button variant="danger" className="mt-2" disabled={busy} onClick={deactivate}>
                {tm.makeInactive}
              </Button>
            )}
          </Notice>
        )}
        <section className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div className="rounded-xl border border-line bg-canvas px-3 py-2">
              <dt className="text-xs text-muted">{tm.category}</dt>
              <dd className="font-medium text-ink">{material.category ?? tm.noCategory}</dd>
            </div>
            <div className="rounded-xl border border-line bg-canvas px-3 py-2">
              <dt className="text-xs text-muted">{tm.baseUnit}</dt>
              <dd className="font-medium text-ink">{material.base_unit}</dd>
            </div>
            <div className="rounded-xl border border-line bg-canvas px-3 py-2">
              <dt className="text-xs text-muted">{tm.wastePct}</dt>
              <dd className="tabular font-semibold text-ink">{formatQty(material.waste_pct, 2)}</dd>
            </div>
            <div className="rounded-xl border border-line bg-canvas px-3 py-2">
              <dt className="text-xs text-muted">{tm.statusFilter}</dt>
              <dd>
                <Badge tone={material.is_active ? 'ok' : 'warn'}>
                  {material.is_active ? tm.active : tm.inactive}
                </Badge>
              </dd>
            </div>
          </dl>
          {canManage &&
            (confirmDelete ? (
              <div className="flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger-bg p-3 sm:flex-row sm:items-center">
                <p className="flex-1 text-sm text-danger">{tm.deleteConfirm}</p>
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void run(() => softDeleteMaterial(material.id), onDeleted)}
                  >
                    {t.common.yes}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                    {t.common.no}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={<Pencil aria-hidden className="size-4" strokeWidth={1.75} />} onClick={onEdit}>
                  {t.common.edit}
                </Button>
                <Button
                  variant="secondary"
                  icon={<Power aria-hidden className="size-4" strokeWidth={1.75} />}
                  disabled={busy}
                  onClick={() => void run(() => updateMaterial(material.id, { isActive: !material.is_active }), onChanged)}
                >
                  {material.is_active ? tm.makeInactive : tm.makeActive}
                </Button>
                <Button variant="danger" icon={<Trash2 aria-hidden className="size-4" strokeWidth={1.75} />} onClick={() => setConfirmDelete(true)}>
                  {tm.delete}
                </Button>
              </div>
            ))}
        </section>
        <UnitsSection material={material} canManage={canManage} onChanged={onChanged} />
        <UnitCalculator material={material} />
        <AliasesSection material={material} materials={materials} canManage={canManage} onChanged={onChanged} />
      </div>
    </Modal>
  )
}
