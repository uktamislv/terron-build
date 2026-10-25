import { Link } from 'react-router-dom'
import { ShieldX } from 'lucide-react'
import { EmptyState } from '@/components/ui'
import { t } from '@/i18n'

export function Forbidden({ text = t.forbidden.text, homePath = '/' }: { text?: string; homePath?: string | null }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-2">
      <div className="w-full max-w-md">
        <EmptyState
          titleAs="h1"
          tone="danger"
          icon={<ShieldX strokeWidth={1.5} />}
          title={t.forbidden.title}
          text={text}
          action={
            homePath && (
              <Link
                to={homePath}
                className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-[#1a52e0]"
              >
                {t.notFound.toHome}
              </Link>
            )
          }
        />
      </div>
    </div>
  )
}
