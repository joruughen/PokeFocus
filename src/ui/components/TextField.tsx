import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../lib/cx'
import { PixelIcon } from './PixelIcon'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Visible label (Tiny5) above the input. */
  label: string
  /** Inline error: sets aria-invalid and is announced (aria-live). */
  error?: string | null
  /** Help line under the input (hidden while there is an error). */
  hint?: ReactNode
  /** Password input with a show/hide toggle. */
  revealable?: boolean
}

/**
 * Labelled text input in the well style (inset, ink frame). Errors are tied
 * to the input with aria-describedby and read out politely.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, revealable = false, type = 'text', className, id, ...rest },
  ref,
) {
  const { t } = useTranslation()
  const autoId = useId()
  const inputId = id ?? autoId
  const msgId = `${inputId}-msg`
  const [shown, setShown] = useState(false)
  const inputType = revealable ? (shown ? 'text' : 'password') : type
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="font-display text-base text-mist-300">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          type={inputType}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? msgId : undefined}
          className={cx(
            'min-h-12 w-full bg-dusk-900 px-3 text-lg text-mist-50 shadow-frame inset-shadow-well placeholder:text-mist-400',
            'disabled:text-mist-400',
            error && 'outline-2 -outline-offset-2 outline-cheek-400',
            revealable && 'pr-12',
          )}
          {...rest}
        />
        {revealable && (
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? t('auth.hidePassword') : t('auth.showPassword')}
            aria-pressed={shown}
            className="absolute inset-y-0 right-0 grid w-12 place-items-center text-mist-300 hover:text-mist-50"
          >
            <PixelIcon name={shown ? 'eyeOff' : 'eye'} size={20} />
          </button>
        )}
      </div>
      <p id={msgId} aria-live="polite" className={cx('min-h-0 text-sm', error ? 'text-cheek-400' : 'text-mist-400')}>
        {error ?? hint ?? null}
      </p>
    </div>
  )
})
