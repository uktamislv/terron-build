// "Tarix" havolasi — boshqa sahifalar ham import qiladi, shuning uchun og'ir bog'liqliklarsiz.

/** Bitta yozuvning butun tarixi: `/history?record=<id>&table=<jadval>`. */
export function historyHref(table: string | null, recordId: string): string {
  const p = new URLSearchParams()
  p.set('record', recordId)
  if (table) p.set('table', table)
  return `/history?${p.toString()}`
}
