// Bosh ekran "Bo'limlar": pastki menyuga sig'magan bandlar (masalan admin — "Sanash") va qo'shimcha
// bo'limlar ("Qoldiq", "So'rovlarni tasdiqlash"). Pastki menyu ≤ 5 band.
// Kirim/Chiqim plitkalari (yoki direktor kartochkalari) ostida — ixcham 2 ustunli plitkalar.
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Boxes, ClipboardCheck } from 'lucide-react'
import { countPendingRequests } from '@/data/requestsRepo'
import type { Role, TgNavKey } from '@/domain/roles'
import { t } from '@/i18n'
import { formatQty } from '@/lib/format'
import { useLoad } from '@/lib/useLoad'
import { tgNavIcons } from '../navIcons'
import { haptic } from '../telegram'
import { homeSectionLinks, type SectionLink } from './sections'

function iconOf(key: SectionLink['key']): ReactNode {
  if (key === 'stock') return <Boxes className="size-5" strokeWidth={1.75} />
  if (key === 'approvals') return <ClipboardCheck className="size-5" strokeWidth={1.75} />
  return tgNavIcons[key as TgNavKey]
}

export function HomeSections({ role }: { role: Role }) {
  const links = homeSectionLinks(role)
  const hasApprovals = links.some((l) => l.key === 'approvals')
  // Xato bo'lsa belgi ko'rsatilmaydi — bo'lim baribir ochiladi
  const pending = useLoad(() => Promise.resolve().then(() => countPendingRequests()), 'pending-requests', hasApprovals)
  return <HomeSectionsView links={links} pending={pending.data} />
}

export function HomeSectionsView({ links, pending }: { links: SectionLink[]; pending: number | null }) {
  if (links.length === 0) return null
  return (
    <nav aria-label={t.tg.sections.title}>
      <ul className="grid grid-cols-2 gap-2">
        {links.map((l) => {
          const badge = l.key === 'approvals' && pending !== null && pending > 0 ? pending : null
          return (
            <li key={l.key}>
              <Link
                to={l.to}
                onClick={haptic.tap}
                data-testid={`section-${l.key}`}
                className="flex min-h-13 items-center gap-2.5 rounded-xl border border-line bg-paper px-3 py-2 transition-colors hover:border-line-hover active:bg-ice"
              >
                <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-ice text-brand [&>svg]:size-5">
                  {iconOf(l.key)}
                </span>
                <span className="min-w-0 flex-1 text-sm leading-tight font-semibold text-ink">{l.label}</span>
                {badge !== null && (
                  <span className="tabular inline-flex min-w-6 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-xs font-semibold text-white">
                    {formatQty(String(badge))}
                    <span className="sr-only"> {t.tg.sections.pending}</span>
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
