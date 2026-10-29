// Telegram ilovasi "Xarid → Xarajat": ombordan tashqari xarajat (oziq-ovqat, yoqilg'i, transport …).
// 3–4 bosish: [Xarajat] → tur plitkasi → summa → Saqlash (obyekt bitta bo'lsa yoki oxirgisi — avtomatik).
// Qoidalar domain'da (src/domain/expenses.ts): summa, rasm majburiyligi, takroriy yozuv; server baribir tekshiradi.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Receipt } from 'lucide-react'
import { Button, choiceClass, Notice, RetryNotice, SkeletonRows } from '@/components/ui'
import type { Profile } from '@/data/types'
import { errorCodeOf } from '@/data/errors'
import { createExpense, getMyExpenseCategoryUsage, listMyExpenses, type ExpenseCategoryUsage } from '@/data/expensesRepo'
import { listExpenseCategories } from '@/data/expenseCategoriesRepo'
import { requestPhotoHash } from '@/data/functions'
import { listObjects } from '@/data/objectsRepo'
import type { PurchaseReceiptQr } from '@/data/purchasesRepo'
import { receiptLookup, type ReceiptLookup } from '@/data/receiptRepo'
import { findByTin, listSuppliers } from '@/data/suppliersRepo'
import type { Expense, ExpenseCategory, ObjectRow, Supplier } from '@/data/types'
import { formatSumInput, parseSumInput } from '@/domain/cash'
import { entryDateFor } from '@/domain/entryDate'
import {
  defaultExpenseObject,
  expensePhotoRequired,
  findDuplicateExpense,
  rankExpenseCategories,
  validateExpenseAmount,
} from '@/domain/expenses'
import { parseReceiptQr, type ReceiptQr } from '@/domain/receipt'
import { receiptPhotoExempt, receiptVerified } from '@/domain/rules'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatSum } from '@/lib/format'
import { draftFingerprint, useDraftId } from '../entry/useDraftId'
import { scrollToPhotoField } from '../entry/scrollToField'
import { DateChips } from '../entry/DateChips'
import { TODAY_CHOICE, type DateChipsValue } from '../entry/dateChoice'
import { DuplicateWarning } from '../entry/DuplicateWarning'
import { PhotoErrorBox, PhotoField } from '../entry/PhotoPicker'
import { BigNumberInput, MaterialHeader, NoteField } from '../entry/QtyField'
import { useCompanySettings } from '../entry/useCompanySettings'
import { useGeoCapture } from '../entry/useGeoCapture'
import { usePhotoDraft } from '../entry/usePhotoDraft'
import { canScanQr, scanQr } from '../qrScan'
import { getWebApp, haptic } from '../telegram'
import { SavedBanner, SectionTitle } from '../ui'
import { flashMainButtonSaved, useBackButton, useClosingConfirmation, useMainButton } from '../useTelegramButtons'
import { GENERAL_OBJECT, loadLastExpenseObject, saveLastExpenseObject } from './prefs'
import { ReceiptCard, ScanReceiptButton } from './ReceiptCard'

const te = t.expenses
const ta = t.tg.auto
const USAGE_DAYS = 30
const RECENT_LIMIT = 30

interface ReceiptState {
  qr: ReceiptQr
  lookup: ReceiptLookup | null
}

type AmountError = 'amountRequired' | 'amountInvalid'

/** Obyekt chiplari: "Umumiy" (obyektsiz) va firma obyektlari. */
function ObjectChips({
  objects,
  value,
  onChange,
}: {
  objects: ObjectRow[]
  value: string | null
  onChange: (id: string | null) => void
}) {
  const options: { id: string | null; label: string }[] = [
    ...objects.map((o) => ({ id: o.id as string | null, label: o.name })),
    { id: null, label: te.general },
  ]
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-ink">{te.object}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const selected = o.id === value
          return (
            <button
              key={o.id ?? GENERAL_OBJECT}
              type="button"
              aria-pressed={selected}
              data-testid={o.id ? 'expense-object' : 'expense-object-general'}
              className={choiceClass({ selected, size: 'md' })}
              title={o.label}
              onClick={() => onChange(o.id)}
            >
              <span className="min-w-0 truncate">{o.label}</span>
              {o.id === null && <span className="shrink-0 text-sm font-normal text-muted">({te.generalHint})</span>}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Tur plitkalari: ko'p ishlatilgani oldinda (`rankExpenseCategories`). */
function CategoryGrid({ categories, onPick }: { categories: ExpenseCategory[]; onPick: (c: ExpenseCategory) => void }) {
  return (
    <section className="flex flex-col gap-3" aria-label={te.chooseCategory}>
      <SectionTitle>{te.chooseCategory}</SectionTitle>
      {categories.length === 0 && <Notice tone="warn">{te.noCategories}</Notice>}
      <div className="grid grid-cols-2 gap-2">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            data-testid="expense-category"
            onClick={() => onPick(c)}
            className={choiceClass({ selected: false, shape: 'tile' })}
          >
            <span className="line-clamp-2 text-base leading-snug font-semibold text-ink">{c.name}</span>
            {c.photo_required && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <Receipt aria-hidden className="size-3.5" strokeWidth={1.75} />
                {te.photoRequiredShort}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}

export function ExpenseEntry({
  profile,
  onSaved,
  onDirtyChange,
}: {
  profile: Profile
  onSaved: () => void
  /** Formada kiritilgan ma'lumot bor/yo'q — sahifa chiqishdan oldin tasdiq so'raydi. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const companyId = profile.company_id
  const isAdmin = profile.role === 'admin' || profile.role === 'super_admin'
  const settings = useCompanySettings(companyId)

  const [categories, setCategories] = useState<ExpenseCategory[] | null>(null)
  const [objects, setObjects] = useState<ObjectRow[] | null>(null)
  const [usage, setUsage] = useState<ExpenseCategoryUsage[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [recent, setRecent] = useState<Expense[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [objectId, setObjectId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [entryDate, setEntryDate] = useState<DateChipsValue>(TODAY_CHOICE)
  const [dateError, setDateError] = useState<string | null>(null)
  const [amountError, setAmountError] = useState<AmountError | null>(null)
  const [receipt, setReceipt] = useState<ReceiptState | null>(null)
  const [receiptBusy, setReceiptBusy] = useState(false)
  const [receiptNotice, setReceiptNotice] = useState<string | null>(null)
  const [receiptUsed, setReceiptUsed] = useState(false)
  const [duplicate, setDuplicate] = useState(false)
  // Qoralama id'si: xatodan keyin tur, obyekt yoki summa o'zgarsa — yangi id (useDraftId)
  const draftIds = useDraftId()
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedText, setSavedText] = useState<{ text: string; meta: string } | null>(null)
  const photo = usePhotoDraft()
  const preparingPhoto = photo.preparing
  const scanAvailable = canScanQr()

  useEffect(() => {
    let alive = true
    Promise.all([listExpenseCategories(), listObjects()])
      .then(([cats, objs]) => {
        if (!alive) return
        // super_admin boshqa firmalarni ham ko'radi — Mini App faqat o'z firmasida ishlaydi
        const active = objs.filter((o) => o.status === 'faol' && o.company_id === companyId)
        setCategories(cats.filter((c) => c.company_id === companyId))
        setObjects(active)
        setObjectId(defaultExpenseObject(active.map((o) => o.id), loadLastExpenseObject(), GENERAL_OBJECT))
        setLoadError(null)
      })
      .catch((err: unknown) => alive && setLoadError(errorText(err)))
    // Qo'shimcha — bo'lmasa ham forma ishlaydi
    Promise.resolve()
      .then(() => getMyExpenseCategoryUsage(USAGE_DAYS))
      .then((rows) => alive && Array.isArray(rows) && setUsage(rows))
      .catch(() => undefined)
    Promise.resolve()
      .then(() => listSuppliers())
      .then((rows) => alive && Array.isArray(rows) && setSuppliers(rows))
      .catch(() => undefined)
    Promise.resolve()
      .then(() => listMyExpenses(profile.id, RECENT_LIMIT))
      .then((rows) => alive && Array.isArray(rows) && setRecent(rows))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [companyId, profile.id, reloadKey])

  const ranked = useMemo(() => rankExpenseCategories(categories ?? [], usage), [categories, usage])
  const category = categories?.find((c) => c.id === categoryId) ?? null
  const step: 'category' | 'details' = category ? 'details' : 'category'
  const geo = useGeoCapture(step === 'details')
  const amountDec = parseSumInput(amount)

  const qrVerified = receipt?.lookup?.verified
    ? receiptVerified({
        lookupTotal: receipt.lookup.total,
        lookupItems: receipt.lookup.items,
        lookupReceiptAt: receipt.lookup.datetime ?? receipt.qr.datetime,
        totalAmount: amountDec,
        purchasedAt:
          receipt.lookup.datetime ??
          receipt.qr.datetime ??
          entryDateFor(entryDate.choice, entryDate.other, new Date().toISOString(), isAdmin) ??
          new Date().toISOString(),
      })
    : false
  // Rasmdan ozod — server guard bilan bir xil: tasdiqlangan, jami ma'lum va bir qatorli chek
  const photoExempt = receipt?.lookup
    ? receiptPhotoExempt({ verified: qrVerified, total: receipt.lookup.total, itemCount: receipt.lookup.items.length })
    : false
  const photoRule = category
    ? expensePhotoRequired({
        amount: amountDec,
        thresholdAmount: settings.photoRequiredAmount,
        categoryPhotoRequired: category.photo_required,
        qrVerified: photoExempt,
      })
    : null
  const photoRequiredReason =
    photoRule === 'category'
      ? te.photoRequiredCategory
      : photoRule === 'amount' && settings.photoRequiredAmount !== null
        ? ta.photoRequiredAmount(formatSum(settings.photoRequiredAmount))
        : null
  const photoMissing = photoRequiredReason !== null && !photo.photo

  const reset = () => {
    setCategoryId(null)
    setAmount('')
    setNote('')
    setEntryDate(TODAY_CHOICE)
    setDateError(null)
    setAmountError(null)
    setReceipt(null)
    setReceiptNotice(null)
    setReceiptUsed(false)
    setDuplicate(false)
    draftIds.renew()
    photo.reset()
    geo.reset()
  }

  const pickCategory = (c: ExpenseCategory) => {
    haptic.tap()
    setCategoryId(c.id)
    setAmountError(null)
    setSaveError(null)
    setSavedText(null)
    setDuplicate(false)
  }

  const scanReceipt = async () => {
    if (receiptBusy) return
    haptic.tap()
    setReceiptNotice(null)
    setReceiptUsed(false)
    const text = await scanQr(ta.scanText)
    if (text === null) return
    const qr = parseReceiptQr(text)
    if (!qr) {
      haptic.error()
      setReceiptNotice(ta.notReceiptQr)
      return
    }
    setReceiptBusy(true)
    let lookup: ReceiptLookup | null = null
    let rateLimited = false
    try {
      lookup = await receiptLookup(qr.url)
    } catch (err) {
      if (errorCodeOf(err) === 'receipt_url_invalid') {
        haptic.error()
        setReceiptNotice(ta.notReceiptQr)
        setReceiptBusy(false)
        return
      }
      rateLimited = errorCodeOf(err) === 'rate_limited'
    }
    setReceiptBusy(false)
    haptic.success()
    setReceipt({ qr, lookup })
    if (rateLimited) setReceiptNotice(t.errors.rate_limited)
    // Xarajat — butun chek: summa chek jamidan (bo'lmasa bitta qator summasi)
    const total = lookup?.total ?? (lookup?.items.length === 1 ? lookup.items[0]?.sum : null) ?? null
    if (total) {
      setAmount(formatSumInput(total.replace('.', ',')))
      setAmountError(null)
    }
  }

  const save = useCallback(
    async (opts: { withoutPhoto?: boolean; confirmDuplicate?: boolean } = {}) => {
      if (savingRef.current || preparingPhoto || !category) return
      const parsed = validateExpenseAmount(amount)
      const receiptDate = receipt?.lookup?.datetime ?? receipt?.qr.datetime ?? null
      const chosenDate = receiptDate ? null : entryDateFor(entryDate.choice, entryDate.other, new Date().toISOString(), isAdmin)
      if (chosenDate === undefined) {
        setDateError(entryDate.choice === 'other' && !entryDate.other ? t.tg.date.errRequired : t.tg.movement.errors.occurredAt)
      }
      if (!parsed.ok) setAmountError(parsed.error === 'required' ? 'amountRequired' : 'amountInvalid')
      if (!parsed.ok || chosenDate === undefined) {
        haptic.error()
        return
      }
      if (photoMissing) {
        // Tugma faol qoladi: bosilsa — chek rasmi maydoniga aylantiriladi
        haptic.error()
        scrollToPhotoField()
        return
      }
      const nowIso = new Date().toISOString()
      const draftId = draftIds.idFor(draftFingerprint([category.id, objectId, parsed.value]))
      // Takroriy xarajat — ogohlantirish, bloklamaydi
      if (!opts.confirmDuplicate) {
        const dup = findDuplicateExpense(
          recent
            .filter((e) => !e.deleted_at && e.created_by)
            .map((e) => ({
              id: e.id,
              createdBy: e.created_by ?? '',
              categoryId: e.category_id,
              objectId: e.object_id,
              amount: e.amount,
              createdAt: e.created_at,
            })),
          { id: draftId, createdBy: profile.id, categoryId: category.id, objectId, amount: parsed.value, createdAt: nowIso },
          settings.duplicateWindowMinutes,
        )
        if (dup) {
          setDuplicate(true)
          haptic.error()
          return
        }
      }
      setDuplicate(false)
      savingRef.current = true
      setSaving(true)
      setSaveError(null)
      setReceiptUsed(false)
      const receiptQr: PurchaseReceiptQr | null = receipt
        ? {
            fiscalSign: receipt.qr.fiscalSign,
            terminalId: receipt.qr.terminalId,
            receiptNo: receipt.qr.receiptNo,
            verified: receipt.lookup?.verified === true,
            total: receipt.lookup?.total ?? receipt.qr.total ?? null,
            sellerTin: receipt.lookup?.sellerTin ?? null,
          }
        : null
      try {
        const [receiptPhotoPath, geoFix] = await Promise.all([photo.resolvePath(companyId, opts.withoutPhoto), geo.get()])
        const row = await createExpense({
          id: draftId,
          companyId,
          categoryId: category.id,
          objectId,
          amount: parsed.value,
          note,
          payerId: profile.id,
          spentAt: receiptDate ?? chosenDate ?? null,
          supplierId: findByTin(suppliers, receipt?.lookup?.sellerTin)?.id ?? null,
          receiptPhotoPath,
          receipt: receiptQr,
          geo: geoFix,
        })
        // Chek rasmi xeshi — serverda, fonda (xato foydalanuvchiga ta'sir qilmaydi)
        if (receiptPhotoPath) void requestPhotoHash('expenses', row.id)
        haptic.success()
        flashMainButtonSaved()
        saveLastExpenseObject(objectId)
        setRecent((list) => [row, ...list.filter((e) => e.id !== row.id)].slice(0, RECENT_LIMIT))
        setUsage((list) => {
          const cur = list.find((u) => u.categoryId === category.id)
          const rest = list.filter((u) => u.categoryId !== category.id)
          return [...rest, { categoryId: category.id, useCount: (cur?.useCount ?? 0) + 1, lastUsedAt: nowIso }]
        })
        const objectName = objects?.find((o) => o.id === objectId)?.name ?? te.general
        setSavedText({ text: te.saved(row.category_name ?? category.name), meta: te.savedMeta(formatSum(row.amount), objectName) })
        onSaved()
        reset()
      } catch (err) {
        haptic.error()
        // Shu id bilan avval boshqa xarajat saqlangan — keyingi urinish yangi id bilan
        if (errorCodeOf(err) === 'draft_conflict') draftIds.renew()
        if (!photo.handleSaveError(err)) setSaveError(errorText(err))
        if (errorCodeOf(err) === 'receipt_already_used') setReceiptUsed(true)
        // Tur nofaol bo'lib qolgan — ro'yxat yangilanadi
        if (errorCodeOf(err) === 'expense_category_inactive') setReloadKey((k) => k + 1)
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    // reset — faqat setState va photo/geo (deps ichida)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [category, amount, receipt, entryDate, isAdmin, photoMissing, recent, draftIds, profile.id, objectId, settings.duplicateWindowMinutes, photo, geo, companyId, note, suppliers, objects, preparingPhoto, onSaved],
  )

  const onMain = useCallback(() => void save(), [save])
  const onDuplicate = useCallback(() => void save({ confirmDuplicate: true }), [save])
  const back = useCallback(() => {
    setCategoryId(null)
    setSaveError(null)
    setAmountError(null)
    photo.clearError()
  }, [photo])

  useBackButton(step === 'details' ? back : null)
  // Rasm majburiy, lekin tanlanmagan — tugma faol: bosilsa rasm maydoniga aylantiriladi (save)
  useMainButton(duplicate ? ta.duplicateSave : te.save, step === 'details' ? (duplicate ? onDuplicate : onMain) : null, preparingPhoto, saving)
  useClosingConfirmation(Boolean(categoryId) || amount.trim() !== '' || note.trim() !== '')
  const dirty = amount.trim() !== '' || note.trim() !== '' || photo.photo !== null
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  const insideTelegram = getWebApp() !== null

  const receiptView = receipt
    ? {
        receiptNo: receipt.qr.receiptNo,
        verified: qrVerified,
        total: receipt.lookup?.total ?? null,
        sellerName: receipt.lookup?.sellerName ?? null,
        datetime: receipt.lookup?.datetime ?? receipt.qr.datetime,
        items: [],
        lineIndex: null,
      }
    : null

  return (
    <div className="flex flex-col gap-4" data-testid="expense-entry">
      {savedText && <SavedBanner meta={savedText.meta}>{savedText.text}</SavedBanner>}
      {loadError && <RetryNotice message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />}
      {!loadError && (!categories || !objects) && <SkeletonRows rows={3} />}

      {categories && objects && step === 'category' && <CategoryGrid categories={ranked} onPick={pickCategory} />}

      {categories && objects && step === 'details' && category && (
        <section className="flex flex-col gap-4" aria-label={category.name}>
          <MaterialHeader name={category.name} onChange={back} />
          {receiptView && (
            <ReceiptCard
              receipt={receiptView}
              usedError={receiptUsed}
              onRemove={() => {
                haptic.select()
                setReceipt(null)
                setReceiptNotice(null)
                setReceiptUsed(false)
              }}
              onPickLine={() => undefined}
            />
          )}
          {!receiptView && scanAvailable && <ScanReceiptButton busy={receiptBusy} onScan={() => void scanReceipt()} />}
          {receiptNotice && <Notice tone="warn">{receiptNotice}</Notice>}

          <BigNumberInput
            id="expense-amount"
            label={te.amount}
            value={amount}
            inputMode="numeric"
            suffix={t.ui.sum}
            error={amountError ? te.errors[amountError] : null}
            onChange={(v) => {
              setAmount(formatSumInput(v))
              setAmountError(null)
              setDuplicate(false)
            }}
          />

          <ObjectChips
            objects={objects}
            value={objectId}
            onChange={(id) => {
              haptic.select()
              setObjectId(id)
              setDuplicate(false)
            }}
          />

          {!(receipt?.lookup?.datetime || receipt?.qr.datetime) && (
            <DateChips
              value={entryDate}
              isAdmin={isAdmin}
              error={dateError}
              onChange={(next) => {
                setEntryDate(next)
                setDateError(null)
              }}
            />
          )}

          <PhotoField
            label={te.photo}
            photo={photo.photo}
            busy={photo.preparing || saving}
            preparing={photo.preparing}
            notice={photo.notice}
            requiredReason={photoRequiredReason}
            onPick={(f) => void photo.pick(f)}
            onRemove={photo.remove}
          />

          <NoteField label={te.note} value={note} placeholder={te.notePlaceholder} onChange={setNote} />

          {duplicate && (
            <DuplicateWarning minutes={settings.duplicateWindowMinutes} busy={saving} onConfirm={onDuplicate} onCancel={() => setDuplicate(false)} />
          )}
          {saveError && <RetryNotice message={saveError} onRetry={onMain} />}
          {photo.error && (
            <PhotoErrorBox
              message={photo.error}
              busy={saving}
              onRetry={onMain}
              onWithoutPhoto={photoRequiredReason ? null : () => void save({ withoutPhoto: true })}
            />
          )}
          {!insideTelegram && (
            <Button size="lg" onClick={onMain} disabled={preparingPhoto} loading={saving}>
              {saving ? t.common.saving : te.save}
            </Button>
          )}
        </section>
      )}
    </div>
  )
}
