import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { GuideView } from '@/components/help/GuideView'
import { t } from '@/i18n'
import { guides } from '@/i18n/guides.uz'
import { useBackButton } from '../useTelegramButtons'

/** Mini App "Yordam" (`/tg/help`, sarlavhadagi "?" belgisi): o'z roli qo'llanmasi va boshqa rollar. */
export function TgHelpPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  // To'g'ridan-to'g'ri ochilgan bo'lsa (tarix yo'q) — Mini App bosh ekraniga
  const first = useLocation().key === 'default'
  const back = useCallback(() => (first ? navigate('/tg') : navigate(-1)), [first, navigate])
  useBackButton(back)
  if (!profile) return null
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight text-ink print:hidden">{t.help.title}</h1>
      <GuideView guides={guides} currentRole={profile.role} />
    </div>
  )
}
