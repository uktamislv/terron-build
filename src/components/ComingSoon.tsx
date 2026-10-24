import { t } from '@/i18n'

export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="rounded-2xl border border-brand-light bg-brand-light/50 p-6">
      <h2 className="text-lg font-semibold text-brand-dark">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">
        {t.common.soon}. {t.common.soonHint}
      </p>
    </div>
  )
}
