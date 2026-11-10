import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminUpload, LiveEventImage } from '../../../../game/protocol'
import { Button } from '../../../components'
import { cx } from '../../../lib/cx'
import { eventsAdminApi } from './api'
import { eventsErrorText } from './errors'

/** The server accepts at most 3 MB of png / jpeg / webp (server/routes/admin/uploads.ts). */
export const UPLOAD_MAX_BYTES = 3 * 1024 * 1024
export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

/** Why a file cannot be uploaded, before sending it: a `eventsAdmin.image.*` error key, or null when it looks fine. */
export function uploadProblem(file: Pick<File, 'type' | 'size'>): 'unsupported_type' | 'body_too_large' | 'empty' | null {
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) return 'unsupported_type'
  if (file.size === 0) return 'empty'
  if (file.size > UPLOAD_MAX_BYTES) return 'body_too_large'
  return null
}

export interface ImagePickerProps {
  imageId: string | null
  image: LiveEventImage | null
  onChange: (imageId: string | null, image: LiveEventImage | null) => void
  disabled?: boolean
}

const toImage = (u: AdminUpload): LiveEventImage => ({ url: u.url, thumbUrl: u.thumbUrl, width: u.width, height: u.height })

/**
 * Event image: upload (png / jpeg / webp, 3 MB), a 16:9 preview of how it is cropped, and the images already
 * uploaded to pick from. The server re-encodes everything; what shows here is what players will get.
 */
export function ImagePicker({ imageId, image, onChange, disabled }: ImagePickerProps) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gallery, setGallery] = useState<AdminUpload[] | null>(null)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    const problem = uploadProblem(file)
    if (problem) {
      setError(t(`eventsAdmin.errors.${problem === 'empty' ? 'invalid_image' : problem}`))
      return
    }
    setBusy(true)
    try {
      const res = await eventsAdminApi.upload(file)
      onChange(res.upload.id, toImage(res.upload))
      setGallery((g) => (g ? [res.upload, ...g.filter((u) => u.id !== res.upload.id)] : g))
    } catch (e) {
      setError(eventsErrorText(e))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const loadGallery = async () => {
    setError(null)
    try {
      setGallery((await eventsAdminApi.uploads()).items)
    } catch (e) {
      setError(eventsErrorText(e))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="font-display text-base text-mist-300">{t('eventsAdmin.image.title')}</p>
      <div className="aspect-video w-full max-w-md bg-dusk-900 inset-shadow-well">
        {image ? (
          <img src={image.thumbUrl} srcSet={`${image.thumbUrl} 480w, ${image.url} ${Math.max(image.width, 481)}w`} sizes="28rem" alt={t('eventsAdmin.image.alt')} className="size-full object-cover" />
        ) : (
          <p className="grid size-full place-items-center p-4 text-center text-sm text-mist-400">{t('eventsAdmin.image.none')}</p>
        )}
      </div>
      <p className="text-sm text-mist-400">{t('eventsAdmin.image.hint')}</p>
      <div className="flex flex-wrap gap-2">
        <input ref={input} type="file" accept={UPLOAD_TYPES.join(',')} className="sr-only" id="event-image-file" tabIndex={-1} onChange={(e) => void pick(e.target.files?.[0])} disabled={disabled || busy} />
        <Button variant="secondary" size="sm" icon="up" disabled={disabled || busy} onClick={() => input.current?.click()}>
          {busy ? t('eventsAdmin.image.uploading') : image ? t('eventsAdmin.image.replace') : t('eventsAdmin.image.upload')}
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled || busy} onClick={() => void loadGallery()}>
          {t('eventsAdmin.image.gallery')}
        </Button>
        {imageId && (
          <Button variant="ghost" size="sm" icon="trash" disabled={disabled || busy} onClick={() => onChange(null, null)}>
            {t('eventsAdmin.image.remove')}
          </Button>
        )}
      </div>
      <p className="min-h-5 text-sm break-words text-cheek-400" role="alert">
        {error}
      </p>
      {gallery && (
        <div className="flex flex-col gap-2">
          {gallery.length === 0 ? (
            <p className="text-sm text-mist-400">{t('eventsAdmin.image.galleryEmpty')}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={t('eventsAdmin.image.gallery')}>
              {gallery.slice(0, 12).map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={u.id === imageId}
                    aria-label={t('eventsAdmin.image.use', { size: `${u.width}×${u.height}`, count: u.inUse })}
                    onClick={() => onChange(u.id, toImage(u))}
                    className={cx('block w-full bg-dusk-900 p-0.5 hover:bg-dusk-700', u.id === imageId && 'outline-2 outline-volt-400')}
                  >
                    <img src={u.thumbUrl} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
