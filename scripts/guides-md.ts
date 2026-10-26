// docs/qollanma/*.md ni src/i18n/guides.uz.ts dan qayta yaratadi: `npm run guides:md`.
// Node (type stripping) bilan to'g'ridan-to'g'ri ishlaydi.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { guideMarkdownFiles } from '../src/i18n/guidesMarkdown.ts'

const dir = join(import.meta.dirname, '..', 'docs', 'qollanma')
mkdirSync(dir, { recursive: true })
for (const [name, content] of Object.entries(guideMarkdownFiles())) {
  writeFileSync(join(dir, name), content)
  console.log(`docs/qollanma/${name}`)
}
