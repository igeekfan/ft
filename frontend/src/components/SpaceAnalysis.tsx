import {main} from '../../wailsjs/go/models'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Badge} from '@/components/ui/badge'
import {useI18n} from '../i18n/context'

interface SpaceAnalysisProps {
    open: boolean
    items: main.SpaceAnalysisItem[]
    onClose: () => void
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

function SpaceAnalysis({open, items, onClose}: SpaceAnalysisProps) {
    const {t} = useI18n()
    const maxWasted = Math.max(...items.map(item => item.wasted), 0)

    return (
        <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
            <DialogContent className="sm:max-w-[720px]">
                <DialogHeader>
                    <DialogTitle>{t('analysis.title')}</DialogTitle>
                </DialogHeader>
                {items.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                        {t('analysis.empty')}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {items.map(item => (
                            <div key={item.type} className="rounded-lg border p-3 space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <div className="text-sm font-medium">{t(`results.${item.type}`)}</div>
                                        <Badge variant="outline" className="text-xs">
                                            {t('analysis.fileCount', {count: item.files})}
                                        </Badge>
                                    </div>
                                    <div className="text-right text-xs text-muted-foreground">
                                        <div>{t('analysis.totalSize', {size: formatSize(item.totalSize)})}</div>
                                        <div>{t('analysis.wasted', {size: formatSize(item.wasted)})}</div>
                                    </div>
                                </div>
                                <div className="h-2 rounded-full bg-muted overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-orange-500 transition-all"
                                        style={{width: maxWasted > 0 ? `${Math.max(6, Math.round(item.wasted * 100 / maxWasted))}%` : '0%'}}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}

export default SpaceAnalysis