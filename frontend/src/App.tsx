import {useState, useEffect} from 'react'
import {StartScan, DeleteFiles, PauseScan, ResumeScan, CancelScan, ExportResults} from '../wailsjs/go/main/App'
import {EventsOn} from '../wailsjs/runtime/runtime'
import {ScanProgress} from './types'
import {main} from '../wailsjs/go/models'
import {Button} from '@/components/ui/button'
import {Switch} from '@/components/ui/switch'
import {Sun, Moon, FolderPlus, Download} from 'lucide-react'
import FolderPanel from './components/FolderPanel'
import Results from './components/Results'
import ActionBar from './components/ActionBar'
import ConfirmDialog from './components/ConfirmDialog'
import FolderBrowser from './components/FolderBrowser'

const STORAGE_KEY_FOLDERS = 'duplicate-scanner-folders'
const STORAGE_KEY_BROWSER_PATH = 'duplicate-scanner-browser-path'
const STORAGE_KEY_THEME = 'duplicate-scanner-theme'
const STORAGE_KEY_SCAN_RESULT = 'duplicate-scanner-scan-result'

function loadFolders(): string[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY_FOLDERS)
        return stored ? JSON.parse(stored) : []
    } catch {
        return []
    }
}

function loadScanResult(): main.ScanResult | null {
    try {
        const stored = localStorage.getItem(STORAGE_KEY_SCAN_RESULT)
        if (!stored) return null
        const obj = JSON.parse(stored)
        if (!obj.duplicateGroups) obj.duplicateGroups = []
        return main.ScanResult.createFrom(obj)
    } catch {
        return null
    }
}

function App() {
    const [theme, setTheme] = useState<'dark' | 'light'>(() => {
        const stored = localStorage.getItem(STORAGE_KEY_THEME)
        return (stored as 'dark' | 'light') || 'dark'
    })
    const [folders, setFolders] = useState<string[]>(loadFolders)
    const [scanResult, setScanResult] = useState<main.ScanResult | null>(loadScanResult)
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
    const [scanning, setScanning] = useState(false)
    const [scanPaused, setScanPaused] = useState(false)
    const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [showBrowser, setShowBrowser] = useState(false)
    const [browserPath, setBrowserPath] = useState(() => localStorage.getItem(STORAGE_KEY_BROWSER_PATH) || '')
    const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null)

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

    // Persist folders
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(folders))
    }, [folders])

    // Persist scan result
    useEffect(() => {
        if (scanResult) {
            localStorage.setItem(STORAGE_KEY_SCAN_RESULT, JSON.stringify(scanResult))
        }
    }, [scanResult])

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
                showToast('删除失败', 'error')
                return
            }
            showToast('删除成功')
            if (scanResult) {
                const newGroups = (scanResult.duplicateGroups ?? [])
                    .map(g => main.DuplicateGroup.createFrom({...g, files: g.files.filter(f => f.path !== path)}))
                    .filter(g => g.files.length >= 2)
                const newDuplicates = newGroups.reduce((s, g) => s + g.files.length - 1, 0)
                const newWasted = newGroups.reduce((s, g) => s + (g.files.length - 1) * g.size, 0)
                setScanResult(main.ScanResult.createFrom({
                    totalFiles: scanResult.totalFiles,
                    duplicateGroups: newGroups,
                    totalDuplicates: newDuplicates,
                    totalWasted: newWasted
                }))
            }
            setSelectedPaths(prev => {
                const next = new Set(prev)
                next.delete(path)
                return next
            })
        } catch (err) {
            console.error('DeleteFiles error:', err)
            showToast('删除失败', 'error')
        }
    }

    const handleScan = async () => {
        if (folders.length === 0) return
        setScanning(true)
        setScanPaused(false)
        setScanProgress(null)
        setScanResult(null)
        setSelectedPaths(new Set())
        try {
            const result = await StartScan(folders) as main.ScanResult
            setScanResult(result)
            showToast(`扫描完成，发现 ${result.totalDuplicates} 个重复文件`)
        } catch (err: any) {
            if (err?.message === 'context canceled') {
                showToast('扫描已取消')
            } else {
                console.error('StartScan error:', err)
                showToast('扫描失败', 'error')
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
        if (!scanResult) return
        try {
            const path = await ExportResults(scanResult as any)
            showToast(`导出成功: ${path}`)
        } catch (err) {
            console.error('ExportResults error:', err)
            showToast('导出失败', 'error')
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
        if (!scanResult) return
        setSelectedPaths(prev => {
            const next = new Set(prev)
            ;(scanResult.duplicateGroups ?? []).forEach(group => {
                group.files.forEach(file => {
                    if (file.path.startsWith(folderPrefix)) next.add(file.path)
                })
            })
            return next
        })
    }

    const handleDeselectAll = () => setSelectedPaths(new Set())

    const handleDelete = () => {
        if (selectedPaths.size === 0) return
        setConfirmDelete(true)
    }

    const handleConfirmDelete = async () => {
        setConfirmDelete(false)
        const paths = Array.from(selectedPaths)
        try {
            const failed = await DeleteFiles(paths)
            const successCount = paths.length - failed.length
            if (successCount > 0) {
                showToast(`成功删除 ${successCount} 个文件`)
            }
            if (failed.length > 0) {
                showToast(`${failed.length} 个文件删除失败`, 'error')
            }
            if (scanResult) {
                const failedSet = new Set(failed)
                const newGroups = (scanResult.duplicateGroups ?? [])
                    .map(g => main.DuplicateGroup.createFrom({...g, files: g.files.filter(f => !selectedPaths.has(f.path) || failedSet.has(f.path))}))
                    .filter(g => g.files.length >= 2)
                const newDuplicates = newGroups.reduce((s, g) => s + g.files.length - 1, 0)
                const newWasted = newGroups.reduce((s, g) => s + (g.files.length - 1) * g.size, 0)
                setScanResult(main.ScanResult.createFrom({
                    totalFiles: scanResult.totalFiles,
                    duplicateGroups: newGroups,
                    totalDuplicates: newDuplicates,
                    totalWasted: newWasted
                }))
            }
            setSelectedPaths(new Set())
        } catch (err) {
            console.error('DeleteFiles error:', err)
            showToast('删除失败', 'error')
        }
    }

    const totalWasted = scanResult?.totalWasted ?? 0

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            {/* Sidebar */}
            <div className="w-64 min-w-[260px] border-r bg-card flex flex-col">
                <div className="flex items-center justify-between p-4 border-b">
                    <h3 className="text-sm font-semibold">文件夹</h3>
                    <Button size="sm" variant="outline" onClick={handleAddFolder}>
                        <FolderPlus className="h-4 w-4 mr-1"/>
                        添加
                    </Button>
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
                        {theme === 'dark' ? '夜间' : '日间'}
                    </span>
                    <Switch checked={theme === 'dark'} onCheckedChange={toggleTheme}/>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header with stats */}
                <div className="border-b bg-card px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        {scanResult && (
                            <>
                                <span className="text-sm text-muted-foreground">
                                    扫描文件: <strong className="text-foreground">{scanResult.totalFiles}</strong>
                                </span>
                                <span className="text-sm text-muted-foreground">
                                    重复文件: <strong className="text-orange-500">{scanResult.totalDuplicates}</strong>
                                </span>
                                <span className="text-sm text-muted-foreground">
                                    浪费空间: <strong className="text-red-500">{formatBytes(scanResult.totalWasted)}</strong>
                                </span>
                                <span className="text-sm text-muted-foreground">
                                    重复组数: <strong className="text-foreground">{scanResult.duplicateGroups?.length ?? 0}</strong>
                                </span>
                            </>
                        )}
                    </div>
                    {scanResult && (scanResult.duplicateGroups?.length ?? 0) > 0 && (
                        <Button size="sm" variant="outline" onClick={handleExportResults}>
                            <Download className="h-4 w-4 mr-1"/>
                            导出CSV
                        </Button>
                    )}
                </div>

                <Results
                    groups={scanResult?.duplicateGroups ?? []}
                    selectedPaths={selectedPaths}
                    onToggle={handleToggleFile}
                    onToggleGroup={handleToggleGroup}
                    onDeleteFile={handleDeleteFile}
                />
                <ActionBar
                    selectedCount={selectedPaths.size}
                    totalWasted={totalWasted}
                    folders={folders}
                    groups={scanResult?.duplicateGroups ?? []}
                    onSelectFolderDuplicates={handleSelectFolderDuplicates}
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

            {/* Folder Browser */}
            {showBrowser && (
                <FolderBrowser
                    initialPath={browserPath}
                    onConfirm={handleBrowserConfirm}
                    onCancel={() => setShowBrowser(false)}
                />
            )}

            {/* Toast */}
            {toast && (
                <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-lg text-sm text-white z-50 animate-in fade-in slide-in-from-bottom-2 ${
                    toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
                }`}>
                    {toast.message}
                </div>
            )}
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
