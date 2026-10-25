// Har bir rol uchun qisqa qo'llanma (o'zbek, lotin). Bir rol = bir A4 sahifa.
// Tugma va ekran nomlari `uz.ts` dagi matnlar bilan bir xil bo'lishi kerak.
// Nusxa: docs/qollanma/<rol>.md (shu matndan).
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

const admin: RoleGuide = {
  title: 'Admin uchun qo‘llanma',
  intro:
    'Siz firma ichida tizimni boshqarasiz: foydalanuvchilar, obyektlar, materiallar va sozlamalar. So‘rovlarni tasdiqlaysiz, ogohlantirishlarni ko‘rib yopasiz, xato yozuvlarni o‘chirasiz va tiklaysiz.',
  daily: [
    {
      title: 'Boshlash (bir marta)',
      steps: [
        '“Obyektlar” → “Obyekt qo‘shish”. Kerak bo‘lsa, joylashuvni kiriting.',
        '“Foydalanuvchilar” → “Foydalanuvchi qo‘shish”: ism, telefon raqami, rol va obyektlar. Odam Mini App’ni ochib, raqamini ulashadi.',
        'Veb kerak bo‘lsa — “Veb login berish”. Parol faqat bir marta ko‘rsatiladi.',
        '“Materiallar” da birliklar va muqobil nomlarni tekshiring. “Sozlamalar” da chegaralarni belgilang.',
      ],
    },
    {
      title: 'Har kuni',
      steps: [
        '“Ogohlantirishlar” ni oching: har birini tekshiring, “Ko‘rildi” yoki “Yopish” (sabab bilan).',
        '“So‘rovlar”: “Tasdiqlash” yoki “Rad etish” (sababini yozing).',
        '“Ombor harakatlari” → “Inventarizatsiya”: farq bo‘lsa, tekshirib “Qoldiqni tuzatish”.',
        'Xato yozuvni “O‘chirish”; kerak bo‘lsa “Tarix” → “O‘chirilganlar” dan “Tiklash”.',
      ],
    },
  ],
  rules: [
    'Hech narsa butunlay o‘chmaydi — o‘chirilgan yozuv tarixda qoladi va tiklanadi.',
    'Ketgan xodimni “Nofaol qilish” bilan to‘xtating, o‘chirmang.',
    'Telefon raqami o‘zgarsa, veb login va Telegram bog‘lanishi uziladi.',
    'Materialni qoldig‘i bor bo‘lsa o‘chirib bo‘lmaydi — “Nofaol qilish”.',
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
    'Ogohlantirish Telegram’da ham keladi: “Ko‘rildi” tugmasini u yerda ham bosish mumkin. ' + BUG_REPORT,
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
          'Mini App’ni oching. “Bosh” ekranda bugungi holat, smeta ishlatilishi va ogohlantirishlar.',
          '“Tugayotganlar” ro‘yxatida qaysi material necha kunga yetishini ko‘ring.',
          'Ogohlantirish xabaridagi “Ochish” tugmasi uni Mini App’da ochadi.',
        ],
      },
      {
        title: 'Veb panelda',
        steps: [
          '“Bosh sahifa”: davr va obyektni tanlang. Kartochkalar, “Smeta va haqiqiy”, “Xarajat taqsimoti”.',
          '“Ogohlantirishlar” — barcha farqlar ro‘yxati.',
          '“Podotchet” — kimning qo‘lida qancha pul bor.',
          '“Tarix” — kim, qachon, nimani o‘zgartirgan yoki o‘chirgan.',
        ],
      },
    ],
    rules: [
      'Siz faqat ko‘rasiz. Ogohlantirishni yopish va yozuvni tiklashni admin qiladi.',
      'Ochiq ogohlantirish uzoq yopilmasa, tizim qayta eslatadi.',
      'Excel kerak bo‘lsa, sahifadagi eksport tugmasidan foydalaning.',
    ],
    alerts: [
      {
        name: 'Xarid ≠ qabul',
        meaning: 'Sotib olingan va obyektga kelgan miqdor farq qiladi.',
        whatToDo: 'Admindan sababini so‘rang.',
      },
      {
        name: 'Narx og‘ishi',
        meaning: 'Material odatdagidan qimmat olingan.',
        whatToDo: '“Xaridlar” da chekni ko‘ring.',
      },
      {
        name: 'Normadan oshish',
        meaning: 'Obyektda smeta normasidan ko‘p material ishlatilgan.',
        whatToDo: 'Prorab bilan gaplashing.',
      },
      {
        name: 'Inventarizatsiya kamomadi',
        meaning: 'Sanalganda material hisobdagidan kam chiqdi.',
        whatToDo: 'Admin tekshirib, xulosa bersin.',
      },
      {
        name: 'Yozuv o‘chirildi',
        meaning: 'Kimdir xarid, pul yoki harakat yozuvini o‘chirdi.',
        whatToDo: '“Tarix” da kim va nima uchun o‘chirganini ko‘ring.',
      },
      {
        name: 'Smeta o‘zgarishi',
        meaning: 'Smetaning yangi versiyasi joriy qilindi va normalar oshdi.',
        whatToDo: 'Farqni “Smeta” → “Solishtirish” da ko‘ring.',
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
          '“Kimga” ni tanlang, summa va sanani kiriting, “Saqlash”.',
          'Odam ortiqcha pulni qaytarsa — “Qaytarish”, “Kimdan” ni tanlang.',
          '“Qo‘limdagi pul” jadvalida har kimning berilgan, sarflangan va qo‘lidagi puli ko‘rinadi.',
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
      'Berilgan pul summasini o‘zgartirib bo‘lmaydi. Xato bo‘lsa — o‘chirib, qayta bering.',
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
    help: 'Savol bo‘lsa, firmangiz adminiga murojaat qiling. ' + BUG_REPORT,
  },

  taminotchi: {
    title: 'Ta’minotchi uchun qo‘llanma',
    intro:
      'Siz material sotib olasiz va har bir xaridni Mini App’da kiritasiz. Tasdiqlangan so‘rovlar bo‘yicha xarid qilasiz. Qo‘lingizdagi pul doim ko‘rinib turadi.',
    daily: [
      {
        title: 'Xarid kiritish (Mini App)',
        steps: [
          '“Xarid” ni oching. Yuqorida “Qo‘limda” — qo‘lingizdagi pul.',
          'So‘rov bo‘yicha olsangiz, “Tasdiqlangan so‘rovlar” dan uni bosing — ma’lumot to‘ladi.',
          'Chekda QR bo‘lsa, “Chekni skanerlash” ni bosing: summa va sotuvchi o‘zi to‘ladi.',
          'Material, miqdor, “Jami summa (chekdagi)”, obyekt va sotuvchini tanlang.',
          '“Saqlash” ni bosing.',
        ],
      },
      {
        title: 'Veb panelda',
        steps: [
          '“So‘rovlar” da tasdiqlanganlarni ko‘ring. So‘rov bo‘yicha kiritilgan xarid so‘rovni o‘zi yopadi; aks holda — “Xarid qilindi”.',
          '“Xaridlar” da xaridingiz obyektda qabul qilinganini kuzating.',
        ],
      },
    ],
    rules: [
      'Har xaridni o‘sha kuni kiriting. Summa — chekdagi jami summa.',
      'Rasm odatda ixtiyoriy. Firma belgilagan summadan katta xaridda va “majburiy” belgili materialda chek rasmisiz saqlanmaydi. QR skanerlangan chekda rasm shart emas.',
      'Bitta chekni ikki xaridda ishlatib bo‘lmaydi.',
      'Mini App joylashuvni so‘raydi — ruxsat bering.',
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
      'Tasdiqlangan so‘rov muddati o‘tsa, Telegram’da eslatma keladi. Savol bo‘lsa — adminga. ' + BUG_REPORT,
  },

  prorab: {
    title: 'Prorab uchun qo‘llanma',
    intro:
      'Siz obyektga kelgan va ishlatilgan materialni yozasiz, xarid kiritasiz va kerakli materialni so‘raysiz. Hamma ish Telegram’dagi Mini App’da. Faqat sizga biriktirilgan obyektlar ko‘rinadi.',
    daily: [
      {
        title: 'Material keldi yoki ishlatildi',
        steps: [
          '“Bosh” da “Kirim” yoki “Chiqim” ni bosing (yoki pastki menyuda “Kirim-chiqim”).',
          'Obyektni tanlang. Bitta obyekt bo‘lsa, o‘zi tanlanadi.',
          'Material tugmasini bosing, birlikni tanlang, miqdorni yozing.',
          'Kirim xarid bo‘yicha kelgan bo‘lsa, “Bog‘langan xarid” dan keraklisini “Bog‘lash”.',
          '“Saqlash” ni bosing.',
        ],
      },
      {
        title: 'Xarid',
        steps: [
          '“Xarid” da “Qo‘limda” — qo‘lingizdagi pul.',
          'Chekda QR bo‘lsa, “Chekni skanerlash” ni bosing.',
          'Material, miqdor, “Jami summa (chekdagi)” va obyektni kiriting, “Saqlash”.',
        ],
      },
      {
        title: 'So‘rov va o‘tkazma',
        steps: [
          '“So‘rov” da material, miqdor va “Qachon kerak” ni tanlang → “So‘rov yuborish”.',
          'Boshqa obyektga berish: “O‘tkazma” → “O‘tkazmani yuborish”.',
          'Sizga o‘tkazma kelsa: “Kelayotgan o‘tkazmalar” → sanab, “Qabul qilish”.',
        ],
      },
    ],
    rules: [
      'Mini App joylashuvni so‘raydi — ruxsat bering.',
      'Rasm odatda ixtiyoriy. Firma belgilagan summadan katta xaridda va “majburiy” belgili materialda rasmsiz saqlanmaydi. QR skanerlangan chekda rasm shart emas.',
      'Material kelishi bilan yozing, kechga qoldirmang.',
      '“Xuddi shunday yozuv bor” chiqsa, “Yozuvlarim” ni tekshiring.',
      'Xato yozuvni o‘zingiz o‘chira olmaysiz — adminga ayting.',
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
      '“Yozuvlarim” da kiritganlaringiz va so‘rovlaringiz holati ko‘rinadi. Savol bo‘lsa — adminga. ' + BUG_REPORT,
  },

  omborchi: {
    title: 'Omborchi uchun qo‘llanma',
    intro:
      'Siz obyektga kelgan va berilgan materialni Mini App’da yozasiz. To‘g‘ri yozuv — aniq qoldiq. Faqat sizga biriktirilgan obyektlar ko‘rinadi.',
    daily: [
      {
        title: 'Material keldi (kirim)',
        steps: [
          '“Bosh” da “Kirim” ni bosing.',
          'Obyektni tanlang (bitta bo‘lsa, o‘zi tanlanadi).',
          'Material tugmasini bosing, birlikni tanlang, sanab miqdorni yozing.',
          'Xarid bo‘yicha kelgan bo‘lsa, “Bog‘langan xarid” dan uni “Bog‘lash”.',
          '“Saqlash” ni bosing.',
        ],
      },
      {
        title: 'Material berildi (chiqim)',
        steps: [
          '“Bosh” da “Chiqim” ni bosing.',
          'Material, birlik va miqdorni tanlang. “Qoldiq: … → …” ni tekshiring.',
          '“Saqlash” ni bosing.',
        ],
      },
      {
        title: 'O‘tkazma keldi',
        steps: [
          '“Kirim / chiqim” ekranida “Kelayotgan o‘tkazmalar” ni oching.',
          'Kelgan miqdorni sanang, “Qabul qilish”.',
        ],
      },
    ],
    rules: [
      'Mini App joylashuvni so‘raydi — ruxsat bering.',
      'Rasm odatda ixtiyoriy. “Majburiy” belgili materialda rasmsiz saqlanmaydi.',
      'Haydovchi aytgan emas, o‘zingiz sanagan miqdorni yozing.',
      '“Xuddi shunday yozuv bor” chiqsa, “Yozuvlarim” ni tekshiring.',
      'Xato yozuvni o‘zingiz o‘chira olmaysiz — adminga ayting.',
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
    help: 'Savol bo‘lsa — prorab yoki adminga. ' + BUG_REPORT,
  },

  haydovchi: {
    title: 'Haydovchi uchun qo‘llanma',
    intro:
      'Siz berilgan pulga material sotib olasiz va har bir xaridni Mini App’da kiritasiz. Qo‘lingizdagi pul doim ko‘rinib turadi.',
    daily: [
      {
        title: 'Xarid kiritish',
        steps: [
          'Mini App’da “Xarid” ni oching. “Qo‘limda” — qo‘lingizdagi pul.',
          'So‘rov bo‘yicha olsangiz, “Tasdiqlangan so‘rovlar” dan uni bosing.',
          'Chekda QR bo‘lsa, “Chekni skanerlash” ni bosing: summa va sotuvchi o‘zi to‘ladi.',
          'Material, miqdor, “Jami summa (chekdagi)” va obyektni tanlang.',
          '“Saqlash” ni bosing. “Qo‘limda” yangi summani ko‘rsatadi.',
        ],
      },
      {
        title: 'Tekshirish',
        steps: [
          '“Yozuvlarim” da kiritgan xaridlaringizni ko‘ring.',
          'Har dushanba Telegram’da pul hisobotingiz keladi: berildi, sarflandi, qoldiq.',
        ],
      },
    ],
    rules: [
      'Har xaridni do‘kondan chiqishingiz bilan kiriting.',
      'Summa — chekdagi jami summa. Chekni saqlang.',
      'Rasm odatda ixtiyoriy. Firma belgilagan summadan katta xaridda chek rasmisiz saqlanmaydi. QR skanerlangan chekda rasm shart emas.',
      'Ortib qolgan pulni buxgalterga qaytaring.',
      'Mini App joylashuvni so‘raydi — ruxsat bering.',
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
    help: 'Savol bo‘lsa — adminga. ' + BUG_REPORT,
  },

  tekshiruvchi: {
    title: 'Tekshiruvchi uchun qo‘llanma',
    intro:
      'Siz obyektdagi materialni sanaysiz (inventarizatsiya). Hisobdagi qoldiq sizga ko‘rsatilmaydi — faqat ko‘rganingizni yozasiz. Natijani tizim o‘zi solishtiradi.',
    daily: [
      {
        title: 'Sanash',
        steps: [
          'Mini App’da “Inventar” ni oching, obyektni tanlang.',
          '“Yangi sanash” ni bosing (boshlangan bo‘lsa — “Davom ettirish”).',
          'Har bir materialni sanab, “Sanalgan miqdor” ni yozing, “Saqlash”. Har kiritish darhol saqlanadi.',
          'Ro‘yxatda yo‘q material bo‘lsa — “Boshqa materiallar”.',
        ],
      },
      {
        title: 'Yakunlash',
        steps: [
          'Hammasi sanalgach, “Yakunlash” ni bosing va tasdiqlang.',
          'Natija admin va direktorga yuboriladi.',
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
    help: 'Savol bo‘lsa — adminga. ' + BUG_REPORT,
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
