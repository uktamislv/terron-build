import { useEffect, useState, type FormEvent } from 'react'
import { Button, Notice, RetryNotice, SkeletonRows, TextField } from '@/components/ui'
import { getCompanySettings, updateCompanySettings } from '@/data/companiesRepo'
import { formatSumInput } from '@/domain/cash'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { fromForm, INT_LIMITS, PCT_LIMITS, toForm, type SettingsErrors, type SettingsForm, type SettingsKey } from './settingsForm'

const ts = t.settings

/** Firma sozlamalari (Batch 12): farq qoidalari va avtomatlashtirish chegaralari. Saqlash — admin (RLS). */
export function CompanySettingsForm({ companyId, canEdit, onSaved }: { companyId: string; canEdit: boolean; onSaved?: () => void }) {
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [errors, setErrors] = useState<SettingsErrors>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let alive = true
    getCompanySettings(companyId)
      .then((s) => {
        if (!alive) return
        setForm(toForm(s))
        setLoadError(null)
      })
      .catch((err: unknown) => alive && setLoadError(errorText(err)))
    return () => {
      alive = false
    }
  }, [companyId, reloadKey])

  if (loadError) return <RetryNotice message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
  if (!form) return <SkeletonRows rows={4} />

  const set = (key: SettingsKey, value: string) => {
    setForm({ ...form, [key]: key === 'photoRequiredAmount' ? formatSumInput(value) : value })
    setErrors((e) => ({ ...e, [key]: undefined }))
    setDone(false)
  }

  const field = (key: SettingsKey, label: string, hint?: string) => {
    const intLimit = (INT_LIMITS as Partial<Record<SettingsKey, readonly [number, number]>>)[key]
    const pctLimit = (PCT_LIMITS as Partial<Record<SettingsKey, number>>)[key]
    const error = !errors[key]
      ? null
      : intLimit
        ? ts.errInt(intLimit[0], intLimit[1])
        : pctLimit !== undefined
          ? ts.errPct(pctLimit)
          : ts.errAmount
    return (
      <TextField
        label={label}
        hint={hint}
        value={form[key]}
        inputMode={intLimit || key === 'photoRequiredAmount' ? 'numeric' : 'decimal'}
        autoComplete="off"
        disabled={!canEdit}
        error={error}
        onChange={(e) => set(key, e.target.value)}
      />
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canEdit || saving) return
    const parsed = fromForm(form)
    if (!parsed.ok) {
      setErrors(parsed.errors)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await updateCompanySettings(companyId, parsed.value)
      setForm(toForm(parsed.value))
      setDone(true)
      onSaved?.()
    } catch (err) {
      setSaveError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5" aria-label={ts.title}>
      <p className="text-sm text-muted">{ts.intro}</p>
      {!canEdit && <Notice tone="info">{ts.readOnly}</Notice>}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-base font-semibold text-ink">{ts.groupRules}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('receiptMismatchPct', ts.receiptMismatchPct)}
          {field('priceDeviationPct', ts.priceDeviationPct)}
          {field('priceAvgWindow', ts.priceAvgWindow)}
          {field('requestOverbuyPct', ts.requestOverbuyPct)}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-base font-semibold text-ink">{ts.groupAuto}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('photoRequiredAmount', ts.photoRequiredAmount, ts.photoRequiredAmountHint)}
          {field('cashMaxDays', ts.cashMaxDays, ts.cashMaxDaysHint)}
          {field('duplicateWindowMinutes', ts.duplicateWindowMinutes, ts.duplicateWindowHint)}
          {field('alertRemindHours', ts.alertRemindHours)}
          {field('forecastDaysWarn', ts.forecastDaysWarn)}
        </div>
      </fieldset>
      {saveError && <Notice>{saveError}</Notice>}
      {done && <Notice tone="ok">{ts.saved}</Notice>}
      {canEdit && (
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? t.common.saving : t.common.save}
          </Button>
        </div>
      )}
    </form>
  )
}
