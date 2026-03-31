package main

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Scanner manages the scanning state with pause/resume support
type Scanner struct {
	mu      sync.Mutex
	ctx     context.Context
	cancel  context.CancelFunc
	pauseCh chan struct{}
	resumed bool
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

// computeHash calculates the MD5 hash of a file by streaming it in chunks
func computeHash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := md5.New()
	buf := make([]byte, 64*1024)
	if _, err := io.CopyBuffer(h, f, buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// countFiles counts total files in all folders
func countFiles(folders []string) int {
	count := 0
	for _, folder := range folders {
		filepath.WalkDir(folder, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			info, err := d.Info()
			if err != nil || !info.Mode().IsRegular() {
				return nil
			}
			count++
			return nil
		})
	}
	return count
}

// StartScan begins the scanning process
func (s *Scanner) StartScan(folders []string) (ScanResult, error) {
	s.mu.Lock()
	ctx, cancel := context.WithCancel(context.Background())
	s.ctx = ctx
	s.cancel = cancel
	s.pauseCh = make(chan struct{}, 1)
	s.resumed = false
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.cancel = nil
		s.mu.Unlock()
	}()

	runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
		Status: "scanning",
	})

	// Count total files first
	runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
		Status:      "counting",
		CurrentFile: "正在统计文件数量...",
	})
	totalFiles := countFiles(folders)

	hashMap := make(map[string][]FileInfo)
	scannedFiles := 0

	for _, folder := range folders {
		err := filepath.WalkDir(folder, func(path string, d fs.DirEntry, err error) error {
			// Check for cancellation
			select {
			case <-ctx.Done():
				return context.Canceled
			default:
			}

			// Check for pause
			s.mu.Lock()
			if s.pauseCh != nil {
				select {
				case <-s.pauseCh:
					runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
						Status:       "paused",
						ScannedFiles: scannedFiles,
						TotalFiles:   totalFiles,
						Percentage:   calcPercentage(scannedFiles, totalFiles),
					})
					// Wait for resume
					<-s.pauseCh
					runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
						Status:       "scanning",
						ScannedFiles: scannedFiles,
						TotalFiles:   totalFiles,
						Percentage:   calcPercentage(scannedFiles, totalFiles),
					})
				default:
				}
			}
			s.mu.Unlock()

			if err != nil {
				return nil
			}
			if d.IsDir() {
				return nil
			}

			info, err := d.Info()
			if err != nil {
				return nil
			}
			if !info.Mode().IsRegular() {
				return nil
			}

			hash, err := computeHash(path)
			if err != nil {
				return nil
			}

			fi := FileInfo{
				Path:    path,
				Name:    info.Name(),
				Size:    info.Size(),
				Hash:    hash,
				ModTime: info.ModTime().Format(time.DateTime),
			}

			hashMap[hash] = append(hashMap[hash], fi)
			scannedFiles++

			// Emit progress
			if scannedFiles%10 == 0 || scannedFiles == totalFiles {
				runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
					Status:       "scanning",
					CurrentFile:  fi.Name,
					ScannedFiles: scannedFiles,
					TotalFiles:   totalFiles,
					Percentage:   calcPercentage(scannedFiles, totalFiles),
				})
			}

			return nil
		})
		if err == context.Canceled {
			runtime.EventsEmit(s.app.ctx, "scan:progress", ScanProgress{
				Status: "cancelled",
			})
			return ScanResult{}, context.Canceled
		}
		if err != nil {
			return ScanResult{}, err
		}
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

	return ScanResult{
		TotalFiles:      scannedFiles,
		DuplicateGroups: groups,
		TotalDuplicates: totalDuplicates,
		TotalWasted:     totalWasted,
	}, nil
}

// PauseScan pauses the current scan
func (s *Scanner) PauseScan() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pauseCh != nil && !s.resumed {
		s.pauseCh <- struct{}{}
		s.resumed = true
	}
}

// ResumeScan resumes a paused scan
func (s *Scanner) ResumeScan() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pauseCh != nil && s.resumed {
		s.pauseCh <- struct{}{}
		s.resumed = false
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
