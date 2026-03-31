import {useState, useEffect} from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'
import {useI18n} from '../i18n/context'
import {GetScanHistory, LoadScan} from '../../wailsjs/go/main/App'

interface ScanHistoryItem {
    id: number
    totalFiles: number
    totalDuplicates: number
    totalWasted: number
    scanDuration: string
    createdAt: string
}

interface ScanHistoryProps {
    open: boolean
    onClose: () => void
    onLoad: (scanId: number) => void
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

function ScanHistory({open, onClose, onLoad}: ScanHistoryProps) {
    const {t} = useI18n()
    const [history, setHistory] = useState<ScanHistoryItem[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!open) return
        setLoading(true)
        GetScanHistory().then(items => {
            setHistory(items || [])
        }).catch(err => {
            console.error('GetScanHistory error:', err)
            setHistory([])
        }).finally(() => setLoading(false))
    }, [open])

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>{t('history.title')}</DialogTitle>
                </DialogHeader>
                <div className="max-h-[400px] overflow-y-auto space-y-2">
                    {loading && (
                        <div className="text-center text-muted-foreground py-4 text-sm">
                            {t('results.loading')}
                        </div>
                    )}
                    {!loading && history.length === 0 && (
                        <div className="text-center text-muted-foreground py-4 text-sm">
                            {t('history.noHistory')}
                        </div>
                    )}
                    {!loading && history.map(item => (
                        <div
                            key={item.id}
                            className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                        >
                            <div className="space-y-0.5">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>{item.createdAt}</span>
                                    {item.scanDuration && (
                                        <span>{t('history.duration', {duration: item.scanDuration})}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 text-xs">
                                    <span>{t('history.files', {count: item.totalFiles})}</span>
                                    <span className="text-orange-500">{t('history.duplicates', {count: item.totalDuplicates})}</span>
                                    <span className="text-red-500">{t('history.wasted', {size: formatSize(item.totalWasted)})}</span>
                                </div>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7"
                                onClick={() => onLoad(item.id)}
                            >
                                {t('history.load')}
                            </Button>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    )
}

export default ScanHistory
