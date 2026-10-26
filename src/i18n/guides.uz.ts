// Har bir rol uchun qisqa qo'llanma (o'zbek, lotin). Bir rol = bir A4 sahifa.
// Tugma va ekran nomlari `uz.ts` dagi matnlar bilan bir xil bo'lishi kerak.
// Nusxa: docs/qollanma/<rol>.md — `npm run guides:md` (src/i18n/guidesMarkdown.ts) bilan yaratiladi.
import type { Role } from '@/domain/roles'

export type GuideAlert = { name: string; meaning: string; whatToDo: string }

export type RoleGuide = {
  title: string
  /** "Sizning vazifangiz" — 2–3 gap. */
  intro: string
  /** "Har kuni" — ish turlari bo'yicha qadamlar. */
  daily: { title: string; steps: string[] }[]
  /** "Muhim qoidalar". */
  rules: string[]
  /** "Ogohlantirishlar nimani anglatadi" — shu rolga tegishlilari. */
  alerts: GuideAlert[]
  /** "Savol bo'lsa". */
  help: string
}

/** Bo'lim sarlavhalari (sahifa va Markdown uchun umumiy). */
export const guideHeadings = {
  intro: 'Sizning vazifangiz',
  daily: 'Har kuni',
  rules: 'Muhim qoidalar',
  alerts: 'Ogohlantirishlar nimani anglatadi',
  help: 'Savol bo‘lsa',
} as const

const BUG_REPORT =
  'Ilovada xato ko‘rsangiz, “Xatolik haqida xabar berish” tugmasini bosing: nima bo‘lganini yozing, xohlasangiz skrinshot qo‘shing. Xabar adminga boradi.'

/** Ish xabarlari (so'rov, o'tkazma, xarid) — har kim o'zi yoqadi yoki o'chiradi. */
const WORK_MESSAGES_TG = '“Ish xabarlari” (so‘rov, o‘tkazma, xarid) — “Yozuvlar” tepasida yoqing yoki o‘chiring.'
const WORK_MESSAGES_WEB = '“Ish xabarlari” (so‘rov, o‘tkazma, xarid) — yon menyuda, “Parol” yonida yoqing yoki o‘chiring.'

/** Mini App "Yozuvlar" (prorab, omborchi) — o'z yozuvini tuzatish (B: aniq matn). */
const SELF_FIX =
  'Xato miqdor, birlik, material yoki obyektni 30 daqiqa ichida o‘zingiz to‘g‘rilaysiz: “Yozuvlar” → yozuv → “Tuzatish” (sabab majburiy). Ikki marta kiritilgan bo‘lsa — “Bekor qilish (o‘chirish)”. Xaridga bog‘langan kirim — adminga ayting.'

/** Sana: standart "Bugun", obyekt qatoridagi chip. */
const ENTRY_DATE =
  'Sana standart — “Bugun”. Kechagi ishni kiritsangiz, “Bugun ▾” ni bosib “Kecha” yoki “Boshqa sana” (oxirgi 3 kun) ni tanlang.'

const admin: RoleGuide = {
  title: 'Admin uchun qo‘llanma',
  intro:
    'Siz firma ichida tizimni boshqarasiz: foydalanuvchilar, obyektlar, materiallar, sotuvchilar va sozlamalar. So‘rovlarni tasdiqlaysiz, ogohlantirishlarni yopasiz, xato yozuvlarni tuzatasiz, o‘chirasiz va tiklaysiz.',
  daily: [
    {
      title: 'Boshlash (bir marta)',
      steps: [
        '“Obyektlar” → “Obyekt qo‘shish”. Kerak bo‘lsa, joylashuvni kiriting.',
        '“Foydalanuvchilar” → “Foydalanuvchi qo‘shish”: ism, telefon, rol va obyektlar. Odam Telegram ilovasini ochib, raqamini ulashadi. Veb kerak bo‘lsa — “Veb login berish”.',
        '“Materiallar” da birliklar va muqobil nomlarni, “Sotuvchilar” da takror yozilgan sotuvchilarni tekshiring (“Birlashtirish”).',
        '“Sozlamalar”: chegaralar va “Tinch soatlar” — bu vaqtda Telegram xabarlari kutib turadi.',
      ],
    },
    {
      title: 'Har kuni',
      steps: [
        '“Ogohlantirishlar”: har birini tekshiring, “Ko‘rildi” yoki “Yopish” — yopishda sabab majburiy.',
        '“So‘rovlar”: “Tasdiqlash” yoki “Rad etish” (sababini yozing).',
        '“Ombor” → “Inventarizatsiya”: farq bo‘lsa, tekshirib “Qoldiqni tuzatish”.',
        'Xato yozuvni “Tuzatish” yoki “O‘chirish”; kerak bo‘lsa “Tarix” → “O‘chirilganlar” dan “Tiklash”.',
        '“Sozlamalar” → “Telegram”: xabarlar yetib borayaptimi; botni bloklagan odam botni qayta ochsa — “Qayta tekshirish”.',
      ],
    },
    {
      title: 'Telegram ilovasida',
      steps: [
        '“Bosh” → “Bo‘limlar”: “So‘rovlarni tasdiqlash” (kutayotganlar soni bilan), “Qoldiq” va “Sanash”.',
        'Ish xabaridagi havola shu so‘rovni darhol ochadi.',
      ],
    },
  ],
  rules: [
    'Hech narsa butunlay o‘chmaydi — o‘chirilgan yozuv tarixda qoladi va tiklanadi.',
    'Ketgan xodimni “Nofaol qilish” bilan to‘xtating, o‘chirmang.',
    'Admin va direktor profilining telefoni, roli va faolligini faqat tizim egasi o‘zgartiradi.',
    'Sizning tuzatishingiz va o‘chirishingiz haqida direktorga ogohlantirish boradi.',
    'Materialning qoldig‘i bor bo‘lsa o‘chirib bo‘lmaydi — “Nofaol qilish”.',
  ],
  alerts: [
    {
      name: 'Xarid ≠ qabul',
      meaning: 'Xarid qilingan va qabul qilingan miqdor farq qiladi.',
      whatToDo: 'Xaridor va qabul qilgan bilan gaplashing, kirim xaridga bog‘langanini tekshiring.',
    },
    {
      name: 'Narx og‘ishi',
      meaning: 'Narx oxirgi xaridlar o‘rtachasidan chegaradan ko‘p farq qiladi.',
      whatToDo: 'Chekni ko‘ring, sababini so‘rang.',
    },
    {
      name: 'Inventarizatsiya kamomadi',
      meaning: 'Sanalgan qoldiq hisobdagidan kam.',
      whatToDo: 'Sababini aniqlang, keyin “Qoldiqni tuzatish”.',
    },
    {
      name: 'Podotchet muddati o‘tdi',
      meaning: 'Berilgan pul uzoq vaqt hisobot qilinmagan.',
      whatToDo: 'Odamdan cheklarni yoki qolgan pulni so‘rang.',
    },
  ],
  help:
    'Ogohlantirish Telegram’da ham keladi: “Ko‘rildi” tugmasini u yerda ham bosish mumkin. ' +
    WORK_MESSAGES_WEB +
    ' ' +
    BUG_REPORT,
}

export const guides: Record<Role, RoleGuide> = {
  super_admin: {
    ...admin,
    title: 'Tizim egasi uchun qo‘llanma',
    intro:
      'Siz tizim egasisiz va barcha firmalarni ko‘rasiz. Firma ichidagi ish admin bilan bir xil, shuning uchun quyidagi qadamlar admin qo‘llanmasidan olingan. ' +
      admin.intro,
  },

  admin,

  direktor: {
    title: 'Direktor uchun qo‘llanma',
    intro:
      'Siz hamma narsani ko‘rasiz, lekin hech narsani o‘zgartirmaysiz. Tizim farq topsa, sizga darhol Telegram’da xabar keladi. Har kuni 20:00 da kunlik hisobot keladi.',
    daily: [
      {
        title: 'Telegram’da',
        steps: [
          'Kunlik hisobotni o‘qing: kirim, chiqim, xaridlar, so‘rovlar, farqlar soni.',
          'Telegram ilovasini oching. “Bosh” ekranda bugungi holat, smeta ishlatilishi va ogohlantirishlar.',
          '“Bo‘limlar” → “Qoldiq”: obyektdagi materiallar va necha kunga yetishi.',
          'Ogohlantirish xabaridagi “Ochish” tugmasi uni Telegram ilovasida ochadi.',
        ],
      },
      {
        title: 'Veb panelda',
        steps: [
          '“Bosh sahifa”: davr va obyektni tanlang. “Smeta va haqiqiy” — obyekt bo‘yicha smeta jami va xaridlar (so‘m).',
          '“Ogohlantirishlar” — barcha farqlar ro‘yxati.',
          '“Podotchet” — kimning qo‘lida qancha pul bor.',
          '“Tarix” — kim, qachon, nimani o‘zgartirgan yoki o‘chirgan (oldin va keyin).',
        ],
      },
    ],
    rules: [
      'Siz faqat ko‘rasiz. Ogohlantirishni yopish va yozuvni tiklashni admin qiladi.',
      'Ochiq ogohlantirish uzoq yopilmasa, tizim qayta eslatadi.',
      '“Ish xabarlari” sizga tegishli emas — sizga ogohlantirishlar va kunlik hisobot keladi.',
    ],
    alerts: [
      {
        name: 'Xarid ≠ qabul',
        meaning: 'Sotib olingan va obyektga kelgan miqdor farq qiladi.',
        whatToDo: 'Admindan sababini so‘rang.',
      },
      {
        name: 'Normadan oshish',
        meaning: 'Obyektda smeta normasidan ko‘p material ishlatilgan.',
        whatToDo: 'Prorab bilan gaplashing.',
      },
      {
        name: 'Yozuv o‘zgartirildi',
        meaning: 'Admin kiritilgan yozuvning miqdori, summasi yoki sanasini o‘zgartirdi.',
        whatToDo: '“Tarix” da oldingi va yangi qiymatni ko‘ring.',
      },
      {
        name: 'Yozuv tuzatildi',
        meaning: 'Muallif o‘z yozuvini 30 daqiqa ichida, sabab bilan tuzatdi.',
        whatToDo: 'Sababini o‘qing; shubhali bo‘lsa — “Tarix”.',
      },
      {
        name: 'Yozuv o‘chirildi',
        meaning: 'Kimdir xarid, pul yoki harakat yozuvini o‘chirdi.',
        whatToDo: '“Tarix” da kim va nima uchun o‘chirganini ko‘ring.',
      },
      {
        name: 'Sozlama o‘zgardi / Login o‘zgardi',
        meaning: 'Admin firma chegaralarini yoki kimningdir veb loginini o‘zgartirdi.',
        whatToDo: 'Kutilmagan bo‘lsa, admindan so‘rang.',
      },
      {
        name: 'Podotchet belgisi / Sotuvchi STIR farqi',
        meaning: 'Pul eski sana bilan yozilgan yoki chekdagi sotuvchi tanlanganidan boshqa.',
        whatToDo: 'Buxgalter yoki admindan izoh so‘rang.',
      },
    ],
    help: 'Savol bo‘lsa, firmangiz adminiga murojaat qiling. ' + BUG_REPORT,
  },

  buxgalter: {
    title: 'Buxgalter uchun qo‘llanma',
    intro:
      'Siz xodimlarga xarid uchun pul berasiz va qaytgan pulni yozasiz. Smetani yuklaysiz, xaridlar va hisobotlarni kuzatasiz. Ishingiz veb panelda.',
    daily: [
      {
        title: 'Pul berish (podotchet)',
        steps: [
          '“Podotchet” → “Pul berish”.',
          '“Kimga” ni tanlang, summa va sanani (oxirgi 3 kun) kiriting, “Saqlash”.',
          'Odam ortiqcha pulni qaytarsa — “Qaytarish”, “Kimdan” ni tanlang.',
          'Izoh xato bo‘lsa — yozuvni ochib “Izohni tahrirlash”.',
          '“Qo‘ldagi pul” jadvalida har kimning berilgan, sarflangan va qo‘lidagi puli ko‘rinadi.',
        ],
      },
      {
        title: 'Smeta yuklash',
        steps: [
          '“Smeta” → obyektni tanlang → “Smeta yuklash”.',
          'Faylni tanlang (.xlsx, .xls, .csv), ustunlar va materiallarni qadamma-qadam moslang.',
          'Tekshirib, “Smetani saqlash”. Yangi versiyani “Solishtirish” bilan eskisi bilan solishtiring.',
        ],
      },
      {
        title: 'Kuzatish',
        steps: [
          '“Xaridlar” da cheklar va qabul holatini ko‘ring.',
          '“Bosh sahifa” da davr bo‘yicha xarajatlar, kerak bo‘lsa Excel’ga eksport.',
        ],
      },
    ],
    rules: [
      'Berilgan pul summasi va sanasini o‘zgartirib bo‘lmaydi. Xato bo‘lsa — o‘chirib, qayta bering.',
      'Pulni faqat xarid kiritadigan xodimga berish mumkin.',
      'Yangi materialni katalogga faqat admin qo‘shadi.',
    ],
    alerts: [
      {
        name: 'Podotchet muddati o‘tdi',
        meaning: 'Berilgan pul belgilangan kundan ko‘p hisobot qilinmagan.',
        whatToDo: 'Odamdan xaridlarni kiritishni yoki pulni qaytarishni so‘rang.',
      },
      {
        name: 'Manfiy podotchet',
        meaning: 'Odam berilgan puldan ko‘p xarid kiritgan — o‘z pulidan sarflagan.',
        whatToDo: 'Tekshiring, kerak bo‘lsa pul bering.',
      },
      {
        name: 'Chek farqi',
        meaning: 'Chekdagi summa xaridda yozilgan summadan farq qiladi.',
        whatToDo: 'Chekni ko‘ring, adminga ayting.',
      },
      {
        name: 'Narx og‘ishi',
        meaning: 'Narx odatdagidan ancha yuqori yoki past.',
        whatToDo: 'Xaridni tekshiring.',
      },
    ],
    help: WORK_MESSAGES_WEB + ' Savol bo‘lsa, firmangiz adminiga murojaat qiling. ' + BUG_REPORT,
  },

  taminotchi: {
    title: 'Ta’minotchi uchun qo‘llanma',
    intro:
      'Siz material sotib olasiz va har bir xaridni Telegram ilovasida yoki veb panelda (“Xaridlar” → “Xarid qo‘shish”) kiritasiz. Tasdiqlangan so‘rovlar bo‘yicha xarid qilasiz. Qo‘lingizdagi pul doim ko‘rinib turadi.',
    daily: [
      {
        title: 'Xarid kiritish (Telegram ilovasi)',
        steps: [
          '“Xarid” ni oching. Yuqorida “Qo‘limda” — qo‘lingizdagi pul; bosing — “Pul tarixi”.',
          '“Tasdiqlangan so‘rovlar” barcha obyektlar bo‘yicha guruhlangan: so‘rovni bossangiz, obyekt va ma’lumotlar o‘zi to‘ldiriladi.',
          'Chekda QR bo‘lsa, “Chekni skanerlash” ni bosing: summa va sotuvchi o‘zi to‘ldiriladi.',
          'Material, miqdor, “Jami summa (chekdagi)”, obyekt va sotuvchini tanlang. Kechagi xarid — “Kecha”.',
          '“Saqlash” ni bosing.',
        ],
      },
      {
        title: 'Veb panelda',
        steps: [
          '“Xaridlar” → “Xarid qo‘shish” — xuddi shu ma’lumotlar, oxirgi obyekt eslab qolinadi.',
          '“So‘rovlar” da tasdiqlanganlarni ko‘ring. So‘rov bo‘yicha kiritilgan xarid so‘rovni o‘zi yopadi.',
          'Xato xaridni 30 daqiqa ichida “Tuzatish” (sabab bilan).',
        ],
      },
    ],
    rules: [
      'Har xaridni o‘sha kuni kiriting. Summa — chekdagi jami summa.',
      'Rasm odatda ixtiyoriy. Firma belgilagan summadan katta xaridda va “majburiy” belgili materialda chek rasmisiz saqlanmaydi. Soliq.uz tasdiqlagan QR chekda rasm shart emas.',
      'Bitta chekni ikki xaridda ishlatib bo‘lmaydi.',
      'Xato xaridni Telegram ilovasida ham 30 daqiqa ichida tuzatasiz: “Yozuvlar” → xarid → “Tuzatish”.',
    ],
    alerts: [
      {
        name: 'Narx og‘ishi',
        meaning: 'Narx oxirgi xaridlar o‘rtachasidan ancha yuqori.',
        whatToDo: 'Saqlashdan oldin narxni tekshiring; sababini izohga yozing.',
      },
      {
        name: 'Xarid ≠ qabul',
        meaning: 'Obyektga siz olgandan kam yoki ko‘p material kelgan.',
        whatToDo: 'Prorab yoki omborchi bilan miqdorni solishtiring.',
      },
      {
        name: 'Chek farqi',
        meaning: 'Chekdagi summa siz yozgan summadan farq qiladi.',
        whatToDo: 'Summani chekdagidek kiriting.',
      },
      {
        name: 'So‘rovdan ortiq xarid',
        meaning: 'So‘ralganidan ancha ko‘p sotib olingan.',
        whatToDo: 'Sababini izohga yozing.',
      },
    ],
    help:
      'Tasdiqlangan so‘rov muddati o‘tsa, Telegram’da eslatma keladi. ' +
      WORK_MESSAGES_TG +
      ' “Yozuvlar” da xaridlaringiz, pul yozuvlari va xabarlaringiz. Savol bo‘lsa — adminga. ' +
      BUG_REPORT,
  },

  prorab: {
    title: 'Prorab uchun qo‘llanma',
    intro:
      'Siz obyektga kelgan va ishlatilgan materialni yozasiz, xarid kiritasiz va kerakli materialni so‘raysiz. Hamma ish Telegram ilovasida. Faqat sizga biriktirilgan obyektlar ko‘rinadi.',
    daily: [
      {
        title: 'Material keldi yoki ishlatildi',
        steps: [
          '“Bosh” da “Kirim” yoki “Chiqim” ni bosing (yoki pastki menyuda “Ombor”).',
          'Obyektni tanlang. Bitta obyekt bo‘lsa, o‘zi tanlanadi.',
          'Material tugmasini bosing, miqdorni yozing, ostidagi birlikni tanlang.',
          'Kirim xarid bo‘yicha kelgan bo‘lsa, “Bog‘langan xarid” dan keraklisini “Bog‘lash”.',
          '“Saqlash” ni bosing.',
        ],
      },
      {
        title: 'Xarid',
        steps: [
          '“Xarid” da “Qo‘limda” — qo‘lingizdagi pul; bosing — “Pul tarixi”.',
          'Chekda QR bo‘lsa, “Chekni skanerlash” ni bosing.',
          'Material, miqdor, “Jami summa (chekdagi)” va obyektni kiriting, “Saqlash”.',
        ],
      },
      {
        title: 'So‘rov, o‘tkazma, qoldiq',
        steps: [
          '“So‘rov” da material, miqdor va “Qachon kerak” ni tanlang → “So‘rov yuborish”.',
          'Boshqa obyektga berish: “O‘tkazma” → “O‘tkazmani yuborish”. Hali qabul qilinmagan bo‘lsa, “Yozuvlar” dan “O‘tkazmani bekor qilish”.',
          'Sizga o‘tkazma kelsa: “Kelayotgan o‘tkazmalar” → sanab, “Qabul qilish”.',
          '“Bo‘limlar” → “Qoldiq”: materiallar va necha kunga yetishi; qatorni bossangiz — chiqim.',
        ],
      },
    ],
    rules: [
      ENTRY_DATE,
      SELF_FIX,
      'Rasm odatda ixtiyoriy. Katta summali xaridda va “majburiy” belgili materialda rasmsiz saqlanmaydi.',
      '“Bosh” dagi “Obyekt ogohlantirishlari” — obyektingizdagi farqlar; admin ko‘rib chiqadi.',
      'Telegram ilovasi joylashuvni so‘raydi — ruxsat bering.',
    ],
    alerts: [
      {
        name: 'Xarid ≠ qabul',
        meaning: 'Kelgan miqdor xariddagidan farq qiladi.',
        whatToDo: 'Qayta sanang, kirimni xaridga bog‘lang.',
      },
      {
        name: 'Normadan oshish',
        meaning: 'Chiqim smeta normasidan oshdi.',
        whatToDo: 'Sababini adminga tushuntiring.',
      },
      {
        name: 'Manfiy qoldiq',
        meaning: 'Chiqim qoldiqdan ko‘p — kirim yozilmagan bo‘lishi mumkin.',
        whatToDo: 'Unutilgan kirimni kiriting.',
      },
      {
        name: 'Joylashuv farqi',
        meaning: 'Yozuv obyektdan uzoqda kiritilgan.',
        whatToDo: 'Yozuvni obyektda turib kiriting.',
      },
    ],
    help:
      '“Yozuvlar” da kirim-chiqim, xarid, so‘rov, o‘tkazma, pul va xabarlaringiz; turi va sanasi bo‘yicha filtrlang. ' +
      WORK_MESSAGES_TG +
      ' Savol bo‘lsa — adminga. ' +
      BUG_REPORT,
  },

  omborchi: {
    title: 'Omborchi uchun qo‘llanma',
    intro:
      'Siz obyektga kelgan va berilgan materialni Telegram ilovasida yozasiz. To‘g‘ri yozuv — aniq qoldiq. Faqat sizga biriktirilgan obyektlar ko‘rinadi.',
    daily: [
      {
        title: 'Material keldi (kirim)',
        steps: [
          '“Bosh” da “Kirim” ni bosing.',
          'Obyektni tanlang (bitta bo‘lsa, o‘zi tanlanadi).',
          'Material tugmasini bosing, sanab miqdorni yozing, ostidagi birlikni tanlang.',
          'Xarid bo‘yicha kelgan bo‘lsa, “Bog‘langan xarid” dan uni “Bog‘lash”.',
          '“Saqlash” ni bosing.',
        ],
      },
      {
        title: 'Material berildi (chiqim)',
        steps: [
          '“Bosh” da “Chiqim” ni bosing yoki “Bo‘limlar” → “Qoldiq” dan materialni bosing.',
          'Miqdor va birlikni kiriting. “Qoldiq: … → …” ni tekshiring.',
          '“Saqlash” ni bosing.',
        ],
      },
      {
        title: 'O‘tkazma keldi',
        steps: [
          '“Ombor” ekranida “Kelayotgan o‘tkazmalar” ni oching (xabardagi havola ham shu yerga olib keladi).',
          'Kelgan miqdorni sanang, “Qabul qilish”.',
        ],
      },
    ],
    rules: [
      ENTRY_DATE,
      SELF_FIX,
      'Haydovchi aytgan emas, o‘zingiz sanagan miqdorni yozing.',
      '“Bosh” dagi “Obyekt ogohlantirishlari” — obyektingizdagi farqlar; admin ko‘rib chiqadi.',
      'Telegram ilovasi joylashuvni so‘raydi — ruxsat bering.',
    ],
    alerts: [
      {
        name: 'Xarid ≠ qabul',
        meaning: 'Qabul qilingan miqdor xariddagidan farq qiladi.',
        whatToDo: 'Qayta sanang, kirimni xaridga bog‘lang.',
      },
      {
        name: 'Manbasiz kirim',
        meaning: 'Kirim xarid yoki o‘tkazmaga bog‘lanmagan.',
        whatToDo: 'Ochiq xarid bo‘lsa, kirimda uni bog‘lang.',
      },
      {
        name: 'Manfiy qoldiq',
        meaning: 'Berilgan material qoldiqdan ko‘p.',
        whatToDo: 'Yozilmagan kirimni kiriting.',
      },
      {
        name: 'O‘tkazma farqi',
        meaning: 'O‘tkazmada yuborilgan va qabul qilingan miqdor farq qiladi.',
        whatToDo: 'Yuborgan obyekt bilan gaplashing.',
      },
    ],
    help:
      '“Yozuvlar” da kirim-chiqimlaringiz va xabarlaringiz; turi va sanasi bo‘yicha filtrlang. ' +
      WORK_MESSAGES_TG +
      ' Savol bo‘lsa — prorab yoki adminga. ' +
      BUG_REPORT,
  },

  haydovchi: {
    title: 'Haydovchi uchun qo‘llanma',
    intro:
      'Siz berilgan pulga material sotib olasiz va har bir xaridni Telegram ilovasida kiritasiz. Qo‘lingizdagi pul doim ko‘rinib turadi.',
    daily: [
      {
        title: 'Xarid kiritish',
        steps: [
          'Telegram ilovasida “Xarid” ni oching. “Qo‘limda” — qo‘lingizdagi pul; bosing — “Pul tarixi”.',
          'Chekda QR bo‘lsa, “Chekni skanerlash” ni bosing: summa va sotuvchi o‘zi to‘ldiriladi.',
          'Material, miqdor, “Jami summa (chekdagi)” va obyektni tanlang. Kechagi xarid — “Kecha”.',
          '“Saqlash” ni bosing. “Qo‘limda” yangi summani ko‘rsatadi.',
        ],
      },
      {
        title: 'Tekshirish',
        steps: [
          '“Yozuvlar” da xaridlaringiz, berilgan va qaytarilgan pul.',
          'Xato xaridni 30 daqiqa ichida tuzatasiz: “Yozuvlar” → xarid → “Tuzatish” (sabab majburiy).',
          'Har dushanba Telegram’da pul hisobotingiz keladi: berildi, sarflandi, qoldiq.',
        ],
      },
    ],
    rules: [
      'Har xaridni do‘kondan chiqishingiz bilan kiriting.',
      'Summa — chekdagi jami summa. Chekni saqlang.',
      'Rasm odatda ixtiyoriy. Firma belgilagan summadan katta xaridda chek rasmisiz saqlanmaydi. Soliq.uz tasdiqlagan QR chekda rasm shart emas.',
      'Ortib qolgan pulni buxgalterga qaytaring.',
      'Telegram ilovasi joylashuvni so‘raydi — ruxsat bering.',
    ],
    alerts: [
      {
        name: 'Narx og‘ishi',
        meaning: 'Narx odatdagidan ancha yuqori.',
        whatToDo: 'Ilova ogohlantirsa, narx va birlikni tekshiring.',
      },
      {
        name: 'Xarid ≠ qabul',
        meaning: 'Obyektga siz olgandan kam material yetib kelgan.',
        whatToDo: 'Yukni to‘liq topshiring, omborchi sanasin.',
      },
      {
        name: 'Podotchet muddati o‘tdi',
        meaning: 'Pul uzoq vaqt hisobot qilinmagan.',
        whatToDo: 'Xaridlarni kiriting yoki qolgan pulni qaytaring.',
      },
    ],
    help: WORK_MESSAGES_TG + ' Savol bo‘lsa — adminga. ' + BUG_REPORT,
  },

  tekshiruvchi: {
    title: 'Tekshiruvchi uchun qo‘llanma',
    intro:
      'Siz obyektdagi materialni sanaysiz (inventarizatsiya). Hisobdagi qoldiq sizga ko‘rsatilmaydi — faqat ko‘rganingizni yozasiz. Natijani tizim o‘zi solishtiradi.',
    daily: [
      {
        title: 'Sanash',
        steps: [
          'Telegram ilovasida “Sanash” ni oching, obyektni tanlang.',
          '“Yangi sanash” ni bosing (boshlangan bo‘lsa — “Davom ettirish”).',
          'Har bir materialni sanab, “Sanalgan miqdor” ni yozing, “Saqlash”. Har kiritish darhol saqlanadi.',
          'Ro‘yxatda yo‘q material bo‘lsa — “Boshqa materiallar”.',
        ],
      },
      {
        title: 'Yakunlash',
        steps: [
          'Hammasi sanalgach, “Yakunlash” ni bosing va tasdiqlang.',
          'Natija admin va direktorga yuboriladi. Sanashlaringiz “Yozuvlar” da ko‘rinadi.',
        ],
      },
    ],
    rules: [
      'Taxmin qilmang — faqat sanaganingizni yozing.',
      'Sanalmagan materiallar kamomad sifatida hisoblanadi.',
      'Yakunlangandan keyin o‘zgartirib bo‘lmaydi.',
      'Sanash paytida material berilmasin — omborchi bilan kelishib oling.',
    ],
    alerts: [
      {
        name: 'Inventarizatsiya kamomadi',
        meaning: 'Siz sanagan miqdor hisobdagidan kam.',
        whatToDo: 'Hech narsa qilmang — admin tekshiradi. So‘rasa, qayta sanang.',
      },
    ],
    help: WORK_MESSAGES_TG + ' Savol bo‘lsa — adminga. ' + BUG_REPORT,
  },
}

/** Qo'llanmadagi barcha matn (so'z sanash, qidiruv va testlar uchun). */
export function guideText(g: RoleGuide): string[] {
  return [
    g.title,
    g.intro,
    ...g.daily.flatMap((d) => [d.title, ...d.steps]),
    ...g.rules,
    ...g.alerts.flatMap((a) => [a.name, a.meaning, a.whatToDo]),
    g.help,
  ]
}

export function guideWordCount(g: RoleGuide): number {
  return guideText(g)
    .join(' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}
