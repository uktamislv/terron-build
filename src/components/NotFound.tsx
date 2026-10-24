import { Link } from 'react-router-dom'
import { t } from '@/i18n'

export function NotFound({ homePath = '/' }: { homePath?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-5xl font-bold text-brand">404</p>
      <h1 className="text-xl font-semibold">{t.notFound.title}</h1>
      <Link
        to={homePath}
        className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 font-medium text-white hover:bg-brand/90"
      >
        {t.notFound.toHome}
      </Link>
    </div>
  )
}
