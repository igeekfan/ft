package main

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"hash"
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

	"github.com/cespare/xxhash/v2"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	hashSamplingThresholdBytes int64 = 100 * 1024 * 1024
	hashSampleWindowBytes      int64 = 64 * 1024
	progressEmitInterval             = 750 * time.Millisecond
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
	Stage        string `json:"stage"`
	Message      string `json:"message"`
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

type fileCandidate struct {
	Path    string
	Name    string
	Size    int64
	ModTime string
}

// fileResult is sent from workers back to consumer
type fileResult struct {
	FileInfo
	CacheEntry FileCacheEntry
	UsedCache  bool
	Sampled    bool
	Err        error
}

type scanFilterOptions struct {
	minSize           int64
	allowedExtensions map[string]struct{}
	excludeFolders    []string
	excludeExtensions []string
	scanHiddenFiles   bool
	symlinkHandling   string
}

// StartScan begins the scanning process with parallel hash computation
func (s *Scanner) StartScan(folders []string, minSize int64, includeExtensions []string, excludeFolders []string, excludeExtensions []string, scanHiddenFiles bool, symlinkHandling string, hashAlgorithm string, useSampling bool, scanMode string) (ScanResult, error) {
	scanMode = normalizeScanMode(scanMode)
	hashAlgorithm = normalizeHashAlgorithm(hashAlgorithm)
	allowedExtensions := make(map[string]struct{}, len(includeExtensions))
	for _, ext := range includeExtensions {
		ext = strings.ToLower(strings.TrimSpace(ext))
		if ext == "" {
			continue
		}
		if !strings.HasPrefix(ext, ".") {
			ext = "." + ext
		}
		allowedExtensions[ext] = struct{}{}
	}
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

	s.emitProgress(ScanProgress{
		Status:  "scanning",
		Stage:   "preparing",
		Message: s.app.i18n.T("scan.preparing"),
	})

	filters := scanFilterOptions{
		minSize:           minSize,
		allowedExtensions: allowedExtensions,
		excludeFolders:    excludeFolders,
		excludeExtensions: excludeExtensions,
		scanHiddenFiles:   scanHiddenFiles,
		symlinkHandling:   symlinkHandling,
	}
	if scanMode == "filename" {
		return s.startFilenameScan(ctx, folders, filters)
	}

	startTime := time.Now()
	s.logScanf("开始扫描: mode=%s folders=%d minSize=%s includeExt=%d hash=%s sampling=%t workers=%d", scanMode, len(folders), formatSize(minSize), len(allowedExtensions), hashAlgorithm, useSampling, clampWorkers(goruntime.NumCPU()))

	// Load hash cache from SQLite
	var hashCache map[string]FileCacheEntry
	if s.app.store != nil {
		s.emitProgress(ScanProgress{
			Status:      "scanning",
			Stage:       "cache",
			Message:     s.app.i18n.T("scan.loadingCache"),
			CurrentFile: s.app.i18n.T("scan.loadingCache"),
		})
		cacheStart := time.Now()
		hashCache, _ = s.app.store.LoadFileCache()
		s.logScanf("缓存加载完成: entries=%d took=%s", len(hashCache), time.Since(cacheStart))
		s.emitProgress(ScanProgress{
			Status:      "scanning",
			Stage:       "cache",
			Message:     fmt.Sprintf(s.app.i18n.T("scan.cacheLoadedProgress"), len(hashCache), time.Since(cacheStart)),
			CurrentFile: s.app.i18n.T("scan.loadingCache"),
		})
	}
	if hashCache == nil {
		hashCache = make(map[string]FileCacheEntry)
	}

	// Worker pool setup
	numWorkers := clampWorkers(goruntime.NumCPU())

	jobs := make(chan fileJob, numWorkers*4)
	results := make(chan fileResult, numWorkers*4)
	var wg sync.WaitGroup

	// Start workers
	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			buf := make([]byte, 1024*1024)
			for job := range jobs {
				var hash string
				shouldSample := useSampling && job.Size >= hashSamplingThresholdBytes
				usedCache := false
				// Try cache first
				if cached, ok := hashCache[job.Path]; ok && cached.Size == job.Size && cached.ModTime == job.ModTime && cached.HashAlgorithm == hashAlgorithm && cached.UseSampling == shouldSample {
					hash = cached.Hash
					usedCache = true
				} else {
					h, err := computeHashBuf(job.Path, job.Size, buf, hashAlgorithm, shouldSample)
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
					CacheEntry: FileCacheEntry{Size: job.Size, ModTime: job.ModTime, HashAlgorithm: hashAlgorithm, UseSampling: shouldSample, Hash: hash},
					UsedCache:  usedCache,
					Sampled:    shouldSample,
				}
			}
		}()
	}

	// Close results when all workers done
	go func() {
		wg.Wait()
		close(results)
	}()

	// Producer: walk directories, collect files, then hash every scanned file so cache is complete.
	walkedFiles := 0
	hashedCandidates := 0
	var totalCandidates atomic.Int64
	sizeBuckets := make(map[int64][]fileCandidate)
	go func() {
		defer func() {
			candidateCount := 0
			for _, files := range sizeBuckets {
				candidateCount += len(files)
				for _, file := range files {
					jobs <- fileJob{
						Path:    file.Path,
						Name:    file.Name,
						Size:    file.Size,
						ModTime: file.ModTime,
					}
				}
			}
			hashedCandidates = candidateCount
			totalCandidates.Store(int64(candidateCount))
			s.logScanf("遍历完成: walked=%d queuedForHash=%d sizeBuckets=%d", walkedFiles, candidateCount, len(sizeBuckets))
			s.emitProgress(ScanProgress{
				Status:       "scanning",
				Stage:        "hashing",
				Message:      fmt.Sprintf(s.app.i18n.T("scan.hashingStart"), strings.ToUpper(hashAlgorithm), candidateCount),
				ScannedFiles: 0,
				TotalFiles:   candidateCount,
				Percentage:   0,
			})
			close(jobs)
		}()
		s.logScanf("开始遍历目录")
		for _, folder := range folders {
			if s.cancelled.Load() {
				return
			}
			s.emitProgress(ScanProgress{
				Status:       "scanning",
				Stage:        "walking",
				Message:      fmt.Sprintf(s.app.i18n.T("scan.startWalking"), folder),
				CurrentFile:  folder,
				ScannedFiles: walkedFiles,
			})
			walkStart := time.Now()
			walkCount := 0
			lastWalkEmit := time.Time{}
			s.logScanf("开始遍历: %s", folder)
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
					if len(allowedExtensions) > 0 {
						if _, ok := allowedExtensions[ext]; !ok {
							return nil
						}
					}
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
				} else if len(allowedExtensions) > 0 {
					ext := strings.ToLower(filepath.Ext(info.Name()))
					if _, ok := allowedExtensions[ext]; !ok {
						return nil
					}
				}

				candidate := fileCandidate{
					Path:    path,
					Name:    info.Name(),
					Size:    info.Size(),
					ModTime: info.ModTime().Format(time.DateTime),
				}
				sizeBuckets[candidate.Size] = append(sizeBuckets[candidate.Size], candidate)
				walkedFiles++
				walkCount++
				if walkCount == 1 || walkCount%500 == 0 || time.Since(lastWalkEmit) >= progressEmitInterval {
					s.emitProgress(ScanProgress{
						Status:       "scanning",
						Stage:        "walking",
						Message:      fmt.Sprintf(s.app.i18n.T("scan.walkingProgress"), folder, walkCount, info.Name()),
						CurrentFile:  path,
						ScannedFiles: walkedFiles,
					})
					lastWalkEmit = time.Now()
				}
				return nil
			})
			s.logScanf("遍历完成: folder=%s files=%d took=%s", folder, walkCount, time.Since(walkStart))
			s.emitProgress(ScanProgress{
				Status:       "scanning",
				Stage:        "walking",
				Message:      fmt.Sprintf(s.app.i18n.T("scan.walkDone"), folder, walkCount, time.Since(walkStart)),
				CurrentFile:  folder,
				ScannedFiles: walkedFiles,
			})
			if ctx.Err() != nil {
				return
			}
		}
	}()

	// Consumer: collect results
	hashMap := make(map[string][]FileInfo)
	hashedFiles := 0
	cacheUpdates := make(map[string]FileCacheEntry)
	var lastFile string
	hashStageStart := time.Now()
	lastHashEmit := time.Time{}

	for result := range results {
		// Cancellation check — use atomic flag for immediate detection
		if s.cancelled.Load() {
			s.emitProgress(ScanProgress{
				Status:       "cancelled",
				Stage:        "cancelled",
				Message:      s.app.i18n.T("scan.cancelled"),
				ScannedFiles: hashedFiles,
				TotalFiles:   int(totalCandidates.Load()),
				Percentage:   progressPercentage(hashedFiles, int(totalCandidates.Load())),
			})
			return ScanResult{}, context.Canceled
		}

		// Pause check
		if s.pauseCh != nil {
			select {
			case <-s.pauseCh:
				s.emitProgress(ScanProgress{
					Status:       "paused",
					Stage:        "paused",
					Message:      s.app.i18n.T("scan.paused"),
					ScannedFiles: hashedFiles,
					TotalFiles:   int(totalCandidates.Load()),
					Percentage:   progressPercentage(hashedFiles, int(totalCandidates.Load())),
				})
				select {
				case <-s.pauseCh:
					s.emitProgress(ScanProgress{
						Status:       "scanning",
						Stage:        "hashing",
						Message:      s.app.i18n.T("scan.resumed"),
						ScannedFiles: hashedFiles,
						TotalFiles:   int(totalCandidates.Load()),
						Percentage:   progressPercentage(hashedFiles, int(totalCandidates.Load())),
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
		hashedFiles++
		lastFile = result.Name

		totalHashFiles := int(totalCandidates.Load())
		if hashedFiles == 1 || hashedFiles == totalHashFiles || hashedFiles%10 == 0 || time.Since(lastHashEmit) >= progressEmitInterval {
			s.emitProgress(ScanProgress{
				Status:       "scanning",
				Stage:        "hashing",
				Message:      s.buildHashProgressMessage(hashAlgorithm, result, hashedFiles, totalHashFiles),
				CurrentFile:  result.Path,
				ScannedFiles: hashedFiles,
				TotalFiles:   totalHashFiles,
				Percentage:   progressPercentage(hashedFiles, totalHashFiles),
			})
			lastHashEmit = time.Now()
		}
	}
	s.logScanf("哈希阶段完成: hashed=%d took=%s", hashedFiles, time.Since(hashStageStart))

	s.emitProgress(ScanProgress{
		Status:       "scanning",
		Stage:        "finalizing",
		Message:      s.app.i18n.T("scan.finalizing"),
		CurrentFile:  lastFile,
		ScannedFiles: hashedFiles,
		TotalFiles:   int(totalCandidates.Load()),
		Percentage:   progressPercentage(hashedFiles, int(totalCandidates.Load())),
	})

	// Batch update hash cache
	if s.app.store != nil && len(cacheUpdates) > 0 {
		cacheWriteStart := time.Now()
		s.app.store.BatchUpdateCache(cacheUpdates)
		s.logScanf("缓存回写完成: entries=%d took=%s", len(cacheUpdates), time.Since(cacheWriteStart))
	}

	// Build result
	buildStart := time.Now()
	groups := make([]DuplicateGroup, 0)
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
	s.logScanf("结果构建完成: groups=%d duplicates=%d wasted=%s took=%s", len(groups), totalDuplicates, formatSize(totalWasted), time.Since(buildStart))

	duration := time.Since(startTime)
	s.emitProgress(ScanProgress{
		Status:       "completed",
		Stage:        "completed",
		Message:      fmt.Sprintf(s.app.i18n.T("scan.completed"), walkedFiles, len(groups), formatDuration(duration)),
		CurrentFile:  lastFile,
		ScannedFiles: walkedFiles,
		TotalFiles:   walkedFiles,
		Percentage:   100,
	})
	s.logScanf("扫描完成: walked=%d hashed=%d total=%s", walkedFiles, hashedCandidates, duration)
	return ScanResult{
		TotalFiles:      walkedFiles,
		DuplicateGroups: groups,
		TotalDuplicates: totalDuplicates,
		TotalWasted:     totalWasted,
		ScanDuration:    formatDuration(duration),
		HashAlgorithm:   hashAlgorithm,
	}, nil
}

func (s *Scanner) startFilenameScan(ctx context.Context, folders []string, filters scanFilterOptions) (ScanResult, error) {
	startTime := time.Now()
	s.logScanf("开始扫描: mode=filename folders=%d minSize=%s includeExt=%d", len(folders), formatSize(filters.minSize), len(filters.allowedExtensions))

	nameBuckets := make(map[string][]FileInfo)
	nameDisplay := make(map[string]string)
	walkedFiles := 0
	lastFile := ""

	for _, folder := range folders {
		if s.cancelled.Load() {
			return ScanResult{}, context.Canceled
		}

		s.emitProgress(ScanProgress{
			Status:       "scanning",
			Stage:        "walking",
			Message:      fmt.Sprintf(s.app.i18n.T("scan.startWalking"), folder),
			CurrentFile:  folder,
			ScannedFiles: walkedFiles,
		})

		walkStart := time.Now()
		walkCount := 0
		lastWalkEmit := time.Time{}
		s.logScanf("开始遍历(文件名模式): %s", folder)

		err := walkDir(ctx, folder, func(path string, d fs.DirEntry) error {
			if s.cancelled.Load() {
				return context.Canceled
			}

			if err := s.waitIfPaused(ctx, walkedFiles, walkedFiles); err != nil {
				return err
			}

			if d.IsDir() {
				if isDefaultExcludedDir(d.Name()) {
					return filepath.SkipDir
				}
				for _, excl := range filters.excludeFolders {
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

			info, keep := s.prepareCandidateInfo(path, info, filters)
			if !keep {
				return nil
			}

			fileInfo := FileInfo{
				Path:    path,
				Name:    info.Name(),
				Size:    info.Size(),
				Hash:    "name:" + info.Name(),
				ModTime: info.ModTime().Format(time.DateTime),
			}

			normalizedName := normalizeFilenameKey(info.Name())
			if _, ok := nameDisplay[normalizedName]; !ok {
				nameDisplay[normalizedName] = info.Name()
			}
			nameBuckets[normalizedName] = append(nameBuckets[normalizedName], fileInfo)
			walkedFiles++
			walkCount++
			lastFile = path

			if walkCount == 1 || walkCount%500 == 0 || time.Since(lastWalkEmit) >= progressEmitInterval {
				s.emitProgress(ScanProgress{
					Status:       "scanning",
					Stage:        "walking",
					Message:      fmt.Sprintf(s.app.i18n.T("scan.walkingProgress"), folder, walkCount, info.Name()),
					CurrentFile:  path,
					ScannedFiles: walkedFiles,
				})
				lastWalkEmit = time.Now()
			}
			return nil
		})
		if err != nil && err != context.Canceled {
			return ScanResult{}, err
		}
		if err == context.Canceled {
			return ScanResult{}, context.Canceled
		}

		s.logScanf("遍历完成(文件名模式): folder=%s files=%d took=%s", folder, walkCount, time.Since(walkStart))
		s.emitProgress(ScanProgress{
			Status:       "scanning",
			Stage:        "finalizing",
			Message:      fmt.Sprintf(s.app.i18n.T("scan.walkDone"), folder, walkCount, time.Since(walkStart)),
			CurrentFile:  folder,
			ScannedFiles: walkedFiles,
		})
	}

	s.emitProgress(ScanProgress{
		Status:       "scanning",
		Stage:        "finalizing",
		Message:      s.app.i18n.T("scan.groupingByFilename"),
		CurrentFile:  lastFile,
		ScannedFiles: walkedFiles,
		TotalFiles:   walkedFiles,
		Percentage:   progressPercentage(walkedFiles, walkedFiles),
	})

	buildStart := time.Now()
	groups := make([]DuplicateGroup, 0)
	totalDuplicates := 0
	var totalWasted int64

	for normalizedName, files := range nameBuckets {
		if len(files) < 2 {
			continue
		}
		sort.Slice(files, func(i, j int) bool {
			return files[i].Path < files[j].Path
		})
		groupLabel := nameDisplay[normalizedName]
		for i := range files {
			files[i].Hash = "name:" + groupLabel
		}
		groups = append(groups, DuplicateGroup{
			Hash:  "name:" + groupLabel,
			Size:  files[0].Size,
			Files: files,
		})
		totalDuplicates += len(files) - 1
		for _, file := range files[1:] {
			totalWasted += file.Size
		}
	}

	sort.Slice(groups, func(i, j int) bool {
		wastedI := groupWastedSpace(groups[i])
		wastedJ := groupWastedSpace(groups[j])
		return wastedI > wastedJ
	})
	s.logScanf("结果构建完成(文件名模式): groups=%d duplicates=%d wasted=%s took=%s", len(groups), totalDuplicates, formatSize(totalWasted), time.Since(buildStart))

	duration := time.Since(startTime)
	s.emitProgress(ScanProgress{
		Status:       "completed",
		Stage:        "completed",
		Message:      fmt.Sprintf(s.app.i18n.T("scan.completed"), walkedFiles, len(groups), formatDuration(duration)),
		CurrentFile:  lastFile,
		ScannedFiles: walkedFiles,
		TotalFiles:   walkedFiles,
		Percentage:   100,
	})

	return ScanResult{
		TotalFiles:      walkedFiles,
		DuplicateGroups: groups,
		TotalDuplicates: totalDuplicates,
		TotalWasted:     totalWasted,
		ScanDuration:    formatDuration(duration),
		HashAlgorithm:   "filename",
	}, nil
}

// computeHashBuf calculates a full or sampled hash with a shared buffer.
func computeHashBuf(path string, size int64, buf []byte, algorithm string, useSampling bool) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := newHasher(algorithm)
	if useSampling {
		if err := writeSampledHash(h, f, size); err != nil {
			return "", err
		}
		return hex.EncodeToString(h.Sum(nil)), nil
	}
	if _, err := io.CopyBuffer(h, f, buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func normalizeHashAlgorithm(algorithm string) string {
	switch strings.ToLower(strings.TrimSpace(algorithm)) {
	case "", "xxhash":
		return "xxhash"
	case "md5":
		return "md5"
	default:
		return "xxhash"
	}
}

func normalizeScanMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "filename":
		return "filename"
	default:
		return "content"
	}
}

func newHasher(algorithm string) hash.Hash {
	if normalizeHashAlgorithm(algorithm) == "md5" {
		return md5.New()
	}
	return xxhash.New()
}

func writeSampledHash(hasher hash.Hash, file *os.File, size int64) error {
	if size <= 0 {
		return nil
	}
	windowSize := hashSampleWindowBytes
	if size < windowSize {
		windowSize = size
	}
	positions := []int64{0}
	if size > windowSize {
		middle := size/2 - windowSize/2
		if middle < 0 {
			middle = 0
		}
		end := size - windowSize
		for _, pos := range []int64{middle, end} {
			if pos > positions[len(positions)-1] {
				positions = append(positions, pos)
			}
		}
	}

	meta := fmt.Sprintf("%d|", size)
	if _, err := hasher.Write([]byte(meta)); err != nil {
		return err
	}

	chunk := make([]byte, windowSize)
	for _, pos := range positions {
		if _, err := file.Seek(pos, io.SeekStart); err != nil {
			return err
		}
		readLen := windowSize
		if size-pos < readLen {
			readLen = size - pos
		}
		if _, err := io.ReadFull(file, chunk[:readLen]); err != nil {
			return err
		}
		if _, err := hasher.Write(chunk[:readLen]); err != nil {
			return err
		}
	}
	return nil
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

func clampWorkers(workerCount int) int {
	if workerCount < 4 {
		return 4
	}
	if workerCount > 16 {
		return 16
	}
	return workerCount
}

func (s *Scanner) logScanf(format string, args ...any) {
	fmt.Printf("[扫描] "+format+"\n", args...)
}

func (s *Scanner) emitProgress(progress ScanProgress) {
	if s.app == nil || s.app.ctx == nil {
		return
	}
	if progress.Message == "" {
		progress.Message = progress.CurrentFile
	}
	runtime.EventsEmit(s.app.ctx, "scan:progress", progress)
}

func (s *Scanner) buildHashProgressMessage(hashAlgorithm string, result fileResult, scannedFiles int, totalFiles int) string {
	algorithm := strings.ToUpper(hashAlgorithm)
	var prefix string
	switch {
	case result.UsedCache:
		prefix = fmt.Sprintf(s.app.i18n.T("scan.cacheHitHash"), algorithm, result.Name, formatSize(result.Size))
	case result.Sampled:
		prefix = fmt.Sprintf(s.app.i18n.T("scan.computingSampleHash"), algorithm, result.Name, formatSize(result.Size))
	default:
		prefix = fmt.Sprintf(s.app.i18n.T("scan.computingHash"), algorithm, result.Name, formatSize(result.Size))
	}
	if totalFiles <= 0 {
		return prefix
	}
	return fmt.Sprintf("%s | %d / %d", prefix, scannedFiles, totalFiles)
}

func (s *Scanner) waitIfPaused(ctx context.Context, scannedFiles int, totalFiles int) error {
	if s.pauseCh == nil {
		return nil
	}
	select {
	case <-s.pauseCh:
		s.emitProgress(ScanProgress{
			Status:       "paused",
			Stage:        "paused",
			Message:      s.app.i18n.T("scan.paused"),
			ScannedFiles: scannedFiles,
			TotalFiles:   totalFiles,
			Percentage:   progressPercentage(scannedFiles, totalFiles),
		})
		select {
		case <-s.pauseCh:
			s.emitProgress(ScanProgress{
				Status:       "scanning",
				Stage:        "walking",
				Message:      s.app.i18n.T("scan.resumed"),
				ScannedFiles: scannedFiles,
				TotalFiles:   totalFiles,
				Percentage:   progressPercentage(scannedFiles, totalFiles),
			})
			return nil
		case <-ctx.Done():
			return context.Canceled
		}
	default:
		return nil
	}
}

func (s *Scanner) prepareCandidateInfo(path string, info fs.FileInfo, filters scanFilterOptions) (fs.FileInfo, bool) {
	if !filters.scanHiddenFiles && strings.HasPrefix(info.Name(), ".") {
		return info, false
	}

	if info.Mode()&os.ModeSymlink != 0 {
		switch filters.symlinkHandling {
		case "skip":
			return info, false
		case "follow":
			targetPath, err := filepath.EvalSymlinks(path)
			if err != nil {
				return info, false
			}
			targetInfo, err := os.Stat(targetPath)
			if err != nil || !targetInfo.Mode().IsRegular() {
				return info, false
			}
			info = targetInfo
		case "report":
			return info, false
		default:
			return info, false
		}
	}

	if filters.minSize > 0 && info.Size() < filters.minSize {
		return info, false
	}

	ext := strings.ToLower(filepath.Ext(info.Name()))
	if len(filters.excludeExtensions) > 0 {
		if len(filters.allowedExtensions) > 0 {
			if _, ok := filters.allowedExtensions[ext]; !ok {
				return info, false
			}
		}
		for _, exclExt := range filters.excludeExtensions {
			if strings.HasPrefix(exclExt, ".") {
				if ext == exclExt {
					return info, false
				}
			} else if ext == "."+exclExt {
				return info, false
			}
		}
	} else if len(filters.allowedExtensions) > 0 {
		if _, ok := filters.allowedExtensions[ext]; !ok {
			return info, false
		}
	}

	return info, true
}

func normalizeFilenameKey(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func groupWastedSpace(group DuplicateGroup) int64 {
	if len(group.Files) < 2 {
		return 0
	}
	var wasted int64
	for _, file := range group.Files[1:] {
		wasted += file.Size
	}
	return wasted
}

func progressPercentage(scannedFiles, totalFiles int) int {
	if totalFiles <= 0 {
		return 0
	}
	if scannedFiles >= totalFiles {
		return 100
	}
	return scannedFiles * 100 / totalFiles
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
