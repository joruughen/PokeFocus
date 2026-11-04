import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import es from './locales/es.json'
import en from './locales/en.json'

export const SUPPORTED_LOCALES = ['es', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

/** Browser language → supported locale (Spanish for any `es-*`, English otherwise). */
export function detectLocale(): Locale {
  const langs = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : []
  for (const l of langs) {
    const base = l.toLowerCase().split('-')[0]
    if (base === 'es') return 'es'
    if (base === 'en') return 'en'
  }
  return 'en'
}

/** Locale saved by the prefs store (read before React mounts to avoid a flash). */
function savedLocale(): Locale | null {
  try {
    const raw = localStorage.getItem('pokefocus:prefs')
    const l = raw ? (JSON.parse(raw) as { state?: { locale?: string } }).state?.locale : null
    return l === 'es' || l === 'en' ? l : null
  } catch {
    return null
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: savedLocale() ?? detectLocale(),
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LOCALES,
  interpolation: { escapeValue: false },
  returnNull: false,
})

i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') document.documentElement.lang = lng
})
if (typeof document !== 'undefined') document.documentElement.lang = i18n.language

export default i18n
