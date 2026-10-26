// Dizayn tokenlarining JS nusxasi (index.css @theme bilan bir xil).
// Diagrammalar (Recharts), Telegram WebApp ranglari (telegram.ts) va SVG belgilari uchun.
export const colors = {
  brand: '#1E5EFF',
  brand300: '#7FA2FF',
  brand600: '#1A52E0',
  brand700: '#1747C4',
  navy: '#0B2A6B',
  navyMuted: '#BCC8E3',
  ice: '#EAF1FF',
  iceHover: '#DCE8FF',
  paper: '#FFFFFF',
  canvas: '#F4F6FA',
  ink: '#0E1A33',
  muted: '#5A6A86',
  muted300: '#9AA8C0',
  line: '#DCE3EF',
  lineHover: '#C5D0E3',
  lineStrong: '#7D8BA3',
  danger: '#B3261E',
  dangerBg: '#FDECEA',
  warn: '#8A5300',
  warnBg: '#FFF4E0',
  ok: '#1B6E35',
  okBg: '#E7F5EC',
  ok300: '#7EE2A0',
  transfer: '#52709F',
} as const

/** Kategoriyali diagramma palitrasi (ketma-ketlik muhim: birinchi — asosiy). */
export const chartPalette = [colors.brand, colors.navy, colors.ok, colors.warn, colors.transfer, colors.brand300, colors.muted300] as const
