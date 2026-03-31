import {createContext, useContext, useState, useCallback, ReactNode} from 'react'
import zhCN from './zh-CN'
import enUS from './en-US'

type Lang = 'zh-CN' | 'en-US'

const translations: Record<Lang, Record<string, string>> = {
    'zh-CN': zhCN,
    'en-US': enUS as Record<string, string>,
}

const STORAGE_KEY_LANG = 'duplicate-scanner-lang'

function loadLang(): Lang {
    const stored = localStorage.getItem(STORAGE_KEY_LANG)
    if (stored === 'en-US' || stored === 'zh-CN') return stored
    return 'zh-CN'
}

interface I18nContextValue {
    t: (key: string, params?: Record<string, string | number>) => string
    lang: Lang
    setLang: (lang: Lang) => void
}

const I18nContext = createContext<I18nContextValue>({
    t: (key) => key,
    lang: 'zh-CN',
    setLang: () => {},
})

export function I18nProvider({children}: {children: ReactNode}) {
    const [lang, setLangState] = useState<Lang>(loadLang)

    const setLang = useCallback((l: Lang) => {
        setLangState(l)
        localStorage.setItem(STORAGE_KEY_LANG, l)
    }, [])

    const t = useCallback((key: string, params?: Record<string, string | number>) => {
        let text = translations[lang]?.[key] || translations['zh-CN'][key] || key
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                text = text.replace(`{${k}}`, String(v))
            }
        }
        return text
    }, [lang])

    return (
        <I18nContext.Provider value={{t, lang, setLang}}>
            {children}
        </I18nContext.Provider>
    )
}

export function useI18n() {
    return useContext(I18nContext)
}
