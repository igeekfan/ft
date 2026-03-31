import {main} from '../wailsjs/go/models'

export type FileInfo = main.FileInfo
export type DuplicateGroup = main.DuplicateGroup
export type ScanResult = main.ScanResult

export interface ScanProgress {
    status: 'counting' | 'scanning' | 'paused' | 'completed' | 'cancelled'
    currentFile: string
    scannedFiles: number
    totalFiles: number
    percentage: number
}
