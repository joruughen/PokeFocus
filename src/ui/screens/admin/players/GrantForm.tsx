import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ADMIN_GRANT_LIMITS } from '../../../../game/admin'
import { Button, Panel, TextField } from '../../../components'
import { ItemCombobox } from '../pickers'
import type { GrantInput } from './api'

export interface GrantFormProps {
  /** Resolves when the grant was applied; rejects with the API error (the parent shows it). */
  onGrant: (grant: GrantInput) => Promise<void>
  /** Ask for the password (sudo mode) before the grant. Only called when `elevated` is false. */
  onReauth: (password: string) => Promise<void>
  elevated: boolean
  error?: string | null
  busy?: boolean
}

/** Items + Dust + a mandatory reason, within the per-request caps of `src/game/admin.ts`. */
export function GrantForm({ onGrant, onReauth, elevated, error, busy }: GrantFormProps) {
  const { t } = useTranslation()
  const [item, setItem] = useState('poke-ball')
  const [count, setCount] = useState('')
  const [dust, setDust] = useState('')
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')

  const n = count.trim() === '' ? 0 : Number(count)
  const d = dust.trim() === '' ? 0 : Number(dust)
  const okInt = (v: number, max: number) => Number.isInteger(v) && v >= 0 && v <= max
  const valid = okInt(n, ADMIN_GRANT_LIMITS.maxPerItem) && okInt(d, ADMIN_GRANT_LIMITS.maxDust) && n + d > 0 && reason.trim().length >= ADMIN_GRANT_LIMITS.reasonMin

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid || busy) return
    if (!elevated) await onReauth(password)
    await onGrant({ ...(n > 0 && { items: { [item]: n } }), ...(d > 0 && { dust: d }), reason: reason.trim() }).then(() => {
      setCount('')
      setDust('')
      setReason('')
    })
  }

  return (
    <Panel variant="frame" title={t('admin.players.grant.title')} headingLevel={3}>
      <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e).catch(() => undefined)}>
        <p className="text-mist-300">{t('admin.players.grant.body', { items: ADMIN_GRANT_LIMITS.maxPerItem, dust: ADMIN_GRANT_LIMITS.maxDust })}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ItemCombobox strict label={t('admin.players.grant.item')} value={item} onChange={setItem} />
          <TextField label={t('admin.players.grant.count')} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} placeholder="0" />
        </div>
        <TextField label={t('admin.players.grant.dust')} inputMode="numeric" value={dust} onChange={(e) => setDust(e.target.value)} placeholder="0" />
        <TextField
          label={t('admin.players.grant.reason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={ADMIN_GRANT_LIMITS.reasonMax}
          hint={t('admin.players.grant.reasonHint', { min: ADMIN_GRANT_LIMITS.reasonMin })}
        />
        {!elevated && (
          <TextField
            label={t('admin.players.grant.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            revealable
            autoComplete="current-password"
            hint={t('admin.players.grant.passwordHint')}
          />
        )}
        <p className="min-h-5 text-sm text-cheek-400" role="alert">
          {error ?? null}
        </p>
        <Button type="submit" icon="check" disabled={!valid || busy || (!elevated && password === '')} className="self-start">
          {t('admin.players.grant.submit')}
        </Button>
      </form>
    </Panel>
  )
}
