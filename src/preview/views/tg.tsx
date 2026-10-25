// Mini App ko'rgazma ekranlari ro'yxati (/__preview?view=…). Komponentlar — tgScreens.tsx.
import type { PreviewView } from '../types'
import { DirectorPreview, MovementPreview, ProrabHomePreview, PurchasePreview } from './tgScreens'

export const views: PreviewView[] = [
  {
    id: 'tg-home-prorab',
    title: 'Mini App · Bosh (prorab)',
    surface: 'tg',
    role: 'prorab',
    render: () => <ProrabHomePreview />,
  },
  { id: 'tg-home-director', title: 'Mini App · Bosh (direktor)', surface: 'tg', role: 'direktor', render: () => <DirectorPreview /> },
  { id: 'tg-movement', title: 'Mini App · Kirim / chiqim', surface: 'tg', role: 'prorab', render: () => <MovementPreview /> },
  { id: 'tg-purchase', title: 'Mini App · Xarid', surface: 'tg', role: 'haydovchi', render: () => <PurchasePreview /> },
]
