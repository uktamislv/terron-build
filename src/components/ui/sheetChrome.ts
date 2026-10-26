import { createContext } from 'react'

/**
 * Varaq (BottomSheet) ochilganini ilova "qobig'i"ga bildirish. Mini App (TgLayout) shu orqali Telegram
 * BackButton'ni varaqni yopishga ulaydi va MainButton'ni yashiradi. Qaytgan funksiya — varaq yopildi.
 * Veb panelda provider yo'q — hech narsa qilinmaydi.
 */
export const SheetChromeContext = createContext<((close: () => void) => () => void) | null>(null)
