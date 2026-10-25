// Material muqobil nomlari (material_aliases) va nom bo'yicha moslash (smeta importi, Batch 7).

// Bazadagi private.norm_name bilan aynan bir xil bo'sh joy ro'yxati (JS `\s` emas, u
// boshqa Unicode probellarini ham qamraydi): probel, \t, \n, \r, NBSP, tor NBSP, raqam probeli.
const NORM_SPACE_RUN = /[ \t\n\r\u00A0\u202F\u2007]+/g
const EDGE_SPACES = /^ +| +$/g

// PostgreSQL lower() har belgini alohida (oddiy moslik bilan) kichraytiradi: kontekstga bog'liq
// qoidalar yo'q (yakuniy sigma "Σ" → "σ", "ς" emas) va "İ" (U+0130) → "i" (JS toLowerCase
// unga "i" + birikuvchi nuqta beradi).
const CAPITAL_I_WITH_DOT = String.fromCodePoint(0x130)
// Faqat harflar va harfli raqamlar (Ⅻ) kichraytiriladi; belgilar (masalan "Ⓐ", So) — yo'q.
const LOWERABLE = /^[\p{L}\p{Nl}]$/u
function lowerSimple(ch: string): string {
  if (ch === CAPITAL_I_WITH_DOT) return 'i'
  return LOWERABLE.test(ch) ? ch.toLowerCase() : ch
}

/**
 * Taqqoslash uchun normal shakl, bazadagi `private.norm_name(text)` ning aynan nusxasi:
 *   lower(translate(btrim(regexp_replace(p, '[ \t\n\r\u00A0\u202F\u2007]+', ' ', 'g'), ' '), 'ёЁ', 'еЕ'))
 * Ya'ni: bo'sh joy ketma-ketligi → bitta probel, chetdagi probellar kesiladi, ё→е, Ё→Е, kichik harf.
 * Lotin/kirill o'xshash harflar (masalan lotin "M" va kirill "М") o'zgartirilmaydi.
 */
export function normalizeAlias(s: string): string {
  const t = s
    .replace(NORM_SPACE_RUN, ' ')
    .replace(EDGE_SPACES, '')
    .replace(/ё/g, 'е')
    .replace(/Ё/g, 'Е')
  return Array.from(t, lowerSimple).join('')
}

/** So'zlar: harf va raqamlar ketma-ketligi ("м500", "ø12", "30×30" → "30", "30"). */
function tokens(s: string): string[] {
  return normalizeAlias(s).match(/[\p{L}\p{N}]+/gu) ?? []
}

const HAS_DIGIT = /\p{N}/u

/** Qisman moslik aniq moslikdan (1) doim past bo'lishi uchun koeffitsient. */
const PARTIAL_WEIGHT = 0.9

function partialScore(query: string[], candidate: string[]): number {
  if (query.length === 0 || candidate.length === 0) return 0
  const q = new Set(query)
  const c = new Set(candidate)
  // Marka va o'lchamlar (raqamli so'zlar) saqlanadi: ikkala tomonda ham raqamli so'z bo'lsa,
  // kamida bittasi mos kelishi shart — "Цемент М400" "Цемент М500" ga mos emas.
  const qNum = [...q].filter((t) => HAS_DIGIT.test(t))
  const cNum = [...c].filter((t) => HAS_DIGIT.test(t))
  if (qNum.length > 0 && cNum.length > 0 && !qNum.some((t) => c.has(t))) return 0
  let common = 0
  for (const t of q) if (c.has(t)) common++
  if (common === 0) return 0
  const union = q.size + c.size - common
  return (common / union) * PARTIAL_WEIGHT
}

/**
 * Nom bo'yicha materiallarni moslaydi. Aniq moslik (normalizeAlias bo'yicha nom yoki
 * muqobil nom) — score 1; aks holda so'zlar kesishmasi (Jaccard × 0.9, marka qoidasi bilan).
 * Natija score bo'yicha kamayish tartibida (teng bo'lsa — kirish tartibida), 0 lar chiqarilmaydi.
 */
export function matchMaterialByName(
  name: string,
  materials: { id: string; name: string; aliases: string[] }[],
): { id: string; score: number }[] {
  const qNorm = normalizeAlias(name)
  if (qNorm === '') return []
  const qTokens = tokens(name)
  const result: { id: string; score: number; order: number }[] = []
  materials.forEach((m, order) => {
    const names = [m.name, ...m.aliases]
    let score = 0
    for (const n of names) {
      if (normalizeAlias(n) === qNorm) {
        score = 1
        break
      }
      score = Math.max(score, partialScore(qTokens, tokens(n)))
    }
    if (score > 0) result.push({ id: m.id, score, order })
  })
  result.sort((a, b) => b.score - a.score || a.order - b.order)
  return result.map(({ id, score }) => ({ id, score }))
}
