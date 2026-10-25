// Rus tilidagi grand-smeta uslubi: sarlavhadan oldin sarlavha matnlari, birlashtirilgan
// (bo'sh) kataklar, ustun raqamlari qatori, bo'limlar, "Итого по разделу", raqamlar ham satr
// ("1 234,56"), ham number (1234.56), bo'sh ustunlar. Ustunlar tartibi: №, обоснование,
// наименование, ед. изм., кол-во, (bo'sh), стоимость единицы, общая стоимость.
import type { Cell } from '../types'

export const GRAND_SMETA: Cell[][] = [
  ['ЛОКАЛЬНЫЙ СМЕТНЫЙ РАСЧЕТ № 02-01-01', null, null, null, null, null, null, null],
  ['на общестроительные работы', null, null, null, null, null, null, null],
  ['Сметная стоимость', null, null, '1 234,56 тыс. руб.', null, null, null, null],
  [],
  ['№ п/п', 'Обоснование', 'Наименование работ и затрат', 'Ед. изм.', 'Кол-во', null, 'Стоимость единицы, руб.', 'Общая стоимость, руб.'],
  [1, 2, 3, 4, 5, 6, 7, 8],
  ['Раздел 1. Земляные работы', null, null, null, null, null, null, null],
  [1, 'ФЕР01-01-003-01', 'Разработка грунта экскаватором', 'м3', '1 250,5', null, '12 000', 15006000],
  [2, 'ФССЦ-408-0122', 'Песок природный', 'м3', 120.75, null, 85000.5, '10 263 810,38'],
  [null, null, 'Итого по разделу 1', null, null, null, null, 25269810.38],
  ['Раздел 2. Бетонные работы', null, null, null, null, null, null, null],
  [3, 'ФССЦ-101-1234', 'Цемент М500', 'т', '12,5', null, '1 450 000', '18 125 000'],
  [4, 'ФССЦ-101-1234', 'Цемент М500', 'т', 2.5, null, 1500000, 3750000],
  [5, 'ФССЦ-204-0001', 'Арматура А500С Ø12', 'т', 'abc', null, 9800000, null],
  [6, 'ФССЦ-101-0001', 'Бетон В25', 'м3', 0.1 + 0.2, null, 950000, 400000],
  [null, null, 'Итого по разделу 2', null, null, null, null, 22275000],
  [null, null, null, null, null, null, null, null],
  ['Всего по смете', null, null, null, null, null, null, 47544810.38],
]

export const GRAND_SMETA_HEADER_ROW = 4
