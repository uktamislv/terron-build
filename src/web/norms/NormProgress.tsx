import { LevelBar } from '@/components/ui'
import type { Dec } from '@/domain/decimal'

/**
 * Smeta ishlatilishi foizi — umumiy `LevelBar` (jadval o'lchami, bir kasr xona): 100 % dan oshsa
 * chiziq chegaradan o'tib qizaradi. Foiz domain'dan (Dec) keladi; son — faqat chizish uchun.
 */
export function NormProgress({ pct, label }: { pct: Dec | null; label?: string }) {
  if (pct === null) return null
  return <LevelBar value={Math.max(0, Number(pct))} max={100} label={label ?? ''} size="sm" percentDigits={1} className="min-w-28" />
}
