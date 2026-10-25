import { CircleHelp, Printer } from 'lucide-react'
import { useAuth } from '@/auth/authContext'
import { GuideView } from '@/components/help/GuideView'
import { Button, PageHeader } from '@/components/ui'
import { t } from '@/i18n'
import { guides } from '@/i18n/guides.uz'

/** Veb "Yordam" (`/help`): o'z roli qo'llanmasi, boshqa rollar, chop etish (bir rol = bir A4). */
export function HelpPage() {
  const { profile } = useAuth()
  if (!profile) return null
  return (
    <div className="flex max-w-3xl flex-col gap-5 print:max-w-none">
      <PageHeader
        className="print:hidden"
        title={t.help.title}
        icon={<CircleHelp strokeWidth={1.75} />}
        actions={
          <Button variant="secondary" icon={<Printer aria-hidden className="size-5" strokeWidth={1.75} />} onClick={() => window.print()}>
            {t.help.print}
          </Button>
        }
      />
      <GuideView guides={guides} currentRole={profile.role} />
    </div>
  )
}
