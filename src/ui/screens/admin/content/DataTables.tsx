import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { baseContext } from '../../../../engine/context'
import type { ContentPatch, SpawnWeather } from '../../../../engine/content'
import type { TypeSlug } from '../../../../engine/data-types'
import { DATA_LIMITS } from '../../../../game/content/limits'
import type { ContentIssue } from '../../../../game/protocol'
import { Button, IconButton, Segmented, Sprite, Switch, TextField, TypeBadge } from '../../../components'
import { cx } from '../../../lib/cx'
import { moveName, speciesName, typeName } from '../../../lib/names'
import { filterMoves, filterSpecies, moveOverride, resetSpecies, setMoveField, setSpeciesField, speciesRow, WEATHERS, type SpeciesFilter } from './dataEdits'
import { issueText } from './describe'
import { NumberInput } from './fields'
import type { IssueSet } from './live'
import { fieldId } from './patch'

const PAGE = 40

interface TableProps {
  patch: ContentPatch
  issues: IssueSet
  disabled?: boolean
  onPatch: (fn: (p: ContentPatch) => ContentPatch) => void
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const { t } = useTranslation()
  if (pages <= 1) return null
  return (
    <nav className="flex items-center justify-center gap-3" aria-label={t('admin.content.table.pages')}>
      <IconButton icon="back" size="sm" variant="ghost" label={t('admin.content.table.prev')} disabled={page === 0} onClick={() => onPage(page - 1)} />
      <span className="font-num text-mist-300">
        {page + 1} / {pages}
      </span>
      <IconButton icon="next" size="sm" variant="ghost" label={t('admin.content.table.next')} disabled={page >= pages - 1} onClick={() => onPage(page + 1)} />
    </nav>
  )
}

const errorsAt = (set: IssueSet, prefix: string): ContentIssue[] => [...set.errors, ...set.warnings].filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`))

/** Species: capture rate and the spawn rule (enabled, weight ×, min trainer level, weather, hours). */
export function SpeciesTable({ patch, issues, disabled, onPatch }: TableProps) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language.startsWith('es') ? 'es' : 'en'
  const all = useMemo(() => baseContext().data.species, [])
  const [filter, setFilter] = useState<SpeciesFilter>({ query: '', type: 'all', stage: 0, onlyModified: false })
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const rows = useMemo(() => filterSpecies(all, patch, filter, (s) => speciesName(s, lng)), [all, patch, filter, lng])
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const current = Math.min(page, pages - 1)
  const visible = rows.slice(current * PAGE, (current + 1) * PAGE)
  const types = useMemo(() => baseContext().data.types.types.map((x) => x.slug as TypeSlug), [])
  const update = (f: Partial<SpeciesFilter>) => {
    setFilter((cur) => ({ ...cur, ...f }))
    setPage(0)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[70ch] text-mist-300">{t('admin.content.species.intro')}</p>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <TextField label={t('admin.content.table.search')} value={filter.query} onChange={(e) => update({ query: e.target.value })} className="min-w-48 flex-1" autoComplete="off" spellCheck={false} />
        <label className="flex flex-col gap-1.5 font-display text-base text-mist-300">
          {t('admin.content.species.type')}
          <select
            className="min-h-11 bg-dusk-900 px-2 font-body text-lg text-mist-50 shadow-frame inset-shadow-well"
            value={filter.type}
            onChange={(e) => update({ type: e.target.value as TypeSlug | 'all' })}
          >
            <option value="all">{t('admin.content.species.allTypes')}</option>
            {types.map((x) => (
              <option key={x} value={x}>
                {typeName(x, lng)}
              </option>
            ))}
          </select>
        </label>
        <div className="mb-6 flex flex-col gap-1.5">
          <Segmented
            label={t('admin.content.species.stage')}
            value={String(filter.stage) as '0' | '1' | '2' | '3'}
            onChange={(v) => update({ stage: Number(v) as SpeciesFilter['stage'] })}
            options={[
              { value: '0', label: t('admin.content.species.anyStage') },
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
          />
        </div>
        <label className="mb-6 flex items-center gap-3 text-mist-100">
          <Switch checked={filter.onlyModified} onChange={(v) => update({ onlyModified: v })} label={t('admin.content.params.onlyChanged')} />
          {t('admin.content.params.onlyChanged')}
        </label>
      </div>
      <p className="text-sm text-mist-400" aria-live="polite">
        {t('admin.content.table.count', { count: rows.length })}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-separate border-spacing-y-1 text-left">
          <caption className="sr-only">{t('admin.content.sections.species')}</caption>
          <thead>
            <tr className="text-sm text-mist-400">
              <th scope="col" className="font-normal">
                {t('admin.content.species.name')}
              </th>
              <th scope="col" className="font-normal">
                {t('admin.content.fields.captureRate')}
              </th>
              <th scope="col" className="font-normal">
                {t('admin.content.fields.enabled')}
              </th>
              <th scope="col" className="font-normal">
                {t('admin.content.fields.weightMult')}
              </th>
              <th scope="col" className="w-24 font-normal">
                <span className="sr-only">{t('admin.content.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const r = speciesRow(patch, s)
              const base = `species.${s.slug}`
              const name = speciesName(s.slug, lng)
              const bad = errorsAt(issues, base)
              const expanded = open === s.slug
              return (
                <Fragment key={s.slug}>
                  <tr className={cx(r.modified ? 'bg-dusk-800' : 'bg-dusk-900/50')} data-modified={r.modified || undefined}>
                  <td className="py-1 pr-3">
                    <div className="flex items-center gap-2">
                      <Sprite kind="icon" slug={s.slug} alt="" />
                      <div className="min-w-0">
                        <p className="truncate text-mist-50">
                          <span className="font-num text-mist-400">#{s.id}</span> {name}
                        </p>
                        <div className="flex gap-1">
                          {s.types.map((x) => (
                            <TypeBadge key={x} type={x} />
                          ))}
                        </div>
                      </div>
                    </div>
                    {bad.some((i) => issues.errors.includes(i)) && (
                      <p className="mt-1 text-sm text-cheek-400" role="alert">
                        {bad.filter((i) => issues.errors.includes(i)).map((i) => issueText(i, t)).join(' · ')}
                      </p>
                    )}
                  </td>
                  <td className="pr-3">
                    <NumberInput
                      id={fieldId(`${base}.captureRate`)}
                      ariaLabel={`${name}: ${t('admin.content.fields.captureRate')}`}
                      bounds={DATA_LIMITS.captureRate}
                      value={r.captureRate}
                      onCommit={(v) => onPatch((p) => setSpeciesField(p, s, 'captureRate', v))}
                      disabled={disabled}
                      className="w-24"
                    />
                    <span className="text-xs text-mist-400">{t('admin.content.base', { value: s.captureRate })}</span>
                  </td>
                  <td className="pr-3">
                    <Switch checked={r.enabled} label={`${name}: ${t('admin.content.fields.enabled')}`} disabled={disabled} onChange={(v) => onPatch((p) => setSpeciesField(p, s, 'spawn.enabled', v))} />
                  </td>
                  <td className="pr-3">
                    <NumberInput
                      id={fieldId(`${base}.spawn.weightMult`)}
                      ariaLabel={`${name}: ${t('admin.content.fields.weightMult')}`}
                      bounds={DATA_LIMITS.spawnWeightMult}
                      value={r.weightMult}
                      onCommit={(v) => onPatch((p) => setSpeciesField(p, s, 'spawn.weightMult', v))}
                      disabled={disabled}
                      className="w-24"
                    />
                  </td>
                  <td className="whitespace-nowrap">
                    <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : s.slug)}>
                      {t(expanded ? 'admin.content.species.less' : 'admin.content.species.more')}
                    </Button>
                  </td>
                  </tr>
                  {expanded && (
                    <SpeciesDetail
                      colSpan={5}
                      name={name}
                      row={r}
                      disabled={disabled}
                      modified={r.modified}
                      onWeather={(w) => onPatch((p) => setSpeciesField(p, s, 'spawn.weather', w))}
                      onHours={(h) => onPatch((p) => setSpeciesField(p, s, 'spawn.hours', h))}
                      onMinLevel={(v) => onPatch((p) => setSpeciesField(p, s, 'spawn.minTrainerLevel', v))}
                      onReset={() => onPatch((p) => resetSpecies(p, s.slug))}
                    />
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <Pager page={current} pages={pages} onPage={setPage} />
    </div>
  )
}

interface DetailProps {
  colSpan: number
  name: string
  row: ReturnType<typeof speciesRow>
  disabled?: boolean
  modified: boolean
  onWeather: (w: SpawnWeather[]) => void
  onHours: (h: [number, number][]) => void
  onMinLevel: (v: number) => void
  onReset: () => void
}

function SpeciesDetail({ colSpan, name, row, disabled, modified, onWeather, onHours, onMinLevel, onReset }: DetailProps) {
  const { t } = useTranslation()
  const setWindow = (i: number, k: 0 | 1, v: number) => onHours(row.hours.map((w, j) => (j === i ? (k === 0 ? [v, w[1]] : [w[0], v]) : w) as [number, number]))
  return (
    <tr className="bg-dusk-800">
      <td colSpan={colSpan} className="p-3">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <p className="font-display text-base text-mist-300">{t('admin.content.fields.minTrainerLevel')}</p>
            <NumberInput ariaLabel={`${name}: ${t('admin.content.fields.minTrainerLevel')}`} bounds={DATA_LIMITS.minTrainerLevel} value={row.minTrainerLevel} onCommit={onMinLevel} disabled={disabled} className="w-24" />
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="font-display text-base text-mist-300">{t('admin.content.fields.weather')}</legend>
            <p className="text-sm text-mist-400">{t('admin.content.species.weatherHint')}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {WEATHERS.map((w) => (
                <label key={w} className="flex items-center gap-2 text-mist-100">
                  <input
                    type="checkbox"
                    className="size-4 accent-volt-400"
                    checked={row.weather.includes(w)}
                    disabled={disabled}
                    onChange={(e) => onWeather(e.target.checked ? [...row.weather, w] : row.weather.filter((x) => x !== w))}
                  />
                  {t(`admin.content.weather.${w}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="font-display text-base text-mist-300">{t('admin.content.fields.hours')}</legend>
            <p className="text-sm text-mist-400">{t('admin.content.species.hoursHint')}</p>
            {row.hours.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <NumberInput ariaLabel={`${name}: ${t('admin.content.fields.hours')} #${i + 1} (${t('admin.content.species.from')})`} bounds={DATA_LIMITS.spawnHour} value={w[0]} onCommit={(v) => setWindow(i, 0, v)} disabled={disabled} className="w-20" />
                <span aria-hidden>–</span>
                <NumberInput ariaLabel={`${name}: ${t('admin.content.fields.hours')} #${i + 1} (${t('admin.content.species.to')})`} bounds={DATA_LIMITS.spawnHour} value={w[1]} onCommit={(v) => setWindow(i, 1, v)} disabled={disabled} className="w-20" />
                <IconButton icon="minus" size="sm" variant="ghost" label={t('admin.content.removeRow', { n: i + 1 })} disabled={disabled} onClick={() => onHours(row.hours.filter((_, j) => j !== i))} />
              </div>
            ))}
            <Button size="sm" variant="secondary" icon="plus" className="self-start" disabled={disabled || row.hours.length >= DATA_LIMITS.spawnMaxWindows} onClick={() => onHours([...row.hours, [8, 20]])}>
              {t('admin.content.addRow')}
            </Button>
          </fieldset>
        </div>
        <div className="mt-3">
          <Button size="sm" variant="ghost" icon="reroll" disabled={!modified || disabled} onClick={onReset}>
            {t('admin.content.species.resetAll', { name })}
          </Button>
        </div>
      </td>
    </tr>
  )
}

/** Moves: power and accuracy (only on moves that have them: a damage move cannot become a status move). */
export function MovesTable({ patch, issues, disabled, onPatch }: TableProps) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language.startsWith('es') ? 'es' : 'en'
  const all = useMemo(() => baseContext().data.moves, [])
  const [query, setQuery] = useState('')
  const [onlyModified, setOnlyModified] = useState(false)
  const [page, setPage] = useState(0)
  const rows = useMemo(() => filterMoves(all, patch, query, onlyModified, (s) => moveName(s, lng)), [all, patch, query, onlyModified, lng])
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const current = Math.min(page, pages - 1)
  const visible = rows.slice(current * PAGE, (current + 1) * PAGE)

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[70ch] text-mist-300">{t('admin.content.moves.intro')}</p>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <TextField
          label={t('admin.content.table.search')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(0)
          }}
          className="min-w-48 flex-1"
          autoComplete="off"
          spellCheck={false}
        />
        <label className="mb-6 flex items-center gap-3 text-mist-100">
          <Switch
            checked={onlyModified}
            onChange={(v) => {
              setOnlyModified(v)
              setPage(0)
            }}
            label={t('admin.content.params.onlyChanged')}
          />
          {t('admin.content.params.onlyChanged')}
        </label>
      </div>
      <p className="text-sm text-mist-400" aria-live="polite">
        {t('admin.content.table.count', { count: rows.length })}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-separate border-spacing-y-1 text-left">
          <caption className="sr-only">{t('admin.content.sections.moves')}</caption>
          <thead>
            <tr className="text-sm text-mist-400">
              <th scope="col" className="font-normal">
                {t('admin.content.moves.name')}
              </th>
              <th scope="col" className="font-normal">
                {t('admin.content.fields.power')}
              </th>
              <th scope="col" className="font-normal">
                {t('admin.content.fields.accuracy')}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => {
              const name = moveName(m.slug, lng)
              const powerOv = moveOverride(patch, m.slug, 'power')
              const accOv = moveOverride(patch, m.slug, 'accuracy')
              const bad = errorsAt(issues, `moves.${m.slug}`).filter((i) => issues.errors.includes(i))
              return (
                <tr key={m.slug} className={cx(powerOv !== undefined || accOv !== undefined ? 'bg-dusk-800' : 'bg-dusk-900/50')}>
                  <td className="py-1 pr-3">
                    <p className="text-mist-50">{name}</p>
                    <TypeBadge type={m.type} />
                    {bad.length > 0 && (
                      <p className="mt-1 text-sm text-cheek-400" role="alert">
                        {bad.map((i) => issueText(i, t)).join(' · ')}
                      </p>
                    )}
                  </td>
                  <td className="pr-3">
                    {m.power === null ? (
                      <span className="text-mist-400">—</span>
                    ) : (
                      <>
                        <NumberInput
                          id={fieldId(`moves.${m.slug}.power`)}
                          ariaLabel={`${name}: ${t('admin.content.fields.power')}`}
                          bounds={DATA_LIMITS.movePower}
                          value={powerOv ?? m.power}
                          onCommit={(v) => onPatch((p) => setMoveField(p, m, 'power', v))}
                          disabled={disabled}
                          className="w-24"
                        />
                        <span className="text-xs text-mist-400">{t('admin.content.base', { value: m.power })}</span>
                      </>
                    )}
                  </td>
                  <td className="pr-3">
                    {m.accuracy === null ? (
                      <span className="text-mist-400">—</span>
                    ) : (
                      <>
                        <NumberInput
                          id={fieldId(`moves.${m.slug}.accuracy`)}
                          ariaLabel={`${name}: ${t('admin.content.fields.accuracy')}`}
                          bounds={DATA_LIMITS.moveAccuracy}
                          value={accOv ?? m.accuracy}
                          onCommit={(v) => onPatch((p) => setMoveField(p, m, 'accuracy', v))}
                          disabled={disabled}
                          className="w-24"
                        />
                        <span className="text-xs text-mist-400">{t('admin.content.base', { value: `${m.accuracy}%` })}</span>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Pager page={current} pages={pages} onPage={setPage} />
    </div>
  )
}
