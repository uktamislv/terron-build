import { Hourglass } from 'lucide-react'
import { EmptyState, PageHeader } from '@/components/ui'
import { t } from '@/i18n'

export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={title} />
      <EmptyState icon={<Hourglass strokeWidth={1.5} />} title={t.common.soon} text={t.common.soonHint} />
    </div>
  )
}
