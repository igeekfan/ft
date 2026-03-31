import {DuplicateGroup} from '../types'
import {Button} from '@/components/ui/button'
import {Trash2, X, FolderOpen} from 'lucide-react'

interface ActionBarProps {
    selectedCount: number
    totalWasted: number
    folders: string[]
    groups: DuplicateGroup[]
    onSelectFolderDuplicates: (folderPrefix: string) => void
    onDelete: () => void
    onDeselectAll: () => void
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

function getShortFolderName(folder: string): string {
    const lastSep = Math.max(folder.lastIndexOf('\\'), folder.lastIndexOf('/'))
    return lastSep >= 0 ? folder.substring(lastSep + 1) || folder : folder
}

function ActionBar({
    selectedCount,
    totalWasted,
    folders,
    groups,
    onSelectFolderDuplicates,
    onDelete,
    onDeselectAll
}: ActionBarProps) {
    if (groups.length === 0) return null

    return (
        <div className="flex items-center justify-between p-3 bg-card border-t flex-wrap gap-2">
            <div className="text-xs text-muted-foreground">
                共 {groups.length} 组重复，可释放 {formatSize(totalWasted)}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
                {folders.length > 1 && (
                    <div className="flex items-center gap-1.5 mr-2">
                        <span className="text-xs text-muted-foreground">全选:</span>
                        {folders.map((folder, i) => (
                            <Button
                                key={i}
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs max-w-[120px]"
                                onClick={() => onSelectFolderDuplicates(folder)}
                                title={folder}
                            >
                                <FolderOpen className="h-3 w-3 mr-1"/>
                                {getShortFolderName(folder)}
                            </Button>
                        ))}
                    </div>
                )}
                {selectedCount > 0 && (
                    <>
                        <span className="text-xs text-muted-foreground">
                            已选中 {selectedCount} 个文件
                        </span>
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onDeselectAll}>
                            <X className="h-3 w-3 mr-1"/>
                            取消全选
                        </Button>
                        <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={onDelete}>
                            <Trash2 className="h-3 w-3 mr-1"/>
                            删除选中 ({selectedCount})
                        </Button>
                    </>
                )}
            </div>
        </div>
    )
}

export default ActionBar
