// Dizayn tokenlarining JS nusxasi (index.css @theme bilan bir xil). Diagrammalar (Recharts) uchun.
export const colors = {
  brand: '#1E5EFF',
  navy: '#0B2A6B',
  ice: '#EAF1FF',
  paper: '#FFFFFF',
  canvas: '#F4F6FA',
  ink: '#0E1A33',
  muted: '#5A6A86',
  line: '#DCE3EF',
  danger: '#B3261E',
  warn: '#8A5300',
  warnBg: '#FFF4E0',
  ok: '#1B6E35',
  okBg: '#E7F5EC',
  transfer: '#5B7BB3',
} as const

/** Kategoriyali diagramma palitrasi (ketma-ketlik muhim: birinchi — asosiy). */
export const chartPalette = [colors.brand, colors.navy, colors.ok, colors.warn, colors.transfer, '#7FA2FF', '#9AA8C0'] as const
