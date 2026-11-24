import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TypeSlug } from '../../../engine'
import { Button, EmptyState, HelpDot, Panel, PixelIcon, Segmented, Select, Sprite, Tooltip, TYPE_TEXT } from '../../components'
import { useHintScreen } from '../../hints'
import { cx } from '../../lib/cx'
import { fmtInt } from '../../lib/format'
import { asLocale } from '../../lib/names'
import { useNow } from '../../store/clock'
import { useContent } from '../../store/content'
import { usePlayer } from '../../store/selectors'
import { BAG_CATEGORIES, bagCounts, buildBagEntries, filterBag, sortBag, type BagEntry, type BagFilter, type BagSort } from './bagItems'

/** How many Pokémon links a card shows before "+N more". */

/** `#/bag`: Study Dust, Balls, healing items, evolution items, candies and event items, with search and filters. */
export default function Bag() {
  useHintScreen('bag')
  const { t, i18n } = useTranslation()
  const ctx = useContent()
  const player = usePlayer()
  const now = useNow()
  const lng = asLocale(i18n.language)
  const minute = Math.floor(now / 60_000)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<BagFilter>('all')
  const [sort, setSort] = useState<BagSort>('category')

  const entries = useMemo(() => buildBagEntries(player, ctx, lng, (k, p) => String(t(k, p as never)), minute * 60_000), [player, ctx, lng, t, minute])
  const totals = useMemo(() => bagCounts(entries, ''), [entries])
  const counts = useMemo(() => bagCounts(entries, query), [entries, query])
  const shown = useMemo(() => sortBag(filterBag(entries, query, category), sort, lng), [entries, query, category, sort, lng])
  const filtering = query.trim() !== '' || category !== 'all'
  const clear = () => {
    setQuery('')
    setCategory('all')
  }

  // Categories you have nothing in are hidden (the selected one always stays, so it can be left).
  const catOptions = (['all', ...BAG_CATEGORIES] as BagFilter[])
    .filter((c) => c === 'all' || c === category || totals[c] > 0)
    .map((c) => {
      const name = t(`bag.cat.${c}`)
      return {
        value: c,
        ariaLabel: t('bag.catCount', { name, count: counts[c] }),
        label: (
          <>
            {name}
            <span className="font-num text-lg leading-none opacity-80 tabular">{counts[c]}</span>
          </>
        ),
      }
    })
  const sortOptions: { value: BagSort; label: string }[] = [
    { value: 'category', label: t('bag.sort.category') },
    { value: 'name', label: t('bag.sort.name') },
    { value: 'quantity', label: t('bag.sort.quantity') },
  ]

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl">
            {t('nav.bag')}
            <HelpDot hint="bag.intro" />
          </h1>
          <p className="mt-1 text-mist-300">{t('bag.count', { count: totals.all })}</p>
        </div>
        <Tooltip content={t('items.dustTip')}>
          <div tabIndex={0} className="flex items-center gap-3 bg-dusk-800 px-4 py-2.5 shadow-frame" aria-label={`${t('items.dust')}: ${fmtInt(player.dust, i18n.language)}`}>
            <PixelIcon name="dust" size={30} className="text-exp-400" />
            <span>
              <span className="block font-display text-base leading-tight text-mist-300">{t('items.dust')}</span>
              <span className="font-num text-3xl leading-none tabular">{fmtInt(player.dust, i18n.language)}</span>
            </span>
          </div>
        </Tooltip>
      </header>

      <Panel variant="frame" padded={false} className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex min-w-48 flex-1 flex-col gap-1.5">
            <span className="font-display text-base text-mist-300">{t('bag.search')}</span>
            <span className="flex min-h-11 items-center gap-2 bg-dusk-900 px-3 shadow-frame inset-shadow-well focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-volt-400">
              <PixelIcon name="search" size={20} className="text-mist-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('bag.searchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-mist-50 outline-none placeholder:text-mist-400"
              />
            </span>
          </label>
          <Select className="w-full sm:w-48" label={t('bag.sort.label')} options={sortOptions} value={sort} onChange={(v) => setSort(v as BagSort)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented<BagFilter> label={t('bag.category')} value={category} onChange={setCategory} options={catOptions} />
          {filtering && (
            <Button size="sm" variant="ghost" icon="close" onClick={clear}>
              {t('bag.clear')}
            </Button>
          )}
        </div>
      </Panel>

      <p role="status" className="sr-only">
        {t('bag.results', { count: shown.length })}
      </p>

      {shown.length > 0 ? (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label={t('bag.listLabel', { count: shown.length })}>
          {shown.map((e) => (
            <li key={e.id}>
              <BagCard entry={e} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="bg-dusk-800 shadow-plate">
          {totals.all === 0 ? (
            <EmptyState title={t('bag.empty.title')} body={t('bag.empty.body')} />
          ) : (
            <EmptyState
              title={t('bag.noMatch.title')}
              body={query.trim() !== '' ? t('bag.noMatch.search', { query: query.trim() }) : t('bag.noMatch.category')}
              action={
                <Button icon="close" variant="secondary" onClick={clear}>
                  {t('bag.clear')}
                </Button>
              }
            />
          )}
        </div>
      )}
    </div>
  )
}

/** One object: sprite, name, quantity, what it is for and which of your Pokémon can use it. */
function BagCard({ entry: e }: { entry: BagEntry }) {
  const { t, i18n } = useTranslation()
  const ctx = useContent()
  return (
    <article className="flex h-full gap-3 bg-dusk-800 p-3 shadow-frame">
      <span className="grid h-14 w-14 shrink-0 place-items-center bg-dusk-900 inset-shadow-well">
        <EntryIcon entry={e} ctx={ctx} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-lg leading-tight [overflow-wrap:anywhere]">{e.name}</h2>
          <span className="shrink-0 font-num text-2xl leading-none tabular" aria-label={t('bag.have', { count: e.count })}>
            <span aria-hidden>×</span>
            {fmtInt(e.count, i18n.language)}
          </span>
        </div>
        <p className="text-sm text-mist-300 [overflow-wrap:anywhere]">{e.description}</p>
        {/* Only the description: the lists of Pokémon that can use an item looked cluttered (user feedback), so the Bag
            stays clean and only says when something is still locked by trainer level. */}
        {e.lockedLevel !== undefined && (
          <p className="flex items-center gap-1.5 text-xs text-amber-400">
            <PixelIcon name="lock" size={10} className="shrink-0" />
            {t('bag.lockedAt', { level: e.lockedLevel })}
          </p>
        )}
      </div>
    </article>
  )
}

function EntryIcon({ entry: e, ctx }: { entry: BagEntry; ctx: ReturnType<typeof useContent> }) {
  if (e.kind === 'typeCandy') return <PixelIcon name="candy" size={30} className={cx(TYPE_TEXT[e.slug as TypeSlug])} />
  if (e.kind === 'chainCandy') return ctx.speciesBySlug.has(e.slug) ? <Sprite kind="icon" slug={e.slug} alt="" /> : <PixelIcon name="candy" size={30} className="text-exp-400" />
  return <Sprite kind="item" slug={e.slug} fit={40} alt="" />
}
