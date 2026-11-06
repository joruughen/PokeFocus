import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toLocal } from '../../../engine'
import type { Locale } from '../../../i18n'
import { StageBadge } from '../../changelog/StageBadge'
import { MaintenanceBanner } from '../../MaintenanceBanner'
import { Button, Logo, Mascot, Platform, Segmented, Select, Sprite, Stage, TextField, type MascotPose } from '../../components'
import { timeOfDay } from '../../lib/conditions'
import { countryName, countryOptions, flagEmoji, guessCountry } from '../../lib/countries'
import { requestErrorText } from '../../lib/errors'
import { browserTimeZone } from '../../lib/format'
import { checkCountry, checkEmail, checkPassword, checkTrainerName, PASSWORD_MAX, PASSWORD_MIN, TRAINER_MAX } from '../../lib/validation'
import { useAuth } from '../../store/auth'
import { usePrefs } from '../../store/prefs'

type Mode = 'login' | 'register'

/**
 * Sign in / create an account. Same frame as the first run (route band, the
 * mascot speaking, one plate), so the first minute of the game feels like one
 * place. On "create account" a trainer card fills in as you type: the name and
 * flag that will appear on the leaderboards.
 */
export function AuthScreen() {
  const { t } = useTranslation()
  const locale = usePrefs((s) => s.locale)
  const setLocale = usePrefs((s) => s.setLocale)
  const [mode, setMode] = useState<Mode>('login')
  const hour = toLocal(Date.now(), browserTimeZone()).hour

  const speech: { pose: MascotPose; text: string } = mode === 'login' ? { pose: 'idle', text: t('auth.speech.login') } : { pose: 'point', text: t('auth.speech.register') }

  return (
    <div className="min-h-dvh bg-dusk-950">
      <MaintenanceBanner className="relative z-10" />
      <Stage time={timeOfDay(hour)} weather="clear" className="h-56 shadow-none">
        <div className="mx-auto flex h-full max-w-5xl items-start justify-between gap-4 px-6 pt-6">
          <div className="flex flex-col items-start gap-1">
            <Logo height={48} />
            <StageBadge />
          </div>
          <Segmented<Locale>
            label={t('firstRun.language')}
            value={locale}
            onChange={setLocale}
            options={[
              { value: 'es', label: 'ES', ariaLabel: 'Español' },
              { value: 'en', label: 'EN', ariaLabel: 'English' },
            ]}
          />
        </div>
      </Stage>

      <main id="main" tabIndex={-1} className="relative mx-auto -mt-24 max-w-5xl px-4 pb-16 outline-none sm:px-6">
        <div className="mb-6 flex items-end gap-4">
          <Mascot pose={speech.pose} size={144} className="shrink-0 max-sm:hidden" />
          <Mascot pose={speech.pose} size={96} className="shrink-0 sm:hidden" />
          <p key={mode} className="relative mb-8 max-w-xl animate-pop-in bg-mist-50 px-4 py-3 text-lg text-ink shadow-raised">
            <SpeechTail />
            {speech.text}
          </p>
        </div>

        <section className="bg-dusk-800 p-5 shadow-plate md:p-8" aria-labelledby="auth-title">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <h1 id="auth-title" className="text-2xl">
              {mode === 'login' ? t('auth.login.title') : t('auth.register.title')}
            </h1>
            <Segmented<Mode>
              label={t('auth.modeLabel')}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'login', label: t('auth.login.tab') },
                { value: 'register', label: t('auth.register.tab') },
              ]}
            />
          </div>
          {mode === 'login' ? <LoginForm onSwitch={() => setMode('register')} /> : <RegisterForm onSwitch={() => setMode('login')} />}
        </section>
        <p className="mt-6 text-center text-sm text-mist-400">{t('auth.freshStart')}</p>
        <p className="mt-2 text-center text-xs text-mist-400">{t('app.disclaimer')}</p>
      </main>
    </div>
  )
}

function FormError({ message }: { message: string | null }) {
  return (
    <p role="alert" aria-live="assertive" className={message ? 'bg-dusk-900 p-3 text-cheek-400 inset-shadow-well' : 'sr-only'}>
      {message ?? ''}
    </p>
  )
}

function LoginForm({ onSwitch }: { onSwitch: () => void }) {
  const { t } = useTranslation()
  const login = useAuth((s) => s.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const emailErr = tried ? checkEmail(email) : null
  const passErr = tried && !password ? 'auth.invalid.passwordEmpty' : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (checkEmail(email) || !password) return
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setError(requestErrorText(err))
      setBusy(false)
    }
  }

  return (
    <form noValidate onSubmit={submit} className="grid max-w-xl gap-5">
      <TextField
        label={t('auth.email')}
        type="email"
        autoComplete="email"
        inputMode="email"
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={emailErr ? t(emailErr) : null}
      />
      <TextField
        label={t('auth.password')}
        revealable
        autoComplete="current-password"
        value={password}
        maxLength={PASSWORD_MAX}
        onChange={(e) => setPassword(e.target.value)}
        error={passErr ? t(passErr) : null}
      />
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" icon="play" disabled={busy}>
          {busy ? t('auth.login.busy') : t('auth.login.submit')}
        </Button>
        <button type="button" onClick={onSwitch} className="text-mist-300 underline decoration-2 underline-offset-4 hover:text-mist-50">
          {t('auth.login.noAccount')}
        </button>
      </div>
    </form>
  )
}

function RegisterForm({ onSwitch }: { onSwitch: () => void }) {
  const { t, i18n } = useTranslation()
  const register = useAuth((s) => s.register)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [country, setCountry] = useState(guessCountry)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lng = i18n.language
  const countries = useMemo(() => countryOptions(lng), [lng])

  const errs = {
    email: checkEmail(email),
    password: checkPassword(password),
    name: checkTrainerName(name),
    country: checkCountry(country),
  }
  const show = (k: keyof typeof errs) => (tried || touched[k] ? errs[k] : null)
  const blur = (k: string) => () => setTouched((s) => ({ ...s, [k]: true }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (Object.values(errs).some(Boolean)) return
    setBusy(true)
    setError(null)
    try {
      await register({ email: email.trim(), password, trainerName: name.trim(), country })
    } catch (err) {
      setError(requestErrorText(err))
      setBusy(false)
    }
  }

  return (
    <form noValidate onSubmit={submit} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid content-start gap-5 md:grid-cols-2">
        <TextField
          className="md:col-span-2"
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={blur('email')}
          error={show('email') ? t(show('email')!) : null}
        />
        <TextField
          className="md:col-span-2"
          label={t('auth.password')}
          revealable
          autoComplete="new-password"
          value={password}
          maxLength={PASSWORD_MAX}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={blur('password')}
          error={show('password') ? t(show('password')!, { min: PASSWORD_MIN, max: PASSWORD_MAX }) : null}
          hint={t('auth.passwordHint', { min: PASSWORD_MIN })}
        />
        <TextField
          label={t('auth.trainerName')}
          autoComplete="nickname"
          value={name}
          maxLength={TRAINER_MAX}
          onChange={(e) => setName(e.target.value)}
          onBlur={blur('name')}
          error={show('name') ? t(show('name')!) : null}
          hint={t('auth.trainerHint')}
        />
        <div className="flex flex-col gap-1.5">
          <Select label={t('auth.country')} options={countries} value={country} onChange={setCountry} />
          <p className="text-sm text-mist-400">{t('auth.countryHint')}</p>
        </div>
        <div className="md:col-span-2">
          <FormError message={error} />
        </div>
        <div className="flex flex-wrap items-center gap-4 md:col-span-2">
          <Button type="submit" size="lg" icon="star" disabled={busy}>
            {busy ? t('auth.register.busy') : t('auth.register.submit')}
          </Button>
          <button type="button" onClick={onSwitch} className="text-mist-300 underline decoration-2 underline-offset-4 hover:text-mist-50">
            {t('auth.register.haveAccount')}
          </button>
        </div>
      </div>
      <TrainerCardPreview name={name.trim()} country={country} />
    </form>
  )
}

/** The light "battle nameplate" card, filled from the form: how others will see you. */
function TrainerCardPreview({ name, country }: { name: string; country: string }) {
  const { t, i18n } = useTranslation()
  return (
    <aside aria-label={t('auth.preview.label')} className="self-start max-lg:hidden">
      <p className="mb-2 text-sm text-mist-400">{t('auth.preview.caption')}</p>
      <div className="bg-mist-50 text-ink shadow-raised">
        <Stage time="day" weather="clear" celestial={false} className="h-32 shadow-none">
          <div className="relative flex h-full items-end justify-center pb-2">
            <Platform width={112} className="absolute bottom-2" />
            <Sprite kind="showdown" slug="pikachu" scale={1} flip alt="" className="relative mb-3" />
          </div>
        </Stage>
        <div className="flex flex-col gap-1 p-4">
          <p className="truncate font-display text-xl">{name || t('auth.preview.placeholder')}</p>
          <p className="flex items-center gap-2 text-sm">
            <span aria-hidden className="text-lg leading-none">
              {flagEmoji(country)}
            </span>
            {countryName(country, i18n.language)}
          </p>
          <p className="text-sm text-ink/70">{t('trainer.level', { level: 1 })}</p>
        </div>
      </div>
    </aside>
  )
}

/** Pixel tail on the left of a speech bubble, pointing at the mascot. */
function SpeechTail() {
  return (
    <svg viewBox="0 0 6 6" width={18} height={18} shapeRendering="crispEdges" aria-hidden className="absolute bottom-3 -left-[16px]">
      <path d="M6 0v6H5V5H4V4H3V3H2V2H1V1H0V0z" fill="var(--color-ink)" />
      <path d="M6 1v4H5V4H4V3H3V2H2V1z" fill="var(--color-mist-50)" />
    </svg>
  )
}
