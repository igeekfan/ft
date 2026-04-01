package main

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Scanner manages the scanning state with pause/resume support
type Scanner struct {
	mu        sync.Mutex
	ctx       context.Context
	cancel    context.CancelFunc
	pauseCh   chan struct{}
	paused    atomic.Bool
	cancelled atomic.Bool
	app       *App
}

// NewScanner creates a new Scanner instance
func NewScanner(app *App) *Scanner {
	return &Scanner{
		app: app,
	}
}

// ScanProgress represents the current scan progress
type ScanProgress struct {
	Status       string `json:"status"` // "scanning", "paused", "completed", "cancelled"
	CurrentFile  string `json:"currentFile"`
	ScannedFiles int    `json:"scannedFiles"`
	TotalFiles   int    `json:"totalFiles"`
	Percentage   int    `json:"percentage"`
}

// Directories to skip by default (name-based match)
var defaultExcludedDirs = []string{
	// Version control
	".git", ".svn", ".hg",
	// Dev dependencies
	"node_modules", "vendor", ".venv", "__pycache__", "venv", "env",
	// Build output
	"dist", "build", "target", "out", "bin", "obj",
	// Package managers
	".cache", ".npm", ".yarn", ".pnpm-store", ".cargo", ".gradle", ".m2",
	// IDE
	".idea", ".vscode", ".DS_Store",
	// Windows system (name-based, catches subdirs of any drive)
	"$RECYCLE.BIN", "System Volume Information",
	"Windows", "Program Files", "Program Files (x86)",
	"ProgramData", "AppData", "$WinREAgent",
	"MSOCache", "PerfLogs", "Recovery",
	// macOS
	".Trash", ".Spotlight-V100",
}

func isDefaultExcludedDir(name string) bool {
	for _, excl := range defaultExcludedDirs {
		if name == excl {
			return true
		}
	}
	return false
}

// isExcludedPath checks if a path should be excluded based on exclude rule.
// Supports:
//   - "bin" (directory name match)
//   - "bin/subdir" (relative path)
//   - "C:\bin" (absolute path)
func isExcludedPath(path, excludeRule string) bool {
	// Normalize separators
	path = filepath.ToSlash(path)
	excludeRule = filepath.ToSlash(excludeRule)

	// 1. Exact match
	if path == excludeRule {
		return true
	}

	// 2. Prefix match (absolute path or relative path)
	if strings.HasPrefix(path, excludeRule+"/") {
		return true
	}

	// 3. Directory name match (last component)
	pathParts := strings.Split(path, "/")
	excludeParts := strings.Split(excludeRule, "/")

	// If excludeRule is a single directory name, check if any path component matches
	if len(excludeParts) == 1 {
		for _, part := range pathParts {
			if part == excludeParts[0] {
				return true
			}
		}
	}

	// 4. Check if excludeRule matches a suffix of the path
	if len(pathParts) >= len(excludeParts) {
		match := true
		for i := 0; i < len(excludeParts); i++ {
			if pathParts[len(pathParts)-len(excludeParts)+i] != excludeParts[i] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}

	return false
}

// walkDir recursively walks the directory tree, checking ctx for cancellation.
// Unlike filepath.WalkDir, this can be interrupted mid-traversal.
func walkDir(ctx context.Context, root string, fn func(path string, d fs.DirEntry) error) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		return nil // skip unreadable directories
	}

	for _, entry := range entries {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		path := filepath.Join(root, entry.Name())
		if err := fn(path, entry); err != nil {
			if err == filepath.SkipDir && entry.IsDir() {
				continue
			}
			return err
		}
		if entry.IsDir() {
			if err := walkDir(ctx, path, fn); err != nil {
				return err
			}
		}
	}
	return nil
}

// fileJob is sent from producer to workers
type fileJob struct {
	Path    string
	Name    string
	Size    int64
	ModTime string
}

// fileResult is sent from workers back to consumer
type fileResult struct {
	FileInfo
	CacheEntry FileCacheEntry
	Err        error
}

// StartScan begins the scanning process with parallel hash computation
func (s *Scanner) StartScan(folders []string, minSize int64, excludeFolders []string, excludeExtensions []string, scanHiddenFiles bool, symlinkHandling string) (ScanResult, error) {
	s.mu.Lock()
	ctx, cancel := context.WithCancel(context.Background())
	s.ctx = ctx
	s.cancel = cancel
	s.pauseCh = make(chan struct{}, 1)
	s.paused.Store(false)
	s.cancelled.Store(false)
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.cancel = nil
		s.mu.Unlock()
	}()

	runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
		Status: "scanning",
	})

	startTime := time.Now()

	// Load hash cache from SQLite
	var hashCache map[string]FileCacheEntry
	if s.app.store != nil {
		runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
			Status:      "scanning",
			CurrentFile: s.app.i18n.T("scan.loadingCache"),
		})
		cacheStart := time.Now()
		hashCache, _ = s.app.store.LoadFileCache()
		fmt.Printf(s.app.i18n.T("scan.cacheLoaded")+"\n", len(hashCache), time.Since(cacheStart))
	}

	// Worker pool setup
	numWorkers := goruntime.NumCPU()
	if numWorkers < 4 {
		numWorkers = 4
	}
	if numWorkers > 16 {
		numWorkers = 16
	}

	jobs := make(chan fileJob, numWorkers*4)
	results := make(chan fileResult, numWorkers*4)
	var wg sync.WaitGroup

	// Start workers
	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			buf := make([]byte, 64*1024)
			for job := range jobs {
				var hash string
				// Try cache first
				if cached, ok := hashCache[job.Path]; ok && cached.Size == job.Size && cached.ModTime == job.ModTime {
					hash = cached.Hash
				} else {
					runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
						Status:      "scanning",
						CurrentFile: fmt.Sprintf(s.app.i18n.T("scan.computingMD5"), job.Name, formatSize(job.Size)),
					})
					h, err := computeHashBuf(job.Path, buf)
					if err != nil {
						results <- fileResult{Err: err}
						continue
					}
					hash = h
				}
				results <- fileResult{
					FileInfo: FileInfo{
						Path:    job.Path,
						Name:    job.Name,
						Size:    job.Size,
						Hash:    hash,
						ModTime: job.ModTime,
					},
					CacheEntry: FileCacheEntry{Size: job.Size, ModTime: job.ModTime, Hash: hash},
				}
			}
		}()
	}

	// Close results when all workers done
	go func() {
		wg.Wait()
		close(results)
	}()

	// Producer: walk directories and send jobs
	go func() {
		defer close(jobs)
		fmt.Printf("[扫描] Producer 启动, 文件夹: %v\n", folders)
		for _, folder := range folders {
			if s.cancelled.Load() {
				return
			}
			runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
				Status:      "scanning",
				CurrentFile: fmt.Sprintf(s.app.i18n.T("scan.walking"), folder),
			})
			walkStart := time.Now()
			walkCount := 0
			fmt.Printf(s.app.i18n.T("scan.startWalking")+"\n", folder)
			walkDir(ctx, folder, func(path string, d fs.DirEntry) error {
				if s.cancelled.Load() {
					return context.Canceled
				}

				if d.IsDir() {
					// Skip default directories
					if isDefaultExcludedDir(d.Name()) {
						return filepath.SkipDir
					}
					for _, excl := range excludeFolders {
						if isExcludedPath(path, excl) {
							return filepath.SkipDir
						}
					}
					return nil
				}

				info, err := d.Info()
				if err != nil || !info.Mode().IsRegular() {
					return nil
				}

				// Skip hidden files if scanHiddenFiles is false
				if !scanHiddenFiles {
					// On Unix-like systems, hidden files start with a dot
					if strings.HasPrefix(info.Name(), ".") {
						return nil
					}
				}

				// Handle symlinks
				if info.Mode()&os.ModeSymlink != 0 {
					switch symlinkHandling {
					case "skip":
						return nil
					case "follow":
						// Try to resolve the symlink and get the target info
						targetPath, err := filepath.EvalSymlinks(path)
						if err != nil {
							return nil
						}
						targetInfo, err := os.Stat(targetPath)
						if err != nil || !targetInfo.Mode().IsRegular() {
							return nil
						}
						// Use the target info instead
						info = targetInfo
					case "report":
						// Report symlinks but don't process them
						return nil
					default:
						return nil
					}
				}

				if minSize > 0 && info.Size() < minSize {
					return nil
				}
				if len(excludeExtensions) > 0 {
					ext := strings.ToLower(filepath.Ext(info.Name()))
					for _, exclExt := range excludeExtensions {
						if strings.HasPrefix(exclExt, ".") {
							if ext == exclExt {
								return nil
							}
						} else {
							if ext == "."+exclExt {
								return nil
							}
						}
					}
				}

				jobs <- fileJob{
					Path:    path,
					Name:    info.Name(),
					Size:    info.Size(),
					ModTime: info.ModTime().Format(time.DateTime),
				}
				walkCount++
				return nil
			})
			fmt.Printf(s.app.i18n.T("scan.walkDone")+"\n", folder, walkCount, time.Since(walkStart))
			if ctx.Err() != nil {
				return
			}
		}
	}()

	// Consumer: collect results
	hashMap := make(map[string][]FileInfo)
	scannedFiles := 0
	cacheUpdates := make(map[string]FileCacheEntry)
	var lastFile string

	for result := range results {
		// Cancellation check — use atomic flag for immediate detection
		if s.cancelled.Load() {
			runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
				Status: "cancelled",
			})
			return ScanResult{}, context.Canceled
		}

		// Pause check
		if s.pauseCh != nil {
			select {
			case <-s.pauseCh:
				runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
					Status:       "paused",
					ScannedFiles: scannedFiles,
					TotalFiles:   0,
					Percentage:   0,
				})
				select {
				case <-s.pauseCh:
					runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
						Status:       "scanning",
						ScannedFiles: scannedFiles,
						TotalFiles:   0,
						Percentage:   0,
					})
				case <-ctx.Done():
					return ScanResult{}, context.Canceled
				}
			default:
			}
		}

		if result.Err != nil {
			continue
		}

		hashMap[result.Hash] = append(hashMap[result.Hash], result.FileInfo)
		cacheUpdates[result.Path] = result.CacheEntry
		scannedFiles++
		lastFile = result.Name

		if scannedFiles%20 == 0 {
			runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
				Status:       "scanning",
				CurrentFile:  lastFile,
				ScannedFiles: scannedFiles,
				TotalFiles:   0,
				Percentage:   0,
			})
		}
	}

	// Batch update hash cache
	if s.app.store != nil && len(cacheUpdates) > 0 {
		s.app.store.BatchUpdateCache(cacheUpdates)
	}

	// Build result
	var groups []DuplicateGroup
	totalDuplicates := 0
	var totalWasted int64

	for hash, files := range hashMap {
		if len(files) < 2 {
			continue
		}
		sort.Slice(files, func(i, j int) bool {
			return files[i].Path < files[j].Path
		})
		groups = append(groups, DuplicateGroup{
			Hash:  hash,
			Size:  files[0].Size,
			Files: files,
		})
		totalDuplicates += len(files) - 1
		totalWasted += int64(len(files)-1) * files[0].Size
	}

	sort.Slice(groups, func(i, j int) bool {
		wastedI := int64(len(groups[i].Files)-1) * groups[i].Size
		wastedJ := int64(len(groups[j].Files)-1) * groups[j].Size
		return wastedI > wastedJ
	})

	runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
		Status:       "completed",
		ScannedFiles: scannedFiles,
		TotalFiles:   scannedFiles,
		Percentage:   100,
	})

	duration := time.Since(startTime)
	return ScanResult{
		TotalFiles:      scannedFiles,
		DuplicateGroups: groups,
		TotalDuplicates: totalDuplicates,
		TotalWasted:     totalWasted,
		ScanDuration:    formatDuration(duration),
	}, nil
}

// computeHashBuf calculates MD5 with a shared buffer (for worker pool)
func computeHashBuf(path string, buf []byte) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := md5.New()
	if _, err := io.CopyBuffer(h, f, buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func formatDuration(d time.Duration) string {
	if d < time.Second {
		return fmt.Sprintf("%dms", d.Milliseconds())
	}
	if d < time.Minute {
		return fmt.Sprintf("%.1fs", d.Seconds())
	}
	mins := int(d.Minutes())
	secs := int(d.Seconds()) % 60
	return fmt.Sprintf("%dm%ds", mins, secs)
}

func formatSize(bytes int64) string {
	if bytes < 1024 {
		return fmt.Sprintf("%d B", bytes)
	}
	if bytes < 1024*1024 {
		return fmt.Sprintf("%.1f KB", float64(bytes)/1024)
	}
	if bytes < 1024*1024*1024 {
		return fmt.Sprintf("%.1f MB", float64(bytes)/(1024*1024))
	}
	return fmt.Sprintf("%.2f GB", float64(bytes)/(1024*1024*1024))
}

// PauseScan pauses the current scan
func (s *Scanner) PauseScan() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pauseCh != nil && !s.paused.Load() {
		s.paused.Store(true)
		select {
		case s.pauseCh <- struct{}{}:
		default:
		}
	}
}

// ResumeScan resumes a paused scan
func (s *Scanner) ResumeScan() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pauseCh != nil && s.paused.Load() {
		s.paused.Store(false)
		select {
		case s.pauseCh <- struct{}{}:
		default:
		}
	}
}

// CancelScan cancels the current scan
func (s *Scanner) CancelScan() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cancelled.Store(true)
	if s.cancel != nil {
		s.cancel()
	}
}
