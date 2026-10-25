// Smeta sahifalari uchun umumiy klasslar va yordamchilar.

/** Tanlash tugmasi (chip) klasslari — 44 px. */
export function chipClass(selected: boolean): string {
  return `inline-flex min-h-11 items-center justify-center rounded-xl border px-3 text-sm font-medium ${
    selected ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
  }`
}

/** Sahifadagi bo'lak: 100 tadan. */
export function pageSlice<T>(list: readonly T[], page: number, size: number): T[] {
  return list.slice(page * size, (page + 1) * size)
}
