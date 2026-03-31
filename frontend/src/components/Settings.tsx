import {useState} from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'
import {Checkbox} from '@/components/ui/checkbox'
import {FolderOpen, Trash2, Plus} from 'lucide-react'
import {useI18n} from '../i18n/context'

export interface ScanSettings {
    minSizeBytes: number
    fileTypes: string[]
    excludeFolders: string[]
    excludeExtensions: string[]
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const
type SizeUnit = typeof SIZE_UNITS[number]

function bytesToUnit(bytes: number): {value: number; unit: SizeUnit} {
    if (bytes >= 1024 * 1024 * 1024) return {value: bytes / (1024 * 1024 * 1024), unit: 'GB'}
    if (bytes >= 1024 * 1024) return {value: bytes / (1024 * 1024), unit: 'MB'}
    if (bytes >= 1024) return {value: bytes / 1024, unit: 'KB'}
    return {value: 0, unit: 'MB'}
}

function unitToBytes(value: number, unit: SizeUnit): number {
    const multipliers: Record<SizeUnit, number> = {B: 1, KB: 1024, MB: 1024*1024, GB: 1024*1024*1024}
    return Math.round(value * multipliers[unit])
}

interface FileTypeOption {
    key: string
    labelKey: string
    extensions: string[]
}

const FILE_TYPE_OPTIONS: FileTypeOption[] = [
    {key: 'video', labelKey: 'results.video', extensions: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm']},
    {key: 'image', labelKey: 'results.image', extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg']},
    {key: 'audio', labelKey: 'results.audio', extensions: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a']},
    {key: 'document', labelKey: 'results.document', extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt']},
    {key: 'archive', labelKey: 'results.archive', extensions: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso']},
]

interface SettingsProps {
    open: boolean
    settings: ScanSettings
    onConfirm: (settings: ScanSettings) => void
    onCancel: () => void
}

function Settings({open, settings, onConfirm, onCancel}: SettingsProps) {
    const {t, lang, setLang} = useI18n()
    const init = bytesToUnit(settings.minSizeBytes)
    const [minSizeValue, setMinSizeValue] = useState(init.value)
    const [minSizeUnit, setMinSizeUnit] = useState<SizeUnit>(init.unit)
    const [fileTypes, setFileTypes] = useState<string[]>(settings.fileTypes)
    const [excludeFolders, setExcludeFolders] = useState<string[]>(settings.excludeFolders)
    const [newExclude, setNewExclude] = useState('')
    const [excludeExtensions, setExcludeExtensions] = useState<string[]>(settings.excludeExtensions)
    const [newExt, setNewExt] = useState('')

    const handleSave = () => {
        onConfirm({
            minSizeBytes: unitToBytes(minSizeValue || 0, minSizeUnit),
            fileTypes,
            excludeFolders,
            excludeExtensions,
        })
    }

    const toggleFileType = (key: string) => {
        setFileTypes(prev =>
            prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
        )
    }

    const addExcludeFolder = () => {
        const trimmed = newExclude.trim()
        if (trimmed && !excludeFolders.includes(trimmed)) {
            setExcludeFolders([...excludeFolders, trimmed])
            setNewExclude('')
        }
    }

    const addExcludeExtension = () => {
        let trimmed = newExt.trim().toLowerCase()
        if (!trimmed) return
        if (!trimmed.startsWith('.')) trimmed = '.' + trimmed
        if (!excludeExtensions.includes(trimmed)) {
            setExcludeExtensions([...excludeExtensions, trimmed])
            setNewExt('')
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
            <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{t('settings.title')}</DialogTitle>
                </DialogHeader>

                <div className="space-y-5 py-2 overflow-y-auto flex-1 min-h-0">
                    {/* Language */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">{t('settings.language')}</label>
                        <div className="flex gap-2">
                            <Button
                                variant={lang === 'zh-CN' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setLang('zh-CN')}
                            >
                                中文
                            </Button>
                            <Button
                                variant={lang === 'en-US' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setLang('en-US')}
                            >
                                English
                            </Button>
                        </div>
                    </div>

                    {/* Min file size */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">{t('settings.minSize')}</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="0"
                                className="h-9 w-24 px-3 text-sm rounded-md border bg-background"
                                value={minSizeValue || ''}
                                placeholder="0"
                                onChange={e => setMinSizeValue(parseFloat(e.target.value) || 0)}
                            />
                            <select
                                className="h-9 px-3 text-sm rounded-md border bg-background"
                                value={minSizeUnit}
                                onChange={e => setMinSizeUnit(e.target.value as SizeUnit)}
                            >
                                {SIZE_UNITS.map(u => (
                                    <option key={u} value={u}>{u}</option>
                                ))}
                            </select>
                            <span className="text-xs text-muted-foreground">{t('settings.minSizeHint')}</span>
                        </div>
                    </div>

                    {/* File types */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">{t('settings.fileTypes')}</label>
                        <div className="flex flex-wrap gap-3">
                            {FILE_TYPE_OPTIONS.map(opt => (
                                <label
                                    key={opt.key}
                                    className="flex items-center gap-2 text-sm cursor-pointer select-none"
                                >
                                    <Checkbox
                                        checked={fileTypes.includes(opt.key)}
                                        onCheckedChange={() => toggleFileType(opt.key)}
                                    />
                                    {t(opt.labelKey)}
                                    <span className="text-xs text-muted-foreground">
                                        {opt.extensions.slice(0, 3).join(' ')}
                                    </span>
                                </label>
                            ))}
                        </div>
                        <div className="flex gap-2 mt-2">
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setFileTypes(FILE_TYPE_OPTIONS.map(o => o.key))}>
                                {t('settings.selectAll')}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setFileTypes([])}>
                                {t('settings.deselectAll')}
                            </Button>
                        </div>
                    </div>

                    {/* Exclude folders */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">{t('settings.excludeFolders')}</label>
                        <div className="text-xs text-muted-foreground mb-2">
                            {t('settings.excludeFoldersHint')}
                        </div>
                        <div className="flex gap-2 mb-2">
                            <input
                                type="text"
                                placeholder={t('settings.excludeFoldersPlaceholder')}
                                className="flex-1 h-9 px-3 text-sm rounded-md border bg-background"
                                value={newExclude}
                                onChange={e => setNewExclude(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addExcludeFolder()}
                            />
                            <Button size="sm" variant="outline" onClick={addExcludeFolder}>
                                <Plus className="h-4 w-4"/>
                            </Button>
                        </div>
                        {excludeFolders.length > 0 && (
                            <div className="max-h-32 overflow-y-auto space-y-1 rounded-md border p-2">
                                {excludeFolders.map((folder, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs group">
                                        <span className="flex items-center gap-1 truncate">
                                            <FolderOpen className="h-3 w-3 text-muted-foreground shrink-0"/>
                                            {folder}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-5 w-5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                                            onClick={() => setExcludeFolders(excludeFolders.filter((_, j) => j !== i))}
                                        >
                                            <Trash2 className="h-3 w-3"/>
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Exclude extensions */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">{t('settings.excludeExtensions')}</label>
                        <div className="flex gap-2 mb-2">
                            <input
                                type="text"
                                placeholder={t('settings.excludeExtensionsPlaceholder')}
                                className="flex-1 h-9 px-3 text-sm rounded-md border bg-background"
                                value={newExt}
                                onChange={e => setNewExt(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addExcludeExtension()}
                            />
                            <Button size="sm" variant="outline" onClick={addExcludeExtension}>
                                <Plus className="h-4 w-4"/>
                            </Button>
                        </div>
                        {excludeExtensions.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 rounded-md border p-2">
                                {excludeExtensions.map((ext, i) => (
                                    <span
                                        key={i}
                                        className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-md group cursor-default"
                                    >
                                        {ext}
                                        <button
                                            className="text-muted-foreground hover:text-destructive"
                                            onClick={() => setExcludeExtensions(excludeExtensions.filter((_, j) => j !== i))}
                                        >
                                            ×
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>{t('settings.cancel')}</Button>
                    <Button onClick={handleSave}>{t('settings.save')}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default Settings
