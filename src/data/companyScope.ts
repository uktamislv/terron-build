// Faol firma (faqat super_admin, veb panel). RLS super_admin'ga barcha firmalarni ko'rsatadi —
// ro'yxat so'rovlari shu yerda o'rnatilgan firma bo'yicha qo'shimcha filtrlanadi, firmalar aralashmasin.
// null — filtr yo'q (boshqa rollar: RLS o'zi bitta firmani beradi; xulq o'zgarmaydi).
// Xavfsizlik emas, faqat ko'rinish: himoya RLS'da.

let activeCompanyId: string | null = null

/** Veb panel (ActiveCompanyProvider) o'rnatadi. Bir xil qiymat bilan qayta chaqirish xavfsiz. */
export function setCompanyScope(companyId: string | null): void {
  activeCompanyId = companyId
}

export function getCompanyScope(): string | null {
  return activeCompanyId
}

interface EqFilterable<Q> {
  eq(column: string, value: string): Q
}

/** So'rovga `company_id = faol firma` qo'shadi (faol firma o'rnatilmagan bo'lsa — o'zgarishsiz). */
export function scopeCompany<Q>(query: Q, column = 'company_id'): Q {
  // PostgREST builder'i: .eq() o'sha turdagi builder'ni qaytaradi (tur cheklovi — chuqur instansiyadan qochish)
  return activeCompanyId ? (query as unknown as EqFilterable<Q>).eq(column, activeCompanyId) : query
}

/**
 * RPC argumenti: faol firma o'rnatilgan bo'lsa `{ p_company_id }`, aks holda bo'sh obyekt (server
 * default — o'z firmasi). Server `p_company_id` ni faqat super_admin uchun qo'llaydi.
 */
export function companyScopeArg(): { p_company_id?: string } {
  return activeCompanyId ? { p_company_id: activeCompanyId } : {}
}
