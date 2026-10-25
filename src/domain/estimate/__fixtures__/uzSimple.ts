// O'zbekcha oddiy jadval: sarlavha birinchi qatorda, tur ustuni bor, "Jami" qatori.
import type { Cell } from '../types'

export const UZ_SIMPLE: Cell[][] = [
  ['T/r', 'Nomi', "O'lchov birligi", 'Miqdori', 'Narxi', 'Summa', 'Turi'],
  [1, "G'isht M100", 'dona', 10000, 1200, 12000000, 'material'],
  [2, 'Sement M400', 'qop', '50', '65 000', '3 250 000', 'Material'],
  [3, "G'isht terish", 'm3', 25, 350000, 8750000, 'ish'],
  [4, 'Qum', 'm3', '0', 120000, 0, 'material'],
  [5, 'Kafel', '', 40, 95000, 3800000, 'material'],
  [6, 'Armatura', 'kg', 100, -5, null, 'material'],
  [null, 'Jami', null, null, null, 27800000, null],
]
