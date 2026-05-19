import {useState, useEffect, useCallback, useRef} from 'react'
import {StartScan, DeleteFiles, PauseScan, ResumeScan, CancelScan, ExportFromStore, GetScanStats, GetGroupsPage, GetGroupsPageByScanID, GetSpaceAnalysis, CheckForUpdate, LoadScan, ClearAllCache} from '../wailsjs/go/main/App'
import {EventsOn} from '../wailsjs/runtime/runtime'
import {ScanProgress} from './types'
import {main} from '../wailsjs/go/models'
import {Button} from '@/components/ui/button'
import {Switch} from '@/components/ui/switch'
import {Sun, Moon, FolderPlus, Download, Settings as SettingsIcon, History, BarChart3} from 'lucide-react'
import {useI18n} from './i18n/context'
import FolderPanel from './components/FolderPanel'
import Results from './components/Results'
import ActionBar from './components/ActionBar'
import ConfirmDialog from './components/ConfirmDialog'
import FolderBrowser from './components/FolderBrowser'
import Settings, {ScanSettings, DEFAULT_SCAN_SETTINGS} from './components/Settings'
import UpdateBanner from './components/UpdateBanner'
import ScanHistory from './components/ScanHistory'
import SpaceAnalysis from './components/SpaceAnalysis'

const STORAGE_KEY_FOLDERS = 'duplicate-scanner-folders'
const STORAGE_KEY_BROWSER_PATH = 'duplicate-scanner-browser-path'
const STORAGE_KEY_THEME = 'duplicate-scanner-theme'
const STORAGE_KEY_SETTINGS = 'duplicate-scanner-settings'
const STORAGE_KEY_UPDATE_DISMISSED = 'update-dismissed-version'

const FILE_TYPE_EXTENSION_MAP: Record<string, string[]> = {
    video: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'],
    image: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'],
    audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'],
    document: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt'],
    archive: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso'],
}

const startScanWithOptions = StartScan as unknown as (
    folders: string[],
    minSize: number,
    includeExtensions: string[],
    excludeFolders: string[],
    excludeExtensions: string[],
    scanHiddenFiles: boolean,
    symlinkHandling: string,
    hashAlgorithm: string,
    useSamplingHash: boolean,
    scanMode: string,
) => Promise<main.ScanResult>

function loadSettings(): ScanSettings {
    try {
        const stored = localStorage.getItem(STORAGE_KEY_SETTINGS)
        return stored ? {...DEFAULT_SCAN_SETTINGS, ...JSON.parse(stored)} : DEFAULT_SCAN_SETTINGS
    } catch {
        return DEFAULT_SCAN_SETTINGS
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

function isScanCancelledError(err: unknown, cancelRequested: boolean): boolean {
    if (cancelRequested) {
        return true
    }

    const message = typeof err === 'string'
        ? err
        : err && typeof err === 'object' && 'message' in err
            ? String((err as {message?: unknown}).message || '')
            : String(err || '')

    const normalized = message.toLowerCase()
    return normalized.includes('cancel') || normalized.includes('canceled') || normalized.includes('cancelled') || normalized.includes('context')
}

function App() {
    const {t} = useI18n()
    const cancelRequestedRef = useRef(false)
    const [isFirstRun] = useState(() => !localStorage.getItem(STORAGE_KEY_SETTINGS))
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
    const [scanLogs, setScanLogs] = useState<string[]>([])
    const [settings, setSettings] = useState<ScanSettings>(loadSettings)
    const [showSettings, setShowSettings] = useState(false)
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [showBrowser, setShowBrowser] = useState(false)
    const [browserPath, setBrowserPath] = useState(() => localStorage.getItem(STORAGE_KEY_BROWSER_PATH) || '')
    const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null)
    const [loading, setLoading] = useState(false)
    const [updateInfo, setUpdateInfo] = useState<main.UpdateInfo | null>(null)
    const [showHistory, setShowHistory] = useState(false)
    const [showAnalysis, setShowAnalysis] = useState(false)
    const [spaceAnalysis, setSpaceAnalysis] = useState<main.SpaceAnalysisItem[]>([])

    // Listen for scan progress events
    useEffect(() => {
        const unsubscribe = EventsOn('scan:progress', (progress: ScanProgress) => {
            setScanProgress(progress)
            const logLine = progress.message || progress.currentFile
            if (logLine) {
                setScanLogs(prev => {
                    if (prev[prev.length - 1] === logLine) {
                        return prev
                    }
                    return [...prev, logLine].slice(-8)
                })
            }
            if (progress.status === 'completed') {
                cancelRequestedRef.current = false
                setScanning(false)
                setScanPaused(false)
            } else if (progress.status === 'cancelled') {
                cancelRequestedRef.current = false
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

    useEffect(() => {
        if (isFirstRun) {
            setShowSettings(true)
        }
    }, [isFirstRun])

    // Check for updates on startup
    useEffect(() => {
        const dismissed = localStorage.getItem(STORAGE_KEY_UPDATE_DISMISSED)
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
    const loadGroups = useCallback(async (statsOverride?: main.ScanStats | null) => {
        const effectiveStats = statsOverride ?? scanStats
        if (!effectiveStats || effectiveStats.totalGroups === 0) {
            setGroups([])
            setPageInfo(prev => ({...prev, page: 1, total: 0, totalPages: 0}))
            return
        }
        setLoading(true)
        try {
            const requestedPage = Math.min(
                pageInfo.page,
                Math.max(1, Math.ceil(effectiveStats.totalGroups / pageInfo.pageSize))
            )
            const pageData = await GetGroupsPage(requestedPage, pageInfo.pageSize, sortBy, searchQuery) as main.GroupPage
            setGroups(pageData.groups || [])
            setPageInfo(prev => ({
                ...prev,
                page: requestedPage,
                total: pageData.total,
                totalPages: pageData.totalPages
            }))
        } catch (err) {
            console.error('GetGroupsPage error:', err)
        } finally {
            setLoading(false)
        }
    }, [scanStats, pageInfo.page, pageInfo.pageSize, sortBy, searchQuery])

    const loadSpaceAnalysis = useCallback(async () => {
        try {
            const items = await GetSpaceAnalysis() as main.SpaceAnalysisItem[]
            setSpaceAnalysis(items)
        } catch (err) {
            console.error('GetSpaceAnalysis error:', err)
            setSpaceAnalysis([])
        }
    }, [])

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

    const resetViewState = useCallback(() => {
        setScanStats(null)
        setGroups([])
        setPageInfo(prev => ({...prev, page: 1, total: 0, totalPages: 0}))
        setSelectedPaths(new Set())
        setSearchQuery('')
        setSortBy('wasted')
        setSpaceAnalysis([])
        setScanProgress(null)
        setScanLogs([])
    }, [])

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({message, type})
        setTimeout(() => setToast(null), 3000)
    }

    const handleResetSettings = useCallback(() => {
        setSettings(DEFAULT_SCAN_SETTINGS)
        showToast(t('app.toast.settingsReset'))
    }, [t])

    const handleClearAllCache = useCallback(async () => {
        try {
            await ClearAllCache()
            localStorage.removeItem(STORAGE_KEY_FOLDERS)
            localStorage.removeItem(STORAGE_KEY_BROWSER_PATH)
            localStorage.removeItem(STORAGE_KEY_UPDATE_DISMISSED)
            setFolders([])
            setBrowserPath('')
            resetViewState()
            showToast(t('app.toast.cacheCleared'))
        } catch (err) {
            console.error('ClearAllCache error:', err)
            showToast(t('app.toast.cacheClearFail'), 'error')
        }
    }, [resetViewState, t])

    const handleDeleteFile = async (path: string) => {
        try {
            const failed = await DeleteFiles([path], settings.deleteMode)
            if (failed.length > 0) {
                showToast(t('app.toast.deleteFail'), 'error')
                return
            }
            showToast(t('app.toast.deleteSuccess'))
            try {
                const stats = await GetScanStats() as main.ScanStats
                setScanStats(stats)
                await loadGroups(stats)
            } catch (statsErr) {
                console.error('GetScanStats error:', statsErr)
            }
            await loadSpaceAnalysis()
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
        cancelRequestedRef.current = false
        const includeExtensions = Array.from(new Set(settings.fileTypes.flatMap(type => FILE_TYPE_EXTENSION_MAP[type] || [])))
        setScanning(true)
        setScanPaused(false)
        setScanProgress(null)
        setScanLogs([])
        setScanStats(null)
        setGroups([])
        setPageInfo(prev => ({...prev, page: 1}))
        setSelectedPaths(new Set())
        try {
            const result = await startScanWithOptions(
                folders,
                settings.minSizeBytes,
                includeExtensions,
                settings.excludeFolders,
                settings.excludeExtensions,
                settings.scanHiddenFiles,
                settings.symlinkHandling,
                settings.hashAlgorithm,
                settings.useSamplingHash,
                settings.scanMode,
            ) as main.ScanResult

            const duplicateGroups = result.duplicateGroups || []

            const immediateStats = main.ScanStats.createFrom({
                totalFiles: result.totalFiles,
                totalGroups: duplicateGroups.length,
                totalDuplicates: result.totalDuplicates,
                totalWasted: result.totalWasted,
                scanDuration: result.scanDuration,
            })

            setScanStats(immediateStats)
            setGroups(duplicateGroups)
            setPageInfo(prev => ({
                ...prev,
                page: 1,
                total: duplicateGroups.length,
                totalPages: Math.max(1, Math.ceil(duplicateGroups.length / prev.pageSize)),
            }))

            try {
                const stats = await GetScanStats() as main.ScanStats
                setScanStats(stats)
            } catch (statsErr) {
                console.error('GetScanStats error:', statsErr)
            }

            await loadSpaceAnalysis()

            if (result.totalDuplicates === 0) {
                showToast(t('app.toast.noDuplicates'))
            } else {
                showToast(t('app.toast.scanDone', {count: result.totalDuplicates}))
            }
        } catch (err: any) {
            if (isScanCancelledError(err, cancelRequestedRef.current)) {
                showToast(t('app.toast.scanCancelled'))
            } else {
                console.error('StartScan error:', err)
                showToast(t('app.toast.scanFail'), 'error')
            }
        } finally {
            cancelRequestedRef.current = false
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
        cancelRequestedRef.current = true
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

    const handleSelectAll = useCallback(async () => {
        if (groups.length === 0) return
        setLoading(true)
        try {
            const next = new Set(selectedPaths)
            const pagesToFetch: number[] = []
            for (let page = 1; page <= pageInfo.totalPages; page++) {
                if (page !== pageInfo.page) {
                    pagesToFetch.push(page)
                }
            }

            const currentGroups = groups
            const otherPages = await Promise.all(
                pagesToFetch.map(page =>
                    GetGroupsPage(page, pageInfo.pageSize, sortBy, searchQuery) as Promise<main.GroupPage>
                )
            )
            const allGroups = [...currentGroups, ...otherPages.flatMap(pageData => pageData.groups || [])]

            allGroups.forEach(group => {
                group.files.forEach(file => {
                    next.add(file.path)
                })
            })
            setSelectedPaths(next)
        } catch (err) {
            console.error('SelectAll error:', err)
        } finally {
            setLoading(false)
        }
    }, [groups, pageInfo.page, pageInfo.pageSize, pageInfo.totalPages, searchQuery, selectedPaths, sortBy])

    const handleDismissUpdate = () => {
        if (updateInfo) {
            localStorage.setItem(STORAGE_KEY_UPDATE_DISMISSED, updateInfo.version)
        }
        setUpdateInfo(null)
    }

    const handleLoadScan = async (scanId: number) => {
        setShowHistory(false)
        try {
            const stats = await LoadScan(scanId) as main.ScanStats
            setScanStats(stats)
            try {
                const firstPage = await GetGroupsPageByScanID(scanId, 1, pageInfo.pageSize, sortBy, searchQuery) as main.GroupPage
                setGroups(firstPage.groups || [])
                setPageInfo(prev => ({
                    ...prev,
                    page: 1,
                    total: firstPage.total,
                    totalPages: firstPage.totalPages,
                }))
            } catch (pageErr) {
                console.error('GetGroupsPageByScanID error:', pageErr)
                setGroups([])
                setPageInfo(prev => ({...prev, page: 1, total: 0, totalPages: 0}))
            }
            setSelectedPaths(new Set())
            await loadSpaceAnalysis()
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
                void handleSelectAll()
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
            const failed = await DeleteFiles(paths, settings.deleteMode)
            const successCount = paths.length - failed.length
            if (successCount > 0) {
                showToast(t('app.toast.batchDeleteSuccess', {count: successCount}))
            }
            if (failed.length > 0) {
                showToast(t('app.toast.batchDeleteFail', {count: failed.length}), 'error')
            }
            const stats = await GetScanStats() as main.ScanStats
            setScanStats(stats)
            await loadGroups(stats)
            await loadSpaceAnalysis()
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
                    scanLogs={scanLogs}
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
                            <Button size="sm" variant="ghost" onClick={() => setShowAnalysis(true)}>
                                <BarChart3 className="h-4 w-4 mr-1"/>
                                {t('app.analysis')}
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
                    hasScanResult={!!scanStats}
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
                    onSortChange={(value) => {
                        setSortBy(value)
                        setPageInfo(prev => ({...prev, page: 1}))
                    }}
                    onSearchChange={(value) => {
                        setSearchQuery(value)
                        setPageInfo(prev => ({...prev, page: 1}))
                    }}
                />
                <ActionBar
                    selectedCount={selectedPaths.size}
                    totalWasted={totalWasted}
                    folders={folders}
                    groups={groups}
                    onSelectFolderDuplicates={handleSelectFolderDuplicates}
                    onSelectAll={() => void handleSelectAll()}
                    onSmartSelect={handleSmartSelect}
                    onDelete={handleDelete}
                    onDeselectAll={handleDeselectAll}
                />
            </div>

            {/* Confirm Dialog */}
            <ConfirmDialog
                open={confirmDelete}
                count={selectedPaths.size}
                deleteMode={settings.deleteMode}
                onConfirm={handleConfirmDelete}
                onCancel={() => setConfirmDelete(false)}
            />

            {/* Settings Dialog */}
            <Settings
                open={showSettings}
                settings={settings}
                onReset={handleResetSettings}
                onClearCache={handleClearAllCache}
                maintenanceDisabled={scanning}
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

            <SpaceAnalysis
                open={showAnalysis}
                items={spaceAnalysis}
                onClose={() => setShowAnalysis(false)}
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
