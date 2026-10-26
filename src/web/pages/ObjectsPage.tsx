import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/authContext'
import { Building2, CalendarDays, LocateFixed, MapPin, Pencil, Plus, UserPlus, Users } from 'lucide-react'
import { Badge, Button, choiceClass, EmptyState, inputClass, Modal, Notice, PageHeader, RetryNotice, SkeletonRows, TextField } from '@/components/ui'
import { addObjectMember, listObjectMembers, removeObjectMember } from '@/data/objectMembersRepo'
import { createObject, listObjects, updateObject } from '@/data/objectsRepo'
import { listProfiles } from '@/data/profilesRepo'
import { OBJECT_STATUSES, type ObjectMember, type ObjectRow, type ObjectStatus, type Profile } from '@/data/types'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDate } from '@/lib/format'
import { DEFAULT_RADIUS_M, parseGeoForm, splitCoordPair, type GeoFormErrors } from '../objects/objectGeo'

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
  const [lat, setLat] = useState(object?.lat ?? '')
  const [lng, setLng] = useState(object?.lng ?? '')
  const [radius, setRadius] = useState(String(object?.radius_m ?? DEFAULT_RADIUS_M))
  const [geoErrors, setGeoErrors] = useState<GeoFormErrors>({})
  const [nameError, setNameError] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const geo = parseGeoForm(lat, lng, radius)
    setGeoErrors(geo.ok ? {} : geo.errors)
    if (!name.trim()) {
      setNameError(true)
      return
    }
    setNameError(false)
    if (!geo.ok) return
    const geoPatch = { lat: geo.value.lat, lng: geo.value.lng, radiusM: geo.value.radiusM }
    setSaving(true)
    setSaveError(null)
    try {
      if (object) await updateObject(object.id, { name, address, status, ...geoPatch })
      else await createObject({ companyId, name, address, status, ...geoPatch })
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
          <legend className="mb-1.5 text-sm font-medium text-muted">{t.objectGeo.title}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField
              label={t.objectGeo.lat}
              value={lat}
              inputMode="decimal"
              autoComplete="off"
              error={geoErrors.lat ? t.objectGeo.errLat : geoErrors.pair ? t.objectGeo.errPair : null}
              onChange={(e) => {
                // Xaritadan juftlik qo'yilsa — ikkala maydon to'ladi
                const pair = splitCoordPair(e.target.value)
                if (pair) {
                  setLat(pair.lat)
                  setLng(pair.lng)
                } else setLat(e.target.value)
                setGeoErrors({})
              }}
            />
            <TextField
              label={t.objectGeo.lng}
              value={lng}
              inputMode="decimal"
              autoComplete="off"
              error={geoErrors.lng ? t.objectGeo.errLng : null}
              onChange={(e) => {
                setLng(e.target.value)
                setGeoErrors({})
              }}
            />
            <TextField
              label={t.objectGeo.radius}
              value={radius}
              inputMode="numeric"
              autoComplete="off"
              error={geoErrors.radius ? t.objectGeo.errRadius : null}
              onChange={(e) => {
                setRadius(e.target.value)
                setGeoErrors({})
              }}
            />
          </div>
          <p className="text-xs text-muted">{t.objectGeo.hint}</p>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-muted">{t.objects.status}</legend>
          <div className="grid grid-cols-3 gap-2">
            {OBJECT_STATUSES.map((s) => (
              <label
                key={s}
                className={choiceClass({ selected: status === s, shape: 'box', label: true })}
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
          <p className="text-sm text-muted">{t.objects.noMembers}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((m) => {
              const p = profileById.get(m.profile_id)
              return (
                <li key={m.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-1">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{p?.full_name ?? '—'}</span>
                    {p && <span className="text-muted"> · {t.roles[p.role]}</span>}
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
              <label htmlFor={selectId} className="text-sm font-medium text-muted">
                {t.objects.selectUser}
              </label>
              <select
                id={selectId}
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className={inputClass()}
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
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.objects.title}
        icon={<Building2 strokeWidth={1.75} />}
        actions={
          canManage && (
            <Button icon={<Plus aria-hidden className="size-5" strokeWidth={1.75} />} onClick={() => setDialog({ kind: 'create' })}>
              {t.objects.add}
            </Button>
          )
        }
      />

      {error && <RetryNotice message={error} onRetry={reload} />}
      {!data && !error && <SkeletonRows rows={3} />}
      {data && data.objects.length === 0 && <EmptyState icon={<Building2 strokeWidth={1.5} />} title={t.objects.empty} />}

      {data && data.objects.length > 0 && (
        <ul className="grid gap-3 lg:grid-cols-2" aria-label={t.objects.title}>
          {data.objects.map((o) => {
            const count = data.members.filter((m) => m.object_id === o.id).length
            return (
              <li key={o.id} className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-4">
                <div className="flex items-start gap-3">
                  <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-ice text-brand">
                    <Building2 className="size-5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{o.name}</p>
                    <p className="flex items-center gap-1 text-sm text-muted">
                      <MapPin aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
                      {o.address || '—'}
                    </p>
                  </div>
                  <Badge tone={statusTone[o.status]}>{t.objects.statuses[o.status]}</Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Users aria-hidden className="size-4" strokeWidth={1.75} />
                    {t.objects.members}: <span className="tabular font-semibold text-ink">{count}</span>
                  </span>
                  <span data-testid="object-geo" className="inline-flex items-center gap-1.5">
                    <LocateFixed aria-hidden className="size-4" strokeWidth={1.75} />
                    {o.lat && o.lng ? t.objectGeo.set(String(o.radius_m ?? DEFAULT_RADIUS_M)) : t.objectGeo.notSet}
                  </span>
                  <span className="tabular inline-flex items-center gap-1.5">
                    <CalendarDays aria-hidden className="size-4" strokeWidth={1.75} />
                    {formatDate(o.created_at)}
                  </span>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                    <Button
                      variant="secondary"
                      icon={<Pencil aria-hidden className="size-4" strokeWidth={1.75} />}
                      onClick={() => setDialog({ kind: 'edit', object: o })}
                    >
                      {t.common.edit}
                    </Button>
                    <Button
                      variant="secondary"
                      icon={<UserPlus aria-hidden className="size-4" strokeWidth={1.75} />}
                      onClick={() => setDialog({ kind: 'members', objectId: o.id })}
                    >
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
