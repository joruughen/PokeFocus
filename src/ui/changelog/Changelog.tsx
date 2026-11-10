import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { Locale } from '../../i18n'
import { Panel } from '../components'
import { cx } from '../lib/cx'
import { usePrefs } from '../store/prefs'
import { CHANGELOG } from './entries'
import { fmtEntryDate, KIND_STYLE } from './entryView'
import { APP_VERSION, RELEASE_STAGE } from './release'

/** News (`#/changelog`): where the game stands (alpha/beta), what is coming, and what changed in each version. */
export default function Changelog() {
  const { t, i18n } = useTranslation()
  const lng = (i18n.language === 'es' ? 'es' : 'en') as Locale
  const setLastSeen = usePrefs((s) => s.setLastSeenVersion)
  useEffect(() => setLastSeen(APP_VERSION), [setLastSeen])

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl">{t('changelog.title')}</h1>
        <p className="max-w-[60ch] text-mist-300">{t('changelog.intro')}</p>
      </header>

      <Panel title={t(`release.${RELEASE_STAGE}.title`)} actions={<span className="font-num text-xl text-mist-300">{t('release.version', { version: APP_VERSION })}</span>}>
        <div className="flex flex-col gap-4 text-mist-100">
          <p className="max-w-[60ch]">{t(`release.${RELEASE_STAGE}.body`)}</p>
          <div>
            <h3 className="mb-2 font-display text-lg text-mist-300">{t('changelog.roadmapTitle')}</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-volt-400">
              <li>{t('changelog.roadmap.progression')}</li>
              <li>{t('changelog.roadmap.trades')}</li>
              <li>{t('changelog.roadmap.recovery')}</li>
            </ul>
            <p className="mt-2 text-sm text-mist-400">{t('changelog.roadmapNote')}</p>
          </div>
        </div>
      </Panel>

      <ol className="flex flex-col gap-6" aria-label={t('changelog.versions')}>
        {CHANGELOG.map((entry, i) => (
          <li key={entry.version}>
            <Panel
              as="article"
              variant={i === 0 ? 'plate' : 'frame'}
              title={
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span>{t('changelog.versionLabel', { version: entry.version })}</span>
                  <span className="font-body text-base font-normal text-mist-300">{entry.title[lng]}</span>
                </span>
              }
              actions={
                <span className="flex items-center gap-3">
                  {i === 0 && <span className="bg-volt-400 px-1.5 pt-0.5 font-display text-sm leading-tight text-ink uppercase">{t('changelog.latest')}</span>}
                  <time dateTime={entry.date} className="font-num text-lg text-mist-300">
                    {fmtEntryDate(entry.date, lng)}
                  </time>
                </span>
              }
            >
              <ul className="flex flex-col gap-3">
                {entry.items.map((item, j) => (
                  <li key={j} className="flex items-start gap-3">
                    <span className={cx('mt-0.5 w-24 shrink-0 px-1.5 pt-0.5 text-center font-display text-sm leading-tight uppercase', KIND_STYLE[item.kind])}>
                      {t(`changelog.kind.${item.kind}`)}
                    </span>
                    <span className="min-w-0 flex-1">{item.text[lng]}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </li>
        ))}
      </ol>
    </div>
  )
}
