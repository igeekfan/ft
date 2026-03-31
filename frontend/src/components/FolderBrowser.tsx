import {useState, useEffect} from 'react'
import {ListDrives, ListSubDirs} from '../../wailsjs/go/main/App'
import './FolderBrowser.css'

interface FolderBrowserProps {
    initialPath?: string
    onConfirm: (path: string) => void
    onCancel: () => void
}

function FolderBrowser({initialPath, onConfirm, onCancel}: FolderBrowserProps) {
    const [drives, setDrives] = useState<string[]>([])
    const [currentPath, setCurrentPath] = useState('')
    const [subDirs, setSubDirs] = useState<string[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        const isWailsRuntime = typeof window !== 'undefined' && (window as any).go?.main?.App
        if (!isWailsRuntime) {
            console.warn('Wails runtime not available - running in browser mode')
            setDrives([])
            return
        }
        ListDrives().then(d => {
            setDrives(d)
            if (initialPath) {
                navigateTo(initialPath)
            } else if (d.length > 0) {
                navigateTo(d[0])
            }
        }).catch(err => {
            console.error('ListDrives error:', err)
            setDrives([])
        })
    }, [])

    const navigateTo = async (path: string) => {
        setLoading(true)
        setCurrentPath(path)
        try {
            const dirs = await ListSubDirs(path)
            setSubDirs(dirs || [])
        } catch {
            setSubDirs([])
        }
        setLoading(false)
    }

    const handleDirClick = (dirName: string) => {
        const sep = currentPath.endsWith('\\') ? '' : '\\'
        navigateTo(currentPath + sep + dirName)
    }

    const handleParent = () => {
        const trimmed = currentPath.endsWith('\\')
            ? currentPath.slice(0, -1)
            : currentPath
        const idx = trimmed.lastIndexOf('\\')
        if (idx > 0) {
            navigateTo(trimmed.substring(0, idx + 1))
        }
    }

    return (
        <div className="browser-overlay" onClick={onCancel}>
            <div className="browser-dialog" onClick={e => e.stopPropagation()}>
                <div className="browser-header">
                    <span>选择文件夹</span>
                    <button className="browser-close" onClick={onCancel}>×</button>
                </div>
                <div className="browser-drives">
                    {drives.map(d => (
                        <button
                            key={d}
                            className={`drive-btn ${currentPath === d ? 'active' : ''}`}
                            onClick={() => navigateTo(d)}
                        >
                            {d}
                        </button>
                    ))}
                </div>
                <div className="browser-path">
                    <button className="parent-btn" onClick={handleParent} disabled={currentPath.length <= 3}>
                        ↑ 上级
                    </button>
                    <input
                        className="path-input"
                        value={currentPath}
                        onChange={e => setCurrentPath(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') navigateTo(currentPath)
                        }}
                    />
                </div>
                <div className="browser-list">
                    {loading && <div className="browser-loading">加载中...</div>}
                    {!loading && subDirs.length === 0 && (
                        <div className="browser-empty">此目录无子文件夹</div>
                    )}
                    {!loading && subDirs.map(dir => (
                        <div
                            key={dir}
                            className="browser-item"
                            onClick={() => handleDirClick(dir)}
                        >
                            <span className="folder-icon">📁</span>
                            <span>{dir}</span>
                        </div>
                    ))}
                </div>
                <div className="browser-footer">
                    <button className="btn-browser-cancel" onClick={onCancel}>取消</button>
                    <button
                        className="btn-browser-confirm"
                        onClick={() => onConfirm(currentPath)}
                        disabled={!currentPath}
                    >
                        选择此文件夹
                    </button>
                </div>
            </div>
        </div>
    )
}

export default FolderBrowser
