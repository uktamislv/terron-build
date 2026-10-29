import { useEffect, useState, type FormEvent } from 'react'
import { Button, Notice, RetryNotice, SkeletonRows, TextField } from '@/components/ui'
import { cleanCompanyName, COMPANY_NAME_MAX, getCompanyName, renameCompany } from '@/data/companiesRepo'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'

const ts = t.settings

/** Sozlamalar → Firma: firma nomi (admin — o'z firmasi; companies_update RLS). */
export function CompanyNameForm({ companyId, canEdit, onSaved }: { companyId: string; canEdit: boolean; onSaved?: () => void }) {
  const [name, setName] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [invalid, setInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let alive = true
    getCompanyName(companyId)
      .then((n) => {
        if (!alive) return
        setName(n)
        setLoadError(null)
      })
      .catch((err: unknown) => alive && setLoadError(errorText(err)))
    return () => {
      alive = false
    }
  }, [companyId, reloadKey])

  if (loadError) return <RetryNotice message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
  if (name === null) return <SkeletonRows rows={1} />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canEdit || saving) return
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
      await renameCompany(companyId, clean)
      setName(clean)
      setDone(true)
      onSaved?.()
    } catch (err) {
      setSaveError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" aria-label={ts.companyName}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <TextField
          label={ts.companyName}
          value={name}
          maxLength={COMPANY_NAME_MAX}
          autoComplete="organization"
          disabled={!canEdit}
          error={invalid ? ts.errCompanyName : null}
          className="flex-1"
          onChange={(e) => {
            setName(e.target.value)
            setInvalid(false)
            setDone(false)
          }}
        />
        {canEdit && (
          <Button type="submit" variant="secondary" disabled={saving}>
            {saving ? t.common.saving : t.common.save}
          </Button>
        )}
      </div>
      {saveError && <Notice>{saveError}</Notice>}
      {done && <Notice tone="ok">{ts.companyNameSaved}</Notice>}
    </form>
  )
}
