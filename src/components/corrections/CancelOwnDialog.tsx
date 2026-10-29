// O'z yozuvini bekor qilish (RPC cancel_own_entry, 30 daqiqalik oyna) — sabab majburiy.
// Veb: "Xaridlar" va "Xarajatlar" tablari.
import { useState } from 'react'
import { Button, Modal, Notice, TextAreaField } from '@/components/ui'
import { CORRECTION_NOTE_MAX } from '@/data/correctionsRepo'
import { t } from '@/i18n'

export function CancelOwnDialog({
  busy,
  error,
  onClose,
  onConfirm,
}: {
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const [missing, setMissing] = useState(false)
  return (
    <Modal
      title={t.correction.cancelTitle}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.common.back}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() => {
              if (!reason.trim()) {
                setMissing(true)
                return
              }
              onConfirm(reason)
            }}
          >
            {t.correction.cancelConfirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t.correction.cancelText}</p>
        <TextAreaField
          label={t.correction.cancelReason}
          required
          aria-required="true"
          rows={2}
          maxLength={CORRECTION_NOTE_MAX}
          value={reason}
          error={missing ? t.correction.errCancelReason : null}
          onChange={(e) => {
            setReason(e.target.value)
            setMissing(false)
          }}
        />
        {error && <Notice>{error}</Notice>}
      </div>
    </Modal>
  )
}
