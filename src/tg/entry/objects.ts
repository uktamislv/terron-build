import type { ObjectRow } from '@/data/types'

/** Oxirgi ishlatilgan obyekt birinchi, qolganlari kelgan tartibda (listObjects — nom bo'yicha). */
export function orderObjects(objects: ObjectRow[], lastUsed: string | null): ObjectRow[] {
  const last = objects.find((o) => o.id === lastUsed)
  return last ? [last, ...objects.filter((o) => o.id !== lastUsed)] : objects
}
