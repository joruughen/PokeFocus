import { Button } from './components'
import { cx } from './lib/cx'

/**
 * The hamburger: one button that stays on the edge of the side menu and slides with it (`--rail`), its three
 * bars turning into a cross while the menu is open. At the top left when the menu is hidden. Not on phones.
 */
export function NavToggle({ hidden, onToggle, label }: { hidden: boolean; onToggle: () => void; label: string }) {
  const bar = 'absolute left-0 block h-0.5 w-full bg-current transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none'
  return (
    <div className="fixed top-6 left-[max(0.75rem,calc(var(--rail)_-_2.5rem))] z-40 transition-[left] duration-300 ease-out max-sm:hidden max-xl:top-3 max-xl:left-[max(0.75rem,calc((var(--rail)_-_2rem)_/_2))] motion-reduce:transition-none">
      <Button
        variant="ghost"
        size="sm"
        aria-label={label}
        aria-expanded={!hidden}
        title={label}
        onClick={onToggle}
        className="size-8 min-h-8! bg-dusk-800/80 px-0! text-mist-300 shadow-frame hover:bg-dusk-700 hover:text-mist-50"
      >
        <span className="relative block h-3 w-4" aria-hidden>
          <span className={cx(bar, 'top-0', !hidden && 'translate-y-[5px] rotate-45')} />
          <span className={cx(bar, 'top-[5px]', !hidden && 'scale-x-0 opacity-0')} />
          <span className={cx(bar, 'top-[10px]', !hidden && '-translate-y-[5px] -rotate-45')} />
        </span>
      </Button>
    </div>
  )
}
