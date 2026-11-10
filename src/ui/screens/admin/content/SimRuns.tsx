import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ADMIN_SIM_MAX_PLAYER_WEEKS,
  ADMIN_SIM_MAX_SEEDS,
  ADMIN_SIM_MAX_WEEKS,
  ADMIN_SIM_PROFILES,
  type AdminSimProfile,
  type AdminSimProfileStats,
  type AdminSimReport,
  type AdminSimRun,
  type AdminSimRunSummary,
} from '../../../../game/protocol'
import { isApiError } from '../../../api'
import { Button, ProgressBar, Select, Switch } from '../../../components'
import { cx } from '../../../lib/cx'
import { errorText } from '../../../lib/errors'
import { contentApi } from './api'
import { NumberInput } from './fields'

const SEEDS = { kind: 'int' as const, min: 1, max: ADMIN_SIM_MAX_SEEDS, step: 1 }
const WEEKS = { kind: 'int' as const, min: 1, max: ADMIN_SIM_MAX_WEEKS, step: 1 }
const DEFAULT_PROFILES: AdminSimProfile[] = ['casual', 'constant', 'marathoner']
export const SIM_POLL_MS = 1500

type Fmt = 'int' | 'dec' | 'pct'
/** The figures compared, in order (key of AdminSimProfileStats or a league share). */
export const SIM_METRICS: { key: string; fmt: Fmt; pick: (s: AdminSimProfileStats) => number }[] = [
  { key: 'weeklyPoints', fmt: 'int', pick: (s) => s.weeklyPointsMedian },
  { key: 'super', fmt: 'pct', pick: (s) => s.leagueShare.super },
  { key: 'ultra', fmt: 'pct', pick: (s) => s.leagueShare.ultra },
  { key: 'master', fmt: 'pct', pick: (s) => s.leagueShare.master },
  { key: 'catches', fmt: 'dec', pick: (s) => s.catches },
  { key: 'speciesCaught', fmt: 'dec', pick: (s) => s.speciesCaught },
  { key: 'legendaryCaught', fmt: 'dec', pick: (s) => s.legendaryCaught },
  { key: 'shinyCaught', fmt: 'dec', pick: (s) => s.shinyCaught },
  { key: 'dustEarned', fmt: 'int', pick: (s) => s.dustEarned },
  { key: 'finalDust', fmt: 'int', pick: (s) => s.finalDust },
  { key: 'exhaustedShare', fmt: 'pct', pick: (s) => s.exhaustedShare },
  { key: 'endEnergy', fmt: 'pct', pick: (s) => s.endEnergy },
]

export interface SimRow {
  profile: AdminSimProfile
  metric: string
  fmt: Fmt
  active: number
  draft: number
  /** Relative change (draft / active − 1); null when the active value is 0. */
  change: number | null
}

/** Active vs draft per profile and figure. */
export function simRows(report: AdminSimReport): SimRow[] {
  const rows: SimRow[] = []
  for (const a of report.active.profiles) {
    const d = report.proposed.profiles.find((p) => p.profile === a.profile)
    if (!d) continue
    for (const m of SIM_METRICS) {
      const av = m.pick(a)
      const dv = m.pick(d)
      rows.push({ profile: a.profile, metric: m.key, fmt: m.fmt, active: av, draft: dv, change: av === 0 ? (dv === 0 ? 0 : null) : dv / av - 1 })
    }
  }
  return rows
}

export interface SimRunsProps {
  draftId: number
  /** Save pending edits first so the server simulates what is on screen. */
  flush?: () => Promise<boolean>
  /** Patch hash of the draft as saved: a run of another hash is marked as outdated. */
  draftHash?: string | null
  /** A run finished (to refresh the «recent simulation» state). */
  onFinished?: (run: AdminSimRun) => void
}

/**
 * «Simulation» sub-tab of the draft editor (delivery E10): runs the balance simulator on the server with the
 * active content and with the draft (same profiles and seeds), follows its progress and shows the comparison.
 * Earlier runs of the draft can be reopened. One run at a time on the whole server.
 */
export function SimRuns({ draftId, flush, draftHash, onFinished }: SimRunsProps) {
  const { t, i18n } = useTranslation()
  const [profiles, setProfiles] = useState<AdminSimProfile[]>(DEFAULT_PROFILES)
  const [seeds, setSeeds] = useState(4)
  const [weeks, setWeeks] = useState(4)
  const [runs, setRuns] = useState<AdminSimRunSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<AdminSimRun | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )

  const loadList = useCallback(async () => {
    const r = await contentApi.simRuns(draftId)
    if (!alive.current) return r
    setRuns(r.items)
    setBusy(r.busy)
    return r
  }, [draftId])

  const open = useCallback(async (id: number) => {
    const r = await contentApi.simRun(id)
    if (alive.current) setSelected(r.run)
    return r.run
  }, [])

  // First load: the list and the latest run of this draft.
  useEffect(() => {
    void (async () => {
      try {
        const r = await loadList()
        if (r.items[0]) await open(r.items[0].id)
      } catch (e) {
        if (alive.current) setError(errorText(isApiError(e) ? e.code : 'network'))
      }
    })()
  }, [loadList, open])

  // Follow a running run.
  const runningId = selected?.status === 'running' ? selected.id : null
  useEffect(() => {
    if (runningId === null) return
    const timer = setInterval(() => {
      void open(runningId)
        .then((run) => {
          if (run.status !== 'running') {
            void loadList()
            onFinished?.(run)
          }
        })
        .catch(() => undefined)
    }, SIM_POLL_MS)
    return () => clearInterval(timer)
  }, [runningId, open, loadList, onFinished])

  const cost = profiles.length * seeds * weeks
  const tooBig = cost > ADMIN_SIM_MAX_PLAYER_WEEKS

  const start = async () => {
    setStarting(true)
    setError(null)
    try {
      if (flush && !(await flush())) {
        setError(t('admin.content.action.saveFailed'))
        return
      }
      const r = await contentApi.simulate(draftId, { profiles, seeds, weeks })
      if (!alive.current) return
      setSelected(r.run)
      void loadList()
    } catch (e) {
      const code = isApiError(e) ? e.code : 'network'
      if (alive.current) setError(t(`admin.content.sim.error.${code}`, { defaultValue: errorText(code), max: ADMIN_SIM_MAX_PLAYER_WEEKS }))
    } finally {
      if (alive.current) setStarting(false)
    }
  }

  const nf = (fmt: Fmt, v: number) =>
    fmt === 'pct'
      ? new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 }).format(v)
      : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: fmt === 'int' ? 0 : 1 }).format(v)
  const when = (ms: number) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(ms)
  const toggle = (p: AdminSimProfile, on: boolean) => setProfiles((cur) => (on ? ADMIN_SIM_PROFILES.filter((x) => x === p || cur.includes(x)) : cur.filter((x) => x !== p)))

  const report = selected?.status === 'done' ? selected.report : null
  const rows = report ? simRows(report) : []
  const outdated = selected !== null && draftHash != null && selected.draftHash !== draftHash

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[70ch] text-mist-300">{t('admin.content.sim.intro')}</p>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-display text-base text-mist-300">{t('admin.content.sim.profiles')}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {ADMIN_SIM_PROFILES.map((p) => (
            <div key={p} className="flex items-center gap-2">
              <Switch checked={profiles.includes(p)} onChange={(on) => toggle(p, on)} label={t(`admin.content.sim.profile.${p}`)} />
              <span aria-hidden="true">{t(`admin.content.sim.profile.${p}`)}</span>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <span id="sim-seeds" className="font-display text-base text-mist-300">
            {t('admin.content.sim.seeds')}
          </span>
          <NumberInput labelledBy="sim-seeds" bounds={SEEDS} value={seeds} onCommit={setSeeds} className="w-24" />
        </div>
        <div className="flex flex-col gap-1">
          <span id="sim-weeks" className="font-display text-base text-mist-300">
            {t('admin.content.sim.weeks')}
          </span>
          <NumberInput labelledBy="sim-weeks" bounds={WEEKS} value={weeks} onCommit={setWeeks} className="w-24" />
        </div>
        <Button icon="play" onClick={() => void start()} disabled={starting || runningId !== null || profiles.length === 0 || tooBig}>
          {t('admin.content.sim.run')}
        </Button>
      </div>
      <p className={cx('text-sm', tooBig ? 'text-cheek-400' : 'text-mist-400')}>{t('admin.content.sim.cost', { cost, max: ADMIN_SIM_MAX_PLAYER_WEEKS })}</p>
      {busy && runningId === null && <p className="text-sm text-amber-400">{t('admin.content.sim.busy')}</p>}
      {error && (
        <p role="alert" className="text-cheek-400">
          {error}
        </p>
      )}

      {runs.length > 1 && (
        <Select
          label={t('admin.content.sim.history')}
          value={String(selected?.id ?? '')}
          onChange={(v) => void open(Number(v))}
          className="max-w-md"
          options={runs.map((r) => ({ value: String(r.id), label: `#${r.id} · ${when(r.createdAt)} · ${t(`admin.content.sim.status.${r.status}`)}` }))}
        />
      )}

      <div aria-live="polite" className="flex flex-col gap-3">
        {selected === null && runs.length === 0 && <p className="text-mist-400">{t('admin.content.sim.none')}</p>}
        {selected && (
          <p className="text-sm text-mist-300">
            {t('admin.content.sim.runLine', {
              id: selected.id,
              status: t(`admin.content.sim.status.${selected.status}`),
              seeds: selected.params.seeds,
              weeks: selected.params.weeks,
              who: selected.createdBy?.trainerName ?? '—',
              when: when(selected.createdAt),
            })}
            {selected.error && ` · ${selected.error}`}
          </p>
        )}
        {selected?.status === 'running' && (
          <ProgressBar
            label={t('admin.content.sim.progress')}
            value={selected.progress?.done ?? 0}
            max={Math.max(1, selected.progress?.total ?? 1)}
            valueText={selected.progress ? `${selected.progress.done}/${selected.progress.total}` : '…'}
            variant="volt"
          />
        )}
        {outdated && <p className="text-sm text-amber-400">{t('admin.content.sim.outdated')}</p>}
      </div>

      {report && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] border-separate border-spacing-y-1 text-left">
            <caption className="sr-only">{t('admin.content.sim.title')}</caption>
            <thead>
              <tr className="text-sm text-mist-400">
                <th scope="col" className="font-normal">
                  {t('admin.content.sim.metric')}
                </th>
                <th scope="col" className="text-right font-normal">
                  {t('admin.content.preview.live')}
                </th>
                <th scope="col" className="text-right font-normal">
                  {t('admin.content.preview.draft')}
                </th>
                <th scope="col" className="text-right font-normal">
                  {t('admin.content.sim.change')}
                </th>
              </tr>
            </thead>
            {report.active.profiles.map((p) => (
              <tbody key={p.profile}>
                <tr>
                  <th scope="rowgroup" colSpan={4} className="pt-3 font-display text-base text-mist-200">
                    {t(`admin.content.sim.profile.${p.profile}`)} <span className="text-sm text-mist-400">(n = {p.n})</span>
                  </th>
                </tr>
                {rows
                  .filter((r) => r.profile === p.profile)
                  .map((r) => (
                    <tr key={r.metric} className="bg-dusk-900">
                      <th scope="row" className="p-1.5 font-normal">
                        {t(`admin.content.sim.m.${r.metric}`)}
                      </th>
                      <td className="p-1.5 text-right font-num">{nf(r.fmt, r.active)}</td>
                      <td className="p-1.5 text-right font-num">{nf(r.fmt, r.draft)}</td>
                      <td className={cx('p-1.5 text-right font-num', r.change === null || Math.abs(r.change) < 0.005 ? 'text-mist-400' : Math.abs(r.change) >= 0.25 ? 'text-amber-400' : 'text-mist-200')}>
                        {r.change === null ? t('admin.content.sim.new') : Math.abs(r.change) < 0.005 ? '—' : `${r.change > 0 ? '+' : '−'}${nf('pct', Math.abs(r.change))}`}
                      </td>
                    </tr>
                  ))}
              </tbody>
            ))}
          </table>
          <p className="mt-2 text-sm text-mist-400">{t('admin.content.sim.footnote', { s: Math.max(1, Math.round(report.ms / 1000)) })}</p>
        </div>
      )}
    </div>
  )
}
