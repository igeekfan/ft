import {ExternalLink, X} from 'lucide-react'
import {useI18n} from '../i18n/context'

interface UpdateBannerProps {
    version: string
    releaseURL: string
    onDismiss: () => void
}

export default function UpdateBanner({version, releaseURL, onDismiss}: UpdateBannerProps) {
    const {t} = useI18n()

    return (
        <div className="bg-blue-600 dark:bg-blue-700 text-white px-4 py-2 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
                <span>{t('update.available', {version})}</span>
            </div>
            <div className="flex items-center gap-2">
                <a
                    href={releaseURL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-sm transition-colors"
                >
                    {t('update.download')}
                    <ExternalLink className="h-3 w-3"/>
                </a>
                <button
                    onClick={onDismiss}
                    className="p-1 hover:bg-white/20 rounded transition-colors"
                    aria-label={t('update.dismiss')}
                >
                    <X className="h-4 w-4"/>
                </button>
            </div>
        </div>
    )
}
