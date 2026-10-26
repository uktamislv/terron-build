// Smeta sahifalari uchun umumiy yordamchilar. Tanlov tugmalari — umumiy `chipClass` / `choiceClass` (components/ui).

/** Sahifadagi bo'lak: 100 tadan. */
export function pageSlice<T>(list: readonly T[], page: number, size: number): T[] {
  return list.slice(page * size, (page + 1) * size)
}
