import { createContext, useContext } from 'react'

export type ToastTone = 'ok' | 'danger' | 'info'
export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void
}

export const ToastContext = createContext<ToastApi>({ show: () => undefined })

/** Qisqa xabar (pastda, 3 s). Provider bo'lmasa — hech narsa qilmaydi. */
export function useToast(): ToastApi {
  return useContext(ToastContext)
}
