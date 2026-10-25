// Smeta sahifalari uchun umumiy klasslar va yordamchilar.

/** Tanlash tugmasi (chip) klasslari — 44 px. Tanlangan — to'liq ko'k (tanlov aniq ko'rinsin). */
export function chipClass(selected: boolean): string {
  return `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors ${
    selected ? 'border-brand bg-brand text-white' : 'border-line bg-paper text-ink hover:border-brand/40 hover:bg-ice/50'
  }`
}

/** Sahifadagi bo'lak: 100 tadan. */
export function pageSlice<T>(list: readonly T[], page: number, size: number): T[] {
  return list.slice(page * size, (page + 1) * size)
}
