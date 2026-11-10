import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { baseContent } from '../../../../engine/context'
import type { ContentPatch } from '../../../../engine/content'
import type { ContentIssue } from '../../../../game/protocol'
import { Button, Panel, Select } from '../../../components'
import { parseRaw, rawText, RAW_SECTIONS, setRawSection, type RawSection } from './dataEdits'
import { issueText } from './describe'
import type { IssueSet } from './live'
import { fieldId } from './patch'

interface Props {
  patch: ContentPatch
  issues: IssueSet
  disabled?: boolean
  onPatch: (fn: (p: ContentPatch) => ContentPatch) => void
}

/**
 * Techniques, abilities and missions are replaced whole by slug (or, for missions, as a whole object), so they are
 * edited as JSON: the schema in src/game/content validates it live and on the server. «Copy from base» starts an
 * override from the shipped definition.
 */
export function AdvancedJson({ patch, issues, disabled, onPatch }: Props) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[70ch] text-mist-300">{t('admin.content.advanced.intro')}</p>
      {RAW_SECTIONS.map((key) => (
        <RawEditor key={key} section={key} patch={patch} issues={issues} disabled={disabled} onPatch={onPatch} />
      ))}
    </div>
  )
}

function RawEditor({ section, patch, issues, disabled, onPatch }: Props & { section: RawSection }) {
  const { t } = useTranslation()
  const id = fieldId(section)
  const msg = useId()
  const external = rawText(patch, section)
  const [text, setText] = useState(external)
  const [syntax, setSyntax] = useState<'syntax' | 'object' | null>(null)
  const [base, setBase] = useState('')
  const baseDefs = useMemo(() => (section === 'techniques' ? baseContent().techniques : section === 'abilities' ? baseContent().abilities : null), [section])
  const slugs = useMemo(() => (baseDefs ? Object.keys(baseDefs).sort().map((s) => ({ value: s, label: s })) : []), [baseDefs])
  const mine: ContentIssue[] = [...issues.errors, ...issues.warnings].filter((i) => i.path === section || i.path.startsWith(`${section}.`))
  const dirty = text !== external

  // Follow outside changes (another section, restore) when the user has no unapplied text.
  useEffect(() => {
    setText(external)
    setSyntax(null)
  }, [external])

  const apply = () => {
    const r = parseRaw(text)
    if (!r.ok) {
      setSyntax(r.reason)
      return
    }
    setSyntax(null)
    onPatch((p) => setRawSection(p, section, r.value))
  }

  const copyBase = () => {
    const def = baseDefs?.[base]
    if (!def) return
    const r = parseRaw(text)
    const cur = r.ok ? r.value : {}
    setText(JSON.stringify({ ...cur, [base]: def }, null, 2))
    setSyntax(null)
  }

  return (
    <Panel variant="frame" title={t(`admin.content.sections.${section}`)} headingLevel={3}>
      <div className="flex flex-col gap-3">
        <textarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          spellCheck={false}
          rows={Math.min(18, Math.max(4, text.split('\n').length))}
          aria-label={t(`admin.content.sections.${section}`)}
          aria-invalid={syntax ? true : undefined}
          aria-describedby={syntax ? msg : undefined}
          className="min-h-24 w-full resize-y bg-dusk-900 p-3 font-mono text-sm text-mist-50 shadow-frame inset-shadow-well disabled:text-mist-400"
        />
        {syntax && (
          <p id={msg} role="alert" className="text-sm text-cheek-400">
            {t(`admin.content.advanced.${syntax}`)}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Button size="sm" icon="check" disabled={disabled || !dirty} onClick={apply}>
            {t('admin.content.advanced.apply')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="reroll"
            disabled={disabled || (!dirty && patch[section] === undefined)}
            onClick={() => {
              setText('{}')
              onPatch((p) => setRawSection(p, section, {}))
            }}
          >
            {t('admin.content.advanced.clear')}
          </Button>
          {baseDefs && (
            <>
              <Select label={t('admin.content.advanced.baseSlug')} options={[{ value: '', label: '—' }, ...slugs]} value={base} onChange={setBase} className="min-w-52" />
              <Button size="sm" variant="secondary" icon="copy" disabled={disabled || !base} onClick={copyBase}>
                {t('admin.content.advanced.copyBase')}
              </Button>
            </>
          )}
        </div>
        {dirty && <p className="text-sm text-amber-400">{t('admin.content.advanced.unapplied')}</p>}
        {mine.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-sm">
            {mine.map((i, n) => (
              <li key={n} className={issues.errors.includes(i) ? 'text-cheek-400' : 'text-amber-400'}>
                <code className="text-mist-300">{i.path}</code> {issueText(i, t)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
