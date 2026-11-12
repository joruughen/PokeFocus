/** Server-side renders of the content tab pieces (ES + EN, no raw i18n keys), the tab registry and the locale coverage of the generated form. */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../../i18n'
import en from '../../../../i18n/locales/en.json'
import es from '../../../../i18n/locales/es.json'
import { CONFIG_LIMITS, CONFIG_LIST_LIMITS, CONFIG_TABLE_LIMITS, LIMIT_GROUPS } from '../../../../game/content/limits'
import type { AdminContentDiffEntry, AdminContentLiveResponse, AdminContentVersionSummary, ContentIssue } from '../../../../game/protocol'
import { visibleTabs } from '../tabs'
import { ConfigForm } from './ConfigForm'
import { MovesTable, SpeciesTable } from './DataTables'
import { LiveStatus, VersionsList } from './Overview'
import { DiffList, IssueList, ValidationSummary } from './ReviewPanel'
import { NO_ISSUES } from './live'
import { issueText } from './describe'
import { setConfigValue } from './patch'
import { contentPermissions } from './versions'

const RAW = /\badmin\.(content|config|tabs)\./
const noop = () => undefined

type Tree = { [k: string]: string | Tree }
const get = (tree: Tree, path: string): unknown => path.split('.').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Tree)[k] : undefined), tree)

describe('the generated form has copy for every limit', () => {
  it('labels, groups and table columns exist in both languages', () => {
    const missing: string[] = []
    for (const [name, tree] of [['es', es], ['en', en]] as const) {
      const admin = (tree as unknown as { admin: Tree }).admin
      for (const l of [...CONFIG_LIMITS, ...CONFIG_LIST_LIMITS, ...CONFIG_TABLE_LIMITS]) {
        if (typeof get(admin, l.labelKey.replace(/^admin\./, '')) !== 'string') missing.push(`${name}:${l.labelKey}`)
      }
      for (const g of LIMIT_GROUPS) if (typeof get(admin, `content.groups.${g}`) !== 'string') missing.push(`${name}:group ${g}`)
      for (const t of CONFIG_TABLE_LIMITS) for (const c of Object.keys(t.columns)) if (typeof get(admin, `content.columns.${c}`) !== 'string') missing.push(`${name}:column ${c}`)
    }
    expect(missing).toEqual([])
  })
})

describe('ConfigForm', () => {
  const patch = setConfigValue(setConfigValue({}, 'encounters.baseWaveSize', 6), 'encounters.shinyChance', 0.02)
  const render = (group: (typeof LIMIT_GROUPS)[number], p = patch) =>
    renderToStaticMarkup(<ConfigForm patch={p} issues={NO_ISSUES} group={group} onGroup={noop} onPatch={noop} />)

  for (const lng of ['es', 'en'] as const) {
    it(`renders every group with labels, bounds, base value, change and reset (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      for (const g of LIMIT_GROUPS) {
        const html = render(g)
        expect(html, g).not.toMatch(RAW)
        for (const l of CONFIG_LIMITS.filter((x) => x.group === g)) expect(html, l.path).toContain(i18n.t(l.labelKey))
      }
      const enc = render('encounters')
      // Probabilities are percentages: the shiny override 0.02 is 2 %, ×11 the base, so it carries the ×5 badge.
      expect(enc).toContain('value="2"')
      expect(enc).toContain(i18n.t('admin.content.bigChange', { factor: 5 }))
      // The wave size override (4 → 6) shows +50 % and its reset button is enabled.
      expect(enc).toMatch(/\+50%/)
      expect(enc).toContain(i18n.t('admin.content.reset', { name: i18n.t('admin.config.encounters.baseWaveSize') }))
      // The wild-level table and the list field are in the same group.
      expect(enc).toContain(i18n.t('admin.config.encounters.wildLevelByTrainerLevel'))
      expect(enc).toContain(i18n.t('admin.config.encounters.longSessionLegendaryMult'))
      expect(enc).toContain('type="number"')
    })
  }

  it('shows the error of a field next to it', async () => {
    await i18n.changeLanguage('en')
    const bad: ContentIssue = { code: 'out_of_range', path: 'config.encounters.shinyChance', message: 'too big' }
    const html = renderToStaticMarkup(<ConfigForm patch={patch} issues={{ errors: [bad], warnings: [], requiresConfirm: false }} group="encounters" onGroup={noop} onPatch={noop} />)
    expect(html).toContain('Out of the allowed range.')
    expect(html).toContain('aria-invalid="true"')
  })

  it('every number input has an accessible name', async () => {
    await i18n.changeLanguage('en')
    const html = render('encounters')
    const inputs = html.match(/<input[^>]*type="number"[^>]*>/g) ?? []
    expect(inputs.length).toBeGreaterThan(10)
    for (const tag of inputs) expect(tag).toMatch(/\bid="|aria-label="|aria-labelledby="/)
  })
})

describe('species and moves tables', () => {
  for (const lng of ['es', 'en'] as const) {
    it(`render with their filters and no raw keys (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const sp = renderToStaticMarkup(<SpeciesTable patch={{ species: { bulbasaur: { captureRate: 80 } } }} issues={NO_ISSUES} onPatch={noop} />)
      expect(sp).not.toMatch(RAW)
      expect(sp).toContain('Bulbasaur')
      expect(sp).toContain('value="80"')
      const mv = renderToStaticMarkup(<MovesTable patch={{}} issues={NO_ISSUES} onPatch={noop} />)
      expect(mv).not.toMatch(RAW)
      expect(mv).toContain(i18n.t('admin.content.fields.power'))
    })
  }
})

function summary(over: Partial<AdminContentVersionSummary>): AdminContentVersionSummary {
  return {
    id: 1,
    status: 'published',
    title: 'Wave 5',
    note: 'Balance pass',
    parentId: null,
    hash: 'abcdef0123456789',
    effectiveAt: Date.UTC(2026, 10, 9),
    createdBy: { id: 'u', trainerName: 'Ash' },
    createdAt: Date.UTC(2026, 10, 8),
    publishedBy: { id: 'u', trainerName: 'Ash' },
    publishedAt: Date.UTC(2026, 10, 9),
    active: false,
    scheduled: false,
    validation: null,
    linkedEvent: null,
    linkedRole: null,
    revertOfVersionId: null,
    revertStale: false,
    ...over,
  }
}

describe('versions list', () => {
  const items = [
    summary({ id: 4, status: 'draft', title: null, effectiveAt: null, validation: { ok: false, errors: 2, warnings: 1, requiresConfirm: false, smoke: false } }),
    summary({ id: 3, scheduled: true, effectiveAt: Date.UTC(2026, 11, 1) }),
    summary({ id: 2, active: true }),
    summary({ id: 1 }),
  ]
  const list = (role: 'admin' | 'support') =>
    renderToStaticMarkup(
      <VersionsList items={items} filter="all" onFilter={noop} canEdit={contentPermissions(role).edit} busy={false} onOpen={noop} onRollback={noop} onUnschedule={noop} onCopy={noop} onDelete={noop} />,
    )

  for (const lng of ['es', 'en'] as const) {
    it(`admin: edit the draft, republish only a past non-active version, delete drafts (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = list('admin')
      expect(html).not.toMatch(RAW)
      expect(html).toContain(i18n.t('admin.content.kind.draft'))
      expect(html).toContain(i18n.t('admin.content.kind.scheduled'))
      expect(html).toContain(i18n.t('admin.content.kind.active'))
      // Only version #1 (published, past, not active) can be republished.
      expect(html.split(`>${i18n.t('admin.content.versions.rollback')}<`).length - 1).toBe(1)
      expect(html).toContain(i18n.t('admin.content.versions.edit'))
      expect(html).toContain(i18n.t('admin.content.versions.validation', { errors: 2, warnings: 1 }))
      expect(html).toContain('abcdef01')
      // Only the scheduled version (#3) can be cancelled, and its row says when it starts.
      expect(html.split(`>${i18n.t('admin.content.versions.unschedule')}<`).length - 1).toBe(1)
      expect(html).toContain(i18n.t('admin.content.versions.startsBy', { when: '', who: '' }).slice(0, 6))
    })

    it(`support: read-only, no copy, rollback or delete (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = list('support')
      expect(html).toContain(i18n.t('admin.content.versions.view'))
      expect(html).not.toContain(i18n.t('admin.content.versions.rollback'))
      expect(html).not.toContain(i18n.t('admin.content.versions.unschedule'))
      expect(html).not.toContain(i18n.t('admin.content.versions.copy'))
      expect(html).not.toContain(i18n.t('admin.content.versions.edit'))
      expect(html).not.toContain('aria-label="' + i18n.t('admin.content.versions.delete', { name: '#4' }))
    })
  }
})

describe('tied to an event', () => {
  const linked = (over: Partial<AdminContentVersionSummary> = {}) =>
    summary({
      id: 7,
      scheduled: true,
      effectiveAt: Date.UTC(2026, 11, 1),
      linkedEvent: { id: 'e1', slug: 'spring', name: { es: 'Fiesta de primavera', en: 'Spring fest' }, status: 'published', startsAt: Date.UTC(2026, 11, 1), endsAt: Date.UTC(2026, 11, 5) },
      linkedRole: 'start',
      ...over,
    })
  const render = (items: AdminContentVersionSummary[]) =>
    renderToStaticMarkup(<VersionsList items={items} filter="all" onFilter={noop} canEdit busy={false} onOpen={noop} onRollback={noop} onUnschedule={noop} onCopy={noop} onDelete={noop} />)

  for (const [lng, starts, ends] of [
    ['es', 'con el evento Fiesta de primavera', 'vuelta a lo anterior al terminar el evento Fiesta de primavera'],
    ['en', 'with the event Spring fest', 'return to what was before when the event Spring fest ends'],
  ] as const) {
    it(`the list says which event a version goes with, and warns when the return is out of date (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = render([linked(), linked({ id: 8, linkedRole: 'end', revertOfVersionId: 7, revertStale: true }), summary({ id: 1 })])
      expect(html).not.toMatch(RAW)
      expect(html).toContain(starts)
      expect(html).toContain(ends)
      expect(html).toContain(i18n.t('admin.content.link.stale'))
      expect(html.split(i18n.t('admin.content.link.stale')).length - 1).toBe(1) // only the flagged one
      expect(render([summary({ id: 1 })])).not.toContain(starts)
    })

    it(`the «Scheduled» card shows it too (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const live: AdminContentLiveResponse = { hash: 'h', baseHash: 'b', patch: {}, active: null, scheduled: linked(), events: [], serverNow: 0 }
      const html = renderToStaticMarkup(<LiveStatus live={live} onReload={noop} loading={false} />)
      expect(html).toContain(starts)
    })
  }

  it('an archived event is marked on the line', async () => {
    await i18n.changeLanguage('en')
    const v = linked()
    const html = render([{ ...v, linkedEvent: { ...v.linkedEvent!, status: 'archived' } }])
    expect(html).toContain('event archived')
  })

  it('every new key exists in both languages', () => {
    const keys = [
      'admin.content.publish.optEvent', 'admin.content.publish.withEvent', 'admin.content.publish.doneEvent', 'admin.content.publish.doneEventRevert',
      'admin.content.publish.event.none', 'admin.content.publish.event.label', 'admin.content.publish.event.choose', 'admin.content.publish.event.option', 'admin.content.publish.event.hint',
      'admin.content.publish.event.window', 'admin.content.publish.event.takesEffect', 'admin.content.publish.event.immediate', 'admin.content.publish.event.goesBack',
      'admin.content.publish.event.revert', 'admin.content.publish.event.revertHint',
      'admin.content.link.starts', 'admin.content.link.ends', 'admin.content.link.archived', 'admin.content.link.stale', 'admin.content.link.event', 'admin.content.link.revertOf',
      'admin.content.errors.event_not_linkable', 'admin.content.errors.unknown_event',
      'eventsAdmin.linked.title', 'eventsAdmin.linked.empty', 'eventsAdmin.linked.role.start', 'eventsAdmin.linked.role.end', 'eventsAdmin.linked.state.active', 'eventsAdmin.linked.state.scheduled',
      'eventsAdmin.linked.state.past', 'eventsAdmin.linked.open', 'eventsAdmin.linked.hint', 'eventsAdmin.linked.moveWarn_one', 'eventsAdmin.linked.moveWarn_other',
      'eventsAdmin.linked.archiveWarn_one', 'eventsAdmin.linked.archiveWarn_other', 'eventsAdmin.linked.moved_one', 'eventsAdmin.linked.moved_other', 'eventsAdmin.linked.cancelled_one', 'eventsAdmin.linked.cancelled_other',
    ]
    for (const [name, tree] of [['es', es], ['en', en]] as const) for (const k of keys) expect(typeof get(tree as unknown as Tree, k), `${name}:${k}`).toBe('string')
  })
})

describe('live status', () => {
  const live: AdminContentLiveResponse = {
    hash: 'abcdef0123456789',
    baseHash: '1234567890abcdef',
    patch: {},
    active: summary({ id: 2, active: true }),
    scheduled: summary({ id: 3, scheduled: true, effectiveAt: Date.UTC(2026, 11, 1) }),
    events: [{ id: 'e1', slug: 'spring-festival', startsAt: 0, endsAt: Date.UTC(2026, 11, 5) }],
    serverNow: 0,
  }
  it('shows active, scheduled and events', async () => {
    await i18n.changeLanguage('en')
    const html = renderToStaticMarkup(<LiveStatus live={live} onReload={noop} loading={false} />)
    expect(html).not.toMatch(RAW)
    expect(html).toContain('#2 · Wave 5')
    expect(html).toContain('#3 · Wave 5')
    expect(html).toContain('spring-festival')
    // The scheduled card says «Starts», the active one «Since».
    expect(html).toContain('>Starts<')
    expect(html).toContain('>Since<')
    const none = renderToStaticMarkup(<LiveStatus live={{ ...live, active: null, scheduled: null, events: [], hash: 'base' }} onReload={noop} loading={false} />)
    expect(none).toContain('No published version')
    expect(none).toContain('Nothing scheduled.')
  })
})

describe('review: diff and issues', () => {
  const diff: AdminContentDiffEntry[] = [
    { path: 'config.encounters.shinyChance', kind: 'changed', before: 0.01, after: 0.02 },
    { path: 'species.pikachu.captureRate', kind: 'added', before: 190, after: 100 },
    { path: 'config.encounters.wildLevelByTrainerLevel', kind: 'changed', before: [1], after: null },
  ]
  for (const lng of ['es', 'en'] as const) {
    it(`diff reads in words, with units and names (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      const html = renderToStaticMarkup(<DiffList diff={diff} />)
      expect(html).not.toMatch(RAW)
      expect(html).toContain(i18n.t('admin.config.encounters.shinyChance'))
      expect(html).toContain('1%')
      expect(html).toContain('2%')
      expect(html).toContain('Pikachu')
      expect(html).toContain('100')
      expect(renderToStaticMarkup(<DiffList diff={[]} />)).toContain(i18n.t('admin.content.diff.empty'))
    })
  }

  it('issues: translated by code with a ×3/×5 badge and a link to the field; unknown codes fall back to the English message', async () => {
    await i18n.changeLanguage('es')
    const big: ContentIssue = { code: 'big_change', path: 'config.encounters.shinyChance', message: 'm', params: { base: 0.0017, value: 0.02, factor: 5 }, requiresConfirm: true }
    const odd: ContentIssue = { code: 'something_new', path: '', message: 'Server says hi' }
    const html = renderToStaticMarkup(<IssueList errors={[odd]} warnings={[big]} onGoto={noop} />)
    expect(html).toContain('CAMBIO ×5')
    expect(html).toContain('Server says hi')
    expect(html).toContain(i18n.t('admin.content.issues.goto'))
    expect(issueText(big, i18n.t.bind(i18n))).toContain('×5')
  })

  it('the ×3/×5 text prints probabilities as %, like the table, and says what it was compared with', async () => {
    const live: ContentIssue = { code: 'big_change', path: 'config.encounters.shinyChance', message: 'm', params: { base: 0.00136, value: 0.01, factor: 5, kind: 'prob', from: 'live' }, requiresConfirm: true }
    const base: ContentIssue = { ...live, params: { ...live.params, from: 'base' } }
    await i18n.changeLanguage('en')
    const t = i18n.t.bind(i18n)
    expect(issueText(live, t)).toBe('More than ×5 away from what is live (0.136% → 1%). It needs your confirmation to publish.')
    expect(issueText(base, t)).toBe('More than ×5 away from the base (0.136% → 1%). It needs your confirmation to publish.')
    await i18n.changeLanguage('es')
    expect(issueText(live, t)).toContain('de lo que está en vivo (0,136% → 1%)')
    // A multiplier or an integer keeps its plain number (and its unit when the limit has one).
    const mult: ContentIssue = { code: 'big_change', path: 'config.rewards.dustPerMinute', message: 'm', params: { base: 6, value: 30, factor: 3, kind: 'number' }, requiresConfirm: true }
    expect(issueText(mult, t)).toMatch(/\(6 → 30\)/)
  })

  it('validation summary', async () => {
    await i18n.changeLanguage('en')
    expect(renderToStaticMarkup(<ValidationSummary validation={null} stale={false} />)).toContain('Not validated')
    const ok = { ok: true, errors: [], warnings: [], requiresConfirm: false, smoke: true, at: 0 }
    expect(renderToStaticMarkup(<ValidationSummary validation={ok} stale />)).toContain('smoke test passed')
    expect(renderToStaticMarkup(<ValidationSummary validation={{ ...ok, ok: false, errors: [{ code: 'x', path: '', message: '' }] }} stale={false} />)).toContain('1 error')
  })
})

describe('tab registry', () => {
  const ids = (role: Parameters<typeof visibleTabs>[0]['role']) => visibleTabs({ role }).map((t) => t.id)
  it('admin sees everything, support only what it can read, anonymous only the legacy maintenance token', () => {
    expect(ids('admin')).toEqual(['content', 'events', 'players', 'metrics', 'maintenance'])
    expect(ids('support')).toEqual(['content', 'players', 'metrics'])
    expect(ids('player')).toEqual(['maintenance'])
    expect(ids(undefined)).toEqual(['maintenance'])
  })

  it('every tab has copy', () => {
    for (const tree of [es, en]) for (const tab of visibleTabs({ role: 'admin' })) expect(typeof get((tree as unknown as { admin: Tree }).admin, tab.labelKey.replace(/^admin\./, ''))).toBe('string')
  })
})
