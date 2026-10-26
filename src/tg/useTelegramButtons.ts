import { createContext, useContext, useEffect, useSyncExternalStore } from 'react'
import { colors } from '@/components/ui/tokens'
import { t } from '@/i18n'
import { getWebApp } from './telegram'

/**
 * Mini App "qobig'i" holati: MainButton ko'rinib turganda pastki menyu yashiriladi (Telegram tugmasi
 * ekran pastini egallaydi, ikkita pastki panel bir-birini to'sib qo'ymasin). Provider — TgLayout.
 */
export const TgChromeContext = createContext<{ /** true — yana bitta MainButton ko'rindi, false — yashirildi (hisoblagich). */ setMainButtonVisible: (visible: boolean) => void } | null>(null)

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

// "Saqlandi" holati: saqlangandan keyin MainButton qisqa vaqt yashil "Saqlandi" bo'lib turadi.
const SAVED_MS = 1200
let savedFlash = false
let savedTimer: ReturnType<typeof setTimeout> | null = null
const savedListeners = new Set<() => void>()

function emitSaved(): void {
  for (const l of savedListeners) l()
}

/** Saqlash muvaffaqiyatli bo'lganda chaqiriladi: MainButton ~1,2 s "Saqlandi" ko'rinishiga o'tadi. */
export function flashMainButtonSaved(): void {
  if (!getWebApp()) return
  savedFlash = true
  if (savedTimer) clearTimeout(savedTimer)
  savedTimer = setTimeout(() => {
    savedFlash = false
    savedTimer = null
    emitSaved()
  }, SAVED_MS)
  emitSaved()
}

function subscribeSaved(cb: () => void): () => void {
  savedListeners.add(cb)
  return () => savedListeners.delete(cb)
}

/**
 * Telegram MainButton (masalan "Saqlash"). onClick null bo'lsa yashiriladi.
 * `progress` — jarayon belgisi (spinner) va tugma bosilmaydi.
 */
export function useMainButton(text: string, onClick: (() => void) | null, disabled = false, progress = false): void {
  const chrome = useContext(TgChromeContext)
  const flashing = useSyncExternalStore(subscribeSaved, () => savedFlash, () => false)

  useEffect(() => {
    const main = getWebApp()?.MainButton
    if (!main) return
    if (flashing) {
      main.hideProgress()
      main.setText(t.ui.saved)
      main.setParams?.({ color: colors.ok, text_color: colors.paper })
      main.disable()
      main.show()
      chrome?.setMainButtonVisible(true)
      return () => {
        main.setParams?.({ color: colors.brand, text_color: colors.paper })
        main.hide()
        chrome?.setMainButtonVisible(false)
      }
    }
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
    chrome?.setMainButtonVisible(true)
    return () => {
      main.offClick(onClick)
      main.hideProgress()
      main.hide()
      chrome?.setMainButtonVisible(false)
    }
  }, [text, onClick, disabled, progress, flashing, chrome])
}

/**
 * Qoralamada ma'lumot bo'lsa — Telegram yopishdan oldin tasdiq so'raydi (Bot API 6.2+).
 * Qoralama bo'shasa yoki ekran yopilsa — o'chiriladi.
 */
export function useClosingConfirmation(dirty: boolean): void {
  useEffect(() => {
    const app = getWebApp()
    if (!app?.enableClosingConfirmation) return
    if (!dirty) {
      app.disableClosingConfirmation?.()
      return
    }
    app.enableClosingConfirmation()
    return () => app.disableClosingConfirmation?.()
  }, [dirty])
}
