import { choiceClass } from './choiceClass'

/** Filtr chipi uslubi (veb, 14 px) — `choiceClass` ning qisqa nomi. Tanlanganda — `ice` fon + `brand` chegara. */
export function chipClass(active: boolean): string {
  return choiceClass({ selected: active, shape: 'pill', size: 'sm' })
}
