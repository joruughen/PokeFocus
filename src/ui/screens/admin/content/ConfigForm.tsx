import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ContentPatch } from '../../../../engine/content'
import type { ContentIssue } from '../../../../game/protocol'
import { Segmented, Switch, TextField } from '../../../components'
import { issueText as issueCopy } from './describe'
import { ListField, ScalarField, TableField, type FieldIssues } from './fields'
import type { IssueSet } from './live'
import { baseConfigValue, configGroups, effectiveConfigValue, isOverridden, overridesByGroup, setConfigValue } from './patch'
import type { LimitGroup } from '../../../../game/content/limits'

export interface ConfigFormProps {
  patch: ContentPatch
  issues: IssueSet
  disabled?: boolean
  /** Group to open (set by «go to field»). */
  group: LimitGroup
  onGroup: (g: LimitGroup) => void
  onPatch: (fn: (p: ContentPatch) => ContentPatch) => void
}

const forPath = (set: IssueSet, prefix: string): FieldIssues => {
  const hit = (i: ContentIssue) => i.path === prefix || i.path.startsWith(`${prefix}.`)
  return { errors: set.errors.filter(hit), warnings: set.warnings.filter(hit) }
}

/**
 * The «Parameters» form: generated from `limits.ts` (groups, labels, bounds, step, unit), with the base value and the
 * change vs base next to every field, and a reset per field. Edits go through `onPatch`; the editor autosaves.
 */
export function ConfigForm({ patch, issues, disabled, group, onGroup, onPatch }: ConfigFormProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [onlyChanged, setOnlyChanged] = useState(false)
  const groups = useMemo(() => configGroups(), [])
  const counts = useMemo(() => overridesByGroup(patch), [patch])
  const text = (i: ContentIssue) => issueCopy(i, t)

  const q = query.trim().toLowerCase()
  const searching = q !== ''
  const matches = (path: string, label: string) => (!searching || label.toLowerCase().includes(q) || path.toLowerCase().includes(q)) && (!onlyChanged || isOverridden(patch, path))

  const shown = searching || onlyChanged ? groups : groups.filter((g) => g.group === group)
  const visible = shown
    .map((g) => ({
      group: g.group,
      scalars: g.scalars.filter((l) => matches(l.path, t(l.labelKey))),
      lists: g.lists.filter((l) => matches(l.path, t(l.labelKey))),
      tables: g.tables.filter((l) => matches(l.path, t(l.labelKey))),
    }))
    .filter((g) => g.scalars.length + g.lists.length + g.tables.length > 0)
  const set = (path: string, v: unknown) => onPatch((p) => setConfigValue(p, path, v))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <TextField label={t('admin.content.params.search')} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.content.params.searchPlaceholder')} className="min-w-56 flex-1" autoComplete="off" spellCheck={false} />
        <label className="mb-6 flex items-center gap-3 text-mist-100">
          <Switch checked={onlyChanged} onChange={setOnlyChanged} label={t('admin.content.params.onlyChanged')} />
          {t('admin.content.params.onlyChanged')}
        </label>
      </div>
      <Segmented
        label={t('admin.content.params.groups')}
        value={group}
        onChange={onGroup}
        options={groups.map((g) => ({
          value: g.group,
          label: (
            <>
              {t(`admin.content.groups.${g.group}`)}
              {(counts.get(g.group) ?? 0) > 0 && <span className="bg-volt-400 px-1.5 pt-0.5 text-sm leading-tight text-ink">{counts.get(g.group)}</span>}
            </>
          ),
          ariaLabel: `${t(`admin.content.groups.${g.group}`)}${(counts.get(g.group) ?? 0) > 0 ? ` (${counts.get(g.group)})` : ''}`,
        }))}
      />
      {visible.map(({ group: g, scalars, lists, tables }) => {
        return (
          <section key={g} aria-labelledby={`grp-${g}`}>
            <h3 id={`grp-${g}`} className="mb-1 text-lg text-mist-50">
              {t(`admin.content.groups.${g}`)}
            </h3>
            {scalars.map((l) => (
              <ScalarField
                key={l.path}
                limit={l}
                label={t(l.labelKey)}
                base={baseConfigValue(l.path) as number}
                value={effectiveConfigValue(patch, l.path) as number}
                overridden={isOverridden(patch, l.path)}
                issues={forPath(issues, `config.${l.path}`)}
                issueText={text}
                disabled={disabled}
                onChange={(v) => set(l.path, v)}
                onReset={() => set(l.path, undefined)}
              />
            ))}
            {lists.map((l) => (
              <ListField
                key={l.path}
                limit={l}
                label={t(l.labelKey)}
                base={baseConfigValue(l.path) as number[]}
                value={effectiveConfigValue(patch, l.path) as number[]}
                overridden={isOverridden(patch, l.path)}
                issues={forPath(issues, `config.${l.path}`)}
                issueText={text}
                disabled={disabled}
                onChange={(v) => set(l.path, v)}
                onReset={() => set(l.path, undefined)}
              />
            ))}
            {tables.map((l) => (
              <TableField
                key={l.path}
                limit={l}
                label={t(l.labelKey)}
                base={baseConfigValue(l.path) as Record<string, number>[]}
                value={effectiveConfigValue(patch, l.path) as Record<string, number>[]}
                overridden={isOverridden(patch, l.path)}
                issues={forPath(issues, `config.${l.path}`)}
                issueText={text}
                disabled={disabled}
                onChange={(v) => set(l.path, v)}
                onReset={() => set(l.path, undefined)}
              />
            ))}
          </section>
        )
      })}
      {visible.length === 0 && <p className="text-mist-300">{t('admin.content.params.noMatches')}</p>}
    </div>
  )
}
