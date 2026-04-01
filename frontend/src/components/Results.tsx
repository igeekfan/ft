import {useState, useMemo, useEffect} from 'react'
import {main} from '../../wailsjs/go/models'
import {OpenFile, OpenFileLocation} from '../../wailsjs/go/main/App'
import {useI18n} from '../i18n/context'

type DuplicateGroup = main.DuplicateGroup
import {Button} from '@/components/ui/button'
import {Badge} from '@/components/ui/badge'
import {Checkbox} from '@/components/ui/checkbox'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {cn} from '@/lib/utils'
import {FileVideo, Image, Music, FileText, Archive, File, Trash2, FolderOpen, ExternalLink, Eye} from 'lucide-react'

interface ResultsProps {
    groups: DuplicateGroup[]
    selectedPaths: Set<string>
    allowedTypes: string[]
    pageInfo: {page: number; pageSize: number; total: number; totalPages: number}
    sortBy: string
    searchQuery: string
    loading: boolean
    onToggle: (path: string) => void
    onToggleGroup: (group: DuplicateGroup) => void
    onDeleteFile: (path: string) => void
    onPageChange: (page: number) => void
    onSortChange: (sortBy: string) => void
    onSearchChange: (query: string) => void
}

type FileType = 'all' | 'video' | 'image' | 'audio' | 'document' | 'archive' | 'other'

interface FileTypeConfig {
    labelKey: string
    icon: React.ReactNode
    extensions: string[]
}

const FILE_TYPES: Record<Exclude<FileType, 'all'>, FileTypeConfig> = {
    video: {
        labelKey: 'results.video',
        icon: <FileVideo className="h-3.5 w-3.5"/>,
        extensions: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg']
    },
    image: {
        labelKey: 'results.image',
        icon: <Image className="h-3.5 w-3.5"/>,
        extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif']
    },
    audio: {
        labelKey: 'results.audio',
        icon: <Music className="h-3.5 w-3.5"/>,
        extensions: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.opus']
    },
    document: {
        labelKey: 'results.document',
        icon: <FileText className="h-3.5 w-3.5"/>,
        extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.odt', '.csv']
    },
    archive: {
        labelKey: 'results.archive',
        icon: <Archive className="h-3.5 w-3.5"/>,
        extensions: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso']
    },
    other: {
        labelKey: 'results.other',
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

function getGroupLabel(group: DuplicateGroup): string {
    if (group.hash.startsWith('name:')) {
        return group.hash.slice(5)
    }
    return `${group.hash.substring(0, 12)}...`
}

function toFileUrl(filePath: string): string {
    return encodeURI(`file:///${filePath.replace(/\\/g, '/')}`)
}

function isPreviewable(file: main.FileInfo): boolean {
    return ['image', 'video', 'audio'].includes(getFileType(file.name))
}

function Results({
    groups,
    selectedPaths,
    allowedTypes,
    pageInfo,
    sortBy,
    searchQuery,
    loading,
    onToggle,
    onToggleGroup,
    onDeleteFile,
    onPageChange,
    onSortChange,
    onSearchChange
}: ResultsProps) {
    const {t} = useI18n()
    const [activeFilter, setActiveFilter] = useState<FileType>('all')
    const [searchInput, setSearchInput] = useState(searchQuery)
    const [previewFile, setPreviewFile] = useState<main.FileInfo | null>(null)
    const [brokenPreviewPaths, setBrokenPreviewPaths] = useState<Record<string, true>>({})

    useEffect(() => {
        const timer = setTimeout(() => onSearchChange(searchInput), 300)
        return () => clearTimeout(timer)
    }, [searchInput, onSearchChange])

    const filteredGroups = useMemo(() => {
        if (allowedTypes.length === 0) return groups
        return groups
            .map(group => main.DuplicateGroup.createFrom({
                ...group,
                files: group.files.filter(f => allowedTypes.includes(getFileType(f.name)))
            }))
            .filter(g => g.files.length >= 2)
    }, [groups, allowedTypes])

    const fileTypeCounts = useMemo(() => {
        const counts: Record<Exclude<FileType, 'all'>, number> = {
            video: 0, image: 0, audio: 0, document: 0, archive: 0, other: 0
        }
        filteredGroups.forEach(group => {
            group.files.forEach(file => {
                counts[getFileType(file.name)]++
            })
        })
        return counts
    }, [filteredGroups])

    const displayGroups = useMemo(() => {
        if (activeFilter === 'all') return filteredGroups
        return filteredGroups
            .map(group => main.DuplicateGroup.createFrom({
                ...group,
                files: group.files.filter(f => getFileType(f.name) === activeFilter)
            }))
            .filter(g => g.files.length >= 2)
    }, [filteredGroups, activeFilter])

    const totalFiles = filteredGroups.reduce((s, g) => s + g.files.length, 0)

    const renderPreviewContent = (file: main.FileInfo) => {
        const fileType = getFileType(file.name)
        const src = toFileUrl(file.path)

        if (fileType === 'image') {
            return <img src={src} alt={file.name} className="max-h-[70vh] w-full object-contain rounded-md bg-muted/30" />
        }
        if (fileType === 'video') {
            return <video src={src} controls className="max-h-[70vh] w-full rounded-md bg-black" preload="metadata" />
        }
        if (fileType === 'audio') {
            return (
                <div className="rounded-md border bg-muted/20 p-6 space-y-4">
                    <div className="flex items-center gap-3 text-sm font-medium">
                        <Music className="h-5 w-5" />
                        <span className="truncate">{file.name}</span>
                    </div>
                    <audio src={src} controls className="w-full" preload="metadata" />
                </div>
            )
        }
        return <div className="text-sm text-muted-foreground">{t('results.previewUnsupported')}</div>
    }

    if (filteredGroups.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <div className="text-5xl mb-4 opacity-50">📂</div>
                <div>{t('results.noFiles')}</div>
                <div className="text-xs mt-2 text-muted-foreground/70">{t('results.noFilesHint')}</div>
            </div>
        )
    }

    return (
        <div className="flex-1 overflow-y-auto p-4">
            {/* Filter Bar */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
                <input
                    type="text"
                    placeholder={t('results.searchPlaceholder')}
                    className="h-7 px-3 text-xs rounded-md border bg-background w-40"
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                />
                <div className="w-px h-5 bg-border"/>
                <Button
                    variant={activeFilter === 'all' ? 'default' : 'outline'}
                    size="sm"
                    className="rounded-full h-7 text-xs"
                    onClick={() => setActiveFilter('all')}
                >
                    {t('results.all')}
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
                        <span className="ml-1">{t(config.labelKey)}</span>
                        {fileTypeCounts[type] > 0 && (
                            <span className="ml-1 text-xs opacity-70">{fileTypeCounts[type]}</span>
                        )}
                    </Button>
                ))}
                <div className="w-px h-5 bg-border"/>
                {([
                    ['wasted', 'results.sort.wasted'],
                    ['size', 'results.sort.size'],
                    ['count', 'results.sort.count'],
                    ['hash', 'results.sort.hash'],
                ] as const).map(([key, labelKey]) => (
                    <Button
                        key={key}
                        variant={sortBy === key ? 'default' : 'outline'}
                        size="sm"
                        className="rounded-full h-7 text-xs"
                        onClick={() => onSortChange(key)}
                    >
                        {t(labelKey)}
                    </Button>
                ))}
            </div>

            {/* Loading indicator */}
            {loading && (
                <div className="text-center text-muted-foreground py-4">
                    {t('results.loading')}
                </div>
            )}

            {/* Groups */}
            {!loading && displayGroups.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                    {activeFilter === 'all' ? t('results.noDuplicates') : t('results.noTypeFiles', {type: t(FILE_TYPES[activeFilter]?.labelKey || 'results.other')})}
                </div>
            ) : (
                displayGroups.map((group, index) => {
                    const allSelected = group.files.every(f => selectedPaths.has(f.path))
                    const wasted = (group.files.length - 1) * group.size
                    const groupType = getFileType(group.files[0]?.name || '')
                    const globalIndex = (pageInfo.page - 1) * pageInfo.pageSize + index + 1

                    return (
                        <div key={group.hash} className="rounded-lg border bg-card mb-3 overflow-hidden">
                            <div className="flex items-center justify-between p-3 bg-muted/30 border-b">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <span className="text-muted-foreground text-xs font-semibold">#{globalIndex}</span>
                                    <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono max-w-[260px] truncate" title={getGroupLabel(group)}>
                                        {getGroupLabel(group)}
                                    </code>
                                    <span className="text-xs text-muted-foreground">{formatSize(group.size)}</span>
                                    <Badge variant="secondary" className="text-xs">
                                        {t('results.fileCount', {count: group.files.length})}
                                    </Badge>
                                    <Badge variant="outline" className="text-xs text-orange-500">
                                        {t('results.wasted', {size: formatSize(wasted)})}
                                    </Badge>
                                    <Badge variant="outline" className="text-xs">
                                        {FILE_TYPES[groupType]?.icon}
                                        <span className="ml-1">{t(FILE_TYPES[groupType]?.labelKey || 'results.other')}</span>
                                    </Badge>
                                </div>
                                <Button
                                    variant={allSelected ? 'default' : 'outline'}
                                    size="sm"
                                    className="text-xs h-7"
                                    onClick={() => onToggleGroup(group)}
                                >
                                    {allSelected ? t('results.groupDeselectAll') : t('results.groupSelectAll')}
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
                                            {isPreviewable(file) && !brokenPreviewPaths[file.path] && (
                                                <div className="mr-3 h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-muted/40">
                                                    {getFileType(file.name) === 'image' ? (
                                                        <img
                                                            src={toFileUrl(file.path)}
                                                            alt={file.name}
                                                            className="h-full w-full object-cover"
                                                            loading="lazy"
                                                            onError={() => setBrokenPreviewPaths(prev => ({...prev, [file.path]: true}))}
                                                        />
                                                    ) : getFileType(file.name) === 'video' ? (
                                                        <video
                                                            src={toFileUrl(file.path)}
                                                            className="h-full w-full object-cover"
                                                            muted
                                                            playsInline
                                                            preload="metadata"
                                                            onError={() => setBrokenPreviewPaths(prev => ({...prev, [file.path]: true}))}
                                                        />
                                                    ) : (
                                                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                                                            <Music className="h-4 w-4"/>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm truncate">{file.name}</div>
                                                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                                    <span className="truncate flex-1" title={file.path}>{folder}</span>
                                                    <span className="shrink-0">{formatSize(file.size)}</span>
                                                    <span className="shrink-0">{file.modTime}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {isPreviewable(file) && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-muted-foreground hover:text-primary"
                                                        onClick={() => setPreviewFile(file)}
                                                        title={t('results.preview')}
                                                    >
                                                        <Eye className="h-3.5 w-3.5"/>
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                                                    onClick={() => OpenFileLocation(file.path).catch(() => {})}
                                                    title={t('results.openLocation')}
                                                >
                                                    <FolderOpen className="h-3.5 w-3.5"/>
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                                                    onClick={() => OpenFile(file.path).catch(() => {})}
                                                    title={t('results.openFile')}
                                                >
                                                    <ExternalLink className="h-3.5 w-3.5"/>
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                                    onClick={() => onDeleteFile(file.path)}
                                                    title={t('results.deleteFile')}
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

            <Dialog open={!!previewFile} onOpenChange={(open) => !open && setPreviewFile(null)}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>{previewFile?.name || t('results.preview')}</DialogTitle>
                    </DialogHeader>
                    {previewFile && renderPreviewContent(previewFile)}
                </DialogContent>
            </Dialog>
        </div>
    )
}

export default Results
