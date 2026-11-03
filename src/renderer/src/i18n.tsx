import { createContext, useCallback, useContext, useMemo } from 'react'
import type { AppLanguage } from '@shared/types'

type TranslationVariables = Record<string, string | number>

interface I18nContextValue {
  language: AppLanguage
  locale: string
  tr: (
    zhCN: string,
    en: string,
    zhTW: string,
    variables?: TranslationVariables
  ) => string
  formatDate: (
    value: string | number | Date,
    options?: Intl.DateTimeFormatOptions
  ) => string
}

const LOCALES: Record<AppLanguage, string> = {
  'zh-CN': 'zh-CN',
  en: 'en-US',
  'zh-TW': 'zh-TW'
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({
  language,
  children
}: {
  language: AppLanguage
  children: React.ReactNode
}): React.JSX.Element {
  const tr = useCallback(
    (
      zhCN: string,
      en: string,
      zhTW: string,
      variables?: TranslationVariables
    ): string => translate(language, zhCN, en, zhTW, variables),
    [language]
  )

  const formatDate = useCallback(
    (value: string | number | Date, options?: Intl.DateTimeFormatOptions): string => {
      const date = value instanceof Date ? value : new Date(value)
      if (Number.isNaN(date.getTime())) {
        return translate(language, '时间未知', 'Unknown time', '時間未知')
      }
      return new Intl.DateTimeFormat(LOCALES[language], options).format(date)
    },
    [language]
  )

  const value = useMemo<I18nContextValue>(
    () => ({ language, locale: LOCALES[language], tr, formatDate }),
    [formatDate, language, tr]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext)
  if (!value) {
    throw new Error('useI18n must be used inside I18nProvider')
  }
  return value
}

export function translate(
  language: AppLanguage,
  zhCN: string,
  en: string,
  zhTW: string,
  variables?: TranslationVariables
): string {
  const template = language === 'en' ? en : language === 'zh-TW' ? zhTW : zhCN
  if (!variables) {
    return template
  }
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match
  )
}
