// Smeta versiyalari orasidagi farq (Batch 7). Sof funksiya, float yo'q.
import { normalizeAlias } from '../aliases'
import { add, cmp, div, isZero, mul, round, type Dec } from '../decimal'

export interface DiffItem {
  key: string
  name: string
  materialId: string | null
  /** Asosiy birlikda miqdor (material bo'lsa). */
  qtyBase: Dec | null
  /** Smetadagi miqdor (`unit` da). */
  qty: Dec
  unit: string
  price: Dec | null
  /** Qator summasi (`estimate_items.line_sum`) — bo'lsa jami shu bo'yicha. */
  lineSum?: Dec | null
  /**
   * Materialning asosiy birligi (`materials.base_unit`). Bir material turli birliklarda (т va кг)
   * kelganda guruh shu birlikda yig'iladi; berilmasa — birlik bo'yicha alohida guruhlar.
   */
  baseUnit?: string | null
}

export interface DiffChange {
  key: string
  name: string
  qtyBefore: Dec
  qtyAfter: Dec
  unitBefore: string
  unitAfter: string
  qtyBaseBefore: Dec | null
  qtyBaseAfter: Dec | null
  priceBefore: Dec | null
  priceAfter: Dec | null
}

export interface DiffResult {
  added: DiffItem[]
  removed: DiffItem[]
  changed: DiffChange[]
  unchangedCount: number
  /** Σ qty × price (narxsiz qatorlar 0), 2 xonaga yaxlitlangan. */
  totalBefore: Dec
  totalAfter: Dec
}

/** Guruhlangan narx aniqligi (so'm, 2 xona). */
const PRICE_SCALE = 2

/**
 * Taqqoslash kaliti: material — `m:{materialId}`; ish (yoki hali katalogga moslanmagan material) —
 * `w:{normalizeAlias(name)}|{normalizeAlias(unit)}`.
 */
export function diffKey(item: {
  itemType: 'ish' | 'material'
  materialId: string | null
  name: string
  unit: string
}): string {
  if (item.itemType === 'material' && item.materialId !== null && item.materialId !== '') {
    return `m:${item.materialId}`
  }
  return `w:${normalizeAlias(item.name)}|${normalizeAlias(item.unit)}`
}

/**
 * Kalit bo'yicha yig'ish usuli. Usul ikkala versiya uchun bitta (taqqoslash bir xil asosda bo'lsin):
 * - `same` — har versiya ichida qatorlar bitta birlikda (normallashtirilgan) — `qty` to'g'ridan-to'g'ri
 *   qo'shiladi (versiyalar orasida birlik farqi — `qtyBase` bo'yicha taqqoslanadi);
 * - `base` — biror versiya ichida birliklar turli, lekin har qatorda `qtyBase` va asosiy birlik ma'lum —
 *   asosiy birlikda;
 * - `split` — biror versiya ichida birliklar turli va asosiy birlikka keltirib bo'lmaydi — birlik bo'yicha
 *   alohida guruh (т va кг hech qachon bir songa qo'shilmaydi).
 */
type GroupMode = { kind: 'same' } | { kind: 'base'; baseUnit: string } | { kind: 'split' }

function groupModes(prev: DiffItem[], next: DiffItem[]): Map<string, GroupMode> {
  const byKey = new Map<string, DiffItem[]>()
  // Versiya ichidagi birliklar: `${side}|${key}` → normallashtirilgan birliklar
  const sideUnits = new Map<string, Set<string>>()
  for (const [side, list] of [['p', prev], ['n', next]] as const) {
    for (const it of list) {
      const rows = byKey.get(it.key)
      if (rows) rows.push(it)
      else byKey.set(it.key, [it])
      const sk = `${side}|${it.key}`
      const units = sideUnits.get(sk) ?? new Set<string>()
      units.add(normalizeAlias(it.unit))
      sideUnits.set(sk, units)
    }
  }
  const modes = new Map<string, GroupMode>()
  for (const [key, rows] of byKey) {
    const mixed = (sideUnits.get(`p|${key}`)?.size ?? 0) > 1 || (sideUnits.get(`n|${key}`)?.size ?? 0) > 1
    const baseUnit = rows.find((r) => r.baseUnit)?.baseUnit
    if (!mixed) modes.set(key, { kind: 'same' })
    else if (baseUnit && rows.every((r) => r.qtyBase !== null)) modes.set(key, { kind: 'base', baseUnit })
    else modes.set(key, { kind: 'split' })
  }
  return modes
}

/**
 * Bir xil kalitli qatorlarni bittaga yig'adi:
 * - `qty` — yig'indi; `qtyBase` — yig'indi (birortasi null bo'lsa — null);
 * - `name`, `unit`, `materialId` — birinchi qatorniki;
 * - `price` — miqdor bo'yicha og'irlikli o'rtacha: Σ(qty × price) / Σqty narxi bor qatorlar bo'yicha,
 *   2 xonaga (half away from zero); narxi bor qator yo'q bo'lsa — null. Bitta qator — o'z narxi o'zgarishsiz.
 * - `base` usulida: `qty` = Σ qtyBase, `unit` = asosiy birlik, `price` = Σ line_sum (yo'q bo'lsa qty × price)
 *   / Σ qtyBase — asosiy birlik narxi, 2 xonaga.
 * - `split` usulida kalitga normallashtirilgan birlik qo'shiladi (`m:id|т`).
 */
function group(items: DiffItem[], modes: Map<string, GroupMode>): Map<string, DiffItem> {
  const acc = new Map<
    string,
    { item: DiffItem; amount: Dec; pricedQty: Dec; priced: number; lastPrice: Dec | null; base: boolean }
  >()
  for (const raw of items) {
    const mode = modes.get(raw.key) ?? { kind: 'same' }
    const base = mode.kind === 'base' && raw.qtyBase !== null
    let it: DiffItem
    let amount: Dec
    let pricedQty: Dec
    let hasPrice: boolean
    if (mode.kind === 'base' && raw.qtyBase !== null) {
      const sum = raw.lineSum ?? (raw.price === null ? null : mul(raw.qty, raw.price))
      hasPrice = sum !== null
      amount = sum ?? '0'
      pricedQty = hasPrice ? raw.qtyBase : '0'
      it = { ...raw, qty: raw.qtyBase, unit: mode.baseUnit, price: null }
    } else {
      it = mode.kind === 'split' ? { ...raw, key: `${raw.key}|${normalizeAlias(raw.unit)}` } : raw
      hasPrice = raw.price !== null
      amount = raw.price === null ? '0' : mul(raw.qty, raw.price)
      pricedQty = raw.price === null ? '0' : raw.qty
    }
    const g = acc.get(it.key)
    if (!g) {
      acc.set(it.key, { item: { ...it }, amount, pricedQty, priced: hasPrice ? 1 : 0, lastPrice: it.price, base })
      continue
    }
    g.item.qty = add(g.item.qty, it.qty)
    g.item.qtyBase = g.item.qtyBase === null || it.qtyBase === null ? null : add(g.item.qtyBase, it.qtyBase)
    g.amount = add(g.amount, amount)
    g.pricedQty = add(g.pricedQty, pricedQty)
    if (hasPrice) {
      g.priced++
      g.lastPrice = it.price
    }
  }
  const out = new Map<string, DiffItem>()
  for (const [key, g] of acc) {
    let price: Dec | null
    if (g.priced === 0) price = null
    else if (g.base) price = isZero(g.pricedQty) ? null : div(g.amount, g.pricedQty, PRICE_SCALE)
    else if (g.priced === 1) price = g.lastPrice
    else price = isZero(g.pricedQty) ? g.lastPrice : div(g.amount, g.pricedQty, PRICE_SCALE)
    out.set(key, { ...g.item, price })
  }
  return out
}

function total(items: DiffItem[]): Dec {
  let t: Dec = '0'
  for (const it of items) {
    if (it.lineSum !== undefined && it.lineSum !== null) t = add(t, it.lineSum)
    else if (it.price !== null) t = add(t, round(mul(it.qty, it.price), PRICE_SCALE))
  }
  return round(t, PRICE_SCALE)
}

function decEq(a: Dec | null, b: Dec | null): boolean {
  if (a === null || b === null) return a === b
  return cmp(a, b) === 0
}

/**
 * Avvalgi (`prev`) va yangi (`next`) versiyani taqqoslaydi (kalit bo'yicha guruhlab).
 * O'zgargan: miqdor — ikkala tomonda `qtyBase` bo'lsa shu bo'yicha (birlik farqi muhim emas),
 * aks holda `qty` va normallashtirilgan `unit` bo'yicha; yoki narx farq qilsa.
 * Tartib: `added`, `changed` — `next` dagi birinchi uchrash tartibida, `removed` — `prev` dagi.
 * Jami — guruhlashdan oldingi qatorlar bo'yicha Σ qty × price, 2 xonaga.
 */
export function diffEstimates(prev: DiffItem[], next: DiffItem[]): DiffResult {
  const modes = groupModes(prev, next)
  const before = group(prev, modes)
  const after = group(next, modes)
  const added: DiffItem[] = []
  const removed: DiffItem[] = []
  const changed: DiffChange[] = []
  let unchangedCount = 0

  for (const [key, a] of after) {
    const b = before.get(key)
    if (!b) {
      added.push(a)
      continue
    }
    const qtySame =
      b.qtyBase !== null && a.qtyBase !== null
        ? cmp(b.qtyBase, a.qtyBase) === 0
        : cmp(b.qty, a.qty) === 0 && normalizeAlias(b.unit) === normalizeAlias(a.unit)
    if (qtySame && decEq(b.price, a.price)) {
      unchangedCount++
      continue
    }
    changed.push({
      key,
      name: a.name,
      qtyBefore: b.qty,
      qtyAfter: a.qty,
      unitBefore: b.unit,
      unitAfter: a.unit,
      qtyBaseBefore: b.qtyBase,
      qtyBaseAfter: a.qtyBase,
      priceBefore: b.price,
      priceAfter: a.price,
    })
  }
  for (const [key, b] of before) if (!after.has(key)) removed.push(b)

  return { added, removed, changed, unchangedCount, totalBefore: total(prev), totalAfter: total(next) }
}
