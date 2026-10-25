import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { MovementPhoto } from '@/components/MovementPhoto'
import { StatusBadge } from '@/components/StatusBadge'
import { Button, Modal, Notice, Spinner } from '@/components/ui'
import { listMovements, MOVEMENTS_PAGE_SIZE, restoreMovement, softDeleteMovement } from '@/data/movementsRepo'
import { MOVEMENT_KINDS, type Material, type Movement, type ObjectRow, type Profile } from '@/data/types'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDateTime, formatQty } from '@/lib/format'
import { EMPTY_FILTERS, toRepoFilters, type MovementFilterForm } from './movementFilters'

const to = t.ombor

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base"
      >
        {children}
      </select>
    </div>
  )
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base"
      />
    </div>
  )
}

function qtyInput(m: Movement): string {
  return `${formatQty(m.qty_input)} ${unitLabel({ unit: m.unit_input, variant: m.unit_variant })}`
}

function qtyBase(m: Movement): string {
  return `${formatQty(m.qty_base)} ${m.base_unit ?? ''}`.trim()
}

type Dialog = { kind: 'photo'; movement: Movement } | { kind: 'delete'; movement: Movement } | null

export function MovementsTab({
  objects,
  materials,
  profiles,
  isAdmin,
  canSeeDeleted,
}: {
  objects: ObjectRow[]
  materials: Material[]
  profiles: Profile[]
  isAdmin: boolean
  /** admin va direktor — o'chirilganlarni ko'radi (direktor faqat ko'radi) */
  canSeeDeleted: boolean
}) {
  const [form, setForm] = useState<MovementFilterForm>(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ rows: Movement[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  useEffect(() => {
    let alive = true
    listMovements(toRepoFilters(form, canSeeDeleted), page)
      .then((result) => {
        if (!alive) return
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err))
      })
    return () => {
      alive = false
    }
  }, [form, page, canSeeDeleted, reloadKey])

  const update = (patch: Partial<MovementFilterForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setPage(0)
  }

  /** `leavesPage` — qator joriy ro'yxatdan chiqadi (o'chirildi va o'chirilganlar ko'rsatilmayapti). */
  const run = async (action: () => Promise<void>, opts: { leavesPage?: boolean } = {}) => {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      setDialog(null)
      if (opts.leavesPage && page > 0 && data?.rows.length === 1) setPage((p) => p - 1)
      else reload()
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const total = data?.total ?? 0
  const first = total === 0 ? 0 : page * MOVEMENTS_PAGE_SIZE + 1
  const last = Math.min(total, (page + 1) * MOVEMENTS_PAGE_SIZE)

  const actions = (m: Movement) => (
    <div className="flex flex-wrap gap-2">
      {m.photo_path && (
        <Button variant="ghost" onClick={() => setDialog({ kind: 'photo', movement: m })}>
          {to.showPhoto}
        </Button>
      )}
      {isAdmin &&
        (m.deleted_at ? (
          <Button variant="secondary" disabled={busy} onClick={() => void run(() => restoreMovement(m.id))}>
            {to.restore}
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setDialog({ kind: 'delete', movement: m })}>
            {to.delete}
          </Button>
        ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <form
        aria-label={to.filters}
        onSubmit={(e) => e.preventDefault()}
        className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <SelectField label={to.filterObject} value={form.objectId} onChange={(v) => update({ objectId: v })}>
          <option value="">{to.all}</option>
          {objects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={to.filterMaterial} value={form.materialId} onChange={(v) => update({ materialId: v })}>
          <option value="">{to.all}</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={to.filterType}
          value={form.type}
          onChange={(v) => update({ type: v as MovementFilterForm['type'] })}
        >
          <option value="">{to.all}</option>
          {MOVEMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t.movements.types[k]}
            </option>
          ))}
        </SelectField>
        <SelectField label={to.filterUser} value={form.createdBy} onChange={(v) => update({ createdBy: v })}>
          <option value="">{to.all}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </SelectField>
        <DateField label={to.filterFrom} value={form.from} onChange={(v) => update({ from: v })} />
        <DateField label={to.filterTo} value={form.to} onChange={(v) => update({ to: v })} />
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
          {canSeeDeleted && (
            <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="size-5"
                checked={form.includeDeleted}
                onChange={(e) => update({ includeDeleted: e.target.checked })}
              />
              {to.filterDeleted}
            </label>
          )}
          <Button variant="ghost" onClick={() => update(EMPTY_FILTERS)}>
            {to.reset}
          </Button>
        </div>
      </form>

      {error && (
        <Notice>
          {error}{' '}
          <button type="button" className="ml-1 inline-flex min-h-11 items-center px-1 font-semibold underline" onClick={reload}>
            {t.common.retry}
          </button>
        </Notice>
      )}
      {actionError && <Notice>{actionError}</Notice>}
      {!data && !error && <Spinner />}
      {data && data.rows.length === 0 && <p className="text-slate-600">{to.empty}</p>}

      {data && data.rows.length > 0 && (
        <>
          {/* Keng ekran — jadval */}
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">{to.colDate}</th>
                  <th className="px-3 py-2 font-medium">{to.colType}</th>
                  <th className="px-3 py-2 font-medium">{to.colObject}</th>
                  <th className="px-3 py-2 font-medium">{to.colMaterial}</th>
                  <th className="px-3 py-2 text-right font-medium">{to.colQty}</th>
                  <th className="px-3 py-2 text-right font-medium">{to.colBase}</th>
                  <th className="px-3 py-2 font-medium">{to.colUser}</th>
                  <th className="px-3 py-2 font-medium">{to.colNote}</th>
                  <th className="px-3 py-2 font-medium">{to.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((m) => (
                  <tr
                    key={m.id}
                    data-testid="movement-row"
                    className={`border-t border-slate-100 align-top ${m.deleted_at ? 'text-slate-400' : ''}`}
                  >
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(m.occurred_at)}</td>
                    <td className="px-3 py-2">
                      {t.movements.types[m.type]}
                      {m.deleted_at && (
                        <span className="ml-1">
                          <StatusBadge tone="danger">{t.movements.deleted}</StatusBadge>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{m.object_name}</td>
                    <td className="px-3 py-2">{m.material_name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{qtyInput(m)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{qtyBase(m)}</td>
                    <td className="px-3 py-2">{m.created_by_name}</td>
                    <td className="max-w-48 px-3 py-2 text-slate-600">{m.note}</td>
                    <td className="px-3 py-2">{actions(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Telefon — kartalar */}
          <ul className="flex flex-col gap-3 md:hidden" aria-label={to.tabMovements}>
            {data.rows.map((m) => (
              <li
                key={m.id}
                className={`flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 ${
                  m.deleted_at ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">{m.material_name}</p>
                    <p className="text-sm text-slate-600">
                      {t.movements.types[m.type]} · {m.object_name}
                    </p>
                  </div>
                  {m.deleted_at && <StatusBadge tone="danger">{t.movements.deleted}</StatusBadge>}
                </div>
                <p className="text-sm text-slate-800">
                  {qtyInput(m)} <span className="text-slate-500">· {qtyBase(m)}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(m.occurred_at)} · {m.created_by_name}
                </p>
                {m.note && <p className="text-sm text-slate-600">{m.note}</p>}
                {actions(m)}
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-600">{to.pageInfo(first, last, total)}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                {to.prev}
              </Button>
              <Button variant="secondary" disabled={last >= total} onClick={() => setPage((p) => p + 1)}>
                {to.next}
              </Button>
            </div>
          </div>
        </>
      )}

      {dialog?.kind === 'photo' && dialog.movement.photo_path && (
        <Modal title={t.movements.photo} onClose={closeDialog}>
          <MovementPhoto path={dialog.movement.photo_path} alt={t.movements.photo} />
        </Modal>
      )}
      {dialog?.kind === 'delete' && (
        <Modal title={to.delete} onClose={closeDialog}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-700">{to.deleteConfirm}</p>
            {actionError && <Notice>{actionError}</Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeDialog}>
                {t.common.no}
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void run(() => softDeleteMovement(dialog.movement.id), { leavesPage: !form.includeDeleted })
                }
              >
                {t.common.yes}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
