import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/authContext'
import { StatusBadge } from '@/components/StatusBadge'
import { Button, Modal, Notice, Spinner, TextField } from '@/components/ui'
import { addObjectMember, listObjectMembers, removeObjectMember } from '@/data/objectMembersRepo'
import { createObject, listObjects, updateObject } from '@/data/objectsRepo'
import { listProfiles } from '@/data/profilesRepo'
import { OBJECT_STATUSES, type ObjectMember, type ObjectRow, type ObjectStatus, type Profile } from '@/data/types'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDate } from '@/lib/format'

interface Data {
  objects: ObjectRow[]
  members: ObjectMember[]
  profiles: Profile[]
}

type Dialog = { kind: 'create' } | { kind: 'edit'; object: ObjectRow } | { kind: 'members'; objectId: string } | null

const statusTone: Record<ObjectStatus, 'ok' | 'warn' | 'danger'> = {
  faol: 'ok',
  yakunlangan: 'warn',
  toxtatilgan: 'danger',
}

function ObjectFormDialog({
  companyId,
  object,
  onClose,
  onSaved,
}: {
  companyId: string
  object?: ObjectRow
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(object?.name ?? '')
  const [address, setAddress] = useState(object?.address ?? '')
  const [status, setStatus] = useState<ObjectStatus>(object?.status ?? 'faol')
  const [nameError, setNameError] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setNameError(true)
      return
    }
    setNameError(false)
    setSaving(true)
    setSaveError(null)
    try {
      if (object) await updateObject(object.id, { name, address, status })
      else await createObject({ companyId, name, address, status })
      onSaved()
    } catch (err) {
      setSaveError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={object ? t.objects.editTitle : t.objects.addTitle} onClose={onClose}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {saveError && <Notice>{saveError}</Notice>}
        <TextField
          label={t.objects.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError ? t.objects.errName : null}
        />
        <TextField label={t.objects.address} value={address} onChange={(e) => setAddress(e.target.value)} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-slate-700">{t.objects.status}</legend>
          <div className="grid grid-cols-3 gap-2">
            {OBJECT_STATUSES.map((s) => (
              <label
                key={s}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-2 text-center text-sm font-medium ${
                  status === s ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-800'
                }`}
              >
                <input
                  type="radio"
                  name="status"
                  className="sr-only"
                  checked={status === s}
                  onChange={() => setStatus(s)}
                />
                {t.objects.statuses[s]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t.common.saving : t.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function MembersDialog({
  companyId,
  object,
  data,
  onClose,
  onChanged,
}: {
  companyId: string
  object: ObjectRow
  data: Data
  onClose: () => void
  onChanged: () => void
}) {
  const selectId = useId()
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const profileById = new Map(data.profiles.map((p) => [p.id, p]))
  const members = data.members.filter((m) => m.object_id === object.id)
  const memberIds = new Set(members.map((m) => m.profile_id))
  const candidates = data.profiles.filter((p) => !memberIds.has(p.id) && p.role !== 'super_admin')

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setSelected('')
      onChanged()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`${t.objects.membersTitle} — ${object.name}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {error && <Notice>{error}</Notice>}
        {members.length === 0 ? (
          <p className="text-sm text-slate-600">{t.objects.noMembers}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((m) => {
              const p = profileById.get(m.profile_id)
              return (
                <li key={m.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-1">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{p?.full_name ?? '—'}</span>
                    {p && <span className="text-slate-500"> · {t.roles[p.role]}</span>}
                  </span>
                  <Button variant="ghost" disabled={busy} onClick={() => void run(() => removeObjectMember(m.id))}>
                    {t.objects.removeMember}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        {candidates.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor={selectId} className="text-sm font-medium text-slate-700">
                {t.objects.selectUser}
              </label>
              <select
                id={selectId}
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base"
              >
                <option value="">—</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} · {t.roles[p.role]}
                  </option>
                ))}
              </select>
            </div>
            <Button
              disabled={busy || !selected}
              onClick={() => void run(() => addObjectMember(companyId, object.id, selected))}
            >
              {t.objects.addMember}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

export function ObjectsPage() {
  const { profile: me } = useAuth()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  useEffect(() => {
    let active = true
    Promise.all([listObjects(), listObjectMembers(), listProfiles()])
      .then(([objects, members, profiles]) => {
        if (!active) return
        setData({ objects, members, profiles })
        setError(null)
      })
      .catch((err: unknown) => {
        if (active) setError(errorText(err))
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  if (!me) return null
  const canManage = can(me.role, 'manage_objects')
  const membersObject = dialog?.kind === 'members' ? data?.objects.find((o) => o.id === dialog.objectId) : undefined

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-brand-dark">{t.objects.title}</h1>
        {canManage && <Button onClick={() => setDialog({ kind: 'create' })}>{t.objects.add}</Button>}
      </div>

      {error && (
        <Notice>
          {error}{' '}
          <button type="button" className="font-semibold underline" onClick={reload}>
            {t.common.retry}
          </button>
        </Notice>
      )}
      {!data && !error && <Spinner />}
      {data && data.objects.length === 0 && <p className="text-slate-600">{t.objects.empty}</p>}

      {data && data.objects.length > 0 && (
        <ul className="grid gap-3 lg:grid-cols-2" aria-label={t.objects.title}>
          {data.objects.map((o) => {
            const count = data.members.filter((m) => m.object_id === o.id).length
            return (
              <li key={o.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{o.name}</p>
                    <p className="text-sm text-slate-600">{o.address || '—'}</p>
                  </div>
                  <StatusBadge tone={statusTone[o.status]}>{t.objects.statuses[o.status]}</StatusBadge>
                </div>
                <p className="text-sm text-slate-500">
                  {t.objects.members}: {count} · {formatDate(o.created_at)}
                </p>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'edit', object: o })}>
                      {t.common.edit}
                    </Button>
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'members', objectId: o.id })}>
                      {t.objects.members}
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {(dialog?.kind === 'create' || dialog?.kind === 'edit') && (
        <ObjectFormDialog
          companyId={me.company_id}
          object={dialog.kind === 'edit' ? dialog.object : undefined}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog()
            reload()
          }}
        />
      )}
      {data && membersObject && (
        <MembersDialog
          companyId={me.company_id}
          object={membersObject}
          data={data}
          onClose={closeDialog}
          onChanged={reload}
        />
      )}
    </div>
  )
}
