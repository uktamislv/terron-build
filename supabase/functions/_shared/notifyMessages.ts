// Batch 6 — Telegram bot xabar shablonlari: darhol yuboriladigan ogohlantirishlar,
// ogohlantirishlar to'plami (digest) va kunlik hisobot. Bitta joyda (CLAUDE.md "Telegram bot"),
// `tg-dispatch` import qiladi. Barcha matnlar `NOTIFY_TEXTS` da (keyin rus tili uchun).
// Sof modul: Deno va Node'da bir xil ishlaydi (faqat standart JS + Intl).
// Telegram `parse_mode: 'HTML'` — barcha foydalanuvchi matnlari `escapeHtml` dan o'tadi.
// Raqamlar float'ga aylantirilmaydi: satr asosida yaxlitlanadi va guruhlanadi.

export interface AlertPayload {
  alert_id: string
  type: string
  severity: string
  object_name: string | null
  material_name: string | null
  base_unit: string | null
  details: Record<string, unknown>
  created_at: string
  /** Kuchayish darajasi (1/2/3) — masalan normadan oshish +50 % / +100 % ga yetdi. */
  escalation?: number | null
}

export interface DailyReportPayload {
  date: string
  period_start: string
  period_end: string
  company_name: string
  kirim_count: number
  chiqim_count: number
  purchases_count: number
  purchases_sum: string
  requests_count: number
  alerts_new: number
  alerts_by_type: Record<string, number>
  self_received_count: number
  deleted_count: number
  restored_count: number
  failed_count: number
  transfers_pending_count: number
  chiqim_without_estimate_count: number
  /** Batch 12: tugayotgan (obyekt, material) juftliklari. */
  low_stock_count?: number | null
  /** Batch 12: joylashuvga ruxsat berilmagan yozuvlar (`geo_status = 'denied'`). */
  geo_denied_count?: number | null
  /** Batch 12: joylashuv aniqlanmagan yozuvlar (`geo_status = 'unavailable'`). */
  geo_unavailable_count?: number | null
  /** Audit: oraliqda yaratilgan, sanasi oraliqdan oldingi yozuvlar. */
  backdated_count?: number | null
  /** Audit: oraliqda qo'lda yopilgan alertlar. */
  manual_closed_count?: number | null
  /** Audit: navbatda qolib ketgan bildirishnomalar (joriy). */
  stuck_pending_count?: number | null
  /** Audit: oxirgi 7 kunda yuborilmagan bildirishnomalar. */
  failed_7d_count?: number | null
  /** Audit: xodimlar qo'lidagi pul (Σ musbat balans), matn. */
  cash_outstanding_sum?: string | null
  /** Audit: xodimlarga qarz (Σ manfiy balans, musbat son), matn. */
  cash_owed_to_staff_sum?: string | null
}

/** Batch 12 (J): `alert_remind_hours` dan beri ko'rilmagan alert — eslatma. */
export interface AlertReminderPayload extends AlertPayload {
  status?: string | null
  reminded_at?: string | null
  hours_open?: number | string | null
}

export interface OverdueRequestItem {
  request_id: string
  object_id?: string | null
  object_name: string | null
  material_name: string | null
  qty_input: number | string | null
  unit_input: string | null
  qty_base: number | string | null
  base_unit: string | null
  needed_by: string | null
  days_overdue: number | string | null
  created_by_name: string | null
}

/** Batch 12 (H): muddati o'tgan tasdiqlangan so'rovlar (taminotchi, admin). */
export interface RequestOverduePayload {
  date: string
  company_name: string | null
  count: number | string
  requests: OverdueRequestItem[]
}

/** Batch 11: Mini App'dagi "Xatolik haqida xabar berish" (admin va super_admin'larga). */
export interface BugReportPayload {
  bug_report_id: string
  company_id: string
  company_name: string | null
  reporter_id: string | null
  reporter_name: string | null
  reporter_role: string | null
  screen: string | null
  /** ≤ 500 belgi (bazada kesilgan). */
  message: string | null
  message_truncated: boolean | null
  client: string | null
  app_version: string | null
  has_photo: boolean | null
  created_at: string
}

/** Batch 12 (I): haftalik podotchet xabari (pul egasiga). */
export interface CashStatementPayload {
  date: string
  period_start: string
  period_end: string
  company_name: string | null
  profile_id: string
  profile_name: string | null
  issued_week: string | null
  spent_week: string | null
  returned_week: string | null
  issued_total?: string | null
  returned_total?: string | null
  spent_total?: string | null
  balance: string | null
  oldest_open_date: string | null
  days_open: number | string | null
}

/** Telegram xabar matni chegarasi (belgilar). */
export const TELEGRAM_MAX_LENGTH = 4096
/** Bitta nom (material, obyekt, odam) uchun maksimal uzunlik — escape'dan oldin. */
const MAX_NAME_LENGTH = 120
/** Digest'da alohida qator bilan ko'rsatiladigan ogohlantirishlar soni. */
const DIGEST_MAX_ITEMS = 10

const MINUS = '−'
const TIME_ZONE = 'Asia/Tashkent'

/** Barcha bot xabar matnlari — bitta obyekt (rus tili keyin shu tuzilmada qo'shiladi). */
export const NOTIFY_TEXTS = {
  currency: 'so‘m',
  percent: '%',
  ellipsis: '…',
  openMiniApp: "Mini App'ni ochish",
  genericAlert: 'Yangi ogohlantirish',
  alertTitles: {
    xarid_qabul_farqi: 'Xarid va qabul farqi',
    ozi_qabul_qilgan: "O'zi qabul qilgan",
    narx_high: 'Narx odatdagidan yuqori',
    narx_low: 'Narx odatdagidan juda past',
    narx_ogishi: "Narx og'ishi",
    normadan_oshish: 'Normadan oshish',
    inventarizatsiya_kamomadi: 'Inventarizatsiya kamomadi',
    smetadan_ortiq_sorov: "Smetadan ortiq so'rov",
    otkazma_farqi: "O'tkazmada farq",
    otkazma_not_received: "O'tkazma qabul qilinmadi",
    smeta_waste_changed: "Isrof foizi o'zgartirildi",
    smeta_ozgarishi: "Smeta o'zgarishi",
    smeta_norm_increase: 'Smeta normasi oshirildi',
    smeta_old_version_restored: 'Smetaning eski versiyasi joriy qilindi',
    smeta_current_deleted: "Joriy smeta o'chirildi",
    kirim_manbasiz: 'Kirim manbasiz',
    manfiy_qoldiq: 'Manfiy qoldiq',
    takroriy_yozuv: 'Takroriy yozuv',
    takroriy_rasm: 'Bir xil rasm qayta ishlatildi',
    joylashuv_farqi: 'Joylashuv farqi',
    smetasiz_chiqim: 'Smetasiz chiqim',
    chek_farqi: 'Chek summasi farq qiladi',
    sorovdan_ortiq_xarid: "So'rovdan ortiq xarid",
    podotchet_muddati: "Podotchet muddati o'tdi",
    podotchet_manfiy: 'Podotchet manfiy',
    sozlama_ozgardi: "Firma sozlamasi o'zgartirildi",
    login_ozgardi: "Login o'zgartirildi",
    podotchet_belgisi: 'Podotchet belgisi',
    sotuvchi_stir_farqi: 'Sotuvchi STIR farqi',
    xarid_boshqa_nomidan: 'Boshqa odam nomidan xarid',
    sotuvchi_birlashtirildi: 'Sotuvchilar birlashtirildi',
  },
  deletedTitles: {
    purchases: "Xarid o'chirildi",
    cash_advances: "Podotchet o'chirildi",
    kirim: "Kirim o'chirildi",
    chiqim: "Chiqim o'chirildi",
    movements: "Ombor harakati o'chirildi",
    other: "Yozuv o'chirildi",
  },
  restoredTitles: {
    purchases: 'Xarid tiklandi',
    cash_advances: 'Podotchet tiklandi',
    kirim: 'Kirim tiklandi',
    chiqim: 'Chiqim tiklandi',
    movements: 'Ombor harakati tiklandi',
    other: 'Yozuv tiklandi',
  },
  restored: {
    recordDate: 'Yozuv sanasi: ',
    /** "o'chirilganiga 12 kun" */
    daysSince: (n: string) => `o'chirilganiga ${n} kun`,
    actor: 'Tikladi: ',
    pastReportsChange: "⚠️ O'tgan davr hisobotlari o'zgaradi",
  },
  /** Kunlik hisobot va digest'dagi qisqa nomlar. */
  alertShort: {
    xarid_qabul_farqi: 'xarid/qabul',
    narx_ogishi: 'narx',
    ozi_qabul_qilgan: "o'zi qabul",
    yozuv_ochirildi: "o'chirish",
    yozuv_tiklandi: 'tiklandi',
    normadan_oshish: 'norma',
    inventarizatsiya_kamomadi: 'kamomad',
    smetadan_ortiq_sorov: 'smetadan ortiq',
    otkazma_farqi: "o'tkazma",
    smeta_ozgarishi: 'smeta',
    kirim_manbasiz: 'manbasiz kirim',
    manfiy_qoldiq: 'manfiy qoldiq',
    takroriy_yozuv: 'takroriy',
    joylashuv_farqi: 'joylashuv',
    smetasiz_chiqim: 'smetasiz chiqim',
    chek_farqi: 'chek',
    sorovdan_ortiq_xarid: "so'rovdan ortiq",
    podotchet_muddati: 'podotchet muddati',
    podotchet_manfiy: 'podotchet manfiy',
    yozuv_ozgartirildi: "o'zgartirish",
    yozuv_tuzatildi: 'tuzatish',
    sozlama_ozgardi: 'sozlama',
    login_ozgardi: 'login',
    podotchet_belgisi: 'podotchet belgisi',
    sotuvchi_stir_farqi: 'sotuvchi STIR',
    xarid_boshqa_nomidan: 'boshqa nomidan xarid',
    sotuvchi_birlashtirildi: 'sotuvchi birlashtirildi',
  } as Record<string, string>,
  noSource: {
    open_purchase: "Ochiq xarid bor edi, lekin kirim unga bog'lanmagan",
    no_source: "Oxirgi 7 kunda bu material uchun xarid yoki o'tkazma yo'q",
    unlinked_candidate: "Kirim xaridga bog'lanmagan (xarid/qabul farqini yopadi)",
    qty: 'Miqdor: ',
    date: 'Sana: ',
  } as Record<string, string>,
  negativeStock: {
    stock: 'Qoldiq: ',
    lastChiqim: 'Oxirgi chiqim: ',
    lastTransfer: "Oxirgi o'tkazma: ",
  },
  duplicate: {
    /** "10 daqiqa ichida xuddi shunday yozuv kiritildi" */
    record: (min: string) => `${min} daqiqa ichida xuddi shunday yozuv kiritildi`,
    recordNoWindow: 'Qisqa vaqt ichida xuddi shunday yozuv kiritildi',
    photo: 'Bu rasm boshqa yozuvda ham ishlatilgan',
    qty: 'Miqdor: ',
    amount: 'Summa: ',
    tables: { purchases: 'Xarid', movements: 'Ombor harakati' } as Record<string, string>,
  },
  geo: {
    /** "Obyektdan 850 m uzoqda" */
    distance: (m: string) => `Obyektdan ${m} m uzoqda`,
    /** "ruxsat 300 m" */
    radius: (m: string) => `ruxsat ${m} m`,
    /** "aniqlik ±25 m" */
    accuracy: (m: string) => `aniqlik ±${m} m`,
    types: { kirim: 'Kirim', chiqim: 'Chiqim', transfer_out: "O'tkazma", transfer_in: "O'tkazma qabuli" } as Record<
      string,
      string
    >,
  },
  noEstimate: {
    /** "3 ta chiqim, obyektda joriy smeta yo'q" */
    count: (n: string) => `${n} ta chiqim, obyektda joriy smeta yo'q`,
    date: 'Sana: ',
  },
  receiptDiff: {
    receipt: 'Chek: ',
    entered: 'kiritilgan: ',
    fiscal: 'Fiskal belgi: ',
  },
  overbuy: {
    requested: "So'raldi: ",
    purchased: 'xarid: ',
    threshold: 'Chegara: ',
    /** "2 ta xarid" */
    purchases: (n: string) => `${n} ta xarid`,
  },
  cash: {
    holder: 'Kimda: ',
    balance: "Qo'lida: ",
    /** "20 kundan beri (chegara 14 kun)" */
    daysOpen: (d: string, max: string | null) => `${d} kundan beri${max ? ` (chegara ${max} kun)` : ''}`,
    since: 'Eng eski qoldiq: ',
    negative: 'Balans: ',
    negativeHint: "Sarf berilgan puldan ko'p — pul berish kiritilmagan bo'lishi mumkin",
  },
  reminder: {
    /** "Eslatma · 49 soatdan beri ko'rilmagan" */
    head: (h: string | null) => (h ? `Eslatma · ${h} soatdan beri ko'rilmagan` : "Eslatma · hali ko'rilmagan"),
    /** "5 ta ko'rilmagan ogohlantirish (eslatma)" */
    digestTitle: (n: string) => `${n} ta ko'rilmagan ogohlantirish (eslatma)`,
  },
  overdue: {
    title: "Muddati o'tgan so'rovlar",
    /** "3 ta tasdiqlangan so'rov hali xarid qilinmagan:" */
    intro: (n: string) => `${n} ta tasdiqlangan so'rov hali xarid qilinmagan:`,
    /** "muddat 04.11.2026 (2 kun o'tdi)" */
    due: (date: string, days: string | null) => `muddat ${date}${days ? ` (${days} kun o'tdi)` : ''}`,
  },
  cashStatement: {
    title: 'Podotchet hisoboti',
    week: 'Shu hafta:',
    issued: 'Berildi: ',
    spent: 'Sarflandi: ',
    returned: 'Qaytarildi: ',
    balance: "Qo'lingizda: ",
    overspent: "Ortiqcha sarf (sizga qaytarilishi kerak): ",
    /** "Eng eski qoldiq: 20.10.2026 (20 kun)" */
    oldest: (date: string, days: string | null) => `Eng eski qoldiq: ${date}${days ? ` (${days} kun)` : ''}`,
  },
  buttons: {
    seen: "✓ Ko'rildi",
    open: 'Ochish',
  },
  /** Audit (20261108): yozuv o'zgartirildi / tuzatildi. */
  recordChange: {
    titles: {
      purchases: "Xarid o'zgartirildi",
      kirim: "Kirim o'zgartirildi",
      chiqim: "Chiqim o'zgartirildi",
      movements: "Ombor harakati o'zgartirildi",
      other: "Yozuv o'zgartirildi",
    } as Record<string, string>,
    correctedTitle: 'Muallif yozuvni tuzatdi',
    actor: "O'zgartirdi: ",
    author: 'muallif: ',
    viaCorrect: '(tuzatish orqali)',
    changed: "o'zgardi",
    labels: {
      type: 'Tur',
      object_id: 'Obyekt',
      material_id: 'Material',
      unit_id: 'Birlik',
      qty_input: 'Miqdor',
      qty_base: 'Miqdor (asosiy birlikda)',
      occurred_at: 'Sana',
      purchased_at: 'Sana',
      purchase_id: "Bog'langan xarid",
      total_amount: 'Summa',
      unit_price: 'Narx',
      price_per_base: 'Narx (asosiy birlik)',
      buyer_id: 'Xaridor',
    } as Record<string, string>,
    movementTypes: {
      kirim: 'kirim',
      chiqim: 'chiqim',
      transfer_out: "o'tkazma (chiqim)",
      transfer_in: "o'tkazma (kirim)",
      inventory_adjust: 'inventarizatsiya tuzatishi',
    } as Record<string, string>,
  },
  settingsChange: {
    title: "Firma sozlamasi o'zgartirildi",
    actor: "O'zgartirdi: ",
    yes: 'ha',
    no: "yo'q",
    empty: '—',
    labels: {
      price_deviation_pct: "Narx og'ishi chegarasi, %",
      price_avg_window: "Narx o'rtachasi — xaridlar soni",
      receipt_mismatch_pct: 'Xarid/qabul farqi chegarasi, %',
      estimate_increase_pct: 'Smeta oshishi chegarasi, %',
      transfer_receive_hours: "O'tkazmani qabul qilish muddati, soat",
      photo_required_amount: 'Rasm majburiy bo‘lgan summa',
      cash_max_days: 'Podotchet muddati, kun',
      duplicate_window_minutes: 'Takroriy yozuv oynasi, daqiqa',
      request_overbuy_pct: "So'rovdan ortiq xarid chegarasi, %",
      alert_remind_hours: 'Eslatma, soat',
      forecast_days_warn: 'Tugash ogohlantirishi, kun',
      quiet_hours_start: 'Tinch soatlar boshi',
      quiet_hours_end: 'Tinch soatlar oxiri',
    } as Record<string, string>,
  },
  loginChange: {
    title: "Login o'zgartirildi",
    target: 'Kimning: ',
    actor: "O'zgartirdi: ",
    actorExternal: 'Tizim egasi (boshqa firma)',
  },
  cashFlag: {
    title: 'Podotchet belgisi',
    reasons: {
      qaytarildi: 'Pul qaytarildi deb kiritildi',
      issued_at_outside_window: 'Sana odatiy oynadan tashqarida',
    } as Record<string, string>,
    recipient: 'Kimga: ',
    amount: 'Summa: ',
    date: 'Sana: ',
    actor: 'Kiritdi: ',
  },
  sellerTin: {
    title: 'Sotuvchi STIR farqi',
    receipt: 'Chekda STIR: ',
    supplier: 'Tanlangan sotuvchi: ',
    supplierTin: 'STIR ',
    noTin: "STIR yo'q",
    fiscal: 'Fiskal belgi: ',
  },
  negativeCause: {
    deleted: (type: string) => `Sabab: ${type} o'chirildi`,
    changed: (type: string) => `Sabab: ${type} o'zgartirildi`,
    qty: 'Miqdor: ',
  },
  inventoryDuring: {
    /** "Sanash paytida 3 ta harakat: Sement — 2, Qum — 1" */
    line: (n: string) => `Sanash paytida ${n} ta harakat bo'ldi`,
  },
  /** Ish oqimi xabarlari (outbox: request_*, transfer_sent, purchase_for_object, login_changed). */
  workflow: {
    requestCreated: "Yangi so'rov",
    requestApproved: "So'rovingiz tasdiqlandi",
    requestRejected: "So'rovingiz rad etildi",
    requestDecided: "So'rov bo'yicha qaror",
    buyNeeded: 'Sotib olish kerak',
    transferSent: "Yo'lda — o'tkazma keladi",
    /** "Ali sotib oldi, obyektga keladi" */
    purchaseFor: (who: string) => `${who} sotib oldi, obyektga keladi`,
    purchaseForUnknown: 'Xarid qilindi, obyektga keladi',
    neededBy: 'Kerak: ',
    note: 'Izoh: ',
    decisionNote: 'Izoh: ',
    rejectNote: 'Sabab: ',
    requestedBy: "So'radi: ",
    decidedBy: 'Qaror: ',
    approvedBy: 'tasdiqladi: ',
    sentBy: 'Yubordi: ',
    supplier: 'Sotuvchi: ',
    loginTitle: "Sizning loginingiz o'zgartirildi",
    loginActor: "O'zgartirdi: ",
    loginWarn: "Agar bu siz bo'lmasangiz — darhol adminga ayting.",
    loginFirstTitle: 'Sizga login berildi',
    // 2-tur
    transferCancelled: "O'tkazma bekor qilindi",
    transferReceived: "O'tkazma qabul qilindi",
    cancelReason: 'Sabab: ',
    cancelledBy: 'Bekor qildi: ',
    sent: 'Yuborildi: ',
    received: 'qabul: ',
    receivedBy: 'Qabul qildi: ',
    purchaseDeleted: 'Xarid bekor qilindi — obyektga kelmaydi',
    buyer: 'Xaridor: ',
    deletedBy: "O'chirdi: ",
    reason: 'Sabab: ',
    purchaseOnYourName: 'Sizning nomingizga xarid kiritildi',
    purchaseOnYourNameWarn: "Agar siz qilmagan bo'lsangiz — adminga ayting.",
    enteredBy: 'Kiritdi: ',
    payment: "To'lov: ",
    paymentSources: { podotchet: "podotchet (qo'lingizdagi puldan)", firma: 'firma hisobidan' } as Record<string, string>,
    inventoryApplied: "Inventarizatsiya natijasi qo'llandi",
    /** "Materiallar: 12, tuzatildi: 3" */
    inventoryCounts: (items: string, adjusted: string) => `Materiallar: ${items}, tuzatildi: ${adjusted}`,
    appliedBy: "Qo'lladi: ",
  },
  /** 2-tur: dayjest (bir xil turdagi bir nechta alert bitta xabarda). */
  alertsDigest: {
    /** "7 ta: Smetadan ortiq so'rov" */
    title: (n: string, typeTitle: string) => `${n} ta: ${typeTitle}`,
    /** "ortiqcha 120,5 kg" */
    over: (q: string) => `ortiqcha ${q}`,
    /** "+5 ta" */
    more: (n: string) => `+${n} ta`,
  },
  otherBuyer: {
    title: 'Boshqa odam nomidan xarid',
    buyer: 'Xaridor: ',
    actor: 'kiritdi: ',
    viaUpdate: "(xaridor keyin o'zgartirildi)",
    date: 'Sana: ',
  },
  supplierMerge: {
    title: 'Sotuvchilar birlashtirildi',
    /** "Ko'chirilgan xaridlar: 5 (o'chirilganlar: 1)" */
    moved: (n: string, deleted: string | null) => `Ko'chirilgan xaridlar: ${n}${deleted ? ` (o'chirilganlar: ${deleted})` : ''}`,
    filled: "To'ldirildi: ",
    filledKeys: { tin: 'STIR', phone: 'telefon', note: 'izoh' } as Record<string, string>,
    actor: 'Bajardi: ',
  },
  entryCancel: {
    title: 'Muallif yozuvni bekor qildi',
    reason: 'Sabab: ',
    firstLogin: 'Birinchi marta login berildi',
  },
  /** Rol nomlari — `src/i18n/uz.ts` `roles` bilan bir xil. */
  roles: {
    super_admin: 'Tizim egasi',
    admin: 'Admin',
    direktor: 'Direktor',
    buxgalter: 'Buxgalter',
    taminotchi: 'Ta’minotchi',
    prorab: 'Prorab',
    omborchi: 'Omborchi',
    haydovchi: 'Haydovchi',
    tekshiruvchi: 'Tekshiruvchi',
  } as Record<string, string>,
  bugReport: {
    title: 'Xatolik haqida xabar',
    unknownReporter: "Noma'lum foydalanuvchi",
    company: 'Firma: ',
    screen: 'Ekran: ',
    noMessage: '(matn yo‘q)',
    version: (v: string) => `v${v}`,
    photo: "📎 Rasm ilova qilingan — veb panelda ko'ring",
  },
  receipt: {
    purchased: 'Xarid: ',
    received: 'qabul: ',
    over: "Xariddan ko'p qabul qilingan",
    under: 'Xariddan kam qabul qilingan',
    threshold: 'Chegara: ',
  },
  selfReceived: {
    samePerson: 'Xarid qilgan va qabul qilgan — bitta odam',
    transferSamePerson: "O'tkazmani yuboruvchining o'zi qabul qildi",
    qty: 'Miqdor: ',
    notLinked: "Kirim xaridga bog'lanmagan",
  },
  price: {
    price: 'Narx: ',
    avgPrice: "O'rtacha narx: ",
    avg: "o'rtacha ",
    avg90: "90 kunlik o'rtacha: ",
  },
  estimate: {
    /** "v3" */
    version: (v: string) => `v${v}`,
    /** "⚠️ chiqim eski normadan oshgan (1 100 kg)" */
    exceededBefore: (consumed: string | null) =>
      `⚠️ chiqim eski normadan oshgan${consumed ? ` (${consumed})` : ''}`,
    /** "… va yana 3 ta" */
    more: (n: string) => `… va yana ${n} ta`,
  },
  norm: {
    consumed: 'Sarf: ',
    allowed: 'norma (isrof bilan): ',
    notInEstimate: "Material smetada yo'q, sarf: ",
  },
  request: {
    requested: "So'raldi: ",
    available: 'smetada qolgan: ',
    /** "ortiqcha 180 kg" */
    over: (qty: string) => `ortiqcha ${qty}`,
    notInEstimate: "Material smetada yo'q, so'raldi: ",
  },
  transfer: {
    sent: 'Yuborildi: ',
    received: 'qabul: ',
    /** "52 soat oldin" */
    hoursAgo: (h: string) => `${h} soat oldin`,
  },
  inventory: {
    /** "hisobda 2 400 kg" */
    expected: (q: string) => `hisobda ${q}`,
    notCounted: 'Sanalmagan:',
    /** "hisobda 500, sanaldi 420 kg" */
    expectedCounted: (expected: string, counted: string) => `hisobda ${expected}, sanaldi ${counted}`,
    total: 'Jami kamomad: ',
  },
  /** Kuchaygan ogohlantirish sarlavhasi oldidan. */
  escalated: '📈 Kuchaydi: ',
  /** "Smeta v3" */
  estimateVersion: (v: string) => `Smeta v${v}`,
  deleted: {
    object: 'Obyekt: ',
    actor: "O'chirdi: ",
  },
  report: {
    title: 'Kunlik hisobot',
    kirim: 'Kirim: ',
    chiqim: 'Chiqim: ',
    purchases: 'Xaridlar: ',
    pieces: ' ta',
    requests: "So'rovlar: ",
    alertsNew: 'Yangi farqlar: ',
    selfReceived: "O'zi qabul qilgan: ",
    deleted: "O'chirilgan yozuvlar: ",
    restored: 'Tiklangan yozuvlar: ',
    failed: 'Yuborilmagan xabarlar: ',
    transfersPending: "Qabul qilinmagan o'tkazmalar: ",
    chiqimWithoutEstimate: 'Smetasiz obyektlarda chiqim: ',
    backdated: 'Orqa sana bilan kiritilgan yozuvlar: ',
    manualClosed: "Qo'lda yopilgan farqlar: ",
    stuckPending: "Navbatda qolib ketgan xabarlar: ",
    failed7d: "7 kunda yuborilmagan xabarlar: ",
    cashOutstanding: "Xodimlar qo'lidagi pul: ",
    cashOwed: 'Xodimlarga qarz (ortiqcha sarf): ',
    lowStock: 'Tugayotgan materiallar: ',
    geoDenied: 'Joylashuvga ruxsat berilmagan: ',
    geoUnavailable: 'Joylashuvsiz yozuvlar: ',
  },
  digest: {
    /** "12 ta yangi ogohlantirish" */
    title: (n: string) => `${n} ta yangi ogohlantirish`,
    /** "… va yana 15 ta" */
    more: (n: string) => `… va yana ${n} ta`,
    empty: "formatAlertDigest: bo'sh ro'yxat",
  },
} as const

// ---------------------------------------------------------------------------
// Yordamchilar
// ---------------------------------------------------------------------------

/** HTML-escape: `& < > "`. */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Nomni qisqartiradi (kerak bo'lsa "…") va escape qiladi. Bo'sh/yo'q → null. */
function nameHtml(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (s === '') return null
  const chars = Array.from(s)
  const clipped =
    chars.length > MAX_NAME_LENGTH ? chars.slice(0, MAX_NAME_LENGTH - 1).join('') + NOTIFY_TEXTS.ellipsis : s
  return escapeHtml(clipped)
}

const DEC_RE = /^([+-]?)(\d*)(?:\.(\d*))?$/

/** `numeric` qiymatini (JSON'da son yoki satr) o'nlik satrga keltiradi. Noto'g'ri → null. */
export function toDecString(v: unknown): string | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    const s = String(v)
    if (!/e/i.test(s)) return s
    if (Math.abs(v) >= 1) return BigInt(Math.round(v)).toString()
    return v.toFixed(12)
  }
  if (typeof v === 'bigint') return v.toString()
  if (typeof v !== 'string') return null
  const s = v.trim()
  const m = DEC_RE.exec(s)
  if (!m || ((m[2] ?? '') === '' && (m[3] ?? '') === '')) return null
  return s
}

/**
 * O'nlik satrni o'zbek formatida chiqaradi: minglik — bo'sh joy, kasr — vergul,
 * `maxFrac` xonagacha yaxlitlanadi (half away from zero), oxirgi nollar olib tashlanadi.
 * "1250000.00" → "1 250 000", "1450.5" → "1 450,5". Noto'g'ri qiymat → null.
 */
export function formatDecimal(v: unknown, maxFrac = 2): string | null {
  const s = toDecString(v)
  if (s === null) return null
  const m = DEC_RE.exec(s)
  if (!m) return null
  const negative = m[1] === '-'
  let intPart = m[2] === '' || m[2] === undefined ? '0' : m[2]
  let frac = m[3] ?? ''
  if (frac.length > maxFrac) {
    const roundUp = frac.charCodeAt(maxFrac) - 48 >= 5
    let digits = BigInt(intPart + frac.slice(0, maxFrac))
    if (roundUp) digits += 1n
    const str = digits.toString().padStart(maxFrac + 1, '0')
    intPart = str.slice(0, str.length - maxFrac)
    frac = str.slice(str.length - maxFrac)
  }
  frac = frac.replace(/0+$/, '')
  intPart = intPart.replace(/^0+(?=\d)/, '')
  const isZero = /^0*$/.test(intPart) && frac === ''
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${negative && !isZero ? '-' : ''}${grouped}${frac ? ',' + frac : ''}`
}

/** Summa: "1 250 000 so‘m". */
function moneyText(v: unknown): string | null {
  const n = formatDecimal(v, 2)
  return n === null ? null : `${n} ${NOTIFY_TEXTS.currency}`
}

/** Miqdor + asosiy birlik: "100 kg". */
function qtyText(v: unknown, unit: string | null): string | null {
  const n = formatDecimal(v, 3)
  if (n === null) return null
  const u = nameHtml(unit)
  return u ? `${n} ${u}` : n
}

/** Ishorali foiz: "+11,5 %", "−15 %". `sign` berilsa, qiymat moduli shu ishora bilan. */
function percentText(v: unknown, sign?: '+' | '-'): string | null {
  const n = formatDecimal(v, 2)
  if (n === null) return null
  const abs = n.replace(/^-/, '')
  if (abs === '0') return `0 ${NOTIFY_TEXTS.percent}`
  const s = sign ?? (n.startsWith('-') ? '-' : '+')
  return `${s === '-' ? MINUS : '+'}${abs} ${NOTIFY_TEXTS.percent}`
}

/** Soni (butun): "1 234"; noto'g'ri → "0". */
function count(v: unknown): string {
  return formatDecimal(v, 0) ?? '0'
}

const dtFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function tashkentParts(iso: string): Record<string, string> | null {
  if (typeof iso !== 'string' || iso.trim() === '') return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const parts: Record<string, string> = {}
  for (const p of dtFormatter.formatToParts(d)) parts[p.type] = p.value
  return parts
}

/** ISO vaqt → "dd.mm.yyyy HH:mm" (Asia/Tashkent). Noto'g'ri → null. */
export function formatDateTimeTashkent(iso: string): string | null {
  const p = tashkentParts(iso)
  return p ? `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}` : null
}

/** ISO vaqt → "dd.mm HH:mm" (Asia/Tashkent). Noto'g'ri → null. */
function formatShortDateTime(iso: string): string | null {
  const p = tashkentParts(iso)
  return p ? `${p.day}.${p.month} ${p.hour}:${p.minute}` : null
}

/** Hisobot oralig'i: "28.10 20:00 – 29.10 20:00" (Toshkent). Biror chegara noto'g'ri → null. */
export function formatPeriod(start: string, end: string): string | null {
  const a = formatShortDateTime(start)
  const b = formatShortDateTime(end)
  return a && b ? `${a} – ${b}` : null
}

/** "2026-10-29" → "29.10.2026". Boshqa ko'rinish — escape qilinib o'zi qaytadi. */
export function formatDateIso(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date))
  return m ? `${m[3]}.${m[2]}.${m[1]}` : escapeHtml(String(date))
}

/**
 * Qatorlarni birlashtiradi va Telegram chegarasiga sig'diradi: oxiridan butun qatorlar
 * olib tashlanadi (HTML teglar har qator ichida yopiq), o'rniga "…".
 */
function fitLines(lines: string[], max = TELEGRAM_MAX_LENGTH): string {
  const kept = lines.filter((l) => l !== '')
  let text = kept.join('\n')
  if (text.length <= max) return text
  while (kept.length > 1) {
    kept.pop()
    text = kept.join('\n') + '\n' + NOTIFY_TEXTS.ellipsis
    if (text.length <= max) return text
  }
  return safeSlice(kept[0] ?? '', max - 1) + NOTIFY_TEXTS.ellipsis
}

/**
 * Bitta qator ham sig'masa: HTML teglar olib tashlanadi (yarim teg / yopilmagan teg qolmasin —
 * Telegram "can't parse entities" bilan rad etadi), keyin kesiladi; oxirida yarim qolgan
 * entity (`&am`) ham olib tashlanadi. Matn allaqachon escape qilingan — `&lt;` lar saqlanadi.
 */
export function safeSlice(line: string, max: number): string {
  const plain = line.replace(/<[^>]*>/g, '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // Kod nuqtalari bo'yicha (surrogat juftlik bo'linmaydi), UTF-16 uzunligi ≤ max.
  let out = ''
  for (const ch of plain) {
    if (out.length + ch.length > max) break
    out += ch
  }
  return out.replace(/&[a-zA-Z0-9#]{0,10}$/, '')
}

function contextLine(p: AlertPayload): string {
  return [nameHtml(p.material_name), nameHtml(p.object_name)].filter((x) => x).join(' · ')
}

function safeDetails(p: AlertPayload): Record<string, unknown> {
  return p.details && typeof p.details === 'object' ? p.details : {}
}

// ---------------------------------------------------------------------------
// Ogohlantirish xabari
// ---------------------------------------------------------------------------

function alertEmoji(type: string, severity: string, details: Record<string, unknown> = {}): string {
  if (type === 'yozuv_ochirildi') return '🗑'
  if (type === 'yozuv_tiklandi') return severity === 'jiddiy' ? '🔴' : '♻️'
  if (type === 'smeta_ozgarishi') {
    if (details.kind === 'old_version_restored') return '↩️'
    if (details.kind === 'current_deleted') return '🗑'
    if (details.kind === 'waste_changed') return '🧮'
    return severity === 'jiddiy' ? '🔴' : '📈'
  }
  if (type === 'ozi_qabul_qilgan') return '🔖'
  if (type === 'otkazma_farqi' && details.direction === 'not_received') return '⏳'
  if (severity === 'jiddiy') return '🔴'
  if (type === 'kirim_manbasiz') return '❓'
  if (type === 'manfiy_qoldiq') return '➖'
  if (type === 'takroriy_yozuv') return details.kind === 'photo' ? '🖼' : '🔁'
  if (type === 'joylashuv_farqi') return '📍'
  if (type === 'smetasiz_chiqim') return '📋'
  if (type === 'chek_farqi') return '🧾'
  if (type === 'sorovdan_ortiq_xarid') return '🛒'
  if (type === 'podotchet_muddati' || type === 'podotchet_manfiy' || type === 'podotchet_belgisi') return '💵'
  if (type === 'yozuv_ozgartirildi' || type === 'yozuv_tuzatildi') return '✏️'
  if (type === 'sozlama_ozgardi') return '⚙️'
  if (type === 'login_ozgardi') return '🔐'
  if (type === 'sotuvchi_stir_farqi') return '🧾'
  if (type === 'xarid_boshqa_nomidan') return '👤'
  if (type === 'sotuvchi_birlashtirildi') return '🔗'
  if (type === 'normadan_oshish') return '📉'
  if (type === 'smetadan_ortiq_sorov') return '📝'
  if (type === 'otkazma_farqi') return '🔄'
  if (type === 'inventarizatsiya_kamomadi') return '📦'
  return '⚠️'
}

function receiptLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.receipt
  const d = p.details
  const purchased = qtyText(d.purchased_qty_base, p.base_unit)
  const received = qtyText(d.received_qty_base, p.base_unit)
  const sign = d.direction === 'over' ? '+' : d.direction === 'under' ? '-' : undefined
  const pct = sign ? percentText(d.diff_pct, sign) : null
  const lines: string[] = []
  if (purchased || received) {
    const main = [purchased ? t.purchased + purchased : null, received ? t.received + received : null]
      .filter((x) => x)
      .join(', ')
    lines.push(pct ? `${main} (${pct})` : main)
  }
  if (d.direction === 'over') lines.push(t.over)
  else if (d.direction === 'under') lines.push(t.under)
  const thr = formatDecimal(d.threshold_pct, 2)
  if (thr !== null) lines.push(`${t.threshold}${thr} ${NOTIFY_TEXTS.percent}`)
  return lines
}

function selfReceivedLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.selfReceived
  const d = p.details
  const lines: string[] = [d.kind === 'transfer' ? t.transferSamePerson : t.samePerson]
  const qty = qtyText(d.qty_base, p.base_unit)
  if (qty) lines.push(t.qty + qty)
  if (d.linked === false) lines.push(t.notLinked)
  return lines
}

function priceLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.price
  const cur = NOTIFY_TEXTS.currency
  const d = p.details
  const unit = nameHtml(p.base_unit)
  const per = unit ? `/${unit}` : ''
  const price = formatDecimal(d.price, 2)
  const avgN = formatDecimal(d.avg_n, 2)
  const avg90 = formatDecimal(d.avg_90, 2)
  const diffN = percentText(d.diff_n)
  const diff90 = percentText(d.diff_90)
  const lines: string[] = []
  const useN = avgN !== null
  const avg = useN ? avgN : avg90
  const diff = useN ? diffN : diff90
  if (price !== null) {
    const extra = avg !== null ? ` (${t.avg}${avg}${diff ? `, ${diff}` : ''})` : ''
    lines.push(`${t.price}${price} ${cur}${per}${extra}`)
  } else if (avg !== null) {
    lines.push(`${t.avgPrice}${avg} ${cur}${per}${diff ? ` (${diff})` : ''}`)
  }
  if (useN && avg90 !== null) {
    lines.push(`${t.avg90}${avg90}${diff90 ? ` (${diff90})` : ''}`)
  }
  return lines
}

function deletedTitle(d: Record<string, unknown>): string {
  const t = NOTIFY_TEXTS.deletedTitles
  if (d.table === 'purchases') return t.purchases
  if (d.table === 'cash_advances') return t.cash_advances
  if (d.table === 'movements') {
    if (d.movement_type === 'kirim') return t.kirim
    if (d.movement_type === 'chiqim') return t.chiqim
    return t.movements
  }
  return t.other
}

/** O'chirilgan/tiklangan yozuv qisqa tavsifi: "Sement M400 · 1 000 kg · 1 250 000 so‘m · Ali". */
function recordSummary(p: AlertPayload): string {
  const d = p.details
  const material = nameHtml(d.material_name) ?? nameHtml(p.material_name)
  const unit = typeof d.base_unit === 'string' && d.base_unit.trim() !== '' ? d.base_unit : p.base_unit
  const parts: (string | null)[] = []
  if (d.table === 'cash_advances') {
    parts.push(moneyText(d.amount), nameHtml(d.recipient_name))
  } else if (d.table === 'purchases') {
    parts.push(material, qtyText(d.qty_base, unit), moneyText(d.amount), nameHtml(d.buyer_name))
  } else {
    parts.push(material, qtyText(d.qty_base, unit), moneyText(d.amount))
  }
  return parts.filter((x) => x).join(' · ')
}

function restoredTitle(d: Record<string, unknown>): string {
  const t = NOTIFY_TEXTS.restoredTitles
  if (d.table === 'purchases') return t.purchases
  if (d.table === 'cash_advances') return t.cash_advances
  if (d.table === 'movements') {
    if (d.movement_type === 'kirim') return t.kirim
    if (d.movement_type === 'chiqim') return t.chiqim
    return t.movements
  }
  return t.other
}

/** Sana: ISO vaqt → Toshkent sanasi, "yyyy-mm-dd" → "dd.mm.yyyy". Noto'g'ri → null. */
function dateOnly(v: unknown): string | null {
  if (typeof v !== 'string' || v.trim() === '') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return formatDateIso(v.trim())
  const dt = formatDateTimeTashkent(v)
  return dt ? dt.slice(0, 10) : null
}

/** Batch 10: "Yozuv sanasi: 03.10.2026 (o'chirilganiga 12 kun)", "Tikladi: Admin", jiddiy ogohlantirish. */
function restoredLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.restored
  const d = p.details
  const lines = [recordSummary(p)]
  const object = nameHtml(p.object_name)
  if (object) lines.push(NOTIFY_TEXTS.deleted.object + object)
  const date = dateOnly(d.occurred_at)
  const days = formatDecimal(d.days_since, 0)
  const since = days !== null && !days.startsWith('-') ? t.daysSince(days) : null
  if (date) lines.push(`${t.recordDate}${date}${since ? ` (${since})` : ''}`)
  else if (since) lines.push(since)
  const actor = nameHtml(d.actor_name)
  if (actor) lines.push(t.actor + actor)
  if (p.severity === 'jiddiy') lines.push(t.pastReportsChange)
  return lines
}

function deletedLines(p: AlertPayload): { main: string; extra: string[] } {
  const t = NOTIFY_TEXTS.deleted
  const d = p.details
  const object = nameHtml(p.object_name)
  const parts = [recordSummary(p)]
  const extra: string[] = []
  if (object) extra.push(t.object + object)
  const actor = nameHtml(d.actor_name)
  if (actor) extra.push(t.actor + actor)
  return { main: parts.join(''), extra }
}

/** "Obyekt A · v2 → v3 (Ali)" — smeta o'zgarishi konteksti. */
function estimateContext(p: AlertPayload): string {
  const d = p.details
  if (d.kind === 'waste_changed') return wasteChangedLine(p)
  const t = NOTIFY_TEXTS.estimate
  const v = formatDecimal(d.version, 0)
  const prev = formatDecimal(d.prev_version, 0)
  let versions = ''
  if (d.kind === 'current_deleted') versions = v ? t.version(v) : ''
  else if (prev && v) versions = `${t.version(prev)} → ${t.version(v)}`
  else if (v) versions = t.version(v)
  const main = [nameHtml(p.object_name), versions || null].filter((x) => x).join(' · ')
  const actor = nameHtml(d.actor_name)
  return actor ? (main ? `${main} (${actor})` : `(${actor})`) : main
}

/** "Sement M400: 3 % → 15 % (Ali)" — isrof foizi o'zgarishi. */
function wasteChangedLine(p: AlertPayload): string {
  const d = p.details
  const pct = NOTIFY_TEXTS.percent
  const material = nameHtml(d.material_name) ?? nameHtml(p.material_name)
  const before = formatDecimal(d.before, 2)
  const after = formatDecimal(d.after, 2)
  let change = ''
  if (before !== null && after !== null) change = `${before} ${pct} → ${after} ${pct}`
  else if (after !== null) change = `${after} ${pct}`
  const main = material && change ? `${material}: ${change}` : (material ?? change)
  const actor = nameHtml(d.actor_name)
  return actor ? (main ? `${main} (${actor})` : `(${actor})`) : main
}

/** "• Sement: 1 000 → 1 250 kg (+25 %) ⚠️ chiqim eski normadan oshgan (1 100 kg)" */
function estimateMaterialLines(p: AlertPayload): string[] {
  const raw = p.details.materials
  if (!Array.isArray(raw)) return []
  const items = raw.filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
  // exceeded_before = true — birinchi (barqaror tartib)
  const sorted = [...items.filter((m) => m.exceeded_before === true), ...items.filter((m) => m.exceeded_before !== true)]
  return sorted.map((m) => {
    const unit = nameHtml(m.base_unit) ?? nameHtml(p.base_unit)
    const before = formatDecimal(m.before, 3)
    const after = formatDecimal(m.after, 3)
    const name = nameHtml(m.material_name) ?? '?'
    let qty = before !== null && after !== null ? `${before} → ${after}` : (after ?? before ?? '')
    if (qty && unit) qty += ` ${unit}`
    const pct = percentText(m.diff_pct)
    let line = `• ${name}${qty ? `: ${qty}` : ''}${pct ? ` (${pct})` : ''}`
    if (m.exceeded_before === true) {
      const consumed = formatDecimal(m.consumed, 3)
      line += ' ' + NOTIFY_TEXTS.estimate.exceededBefore(consumed === null ? null : unit ? `${consumed} ${unit}` : consumed)
    }
    return line
  })
}

/** `more_count` → manfiy bo'lmagan butun son. */
function moreCount(v: unknown): number {
  const mc = formatDecimal(v, 0)
  return mc !== null && !mc.startsWith('-') ? Number(mc.replace(/ /g, '')) : 0
}

/**
 * Ro'yxatli xabar: `before` qatorlari, `items` (sig'maguncha oxiridan qisqartiriladi,
 * "… va yana N ta" qayta hisoblanadi), `after` qatorlari. ≤ 4096 belgi.
 */
function fitWithList(before: string[], items: string[], baseMore: number, after: string[]): string {
  const build = (kept: string[], more: number) =>
    [...before, ...kept, more > 0 ? NOTIFY_TEXTS.estimate.more(count(more)) : '', ...after]
      .filter((l) => l !== '')
      .join('\n')
  const kept = [...items]
  let text = build(kept, baseMore)
  while (text.length > TELEGRAM_MAX_LENGTH && kept.length > 0) {
    kept.pop()
    text = build(kept, baseMore + items.length - kept.length)
  }
  return text.length <= TELEGRAM_MAX_LENGTH ? text : fitLines([...before, ...after])
}

/** Smeta o'zgarishi xabari — materiallar ro'yxati 4096 ga sig'maguncha qisqartiriladi. */
function formatEstimateMessage(p: AlertPayload, head: string, when: string | null): string {
  const materials = p.details.kind === 'norm_increase' ? estimateMaterialLines(p) : []
  return fitWithList([head, estimateContext(p)], materials, moreCount(p.details.more_count), [when ?? ''])
}

/** details.base_unit (bo'lsa) yoki payload.base_unit. */
function unitOf(p: AlertPayload): string | null {
  return typeof p.details.base_unit === 'string' && p.details.base_unit.trim() !== ''
    ? p.details.base_unit
    : p.base_unit
}

function estimateVersionLine(d: Record<string, unknown>): string {
  const v = formatDecimal(d.estimate_version, 0)
  return v ? NOTIFY_TEXTS.estimateVersion(v) : ''
}

/** 4-qoida: "Sarf: 1 250 kg, norma (isrof bilan): 1 050 kg (+19,05 %)", "Smeta v3". */
function normLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.norm
  const d = p.details
  const unit = unitOf(p)
  const consumed = qtyText(d.consumed_qty_base, unit)
  if (d.not_in_estimate === true) return consumed ? [t.notInEstimate + consumed] : []
  const allowed = qtyText(d.allowed_qty_base ?? d.norm_qty_base, unit)
  const pct = percentText(d.over_pct)
  const parts = [consumed ? t.consumed + consumed : null, allowed ? t.allowed + allowed : null].filter((x) => x)
  const lines: string[] = []
  if (parts.length) lines.push(parts.join(', ') + (pct && allowed ? ` (${pct})` : ''))
  lines.push(estimateVersionLine(d))
  return lines
}

/** 6-qoida: "So'raldi: 500 kg, smetada qolgan: 320 kg (ortiqcha 180 kg)", "Smeta v3". */
function requestLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.request
  const d = p.details
  const unit = unitOf(p)
  const requested = qtyText(d.requested_qty_base, unit)
  if (d.not_in_estimate === true) return requested ? [t.notInEstimate + requested] : []
  const available = qtyText(d.available_qty_base, unit)
  const over = qtyText(d.over_qty_base, unit)
  const parts = [requested ? t.requested + requested : null, available ? t.available + available : null].filter(
    (x) => x,
  )
  const lines: string[] = []
  if (parts.length) lines.push(parts.join(', ') + (over ? ` (${t.over(over)})` : ''))
  lines.push(estimateVersionLine(d))
  return lines
}

/** O'tkazma: "Sement M400: Obyekt A → Obyekt B", "Yuborildi: 100 kg, qabul: 90 kg (−10 kg)". */
function transferLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.transfer
  const d = p.details
  const unit = unitOf(p)
  const from = nameHtml(d.from_object_name)
  const to = nameHtml(d.to_object_name)
  const material = nameHtml(p.material_name)
  const first =
    from || to
      ? `${material ? `${material}: ` : ''}${from ?? '?'} → ${to ?? '?'}`
      : contextLine(p)
  const sent = qtyText(d.sent_qty_base, unit)
  if (d.direction === 'not_received') {
    const h = formatDecimal(d.hours, 0)
    const parts = [sent ? t.sent + sent : null, h !== null ? t.hoursAgo(h) : null].filter((x) => x)
    return [first, parts.join(', ')]
  }
  const received = qtyText(d.received_qty_base, unit)
  const diffRaw = formatDecimal(d.diff_qty_base, 3)
  let diff: string | null = null
  if (diffRaw !== null && diffRaw !== '0') {
    const abs = diffRaw.replace(/^-/, '')
    const sign =
      d.direction === 'over' ? '+' : d.direction === 'under' ? MINUS : diffRaw.startsWith('-') ? MINUS : '+'
    const u = nameHtml(unit)
    diff = `${sign}${abs}${u ? ` ${u}` : ''}`
  }
  const parts = [sent ? t.sent + sent : null, received ? t.received + received : null].filter((x) => x)
  return [first, parts.length ? parts.join(', ') + (diff ? ` (${diff})` : '') : '']
}

/** "• Sement: hisobda 500, sanaldi 420 kg (−80 kg, 104 000 so‘m)" */
function inventoryItemLines(p: AlertPayload): string[] {
  const raw = p.details.items
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => {
      const unit = nameHtml(m.base_unit)
      const name = nameHtml(m.material_name) ?? '?'
      const expected = formatDecimal(m.expected, 3)
      const counted = formatDecimal(m.counted, 3)
      const shortage = formatDecimal(m.shortage, 3)
      const value = moneyText(m.shortage_value)
      let main = ''
      if (expected !== null && counted !== null) {
        main = NOTIFY_TEXTS.inventory.expectedCounted(expected, counted) + (unit ? ` ${unit}` : '')
      }
      const extra = [
        shortage !== null && shortage !== '0' ? `${MINUS}${shortage.replace(/^-/, '')}${unit ? ` ${unit}` : ''}` : null,
        value,
      ].filter((x) => x)
      return `• ${name}${main ? `: ${main}` : ''}${extra.length ? ` (${extra.join(', ')})` : ''}`
    })
}

/** "• Armatura: hisobda 2 400 kg, 3 120 000 so‘m" — sanalmagan materiallar. */
function notCountedLines(p: AlertPayload): string[] {
  const raw = p.details.not_counted
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => {
      const name = nameHtml(m.material_name) ?? '?'
      const q = qtyText(m.expected, typeof m.base_unit === 'string' ? m.base_unit : null)
      const parts = [q !== null ? NOTIFY_TEXTS.inventory.expected(q) : null, moneyText(m.shortage_value)].filter(
        (x) => x,
      )
      return `• ${name}${parts.length ? `: ${parts.join(', ')}` : ''}`
    })
}

/**
 * Inventarizatsiya: kamomad ro'yxati, "Sanalmagan:" bo'limi, jami. 4096 dan oshsa, avval
 * sanalmaganlar, keyin kamomad qatorlari oxiridan olib tashlanadi ("… va yana N ta" qayta hisoblanadi).
 */
function formatInventoryMessage(p: AlertPayload, head: string, when: string | null): string {
  const d = p.details
  const t = NOTIFY_TEXTS.inventory
  const more = NOTIFY_TEXTS.estimate.more
  const items = inventoryItemLines(p)
  const missing = notCountedLines(p)
  const itemsMore = moreCount(d.more_count)
  const missingMore = moreCount(d.not_counted_more)
  const total = moneyText(d.total_shortage_value)
  const hasMissing = missing.length > 0 || missingMore > 0
  const build = (a: string[], b: string[]) => {
    const restA = itemsMore + items.length - a.length
    const restB = missingMore + missing.length - b.length
    return [
      head,
      contextLine(p),
      ...a,
      restA > 0 ? more(count(restA)) : '',
      hasMissing ? t.notCounted : '',
      ...b,
      restB > 0 ? more(count(restB)) : '',
      total ? t.total + total : '',
      inventoryDuringLine(d),
      when ?? '',
    ]
      .filter((l) => l !== '')
      .join('\n')
  }
  const a = [...items]
  const b = [...missing]
  let text = build(a, b)
  while (text.length > TELEGRAM_MAX_LENGTH && (a.length > 0 || b.length > 0)) {
    if (b.length > 0) b.pop()
    else a.pop()
    text = build(a, b)
  }
  return text.length <= TELEGRAM_MAX_LENGTH ? text : fitLines([head, contextLine(p), when ?? ''])
}

// ---------------------------------------------------------------------------
// Batch 12 — yangi alert turlari
// ---------------------------------------------------------------------------

/** Ishorali summa: "−50 000 so‘m" / "+50 000 so‘m" (`sign` = true bo'lsa musbatga ham "+"). */
function signedMoney(v: unknown, sign = false): string | null {
  const n = formatDecimal(v, 2)
  if (n === null) return null
  if (n.startsWith('-')) return `${MINUS}${n.slice(1)} ${NOTIFY_TEXTS.currency}`
  return `${sign && n !== '0' ? '+' : ''}${n} ${NOTIFY_TEXTS.currency}`
}

/** Ishorali miqdor: "−50 kg". */
function signedQty(v: unknown, unit: string | null): string | null {
  const q = qtyText(v, unit)
  return q === null ? null : q.startsWith('-') ? MINUS + q.slice(1) : q
}

/** Manfiy bo'lmagan butun son satri yoki null. */
function nonNegInt(v: unknown): string | null {
  const n = formatDecimal(v, 0)
  return n !== null && !n.startsWith('-') ? n : null
}

/** A: "Ochiq xarid bor edi…", "Miqdor: 100 kg", "Sana: 29.10.2026 14:32". */
function noSourceLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.noSource
  const d = p.details
  const reason = typeof d.reason === 'string' ? t[d.reason] : undefined
  const qty = qtyText(d.qty_base, unitOf(p))
  const at = typeof d.occurred_at === 'string' ? formatDateTimeTashkent(d.occurred_at) : null
  return [reason ?? '', qty ? t.qty + qty : '', at ? t.date + at : '']
}

/** B: "Qoldiq: −50 kg", "Oxirgi chiqim: 100 kg". */
function negativeStockLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.negativeStock
  const d = p.details
  const unit = typeof d.unit === 'string' && d.unit.trim() !== '' ? d.unit : unitOf(p)
  const stock = signedQty(d.stock_after, unit)
  const last = qtyText(d.qty_base, unit)
  const mt = typeof d.movement_type === 'string' ? d.movement_type : null
  // Audit: sabab istalgan tur bo'lishi mumkin — kirim / o'tkazma qabuli o'chirildi yoki kamaytirildi.
  if (d.movement_deleted === true || (mt !== null && mt !== 'chiqim' && mt !== 'transfer_out')) {
    const c = NOTIFY_TEXTS.negativeCause
    const typeLabel = (mt && NOTIFY_TEXTS.recordChange.movementTypes[mt]) ?? (mt ? nameHtml(mt) : null) ?? 'yozuv'
    const cause = d.movement_deleted === true ? c.deleted(typeLabel) : c.changed(typeLabel)
    return [stock ? t.stock + stock : '', cause + (last ? ` (${last})` : '')]
  }
  const label = mt === 'transfer_out' ? t.lastTransfer : t.lastChiqim
  return [stock ? t.stock + stock : '', last ? label + last : '']
}

/** C: takroriy yozuv yoki rasm. */
function duplicateLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.duplicate
  const d = p.details
  const table = typeof d.table === 'string' ? t.tables[d.table] : undefined
  if (d.kind === 'photo') {
    const first = typeof d.first_table === 'string' ? t.tables[d.first_table] : undefined
    return [t.photo + (table && first ? ` (${table} → ${first})` : '')]
  }
  const min = nonNegInt(d.window_minutes)
  const qty = qtyText(d.qty_base, unitOf(p))
  const amount = moneyText(d.total_amount)
  return [
    (min ? t.record(min) : t.recordNoWindow) + (table ? ` (${table})` : ''),
    [qty ? t.qty + qty : null, amount ? t.amount + amount : null].filter((x) => x).join(' · '),
  ]
}

/** D: "Kirim · Obyektdan 850 m uzoqda (ruxsat 300 m, aniqlik ±25 m)". */
function geoLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.geo
  const d = p.details
  const dist = nonNegInt(d.distance_m)
  if (dist === null) return []
  const extra = [nonNegInt(d.radius_m), nonNegInt(d.accuracy_m)]
  const parts = [extra[0] ? t.radius(extra[0]) : null, extra[1] ? t.accuracy(extra[1]) : null].filter((x) => x)
  const type = typeof d.movement_type === 'string' ? t.types[d.movement_type] : undefined
  return [`${type ? `${type} · ` : ''}${t.distance(dist)}${parts.length ? ` (${parts.join(', ')})` : ''}`]
}

/** F: obyekt, "3 ta chiqim, obyektda joriy smeta yo'q", sana, materiallar. */
function noEstimateMessage(p: AlertPayload, head: string, when: string | null): string {
  const t = NOTIFY_TEXTS.noEstimate
  const d = p.details
  const n = nonNegInt(d.count)
  const day = typeof d.day === 'string' ? dateOnly(d.day) : null
  const raw = Array.isArray(d.materials) ? d.materials : []
  const items = raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => {
      const q = qtyText(m.qty_base, typeof m.base_unit === 'string' ? m.base_unit : null)
      return `• ${nameHtml(m.material_name) ?? '?'}${q ? `: ${q}` : ''}`
    })
  const shown = items.slice(0, DIGEST_MAX_ITEMS)
  return fitWithList(
    [head, nameHtml(p.object_name) ?? '', n ? t.count(n) : '', day ? t.date + day : ''],
    shown,
    items.length - shown.length,
    [when ?? ''],
  )
}

/** G: "Chek: 1 450 000 so‘m, kiritilgan: 1 500 000 so‘m (+50 000 so‘m)", fiskal belgi. */
function receiptDiffLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.receiptDiff
  const d = p.details
  const receipt = moneyText(d.receipt_total)
  const entered = moneyText(d.total_amount)
  const diff = signedMoney(d.diff, true)
  const main = [receipt ? t.receipt + receipt : null, entered ? t.entered + entered : null].filter((x) => x).join(', ')
  const fiscal = nameHtml(d.receipt_fiscal_sign)
  return [main ? main + (diff ? ` (${diff})` : '') : '', fiscal ? t.fiscal + fiscal : '']
}

/** H: "So'raldi: 100 kg, xarid: 130 kg (+30 %) · 2 ta xarid", "Chegara: 20 %". */
function overbuyLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.overbuy
  const d = p.details
  const unit = unitOf(p)
  const req = qtyText(d.request_qty_base, unit)
  const bought = qtyText(d.purchased_qty_base, unit)
  const pct = percentText(d.over_pct, '+')
  const cnt = nonNegInt(d.purchase_count)
  const main = [req ? t.requested + req : null, bought ? t.purchased + bought : null].filter((x) => x).join(', ')
  const thr = formatDecimal(d.threshold_pct, 2)
  return [
    main ? `${main}${pct ? ` (${pct})` : ''}${cnt && cnt !== '1' && cnt !== '0' ? ` · ${t.purchases(cnt)}` : ''}` : '',
    thr !== null ? `${t.threshold}${thr} ${NOTIFY_TEXTS.percent}` : '',
  ]
}

/** I: podotchet muddati / manfiy balans. */
function cashAlertLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.cash
  const d = p.details
  const who = nameHtml(d.profile_name)
  if (p.type === 'podotchet_manfiy') {
    const bal = signedMoney(d.balance)
    return [who ? t.holder + who : '', bal ? t.negative + bal : '', t.negativeHint]
  }
  const bal = moneyText(d.balance)
  const days = nonNegInt(d.days_open)
  const max = nonNegInt(d.max_days)
  const since = typeof d.oldest_open_at === 'string' ? dateOnly(d.oldest_open_at) : null
  return [
    who ? t.holder + who : '',
    bal ? t.balance + bal : '',
    days ? t.daysOpen(days, max) : '',
    since ? t.since + since : '',
  ]
}

// ---------------------------------------------------------------------------
// Audit (20261108) — yangi alert turlari
// ---------------------------------------------------------------------------

const CHANGE_DATE_KEYS = ['occurred_at', 'purchased_at']
const CHANGE_MONEY_KEYS = ['total_amount', 'unit_price', 'price_per_base']
/** Qiymati id (uuid) bo'lgan ustunlar — qiymat ko'rsatilmaydi, faqat "o'zgardi". */
const CHANGE_ID_KEYS = ['object_id', 'material_id', 'purchase_id', 'buyer_id']
/** O'zgargan ustunlar ro'yxatida ko'pi bilan shuncha qator. */
const CHANGE_MAX_LINES = 12

function recordObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** O'zgargan ustun qiymati matni (HTML-xavfsiz). Bo'sh → "—". */
function changeValue(key: string, v: unknown, unit: string | null): string {
  const empty = NOTIFY_TEXTS.settingsChange.empty
  if (v === null || v === undefined || v === '') return empty
  if (CHANGE_DATE_KEYS.includes(key)) {
    const dt = typeof v === 'string' ? formatDateTimeTashkent(v) : null
    return dt ?? nameHtml(String(v)) ?? empty
  }
  if (CHANGE_MONEY_KEYS.includes(key)) return moneyText(v) ?? nameHtml(String(v)) ?? empty
  if (key === 'qty_base') return qtyText(v, unit) ?? empty
  if (key === 'type') {
    return typeof v === 'string' ? (NOTIFY_TEXTS.recordChange.movementTypes[v] ?? nameHtml(v) ?? empty) : empty
  }
  if (typeof v === 'number' || typeof v === 'string') return formatDecimal(v, 3) ?? nameHtml(String(v)) ?? empty
  if (typeof v === 'boolean') return v ? NOTIFY_TEXTS.settingsChange.yes : NOTIFY_TEXTS.settingsChange.no
  return empty
}

/** "5 qop" — miqdor kiritilgan birlik bilan. */
function inputQty(o: Record<string, unknown>): string {
  const q = formatDecimal(o.qty_input, 3)
  if (q === null) return NOTIFY_TEXTS.settingsChange.empty
  const u = nameHtml(o.unit_input)
  return u ? `${q} ${u}` : q
}

/** "• Miqdor: 5 qop → 7 qop", "• Obyekt o'zgardi" ... (alifbo tartibida, DB bergan `changed`). */
function recordChangeItems(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.recordChange
  const d = p.details
  const changed = Array.isArray(d.changed) ? d.changed.filter((k): k is string => typeof k === 'string') : []
  const before = recordObj(d.before)
  const after = recordObj(d.after)
  const unit = unitOf(p)
  const lines: string[] = []
  for (const key of changed) {
    const label = t.labels[key] ?? nameHtml(key) ?? '?'
    if (key === 'unit_id' && changed.includes('qty_input')) continue // birlik miqdor bilan birga
    if (key === 'qty_input') {
      lines.push(`• ${label}: ${inputQty(before)} → ${inputQty(after)}`)
      continue
    }
    if (key === 'unit_id') {
      const b = nameHtml(before.unit_input) ?? NOTIFY_TEXTS.settingsChange.empty
      const a = nameHtml(after.unit_input) ?? NOTIFY_TEXTS.settingsChange.empty
      lines.push(`• ${label}: ${b} → ${a}`)
      continue
    }
    if (CHANGE_ID_KEYS.includes(key)) {
      lines.push(`• ${label} ${t.changed}`)
      continue
    }
    lines.push(`• ${label}: ${changeValue(key, before[key], unit)} → ${changeValue(key, after[key], unit)}`)
  }
  if (lines.length > CHANGE_MAX_LINES) {
    const rest = lines.length - CHANGE_MAX_LINES
    return [...lines.slice(0, CHANGE_MAX_LINES), NOTIFY_TEXTS.estimate.more(count(rest))]
  }
  return lines
}

/** "O'zgartirdi: Admin (muallif: Ali) (tuzatish orqali)". */
function recordChangeActor(d: Record<string, unknown>): string {
  const t = NOTIFY_TEXTS.recordChange
  const actor = nameHtml(d.actor_name)
  const author = nameHtml(d.author_name)
  const sameAuthor =
    (typeof d.actor_profile_id === 'string' && d.actor_profile_id === d.author_id) || (actor !== null && actor === author)
  const parts = [actor ? t.actor + actor : '', author && !sameAuthor ? `(${t.author}${author})` : '', d.via === 'correct_entry' ? t.viaCorrect : '']
  return parts.filter((x) => x).join(' ')
}

function recordChangeTitle(type: string, d: Record<string, unknown>): string {
  const t = NOTIFY_TEXTS.recordChange
  if (d.via === 'cancel_own_entry') return NOTIFY_TEXTS.entryCancel.title
  if (type === 'yozuv_tuzatildi') return t.correctedTitle
  if (d.table === 'purchases') return t.titles.purchases ?? t.titles.other ?? ''
  if (d.table === 'movements') {
    if (d.movement_type === 'kirim') return t.titles.kirim ?? ''
    if (d.movement_type === 'chiqim') return t.titles.chiqim ?? ''
    return t.titles.movements ?? ''
  }
  return t.titles.other ?? ''
}

/** Material · obyekt (material details'da bo'lsa ham) + o'zgarishlar + kim. */
function recordChangeLines(p: AlertPayload): string[] {
  const d = p.details
  const material = nameHtml(p.material_name) ?? nameHtml(d.material_name)
  if (d.via === 'cancel_own_entry') return cancelOwnEntryLines(p)
  const ctx = [material, nameHtml(p.object_name)].filter((x) => x).join(' · ')
  return [ctx, ...recordChangeItems(p), reasonLine(d), recordChangeActor(d)]
}

/** Sozlama qiymati: vaqt "22:00", son, ha/yo'q, bo'sh "—". */
function settingValue(v: unknown): string {
  const t = NOTIFY_TEXTS.settingsChange
  if (v === null || v === undefined || v === '') return t.empty
  if (typeof v === 'boolean') return v ? t.yes : t.no
  if (typeof v === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(v)) return v.slice(0, 5)
  return formatDecimal(v, 2) ?? nameHtml(String(v)) ?? t.empty
}

function settingsChangeLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.settingsChange
  const raw = Array.isArray(p.details.changes) ? p.details.changes : []
  const items = raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && typeof (c as Record<string, unknown>).key === 'string')
    .map((c) => {
      const key = c.key as string
      return `• ${t.labels[key] ?? nameHtml(key) ?? '?'}: ${settingValue(c.before)} → ${settingValue(c.after)}`
    })
  const actor = nameHtml(p.details.actor_name)
  return [...items, actor ? t.actor + actor : '']
}

function roleLabel(v: unknown): string | null {
  return typeof v === 'string' ? (NOTIFY_TEXTS.roles[v] ?? nameHtml(v)) : null
}

function loginChangeLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.loginChange
  const d = p.details
  const target = [nameHtml(d.target_name), roleLabel(d.target_role)].filter((x) => x).join(' · ')
  const actorName = nameHtml(d.actor_name)
  const actorRole = roleLabel(d.actor_role)
  // actor_role null — aktyor boshqa firmaniki (tizim egasi)
  const actor = actorName ? (actorRole ? `${actorName} · ${actorRole}` : `${actorName} (${t.actorExternal})`) : actorRole === null ? t.actorExternal : null
  return [
    d.first_login === true ? NOTIFY_TEXTS.entryCancel.firstLogin : '',
    target ? t.target + target : '',
    actor ? t.actor + actor : '',
  ]
}

function cashFlagLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.cashFlag
  const d = p.details
  const reasons = Array.isArray(d.reasons) ? d.reasons : typeof d.reasons === 'string' ? [d.reasons] : []
  const reasonLines = reasons
    .filter((r): r is string => typeof r === 'string')
    .map((r) => t.reasons[r] ?? nameHtml(r) ?? '')
  const recipient = nameHtml(d.recipient_name)
  const amount = moneyText(d.amount)
  const date = typeof d.issued_at === 'string' ? formatDateTimeTashkent(d.issued_at) : null
  const actor = nameHtml(d.actor_name)
  return [
    ...reasonLines,
    recipient ? t.recipient + recipient : '',
    amount ? t.amount + amount : '',
    date ? t.date + date : '',
    actor ? t.actor + actor : '',
  ]
}

function sellerTinLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.sellerTin
  const d = p.details
  const receiptTin = nameHtml(d.seller_tin)
  const supplier = nameHtml(d.supplier_name)
  const supplierTin = nameHtml(d.supplier_tin)
  const fiscal = nameHtml(d.receipt_fiscal_sign)
  return [
    contextLine(p),
    receiptTin ? t.receipt + receiptTin : '',
    supplier ? `${t.supplier}${supplier} (${supplierTin ? t.supplierTin + supplierTin : t.noTin})` : '',
    fiscal ? t.fiscal + fiscal : '',
  ]
}

/** Inventarizatsiya: "Sanash paytida 3 ta harakat bo'ldi: Sement — 2, Qum — 1". */
function inventoryDuringLine(d: Record<string, unknown>): string {
  const raw = Array.isArray(d.movements_during_count) ? d.movements_during_count : []
  const items = raw.filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
  const total = nonNegInt(d.movements_during_count_total)
  const sum = items.reduce((acc, m) => acc + Number((nonNegInt(m.count) ?? '0').replace(/ /g, '')), 0)
  const n = total ?? (sum > 0 ? count(sum) : null)
  if (n === null || n === '0') return ''
  const parts = items.slice(0, 5).map((m) => `${nameHtml(m.material_name) ?? '?'} — ${nonNegInt(m.count) ?? '0'}`)
  const more = items.length > 5 ? `, ${NOTIFY_TEXTS.ellipsis}` : ''
  return `⚠️ ${NOTIFY_TEXTS.inventoryDuring.line(n)}${parts.length ? `: ${parts.join(', ')}${more}` : ''}`
}

// ---------------------------------------------------------------------------
// 2-tur (20261109) — yangi alert turlari va o'zgargan details
// ---------------------------------------------------------------------------

/** `details.reason` → "Sabab: …" (bo'sh → ''). */
function reasonLine(d: Record<string, unknown>): string {
  const r = typeof d.reason === 'string' ? d.reason.replace(/\s+/g, ' ').trim() : ''
  if (r === '') return ''
  const chars = Array.from(r)
  const clipped = chars.length > 300 ? chars.slice(0, 299).join('') + NOTIFY_TEXTS.ellipsis : r
  return NOTIFY_TEXTS.entryCancel.reason + escapeHtml(clipped)
}

/** Muallif bekor qilgan yozuv: miqdor · summa, sabab, kim. */
function cancelOwnEntryLines(p: AlertPayload): string[] {
  const d = p.details
  const material = nameHtml(p.material_name) ?? nameHtml(d.material_name)
  const ctx = [material, nameHtml(p.object_name)].filter((x) => x).join(' · ')
  const summary = [qtyText(d.qty_base, unitOf(p)), moneyText(d.amount)].filter((x) => x).join(' · ')
  const actor = nameHtml(d.actor_name) ?? nameHtml(d.author_name)
  return [ctx, summary, reasonLine(d), actor ? NOTIFY_TEXTS.workflow.cancelledBy + actor : '']
}

/** Boshqa odam nomidan xarid: xaridor, kim kiritdi, miqdor/summa, to'lov manbai, sana. */
function otherBuyerLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.otherBuyer
  const d = p.details
  const material = nameHtml(p.material_name) ?? nameHtml(d.material_name)
  const object = nameHtml(p.object_name) ?? nameHtml(d.object_name)
  const buyer = nameHtml(d.buyer_name)
  const actor = nameHtml(d.actor_name)
  const unit = typeof d.base_unit === 'string' && d.base_unit.trim() !== '' ? d.base_unit : p.base_unit
  const summary = [qtyText(d.qty_base, unit), moneyText(d.amount)].filter((x) => x).join(' · ')
  const source = typeof d.payment_source === 'string' ? NOTIFY_TEXTS.workflow.paymentSources[d.payment_source] : undefined
  const date = typeof d.purchased_at === 'string' ? formatDateTimeTashkent(d.purchased_at) : null
  const who = [buyer ? t.buyer + buyer : null, actor ? t.actor + actor : null].filter((x) => x).join(' · ')
  return [
    [material, object].filter((x) => x).join(' · '),
    who + (d.via === 'update' ? ` ${t.viaUpdate}` : ''),
    summary,
    source ? NOTIFY_TEXTS.workflow.payment + source : '',
    date ? t.date + date : '',
  ]
}

/** Sotuvchilar birlashtirildi: "Eski → Asosiy", ko'chirilgan xaridlar, to'ldirilgan maydonlar, kim. */
function supplierMergeLines(p: AlertPayload): string[] {
  const t = NOTIFY_TEXTS.supplierMerge
  const d = p.details
  const merged = nameHtml(d.merged_name) ?? '?'
  const keep = nameHtml(d.keep_name) ?? '?'
  const moved = nonNegInt(d.moved_count) ?? '0'
  const movedDeleted = nonNegInt(d.moved_deleted_count)
  const filledRaw = Array.isArray(d.filled) ? d.filled : []
  const filled = filledRaw
    .filter((k): k is string => typeof k === 'string')
    .map((k) => t.filledKeys[k] ?? nameHtml(k) ?? '')
    .filter((x) => x)
  const actor = nameHtml(d.actor_name)
  return [
    `${merged} → ${keep}`,
    t.moved(moved, movedDeleted && movedDeleted !== '0' ? movedDeleted : null),
    filled.length ? t.filled + filled.join(', ') : '',
    actor ? t.actor + actor : '',
  ]
}

/** Tur sarlavhasi (escape kerak emas — bizning matnimiz). */
function alertTitle(type: string, details: Record<string, unknown>): string {
  const titles = NOTIFY_TEXTS.alertTitles
  switch (type) {
    case 'xarid_qabul_farqi':
      return titles.xarid_qabul_farqi
    case 'ozi_qabul_qilgan':
      return titles.ozi_qabul_qilgan
    case 'narx_ogishi':
      return details.direction === 'high'
        ? titles.narx_high
        : details.direction === 'low'
          ? titles.narx_low
          : titles.narx_ogishi
    case 'yozuv_ochirildi':
      return deletedTitle(details)
    case 'yozuv_tiklandi':
      return restoredTitle(details)
    case 'normadan_oshish':
      return titles.normadan_oshish
    case 'inventarizatsiya_kamomadi':
      return titles.inventarizatsiya_kamomadi
    case 'smetadan_ortiq_sorov':
      return titles.smetadan_ortiq_sorov
    case 'otkazma_farqi':
      return details.direction === 'not_received' ? titles.otkazma_not_received : titles.otkazma_farqi
    case 'smeta_ozgarishi':
      if (details.kind === 'waste_changed') return titles.smeta_waste_changed
      return details.kind === 'norm_increase'
        ? titles.smeta_norm_increase
        : details.kind === 'old_version_restored'
          ? titles.smeta_old_version_restored
          : details.kind === 'current_deleted'
            ? titles.smeta_current_deleted
            : titles.smeta_ozgarishi
    case 'kirim_manbasiz':
      return titles.kirim_manbasiz
    case 'manfiy_qoldiq':
      return titles.manfiy_qoldiq
    case 'takroriy_yozuv':
      return details.kind === 'photo' ? titles.takroriy_rasm : titles.takroriy_yozuv
    case 'joylashuv_farqi':
      return titles.joylashuv_farqi
    case 'smetasiz_chiqim':
      return titles.smetasiz_chiqim
    case 'chek_farqi':
      return titles.chek_farqi
    case 'sorovdan_ortiq_xarid':
      return titles.sorovdan_ortiq_xarid
    case 'podotchet_muddati':
      return titles.podotchet_muddati
    case 'podotchet_manfiy':
      return titles.podotchet_manfiy
    case 'yozuv_ozgartirildi':
    case 'yozuv_tuzatildi':
      return recordChangeTitle(type, details)
    case 'sozlama_ozgardi':
      return titles.sozlama_ozgardi
    case 'login_ozgardi':
      return titles.login_ozgardi
    case 'podotchet_belgisi':
      return titles.podotchet_belgisi
    case 'sotuvchi_stir_farqi':
      return titles.sotuvchi_stir_farqi
    case 'xarid_boshqa_nomidan':
      return titles.xarid_boshqa_nomidan
    case 'sotuvchi_birlashtirildi':
      return titles.sotuvchi_birlashtirildi
    default:
      return NOTIFY_TEXTS.genericAlert
  }
}

/** `escalation` 1–3 bo'lsa (payload yoki details'da) — "📈 Kuchaydi: ". */
function escalationPrefix(p: AlertPayload): string {
  const raw = p.escalation ?? (p.details && typeof p.details === 'object' ? p.details.escalation : undefined)
  const e = formatDecimal(raw, 0)
  return e === '1' || e === '2' || e === '3' ? NOTIFY_TEXTS.escalated : ''
}

/** Ogohlantirish uchun Telegram HTML xabari (≤ 4096 belgi). */
export function formatAlertMessage(p: AlertPayload): string {
  const details = safeDetails(p)
  const payload: AlertPayload = { ...p, details }
  const lines: string[] = []
  const ctx = contextLine(payload)
  const head = `${escalationPrefix(payload)}${alertEmoji(payload.type, payload.severity, details)} <b>${alertTitle(payload.type, details)}</b>`
  const when = formatDateTimeTashkent(payload.created_at)
  if (payload.type === 'smeta_ozgarishi') return formatEstimateMessage(payload, head, when)
  if (payload.type === 'inventarizatsiya_kamomadi') return formatInventoryMessage(payload, head, when)
  if (payload.type === 'smetasiz_chiqim') return noEstimateMessage(payload, head, when)

  switch (payload.type) {
    case 'normadan_oshish':
      lines.push(ctx, ...normLines(payload))
      break
    case 'smetadan_ortiq_sorov':
      lines.push(ctx, ...requestLines(payload))
      break
    case 'otkazma_farqi':
      lines.push(...transferLines(payload))
      break
    case 'xarid_qabul_farqi':
      lines.push(ctx, ...receiptLines(payload))
      break
    case 'ozi_qabul_qilgan':
      lines.push(ctx, ...selfReceivedLines(payload))
      break
    case 'narx_ogishi':
      lines.push(ctx, ...priceLines(payload))
      break
    case 'yozuv_tiklandi':
      lines.push(...restoredLines(payload))
      break
    case 'yozuv_ochirildi': {
      const { main, extra } = deletedLines(payload)
      lines.push(main, ...extra)
      break
    }
    case 'kirim_manbasiz':
      lines.push(ctx, ...noSourceLines(payload))
      break
    case 'manfiy_qoldiq':
      lines.push(ctx, ...negativeStockLines(payload))
      break
    case 'takroriy_yozuv':
      lines.push(ctx, ...duplicateLines(payload))
      break
    case 'joylashuv_farqi':
      lines.push(ctx, ...geoLines(payload))
      break
    case 'chek_farqi':
      lines.push(ctx, ...receiptDiffLines(payload))
      break
    case 'sorovdan_ortiq_xarid':
      lines.push(ctx, ...overbuyLines(payload))
      break
    case 'podotchet_muddati':
    case 'podotchet_manfiy':
      lines.push(...cashAlertLines(payload))
      break
    case 'yozuv_ozgartirildi':
    case 'yozuv_tuzatildi':
      lines.push(...recordChangeLines(payload))
      break
    case 'sozlama_ozgardi':
      lines.push(...settingsChangeLines(payload))
      break
    case 'login_ozgardi':
      lines.push(...loginChangeLines(payload))
      break
    case 'podotchet_belgisi':
      lines.push(...cashFlagLines(payload))
      break
    case 'sotuvchi_stir_farqi':
      lines.push(...sellerTinLines(payload))
      break
    case 'xarid_boshqa_nomidan':
      lines.push(...otherBuyerLines(payload))
      break
    case 'sotuvchi_birlashtirildi':
      lines.push(...supplierMergeLines(payload))
      break
    default:
      lines.push(ctx)
  }

  return fitLines([head, ...lines, when ?? ''])
}

// ---------------------------------------------------------------------------
// Tur bo'yicha sanoq (hisobot va digest uchun umumiy)
// ---------------------------------------------------------------------------

const ALERT_TYPE_ORDER = [
  'xarid_qabul_farqi',
  'narx_ogishi',
  'yozuv_ochirildi',
  'yozuv_tiklandi',
  'normadan_oshish',
  'inventarizatsiya_kamomadi',
  'smetadan_ortiq_sorov',
  'otkazma_farqi',
  'smeta_ozgarishi',
  'manfiy_qoldiq',
  'chek_farqi',
  'smetasiz_chiqim',
  'podotchet_muddati',
  'takroriy_yozuv',
  'kirim_manbasiz',
  'joylashuv_farqi',
  'sorovdan_ortiq_xarid',
  'podotchet_manfiy',
  'yozuv_ozgartirildi',
  'sozlama_ozgardi',
  'login_ozgardi',
  'podotchet_belgisi',
  'sotuvchi_stir_farqi',
  'xarid_boshqa_nomidan',
  'sotuvchi_birlashtirildi',
  'yozuv_tuzatildi',
  'ozi_qabul_qilgan',
]

function typeRank(t: string): number {
  const i = ALERT_TYPE_ORDER.indexOf(t)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

/** "xarid/qabul — 2, narx — 1" (noldan katta turlar, qat'iy tartibda). */
function typeBreakdown(byType: Record<string, unknown>): string {
  const entries = Object.entries(byType && typeof byType === 'object' ? byType : {}).filter(([, n]) => {
    const c = formatDecimal(n, 0)
    return c !== null && c !== '0' && !c.startsWith('-')
  })
  entries.sort(([a], [b]) => typeRank(a) - typeRank(b) || (a < b ? -1 : a > b ? 1 : 0))
  return entries
    .map(([type, n]) => `${nameHtml(NOTIFY_TEXTS.alertShort[type] ?? type) ?? '?'} — ${count(n)}`)
    .join(', ')
}

// ---------------------------------------------------------------------------
// Digest — bir nechta ogohlantirish bitta xabarda
// ---------------------------------------------------------------------------

/**
 * Bir nechta ogohlantirish bitta xabarda: sarlavha, tur bo'yicha sanoq,
 * eng ko'pi 10 tasining bir qatorlik tavsifi, qolgani "… va yana N ta". ≤ 4096 belgi.
 * Bo'sh massiv — xato (chaqiruvchi bunday holatda xabar yubormasligi kerak).
 */
export function formatAlertDigest(payloads: AlertPayload[], opts: { reminder?: boolean } = {}): string {
  if (!Array.isArray(payloads) || payloads.length === 0) throw new Error(NOTIFY_TEXTS.digest.empty)
  const titleIcon = opts.reminder ? '⏰' : '⚠️'
  const titleText = opts.reminder ? NOTIFY_TEXTS.reminder.digestTitle : NOTIFY_TEXTS.digest.title
  const byType: Record<string, number> = {}
  for (const p of payloads) byType[p.type] = (byType[p.type] ?? 0) + 1

  const shown = payloads.slice(0, DIGEST_MAX_ITEMS)
  const items = shown.map((p) => {
    const details = safeDetails(p)
    const ctx =
      p.type === 'yozuv_ochirildi' || p.type === 'yozuv_tiklandi'
        ? [nameHtml(details.material_name) ?? nameHtml(p.material_name), nameHtml(p.object_name)]
            .filter((x) => x)
            .join(' · ')
        : p.type === 'smeta_ozgarishi'
          ? estimateContext({ ...p, details })
          : p.type === 'otkazma_farqi'
            ? (transferLines({ ...p, details })[0] ?? '')
            : p.type === 'podotchet_muddati' || p.type === 'podotchet_manfiy'
              ? (nameHtml(details.profile_name) ?? '')
              : p.type === 'podotchet_belgisi'
                ? (nameHtml(details.recipient_name) ?? '')
                : p.type === 'login_ozgardi'
                  ? (nameHtml(details.target_name) ?? '')
                  : p.type === 'sozlama_ozgardi'
                    ? (nameHtml(details.actor_name) ?? '')
                    : contextLine(p) || (nameHtml(details.material_name) ?? '')
    const head = `${escalationPrefix(p)}${alertEmoji(p.type, p.severity, details)} ${alertTitle(p.type, details)}`
    return ctx ? `${head}: ${ctx}` : head
  })
  const rest = payloads.length - shown.length

  const lines = [
    `${titleIcon} <b>${titleText(count(payloads.length))}</b>`,
    typeBreakdown(byType),
    ...items,
  ]
  if (rest > 0) lines.push(NOTIFY_TEXTS.digest.more(count(rest)))
  const text = lines.filter((l) => l !== '').join('\n')
  if (text.length <= TELEGRAM_MAX_LENGTH) return text
  // Sig'masa: oxirgi tavsiflarni olib tashlab, "… va yana N ta" ni qayta hisoblaymiz.
  const fixed = lines.slice(0, 2).filter((l) => l !== '')
  const kept = [...items]
  while (kept.length > 0) {
    kept.pop()
    const more = NOTIFY_TEXTS.digest.more(count(payloads.length - kept.length))
    const t = [...fixed, ...kept, more].join('\n')
    if (t.length <= TELEGRAM_MAX_LENGTH) return t
  }
  return fitLines([...fixed, NOTIFY_TEXTS.digest.more(count(payloads.length))])
}

// ---------------------------------------------------------------------------
// Kunlik hisobot
// ---------------------------------------------------------------------------

/** Kunlik hisobot (direktor uchun) — Telegram HTML (≤ 4096 belgi). */
export function formatDailyReport(p: DailyReportPayload): string {
  const t = NOTIFY_TEXTS.report
  const company = nameHtml(p.company_name)
  const period = formatPeriod(p.period_start, p.period_end)
  const breakdown = typeBreakdown(p.alerts_by_type)
  const sum = moneyText(p.purchases_sum) ?? `0 ${NOTIFY_TEXTS.currency}`
  const failed = count(p.failed_count)
  const positive = (v: unknown): string | null => {
    const c = count(v)
    return c !== '0' && !c.startsWith('-') ? c : null
  }
  const pending = positive(p.transfers_pending_count)
  const restored = positive(p.restored_count)
  const noEstimate = positive(p.chiqim_without_estimate_count)
  const lowStock = positive(p.low_stock_count)
  const geoDenied = positive(p.geo_denied_count)
  const geoUnavailable = positive(p.geo_unavailable_count)
  const backdated = positive(p.backdated_count)
  const manualClosed = positive(p.manual_closed_count)
  const stuckPending = positive(p.stuck_pending_count)
  const failed7d = positive(p.failed_7d_count)
  /** Musbat summa (matn) → "1 250 000 so‘m", 0 / manfiy / yo'q → null. */
  const positiveMoney = (v: unknown): string | null => {
    const n = formatDecimal(v, 2)
    return n !== null && n !== '0' && !n.startsWith('-') ? `${n} ${NOTIFY_TEXTS.currency}` : null
  }
  const cashOutstanding = positiveMoney(p.cash_outstanding_sum)
  const cashOwed = positiveMoney(p.cash_owed_to_staff_sum)
  return fitLines([
    `📊 <b>${t.title} · ${formatDateIso(p.date)}</b>`,
    period ?? '',
    company ?? '',
    `${t.kirim}${count(p.kirim_count)} · ${t.chiqim}${count(p.chiqim_count)}`,
    noEstimate ? t.chiqimWithoutEstimate + noEstimate : '',
    `${t.purchases}${count(p.purchases_count)}${t.pieces}, ${sum}`,
    `${t.requests}${count(p.requests_count)}`,
    pending ? t.transfersPending + pending : '',
    `${t.alertsNew}${count(p.alerts_new)}${breakdown ? ` (${breakdown})` : ''}`,
    `${t.selfReceived}${count(p.self_received_count)}`,
    `${t.deleted}${count(p.deleted_count)}`,
    restored ? t.restored + restored : '',
    lowStock ? `📉 ${t.lowStock}${lowStock}` : '',
    geoDenied ? t.geoDenied + geoDenied : '',
    geoUnavailable ? t.geoUnavailable + geoUnavailable : '',
    backdated ? t.backdated + backdated : '',
    manualClosed ? t.manualClosed + manualClosed : '',
    cashOutstanding ? t.cashOutstanding + cashOutstanding : '',
    cashOwed ? t.cashOwed + cashOwed : '',
    failed !== '0' && !failed.startsWith('-') ? `⚠️ ${t.failed}${failed}` : '',
    stuckPending ? `⚠️ ${t.stuckPending}${stuckPending}` : '',
    failed7d ? `⚠️ ${t.failed7d}${failed7d}` : '',
  ])
}

// ---------------------------------------------------------------------------
// Batch 12 — eslatma, muddati o'tgan so'rovlar, haftalik podotchet
// ---------------------------------------------------------------------------

/**
 * Ko'rilmagan alert eslatmasi: "⏰ Eslatma · 49 soatdan beri ko'rilmagan" + asl alert xabari
 * (≤ 4096 belgi — oxiridan butun qatorlar olib tashlanadi).
 */
export function formatAlertReminder(p: AlertReminderPayload): string {
  const hours = nonNegInt(p.hours_open)
  const body = formatAlertMessage(p)
  return fitLines([`⏰ <i>${NOTIFY_TEXTS.reminder.head(hours)}</i>`, ...body.split('\n')])
}

/** Muddati o'tgan tasdiqlangan so'rovlar ro'yxati (taminotchi va admin uchun). */
export function formatRequestOverdue(p: RequestOverduePayload): string {
  const t = NOTIFY_TEXTS.overdue
  const raw = Array.isArray(p.requests) ? p.requests : []
  const items = raw
    .filter((r): r is OverdueRequestItem => !!r && typeof r === 'object')
    .map((r) => {
      const material = nameHtml(r.material_name) ?? '?'
      const input = formatDecimal(r.qty_input, 3)
      const inputUnit = nameHtml(r.unit_input)
      const base = qtyText(r.qty_base, r.base_unit)
      let qty = input !== null ? `${input}${inputUnit ? ` ${inputUnit}` : ''}` : (base ?? '')
      if (input !== null && base !== null && inputUnit !== nameHtml(r.base_unit)) qty += ` (${base})`
      const due = typeof r.needed_by === 'string' ? dateOnly(r.needed_by) : null
      const parts = [
        `${material}${qty ? ` — ${qty}` : ''}`,
        nameHtml(r.object_name),
        due ? t.due(due, nonNegInt(r.days_overdue)) : null,
        nameHtml(r.created_by_name),
      ].filter((x) => x)
      return `• ${parts.join(' · ')}`
    })
  const total = nonNegInt(p.count)
  const totalNum = total === null ? items.length : Number(total.replace(/ /g, ''))
  return fitWithList(
    [
      `⏰ <b>${t.title} · ${formatDateIso(p.date)}</b>`,
      nameHtml(p.company_name) ?? '',
      t.intro(count(Math.max(totalNum, items.length))),
    ],
    items,
    Math.max(0, totalNum - items.length),
    [],
  )
}

/** Haftalik podotchet xabari — pul egasiga shaxsan. */
export function formatCashStatement(p: CashStatementPayload): string {
  const t = NOTIFY_TEXTS.cashStatement
  const zero = `0 ${NOTIFY_TEXTS.currency}`
  const start = typeof p.period_start === 'string' ? dateOnly(p.period_start) : null
  const end = typeof p.period_end === 'string' ? dateOnly(p.period_end) : null
  const period = start && end ? `${start} – ${end}` : formatDateIso(p.date)
  const balRaw = toDecString(p.balance)
  const negative = balRaw !== null && balRaw.startsWith('-') && formatDecimal(balRaw, 2) !== '0'
  const balLine = negative
    ? `${t.overspent}${moneyText(balRaw.slice(1)) ?? zero}`
    : `${t.balance}<b>${moneyText(p.balance) ?? zero}</b>`
  const oldest = typeof p.oldest_open_date === 'string' ? dateOnly(p.oldest_open_date) : null
  return fitLines([
    `💵 <b>${t.title} · ${period}</b>`,
    nameHtml(p.profile_name) ?? '',
    nameHtml(p.company_name) ?? '',
    t.week,
    `${t.issued}${moneyText(p.issued_week) ?? zero}`,
    `${t.spent}${moneyText(p.spent_week) ?? zero}`,
    `${t.returned}${moneyText(p.returned_week) ?? zero}`,
    balLine,
    oldest && !negative ? t.oldest(oldest, nonNegInt(p.days_open)) : '',
  ])
}

// ---------------------------------------------------------------------------
// Batch 11 — xatolik haqida xabar
// ---------------------------------------------------------------------------

/** Xabar matni uchun himoya chegarasi (bazada ≤ 500; bu — ehtiyot uchun). */
const BUG_MESSAGE_MAX = 1000

/**
 * Xatolik xabari: sarlavha, kim (ism · rol), firma, ekran, matn (escape, kesilgan bo'lsa "…"),
 * qurilma/versiya (kursiv), rasm belgisi, vaqt. ≤ 4096 belgi.
 */
export function formatBugReport(p: BugReportPayload): string {
  const t = NOTIFY_TEXTS.bugReport
  const role = typeof p.reporter_role === 'string' ? (NOTIFY_TEXTS.roles[p.reporter_role] ?? nameHtml(p.reporter_role)) : null
  const who = [nameHtml(p.reporter_name) ?? t.unknownReporter, role].filter((x) => x).join(' · ')
  const company = nameHtml(p.company_name)
  const screen = nameHtml(p.screen)
  let message = typeof p.message === 'string' ? p.message.replace(/\r\n?/g, '\n').trim() : ''
  let truncated = p.message_truncated === true
  if (Array.from(message).length > BUG_MESSAGE_MAX) {
    message = Array.from(message).slice(0, BUG_MESSAGE_MAX).join('')
    truncated = true
  }
  const body = message === '' ? `<i>${t.noMessage}</i>` : `<blockquote>${escapeHtml(message)}${truncated ? NOTIFY_TEXTS.ellipsis : ''}</blockquote>`
  const version = typeof p.app_version === 'string' && p.app_version.trim() !== '' ? t.version(p.app_version.trim()) : null
  const device = [nameHtml(p.client), nameHtml(version)].filter((x) => x).join(' · ')
  return fitLines([
    `🐞 <b>${t.title}</b>`,
    who,
    company ? t.company + company : '',
    screen ? t.screen + screen : '',
    body,
    device ? `<i>${device}</i>` : '',
    p.has_photo === true ? t.photo : '',
    formatDateTimeTashkent(p.created_at) ?? '',
  ])
}

/**
 * Veb panel "Sozlamalar → Xatoliklar" havolasi: Mini App URL'dan oxirgi `/tg` olib tashlanadi,
 * `/settings?tab=bugs` qo'shiladi. "https://x.uz/tg" → "https://x.uz/settings?tab=bugs".
 */
export function webBugsUrl(miniAppUrl: string): string {
  try {
    const u = new URL(miniAppUrl)
    const base = u.pathname.replace(/\/+$/, '').replace(/\/tg$/, '')
    return `${u.origin}${base}/settings?tab=bugs`
  } catch {
    return miniAppUrl
  }
}

/** Xatolik xabari tugmasi: "Ochish" — oddiy `url` (veb panel, Mini App emas). */
export function bugReportKeyboard(miniAppUrl: string): InlineKeyboard {
  return { inline_keyboard: [[{ text: NOTIFY_TEXTS.buttons.open, url: webBugsUrl(miniAppUrl) }]] }
}

// ---------------------------------------------------------------------------
// Audit (20261108) — ish oqimi xabarlari (docs/audit-fixes.md, "Bildirishnoma payloadlari")
// ---------------------------------------------------------------------------

/** request_created / request_decided / request_approved payloadi. */
export interface RequestWorkflowPayload {
  request_id: string
  company_name: string | null
  status: string | null
  object_id?: string | null
  object_name: string | null
  material_id?: string | null
  material_name: string | null
  qty_input: number | string | null
  unit_input: string | null
  qty_base: number | string | null
  base_unit: string | null
  needed_by: string | null
  note: string | null
  decision_note: string | null
  created_by_name: string | null
  decided_by_name: string | null
  created_at: string | null
  decided_at: string | null
}

export interface TransferSentPayload {
  transfer_id: string
  company_name: string | null
  from_object_id?: string | null
  from_object_name: string | null
  to_object_id?: string | null
  to_object_name: string | null
  material_id?: string | null
  material_name: string | null
  qty_input: number | string | null
  unit_input: string | null
  qty_base: number | string | null
  base_unit: string | null
  note: string | null
  sent_by_name: string | null
  created_at: string | null
}

export interface PurchaseForObjectPayload {
  purchase_id: string
  company_name: string | null
  object_id?: string | null
  object_name: string | null
  material_id?: string | null
  material_name: string | null
  qty_input: number | string | null
  unit_input: string | null
  qty_base: number | string | null
  base_unit: string | null
  buyer_id?: string | null
  buyer_name: string | null
  supplier_name: string | null
  purchased_at: string | null
}

export interface LoginChangedPayload {
  alert_id: string | null
  profile_id: string
  profile_name: string | null
  company_name: string | null
  actor_name: string | null
  changed_at: string | null
  /** 2-tur: birinchi marta login berildi (almashtirish emas). */
  first_login?: boolean | null
}

/** Foydalanuvchi izohi uchun maksimal uzunlik (escape'dan oldin). */
const NOTE_MAX = 300

/** Izoh: qisqartiriladi va escape qilinadi; bo'sh → null. */
function noteHtml(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  if (s === '') return null
  const chars = Array.from(s)
  return escapeHtml(chars.length > NOTE_MAX ? chars.slice(0, NOTE_MAX - 1).join('') + NOTIFY_TEXTS.ellipsis : s)
}

/** "2,5 qop (125 kg)" — kiritilgan birlik va (farq qilsa) asosiy birlikda. */
function workflowQty(p: { qty_input: unknown; unit_input: unknown; qty_base: unknown; base_unit: unknown }): string | null {
  const input = formatDecimal(p.qty_input, 3)
  const inputUnit = nameHtml(p.unit_input)
  const base = qtyText(p.qty_base, typeof p.base_unit === 'string' ? p.base_unit : null)
  if (input === null) return base
  const main = inputUnit ? `${input} ${inputUnit}` : input
  return base !== null && inputUnit !== nameHtml(p.base_unit) ? `${main} (${base})` : main
}

function isoTime(v: unknown): string {
  return typeof v === 'string' ? (formatDateTimeTashkent(v) ?? '') : ''
}

/** Material · obyekt, miqdor, kerak sanasi — so'rov xabarlari uchun umumiy. */
function requestCore(p: RequestWorkflowPayload): string[] {
  const t = NOTIFY_TEXTS.workflow
  const needed = typeof p.needed_by === 'string' ? dateOnly(p.needed_by) : null
  return [
    [nameHtml(p.material_name), nameHtml(p.object_name)].filter((x) => x).join(' · '),
    workflowQty(p) ?? '',
    needed ? t.neededBy + needed : '',
  ]
}

/** Admin'larga: yangi so'rov. */
export function formatRequestCreated(p: RequestWorkflowPayload): string {
  const t = NOTIFY_TEXTS.workflow
  const note = noteHtml(p.note)
  const by = nameHtml(p.created_by_name)
  return fitLines([
    `📝 <b>${t.requestCreated}</b>`,
    ...requestCore(p),
    note ? t.note + note : '',
    by ? t.requestedBy + by : '',
    isoTime(p.created_at),
  ])
}

/** So'rov muallifiga: tasdiqlandi / rad etildi (+ qaror izohi). */
export function formatRequestDecided(p: RequestWorkflowPayload): string {
  const t = NOTIFY_TEXTS.workflow
  const head =
    p.status === 'tasdiqlandi'
      ? `✅ <b>${t.requestApproved}</b>`
      : p.status === 'rad'
        ? `❌ <b>${t.requestRejected}</b>`
        : `📝 <b>${t.requestDecided}</b>`
  const decision = noteHtml(p.decision_note)
  const by = nameHtml(p.decided_by_name)
  return fitLines([
    head,
    ...requestCore(p),
    decision ? (p.status === 'rad' ? t.rejectNote : t.decisionNote) + decision : '',
    by ? t.decidedBy + by : '',
    isoTime(p.decided_at ?? p.created_at),
  ])
}

/** Ta'minotchilarga: tasdiqlangan so'rov — sotib olish kerak. */
export function formatRequestApproved(p: RequestWorkflowPayload): string {
  const t = NOTIFY_TEXTS.workflow
  const note = noteHtml(p.note)
  const decision = noteHtml(p.decision_note)
  const by = nameHtml(p.created_by_name)
  const approver = nameHtml(p.decided_by_name)
  const people = [by ? t.requestedBy + by : null, approver ? t.approvedBy + approver : null].filter((x) => x).join(' · ')
  return fitLines([
    `🛒 <b>${t.buyNeeded}</b>`,
    ...requestCore(p),
    note ? t.note + note : '',
    decision ? t.decisionNote + decision : '',
    people,
    isoTime(p.decided_at ?? p.created_at),
  ])
}

/** Qabul qiluvchi obyekt xodimlariga: o'tkazma yo'lda. */
export function formatTransferSent(p: TransferSentPayload): string {
  const t = NOTIFY_TEXTS.workflow
  const material = nameHtml(p.material_name)
  const route = `${nameHtml(p.from_object_name) ?? '?'} → ${nameHtml(p.to_object_name) ?? '?'}`
  const note = noteHtml(p.note)
  const by = nameHtml(p.sent_by_name)
  return fitLines([
    `🚚 <b>${t.transferSent}</b>`,
    material ? `${material}: ${route}` : route,
    workflowQty(p) ?? '',
    note ? t.note + note : '',
    by ? t.sentBy + by : '',
    isoTime(p.created_at),
  ])
}

/** Obyekt xodimlariga: "Ali sotib oldi, obyektga keladi". */
export function formatPurchaseForObject(p: PurchaseForObjectPayload): string {
  const t = NOTIFY_TEXTS.workflow
  const buyer = nameHtml(p.buyer_name)
  const supplier = nameHtml(p.supplier_name)
  return fitLines([
    `🛒 <b>${buyer ? t.purchaseFor(buyer) : t.purchaseForUnknown}</b>`,
    [nameHtml(p.material_name), nameHtml(p.object_name)].filter((x) => x).join(' · '),
    workflowQty(p) ?? '',
    supplier ? t.supplier + supplier : '',
    isoTime(p.purchased_at),
  ])
}

/** Login egasiga: loginingiz o'zgartirildi — siz bo'lmasangiz adminga ayting. */
export function formatLoginChanged(p: LoginChangedPayload): string {
  const t = NOTIFY_TEXTS.workflow
  const actor = nameHtml(p.actor_name)
  return fitLines([
    `🔐 <b>${p.first_login === true ? t.loginFirstTitle : t.loginTitle}</b>`,
    nameHtml(p.profile_name) ?? '',
    actor ? t.loginActor + actor : '',
    isoTime(p.changed_at),
    `⚠️ ${t.loginWarn}`,
  ])
}

// ---------------------------------------------------------------------------
// 2-tur (20261109) — yangi ish oqimi xabarlari va dayjest
// ---------------------------------------------------------------------------

export interface TransferWorkflowPayload extends TransferSentPayload {
  status?: string | null
  received_qty_base?: number | string | null
  cancel_reason?: string | null
  sent_by_id?: string | null
  received_by_name?: string | null
  received_at?: string | null
  cancelled_by_id?: string | null
  cancelled_by_name?: string | null
  cancelled_at?: string | null
}

export interface PurchaseDeletedPayload extends PurchaseForObjectPayload {
  deleted_at: string | null
  deleted_by_name: string | null
  reason: string | null
}

export interface PurchaseOnYourNamePayload {
  purchase_id: string
  alert_id?: string | null
  company_name: string | null
  buyer_id?: string | null
  buyer_name: string | null
  actor_name: string | null
  object_id?: string | null
  object_name: string | null
  material_id?: string | null
  material_name: string | null
  qty_input: number | string | null
  unit_input: string | null
  qty_base: number | string | null
  base_unit: string | null
  total_amount: number | string | null
  payment_source: string | null
  purchased_at: string | null
}

export interface InventoryAppliedPayload {
  count_id: string
  company_name: string | null
  object_id?: string | null
  object_name: string | null
  counted_at: string | null
  submitted_at: string | null
  applied_at: string | null
  applied_by_name: string | null
  items_count: number | string | null
  adjusted_count: number | string | null
}

export interface AlertsDigestItem {
  alert_id?: string
  request_id?: string | null
  object_id?: string | null
  object_name?: string | null
  material_id?: string | null
  material_name?: string | null
  over_qty_base?: number | string | null
  base_unit?: string | null
}

export interface AlertsDigestPayload {
  company_name: string | null
  alert_type: string
  count: number | string
  alert_ids?: string[]
  items: AlertsDigestItem[]
  more_count: number | string | null
  created_at: string | null
}

/** "Sement: A → B" */
function transferRoute(p: { material_name: unknown; from_object_name: unknown; to_object_name: unknown }): string {
  const route = `${nameHtml(p.from_object_name) ?? '?'} → ${nameHtml(p.to_object_name) ?? '?'}`
  const material = nameHtml(p.material_name)
  return material ? `${material}: ${route}` : route
}

/** Qabul qiluvchi obyekt xodimlariga: o'tkazma bekor qilindi. */
export function formatTransferCancelled(p: TransferWorkflowPayload): string {
  const t = NOTIFY_TEXTS.workflow
  const reason = noteHtml(p.cancel_reason)
  const by = nameHtml(p.cancelled_by_name)
  return fitLines([
    `🚫 <b>${t.transferCancelled}</b>`,
    transferRoute(p),
    workflowQty(p) ?? '',
    reason ? t.cancelReason + reason : '',
    by ? t.cancelledBy + by : '',
    isoTime(p.cancelled_at ?? p.created_at),
  ])
}

/** Yuboruvchiga: o'tkazma qabul qilindi ("Yuborildi: 3 qop (150 kg), qabul: 145 kg (−5 kg)"). */
export function formatTransferReceived(p: TransferWorkflowPayload): string {
  const t = NOTIFY_TEXTS.workflow
  const unit = typeof p.base_unit === 'string' ? p.base_unit : null
  const sent = workflowQty(p)
  const received = qtyText(p.received_qty_base, unit)
  let diff = ''
  const a = toDecString(p.received_qty_base)
  const b = toDecString(p.qty_base)
  if (a !== null && b !== null) {
    const scale = Math.max((a.split('.')[1] ?? '').length, (b.split('.')[1] ?? '').length)
    const toInt = (s: string) => {
      const neg = s.startsWith('-')
      const [i = '0', f = ''] = (neg ? s.slice(1) : s).split('.')
      const v = BigInt(i + (f + '0'.repeat(scale)).slice(0, scale))
      return neg ? -v : v
    }
    const d = toInt(a) - toInt(b)
    if (d !== 0n) {
      const abs = (d < 0n ? -d : d).toString().padStart(scale + 1, '0')
      const str = scale > 0 ? `${abs.slice(0, -scale)}.${abs.slice(-scale)}` : abs
      const q = qtyText(str, unit)
      if (q) diff = ` (${d < 0n ? MINUS : '+'}${q})`
    }
  }
  const by = nameHtml(p.received_by_name)
  const amounts = [sent ? t.sent + sent : null, received ? t.received + received + diff : null].filter((x) => x).join(', ')
  return fitLines([
    `📦 <b>${t.transferReceived}</b>`,
    transferRoute(p),
    amounts,
    by ? t.receivedBy + by : '',
    isoTime(p.received_at ?? p.created_at),
  ])
}

/** Obyekt xodimlariga: kutilgan xarid bekor qilindi. */
export function formatPurchaseDeleted(p: PurchaseDeletedPayload): string {
  const t = NOTIFY_TEXTS.workflow
  const buyer = nameHtml(p.buyer_name)
  const by = nameHtml(p.deleted_by_name)
  const reason = noteHtml(p.reason)
  return fitLines([
    `🗑 <b>${t.purchaseDeleted}</b>`,
    [nameHtml(p.material_name), nameHtml(p.object_name)].filter((x) => x).join(' · '),
    workflowQty(p) ?? '',
    buyer ? t.buyer + buyer : '',
    by ? t.deletedBy + by : '',
    reason ? t.reason + reason : '',
    isoTime(p.deleted_at),
  ])
}

/** Xaridorga: uning nomiga boshqa odam xarid kiritdi. */
export function formatPurchaseOnYourName(p: PurchaseOnYourNamePayload): string {
  const t = NOTIFY_TEXTS.workflow
  const actor = nameHtml(p.actor_name)
  const source = typeof p.payment_source === 'string' ? t.paymentSources[p.payment_source] : undefined
  const summary = [workflowQty(p), moneyText(p.total_amount)].filter((x) => x).join(' · ')
  return fitLines([
    `⚠️ <b>${t.purchaseOnYourName}</b>`,
    [nameHtml(p.material_name), nameHtml(p.object_name)].filter((x) => x).join(' · '),
    summary,
    source ? t.payment + source : '',
    actor ? t.enteredBy + actor : '',
    isoTime(p.purchased_at),
    t.purchaseOnYourNameWarn,
  ])
}

/** Hisob muallifiga: inventarizatsiya qo'llandi (miqdorlarsiz — ko'r-ko'rona sanash). */
export function formatInventoryApplied(p: InventoryAppliedPayload): string {
  const t = NOTIFY_TEXTS.workflow
  const items = nonNegInt(p.items_count)
  const adjusted = nonNegInt(p.adjusted_count)
  const by = nameHtml(p.applied_by_name)
  return fitLines([
    `📋 <b>${t.inventoryApplied}</b>`,
    nameHtml(p.object_name) ?? '',
    items !== null || adjusted !== null ? t.inventoryCounts(items ?? '0', adjusted ?? '0') : '',
    by ? t.appliedBy + by : '',
    isoTime(p.applied_at),
  ])
}

/** Direktor va adminlarga: bir xil turdagi bir nechta alert bitta xabarda ("7 ta: …", ro'yxat, "+N ta"). */
export function formatAlertsDigest(p: AlertsDigestPayload): string {
  const t = NOTIFY_TEXTS.alertsDigest
  const type = typeof p.alert_type === 'string' ? p.alert_type : ''
  const raw = Array.isArray(p.items) ? p.items : []
  const items = raw
    .filter((it): it is AlertsDigestItem => !!it && typeof it === 'object')
    .map((it) => {
      const ctx = [nameHtml(it.material_name), nameHtml(it.object_name)].filter((x) => x).join(' · ') || '?'
      const over = qtyText(it.over_qty_base, typeof it.base_unit === 'string' ? it.base_unit : null)
      return `• ${ctx}${over ? ` — ${t.over(over)}` : ''}`
    })
  const total = nonNegInt(p.count) ?? count(items.length)
  const baseMore = Number((nonNegInt(p.more_count) ?? '0').replace(/ /g, ''))
  const head = `${alertEmoji(type, 'ogohlantirish')} <b>${t.title(total, alertTitle(type, {}))}</b>`
  const build = (kept: string[]) => {
    const rest = baseMore + items.length - kept.length
    return [head, nameHtml(p.company_name) ?? '', ...kept, rest > 0 ? t.more(count(rest)) : '', isoTime(p.created_at)]
      .filter((l) => l !== '')
      .join('\n')
  }
  const kept = [...items]
  let text = build(kept)
  while (text.length > TELEGRAM_MAX_LENGTH && kept.length > 0) {
    kept.pop()
    text = build(kept)
  }
  return text.length <= TELEGRAM_MAX_LENGTH ? text : fitLines([head])
}

/**
 * Ish oqimi xabari "Ochish" havolasi: `?request=<id>` / `?transfer=<id>` / `?purchase=<id>`
 * (payload'da id bo'lsa); qolganlari — oddiy Mini App URL. Frontend request va transfer ni
 * ochadi; purchase — hozircha bosh sahifa.
 */
export function workflowOpenUrl(baseUrl: string, kind: string, payload: unknown): string {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const pick = (key: string, param: string): string | null => {
    const v = p[key]
    return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
      ? withParam(baseUrl, param, v.toLowerCase())
      : null
  }
  if (kind.startsWith('request_')) return pick('request_id', 'request') ?? baseUrl
  if (kind.startsWith('transfer_')) return pick('transfer_id', 'transfer') ?? baseUrl
  if (kind === 'purchase_for_object' || kind === 'purchase_deleted' || kind === 'purchase_on_your_name') {
    return pick('purchase_id', 'purchase') ?? baseUrl
  }
  return baseUrl
}

function withParam(baseUrl: string, key: string, value: string): string {
  try {
    const u = new URL(baseUrl)
    u.searchParams.set(key, value)
    return u.toString()
  } catch {
    return baseUrl
  }
}

// ---------------------------------------------------------------------------
// Inline tugma
// ---------------------------------------------------------------------------

export type InlineButton =
  | { text: string; web_app: { url: string } }
  | { text: string; url: string }
  | { text: string; callback_data: string }
export interface InlineKeyboard {
  inline_keyboard: InlineButton[][]
}

/** "Ko'rildi" tugmasi callback'i: `al:seen:<alert_id>` (≤ 64 bayt). */
export const SEEN_CALLBACK_PREFIX = 'al:seen:'

/** Xabar ostidagi `web_app` tugmasi. */
export function miniAppKeyboard(
  url: string,
  text: string = NOTIFY_TEXTS.openMiniApp,
): { inline_keyboard: { text: string; web_app: { url: string } }[][] } {
  return { inline_keyboard: [[{ text, web_app: { url } }]] }
}

/** Mini App havolasiga `alert=<id>` qo'shadi (frontend shu alertni ochishi mumkin). */
export function alertOpenUrl(baseUrl: string, alertId: string): string {
  try {
    const u = new URL(baseUrl)
    u.searchParams.set('alert', alertId)
    return u.toString()
  } catch {
    return baseUrl
  }
}

/**
 * Bitta alert xabari tugmalari: `withSeen` (admin / super_admin) bo'lsa "✓ Ko'rildi"
 * (`al:seen:<id>`) + "Ochish"; aks holda faqat "Ochish". `deepLink` = false bo'lsa "Ochish"
 * oddiy Mini App havolasi (`?alert=` siz) — alertlarni RLS bo'yicha o'qiy olmaydigan rollar (prorab).
 */
export function alertKeyboard(baseUrl: string, alertId: string, withSeen: boolean, deepLink = true): InlineKeyboard {
  const url = deepLink ? alertOpenUrl(baseUrl, alertId) : baseUrl
  const open: InlineButton = { text: NOTIFY_TEXTS.buttons.open, web_app: { url } }
  const row: InlineButton[] = withSeen
    ? [{ text: NOTIFY_TEXTS.buttons.seen, callback_data: `${SEEN_CALLBACK_PREFIX}${alertId}` }, open]
    : [open]
  return { inline_keyboard: [row] }
}
