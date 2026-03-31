import {FileInfo} from '../types'
import './Results.css'

interface FileItemProps {
    file: FileInfo
    checked: boolean
    onToggle: (path: string) => void
    onDelete: (path: string) => void
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

function FileItem({file, checked, onToggle, onDelete}: FileItemProps) {
    const folder = getFolderPath(file.path)

    return (
        <div className={`file-item ${checked ? 'checked' : ''}`}>
            <label className="file-checkbox">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(file.path)}
                />
            </label>
            <div className="file-info">
                <div className="file-name">{file.name}</div>
                <div className="file-meta">
                    <span className="file-path" title={file.path}>{folder}</span>
                    <span className="file-size">{formatSize(file.size)}</span>
                    <span className="file-time">{file.modTime}</span>
                </div>
            </div>
            <button
                className="btn-delete-single"
                onClick={() => onDelete(file.path)}
                title="删除此文件"
            >
                ×
            </button>
        </div>
    )
}

export default FileItem
