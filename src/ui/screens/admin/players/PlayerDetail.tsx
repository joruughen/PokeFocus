import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminPlayerDetail, AdminUnlockField, UserRole } from '../../../../game/protocol'
import { Button, Panel } from '../../../components'
import { fmtInt } from '../../../lib/format'
import { asLocale, itemName, speciesName } from '../../../lib/names'
import { ConfirmAction } from './ConfirmAction'
import { playerPermissions } from './permissions'

export interface PlayerDetailViewProps {
  detail: AdminPlayerDetail
  me: { id: string; role: UserRole }
  busy: boolean
  onUnlock: (field: AdminUnlockField) => void
  onCancelSession: (reason: string) => void
  onLogoutAll: (reason: string) => void
  /** The grant form (admin only; the parent decides). */
  grant?: ReactNode
}

const dateTime = (ts: number, lng: string) => new Intl.DateTimeFormat(lng, { dateStyle: 'medium', timeStyle: 'short' }).format(ts)

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-2 border-dusk-700 py-2 last:border-b-0">
      <dt className="text-mist-300">{label}</dt>
      <dd className="min-w-0 break-words text-right text-mist-50">{children}</dd>
    </div>
  )
}

/** The player sheet: profile, locks, game summary, history and browsers, with the actions the role allows. Presentational. */
export function PlayerDetailView({ detail, me, busy, onUnlock, onCancelSession, onLogoutAll, grant }: PlayerDetailViewProps) {
  const { t, i18n } = useTranslation()
  const lng = asLocale(i18n.language)
  const { user, doc } = detail
  const perm = playerPermissions(me, user)

  const lock = (field: AdminUnlockField, until: number | null) => (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <span>{until === null ? t('admin.players.free') : t('admin.players.lockedUntil', { date: dateTime(until, i18n.language) })}</span>
      {perm.moderate && until !== null && (
        <Button size="sm" variant="secondary" icon="lock" disabled={busy} onClick={() => onUnlock(field)}>
          {t('admin.players.unlock')}
        </Button>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <Panel variant="frame" title={user.trainerName} headingLevel={3}>
        <dl>
          <Row label={t('admin.players.email')}>{user.email}</Row>
          <Row label={t('admin.players.friendCode')}>
            <span className="font-num">{user.friendCode}</span>
          </Row>
          <Row label={t('admin.players.role')}>{t(`admin.players.roles.${user.role}`)}</Row>
          <Row label={t('admin.players.country')}>{user.country}</Row>
          <Row label={t('admin.players.since')}>{dateTime(user.createdAt, i18n.language)}</Row>
          <Row label={t('admin.players.anonymous')}>{t(user.anonymousRankings ? 'common.yes' : 'common.no')}</Row>
        </dl>
      </Panel>

      <Panel variant="frame" title={t('admin.players.locks')} headingLevel={3}>
        <dl>
          <Row label={t('admin.players.lockName')}>{lock('trainerName', user.nameUnlockAt)}</Row>
          <Row label={t('admin.players.lockCountry')}>{lock('country', user.countryUnlockAt)}</Row>
          {doc?.hasPlayer && <Row label={t('admin.players.lockTimezone', { zone: doc.timezone })}>{lock('timezone', doc.timezoneUnlockAt)}</Row>}
        </dl>
      </Panel>

      <Panel variant="frame" title={t('admin.players.game')} headingLevel={3}>
        {!doc?.hasPlayer ? (
          <p className="text-mist-300">{t('admin.players.noPlayer')}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <dl>
              <Row label={t('admin.players.level')}>{fmtInt(doc.trainerLevel, i18n.language)}</Row>
              <Row label={t('admin.players.dust')}>{fmtInt(doc.dust, i18n.language)}</Row>
              <Row label={t('admin.players.pokemon')}>{fmtInt(doc.pokemonCount, i18n.language)}</Row>
              <Row label={t('admin.players.team')}>
                {doc.team.length === 0
                  ? '—'
                  : doc.team.map((m) => `${m.nickname ? `${m.nickname} (${speciesName(m.speciesSlug, lng)})` : speciesName(m.speciesSlug, lng)}${m.shiny ? ' ★' : ''} ${t('admin.players.lv', { level: m.level })}`).join(', ')}
              </Row>
              <Row label={t('admin.players.inventory')}>
                {Object.entries(doc.inventory).filter(([, n]) => n > 0).length === 0
                  ? '—'
                  : Object.entries(doc.inventory)
                      .filter(([, n]) => n > 0)
                      .map(([slug, n]) => `${itemName(slug, lng)} ×${n}`)
                      .join(', ')}
              </Row>
            </dl>
            <div className="flex flex-col gap-2 bg-dusk-900 p-3 inset-shadow-well">
              <p className="font-display text-base text-mist-300">{t('admin.players.session')}</p>
              {doc.activeSession ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p>
                    {t(doc.activeSession.paused ? 'admin.players.sessionPaused' : 'admin.players.sessionRunning', {
                      minutes: doc.activeSession.plannedMinutes,
                      since: dateTime(doc.activeSession.startedAt, i18n.language),
                    })}
                  </p>
                  {perm.moderate && (
                    <ConfirmAction
                      trigger={
                        <Button size="sm" variant="danger" disabled={busy}>
                          {t('admin.players.cancelSession')}
                        </Button>
                      }
                      title={t('admin.players.cancelSessionTitle', { name: user.trainerName })}
                      body={t('admin.players.cancelSessionBody')}
                      confirmLabel={t('admin.players.cancelSession')}
                      onConfirm={onCancelSession}
                    />
                  )}
                </div>
              ) : (
                <p className="text-mist-300">{t('admin.players.noSession')}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <p className="font-display text-base text-mist-300">{t('admin.players.history')}</p>
              {doc.history.length === 0 ? (
                <p className="text-mist-300">{t('admin.players.noHistory')}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {doc.history.map((h) => (
                    <li key={h.id} className="flex flex-wrap justify-between gap-x-4 bg-dusk-900 px-3 py-1.5 inset-shadow-well">
                      <span>{dateTime(h.claimedAt, i18n.language)}</span>
                      <span className="font-num">
                        {t('admin.players.historyRow', { minutes: h.minutes, points: fmtInt(h.points, i18n.language), focus: Math.round(h.focus * 100) })}
                        {h.lateClaim ? ` · ${t('admin.players.late')}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Panel>

      <Panel variant="frame" title={t('admin.players.browsers')} headingLevel={3}>
        <div className="flex flex-col gap-3">
          {detail.authSessions.length === 0 ? (
            <p className="text-mist-300">{t('admin.players.noBrowsers')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {detail.authSessions.map((s) => (
                <li key={s.id} className="flex flex-wrap justify-between gap-x-4 bg-dusk-900 px-3 py-1.5 inset-shadow-well">
                  <span className="min-w-0 truncate">{s.userAgent ?? t('admin.players.unknownBrowser')}</span>
                  <span>{t('admin.players.lastSeen', { date: dateTime(s.lastSeenAt, i18n.language) })}</span>
                </li>
              ))}
            </ul>
          )}
          {perm.logoutAll && detail.authSessions.length > 0 && (
            <ConfirmAction
              trigger={
                <Button size="sm" variant="danger" icon="logout" disabled={busy} className="self-start">
                  {t('admin.players.logoutAll')}
                </Button>
              }
              title={t('admin.players.logoutAllTitle', { name: user.trainerName })}
              body={t('admin.players.logoutAllBody')}
              confirmLabel={t('admin.players.logoutAll')}
              onConfirm={onLogoutAll}
            />
          )}
        </div>
      </Panel>

      {perm.grant && doc?.hasPlayer && grant}
    </div>
  )
}
