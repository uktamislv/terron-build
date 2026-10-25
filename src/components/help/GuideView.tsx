import { useState, type ReactNode } from 'react'
import { BookOpen } from 'lucide-react'
import { chipClass, EmptyState } from '@/components/ui'
import { ROLES, type Role } from '@/domain/roles'
import { t } from '@/i18n'
import { guideHeadings, type RoleGuide } from '@/i18n/guides.uz'

const th = t.help

/** Almashtirgichdagi rollar: qo'llanmasi borlar; tizim egasi — faqat o'zi uchun. */
function guideRoles(guides: Partial<Record<Role, RoleGuide>>, current: Role): Role[] {
  return ROLES.filter((r) => Boolean(guides[r]) && (r !== 'super_admin' || current === 'super_admin'))
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="guide-section flex flex-col gap-2">
      <h3 className="text-base font-semibold text-navy">{title}</h3>
      {children}
    </section>
  )
}

/** Bitta rol qo'llanmasi (chop etishda — bir A4 sahifa, `.guide-print`). */
export function GuideArticle({ guide }: { guide: RoleGuide }) {
  return (
    <article className="guide-print flex flex-col gap-5 rounded-2xl border border-line bg-paper p-4 md:p-6 print:rounded-none print:border-0 print:p-0">
      <h2 className="text-xl font-semibold tracking-tight text-ink">{guide.title}</h2>
      <Section title={guideHeadings.intro}>
        <p className="text-sm text-ink">{guide.intro}</p>
      </Section>
      <Section title={guideHeadings.daily}>
        <div className="flex flex-col gap-3">
          {guide.daily.map((d) => (
            <div key={d.title} className="flex flex-col gap-1">
              <h4 className="text-sm font-semibold text-ink">{d.title}</h4>
              <ol className="ml-5 flex list-decimal flex-col gap-1 text-sm text-ink marker:text-muted">
                {d.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Section>
      {guide.rules.length > 0 && (
        <Section title={guideHeadings.rules}>
          <ul className="ml-5 flex list-disc flex-col gap-1 text-sm text-ink marker:text-muted">
            {guide.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Section>
      )}
      {guide.alerts.length > 0 && (
        <Section title={guideHeadings.alerts}>
          <dl className="flex flex-col gap-2">
            {guide.alerts.map((a) => (
              <div key={a.name} className="guide-alert rounded-xl border border-line p-3 text-sm print:rounded-none print:border-0 print:p-0">
                <dt className="font-semibold text-ink">{a.name}</dt>
                <dd className="text-ink">
                  <span className="text-muted">{th.alertMeaning}: </span>
                  {a.meaning}
                </dd>
                <dd className="text-ink">
                  <span className="text-muted">{th.alertWhatToDo}: </span>
                  {a.whatToDo}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
      <Section title={guideHeadings.help}>
        <p className="text-sm text-ink">{guide.help}</p>
      </Section>
    </article>
  )
}

/** Qo'llanma: joriy rol sahifasi va boshqa rollarga almashtirgich (chop etishda yashirin). */
export function GuideView({ guides, currentRole }: { guides: Partial<Record<Role, RoleGuide>>; currentRole: Role }) {
  const [role, setRole] = useState<Role>(currentRole)
  const roles = guideRoles(guides, currentRole)
  const guide = guides[role]
  return (
    <div className="flex flex-col gap-4">
      {roles.length > 1 && (
        <div role="group" aria-label={th.roleSwitch} className="flex flex-col gap-2 print:hidden">
          <span className="text-sm font-medium text-ink">{th.roleSwitch}</span>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
            {roles.map((r) => (
              <button key={r} type="button" aria-pressed={r === role} className={chipClass(r === role)} onClick={() => setRole(r)}>
                {t.roles[r]}
                {r === currentRole && <span className="text-xs text-muted">({th.yourRole})</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {guide ? <GuideArticle guide={guide} /> : <EmptyState icon={<BookOpen strokeWidth={1.5} />} title={th.unavailable} />}
    </div>
  )
}
