// Sozlamalar → "Xarajat turlari" (admin): qo'shish, nomini o'zgartirish, oylik limit (so'm, ixtiyoriy),
// "rasm majburiy", faol/nofaol va tartib. Har tur uchun shu oydagi sarf limit bilan (LevelBar).
// Shu oy sarfi — `spend_breakdown(p_group = 'category')`, Toshkent oyi.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Camera, PencilLine, Plus, Receipt } from 'lucide-react'
import { Badge, Button, Checkbox, EmptyState, IconButton, LevelBar, Modal, Notice, RetryNotice, SkeletonRows, TextField } from '@/components/ui'
import {
  createExpenseCategory,
  EXPENSE_CATEGORY_NAME_MAX,
  listExpenseCategories,
  sortOrderPatches,
  updateExpenseCategory,
} from '@/data/expenseCategoriesRepo'
import { errorCodeOf } from '@/data/errors'
import { getSpendBreakdown } from '@/data/reportsRepo'
import type { ExpenseCategory } from '@/data/types'
import { formatSumInput } from '@/domain/cash'
import { limitStatus, parseMonthlyLimit, tashkentMonthRange } from '@/domain/expenses'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatSum } from '@/lib/format'

const tc = t.expenses.categories
const ic = { className: 'size-5', strokeWidth: 1.75, 'aria-hidden': true } as const

export function ExpenseCategoriesTab({ companyId, canEdit }: { companyId: string; canEdit: boolean }) {
  const [rows, setRows] = useState<ExpenseCategory[] | null>(null)
  const [spent, setSpent] = useState<Map<string, string> | null>(null)
  const [spentError, setSpentError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    listExpenseCategories()
      .then((list) => {
        if (!alive) return
        setRows(list.filter((c) => c.company_id === companyId))
        setError(null)
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    const month = tashkentMonthRange(new Date().toISOString())
    Promise.resolve()
      .then(() => getSpendBreakdown({ from: month.from, to: month.to }, 'category'))
      .then((list) => {
        if (!alive) return
        setSpent(new Map(list.filter((r) => r.key).map((r) => [r.key as string, r.expenses_sum])))
        setSpentError(false)
      })
      .catch(() => alive && setSpentError(true))
    return () => {
      alive = false
    }
  }, [companyId, reloadKey])

  const run = async (id: string, action: () => Promise<unknown>, text: string = tc.saved) => {
    setBusyId(id)
    setActionError(null)
    try {
      await action()
      setNotice(text)
      reload()
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusyId(null)
    }
  }

  /**
   * Qo'shni bilan tartibni almashtirish. Bazadagi sort_order takror yoki bo'shliqli bo'lishi mumkin —
   * shuning uchun har siljitishda barcha turlarning tartibi 1..n qilib qayta yoziladi.
   */
  const move = (index: number, dir: -1 | 1) => {
    if (!rows) return
    const a = rows[index]
    const b = rows[index + dir]
    if (!a || !b) return
    const ordered = [...rows]
    ordered[index] = b
    ordered[index + dir] = a
    // Ketma-ket: xato bo'lsa — to'xtaydi, xato ko'rsatiladi va ro'yxat bazadagi holatdan qayta yuklanadi
    void run(a.id, async () => {
      try {
        for (const p of sortOrderPatches(ordered)) await updateExpenseCategory(p.id, { sortOrder: p.sortOrder })
      } catch (err) {
        reload()
        throw err
      }
    })
  }

  return (
    <section aria-label={tc.title} className="flex flex-col gap-4" data-testid="expense-categories">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-ink">{tc.title}</h2>
          <p className="text-sm text-muted">{tc.intro}</p>
        </div>
        {canEdit && (
          <Button icon={<Plus {...ic} />} onClick={() => setEditing('new')}>
            {tc.add}
          </Button>
        )}
      </div>
      {!canEdit && <Notice tone="info">{tc.readOnly}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}
      {actionError && <Notice>{actionError}</Notice>}
      {spentError && <Notice tone="warn">{tc.usageError}</Notice>}
      {error && <RetryNotice message={error} onRetry={reload} />}
      {!rows && !error && <SkeletonRows rows={4} />}
      {rows && rows.length === 0 && <EmptyState icon={<Receipt strokeWidth={1.5} />} title={tc.empty} />}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((c, i) => {
            const used = spent?.get(c.id) ?? '0'
            const status = limitStatus(used, c.monthly_limit)
            return (
              <li
                key={c.id}
                data-testid="expense-category-row"
                className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-3 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={c.is_active ? 'font-semibold text-ink' : 'font-semibold text-muted'}>{c.name}</span>
                    {!c.is_active && <Badge tone="neutral">{tc.inactive}</Badge>}
                    {c.photo_required && (
                      <Badge tone="info" icon={<Camera aria-hidden strokeWidth={2} />}>
                        {tc.photoRequired}
                      </Badge>
                    )}
                  </div>
                  {c.monthly_limit ? (
                    <>
                      <span className="tabular text-sm text-muted">{tc.spentOfLimit(formatSum(used), formatSum(c.monthly_limit))}</span>
                      <LevelBar value={Number(used) || 0} max={Number(c.monthly_limit) || 0} label={c.name} size="sm" className="max-w-sm" />
                      {status?.over && <span className="text-sm font-semibold text-danger">{tc.overLimit(formatSum(status.overBy))}</span>}
                    </>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                      <span className="tabular">{tc.spentNoLimit(formatSum(used))}</span>
                      <Badge tone="neutral">{tc.noLimit}</Badge>
                    </span>
                  )}
                </div>
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-1">
                    <IconButton label={tc.moveUp(c.name)} icon={<ArrowUp {...ic} />} disabled={i === 0 || busyId !== null} onClick={() => move(i, -1)} />
                    <IconButton
                      label={tc.moveDown(c.name)}
                      icon={<ArrowDown {...ic} />}
                      disabled={i === rows.length - 1 || busyId !== null}
                      onClick={() => move(i, 1)}
                    />
                    <Button variant="ghost" size="sm" icon={<PencilLine {...ic} />} onClick={() => setEditing(c)}>
                      {tc.edit}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busyId === c.id}
                      onClick={() => void run(c.id, () => updateExpenseCategory(c.id, { isActive: !c.is_active }))}
                    >
                      {c.is_active ? tc.deactivate : tc.activate}
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {editing && (
        <CategoryDialog
          companyId={companyId}
          category={editing === 'new' ? null : editing}
          nextOrder={(rows?.length ?? 0) + 1}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setNotice(tc.saved)
            reload()
          }}
        />
      )}
    </section>
  )
}

function CategoryDialog({
  companyId,
  category,
  nextOrder,
  onClose,
  onSaved,
}: {
  companyId: string
  category: ExpenseCategory | null
  nextOrder: number
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [limit, setLimit] = useState(category?.monthly_limit ? formatSumInput(category.monthly_limit.replace('.', ',')) : '')
  const [photoRequired, setPhotoRequired] = useState(category?.photo_required ?? false)
  const [errors, setErrors] = useState<{ name?: string; limit?: string }>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    const next: { name?: string; limit?: string } = {}
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > EXPENSE_CATEGORY_NAME_MAX) next.name = tc.errName
    const parsed = parseMonthlyLimit(limit)
    if (!parsed.ok) next.limit = tc.errLimit
    setErrors(next)
    if (next.name || !parsed.ok) return
    setSaving(true)
    setSaveError(null)
    try {
      if (category) await updateExpenseCategory(category.id, { name: trimmed, monthlyLimit: parsed.value, photoRequired })
      else await createExpenseCategory({ companyId, name: trimmed, monthlyLimit: parsed.value, photoRequired, sortOrder: nextOrder })
      onSaved()
    } catch (err) {
      if (errorCodeOf(err) === 'expense_category_duplicate') setErrors({ name: tc.errNameTaken })
      else setSaveError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={category ? tc.editTitle : tc.addTitle} onClose={onClose}>
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <TextField
          label={tc.name}
          value={name}
          maxLength={EXPENSE_CATEGORY_NAME_MAX}
          placeholder={tc.namePlaceholder}
          error={errors.name ?? null}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label={tc.monthlyLimit}
          inputMode="numeric"
          autoComplete="off"
          value={limit}
          suffix={t.ui.sum}
          hint={tc.monthlyLimitHint}
          error={errors.limit ?? null}
          onChange={(e) => setLimit(formatSumInput(e.target.value))}
        />
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-paper px-3 py-2.5">
          <Checkbox checked={photoRequired} onChange={(e) => setPhotoRequired(e.target.checked)} className="mt-0.5" />
          <span className="flex flex-col">
            <span className="text-sm font-medium text-ink">{tc.photoRequired}</span>
            <span className="text-xs text-muted">{tc.photoRequiredHint}</span>
          </span>
        </label>
        {saveError && <Notice>{saveError}</Notice>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" loading={saving} disabled={saving}>
            {saving ? t.common.saving : t.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
