// Veb "Xarajat qo'shish" (admin, buxgalter, ta'minotchi): tur (tugmalar), summa, obyekt ("Umumiy" bilan), sana,
// ixtiyoriy chek rasmi va izoh; admin — to'lovchi (profile_directory → is_available); admin / buxgalter — pul manbai.
// Qoidalar umumiy (src/domain/expenses.ts): summa, rasm majburiyligi, takroriy yozuv.
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/authContext'
import { Button, choiceClass, DateField, Modal, Notice, RetryNotice, SelectField, SkeletonRows, TextAreaField, TextField } from '@/components/ui'
import { DEFAULT_COMPANY_SETTINGS, getCompanySettings, type CompanySettings } from '@/data/companiesRepo'
import { listExpenseCategories } from '@/data/expenseCategoriesRepo'
import { createExpense, getMyExpenseCategoryUsage, listMyExpenses, type ExpenseCategoryUsage } from '@/data/expensesRepo'
import { requestPhotoHash } from '@/data/functions'
import { listObjects } from '@/data/objectsRepo'
import { listActiveDirectory } from '@/data/profileDirectory'
import type { Expense, ExpenseCategory, ObjectRow, PaymentSource, PersonRef } from '@/data/types'
import { PAYMENT_SOURCES } from '@/data/types'
import { formatSumInput, parseSumInput } from '@/domain/cash'
import { entryDateBounds, entryDateToIso, tashkentDateOf } from '@/domain/entryDate'
import { expensePhotoRequired, findDuplicateExpense, rankExpenseCategories, validateExpenseAmount } from '@/domain/expenses'
import { can, ROLES } from '@/domain/roles'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatSum } from '@/lib/format'
import { uuid } from '@/lib/uuid'
import { PhotoField } from '@/tg/entry/PhotoPicker'
import { usePhotoDraft } from '@/tg/entry/usePhotoDraft'

const te = t.expenses
const PAYER_ROLES = ROLES.filter((r) => can(r, 'create_expense'))
/** Obyekt tanlovidagi "Umumiy" qiymati. */
const GENERAL = '__general'

interface Refs {
  categories: ExpenseCategory[]
  usage: ExpenseCategoryUsage[]
  objects: ObjectRow[]
  settings: CompanySettings
  payers: PersonRef[]
  recent: Expense[]
}

type Field = 'category' | 'amount' | 'date'

export function AddExpenseDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (e: Expense) => void }) {
  const { profile: me } = useAuth()
  const isAdmin = me?.role === 'admin' || me?.role === 'super_admin'
  const canPickSource = isAdmin || me?.role === 'buxgalter'
  const companyId = me?.company_id
  const [refs, setRefs] = useState<Refs | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [objectId, setObjectId] = useState(GENERAL)
  const [date, setDate] = useState(() => tashkentDateOf(Date.now()))
  const [payerId, setPayerId] = useState('')
  const [paymentSource, setPaymentSource] = useState<PaymentSource | ''>('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [duplicate, setDuplicate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [draftId] = useState(() => uuid())
  const photo = usePhotoDraft()

  useEffect(() => {
    if (!companyId || !me) return
    let alive = true
    Promise.all([
      listExpenseCategories(),
      getMyExpenseCategoryUsage(30).catch(() => [] as ExpenseCategoryUsage[]),
      listObjects(),
      getCompanySettings(companyId)
        .then((s) => ({ ...DEFAULT_COMPANY_SETTINGS, ...s }))
        .catch(() => DEFAULT_COMPANY_SETTINGS),
      isAdmin ? listActiveDirectory(PAYER_ROLES) : Promise.resolve([] as PersonRef[]),
      listMyExpenses(me.id, 30).catch(() => [] as Expense[]),
    ])
      .then(([categories, usage, objects, settings, payers, recent]) => {
        if (!alive) return
        const active = objects.filter((o) => o.status === 'faol' && o.company_id === companyId)
        setRefs({ categories: categories.filter((c) => c.company_id === companyId), usage, objects: active, settings, payers, recent })
        if (active.length === 1 && active[0]) setObjectId(active[0].id)
        setLoadError(null)
      })
      .catch((err: unknown) => alive && setLoadError(errorText(err)))
    return () => {
      alive = false
    }
  }, [companyId, me, isAdmin, reloadKey])

  const ranked = useMemo(() => (refs ? rankExpenseCategories(refs.categories, refs.usage) : []), [refs])
  const category = refs?.categories.find((c) => c.id === categoryId) ?? null
  const amountDec = parseSumInput(amount)
  const rule =
    category && refs
      ? expensePhotoRequired({
          amount: amountDec,
          thresholdAmount: refs.settings.photoRequiredAmount,
          categoryPhotoRequired: category.photo_required,
          qrVerified: false,
        })
      : null
  const photoReason =
    rule === 'category'
      ? te.photoRequiredCategory
      : rule === 'amount' && refs?.settings.photoRequiredAmount
        ? t.tg.auto.photoRequiredAmount(formatSum(refs.settings.photoRequiredAmount))
        : null
  const photoMissing = photoReason !== null && !photo.photo

  const clear = (f: Field) => {
    setErrors((er) => ({ ...er, [f]: undefined }))
    setDuplicate(false)
    setSaveError(null)
  }

  const submit = async (e: FormEvent | null, confirmDuplicate = false) => {
    e?.preventDefault()
    if (!me || !refs || saving || photo.preparing) return
    const nowIso = new Date().toISOString()
    const next: Partial<Record<Field, string>> = {}
    if (!category) next.category = te.errors.category
    const parsed = validateExpenseAmount(amount)
    if (!parsed.ok) next.amount = parsed.error === 'required' ? te.errors.amountRequired : te.errors.amountInvalid
    const spentAt = date ? entryDateToIso(date, nowIso, isAdmin) : undefined
    if (spentAt === undefined) next.date = date ? t.tg.movement.errors.occurredAt : t.tg.date.errRequired
    if (Object.keys(next).length > 0 || !parsed.ok || !category || spentAt === undefined) {
      setErrors(next)
      return
    }
    if (photoMissing) return
    const object = objectId === GENERAL ? null : objectId
    if (!confirmDuplicate) {
      const dup = findDuplicateExpense(
        refs.recent
          .filter((x) => !x.deleted_at && x.created_by)
          .map((x) => ({ id: x.id, createdBy: x.created_by ?? '', categoryId: x.category_id, objectId: x.object_id, amount: x.amount, createdAt: x.created_at })),
        { id: draftId, createdBy: me.id, categoryId: category.id, objectId: object, amount: parsed.value, createdAt: nowIso },
        refs.settings.duplicateWindowMinutes,
      )
      if (dup) {
        setDuplicate(true)
        return
      }
    }
    setSaving(true)
    setSaveError(null)
    setDuplicate(false)
    try {
      const receiptPhotoPath = await photo.resolvePath(me.company_id)
      const saved = await createExpense({
        id: draftId,
        companyId: me.company_id,
        categoryId: category.id,
        objectId: object,
        amount: parsed.value,
        note,
        payerId: isAdmin && payerId ? payerId : me.id,
        spentAt,
        receiptPhotoPath,
        ...(canPickSource && paymentSource ? { paymentSource } : {}),
      })
      // Chek rasmi xeshi — serverda, fonda
      if (receiptPhotoPath) void requestPhotoHash('expenses', saved.id)
      onSaved(saved)
    } catch (err) {
      if (!photo.handleSaveError(err)) setSaveError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  const bounds = entryDateBounds(new Date().toISOString(), isAdmin)

  return (
    <Modal
      title={te.addTitle}
      size="lg"
      onClose={onClose}
      footer={
        refs && (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t.common.cancel}
            </Button>
            {duplicate ? (
              <Button variant="danger" loading={saving} onClick={() => void submit(null, true)}>
                {t.tg.auto.duplicateSave}
              </Button>
            ) : (
              <Button type="submit" form="add-expense-form" loading={saving} disabled={saving || photo.preparing || photoMissing}>
                {saving ? t.common.saving : t.common.save}
              </Button>
            )}
          </>
        )
      }
    >
      {loadError && <RetryNotice message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />}
      {!refs && !loadError && <SkeletonRows rows={5} />}
      {refs && (
        <form id="add-expense-form" noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2" aria-describedby={errors.category ? 'add-expense-category-error' : undefined}>
            <legend className="mb-1 text-sm font-medium text-ink">{te.category}</legend>
            {ranked.length === 0 && <Notice tone="warn">{te.noCategories}</Notice>}
            <div className="flex flex-wrap gap-2">
              {ranked.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={categoryId === c.id}
                  className={choiceClass({ selected: categoryId === c.id })}
                  onClick={() => {
                    setCategoryId(c.id)
                    clear('category')
                  }}
                >
                  {c.name}
                </button>
              ))}
            </div>
            {errors.category && (
              <p id="add-expense-category-error" role="alert" className="text-xs text-danger">
                {errors.category}
              </p>
            )}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={te.amount}
              inputMode="numeric"
              autoComplete="off"
              value={amount}
              suffix={t.ui.sum}
              error={errors.amount ?? null}
              onChange={(e) => {
                setAmount(formatSumInput(e.target.value))
                clear('amount')
              }}
            />
            <SelectField label={te.object} value={objectId} onChange={(v) => {
                setObjectId(v)
                setDuplicate(false)
              }}>
              <option value={GENERAL}>{`${te.general} (${te.generalHint})`}</option>
              {refs.objects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <DateField
              label={te.date}
              value={date}
              min={bounds.min}
              max={bounds.max}
              hint={isAdmin ? undefined : t.tg.date.pickHint}
              error={errors.date ?? null}
              onChange={(iso) => {
                setDate(iso)
                clear('date')
              }}
            />
            {isAdmin && (
              <SelectField label={te.payer} hint={te.payerHint} value={payerId} onChange={setPayerId}>
                <option value="">{te.payerMe}</option>
                {refs.payers
                  .filter((p) => p.id !== me?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {`${p.full_name} (${t.roles[p.role]})`}
                    </option>
                  ))}
              </SelectField>
            )}
          </div>

          {canPickSource && (
            <SelectField
              label={te.paymentSource}
              hint={te.paymentSourceHint}
              value={paymentSource}
              onChange={(v) => setPaymentSource(v === 'podotchet' || v === 'firma' ? v : '')}
            >
              <option value="">{te.paymentSourceAuto}</option>
              {PAYMENT_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t.purchases.paymentSources[s]}
                </option>
              ))}
            </SelectField>
          )}

          <PhotoField
            label={te.photo}
            photo={photo.photo}
            busy={photo.preparing || saving}
            preparing={photo.preparing}
            notice={photo.notice}
            requiredReason={photoReason}
            onPick={(f) => void photo.pick(f)}
            onRemove={photo.remove}
          />
          {photoMissing && <Notice tone="warn">{photoReason}</Notice>}
          {photo.error && <Notice>{photo.error}</Notice>}

          <TextAreaField label={te.note} placeholder={te.notePlaceholder} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />

          {duplicate && <Notice tone="warn">{t.tg.auto.duplicateText(refs.settings.duplicateWindowMinutes)}</Notice>}
          {saveError && <Notice>{saveError}</Notice>}
        </form>
      )}
    </Modal>
  )
}
