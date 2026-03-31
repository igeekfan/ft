package main

import (
	"context"
	"encoding/csv"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// App struct
type App struct {
	ctx     context.Context
	scanner *Scanner
	store   *Store
}

// NewApp creates a new App application struct
func NewApp() *App {
	app := &App{}
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
func (a *App) StartScan(folders []string, minSize int64, excludeFolders []string, excludeExtensions []string) (ScanResult, error) {
	result, err := a.scanner.StartScan(folders, minSize, excludeFolders, excludeExtensions)
	if err != nil {
		return result, err
	}
	// Save to SQLite
	if a.store != nil {
		a.store.SaveScanResult(result)
	}
	return result, nil
}

// GetScanStats returns summary statistics from SQLite
func (a *App) GetScanStats() ScanStats {
	if a.store == nil {
		return ScanStats{}
	}
	stats, _ := a.store.GetStats()
	return stats
}

// GetGroupsPage returns a paginated list of duplicate groups
func (a *App) GetGroupsPage(page int, pageSize int, sortBy string, search string) GroupPage {
	if a.store == nil {
		return GroupPage{}
	}
	result, _ := a.store.GetGroups(page, pageSize, sortBy, search)
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
	for _, p := range paths {
		if err := moveToTrash(p); err != nil {
			failed = append(failed, p)
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
	writer.Write([]string{"分组哈希", "文件名", "文件路径", "文件大小", "修改时间", "打开文件"})

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
	groups, err := a.store.GetAllGroups()
	if err != nil {
		return "", err
	}
	result := ScanResult{DuplicateGroups: groups}
	return a.ExportResults(result)
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
