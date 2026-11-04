import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ALL_TYPES, defaultContext, energyAt, maxEnergyOf, type SpeciesRole, type TypeSlug } from '../../../engine'
import { BallIcon, Button, EmptyState, HelpDot, MonTile, Panel, PixelIcon, Segmented, Select, Sprite, Switch, Tooltip, TYPE_TEXT } from '../../components'
import { hintAnchor, useHintScreen } from '../../hints'
import { cx } from '../../lib/cx'
import { fmtInt } from '../../lib/format'
import { useNames } from '../../lib/names'
import { navigate } from '../../router'
import { useNow } from '../../store/clock'
import { usePlayer } from '../../store/selectors'
import { lineRoot } from '../shared/EvoLine'
import { filteredMons, filtersActive, useBoxFilters, type BoxSort, type BoxWhere } from './filters'

const ctx = defaultContext()
const ROLES: SpeciesRole[] = ['scholar', 'hunter', 'sprinter', 'marathoner', 'technician', 'guardian', 'support', 'allrounder']
const HEAL_ITEMS = ['potion', 'super-potion', 'hyper-potion', 'revive']

/** The Box: every Pokémon you own, with filters, sort and search. Tiles open the detail sheet. */
export function Box() {
  useHintScreen('box')
  const { t } = useTranslation()
  const names = useNames()
  const player = usePlayer()
  const now = useNow()
  const f = useBoxFilters()
  const minute = Math.floor(now / 60_000)
  const list = useMemo(() => filteredMons(player, f, names.lng), [player, f, names.lng])
  // Energy fraction now (engine energyAt / maxEnergyOf), refreshed once per game minute.
  const energies = useMemo(() => {
    const out: Record<string, number> = {}
    for (const p of list) out[p.uid] = energyAt(player, p, minute * 60_000) / Math.max(1, maxEnergyOf(p))
    return out
  }, [list, player, minute])
  const total = Object.keys(player.pokemon).length
  const onlyStarter = total <= 1

  const typeOptions = [{ value: 'any', label: t('box.filter.anyType') }, ...ALL_TYPES.map((ty) => ({ value: ty, label: names.type(ty) }))]
  const roleOptions = [{ value: 'any', label: t('box.filter.anyRole') }, ...ROLES.map((r) => ({ value: r, label: t(`roles.${r}.name`) }))]
  const sortOptions: { value: BoxSort; label: string }[] = [
    { value: 'recent', label: t('box.sort.recent') },
    { value: 'level', label: t('box.sort.level') },
    { value: 'species', label: t('box.sort.species') },
    { value: 'iv', label: t('box.sort.iv') },
  ]

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl">
            {t('nav.box')}
            <HelpDot hint="box.intro" />
          </h1>
          <p className="mt-1 text-mist-300">{t('box.count', { count: total, team: player.team.length })}</p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel variant="frame" padded={false} className="flex flex-col gap-4 p-4" {...hintAnchor('box.filters')}>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex min-w-48 flex-1 flex-col gap-1.5">
                <span className="font-display text-base text-mist-300">{t('box.search')}</span>
                <span className="flex min-h-11 items-center gap-2 bg-dusk-900 px-3 shadow-frame inset-shadow-well focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-volt-400">
                  <PixelIcon name="search" size={20} className="text-mist-400" />
                  <input
                    type="search"
                    value={f.query}
                    onChange={(e) => f.set({ query: e.target.value })}
                    placeholder={t('box.searchPlaceholder')}
                    className="min-w-0 flex-1 bg-transparent text-mist-50 outline-none placeholder:text-mist-400"
                  />
                </span>
              </label>
              <Select className="w-44" label={t('box.filter.type')} options={typeOptions} value={f.type} onChange={(v) => f.set({ type: v as TypeSlug | 'any' })} />
              <Select className="w-44" label={t('box.filter.role')} options={roleOptions} value={f.role} onChange={(v) => f.set({ role: v as SpeciesRole | 'any' })} />
              <Select className="w-44" label={t('box.sort.label')} options={sortOptions} value={f.sort} onChange={(v) => f.set({ sort: v as BoxSort })} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <Segmented<BoxWhere>
                label={t('box.filter.where')}
                value={f.where}
                onChange={(where) => f.set({ where })}
                options={[
                  { value: 'all', label: t('box.where.all') },
                  { value: 'team', label: t('box.where.team') },
                  { value: 'box', label: t('box.where.box') },
                ]}
              />
              <div className="flex items-center gap-5">
                <label className="flex items-center gap-3 text-mist-100">
                  <Switch checked={f.shinyOnly} onChange={(shinyOnly) => f.set({ shinyOnly })} label={t('box.filter.shiny')} />
                  <span className="font-display text-base">{t('box.filter.shiny')}</span>
                </label>
                {filtersActive(f) && (
                  <Button size="sm" variant="ghost" icon="close" onClick={f.reset}>
                    {t('box.clear')}
                  </Button>
                )}
              </div>
            </div>
          </Panel>

          {list.length > 0 ? (
            <ul {...hintAnchor('box.grid')} className="grid grid-cols-[repeat(auto-fill,minmax(8.25rem,1fr))] gap-3" aria-label={t('box.gridLabel', { count: list.length })}>
              {list.map((p) => {
                const slot = player.team.indexOf(p.uid)
                return (
                  <li key={p.uid}>
                    <MonTile mon={p} teamSlot={slot >= 0 ? slot : null} energy={energies[p.uid] ?? 0} onClick={() => navigate('box', p.uid)} className="w-full" />
                  </li>
                )
              })}
              {onlyStarter && !filtersActive(f) && (
                <li className="col-span-full sm:col-span-2 lg:col-span-3">
                  <div className="flex h-full min-h-32 items-center gap-4 bg-ink/20 p-4 outline-2 -outline-offset-2 outline-mist-400/40 outline-dashed">
                    <PixelIcon name="plus" size={30} className="shrink-0 text-mist-400" />
                    <div>
                      <p className="font-display text-lg">{t('box.emptyMore.title')}</p>
                      <p className="text-sm text-mist-300">{t('box.emptyMore.body')}</p>
                    </div>
                  </div>
                </li>
              )}
            </ul>
          ) : (
            <div className="bg-dusk-800 shadow-plate">
              <EmptyState
                title={t('box.noMatch.title')}
                body={t('box.noMatch.body')}
                action={
                  <Button icon="close" variant="secondary" onClick={f.reset}>
                    {t('box.clear')}
                  </Button>
                }
              />
            </div>
          )}
        </div>

        <Bag />
      </div>
    </div>
  )
}

/** What you carry: Dust, balls, candies by line and type, healing items, stones. */
function Bag() {
  const { t, i18n } = useTranslation()
  const names = useNames()
  const player = usePlayer()
  const lng = i18n.language
  const chains = Object.entries(player.candies.chains).filter(([, n]) => n > 0)
  const types = Object.entries(player.candies.types).filter(([, n]) => (n ?? 0) > 0) as [TypeSlug, number][]
  const items = Object.entries(player.inventory).filter(([k, n]) => n > 0 && !k.endsWith('-ball'))
  const rootOfChain = (id: string) => {
    const sp = ctx.data.species.find((s) => String(s.evolutionChainId) === id)
    return sp ? lineRoot(sp) : null
  }
  return (
    <aside className="flex flex-col gap-6" aria-label={t('bag.title')}>
      <Panel title={t('bag.title')} help="box.candies" {...hintAnchor('box.bag')}>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-3 xl:grid-cols-1">
        <div>
        <ul className="flex flex-col gap-2.5">
          <li className="flex items-center gap-3">
            <PixelIcon name="dust" size={20} className="text-exp-400" />
            <Tooltip content={t('items.dustTip')}>
              <span tabIndex={0} className="flex-1">{t('items.dust')}</span>
            </Tooltip>
            <span className="font-num text-2xl leading-none tabular">{fmtInt(player.dust, lng)}</span>
          </li>
          {(['poke-ball', 'great-ball', 'ultra-ball'] as const).map((b) => (
            <li key={b} className="flex items-center gap-3">
              <BallIcon ball={b} size={24} />
              <span className="flex-1">{names.item(b)}</span>
              <span className="font-num text-2xl leading-none tabular">{player.inventory[b] ?? 0}</span>
            </li>
          ))}
        </ul>

        </div>
        <div>
        <h3 className="mb-2 text-lg">{t('bag.candies')}</h3>
        {chains.length + types.length === 0 ? (
          <p className="text-sm text-mist-300">{t('bag.noCandies')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {chains.map(([id, n]) => {
              const root = rootOfChain(id)
              return (
                <li key={id} className="flex items-center gap-2">
                  <span className="grid h-8 w-10 place-items-center">{root && <Sprite kind="icon" slug={root.slug} alt="" />}</span>
                  <span className="flex-1 truncate text-sm">{root ? t('bag.lineCandy', { name: names.species(root.slug) }) : id}</span>
                  <span className="font-num text-xl leading-none tabular">{n}</span>
                </li>
              )
            })}
            {types.map(([ty, n]) => (
              <li key={ty} className="flex items-center gap-2">
                <span className="grid h-8 w-10 place-items-center">
                  <PixelIcon name="candy" size={20} className={cx(TYPE_TEXT[ty])} />
                </span>
                <span className="flex-1 truncate text-sm">{t('bag.typeCandy', { type: names.type(ty) })}</span>
                <span className="font-num text-xl leading-none tabular">{n}</span>
              </li>
            ))}
          </ul>
        )}

        </div>
        <div>
        <h3 className="mb-2 text-lg">{t('bag.items')}</h3>
        {items.length === 0 ? (
          <p className="text-sm text-mist-300">{t('bag.noItems')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {items.map(([k, n]) => (
              <li key={k} className="flex items-center gap-2">
                <span className="grid h-8 w-10 place-items-center">
                  <Sprite kind="item" slug={k} fit={30} alt="" />
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  {names.item(k)}
                  {HEAL_ITEMS.includes(k) && <span className="block text-xs text-mist-400">{t('bag.healHow')}</span>}
                </span>
                <span className="font-num text-xl leading-none tabular">{n}</span>
              </li>
            ))}
          </ul>
        )}
        </div>
        </div>
      </Panel>
    </aside>
  )
}
