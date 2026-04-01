import {Button} from '@/components/ui/button'
import {FolderOpen, Trash2, Scan, Pause, Play, X} from 'lucide-react'
import {ScanProgress} from '../types'
import {useI18n} from '../i18n/context'

interface FolderPanelProps {
    folders: string[]
    scanning: boolean
    scanPaused: boolean
    scanProgress: ScanProgress | null
    scanLogs: string[]
    onRemoveFolder: (index: number) => void
    onScan: () => void
    onPauseScan: () => void
    onResumeScan: () => void
    onCancelScan: () => void
}

function FolderPanel({
    folders,
    scanning,
    scanPaused,
    scanProgress,
    scanLogs,
    onRemoveFolder,
    onScan,
    onPauseScan,
    onResumeScan,
    onCancelScan
}: FolderPanelProps) {
    const {t} = useI18n()
    return (
        <>
            <div className="flex-1 overflow-y-auto p-2">
                {folders.length === 0 && (
                    <div className="text-center text-muted-foreground text-xs py-6 px-2 leading-relaxed">
                        {t('folderPanel.noFolders')}
                    </div>
                )}
                {folders.map((folder, index) => (
                    <div
                        key={index}
                        className="flex items-center justify-between p-2.5 mb-1 rounded-md hover:bg-accent group"
                    >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0"/>
                            <span className="text-xs text-foreground truncate" title={folder}>
                                {folder}
                            </span>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                            onClick={() => onRemoveFolder(index)}
                            disabled={scanning}
                        >
                            <Trash2 className="h-3.5 w-3.5"/>
                        </Button>
                    </div>
                ))}
            </div>

            {/* Scan Progress */}
            {scanning && scanProgress && (
                <div className="px-3 pb-2">
                    <div className="bg-muted rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                                {scanProgress.status === 'paused' ? t('folderPanel.paused') : t('folderPanel.scanning')}
                            </span>
                            <span className="font-medium">
                                {scanProgress.totalFiles > 0
                                    ? t('folderPanel.progress', {scanned: scanProgress.scannedFiles, total: scanProgress.totalFiles})
                                    : t('folderPanel.scanned', {count: scanProgress.scannedFiles})}
                            </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-background rounded-full h-2 overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                    scanProgress.status === 'paused' ? 'bg-yellow-500' :
                                    scanProgress.totalFiles > 0 ? 'bg-primary' : 'bg-primary animate-pulse'
                                }`}
                                style={scanProgress.totalFiles > 0 ? {width: `${scanProgress.percentage}%`} : {width: '100%'}}
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground flex-1 pr-2 leading-4 break-all" title={scanProgress.currentFile}>
                                {scanProgress.message || scanProgress.currentFile || t('folderPanel.preparing')}
                            </span>
                            <span className="text-xs font-medium">
                                {scanProgress.totalFiles > 0 ? `${scanProgress.percentage}%` : ''}
                            </span>
                        </div>

                        {scanLogs.length > 0 && (
                            <div className="pt-2 border-t border-border/60 space-y-1">
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
                                    {t('folderPanel.recentLogs')}
                                </div>
                                <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                                    {[...scanLogs].reverse().map((log, index) => (
                                        <div key={`${index}-${log}`} className="text-[11px] leading-4 text-muted-foreground break-all">
                                            {log}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Scan Controls */}
            <div className="p-3 space-y-2">
                {!scanning ? (
                    <Button
                        className="w-full"
                        onClick={onScan}
                        disabled={folders.length === 0}
                    >
                        <Scan className="h-4 w-4 mr-2"/>
                        {t('folderPanel.startScan')}
                    </Button>
                ) : (
                    <div className="flex gap-2">
                        {scanPaused ? (
                            <Button
                                className="flex-1"
                                variant="outline"
                                onClick={onResumeScan}
                            >
                                <Play className="h-4 w-4 mr-1"/>
                                {t('folderPanel.resume')}
                            </Button>
                        ) : (
                            <Button
                                className="flex-1"
                                variant="outline"
                                onClick={onPauseScan}
                            >
                                <Pause className="h-4 w-4 mr-1"/>
                                {t('folderPanel.pause')}
                            </Button>
                        )}
                        <Button
                            className="flex-1"
                            variant="destructive"
                            onClick={onCancelScan}
                        >
                            <X className="h-4 w-4 mr-1"/>
                            {t('folderPanel.cancel')}
                        </Button>
                    </div>
                )}
            </div>
        </>
    )
}

export default FolderPanel
