import {useState} from 'react'
import {Button} from '@/components/ui/button'
import {FolderOpen, Trash2, Scan, Pause, Play, X} from 'lucide-react'
import {ScanProgress} from '../types'

interface FolderPanelProps {
    folders: string[]
    scanning: boolean
    scanPaused: boolean
    scanProgress: ScanProgress | null
    minSize: number
    onRemoveFolder: (index: number) => void
    onScan: () => void
    onPauseScan: () => void
    onResumeScan: () => void
    onCancelScan: () => void
    onMinSizeChange: (size: number) => void
}

function FolderPanel({
    folders,
    scanning,
    scanPaused,
    scanProgress,
    minSize,
    onRemoveFolder,
    onScan,
    onPauseScan,
    onResumeScan,
    onCancelScan,
    onMinSizeChange
}: FolderPanelProps) {
    const [sizeValue, setSizeValue] = useState(() => {
        if (minSize >= 1024 * 1024 * 1024) return {value: minSize / (1024 * 1024 * 1024), unit: 'GB'}
        if (minSize >= 1024 * 1024) return {value: minSize / (1024 * 1024), unit: 'MB'}
        if (minSize >= 1024) return {value: minSize / 1024, unit: 'KB'}
        return {value: 0, unit: 'MB'}
    })
    return (
        <>
            <div className="flex-1 overflow-y-auto p-2">
                {folders.length === 0 && (
                    <div className="text-center text-muted-foreground text-xs py-6 px-2 leading-relaxed">
                        暂无文件夹，请先添加
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
                                {scanProgress.status === 'counting' ? '统计中...' :
                                 scanProgress.status === 'paused' ? '已暂停' :
                                 '扫描中...'}
                            </span>
                            <span className="font-medium">
                                {scanProgress.scannedFiles} / {scanProgress.totalFiles}
                            </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-background rounded-full h-2 overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                    scanProgress.status === 'paused' ? 'bg-yellow-500' : 'bg-primary'
                                }`}
                                style={{width: `${scanProgress.percentage}%`}}
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground truncate max-w-[140px]" title={scanProgress.currentFile}>
                                {scanProgress.currentFile || '准备中...'}
                            </span>
                            <span className="text-xs font-medium">
                                {scanProgress.percentage}%
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Min Size Filter */}
            {!scanning && (
                <div className="px-3 pb-1">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">最小</span>
                        <input
                            type="number"
                            min="0"
                            className="flex-1 h-7 px-2 text-xs rounded-md border bg-background"
                            value={sizeValue.value || ''}
                            placeholder="0"
                            onChange={e => {
                                const val = parseFloat(e.target.value) || 0
                                const units: Record<string, number> = {B: 1, KB: 1024, MB: 1024*1024, GB: 1024*1024*1024}
                                const bytes = Math.round(val * units[sizeValue.unit])
                                setSizeValue({...sizeValue, value: val})
                                onMinSizeChange(bytes)
                            }}
                        />
                        <select
                            className="h-7 px-1 text-xs rounded-md border bg-background"
                            value={sizeValue.unit}
                            onChange={e => {
                                const unit = e.target.value
                                const units: Record<string, number> = {B: 1, KB: 1024, MB: 1024*1024, GB: 1024*1024*1024}
                                const bytes = Math.round((sizeValue.value || 0) * units[unit])
                                setSizeValue({...sizeValue, unit})
                                onMinSizeChange(bytes)
                            }}
                        >
                            <option value="B">B</option>
                            <option value="KB">KB</option>
                            <option value="MB">MB</option>
                            <option value="GB">GB</option>
                        </select>
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
                        开始扫描
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
                                继续
                            </Button>
                        ) : (
                            <Button
                                className="flex-1"
                                variant="outline"
                                onClick={onPauseScan}
                            >
                                <Pause className="h-4 w-4 mr-1"/>
                                暂停
                            </Button>
                        )}
                        <Button
                            className="flex-1"
                            variant="destructive"
                            onClick={onCancelScan}
                        >
                            <X className="h-4 w-4 mr-1"/>
                            取消
                        </Button>
                    </div>
                )}
            </div>
        </>
    )
}

export default FolderPanel
