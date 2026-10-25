import { useEffect } from 'react'
import { getWebApp } from './telegram'

/** Telegram BackButton: onBack berilsa ko'rsatiladi, aks holda yashiriladi. */
export function useBackButton(onBack: (() => void) | null): void {
  useEffect(() => {
    const back = getWebApp()?.BackButton
    if (!back) return
    if (!onBack) {
      back.hide()
      return
    }
    back.onClick(onBack)
    back.show()
    return () => {
      back.offClick(onBack)
      back.hide()
    }
  }, [onBack])
}

/**
 * Telegram MainButton (masalan "Saqlash"). onClick null bo'lsa yashiriladi.
 * `progress` — jarayon belgisi (spinner) va tugma bosilmaydi.
 */
export function useMainButton(text: string, onClick: (() => void) | null, disabled = false, progress = false): void {
  useEffect(() => {
    const main = getWebApp()?.MainButton
    if (!main) return
    if (!onClick) {
      main.hide()
      return
    }
    main.setText(text).onClick(onClick)
    if (disabled || progress) main.disable()
    else main.enable()
    if (progress) main.showProgress(false)
    else main.hideProgress()
    main.show()
    return () => {
      main.offClick(onClick)
      main.hideProgress()
      main.hide()
    }
  }, [text, onClick, disabled, progress])
}
