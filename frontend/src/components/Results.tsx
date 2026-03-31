import {useState, useMemo} from 'react'
import {main} from '../../wailsjs/go/models'
import {OpenFile, OpenFileLocation} from '../../wailsjs/go/main/App'

type DuplicateGroup = main.DuplicateGroup
import {Button} from '@/components/ui/button'
import {Badge} from '@/components/ui/badge'
import {Checkbox} from '@/components/ui/checkbox'
import {cn} from '@/lib/utils'
import {FileVideo, Image, Music, FileText, Archive, File, Trash2, FolderOpen, ExternalLink} from 'lucide-react'

interface ResultsProps {
    groups: DuplicateGroup[]
    selectedPaths: Set<string>
    onToggle: (path: string) => void
    onToggleGroup: (group: DuplicateGroup) => void
    onDeleteFile: (path: string) => void
}

type FileType = 'all' | 'video' | 'image' | 'audio' | 'document' | 'archive' | 'other'

interface FileTypeConfig {
    label: string
    icon: React.ReactNode
    extensions: string[]
}

const FILE_TYPES: Record<Exclude<FileType, 'all'>, FileTypeConfig> = {
    video: {
        label: '视频',
        icon: <FileVideo className="h-3.5 w-3.5"/>,
        extensions: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg']
    },
    image: {
        label: '图片',
        icon: <Image className="h-3.5 w-3.5"/>,
        extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif']
    },
    audio: {
        label: '音频',
        icon: <Music className="h-3.5 w-3.5"/>,
        extensions: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.opus']
    },
    document: {
        label: '文档',
        icon: <FileText className="h-3.5 w-3.5"/>,
        extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.odt', '.csv']
    },
    archive: {
        label: '压缩包',
        icon: <Archive className="h-3.5 w-3.5"/>,
        extensions: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso']
    },
    other: {
        label: '其他',
        icon: <File className="h-3.5 w-3.5"/>,
        extensions: []
    }
}

function getFileType(filename: string): Exclude<FileType, 'all'> {
    const ext = '.' + filename.split('.').pop()?.toLowerCase()
    for (const [type, config] of Object.entries(FILE_TYPES)) {
        if (config.extensions.includes(ext)) {
            return type as Exclude<FileType, 'all'>
        }
    }
    return 'other'
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

function getFolderPath(filePath: string): string {
    const lastSep = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
    return lastSep >= 0 ? filePath.substring(0, lastSep) : filePath
}

function Results({groups, selectedPaths, onToggle, onToggleGroup, onDeleteFile}: ResultsProps) {
    const [activeFilter, setActiveFilter] = useState<FileType>('all')

    // Calculate file type counts
    const fileTypeCounts = useMemo(() => {
        const counts: Record<Exclude<FileType, 'all'>, number> = {
            video: 0, image: 0, audio: 0, document: 0, archive: 0, other: 0
        }
        groups.forEach(group => {
            group.files.forEach(file => {
                counts[getFileType(file.name)]++
            })
        })
        return counts
    }, [groups])

    // Filter groups by file type
    const filteredGroups = useMemo(() => {
        if (activeFilter === 'all') return groups
        return groups
            .map(group => main.DuplicateGroup.createFrom({
                ...group,
                files: group.files.filter(f => getFileType(f.name) === activeFilter)
            }))
            .filter(g => g.files.length >= 2)
    }, [groups, activeFilter])

    const totalFiles = groups.reduce((s, g) => s + g.files.length, 0)

    if (groups.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <div className="text-5xl mb-4 opacity-50">📂</div>
                <div>暂无重复文件</div>
                <div className="text-xs mt-2 text-muted-foreground/70">添加文件夹后点击"开始扫描"</div>
            </div>
        )
    }

    return (
        <div className="flex-1 overflow-y-auto p-4">
            {/* Filter Bar */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
                <Button
                    variant={activeFilter === 'all' ? 'default' : 'outline'}
                    size="sm"
                    className="rounded-full h-7 text-xs"
                    onClick={() => setActiveFilter('all')}
                >
                    全部
                    <span className="ml-1 text-xs opacity-70">{totalFiles}</span>
                </Button>
                {(Object.entries(FILE_TYPES) as [Exclude<FileType, 'all'>, FileTypeConfig][]).map(([type, config]) => (
                    <Button
                        key={type}
                        variant={activeFilter === type ? 'default' : 'outline'}
                        size="sm"
                        className="rounded-full h-7 text-xs"
                        onClick={() => setActiveFilter(type)}
                    >
                        {config.icon}
                        <span className="ml-1">{config.label}</span>
                        {fileTypeCounts[type] > 0 && (
                            <span className="ml-1 text-xs opacity-70">{fileTypeCounts[type]}</span>
                        )}
                    </Button>
                ))}
            </div>

            {/* Groups */}
            {filteredGroups.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                    {activeFilter === 'all' ? '没有重复文件' : `没有找到 ${FILE_TYPES[activeFilter]?.label || ''} 类型的重复文件`}
                </div>
            ) : (
                filteredGroups.map((group, index) => {
                    const allSelected = group.files.every(f => selectedPaths.has(f.path))
                    const wasted = (group.files.length - 1) * group.size
                    const groupType = getFileType(group.files[0]?.name || '')

                    return (
                        <div key={group.hash} className="rounded-lg border bg-card mb-3 overflow-hidden">
                            <div className="flex items-center justify-between p-3 bg-muted/30 border-b">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <span className="text-muted-foreground text-xs font-semibold">#{index + 1}</span>
                                    <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                                        {group.hash.substring(0, 12)}...
                                    </code>
                                    <span className="text-xs text-muted-foreground">{formatSize(group.size)}</span>
                                    <Badge variant="secondary" className="text-xs">
                                        {group.files.length} 个文件
                                    </Badge>
                                    <Badge variant="outline" className="text-xs text-orange-500">
                                        可释放 {formatSize(wasted)}
                                    </Badge>
                                    <Badge variant="outline" className="text-xs">
                                        {FILE_TYPES[groupType]?.icon}
                                        <span className="ml-1">{FILE_TYPES[groupType]?.label}</span>
                                    </Badge>
                                </div>
                                <Button
                                    variant={allSelected ? 'default' : 'outline'}
                                    size="sm"
                                    className="text-xs h-7"
                                    onClick={() => onToggleGroup(group)}
                                >
                                    {allSelected ? '取消全选' : '全选'}
                                </Button>
                            </div>
                            <div className="p-2">
                                {group.files.map(file => {
                                    const checked = selectedPaths.has(file.path)
                                    const folder = getFolderPath(file.path)

                                    return (
                                        <div
                                            key={file.path}
                                            className={cn(
                                                "flex items-center p-2.5 rounded-md group hover:bg-accent/50 transition-colors",
                                                checked && "bg-accent/30"
                                            )}
                                        >
                                            <Checkbox
                                                checked={checked}
                                                onCheckedChange={() => onToggle(file.path)}
                                                className="mr-3"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm truncate">{file.name}</div>
                                                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                                    <span className="truncate flex-1" title={file.path}>{folder}</span>
                                                    <span className="shrink-0">{formatSize(file.size)}</span>
                                                    <span className="shrink-0">{file.modTime}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                                                    onClick={() => OpenFileLocation(file.path).catch(() => {})}
                                                    title="打开所在目录"
                                                >
                                                    <FolderOpen className="h-3.5 w-3.5"/>
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                                                    onClick={() => OpenFile(file.path).catch(() => {})}
                                                    title="打开文件"
                                                >
                                                    <ExternalLink className="h-3.5 w-3.5"/>
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                                    onClick={() => onDeleteFile(file.path)}
                                                    title="删除此文件"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5"/>
                                                </Button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )
                })
            )}
        </div>
    )
}

export default Results
