import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ALL_TYPES, energyAt, maxEnergyOf, type SpeciesRole, type TypeSlug } from '../../../engine'
import { Button, EmptyState, HelpDot, MonTile, Panel, PixelIcon, Segmented, Select, Switch } from '../../components'
import { hintAnchor, useHintScreen } from '../../hints'
import { fmtInt } from '../../lib/format'
import { useNames } from '../../lib/names'
import { navigate } from '../../router'
import { useNow } from '../../store/clock'
import { usePlayer } from '../../store/selectors'
import { filteredMons, filtersActive, useBoxFilters, type BoxSort, type BoxWhere } from './filters'

const ROLES: SpeciesRole[] = ['scholar', 'hunter', 'sprinter', 'marathoner', 'technician', 'guardian', 'support', 'allrounder']

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
        <Button
          variant="secondary"
          icon="bag"
          onClick={() => navigate('bag')}
          aria-label={t('box.bagLink', { dust: fmtInt(player.dust, names.lng) })}
          trailing={
            <span className="flex items-center gap-1 text-exp-400">
              <PixelIcon name="dust" size={20} />
              <span className="font-num text-xl leading-none tabular">{fmtInt(player.dust, names.lng)}</span>
            </span>
          }
          {...hintAnchor('box.bag')}
        >
          {t('nav.bag')}
        </Button>
      </header>

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
    </div>
  )
}
