import { useTranslation } from 'react-i18next'

export default function App() {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2">
      <h1 className="text-4xl font-bold">{t('app.title')}</h1>
      <p className="text-neutral-500">{t('app.tagline')}</p>
    </main>
  )
}
