import {useState, useEffect, useCallback} from 'react'
import {StartScan, DeleteFiles, PauseScan, ResumeScan, CancelScan, ExportFromStore, GetScanStats, GetGroupsPage, CheckForUpdate, LoadScan} from '../wailsjs/go/main/App'
import {EventsOn} from '../wailsjs/runtime/runtime'
import {ScanProgress} from './types'
import {main} from '../wailsjs/go/models'
import {Button} from '@/components/ui/button'
import {Switch} from '@/components/ui/switch'
import {Sun, Moon, FolderPlus, Download, Settings as SettingsIcon, History} from 'lucide-react'
import {useI18n} from './i18n/context'
import FolderPanel from './components/FolderPanel'
import Results from './components/Results'
import ActionBar from './components/ActionBar'
import ConfirmDialog from './components/ConfirmDialog'
import FolderBrowser from './components/FolderBrowser'
import Settings, {ScanSettings} from './components/Settings'
import UpdateBanner from './components/UpdateBanner'
import ScanHistory from './components/ScanHistory'

const STORAGE_KEY_FOLDERS = 'duplicate-scanner-folders'
const STORAGE_KEY_BROWSER_PATH = 'duplicate-scanner-browser-path'
const STORAGE_KEY_THEME = 'duplicate-scanner-theme'
const STORAGE_KEY_SETTINGS = 'duplicate-scanner-settings'

const DEFAULT_SETTINGS: ScanSettings = {
    minSizeBytes: 0,
    fileTypes: [],
    excludeFolders: [],
    excludeExtensions: [],
    scanHiddenFiles: true,
}

function loadSettings(): ScanSettings {
    try {
        const stored = localStorage.getItem(STORAGE_KEY_SETTINGS)
        return stored ? {...DEFAULT_SETTINGS, ...JSON.parse(stored)} : DEFAULT_SETTINGS
    } catch {
        return DEFAULT_SETTINGS
    }
}

function loadFolders(): string[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY_FOLDERS)
        return stored ? JSON.parse(stored) : []
    } catch {
        return []
    }
}

function App() {
    const {t} = useI18n()
    const [theme, setTheme] = useState<'dark' | 'light'>(() => {
        const stored = localStorage.getItem(STORAGE_KEY_THEME)
        return (stored as 'dark' | 'light') || 'dark'
    })
    const [folders, setFolders] = useState<string[]>(loadFolders)
    const [scanStats, setScanStats] = useState<main.ScanStats | null>(null)
    const [groups, setGroups] = useState<main.DuplicateGroup[]>([])
    const [pageInfo, setPageInfo] = useState({page: 1, pageSize: 50, total: 0, totalPages: 0})
    const [sortBy, setSortBy] = useState('wasted')
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
    const [scanning, setScanning] = useState(false)
    const [scanPaused, setScanPaused] = useState(false)
    const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
    const [settings, setSettings] = useState<ScanSettings>(loadSettings)
    const [showSettings, setShowSettings] = useState(false)
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [showBrowser, setShowBrowser] = useState(false)
    const [browserPath, setBrowserPath] = useState(() => localStorage.getItem(STORAGE_KEY_BROWSER_PATH) || '')
    const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null)
    const [loading, setLoading] = useState(false)
    const [updateInfo, setUpdateInfo] = useState<main.UpdateInfo | null>(null)
    const [showHistory, setShowHistory] = useState(false)

    // Listen for scan progress events
    useEffect(() => {
        const unsubscribe = EventsOn('scan:progress', (progress: ScanProgress) => {
            setScanProgress(progress)
            if (progress.status === 'completed') {
                setScanning(false)
                setScanPaused(false)
            } else if (progress.status === 'cancelled') {
                setScanning(false)
                setScanPaused(false)
                setScanProgress(null)
            } else if (progress.status === 'paused') {
                setScanPaused(true)
            } else if (progress.status === 'scanning') {
                setScanPaused(false)
            }
        })
        return () => {
            unsubscribe()
        }
    }, [])

    // Theme effect
    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark')
        localStorage.setItem(STORAGE_KEY_THEME, theme)
    }, [theme])

    // Check for updates on startup
    useEffect(() => {
        const dismissed = localStorage.getItem('update-dismissed-version')
        CheckForUpdate().then((info: main.UpdateInfo) => {
            if (info.hasUpdate && info.version !== dismissed) {
                setUpdateInfo(info)
            }
        }).catch(() => {})
    }, [])

    // Persist folders
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(folders))
    }, [folders])

    // Persist settings
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings))
    }, [settings])

    // Load groups when page, sort, or search changes
    const loadGroups = useCallback(async () => {
        if (!scanStats || scanStats.totalGroups === 0) return
        setLoading(true)
        try {
            const pageData = await GetGroupsPage(pageInfo.page, pageInfo.pageSize, sortBy, searchQuery) as main.GroupPage
            setGroups(pageData.groups)
            setPageInfo(prev => ({
                ...prev,
                total: pageData.total,
                totalPages: pageData.totalPages
            }))
        } catch (err) {
            console.error('GetGroupsPage error:', err)
        } finally {
            setLoading(false)
        }
    }, [scanStats, pageInfo.page, pageInfo.pageSize, sortBy, searchQuery])

    useEffect(() => {
        loadGroups()
    }, [loadGroups])

    const toggleTheme = () => {
        setTheme(prev => prev === 'dark' ? 'light' : 'dark')
    }

    const handleAddFolder = () => {
        setShowBrowser(true)
    }

    const handleBrowserConfirm = (path: string) => {
        setShowBrowser(false)
        if (path) {
            setBrowserPath(path)
            localStorage.setItem(STORAGE_KEY_BROWSER_PATH, path)
            if (!folders.includes(path)) {
                setFolders([...folders, path])
            }
        }
    }

    const handleRemoveFolder = (index: number) => {
        setFolders(folders.filter((_, i) => i !== index))
    }

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({message, type})
        setTimeout(() => setToast(null), 3000)
    }

    const handleDeleteFile = async (path: string) => {
        try {
            const failed = await DeleteFiles([path])
            if (failed.length > 0) {
                showToast(t('app.toast.deleteFail'), 'error')
                return
            }
            showToast(t('app.toast.deleteSuccess'))
            await loadGroups()
            setSelectedPaths(prev => {
                const next = new Set(prev)
                next.delete(path)
                return next
            })
        } catch (err) {
            console.error('DeleteFiles error:', err)
            showToast(t('app.toast.deleteFail'), 'error')
        }
    }

    const handleScan = async () => {
        if (folders.length === 0) return
        setScanning(true)
        setScanPaused(false)
        setScanProgress(null)
        setScanStats(null)
        setGroups([])
        setPageInfo(prev => ({...prev, page: 1}))
        setSelectedPaths(new Set())
        try {
            const result = await StartScan(folders, settings.minSizeBytes, settings.excludeFolders, settings.excludeExtensions, settings.scanHiddenFiles) as main.ScanResult
            const stats = await GetScanStats() as main.ScanStats
            setScanStats(stats)
            showToast(t('app.toast.scanDone', {count: result.totalDuplicates}))
        } catch (err: any) {
            const msg = err?.message || ''
            if (msg.includes('cancel') || msg.includes('context')) {
                showToast(t('app.toast.scanCancelled'))
            } else {
                console.error('StartScan error:', err)
                showToast(t('app.toast.scanFail'), 'error')
            }
        } finally {
            setScanning(false)
            setScanPaused(false)
        }
    }

    const handlePauseScan = async () => {
        await PauseScan()
    }

    const handleResumeScan = async () => {
        await ResumeScan()
    }

    const handleCancelScan = async () => {
        await CancelScan()
    }

    const handleExportResults = async () => {
        if (!scanStats) return
        try {
            const path = await ExportFromStore()
            showToast(t('app.toast.exportSuccess', {path}))
        } catch (err) {
            console.error('ExportFromStore error:', err)
            showToast(t('app.toast.exportFail'), 'error')
        }
    }

    const handleToggleFile = (path: string) => {
        setSelectedPaths(prev => {
            const next = new Set(prev)
            if (next.has(path)) next.delete(path)
            else next.add(path)
            return next
        })
    }

    const handleToggleGroup = (group: main.DuplicateGroup) => {
        const allSelected = group.files.every(f => selectedPaths.has(f.path))
        setSelectedPaths(prev => {
            const next = new Set(prev)
            if (allSelected) group.files.forEach(f => next.delete(f.path))
            else group.files.forEach(f => next.add(f.path))
            return next
        })
    }

    const handleSelectFolderDuplicates = (folderPrefix: string) => {
        if (groups.length === 0) return
        setSelectedPaths(prev => {
            const next = new Set(prev)
            groups.forEach(group => {
                group.files.forEach(file => {
                    if (file.path.startsWith(folderPrefix)) next.add(file.path)
                })
            })
            return next
        })
    }

    const handleSmartSelect = () => {
        if (groups.length === 0) return
        setSelectedPaths(prev => {
            const next = new Set(prev)
            groups.forEach(group => {
                // Select all files except the one with the latest modTime (keep the newest)
                const sorted = [...group.files].sort((a, b) => b.modTime.localeCompare(a.modTime))
                sorted.slice(1).forEach(f => next.add(f.path))
            })
            return next
        })
    }

    const handleDeselectAll = () => setSelectedPaths(new Set())

    const handleSelectAll = useCallback(() => {
        if (groups.length === 0) return
        setSelectedPaths(prev => {
            const next = new Set(prev)
            groups.forEach(group => {
                group.files.forEach(file => {
                    if (!next.has(file.path)) {
                        next.add(file.path)
                    }
                })
            })
            return next
        })
    }, [groups])

    const handleDismissUpdate = () => {
        if (updateInfo) {
            localStorage.setItem('update-dismissed-version', updateInfo.version)
        }
        setUpdateInfo(null)
    }

    const handleLoadScan = async (scanId: number) => {
        setShowHistory(false)
        try {
            const stats = await LoadScan(scanId) as main.ScanStats
            setScanStats(stats)
            setPageInfo(prev => ({...prev, page: 1}))
            setSelectedPaths(new Set())
            showToast(t('app.toast.scanLoaded'))
        } catch (err) {
            console.error('LoadScan error:', err)
            showToast(t('app.toast.scanLoadFail'), 'error')
        }
    }

    const handleDelete = () => {
        if (selectedPaths.size === 0) return
        setConfirmDelete(true)
    }

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in an input/textarea
            const target = e.target as HTMLElement
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return
            }

            // Delete key - delete selected files
            if (e.key === 'Delete' && selectedPaths.size > 0) {
                e.preventDefault()
                handleDelete()
            }

            // Ctrl+A - select all files
            if (e.ctrlKey && e.key === 'a') {
                e.preventDefault()
                handleSelectAll()
            }

            // Escape - deselect all
            if (e.key === 'Escape') {
                e.preventDefault()
                handleDeselectAll()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [selectedPaths, handleSelectAll, handleDelete, handleDeselectAll])

    const handleConfirmDelete = async () => {
        setConfirmDelete(false)
        const paths = Array.from(selectedPaths)
        try {
            const failed = await DeleteFiles(paths)
            const successCount = paths.length - failed.length
            if (successCount > 0) {
                showToast(t('app.toast.batchDeleteSuccess', {count: successCount}))
            }
            if (failed.length > 0) {
                showToast(t('app.toast.batchDeleteFail', {count: failed.length}), 'error')
            }
            await loadGroups()
            const stats = await GetScanStats() as main.ScanStats
            setScanStats(stats)
            setSelectedPaths(new Set())
        } catch (err) {
            console.error('DeleteFiles error:', err)
            showToast(t('app.toast.deleteFail'), 'error')
        }
    }

    const totalWasted = scanStats?.totalWasted ?? 0

    return (
        <div className="h-screen flex flex-col overflow-hidden">
            {updateInfo && updateInfo.hasUpdate && (
                <UpdateBanner
                    version={updateInfo.version}
                    releaseURL={updateInfo.releaseURL}
                    onDismiss={handleDismissUpdate}
                />
            )}
            <div className="flex flex-1 overflow-hidden bg-background">
            {/* Sidebar */}
            <div className="w-64 min-w-[260px] border-r bg-card flex flex-col">
                <div className="flex items-center justify-between p-4 border-b">
                    <h3 className="text-sm font-semibold">{t('app.folders')}</h3>
                    <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setShowSettings(true)}>
                            <SettingsIcon className="h-4 w-4"/>
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleAddFolder}>
                            <FolderPlus className="h-4 w-4 mr-1"/>
                            {t('app.add')}
                        </Button>
                    </div>
                </div>
                <FolderPanel
                    folders={folders}
                    scanning={scanning}
                    scanPaused={scanPaused}
                    scanProgress={scanProgress}
                    onRemoveFolder={handleRemoveFolder}
                    onScan={handleScan}
                    onPauseScan={handlePauseScan}
                    onResumeScan={handleResumeScan}
                    onCancelScan={handleCancelScan}
                />
                <div className="p-3 border-t flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                        {theme === 'dark' ? <Moon className="h-3 w-3"/> : <Sun className="h-3 w-3"/>}
                        {theme === 'dark' ? t('app.theme.dark') : t('app.theme.light')}
                    </span>
                    <Switch checked={theme === 'dark'} onCheckedChange={toggleTheme}/>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header with stats */}
                <div className="border-b bg-card px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        {scanStats && (
                            <>
                                <span className="text-sm text-muted-foreground">
                                    {t('app.scannedFiles')} <strong className="text-foreground">{scanStats.totalFiles}</strong>
                                </span>
                                <span className="text-sm text-muted-foreground">
                                    {t('app.duplicateFiles')} <strong className="text-orange-500">{scanStats.totalDuplicates}</strong>
                                </span>
                                <span className="text-sm text-muted-foreground">
                                    {t('app.wastedSpace')} <strong className="text-red-500">{formatBytes(scanStats.totalWasted)}</strong>
                                </span>
                                <span className="text-sm text-muted-foreground">
                                    {t('app.duplicateGroups')} <strong className="text-foreground">{scanStats.totalGroups}</strong>
                                </span>
                                {scanStats.scanDuration && (
                                    <span className="text-sm text-muted-foreground">
                                        {t('app.duration')} <strong className="text-foreground">{scanStats.scanDuration}</strong>
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                    {scanStats && scanStats.totalGroups > 0 && (
                        <div className="flex gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setShowHistory(true)}>
                                <History className="h-4 w-4 mr-1"/>
                                {t('app.history')}
                            </Button>
                            <Button size="sm" variant="outline" onClick={handleExportResults}>
                                <Download className="h-4 w-4 mr-1"/>
                                {t('app.exportCsv')}
                            </Button>
                        </div>
                    )}
                </div>

                <Results
                    groups={groups}
                    selectedPaths={selectedPaths}
                    allowedTypes={settings.fileTypes}
                    pageInfo={pageInfo}
                    sortBy={sortBy}
                    searchQuery={searchQuery}
                    loading={loading}
                    onToggle={handleToggleFile}
                    onToggleGroup={handleToggleGroup}
                    onDeleteFile={handleDeleteFile}
                    onPageChange={(page) => setPageInfo(prev => ({...prev, page}))}
                    onSortChange={setSortBy}
                    onSearchChange={setSearchQuery}
                />
                <ActionBar
                    selectedCount={selectedPaths.size}
                    totalWasted={totalWasted}
                    folders={folders}
                    groups={groups}
                    onSelectFolderDuplicates={handleSelectFolderDuplicates}
                    onSmartSelect={handleSmartSelect}
                    onDelete={handleDelete}
                    onDeselectAll={handleDeselectAll}
                />
            </div>

            {/* Confirm Dialog */}
            <ConfirmDialog
                open={confirmDelete}
                count={selectedPaths.size}
                onConfirm={handleConfirmDelete}
                onCancel={() => setConfirmDelete(false)}
            />

            {/* Settings Dialog */}
            <Settings
                open={showSettings}
                settings={settings}
                onConfirm={(s) => {setSettings(s); setShowSettings(false)}}
                onCancel={() => setShowSettings(false)}
            />

            {/* Folder Browser */}
            {showBrowser && (
                <FolderBrowser
                    initialPath={browserPath}
                    onConfirm={handleBrowserConfirm}
                    onCancel={() => setShowBrowser(false)}
                />
            )}

            {/* Scan History */}
            <ScanHistory
                open={showHistory}
                onClose={() => setShowHistory(false)}
                onLoad={handleLoadScan}
            />

            {/* Toast */}
            {toast && (
                <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-lg text-sm text-white z-50 animate-in fade-in slide-in-from-bottom-2 ${
                    toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
                }`}>
                    {toast.message}
                </div>
            )}
            </div>
        </div>
    )
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export default App
