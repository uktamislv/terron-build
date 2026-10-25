import { createContext, useContext } from 'react'

export type ToastTone = 'ok' | 'danger' | 'info'
/** Toast ichidagi havola (masalan "Foydalanuvchilar" sahifasiga). */
export interface ToastAction {
  label: string
  to: string
}

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
  action?: ToastAction
}

interface ToastApi {
  show: (message: string, tone?: ToastTone, action?: ToastAction) => void
}

export const ToastContext = createContext<ToastApi>({ show: () => undefined })

/** Qisqa xabar (pastda, 3 s). Provider bo'lmasa — hech narsa qilmaydi. */
export function useToast(): ToastApi {
  return useContext(ToastContext)
}
