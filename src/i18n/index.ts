import i18n from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import en from './en.json'
import zhCN from './zh-CN.json'

export type Language = 'en' | 'zh-CN'

const storedLanguage = localStorage.getItem('ferric-language')
const initialLanguage: Language = storedLanguage === 'zh-CN' ? 'zh-CN' : 'en'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, 'zh-CN': { translation: zhCN } },
  lng: initialLanguage,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export function useI18n() {
  const { t, i18n: instance } = useTranslation()
  const language: Language = instance.resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en'
  const setLanguage = (nextLanguage: Language) => {
    void instance.changeLanguage(nextLanguage)
    localStorage.setItem('ferric-language', nextLanguage)
    document.documentElement.lang = nextLanguage
  }

  return { t, language, setLanguage }
}
