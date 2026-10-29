// Firmalar (faqat tizim egasi — super_admin): ro'yxat, yangi firma (RPC create_company — firma va administrator),
// nomini o'zgartirish, faollashtirish / nofaol qilish. Yangi firmadan keyin — administratorga veb login berish
// (admin-users) yoki shu firmaga o'tib foydalanuvchilarni ko'rish.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Building, KeyRound, Pencil, Plus, Users } from 'lucide-react'
import { normalizePhone } from '@shared/phone'
import { useActiveCompany } from '@/auth/activeCompany'
import { Badge, Button, DataTable, EmptyState, Modal, Notice, PageHeader, RetryNotice, SkeletonRows, TextField } from '@/components/ui'
import { cleanCompanyName, COMPANY_NAME_MAX, createCompany, listCompanies, renameCompany, setCompanyActive, type CompanyRow } from '@/data/companiesRepo'
import { getProfile } from '@/data/profilesRepo'
import type { Profile } from '@/data/types'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDate } from '@/lib/format'
import { SetLoginDialog } from '../users/SetLoginDialog'

const tc = t.companies
const ic = { className: 'size-5', strokeWidth: 1.75, 'aria-hidden': true } as const

interface CreatedCompany {
  companyId: string
  adminProfileId: string
  name: string
  adminName: string
}

type Dialog =
  | { kind: 'add' }
  | { kind: 'rename'; company: CompanyRow }
  | { kind: 'deactivate'; company: CompanyRow }
  | { kind: 'login'; profile: Profile }
  | null

/** Yangi firma: nom, administrator ismi va telefoni. */
function AddCompanyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (r: CreatedCompany) => void }) {
  const [name, setName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<{ name?: boolean; adminName?: boolean; phone?: boolean }>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    let cleanName: string
    try {
      cleanName = cleanCompanyName(name)
    } catch {
      cleanName = ''
    }
    const next = { name: !cleanName, adminName: !adminName.trim(), phone: !normalizePhone(phone) }
    setErrors(next)
    if (next.name || next.adminName || next.phone) return
    setSaving(true)
    setSaveError(null)
    try {
      const created = await createCompany({ name: cleanName, adminFullName: adminName, adminPhone: phone })
      onCreated({ ...created, name: cleanName, adminName: adminName.trim() })
    } catch (err) {
      setSaveError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={tc.addTitle} onClose={onClose}>
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
        <p className="text-sm text-muted">{tc.addIntro}</p>
        {saveError && <Notice>{saveError}</Notice>}
        <TextField
          label={tc.name}
          value={name}
          maxLength={COMPANY_NAME_MAX}
          autoComplete="organization"
          error={errors.name ? tc.errName : null}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label={tc.adminName}
          value={adminName}
          maxLength={200}
          autoComplete="off"
          error={errors.adminName ? tc.errAdminName : null}
          onChange={(e) => setAdminName(e.target.value)}
        />
        <TextField
          label={tc.adminPhone}
          hint={tc.adminPhoneHint}
          value={phone}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          error={errors.phone ? tc.errPhone : null}
          onChange={(e) => setPhone(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" loading={saving}>
            {t.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function RenameDialog({ company, onClose, onSaved }: { company: CompanyRow; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(company.name)
  const [invalid, setInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    let clean: string
    try {
      clean = cleanCompanyName(name)
    } catch {
      setInvalid(true)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await renameCompany(company.id, clean)
      onSaved()
    } catch (err) {
      setSaveError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={tc.renameTitle} onClose={onClose}>
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
        {saveError && <Notice>{saveError}</Notice>}
        <TextField
          label={tc.name}
          value={name}
          maxLength={COMPANY_NAME_MAX}
          error={invalid ? tc.errName : null}
          onChange={(e) => {
            setName(e.target.value)
            setInvalid(false)
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" loading={saving}>
            {t.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** "Firmalar" sahifasi (`/companies`, faqat super_admin — menyu va RequireNav; server — RLS va create_company). */
export function CompaniesPage() {
  const active = useActiveCompany()
  const navigate = useNavigate()
  const [rows, setRows] = useState<CompanyRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [created, setCreated] = useState<CreatedCompany | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reloadCompanies = active?.reloadCompanies
  const reload = useCallback(() => {
    setReloadKey((k) => k + 1)
    // Yon menyudagi tanlagich ham yangilansin
    reloadCompanies?.()
  }, [reloadCompanies])
  const close = useCallback(() => setDialog(null), [])

  useEffect(() => {
    let alive = true
    listCompanies()
      .then((list) => {
        if (!alive) return
        setRows(list)
        setError(null)
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    return () => {
      alive = false
    }
  }, [reloadKey])

  const toggle = async (c: CompanyRow, isActive: boolean) => {
    setBusyId(c.id)
    setActionError(null)
    setNotice(null)
    try {
      await setCompanyActive(c.id, isActive)
      setDialog(null)
      setNotice(tc.saved)
      reload()
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusyId(null)
    }
  }

  const openAdminLogin = async () => {
    if (!created) return
    setActionError(null)
    try {
      setDialog({ kind: 'login', profile: await getProfile(created.adminProfileId) })
    } catch (err) {
      setActionError(errorText(err))
    }
  }

  const openUsers = (companyId: string) => {
    active?.setCompanyId(companyId)
    navigate('/users')
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={tc.title}
        icon={<Building strokeWidth={1.75} />}
        actions={
          <Button
            icon={<Plus {...ic} />}
            onClick={() => {
              setCreated(null)
              setNotice(null)
              setDialog({ kind: 'add' })
            }}
          >
            {tc.add}
          </Button>
        }
      />
      {created && (
        <Notice tone="ok">
          <span className="flex flex-col gap-3" data-testid="company-created">
            <span className="flex flex-col gap-1">
              <span className="font-semibold">{tc.created(created.name)}</span>
              <span>{tc.createdText(created.adminName)}</span>
            </span>
            <span className="flex flex-wrap gap-2">
              <Button size="sm" icon={<KeyRound {...ic} />} onClick={() => void openAdminLogin()}>
                {tc.setAdminLogin}
              </Button>
              <Button size="sm" variant="secondary" icon={<Users {...ic} />} onClick={() => openUsers(created.companyId)}>
                {tc.openUsers}
              </Button>
            </span>
          </span>
        </Notice>
      )}
      {notice && <Notice tone="ok">{notice}</Notice>}
      {actionError && !dialog && <Notice>{actionError}</Notice>}
      {error && <RetryNotice message={error} onRetry={reload} />}
      {!rows && !error && <SkeletonRows rows={3} />}
      {rows && (
        <DataTable
          caption={tc.title}
          rows={rows}
          rowKey={(c) => c.id}
          rowTestId="company-row"
          empty={<EmptyState icon={<Building strokeWidth={1.5} />} title={tc.empty} />}
          columns={[
            {
              key: 'name',
              header: tc.colName,
              cell: (c) => (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{c.name}</span>
                  {active?.companyId === c.id && <Badge tone="info">{tc.current}</Badge>}
                </span>
              ),
            },
            {
              key: 'status',
              header: tc.colStatus,
              cell: (c) => <Badge tone={c.is_active ? 'ok' : 'neutral'}>{c.is_active ? tc.active : tc.inactive}</Badge>,
            },
            { key: 'created', header: tc.colCreated, cell: (c) => <span className="tabular text-muted">{formatDate(c.created_at)}</span> },
            {
              key: 'actions',
              header: tc.colActions,
              srHeader: true,
              cell: (c) => (
                <span className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="ghost" icon={<Pencil {...ic} />} onClick={() => setDialog({ kind: 'rename', company: c })}>
                    {tc.rename}
                  </Button>
                  {active?.companyId !== c.id && (
                    <Button size="sm" variant="ghost" onClick={() => openUsers(c.id)}>
                      {tc.switchTo}
                    </Button>
                  )}
                  {c.is_active ? (
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'deactivate', company: c })}>
                      {tc.deactivate}
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" loading={busyId === c.id} onClick={() => void toggle(c, true)}>
                      {tc.activate}
                    </Button>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}

      {dialog?.kind === 'add' && (
        <AddCompanyDialog
          onClose={close}
          onCreated={(r) => {
            setDialog(null)
            setCreated(r)
            reload()
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <RenameDialog
          company={dialog.company}
          onClose={close}
          onSaved={() => {
            setDialog(null)
            setNotice(tc.saved)
            reload()
          }}
        />
      )}
      {dialog?.kind === 'deactivate' && (
        <Modal
          title={tc.deactivate}
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                {t.common.no}
              </Button>
              <Button variant="danger" loading={busyId === dialog.company.id} onClick={() => void toggle(dialog.company, false)}>
                {t.common.yes}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">{tc.deactivateConfirm(dialog.company.name)}</p>
            {actionError && <Notice>{actionError}</Notice>}
          </div>
        </Modal>
      )}
      {dialog?.kind === 'login' && <SetLoginDialog profile={dialog.profile} onClose={close} onSaved={() => undefined} />}
    </div>
  )
}
