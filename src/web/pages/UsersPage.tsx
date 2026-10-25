import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/auth/authContext'
import { Building2, Globe, KeyRound, Pencil, Power, Send, UserPlus, Users } from 'lucide-react'
import { Badge, Button, EmptyState, Notice, PageHeader, RetryNotice, SkeletonRows } from '@/components/ui'
import { listObjectMembers } from '@/data/objectMembersRepo'
import { listObjects } from '@/data/objectsRepo'
import { listProfiles, setProfileActive } from '@/data/profilesRepo'
import type { LoginKind, ObjectMember, ObjectRow, Profile } from '@/data/types'
import { can } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatPhoneDisplay } from '@shared/phone'
import { HistoryLink } from '../history/HistoryLink'
import { SetLoginDialog } from '../users/SetLoginDialog'
import { UserFormDialog } from '../users/UserFormDialog'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·'
}

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
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.users.title}
        icon={<Users strokeWidth={1.75} />}
        actions={
          canManage && (
            <Button icon={<UserPlus aria-hidden className="size-5" strokeWidth={1.75} />} onClick={() => setDialog({ kind: 'create' })}>
              {t.users.add}
            </Button>
          )
        }
      />

      {error && <RetryNotice message={error} onRetry={reload} />}
      {actionError && <Notice>{actionError}</Notice>}
      {!data && !error && <SkeletonRows rows={4} />}
      {data && data.profiles.length === 0 && <EmptyState icon={<Users strokeWidth={1.5} />} title={t.users.empty} />}

      {data && data.profiles.length > 0 && (
        <ul className="grid gap-3 xl:grid-cols-2" aria-label={t.users.title}>
          {data.profiles.map((p) => {
            const objs = objectsOf(p.id)
            const isMe = p.id === me.id
            return (
              <li key={p.id} className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-4">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      p.is_active ? 'bg-ice text-navy' : 'bg-canvas text-muted'
                    }`}
                  >
                    {initials(p.full_name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">
                      <span>{p.full_name}</span>
                      {isMe && <span className="ml-1 text-sm font-normal text-muted">({t.users.you})</span>}
                    </p>
                    <p className="tabular text-sm text-muted">{formatPhoneDisplay(p.phone)}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Badge tone="info">{t.roles[p.role]}</Badge>
                    <Badge tone={p.is_active ? 'ok' : 'danger'}>{p.is_active ? t.status.active : t.status.inactive}</Badge>
                  </div>
                </div>

                <dl className="flex flex-col gap-1.5 text-sm">
                  <div className="flex items-start gap-2">
                    <dt className="flex shrink-0 items-center gap-1.5 text-muted">
                      <Building2 aria-hidden className="size-4" strokeWidth={1.75} />
                      {t.users.colObjects}
                    </dt>
                    <dd className="min-w-0 text-ink">{objs.length > 0 ? objs.join(', ') : '—'}</dd>
                  </div>
                  <div className="flex items-start gap-2">
                    <dt className="flex shrink-0 items-center gap-1.5 text-muted">
                      <Globe aria-hidden className="size-4" strokeWidth={1.75} />
                      {t.users.colWeb}
                    </dt>
                    <dd className="text-ink">{loginKindLabel[p.login_kind]}</dd>
                  </div>
                  <div className="flex items-start gap-2">
                    <dt className="flex shrink-0 items-center gap-1.5 text-muted">
                      <Send aria-hidden className="size-4" strokeWidth={1.75} />
                      {t.users.colTelegram}
                    </dt>
                    <dd className={p.telegram_user_id ? 'text-ok' : 'text-muted'}>{p.telegram_user_id ? t.users.linked : t.users.notLinked}</dd>
                  </div>
                </dl>

                {editable(p) && (
                  <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                    <Button
                      variant="secondary"
                      icon={<Pencil aria-hidden className="size-4" strokeWidth={1.75} />}
                      onClick={() => setDialog({ kind: 'edit', profile: p })}
                    >
                      {t.common.edit}
                    </Button>
                    {canSetLogin(p) && (
                      <Button
                        variant="secondary"
                        icon={<KeyRound aria-hidden className="size-4" strokeWidth={1.75} />}
                        onClick={() => setDialog({ kind: 'login', profile: p })}
                      >
                        {p.login_kind === 'web' ? t.users.resetPassword : t.users.setLogin}
                      </Button>
                    )}
                    {!isMe && (
                      <Button
                        variant={p.is_active ? 'danger' : 'secondary'}
                        icon={<Power aria-hidden className="size-4" strokeWidth={1.75} />}
                        disabled={busyId === p.id}
                        onClick={() => void toggleActive(p)}
                      >
                        {p.is_active ? t.users.deactivate : t.users.activate}
                      </Button>
                    )}
                    <HistoryLink table={null} id={p.id} />
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
