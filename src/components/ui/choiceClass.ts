import { cx } from './cx'

/**
 * Tanlov tugmasi shakli:
 * - pill — chip (filtr, birlik, sotuvchi), radius 999;
 * - box — to'r ichidagi radio-tugma (rol, holat, til), radius 12, markazda;
 * - stack — ikki qatorli variant (nom + kichik izoh, masalan "Ertaga / 27.10.2026"), 52 px;
 * - tile — katta plitka (material), ustma-ust nom va izoh;
 * - row — ro'yxat qatori (checkbox/radio + matn, obyekt).
 */
export type ChoiceShape = 'pill' | 'box' | 'stack' | 'tile' | 'row'
/** Tanlangan holat rangi (odatda brand; sanalgan/joyida — ok; xavfli tanlov — danger). */
export type ChoiceTone = 'brand' | 'ok' | 'danger'

const selectedTone: Record<ChoiceTone, string> = {
  brand: 'border-brand bg-ice text-brand',
  ok: 'border-ok bg-ok-bg text-ok',
  danger: 'border-danger bg-danger-bg text-danger',
}

/**
 * Ichida yashirin (sr-only) radio/checkbox bo'lgan `label` uchun: input klaviatura bilan fokuslanganda
 * halqa label atrofida chiziladi (input o'zi ko'rinmaydi).
 */
export const focusWithinRing = 'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand'

const shapes: Record<ChoiceShape, string> = {
  pill: 'min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full whitespace-nowrap',
  box: 'min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-center',
  stack: 'min-h-13 flex-col items-start justify-center gap-0.5 rounded-xl px-3 text-left',
  // Material plitkasi: 76 px (nom 2 qatorgacha + izoh)
  tile: 'min-h-19 flex-col items-start justify-between gap-1 rounded-xl px-3 py-2.5 text-left',
  row: 'min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left',
}

/**
 * Yagona tanlov uslubi (design-system: "tanlangan = `ice` fon + `brand` chegara").
 * Barcha chip / plitka / radio-tugmalar shu funksiyadan oladi — tanlangan holat hamma joyda bir xil.
 *
 * - `size` — matn: `sm` 14 px (veb), `md` 16 px (Mini App). Balandlik har doim ≥ 44 px.
 * - `dashed` — "Yangi qo'shish" kabi qo'shimcha amal tugmasi.
 * - `label` — `<label>` ichida sr-only input: kursor va fokus halqasi.
 * - `emphasis` — tanlanganda qalin matn (standart: ha; ichida o'z og'irligi bor qatorlar uchun — yo'q).
 * - `highlight` — tanlanmagan, lekin ajratilgan (ko'p ishlatiladigan material).
 */
export function choiceClass({
  selected,
  shape = 'pill',
  tone = 'brand',
  size = 'sm',
  dashed = false,
  label = false,
  emphasis = true,
  highlight = false,
}: {
  selected: boolean
  shape?: ChoiceShape
  tone?: ChoiceTone
  size?: 'sm' | 'md'
  dashed?: boolean
  label?: boolean
  emphasis?: boolean
  /** Tanlanmagan, lekin ajratilgan (masalan, ko'p ishlatiladigan material) — och ko'k chegara va fon. */
  highlight?: boolean
}): string {
  return cx(
    'inline-flex border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    shapes[shape],
    shape !== 'tile' && (size === 'md' ? 'text-base' : 'text-sm'),
    shape === 'pill' && (size === 'md' ? 'px-4' : 'px-3.5'),
    dashed && 'border-dashed',
    label && cx('cursor-pointer', focusWithinRing),
    selected && emphasis && 'font-semibold',
    !selected && shape !== 'tile' && 'font-medium',
    selected
      ? selectedTone[tone]
      : cx(
          'text-ink active:bg-ice',
          highlight ? 'border-brand/50 bg-ice/40 hover:border-brand' : 'bg-paper hover:border-line-hover',
          !highlight && (dashed ? 'border-line-strong' : 'border-line'),
        ),
  )
}
