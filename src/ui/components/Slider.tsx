import { Slider as BaseSlider } from '@base-ui/react/slider'
import { cx } from '../lib/cx'

export interface SliderProps {
  /** 0–1. */
  value: number
  onChange: (value: number) => void
  /** Fired when the drag/keypress ends (e.g. play a preview sound). */
  onCommit?: (value: number) => void
  label: string
  disabled?: boolean
  className?: string
}

/** Pixel volume slider (Base UI Slider: keyboard, aria). Shows 0–100 %. */
export function Slider({ value, onChange, onCommit, label, disabled, className }: SliderProps) {
  const pct = Math.round(value * 100)
  return (
    <BaseSlider.Root
      value={pct}
      min={0}
      max={100}
      step={5}
      disabled={disabled}
      onValueChange={(v) => onChange((Array.isArray(v) ? v[0]! : v) / 100)}
      onValueCommitted={(v) => onCommit?.((Array.isArray(v) ? v[0]! : v) / 100)}
      className={cx('flex items-center gap-4', disabled && 'opacity-45', className)}
    >
      <BaseSlider.Control className="flex min-w-40 flex-1 touch-none items-center py-3 select-none">
        <BaseSlider.Track className="relative h-3 w-full bg-ink shadow-frame select-none">
          <BaseSlider.Indicator className="bg-volt-400 select-none">
            <div className="h-1 bg-white/35" />
          </BaseSlider.Indicator>
          <BaseSlider.Thumb
            aria-label={label}
            getAriaValueText={() => `${pct} %`}
            className="h-6 w-4 bg-mist-50 shadow-raised select-none has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-volt-400 data-dragging:bg-volt-300"
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
      <span className="w-12 shrink-0 text-right font-num text-2xl leading-none tabular" aria-hidden>
        {pct}
      </span>
    </BaseSlider.Root>
  )
}
