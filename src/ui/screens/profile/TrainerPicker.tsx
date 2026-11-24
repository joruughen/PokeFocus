/**
 * «Tu personaje» (Profile): the trainer that stands next to your team in the study-group scenes.
 *
 * The catalogue has 1500+ sprites, so the Profile only shows the current one and a button; the choosing happens
 * in a dialog (`TrainerChooser`): a live preview with your own leader, a search box, groups with counters
 * (the featured 24, stock sprites, older games by generation, fan art by author), a paged grid with lazy images,
 * «Surprise me», and an explicit «Use this character» (nothing is saved by a stray tap).
 */
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  countByGroup,
  countBySub,
  filterTrainers,
  randomTrainer,
  isTrainerSprite,
  resolveTrainerSprite,
  TRAINER_AUTHORS,
  TRAINER_CATALOG,
  TRAINER_GENS,
  trainerEntry,
  type TrainerGroup,
} from '../../../game/trainerCatalog'
import { defaultTrainerSprite } from '../../../game/trainers'
import { Button, Dialog, Mascot, PixelIcon, Platform, Segmented, Select, Sprite, TextField, toast, Tooltip, TrainerSprite } from '../../components'
import { cx } from '../../lib/cx'
import { useMinWidth } from '../../lib/useMinWidth'
import { SHOWCASE_GAMMA } from '../../lib/spriteSize'
import { useAuth } from '../../store/auth'
import { useGame } from '../../store/game'

/** Tiles drawn at a time; «Show more» adds this many. */
export const PAGE_SIZE = 48

export interface Leader {
  slug: string
  shiny: boolean
}

/** The name the player sees: translated for the featured ones, else the English name made from the slug. */
function useTrainerName() {
  const { t, i18n } = useTranslation()
  const localName = (slug: string): string | undefined => (i18n.exists(`trainers.names.${slug}`) ? t(`trainers.names.${slug}`) : undefined)
  const name = (slug: string): string => localName(slug) ?? trainerEntry(slug)?.label ?? slug
  return { localName, name }
}

/** A trainer next to a Pokémon on their platforms: how you will look in the group (leader optional). */
export function TrainerPreview({ slug, leader, big = true, className }: { slug: string; leader: Leader | null; big?: boolean; className?: string }) {
  const { name } = useTrainerName()
  const scale = big ? 2 : 1
  return (
    <div className={cx('relative flex shrink-0 items-end justify-center bg-[linear-gradient(to_bottom,var(--color-dusk-700),var(--color-dusk-900))] px-3 pt-4 pb-3', className)}>
      <div className="relative flex shrink-0 flex-col items-center" style={{ width: 52 * scale }}>
        <Platform width={52 * scale} night className="absolute bottom-0 left-1/2 -translate-x-1/2" />
        <TrainerSprite slug={slug} scale={scale} flip alt={name(slug)} className="relative -mb-1" />
      </div>
      {leader && (
        <div className="relative -ml-2 flex shrink-0 flex-col items-center" style={{ width: 62 * scale }}>
          <Platform width={62 * scale} night className="absolute bottom-0 left-1/2 -translate-x-1/2" />
          <Sprite kind="showdown" slug={leader.slug} shiny={leader.shiny} box={{ height: big ? 156 : 72, width: big ? 124 : 62, gamma: SHOWCASE_GAMMA }} flip alt="" className="relative mb-2" />
        </div>
      )}
    </div>
  )
}

export interface TrainerChooserProps {
  /** The saved character. */
  current: string
  /** The default of the account, tagged until the player chooses. */
  defaultSlug: string
  /** True once the player has chosen one (the default tag goes away). */
  chosen: boolean
  leader: Leader | null
  saving?: boolean
  onSave: (slug: string) => void
  onCancel: () => void
  /** Starting state (the dialog opens on the group of the current character; tests and the dev preview pick others). */
  initialGroup?: TrainerGroup | 'all'
  initialSub?: string
  initialQuery?: string
  initialPending?: string
}

export function TrainerChooser({ current, defaultSlug, chosen, leader, saving = false, onSave, onCancel, initialGroup, initialSub = '', initialQuery = '', initialPending }: TrainerChooserProps) {
  const { t } = useTranslation()
  const { name, localName } = useTrainerName()
  const wide = useMinWidth(640)
  const [pending, setPending] = useState(initialPending ?? current)
  const [group, setGroup] = useState<TrainerGroup | 'all'>(initialGroup ?? trainerEntry(current)?.group ?? 'featured')
  const [sub, setSub] = useState(initialSub)
  const [query, setQuery] = useState(initialQuery)
  const [shown, setShown] = useState(PAGE_SIZE)
  const gridRef = useRef<HTMLDivElement>(null)
  const reveal = useRef(false)

  // 1500 entries: cheap enough to filter on every render.
  const counts = countByGroup(query, localName)
  const list = filterTrainers({ group, sub, query, localName })
  const subCounts = group === 'older' || group === 'fan' ? countBySub(group, query, localName) : null
  const subTotal = subCounts ? [...subCounts.values()].reduce((a, b) => a + b, 0) : 0
  const visible = list.slice(0, shown)
  const entry = trainerEntry(pending)

  // After «Surprise me» the new tile may be below the fold: bring it into view.
  useEffect(() => {
    if (!reveal.current) return
    reveal.current = false
    gridRef.current?.querySelector(`[data-slug="${pending}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [pending, shown])

  const resetGrid = () => {
    setShown(PAGE_SIZE)
    gridRef.current?.scrollTo({ top: 0 })
  }
  const surprise = () => {
    const pick = randomTrainer(list, pending)
    if (!pick) return
    const at = list.findIndex((e) => e.slug === pick.slug)
    if (at >= shown) setShown(Math.ceil((at + 1) / PAGE_SIZE) * PAGE_SIZE)
    reveal.current = true
    setPending(pick.slug)
  }

  const groupLabel = (g: TrainerGroup | 'all') => t(`profile.character.groups.${g}`)
  const groups: (TrainerGroup | 'all')[] = ['all', 'featured', 'classic', 'older', 'fan']
  // `all` stands for «no sub-filter» (an empty option value cannot be selected in a toggle group).
  const genOptions = [
    { value: 'all', label: `${t('profile.character.allGens')} ${subTotal}` },
    ...TRAINER_GENS.map((g) => ({ value: g, label: `${t('profile.character.gen', { n: g.slice(3) })} ${subCounts?.get(g) ?? 0}` })),
  ]
  const authorOptions = [
    { value: 'all', label: t('profile.character.allAuthors', { count: subTotal }) },
    ...TRAINER_AUTHORS.map((a) => ({ value: a.author, label: `${a.author} (${subCounts?.get(a.author) ?? 0})` })),
  ]

  // Everything fits the screen: the grid takes the room left (the dialog has 9.5rem of title and padding), so the
  // buttons never end up below the fold. On a very short screen the dialog itself scrolls.
  return (
    <div className="flex h-[min(calc(100dvh-9.5rem),46rem)] flex-col gap-3 sm:gap-4 [&>*]:shrink-0">
      <div className="flex items-center gap-3 sm:gap-4">
        <TrainerPreview slug={pending} leader={leader} big={wide} className="w-32 sm:w-72" />
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="font-display text-xl leading-tight text-volt-300 [overflow-wrap:anywhere] sm:text-2xl">{name(pending)}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-mist-300">
            {entry?.credit && <span>{t('profile.character.credit', { author: entry.credit })}</span>}
            {pending === current && <span className="bg-leaf-600 px-1.5 font-display text-ink">{t('profile.character.currentTag')}</span>}
            {!chosen && pending === defaultSlug && <span className="bg-dusk-600 px-1.5 font-display text-mist-100">{t('profile.character.defaultTag')}</span>}
          </p>
        </div>
      </div>

      <TextField
        label={t('profile.character.search')}
        className="[&>label]:max-sm:sr-only"
        type="search"
        autoComplete="off"
        spellCheck={false}
        placeholder={t('profile.character.searchPlaceholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          resetGrid()
        }}
      />

      <Segmented
        size={wide ? 'md' : 'sm'}
        label={t('profile.character.groupLabel')}
        value={group}
        onChange={(g) => {
          setGroup(g)
          setSub('')
          resetGrid()
        }}
        options={groups.map((g) => ({
          value: g,
          label: (
            <>
              {groupLabel(g)} <span className="font-num text-base opacity-70">{counts[g]}</span>
            </>
          ),
          ariaLabel: `${groupLabel(g)}: ${counts[g]}`,
        }))}
      />

      {group === 'older' && (
        <Segmented
          size={wide ? 'md' : 'sm'}
          label={t('profile.character.genLabel')}
          value={sub || 'all'}
          onChange={(s) => {
            setSub(s === 'all' ? '' : s)
            resetGrid()
          }}
          options={genOptions}
        />
      )}
      {group === 'fan' && (
        <Select
          label={t('profile.character.authorLabel')}
          value={sub || 'all'}
          onChange={(s) => {
            setSub(s === 'all' ? '' : s)
            resetGrid()
          }}
          options={authorOptions}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm text-mist-300" aria-live="polite">
          {t('profile.character.shown', { shown: Math.min(shown, list.length), total: list.length })}
        </p>
        <Button size="sm" variant="secondary" icon="reroll" disabled={list.length === 0} onClick={surprise}>
          {t('profile.character.random')}
        </Button>
      </div>

      <div ref={gridRef} className="scroll-dusk min-h-40 flex-1 shrink! overflow-y-auto bg-dusk-900 p-2 inset-shadow-well">
        {list.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <Mascot pose="think" size={48} />
            <p className="max-w-[38ch] text-mist-300">{t('profile.character.empty', { q: query.trim() })}</p>
            {group !== 'all' && counts.all > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setGroup('all')
                  setSub('')
                }}
              >
                {t('profile.character.emptyAll', { count: counts.all })}
              </Button>
            )}
          </div>
        ) : (
          <>
            <ToggleGroup
              aria-label={t('profile.character.label')}
              value={[pending]}
              onValueChange={(v) => {
                const next = v[0]
                if (next) setPending(next)
              }}
              className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2"
            >
              {visible.map((e) => {
                const label = name(e.slug)
                return (
                  <Toggle
                    key={e.slug}
                    value={e.slug}
                    data-slug={e.slug}
                    aria-label={e.credit ? `${label} (${e.credit})` : label}
                    title={e.credit ? `${label} · ${e.credit}` : label}
                    className={cx(
                      'relative flex min-w-0 flex-col items-center gap-0.5 bg-dusk-800 px-1 pt-1 pb-1.5 select-none',
                      'transition-[background-color,outline-color] duration-75 hover:bg-dusk-700',
                      'data-pressed:bg-dusk-600 data-pressed:outline-2 data-pressed:-outline-offset-2 data-pressed:outline-volt-400',
                    )}
                  >
                    <TrainerSprite slug={e.slug} alt="" lazy />
                    <span className="line-clamp-2 w-full text-center text-xs leading-tight text-mist-100 [overflow-wrap:anywhere]">{label}</span>
                    {e.slug === current && <PixelIcon name="check" size={10} className="absolute top-1 right-1 text-leaf-400" />}
                    {!chosen && e.slug === defaultSlug && <span className="absolute top-1 left-1 bg-dusk-600 px-1 font-display text-xs leading-4 text-mist-100">{t('profile.character.defaultTag')}</span>}
                  </Toggle>
                )
              })}
            </ToggleGroup>
            {list.length > shown && (
              <div className="mt-3 flex justify-center">
                <Button size="sm" variant="secondary" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                  {t('profile.character.more', { count: Math.min(PAGE_SIZE, list.length - shown) })}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button size={wide ? 'md' : 'sm'} variant="ghost" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button size={wide ? 'md' : 'sm'} icon="check" disabled={saving || pending === current} aria-busy={saving} onClick={() => onSave(pending)} className="max-sm:flex-1">
          {t('profile.character.use')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Your character in the Profile hero card (next to your partner, drawn by the card itself): the name of the
 * current one, a short «?» about where it shows up, and the button that opens the chooser.
 */
export function TrainerPicker({ initialOpen = false, chooser }: { initialOpen?: boolean; chooser?: Pick<TrainerChooserProps, 'initialGroup' | 'initialSub' | 'initialQuery' | 'initialPending'> }) {
  const { t } = useTranslation()
  const { name } = useTrainerName()
  const user = useAuth((s) => s.user)
  const updateMe = useAuth((s) => s.updateMe)
  const player = useGame((s) => s.player)
  const [open, setOpen] = useState(initialOpen)
  const [saving, setSaving] = useState(false)
  if (!user) return null
  const chosen = isTrainerSprite(user.trainerSprite)
  const current = resolveTrainerSprite(user.id, user.trainerSprite)
  const leaderMon = player ? player.pokemon[player.team[0] ?? ''] : undefined
  const leader: Leader | null = leaderMon ? { slug: leaderMon.speciesSlug, shiny: leaderMon.isShiny } : null
  const credit = trainerEntry(current)?.credit

  const save = async (slug: string) => {
    setSaving(true)
    try {
      await updateMe({ trainerSprite: slug })
      toast.add({ title: t('profile.character.saved'), type: 'success' })
      setOpen(false)
    } catch {
      toast.add({ title: t('profile.character.saveError'), type: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label={t('profile.character.title')}>
      <p className="min-w-0 text-sm text-mist-100">
        <span className="font-display text-base text-volt-300">{t('profile.character.title')}</span> <span className="[overflow-wrap:anywhere]">{name(current)}</span>
        {credit && <span className="text-mist-400"> · {t('profile.character.credit', { author: credit })}</span>}
      </p>
      <Button size="sm" variant="secondary" icon="search" onClick={() => setOpen(true)}>
        {t('profile.character.change')}
      </Button>
      <Tooltip variant="help" side="bottom" content={t('profile.character.body', { count: TRAINER_CATALOG.length })}>
        <button
          type="button"
          aria-label={t('profile.character.help')}
          className="inline-grid size-6 shrink-0 place-items-center bg-dusk-600 text-volt-300 shadow-frame transition-colors hover:bg-volt-400 hover:text-ink focus-visible:bg-volt-400 focus-visible:text-ink"
        >
          <PixelIcon name="help" size={10} />
        </button>
      </Tooltip>
      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)} title={t('profile.character.dialogTitle')} size="lg">
        <TrainerChooser
          current={current}
          defaultSlug={defaultTrainerSprite(user.id)}
          chosen={chosen}
          leader={leader}
          saving={saving}
          onSave={(slug) => void save(slug)}
          onCancel={() => setOpen(false)}
          {...chooser}
        />
      </Dialog>
    </div>
  )
}
