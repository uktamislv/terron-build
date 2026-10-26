import { useEffect, useState, type FormEvent } from 'react'
import { Button, Notice, RetryNotice, SelectField, SkeletonRows, TextField } from '@/components/ui'
import { getCompanySettings, updateCompanySettings } from '@/data/companiesRepo'
import { formatSumInput } from '@/domain/cash'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import {
  fromForm,
  INT_LIMITS,
  PCT_LIMITS,
  QUIET_TIME_OPTIONS,
  toForm,
  type SettingsErrors,
  type SettingsForm,
  type SettingsKey,
} from './settingsForm'

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

  const quietOn = form.quietHoursStart !== '' || form.quietHoursEnd !== ''
  const quietError = errors.quietHoursStart || errors.quietHoursEnd ? ts.errQuiet : null
  const timeOptions = (current: string) =>
    // Bazadagi qiymat 30 daqiqalik qadamda bo'lmasa ham ro'yxatda ko'rinsin
    (current && !QUIET_TIME_OPTIONS.includes(current) ? [current, ...QUIET_TIME_OPTIONS] : QUIET_TIME_OPTIONS).map((v) => (
      <option key={v} value={v}>
        {v}
      </option>
    ))
  const toggleQuiet = (on: boolean) => {
    setForm({ ...form, quietHoursStart: on ? '22:00' : '', quietHoursEnd: on ? '07:00' : '' })
    setErrors((er) => ({ ...er, quietHoursStart: undefined, quietHoursEnd: undefined }))
    setDone(false)
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
      <fieldset className="flex flex-col gap-3" aria-describedby="quiet-intro">
        <legend className="mb-2 text-base font-semibold text-ink">{ts.groupQuiet}</legend>
        <p id="quiet-intro" className="text-sm text-muted">
          {ts.quietIntro}
        </p>
        <label className="inline-flex min-h-11 items-center gap-3 self-start text-sm text-ink">
          <input
            type="checkbox"
            className="size-5 border-line-strong accent-brand"
            checked={quietOn}
            disabled={!canEdit}
            onChange={(e) => toggleQuiet(e.target.checked)}
          />
          {ts.quietEnabled}
        </label>
        {quietOn ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label={ts.quietStart}
              value={form.quietHoursStart}
              disabled={!canEdit}
              onChange={(v) => set('quietHoursStart', v)}
            >
              {timeOptions(form.quietHoursStart)}
            </SelectField>
            <SelectField label={ts.quietEnd} value={form.quietHoursEnd} disabled={!canEdit} onChange={(v) => set('quietHoursEnd', v)}>
              {timeOptions(form.quietHoursEnd)}
            </SelectField>
          </div>
        ) : (
          <p className="text-sm text-muted">{ts.quietOff}</p>
        )}
        {quietError && (
          <p role="alert" className="text-sm text-danger">
            {quietError}
          </p>
        )}
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
