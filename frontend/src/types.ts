import {main} from '../wailsjs/go/models'

export type FileInfo = main.FileInfo
export type DuplicateGroup = main.DuplicateGroup
export type ScanResult = main.ScanResult

export interface ScanProgress {
    status: 'scanning' | 'paused' | 'completed' | 'cancelled'
    stage?: string
    message?: string
    currentFile: string
    scannedFiles: number
    totalFiles: number
    percentage: number
}
