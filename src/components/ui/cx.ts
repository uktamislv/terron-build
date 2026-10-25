/** Tailwind klasslarini birlashtirish (falsy qiymatlar tashlanadi). */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
