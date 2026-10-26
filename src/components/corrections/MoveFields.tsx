// Muallif tuzatishi: material va obyektni almashtirish (correct_entry p_material_id / p_object_id).
// Faqat 30 daqiqalik oynada, bog'lanmagan yozuvda (server tekshiradi). Veb va Telegram ilovasi uchun umumiy.
import { SelectField } from '@/components/ui'
import type { Material, ObjectRow } from '@/data/types'
import { t } from '@/i18n'

const tc = t.correction

export function MoveFields({
  choices,
  materialId,
  objectId,
  onMaterial,
  onObject,
}: {
  choices: { materials: Material[]; objects: ObjectRow[] } | null
  materialId: string
  objectId: string
  onMaterial: (id: string) => void
  onObject: (id: string) => void
}) {
  if (!choices) return null
  return (
    <div className="flex flex-col gap-4" data-testid="correction-move">
      <SelectField label={tc.material} hint={tc.materialHint} value={materialId} onChange={onMaterial}>
        {choices.materials.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </SelectField>
      {choices.objects.length > 1 && (
        <SelectField label={tc.object} value={objectId} onChange={onObject}>
          {choices.objects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </SelectField>
      )}
    </div>
  )
}
