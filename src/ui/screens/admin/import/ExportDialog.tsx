import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog } from '../../../components'
import { downloadText } from './logic'

export interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The JSON text. */
  text: string
  fileName: string
  kind: 'event' | 'content'
}

/** «Exportar JSON»: the document in the import format, to copy or download. */
export function ExportDialog({ open, onOpenChange, text, fileName, kind }: ExportDialogProps) {
  const { t } = useTranslation()
  const id = useId()
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (open) setNote(null)
  }, [open])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setNote(t('adminJson.export.copied'))
    } catch {
      setNote(t('adminJson.export.copyFailed'))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('adminJson.export.title')}
      description={t(kind === 'event' ? 'adminJson.export.intro' : 'adminJson.export.introContent')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          <Button variant="secondary" icon="copy" onClick={() => void copy()}>
            {t('adminJson.export.copy')}
          </Button>
          <Button icon="check" onClick={() => downloadText(fileName, text)}>
            {t('adminJson.export.download')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="font-display text-base text-mist-300">
          {t('adminJson.export.label')}
        </label>
        <textarea
          id={id}
          readOnly
          rows={14}
          value={text}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          className="min-h-64 w-full bg-dusk-900 px-3 py-2 font-num text-sm text-mist-50 shadow-frame inset-shadow-well"
        />
        <p className="min-h-5 text-sm text-mist-300" role="status">
          {note}
        </p>
      </div>
    </Dialog>
  )
}
