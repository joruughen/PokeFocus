import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ADMIN_GRANT_LIMITS } from '../../../../game/admin'
import { Button, Dialog, DialogClose, TextField } from '../../../components'

export interface ConfirmActionProps {
  trigger: ReactElement
  title: string
  body: string
  confirmLabel: string
  /** Gets the optional reason that goes to the audit log. */
  onConfirm: (reason: string) => void
}

/** Confirmation with an optional reason (kept in the audit log) for the support actions that cannot be undone. */
export function ConfirmAction({ trigger, title, body, confirmLabel, onConfirm }: ConfirmActionProps) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  return (
    <Dialog
      trigger={trigger}
      title={title}
      description={body}
      footer={
        <>
          <DialogClose render={<Button variant="ghost">{t('common.cancel')}</Button>} />
          <DialogClose
            render={
              <Button
                variant="danger"
                onClick={() => {
                  onConfirm(reason.trim())
                  setReason('')
                }}
              >
                {confirmLabel}
              </Button>
            }
          />
        </>
      }
    >
      <TextField label={t('admin.players.reason')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={ADMIN_GRANT_LIMITS.reasonMax} hint={t('admin.players.reasonHint')} />
    </Dialog>
  )
}
