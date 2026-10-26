import { useNavigate } from 'react-router'
import { MapPinOff } from 'lucide-react'
import { Button, EmptyState } from '@/components/ui'
import { t } from '@/i18n'

export function NotFound({ homePath = '/' }: { homePath?: string }) {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-2">
      <div className="w-full max-w-md">
        <EmptyState
          titleAs="h1"
          icon={<MapPinOff strokeWidth={1.5} />}
          title={t.notFound.title}
          text="404"
          action={<Button onClick={() => navigate(homePath)}>{t.notFound.toHome}</Button>}
        />
      </div>
    </div>
  )
}
