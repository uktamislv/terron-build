import { formatDate } from '@/lib/format'
import { t } from '@/i18n'

/** Bosh ekran sarlavhasi: sana va salomlashish (bitta matn tuguni — "Salom, Ism!"). */
export function Greeting({ name, sub }: { name: string | null; sub?: string }) {
  return (
    <header className="flex flex-col gap-0.5 pt-1">
      <p className="tabular text-sm text-muted">{formatDate(new Date())}</p>
      <h1 className="text-2xl leading-tight font-semibold tracking-tight text-ink">{`${t.tg.hello}${name ? `, ${name}` : ''}!`}</h1>
      {sub && <p className="text-sm text-muted">{sub}</p>}
    </header>
  )
}
