package main

// FileInfo represents a single file's metadata
type FileInfo struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Hash    string `json:"hash"`
	ModTime string `json:"modTime"`
}

// DuplicateGroup represents files that share the same content hash
type DuplicateGroup struct {
	Hash  string     `json:"hash"`
	Size  int64      `json:"size"`
	Files []FileInfo `json:"files"`
}

// ScanResult holds the full scan output
type ScanResult struct {
	TotalFiles      int              `json:"totalFiles"`
	DuplicateGroups []DuplicateGroup `json:"duplicateGroups"`
	TotalDuplicates int              `json:"totalDuplicates"`
	TotalWasted     int64            `json:"totalWasted"`
	ScanDuration    string           `json:"scanDuration"`
}
