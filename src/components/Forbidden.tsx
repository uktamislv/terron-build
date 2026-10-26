import { useNavigate } from 'react-router-dom'
import { ShieldX } from 'lucide-react'
import { Button, EmptyState } from '@/components/ui'
import { t } from '@/i18n'

export function Forbidden({ text = t.forbidden.text, homePath = '/' }: { text?: string; homePath?: string | null }) {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-2">
      <div className="w-full max-w-md">
        <EmptyState
          titleAs="h1"
          tone="danger"
          icon={<ShieldX strokeWidth={1.5} />}
          title={t.forbidden.title}
          text={text}
          action={homePath && <Button onClick={() => navigate(homePath)}>{t.notFound.toHome}</Button>}
        />
      </div>
    </div>
  )
}
