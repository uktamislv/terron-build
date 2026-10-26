import { useState, type FormEvent } from 'react'
import { Button, choiceClass, cx, Notice, TextField } from '@/components/ui'
import { addMaterialAlias, softDeleteMaterialAlias } from '@/data/materialAliasesRepo'
import { ALIAS_LANGS, type AliasLang, type Material } from '@/data/types'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { isAliasTaken } from './materialFilter'

const ta = t.materials.aliases

export function AliasesSection({
  material,
  materials,
  canManage,
  onChanged,
}: {
  material: Material
  /** Firmadagi barcha materiallar — dublikatni oldindan tekshirish uchun. */
  materials: readonly Material[]
  canManage: boolean
  onChanged: () => void
}) {
  const [alias, setAlias] = useState('')
  const [lang, setLang] = useState<AliasLang>('ru')
  const [aliasError, setAliasError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true)
    setError(null)
    try {
      await action()
      after?.()
      onChanged()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!alias.trim()) {
      setAliasError(ta.errAlias)
      return
    }
    // Baza baribir rad etadi (catalog_name_alias_conflict / unique) — oldindan tushunarli xabar.
    if (isAliasTaken(materials, alias)) {
      setAliasError(ta.errTaken)
      return
    }
    setAliasError(null)
    void run(
      () => addMaterialAlias({ companyId: material.company_id, materialId: material.id, alias, lang }),
      () => setAlias(''),
    )
  }

  return (
    <section aria-label={ta.title} className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold text-ink">{ta.title}</h3>
        <p className="text-xs text-muted">{ta.hint}</p>
      </div>
      {error && <Notice>{error}</Notice>}
      {material.aliases.length === 0 ? (
        <p className="text-sm text-muted">{ta.empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {material.aliases.map((a) => (
            <li
              key={a.id}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-paper pl-3 text-sm"
            >
              <span
                title={ta.langNames[a.lang]}
                className="rounded bg-canvas px-1.5 py-0.5 text-xs font-semibold uppercase text-muted"
              >
                {ta.langs[a.lang]}
              </span>
              <span className="text-ink">{a.alias}</span>
              {canManage ? (
                <button
                  type="button"
                  aria-label={`${t.materials.delete}: ${a.alias}`}
                  disabled={busy}
                  onClick={() => void run(() => softDeleteMaterialAlias(a.id))}
                  className="inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-danger-bg hover:text-danger disabled:opacity-60"
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              ) : (
                <span className="pr-3" />
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <TextField
            className="flex-1"
            label={ta.alias}
            placeholder={ta.aliasPlaceholder}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            error={aliasError}
          />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium text-muted">{ta.lang}</legend>
            <div className="flex gap-2">
              {ALIAS_LANGS.map((l) => (
                <label
                  key={l}
                  className={cx(choiceClass({ selected: lang === l, shape: 'box', label: true }), 'min-w-11')}
                >
                  <input
                    type="radio"
                    name="alias-lang"
                    className="sr-only"
                    checked={lang === l}
                    onChange={() => setLang(l)}
                    aria-label={ta.langNames[l]}
                  />
                  {ta.langs[l]}
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" disabled={busy} className="sm:mt-7">
            {ta.add}
          </Button>
        </form>
      )}
    </section>
  )
}
