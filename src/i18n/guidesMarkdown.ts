// docs/qollanma/*.md — `guides.uz.ts` dan yaratiladi (yagona manba). Qo'lda tahrirlanmaydi:
// `npm run guides:md` (scripts/guides-md.ts) qayta yozadi, test (guidesMarkdown.test.ts) farqni ushlaydi.
// Faqat nisbiy import (`.ts` bilan) — skript Node'da to'g'ridan-to'g'ri ishlaydi (alias yo'q).
import { guideHeadings as h, guides, type RoleGuide } from './guides.uz.ts'

/** Fayllar tartibi (README jadvali). super_admin — alohida fayl yo'q (admin qo'llanmasi). */
export const GUIDE_FILE_ROLES = ['admin', 'direktor', 'buxgalter', 'taminotchi', 'prorab', 'omborchi', 'haydovchi', 'tekshiruvchi'] as const

/** Jadval katagi: "|" va qator uzilishi jadvalni buzmasin. */
function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
}

export function guideMarkdown(g: RoleGuide): string {
  const lines: string[] = [`# ${g.title}`, '', `## ${h.intro}`, '', g.intro, '', `## ${h.daily}`, '']
  for (const d of g.daily) {
    lines.push(`### ${d.title}`, '')
    d.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
    lines.push('')
  }
  lines.push(`## ${h.rules}`, '')
  for (const r of g.rules) lines.push(`- ${r}`)
  lines.push('', `## ${h.alerts}`, '', '| Ogohlantirish | Nimani anglatadi | Nima qilish kerak |', '|---|---|---|')
  for (const a of g.alerts) lines.push(`| ${cell(a.name)} | ${cell(a.meaning)} | ${cell(a.whatToDo)} |`)
  lines.push('', `## ${h.help}`, '', g.help, '')
  return lines.join('\n')
}

export function guidesReadme(): string {
  const lines = [
    '# TERRON Build — qo‘llanmalar',
    '',
    'Har bir rol uchun bir sahifalik qo‘llanma. Matn manbasi — `src/i18n/guides.uz.ts`; bu fayllar `npm run guides:md` bilan yaratiladi (qo‘lda tahrirlanmaydi).',
    '',
    '| Rol | Fayl |',
    '|---|---|',
  ]
  for (const role of GUIDE_FILE_ROLES) lines.push(`| ${guides[role].title.replace(' uchun qo‘llanma', '')} | [${role}.md](${role}.md) |`)
  lines.push('', 'Tizim egasi (super_admin) uchun alohida fayl yo‘q — admin qo‘llanmasidan foydalaniladi.', '')
  return lines.join('\n')
}

/** Fayl nomi → mazmun (docs/qollanma ichida). */
export function guideMarkdownFiles(): Record<string, string> {
  const out: Record<string, string> = { 'README.md': guidesReadme() }
  for (const role of GUIDE_FILE_ROLES) out[`${role}.md`] = guideMarkdown(guides[role])
  return out
}
