package main

// AppVersion is the current application version (semver)
const AppVersion = "1.0.0"

// GitHubRepo is the owner/repo for update checks
const GitHubRepo = "igeekfan/ft"

// UpdateInfo holds the result of an update check
type UpdateInfo struct {
	HasUpdate   bool   `json:"hasUpdate"`
	Version     string `json:"version"`
	ReleaseURL  string `json:"releaseURL"`
	ReleaseNote string `json:"releaseNote"`
	PublishedAt string `json:"publishedAt"`
	Error       string `json:"error"`
}

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
	HashAlgorithm   string           `json:"hashAlgorithm"`
}
