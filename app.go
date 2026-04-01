package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

var fileTypeExtensions = map[string][]string{
	"video":    {".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpg", ".mpeg"},
	"image":    {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".ico", ".tiff", ".tif"},
	"audio":    {".mp3", ".wav", ".flac", ".aac", ".ogg", ".wma", ".m4a", ".opus"},
	"document": {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".rtf", ".odt", ".csv"},
	"archive":  {".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".iso"},
}

// App struct
type App struct {
	ctx           context.Context
	scanner       *Scanner
	store         *Store
	i18n          *I18n
	currentScanID int64
}

// NewApp creates a new App application struct
func NewApp() *App {
	app := &App{}
	app.i18n = NewI18n()
	app.scanner = NewScanner(app)
	store, err := NewStore()
	if err == nil {
		app.store = store
	}
	return app
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// SetLang sets the application language
func (a *App) SetLang(lang string) {
	a.i18n.SetLang(Lang(lang))
}

// GetLang returns the current language
func (a *App) GetLang() string {
	return string(a.i18n.GetLang())
}

// ListDrives returns available disk drives on Windows
func (a *App) ListDrives() []string {
	var drives []string
	for _, letter := range "ABCDEFGHIJKLMNOPQRSTUVWXYZ" {
		drive := string(letter) + ":\\"
		if _, err := os.Stat(drive); err == nil {
			drives = append(drives, drive)
		}
	}
	return drives
}

// ListSubDirs returns immediate subdirectories of a given path
func (a *App) ListSubDirs(dirPath string) []string {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return []string{}
	}
	dirs := []string{}
	for _, e := range entries {
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
			dirs = append(dirs, e.Name())
		}
	}
	sort.Strings(dirs)
	return dirs
}

// StartScan scans the given folders and returns duplicate file groups
func (a *App) StartScan(folders []string, minSize int64, includeExtensions []string, excludeFolders []string, excludeExtensions []string, scanHiddenFiles bool, symlinkHandling string, hashAlgorithm string, useSampling bool, scanMode string) (ScanResult, error) {
	result, err := a.scanner.StartScan(folders, minSize, includeExtensions, excludeFolders, excludeExtensions, scanHiddenFiles, symlinkHandling, hashAlgorithm, useSampling, scanMode)
	if err != nil {
		return result, err
	}
	// Save to SQLite
	if a.store != nil {
		scanID, saveErr := a.store.SaveScanResult(result)
		if saveErr == nil {
			a.currentScanID = scanID
		}
	}
	return result, nil
}

// GetScanStats returns summary statistics from SQLite
func (a *App) GetScanStats() ScanStats {
	if a.store == nil {
		return ScanStats{}
	}
	var stats ScanStats
	var err error
	if a.currentScanID > 0 {
		stats, err = a.store.GetStatsByScanID(a.currentScanID)
	} else {
		stats, err = a.store.GetStats()
	}
	if err != nil {
		return ScanStats{}
	}
	return stats
}

// GetGroupsPage returns a paginated list of duplicate groups
func (a *App) GetGroupsPage(page int, pageSize int, sortBy string, search string) GroupPage {
	if a.store == nil {
		return GroupPage{}
	}
	var result GroupPage
	if a.currentScanID > 0 {
		result, _ = a.store.GetGroupsByScanID(a.currentScanID, page, pageSize, sortBy, search)
	} else {
		result, _ = a.store.GetGroups(page, pageSize, sortBy, search)
	}
	return result
}

// GetSpaceAnalysis returns duplicate space stats for the current scan.
func (a *App) GetSpaceAnalysis() []SpaceAnalysisItem {
	if a.store == nil {
		return []SpaceAnalysisItem{}
	}

	var (
		groups []DuplicateGroup
		err    error
	)
	if a.currentScanID > 0 {
		groups, err = a.store.GetAllGroupsByScanID(a.currentScanID)
	} else {
		groups, err = a.store.GetAllGroups()
	}
	if err != nil {
		return []SpaceAnalysisItem{}
	}

	itemsByType := map[string]*SpaceAnalysisItem{}
	for _, itemType := range []string{"video", "image", "audio", "document", "archive", "other"} {
		itemsByType[itemType] = &SpaceAnalysisItem{Type: itemType}
	}

	for _, group := range groups {
		for idx, file := range group.Files {
			itemType := detectFileType(file.Name)
			item := itemsByType[itemType]
			item.Files++
			item.TotalSize += file.Size
			if idx > 0 {
				item.Wasted += file.Size
			}
		}
	}

	items := make([]SpaceAnalysisItem, 0, len(itemsByType))
	for _, item := range itemsByType {
		if item.Files == 0 {
			continue
		}
		items = append(items, *item)
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].Wasted == items[j].Wasted {
			return items[i].TotalSize > items[j].TotalSize
		}
		return items[i].Wasted > items[j].Wasted
	})

	return items
}

// GetScanHistory returns recent scan records
func (a *App) GetScanHistory() []ScanHistoryItem {
	if a.store == nil {
		return []ScanHistoryItem{}
	}
	items, _ := a.store.GetScanHistory(20)
	if items == nil {
		return []ScanHistoryItem{}
	}
	return items
}

// LoadScan loads a specific scan by ID and updates current view
func (a *App) LoadScan(scanID int64) (ScanStats, error) {
	if a.store == nil {
		return ScanStats{}, fmt.Errorf("no store available")
	}
	a.currentScanID = scanID
	return a.store.GetStatsByScanID(scanID)
}

// GetGroupsPageByScanID returns paginated groups for a specific scan
func (a *App) GetGroupsPageByScanID(scanID int64, page int, pageSize int, sortBy string, search string) GroupPage {
	if a.store == nil {
		return GroupPage{}
	}
	result, _ := a.store.GetGroupsByScanID(scanID, page, pageSize, sortBy, search)
	return result
}

// PauseScan pauses the current scan
func (a *App) PauseScan() {
	a.scanner.PauseScan()
}

// ResumeScan resumes a paused scan
func (a *App) ResumeScan() {
	a.scanner.ResumeScan()
}

// CancelScan cancels the current scan
func (a *App) CancelScan() {
	a.scanner.CancelScan()
}

// DeleteFiles moves the given file paths to the recycle bin and returns any failed paths
func (a *App) DeleteFiles(paths []string) []string {
	failed := []string{}
	deleted := make([]string, 0, len(paths))
	for _, p := range paths {
		if err := moveToTrash(p); err != nil {
			failed = append(failed, p)
			continue
		}
		deleted = append(deleted, p)
	}
	if a.store != nil && len(deleted) > 0 {
		if err := a.store.RemoveFiles(deleted); err != nil {
			fmt.Printf("[store] failed to cleanup deleted files: %v\n", err)
		}
	}
	return failed
}

// moveToTrash moves a file to the system recycle bin/trash
func moveToTrash(path string) error {
	absPath, err := filepath.Abs(path)
	if err != nil {
		absPath = path
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		psCmd := fmt.Sprintf(
			`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('%s', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
			strings.ReplaceAll(absPath, "'", "''"),
		)
		cmd = exec.Command("powershell", "-Command", psCmd)
	case "darwin":
		cmd = exec.Command("osascript", "-e",
			fmt.Sprintf(`tell application "Finder" to delete POSIX file "%s"`, absPath))
	default:
		// Linux: try gio trash first, fallback to trash-put, then permanent delete
		if _, err := exec.LookPath("gio"); err == nil {
			cmd = exec.Command("gio", "trash", absPath)
		} else if _, err := exec.LookPath("trash-put"); err == nil {
			cmd = exec.Command("trash-put", absPath)
		} else {
			return os.Remove(absPath)
		}
	}
	return cmd.Run()
}

// ExportResults exports scan results to CSV
func (a *App) ExportResults(result ScanResult) (string, error) {
	documentsDir, err := os.UserHomeDir()
	if err != nil {
		documentsDir = os.TempDir()
	}

	timestamp := fmt.Sprintf("%d", os.Getpid())
	filename := fmt.Sprintf("ft_duplicates_%s.csv", timestamp)
	filePath := filepath.Join(documentsDir, "Documents", filename)

	// Ensure directory exists
	os.MkdirAll(filepath.Dir(filePath), 0755)

	file, err := os.Create(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	// Write header
	writer.Write([]string{
		a.i18n.T("csv.groupHash"),
		a.i18n.T("csv.filename"),
		a.i18n.T("csv.filePath"),
		a.i18n.T("csv.fileSize"),
		a.i18n.T("csv.modified"),
		a.i18n.T("csv.openFile"),
	})

	// Write data
	for _, group := range result.DuplicateGroups {
		for _, f := range group.Files {
			writer.Write([]string{
				group.Hash[:8] + "...",
				f.Name,
				f.Path,
				fmt.Sprintf("%d", f.Size),
				f.ModTime,
				fmt.Sprintf("file:///%s", filepath.ToSlash(f.Path)),
			})
		}
	}

	// Open the folder containing the CSV
	a.OpenPath(filepath.Dir(filePath))

	return filePath, nil
}

// ExportFromStore exports scan results from SQLite to CSV
func (a *App) ExportFromStore() (string, error) {
	if a.store == nil {
		return "", fmt.Errorf("no scan data available")
	}
	var (
		groups []DuplicateGroup
		err    error
	)
	if a.currentScanID > 0 {
		groups, err = a.store.GetAllGroupsByScanID(a.currentScanID)
	} else {
		groups, err = a.store.GetAllGroups()
	}
	if err != nil {
		return "", err
	}
	result := ScanResult{DuplicateGroups: groups}
	return a.ExportResults(result)
}

func detectFileType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	for itemType, extensions := range fileTypeExtensions {
		for _, candidate := range extensions {
			if ext == candidate {
				return itemType
			}
		}
	}
	return "other"
}

// OpenPath opens a directory in the system file explorer
func (a *App) OpenPath(path string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", path)
	case "darwin":
		cmd = exec.Command("open", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	return cmd.Start()
}

// OpenFileLocation opens the folder and selects the specified file
func (a *App) OpenFileLocation(filePath string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", "/select,", filePath)
	case "darwin":
		cmd = exec.Command("open", "-R", filePath)
	default:
		cmd = exec.Command("xdg-open", filePath[:strings.LastIndex(filePath, "/")])
	}
	return cmd.Start()
}

// OpenFile opens a file with the default application
func (a *App) OpenFile(filePath string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", filePath)
	case "darwin":
		cmd = exec.Command("open", filePath)
	default:
		cmd = exec.Command("xdg-open", filePath)
	}
	return cmd.Start()
}

// CheckForUpdate checks GitHub releases for a newer version
func (a *App) CheckForUpdate() UpdateInfo {
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", GitHubRepo)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return UpdateInfo{Error: err.Error()}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return UpdateInfo{Error: fmt.Sprintf("GitHub API returned status %d", resp.StatusCode)}
	}

	var release struct {
		TagName     string `json:"tag_name"`
		HTMLURL     string `json:"html_url"`
		Body        string `json:"body"`
		PublishedAt string `json:"published_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return UpdateInfo{Error: err.Error()}
	}

	latestVer := strings.TrimPrefix(release.TagName, "v")
	currentVer := strings.TrimPrefix(AppVersion, "v")

	hasUpdate := compareVersions(latestVer, currentVer) > 0

	return UpdateInfo{
		HasUpdate:   hasUpdate,
		Version:     release.TagName,
		ReleaseURL:  release.HTMLURL,
		ReleaseNote: release.Body,
		PublishedAt: release.PublishedAt,
	}
}

// compareVersions compares two semver version strings.
// Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
func compareVersions(v1, v2 string) int {
	parts1 := strings.Split(v1, ".")
	parts2 := strings.Split(v2, ".")

	maxLen := len(parts1)
	if len(parts2) > maxLen {
		maxLen = len(parts2)
	}

	for i := 0; i < maxLen; i++ {
		var n1, n2 int
		if i < len(parts1) {
			fmt.Sscanf(parts1[i], "%d", &n1)
		}
		if i < len(parts2) {
			fmt.Sscanf(parts2[i], "%d", &n2)
		}
		if n1 > n2 {
			return 1
		}
		if n1 < n2 {
			return -1
		}
	}
	return 0
}

// GetAppVersion returns the current application version
func (a *App) GetAppVersion() string {
	return AppVersion
}
