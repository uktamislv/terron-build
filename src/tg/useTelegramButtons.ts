import { useEffect, useRef, useSyncExternalStore } from 'react'
import { colors } from '@/components/ui/tokens'
import { t } from '@/i18n'
import { getWebApp } from './telegram'

// ---- BackButton va ochiq varaqlar (BottomSheet) ----
// Telegram BackButton'ga bitta dispetcher ulanadi. Ochiq varaq bo'lsa — faqat eng yuqori varaq yopiladi
// (sahifaning "orqaga" amali ishlamaydi); varaq yo'q bo'lsa — sahifaning eng oxirgi `useBackButton` amali.
// Varaq ochiq paytda MainButton yashiriladi va varaq yopilganda qaytariladi (`useMainButton`).
const pageBacks: (() => void)[] = []
const sheets: (() => void)[] = []
const sheetListeners = new Set<() => void>()
let wiredBack: { off: () => void; app: object } | null = null

function dispatchBack(): void {
  const top = sheets[sheets.length - 1] ?? pageBacks[pageBacks.length - 1]
  top?.()
}

function syncBack(): void {
  const app = getWebApp()
  const back = app?.BackButton
  if (!app || !back) return
  if (wiredBack?.app !== app) {
    wiredBack?.off()
    back.onClick(dispatchBack)
    wiredBack = { app, off: () => back.offClick(dispatchBack) }
  }
  if (sheets.length > 0 || pageBacks.length > 0) back.show()
  else back.hide()
}

function emitSheets(): void {
  for (const l of sheetListeners) l()
}

/**
 * Varaq ochildi: BackButton shu varaqni yopadi, MainButton yashiriladi. Qaytgan funksiya — varaq yopildi.
 * TgLayout `SheetChromeContext` orqali BottomSheet'ga beradi.
 */
export function registerSheet(close: () => void): () => void {
  sheets.push(close)
  syncBack()
  emitSheets()
  return () => {
    const i = sheets.lastIndexOf(close)
    if (i >= 0) sheets.splice(i, 1)
    syncBack()
    emitSheets()
  }
}

function subscribeSheets(cb: () => void): () => void {
  sheetListeners.add(cb)
  return () => sheetListeners.delete(cb)
}

/** Hozir ochiq varaq bormi (MainButton yashirilishi uchun). */
export function useSheetOpen(): boolean {
  return useSyncExternalStore(subscribeSheets, () => sheets.length > 0, () => false)
}

/** Telegram BackButton: onBack berilsa ko'rsatiladi, aks holda yashiriladi (ochiq varaq ustun turadi). */
export function useBackButton(onBack: (() => void) | null): void {
  useEffect(() => {
    if (!onBack) {
      syncBack()
      return
    }
    pageBacks.push(onBack)
    syncBack()
    return () => {
      const i = pageBacks.lastIndexOf(onBack)
      if (i >= 0) pageBacks.splice(i, 1)
      syncBack()
    }
  }, [onBack])
}

// "Saqlandi" holati: saqlangandan keyin MainButton qisqa vaqt yashil "Saqlandi" bo'lib turadi.
// Faqat saqlangan ekranga tegishli: boshqa bo'limga o'tilsa (yo'l o'zgarsa) darhol o'chadi —
// u yerdagi MainButton "Saqlandi" ni ko'rsatmaydi (TgLayout `clearMainButtonSaved` ni chaqiradi).
const SAVED_MS = 1200
let savedFlash = false
let savedPath: string | null = null
let savedTimer: ReturnType<typeof setTimeout> | null = null
const savedListeners = new Set<() => void>()

function emitSaved(): void {
  for (const l of savedListeners) l()
}

/** Saqlash muvaffaqiyatli bo'lganda chaqiriladi: MainButton ~1,2 s "Saqlandi" ko'rinishiga o'tadi. */
export function flashMainButtonSaved(): void {
  if (!getWebApp()) return
  savedFlash = true
  savedPath = window.location.pathname
  if (savedTimer) clearTimeout(savedTimer)
  savedTimer = setTimeout(() => {
    savedFlash = false
    savedPath = null
    savedTimer = null
    emitSaved()
  }, SAVED_MS)
  emitSaved()
}

/** "Saqlandi" holatini darhol o'chirish (ekran almashganda). */
export function clearMainButtonSaved(): void {
  if (!savedFlash) return
  savedFlash = false
  savedPath = null
  if (savedTimer) clearTimeout(savedTimer)
  savedTimer = null
  emitSaved()
}

/** Shu yo'ldagi ekran uchun "Saqlandi" ko'rinib turibdimi. */
function savedFlashHere(): boolean {
  return savedFlash && savedPath === window.location.pathname
}

function subscribeSaved(cb: () => void): () => void {
  savedListeners.add(cb)
  return () => savedListeners.delete(cb)
}

/**
 * Telegram MainButton (masalan "Saqlash"). onClick null bo'lsa yashiriladi.
 * `progress` — jarayon belgisi (spinner) va tugma bosilmaydi.
 * `color` — tugma rangi (standart — brand; masalan kirimda yashil `colors.ok`).
 */
export function useMainButton(
  text: string,
  onClick: (() => void) | null,
  disabled = false,
  progress = false,
  color: string = colors.brand,
): void {
  const flashing = useSyncExternalStore(subscribeSaved, savedFlashHere, () => false)
  // Varaq ochiq — MainButton yashirin (varaq yopilganda tugma qaytadi)
  const sheetOpen = useSheetOpen()
  const visible = !sheetOpen && (flashing || onClick !== null)

  // Sahifa har harf kiritilganda yangi onClick beradi — tugma qayta ulanmasin va miltillamasin:
  // Telegram'ga bitta doimiy ishlovchi ulanadi, u eng oxirgi onClick'ni chaqiradi.
  const clickRef = useRef(onClick)
  useEffect(() => {
    clickRef.current = onClick
  }, [onClick])

  // Matn / holat — tugma ko'rinib turgan joyda yangilanadi, yashirilmaydi
  useEffect(() => {
    const main = getWebApp()?.MainButton
    if (!main || !visible) return
    if (flashing) {
      main.hideProgress()
      main.setText(t.ui.saved)
      main.setParams?.({ color: colors.ok, text_color: colors.paper })
      main.disable()
      return () => {
        main.setParams?.({ color: colors.brand, text_color: colors.paper })
      }
    }
    main.setText(text)
    main.setParams?.({ color, text_color: colors.paper })
    if (disabled || progress) main.disable()
    else main.enable()
    if (progress) main.showProgress(false)
    else main.hideProgress()
    return () => {
      // Boshqa ekran o'z rangini beradi; bermasa — standart brand
      if (color !== colors.brand) main.setParams?.({ color: colors.brand, text_color: colors.paper })
    }
  }, [visible, flashing, text, disabled, progress, color])

  // Ko'rsatish / yashirish — faqat ko'rinish haqiqatan o'zgarganda
  useEffect(() => {
    const main = getWebApp()?.MainButton
    if (!main) return
    if (!visible) {
      main.hide()
      return
    }
    // "Saqlandi" paytida tugma disable — Telegram bosishni yubormaydi
    const handler = () => clickRef.current?.()
    main.onClick(handler)
    main.show()
    return () => {
      main.offClick(handler)
      main.hideProgress()
      main.hide()
    }
  }, [visible])
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
