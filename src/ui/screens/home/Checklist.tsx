import { useTranslation } from 'react-i18next'
import { Button, IconButton, Panel, PixelIcon, ProgressBar } from '../../components'
import { hintAnchor, useHintEvent } from '../../hints'
import { cx } from '../../lib/cx'
import { navigate } from '../../router'
import { useGame } from '../../store/game'
import { usePrefs } from '../../store/prefs'

type StepId = 'session' | 'catch' | 'mission' | 'team' | 'equip' | 'candy' | 'evolve'
const STEPS: { id: StepId; to: string }[] = [
  { id: 'session', to: 'home' },
  { id: 'catch', to: 'home' },
  { id: 'mission', to: 'missions' },
  { id: 'team', to: 'team' },
  { id: 'equip', to: 'box' },
  { id: 'candy', to: 'box' },
  { id: 'evolve', to: 'box' },
]

/**
 * "Primeros pasos": a short, dismissible checklist on Home for new players
 * (UX research §1.7: checklist-triggered help completes more often than tours).
 * Steps are read from the save where possible; the rest are milestones in prefs.
 */
export function Checklist() {
  const { t } = useTranslation()
  const player = useGame((s) => s.player)!
  const milestones = usePrefs((s) => s.milestones)
  const dismissed = usePrefs((s) => s.checklistDismissed)
  const dismiss = usePrefs((s) => s.setChecklistDismissed)
  const done: Record<StepId, boolean> = {
    session: player.history.length > 0,
    catch: Object.values(player.pokemon).some((p) => p.caughtBall !== 'starter'),
    mission: Boolean(milestones.mission),
    team: player.team.length >= 2,
    equip: Boolean(milestones.equip),
    candy: Boolean(milestones.candy),
    evolve: Boolean(milestones.evolve),
  }
  const n = STEPS.filter((s) => done[s.id]).length
  const nextStep = STEPS.find((s) => !done[s.id])
  useHintEvent('checklist', !dismissed)
  if (dismissed) return null
  return (
    <Panel
      title={t('checklist.title')}
      help="home.checklist"
      {...hintAnchor('home.checklist')}
      actions={<IconButton icon="close" size="sm" variant="ghost" label={t('checklist.hide')} onClick={() => dismiss(true)} />}
    >
      <ProgressBar value={n} max={STEPS.length} label={t('checklist.progress')} valueText={`${n}/${STEPS.length}`} />
      <ol className="mt-4 flex flex-col gap-2">
        {STEPS.map((s) => {
          const ok = done[s.id]
          const isNext = nextStep?.id === s.id
          return (
            <li key={s.id} className={cx('flex items-start gap-3 p-2', isNext && 'bg-dusk-900 inset-shadow-well')}>
              <span className={cx('mt-0.5 grid size-6 shrink-0 place-items-center shadow-frame', ok ? 'bg-leaf-400 text-ink' : 'bg-dusk-900')} aria-hidden>
                {ok && <PixelIcon name="check" size={10} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cx('block font-display text-base leading-tight', ok ? 'text-mist-400' : 'text-mist-50')}>
                  {t(`checklist.${s.id}.title`)}
                  <span className="sr-only">{ok ? t('checklist.done') : ''}</span>
                </span>
                {isNext && <span className="mt-0.5 block text-sm text-mist-300">{t(`checklist.${s.id}.how`)}</span>}
              </span>
              {isNext && s.to !== 'home' && (
                <Button size="sm" variant="secondary" icon="next" onClick={() => navigate(s.to)}>
                  {t('checklist.go')}
                </Button>
              )}
            </li>
          )
        })}
      </ol>
      {!nextStep && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-leaf-400">{t('checklist.allDone')}</p>
          <Button size="sm" onClick={() => dismiss(true)}>
            {t('checklist.hide')}
          </Button>
        </div>
      )}
    </Panel>
  )
}
