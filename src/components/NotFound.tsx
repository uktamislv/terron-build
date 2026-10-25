import { Link } from 'react-router-dom'
import { MapPinOff } from 'lucide-react'
import { EmptyState } from '@/components/ui'
import { t } from '@/i18n'

export function NotFound({ homePath = '/' }: { homePath?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-2">
      <div className="w-full max-w-md">
        <EmptyState
          titleAs="h1"
          icon={<MapPinOff strokeWidth={1.5} />}
          title={t.notFound.title}
          text="404"
          action={
            <Link
              to={homePath}
              className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-[#1a52e0]"
            >
              {t.notFound.toHome}
            </Link>
          }
        />
      </div>
    </div>
  )
}
