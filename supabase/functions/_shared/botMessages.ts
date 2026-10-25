// Telegram bot xabar matnlari — bitta joyda (CLAUDE.md: "Xabar matnlari Edge Function
// ichidagi shablondan, lekin bitta joyda"). Sof modul: Deno va Node'da ishlaydi.
// Batch 6 (ogohlantirishlar, kunlik hisobot) matnlari ham shu faylga qo'shiladi.

export const BOT_MESSAGES = {
  /** /start — salomlashish (Mini App tugmasi bilan). */
  welcome:
    "Assalomu alaykum! Bu TERRON Build — qurilish firmasi uchun ombor va xarid hisobi.\n\n" +
    "Ilovani ochish uchun pastdagi tugmani bosing.",
  /** /start — ikkinchi xabar: birinchi marta kirayotganlar uchun kontakt so'rovi. */
  shareContactPrompt:
    "Birinchi marta kirayotgan bo'lsangiz, telefon raqamingizni ulashing — " +
    "admin sizni qo'shgan raqam bilan bog'laymiz.",
  /** Boshqa matnli xabarlarga javob. */
  help:
    "Ilovani ochish uchun /start buyrug'ini yuboring yoki pastdagi tugmani bosing.",

  linked: "Bog'landi. Endi ilovani ochishingiz mumkin.",
  alreadyLinked: "Siz allaqachon bog'langansiz. Ilovani ochishingiz mumkin.",
  alreadyLinkedOther:
    "Bu Telegram akkaunt boshqa foydalanuvchiga bog'langan. Adminingizga murojaat qiling.",
  notOwnContact: "Faqat o'zingizning telefon raqamingizni ulashing (\"Raqamni ulashish\" tugmasi).",
  invalidPhone: "Telefon raqami noto'g'ri. Adminingizga murojaat qiling.",
  notFound: "Bu raqam tizimda topilmadi. Adminingizga murojaat qiling.",
  multipleCompanies: "Raqam bir nechta firmada — adminingizga murojaat qiling.",
  tryAgain: "Xatolik yuz berdi. Birozdan keyin qayta urinib ko'ring.",

  // Batch 12 — alert xabaridagi "Ko'rildi" tugmasi (answerCallbackQuery, ≤ 200 belgi)
  seenOk: "Ko'rildi deb belgilandi",
  seenForbidden: "Faqat admin belgilay oladi",
  seenNotFound: 'Ogohlantirish topilmadi (o\'chirilgan bo\'lishi mumkin)',
  seenError: "Xatolik. Birozdan keyin qayta urinib ko'ring",
  /** Xabar oxiriga qo'shiladigan qator: "✓ Ko'rildi — Ali Valiyev" */
  seenMark: (name: string) => `✓ Ko'rildi — ${name}`,
  seenMarkPrefix: "✓ Ko'rildi — ",
} as const

export const BOT_BUTTONS = {
  openApp: 'Ilovani ochish',
  shareContact: 'Raqamni ulashish',
} as const
