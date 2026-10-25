// Farq qoidasi 2 — "O'zi tekshirmagan": xarid qilgan va qabul qilgan bitta odam (belgi, ogohlantirish emas).

/** Kirimni kiritgan (`receiverId`) xaridor (`buyerId`) bilan bir xil bo'lsa — true. Kirim yo'q (null) → false. */
export function isSelfReceived(buyerId: string, receiverId: string | null): boolean {
  return receiverId !== null && receiverId === buyerId
}
