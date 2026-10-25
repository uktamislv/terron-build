import { Link } from 'react-router-dom'
import { t } from '@/i18n'

export function Forbidden({ text = t.forbidden.text, homePath = '/' }: { text?: string; homePath?: string | null }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-5xl font-bold text-danger">403</p>
      <h1 className="text-xl font-semibold">{t.forbidden.title}</h1>
      <p className="max-w-sm text-slate-600">{text}</p>
      {homePath && (
        <Link
          to={homePath}
          className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 font-medium text-white hover:bg-brand/90"
        >
          {t.notFound.toHome}
        </Link>
      )}
    </div>
  )
}
