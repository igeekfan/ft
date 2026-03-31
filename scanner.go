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
	mu      sync.Mutex
	ctx     context.Context
	cancel  context.CancelFunc
	pauseCh chan struct{}
	paused  atomic.Bool
	app     *App
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
	".git", ".svn", ".hg",
	"node_modules", "vendor", ".venv", "__pycache__",
	"$RECYCLE.BIN", "System Volume Information",
	".cache", ".npm", ".yarn", ".pnpm-store",
	"dist", "build", "target",
	".idea", ".vscode", ".DS_Store",
}

func isDefaultExcludedDir(name string) bool {
	for _, excl := range defaultExcludedDirs {
		if name == excl {
			return true
		}
	}
	return false
}

// countFiles counts total files in all folders (fast, skips default dirs)
func countFiles(folders []string) int {
	count := 0
	for _, folder := range folders {
		filepath.WalkDir(folder, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				if isDefaultExcludedDir(d.Name()) {
					return filepath.SkipDir
				}
				return nil
			}
			count++
			return nil
		})
	}
	return count
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
func (s *Scanner) StartScan(folders []string, minSize int64, excludeFolders []string, excludeExtensions []string) (ScanResult, error) {
	s.mu.Lock()
	ctx, cancel := context.WithCancel(context.Background())
	s.ctx = ctx
	s.cancel = cancel
	s.pauseCh = make(chan struct{}, 1)
	s.paused.Store(false)
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

	// Count total files first
	runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
		Status:      "counting",
		CurrentFile: "正在统计文件数量...",
	})
	totalFiles := countFiles(folders)

	// Load hash cache from SQLite
	var hashCache map[string]FileCacheEntry
	if s.app.store != nil {
		hashCache, _ = s.app.store.LoadFileCache()
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
		for _, folder := range folders {
			filepath.WalkDir(folder, func(path string, d fs.DirEntry, err error) error {
				select {
				case <-ctx.Done():
					return context.Canceled
				default:
				}

				if err != nil {
					return nil
				}
				if d.IsDir() {
					// Skip default directories
					if isDefaultExcludedDir(d.Name()) {
						return filepath.SkipDir
					}
					for _, excl := range excludeFolders {
						if path == excl || strings.HasPrefix(path, excl+string(os.PathSeparator)) {
							return filepath.SkipDir
						}
					}
					return nil
				}

				info, err := d.Info()
				if err != nil || !info.Mode().IsRegular() {
					return nil
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
				return nil
			})
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
		// Cancellation check
		if ctx.Err() != nil {
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
					TotalFiles:   totalFiles,
					Percentage:   calcPercentage(scannedFiles, totalFiles),
				})
				select {
				case <-s.pauseCh:
					runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
						Status:       "scanning",
						ScannedFiles: scannedFiles,
						TotalFiles:   totalFiles,
						Percentage:   calcPercentage(scannedFiles, totalFiles),
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

		if scannedFiles%20 == 0 || scannedFiles == totalFiles {
			runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
				Status:       "scanning",
				CurrentFile:  lastFile,
				ScannedFiles: scannedFiles,
				TotalFiles:   totalFiles,
				Percentage:   calcPercentage(scannedFiles, totalFiles),
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
		TotalFiles:   totalFiles,
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
	if s.cancel != nil {
		s.cancel()
	}
}

func calcPercentage(current, total int) int {
	if total == 0 {
		return 0
	}
	return (current * 100) / total
}
