import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { StatusBadge } from '@/components/StatusBadge'
import { Button, Notice, Spinner } from '@/components/ui'
import { listObjectMembers } from '@/data/objectMembersRepo'
import { listObjects } from '@/data/objectsRepo'
import { listProfiles, setProfileActive } from '@/data/profilesRepo'
import type { LoginKind, ObjectMember, ObjectRow, Profile } from '@/data/types'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatPhoneDisplay } from '@shared/phone'
import { SetLoginDialog } from '../users/SetLoginDialog'
import { UserFormDialog } from '../users/UserFormDialog'

const loginKindLabel: Record<LoginKind, string> = {
  web: t.users.hasLogin,
  tg: t.users.tgOnly,
  none: t.users.noLogin,
}

interface Data {
  profiles: Profile[]
  objects: ObjectRow[]
  members: ObjectMember[]
}

type Dialog = { kind: 'create' } | { kind: 'edit'; profile: Profile } | { kind: 'login'; profile: Profile } | null

export function UsersPage() {
  const { profile: me } = useAuth()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  useEffect(() => {
    let active = true
    Promise.all([listProfiles(), listObjects(), listObjectMembers()])
      .then(([profiles, objects, members]) => {
        if (!active) return
        setData({ profiles, objects, members })
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
  const canManage = can(me.role, 'manage_users')

  async function toggleActive(p: Profile) {
    setBusyId(p.id)
    setActionError(null)
    try {
      await setProfileActive(p.id, !p.is_active)
      reload()
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusyId(null)
    }
  }

  const objectName = new Map((data?.objects ?? []).map((o) => [o.id, o.name]))
  const objectsOf = (profileId: string) =>
    (data?.members ?? [])
      .filter((m) => m.profile_id === profileId)
      .map((m) => objectName.get(m.object_id))
      .filter((name): name is string => Boolean(name))

  // Admin super_admin profiliga tega olmaydi; o'zini nofaol qilmaydi
  const editable = (p: Profile) => canManage && (p.role !== 'super_admin' || me.role === 'super_admin')
  // Admin boshqa admin/super_admin login-parolini o'zgartira olmaydi (server 403); o'zi — mumkin
  const canSetLogin = (p: Profile) =>
    p.id === me.id || me.role === 'super_admin' || (p.role !== 'admin' && p.role !== 'super_admin')

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-brand-dark">{t.users.title}</h1>
        {canManage && <Button onClick={() => setDialog({ kind: 'create' })}>{t.users.add}</Button>}
      </div>

      {error && (
        <Notice>
          {error}{' '}
          <button type="button" className="font-semibold underline" onClick={reload}>
            {t.common.retry}
          </button>
        </Notice>
      )}
      {actionError && <Notice>{actionError}</Notice>}
      {!data && !error && <Spinner />}
      {data && data.profiles.length === 0 && <p className="text-slate-600">{t.users.empty}</p>}

      {data && data.profiles.length > 0 && (
        <ul className="grid gap-3 xl:grid-cols-2" aria-label={t.users.title}>
          {data.profiles.map((p) => {
            const objs = objectsOf(p.id)
            const isMe = p.id === me.id
            return (
              <li key={p.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      <span>{p.full_name}</span>
                      {isMe && <span className="ml-1 text-sm font-normal text-slate-500">({t.users.you})</span>}
                    </p>
                    <p className="text-sm text-slate-600">{formatPhoneDisplay(p.phone)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="inline-flex rounded-full bg-brand-light px-2.5 py-1 text-xs font-medium text-brand-dark">
                      {t.roles[p.role]}
                    </span>
                    <StatusBadge tone={p.is_active ? 'ok' : 'danger'}>
                      {p.is_active ? t.status.active : t.status.inactive}
                    </StatusBadge>
                  </div>
                </div>

                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-slate-500">{t.users.colObjects}</dt>
                  <dd>{objs.length > 0 ? objs.join(', ') : '—'}</dd>
                  <dt className="text-slate-500">{t.users.colWeb}</dt>
                  <dd>{loginKindLabel[p.login_kind]}</dd>
                  <dt className="text-slate-500">{t.users.colTelegram}</dt>
                  <dd>{p.telegram_user_id ? t.users.linked : t.users.notLinked}</dd>
                </dl>

                {editable(p) && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'edit', profile: p })}>
                      {t.common.edit}
                    </Button>
                    {canSetLogin(p) && (
                      <Button variant="secondary" onClick={() => setDialog({ kind: 'login', profile: p })}>
                        {p.login_kind === 'web' ? t.users.resetPassword : t.users.setLogin}
                      </Button>
                    )}
                    {!isMe && (
                      <Button
                        variant={p.is_active ? 'danger' : 'secondary'}
                        disabled={busyId === p.id}
                        onClick={() => void toggleActive(p)}
                      >
                        {p.is_active ? t.users.deactivate : t.users.activate}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {data && (dialog?.kind === 'create' || dialog?.kind === 'edit') && (
        <UserFormDialog
          actorRole={me.role}
          companyId={me.company_id}
          profile={dialog.kind === 'edit' ? dialog.profile : undefined}
          objects={data.objects}
          members={data.members}
          isMe={dialog.kind === 'edit' && dialog.profile.id === me.id}
          onClose={() => {
            // Qisman saqlangan (profil yaratilgan) bo'lishi mumkin — ro'yxatni yangilaymiz
            closeDialog()
            reload()
          }}
          onSaved={() => {
            closeDialog()
            reload()
          }}
        />
      )}
      {dialog?.kind === 'login' && <SetLoginDialog profile={dialog.profile} onClose={closeDialog} onSaved={reload} />}
    </div>
  )
}
