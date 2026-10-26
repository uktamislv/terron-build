// Bosh ekran "Bo'limlar": pastki menyuga sig'magan bandlar (masalan admin — "Sanash") va qo'shimcha
// bo'limlar ("Qoldiq", "So'rovlarni tasdiqlash"). Pastki menyu ≤ 5 band.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, ChevronRight, ClipboardCheck } from 'lucide-react'
import type { Role, TgNavKey } from '@/domain/roles'
import { t } from '@/i18n'
import { tgNavIcons } from '../navIcons'
import { haptic } from '../telegram'
import { SectionTitle } from '../ui'
import { homeSectionLinks, type SectionLink } from './sections'

function iconOf(key: SectionLink['key']): ReactNode {
  if (key === 'stock') return <Boxes className="size-6" strokeWidth={1.75} />
  if (key === 'approvals') return <ClipboardCheck className="size-6" strokeWidth={1.75} />
  return tgNavIcons[key as TgNavKey]
}

export function HomeSections({ role }: { role: Role }) {
  const links = homeSectionLinks(role)
  if (links.length === 0) return null
  return (
    <section aria-label={t.tg.sections.title} className="flex flex-col gap-2">
      <SectionTitle>{t.tg.sections.title}</SectionTitle>
      <ul className="grid gap-2">
        {links.map((l) => (
          <li key={l.key}>
            <Link
              to={l.to}
              onClick={haptic.tap}
              className="flex min-h-14 items-center gap-3 rounded-xl border border-line bg-paper px-4 py-2 transition-colors hover:border-line-hover active:bg-ice"
            >
              <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-ice text-brand [&>svg]:size-6">
                {iconOf(l.key)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-base font-semibold text-ink">{l.label}</span>
                {l.hint && <span className="text-sm text-muted">{l.hint}</span>}
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" strokeWidth={1.75} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
