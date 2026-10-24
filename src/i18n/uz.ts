// Interfeys matnlari (o'zbek, lotin). Rus tili keyin shu tuzilmada ru.ts sifatida qo'shiladi.
export const uz = {
  app: {
    name: 'TERRON Build',
    tagline: 'Qurilish firmasi uchun material va pul nazorati',
  },
  common: {
    soon: 'Tez orada',
    soonHint: 'Bu bo‘lim keyingi bosqichlarda qo‘shiladi.',
    back: 'Orqaga',
    save: 'Saqlash',
    openMenu: 'Menyuni ochish',
    closeMenu: 'Menyuni yopish',
  },
  status: {
    supabase: 'Ma’lumotlar bazasi',
    configured: 'Sozlangan',
    notConfigured: 'Sozlanmagan — .env faylini to‘ldiring',
    telegram: 'Telegram',
    insideTelegram: 'Telegram ichida ochilgan',
    outsideTelegram: 'Brauzerda ochilgan (Telegram tashqarisida)',
  },
  web: {
    nav: {
      dashboard: 'Bosh sahifa',
      materials: 'Materiallar',
      movements: 'Ombor harakatlari',
      purchases: 'Xaridlar',
      cash: 'Podotchet',
      estimates: 'Smeta',
      requests: 'So‘rovlar',
      alerts: 'Ogohlantirishlar',
      history: 'Tarix',
      users: 'Foydalanuvchilar',
    },
    welcome: 'Xush kelibsiz',
    batchNote: 'Sinov versiyasi — asos tayyor. Bo‘limlar navbatma-navbat qo‘shiladi.',
  },
  tg: {
    nav: {
      home: 'Bosh',
      movement: 'Kirim / chiqim',
      purchase: 'Xarid',
      mine: 'Yozuvlarim',
    },
    hello: 'Salom',
  },
  notFound: {
    title: 'Sahifa topilmadi',
    toHome: 'Bosh sahifaga qaytish',
  },
} as const

export type Messages = typeof uz
