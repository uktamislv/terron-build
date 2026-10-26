import { useState, type FormEvent } from 'react'
import { Button, Checkbox, choiceClass, Modal, Notice, TextField } from '@/components/ui'
import { listObjectMembers, syncProfileObjects } from '@/data/objectMembersRepo'
import { createProfile, updateProfile, type ProfilePatch } from '@/data/profilesRepo'
import type { ObjectMember, ObjectRow, Profile } from '@/data/types'
import { isProtectedProfile, type Role } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatPhoneDisplay, normalizePhone } from '@shared/phone'
import {
  assignableRoles,
  isObjectScoped,
  validateUserForm,
  type UserFormErrors,
  type UserFormValues,
} from './userForm'

interface Props {
  actorRole: Role
  companyId: string
  /** Berilsa — tahrirlash, aks holda yangi foydalanuvchi */
  profile?: Profile
  objects: ObjectRow[]
  members: ObjectMember[]
  /** O'z profilini tahrirlash — telefon o'zgartirilmaydi (server bog'lanishni uzadi) */
  isMe?: boolean
  onClose: () => void
  onSaved: () => void
}

const fieldErrors = {
  fullName: { required: t.users.errName, invalid: t.users.errName },
  phone: { required: t.users.errPhone, invalid: t.users.errPhone },
  role: { required: t.users.errRole, invalid: t.users.errRole },
  objectIds: { required: t.users.errObjects, invalid: t.users.errObjects },
} as const

export function UserFormDialog({
  actorRole,
  companyId,
  profile,
  objects,
  members,
  isMe = false,
  onClose,
  onSaved,
}: Props) {
  const [values, setValues] = useState<UserFormValues>(() => ({
    fullName: profile?.full_name ?? '',
    phone: profile ? formatPhoneDisplay(profile.phone) : '',
    role: profile?.role ?? '',
    objectIds: profile
      ? members.filter((m) => m.profile_id === profile.id && m.deleted_at === null).map((m) => m.object_id)
      : [],
  }))
  const [errors, setErrors] = useState<UserFormErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** Profil yaratildi, lekin obyektlar biriktirilmadi — qayta saqlashda faqat sinxronlanadi */
  const [createdId, setCreatedId] = useState<string | null>(null)

  // Himoyalangan profil (admin/direktor, aktyor super_admin emas): rol va telefon o'zgarmaydi
  const locked = profile ? isProtectedProfile(actorRole, profile.role) : false
  // Tahrirlashda mavjud rol (masalan super_admin ni super_admin tahrirlasa) ro'yxatda qoladi
  const roles = assignableRoles(actorRole)
  const showObjects = values.role !== '' && isObjectScoped(values.role)

  function toggleObject(id: string) {
    setValues((v) => ({
      ...v,
      objectIds: v.objectIds.includes(id) ? v.objectIds.filter((x) => x !== id) : [...v.objectIds, id],
    }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const result = validateUserForm(values, actorRole)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setSaveError(null)
    setSaving(true)
    const v = result.value
    try {
      if (createdId) {
        // Qayta urinish: yangi profil emas — joriy biriktirishlarni o'qib, faqat sinxronlaymiz
        const current = await listObjectMembers()
        await syncProfileObjects(companyId, createdId, v.objectIds, current)
      } else if (profile) {
        const patch: ProfilePatch = {}
        if (v.fullName !== profile.full_name) patch.fullName = v.fullName
        if (!isMe && !locked && v.phone !== profile.phone) patch.phone = v.phone
        if (!locked && v.role !== profile.role) patch.role = v.role
        if (Object.keys(patch).length > 0) await updateProfile(profile.id, patch)
        await syncProfileObjects(companyId, profile.id, v.objectIds, members)
      } else {
        const created = await createProfile({ companyId, fullName: v.fullName, phone: v.phone, role: v.role })
        try {
          await syncProfileObjects(companyId, created.id, v.objectIds, members)
        } catch {
          setCreatedId(created.id)
          setSaveError(t.users.partialCreate)
          return
        }
      }
      onSaved()
    } catch (err) {
      setSaveError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={profile || createdId ? t.users.editTitle : t.users.addTitle} onClose={onClose}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {saveError && <Notice>{saveError}</Notice>}
        <TextField
          label={t.users.fullName}
          value={values.fullName}
          autoComplete="off"
          onChange={(e) => setValues({ ...values, fullName: e.target.value })}
          error={errors.fullName ? fieldErrors.fullName[errors.fullName] : null}
        />
        <TextField
          label={t.users.phone}
          type="tel"
          inputMode="tel"
          placeholder="+998 90 123 45 67"
          value={values.phone}
          onChange={(e) => setValues({ ...values, phone: e.target.value })}
          disabled={isMe || locked || createdId !== null}
          hint={
            locked
              ? t.users.protectedHint
              : isMe
                ? t.users.ownPhoneLocked
                : profile && normalizePhone(values.phone) !== profile.phone
                  ? t.users.phoneChangeWarning
                  : t.users.phoneHint
          }
          error={errors.phone ? fieldErrors.phone[errors.phone] : null}
        />

        {locked && profile ? (
          <div className="flex flex-col gap-1.5" data-testid="role-locked">
            <span className="text-sm font-medium text-muted">{t.users.role}</span>
            <span className="text-base font-semibold text-ink">{t.roles[profile.role]}</span>
          </div>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium text-muted">{t.users.role}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {roles.map((role) => (
                <label
                  key={role}
                  className={choiceClass({ selected: values.role === role, shape: 'box', label: true })}
                >
                  <input
                    type="radio"
                    name="role"
                    value={role}
                    className="sr-only"
                    checked={values.role === role}
                    onChange={() => setValues({ ...values, role })}
                  />
                  {t.roles[role]}
                </label>
              ))}
            </div>
            {errors.role && <p className="text-xs text-danger">{fieldErrors.role[errors.role]}</p>}
          </fieldset>
        )}

        {showObjects && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-muted">{t.users.objects}</legend>
            <p className="text-xs text-muted">{t.users.objectsHint}</p>
            {objects.length === 0 ? (
              <Notice tone="warn">{t.users.noObjects}</Notice>
            ) : (
              <div className="flex flex-col gap-2">
                {objects.map((o) => (
                  <label
                    key={o.id}
                    className={choiceClass({
                      selected: values.objectIds.includes(o.id),
                      shape: 'row',
                      label: true,
                      emphasis: false,
                    })}
                  >
                    <Checkbox
                      checked={values.objectIds.includes(o.id)}
                      onChange={() => toggleObject(o.id)}
                    />
                    <span className="text-sm">{o.name}</span>
                  </label>
                ))}
              </div>
            )}
            {errors.objectIds && <p className="text-xs text-danger">{fieldErrors.objectIds[errors.objectIds]}</p>}
          </fieldset>
        )}

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
