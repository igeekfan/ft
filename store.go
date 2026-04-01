package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// Store manages SQLite storage for scan results
type Store struct {
	db *sql.DB
}

// GroupPage holds a page of groups with total count
type GroupPage struct {
	Groups     []DuplicateGroup `json:"groups"`
	Total      int              `json:"total"`
	Page       int              `json:"page"`
	PageSize   int              `json:"pageSize"`
	TotalPages int              `json:"totalPages"`
}

// ScanStats holds summary statistics
type ScanStats struct {
	TotalFiles      int    `json:"totalFiles"`
	TotalGroups     int    `json:"totalGroups"`
	TotalDuplicates int    `json:"totalDuplicates"`
	TotalWasted     int64  `json:"totalWasted"`
	ScanDuration    string `json:"scanDuration"`
}

// ScanHistoryItem represents a past scan record
type ScanHistoryItem struct {
	ID              int64  `json:"id"`
	TotalFiles      int    `json:"totalFiles"`
	TotalDuplicates int    `json:"totalDuplicates"`
	TotalWasted     int64  `json:"totalWasted"`
	ScanDuration    string `json:"scanDuration"`
	CreatedAt       string `json:"createdAt"`
}

func NewStore() (*Store, error) {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	dbDir := filepath.Join(dir, "ft")
	os.MkdirAll(dbDir, 0755)
	dbPath := filepath.Join(dbDir, "scan.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}

	// WAL mode for better concurrency
	db.Exec("PRAGMA journal_mode=WAL")
	db.Exec("PRAGMA synchronous=NORMAL")

	s := &Store{db: db}
	if err := s.init(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) init() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS scans (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			total_files INTEGER,
			total_duplicates INTEGER,
			total_wasted INTEGER,
			scan_duration TEXT,
			created_at TEXT DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS groups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			scan_id INTEGER,
			hash TEXT,
			size INTEGER,
			file_count INTEGER,
			FOREIGN KEY(scan_id) REFERENCES scans(id)
		)`,
		`CREATE TABLE IF NOT EXISTS files (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			group_id INTEGER,
			path TEXT,
			name TEXT,
			size INTEGER,
			mod_time TEXT,
			FOREIGN KEY(group_id) REFERENCES groups(id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_groups_scan ON groups(scan_id)`,
		`CREATE INDEX IF NOT EXISTS idx_files_group ON files(group_id)`,
		`CREATE TABLE IF NOT EXISTS file_cache (
			path TEXT PRIMARY KEY,
			size INTEGER,
			mod_time TEXT,
			hash_algorithm TEXT DEFAULT 'md5',
			use_sampling INTEGER DEFAULT 0,
			hash TEXT
		)`,
	}
	for _, q := range queries {
		if _, err := s.db.Exec(q); err != nil {
			return err
		}
	}
	for _, q := range []string{
		"ALTER TABLE file_cache ADD COLUMN hash_algorithm TEXT DEFAULT 'md5'",
		"ALTER TABLE file_cache ADD COLUMN use_sampling INTEGER DEFAULT 0",
	} {
		if _, err := s.db.Exec(q); err != nil && !strings.Contains(err.Error(), "duplicate column name") {
			return err
		}
	}
	return nil
}

// SaveScanResult stores a full scan result, returns the scan ID
func (s *Store) SaveScanResult(result ScanResult) (int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		"INSERT INTO scans (total_files, total_duplicates, total_wasted, scan_duration) VALUES (?, ?, ?, ?)",
		result.TotalFiles, result.TotalDuplicates, result.TotalWasted, result.ScanDuration,
	)
	if err != nil {
		return 0, err
	}
	scanID, _ := res.LastInsertId()

	for _, g := range result.DuplicateGroups {
		gRes, err := tx.Exec(
			"INSERT INTO groups (scan_id, hash, size, file_count) VALUES (?, ?, ?, ?)",
			scanID, g.Hash, g.Size, len(g.Files),
		)
		if err != nil {
			return 0, err
		}
		groupID, _ := gRes.LastInsertId()

		for _, f := range g.Files {
			_, err := tx.Exec(
				"INSERT INTO files (group_id, path, name, size, mod_time) VALUES (?, ?, ?, ?, ?)",
				groupID, f.Path, f.Name, f.Size, f.ModTime,
			)
			if err != nil {
				return 0, err
			}
		}
	}

	return scanID, tx.Commit()
}

// GetStats returns summary statistics from the latest scan
func (s *Store) GetStats() (ScanStats, error) {
	var stats ScanStats
	var scanID int64
	err := s.db.QueryRow(
		"SELECT id, total_files, total_duplicates, total_wasted, COALESCE(scan_duration, '') FROM scans ORDER BY id DESC LIMIT 1",
	).Scan(&scanID, &stats.TotalFiles, &stats.TotalDuplicates, &stats.TotalWasted, &stats.ScanDuration)
	if err != nil {
		return ScanStats{}, err
	}
	s.db.QueryRow("SELECT COUNT(*) FROM groups WHERE scan_id = ?", scanID).Scan(&stats.TotalGroups)
	return stats, nil
}

// GetGroups returns a page of duplicate groups with their files
func (s *Store) GetGroups(page, pageSize int, sortBy, searchQuery string) (GroupPage, error) {
	latestScanID, err := s.getLatestScanID()
	if err != nil {
		return GroupPage{}, err
	}
	return s.GetGroupsByScanID(latestScanID, page, pageSize, sortBy, searchQuery)
}

// GetAllGroups returns all groups from the latest scan.
func (s *Store) GetAllGroups() ([]DuplicateGroup, error) {
	latestScanID, err := s.getLatestScanID()
	if err != nil {
		return nil, err
	}
	return s.GetAllGroupsByScanID(latestScanID)
}

// GetAllGroupsByScanID returns all groups for a specific scan.
func (s *Store) GetAllGroupsByScanID(scanID int64) ([]DuplicateGroup, error) {
	rows, err := s.db.Query("SELECT id, hash, size FROM groups WHERE scan_id = ? ORDER BY file_count * size DESC", scanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []DuplicateGroup
	for rows.Next() {
		var groupID int64
		var g DuplicateGroup
		if err := rows.Scan(&groupID, &g.Hash, &g.Size); err != nil {
			continue
		}
		fileRows, err := s.db.Query("SELECT path, name, size, mod_time FROM files WHERE group_id = ?", groupID)
		if err != nil {
			continue
		}
		for fileRows.Next() {
			var f FileInfo
			fileRows.Scan(&f.Path, &f.Name, &f.Size, &f.ModTime)
			f.Hash = g.Hash
			g.Files = append(g.Files, f)
		}
		fileRows.Close()
		groups = append(groups, g)
	}
	return groups, nil
}

// Close closes the database connection
func (s *Store) Close() {
	if s.db != nil {
		s.db.Close()
	}
}

// GetScanHistory returns recent scan records
func (s *Store) GetScanHistory(limit int) ([]ScanHistoryItem, error) {
	if limit < 1 {
		limit = 20
	}
	rows, err := s.db.Query(
		"SELECT id, total_files, total_duplicates, total_wasted, COALESCE(scan_duration, ''), created_at FROM scans ORDER BY id DESC LIMIT ?",
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []ScanHistoryItem
	for rows.Next() {
		var item ScanHistoryItem
		if err := rows.Scan(&item.ID, &item.TotalFiles, &item.TotalDuplicates, &item.TotalWasted, &item.ScanDuration, &item.CreatedAt); err != nil {
			continue
		}
		items = append(items, item)
	}
	return items, nil
}

// GetGroupsByScanID returns groups for a specific scan with pagination
func (s *Store) GetGroupsByScanID(scanID int64, page, pageSize int, sortBy, searchQuery string) (GroupPage, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 50
	}

	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM groups WHERE scan_id = ?", scanID).Scan(&total)
	totalPages := (total + pageSize - 1) / pageSize

	orderBy := "g.file_count * g.size DESC"
	switch sortBy {
	case "size":
		orderBy = "g.size DESC"
	case "count":
		orderBy = "g.file_count DESC"
	case "hash":
		orderBy = "g.hash ASC"
	}

	offset := (page - 1) * pageSize

	var rows *sql.Rows
	var err error
	if searchQuery != "" {
		q := "%" + searchQuery + "%"
		rows, err = s.db.Query(
			fmt.Sprintf(`SELECT g.id, g.hash, g.size, g.file_count FROM groups g
				WHERE g.scan_id = ? AND EXISTS (SELECT 1 FROM files f WHERE f.group_id = g.id AND f.name LIKE ?)
				ORDER BY %s LIMIT ? OFFSET ?`, orderBy),
			scanID, q, pageSize, offset,
		)
	} else {
		rows, err = s.db.Query(
			fmt.Sprintf(`SELECT g.id, g.hash, g.size, g.file_count FROM groups g WHERE g.scan_id = ? ORDER BY %s LIMIT ? OFFSET ?`, orderBy),
			scanID, pageSize, offset,
		)
	}
	if err != nil {
		return GroupPage{}, err
	}
	defer rows.Close()

	var groups []DuplicateGroup
	for rows.Next() {
		var groupID int64
		var g DuplicateGroup
		var fileCount int
		if err := rows.Scan(&groupID, &g.Hash, &g.Size, &fileCount); err != nil {
			continue
		}
		fileRows, err := s.db.Query("SELECT path, name, size, mod_time FROM files WHERE group_id = ?", groupID)
		if err != nil {
			continue
		}
		for fileRows.Next() {
			var f FileInfo
			fileRows.Scan(&f.Path, &f.Name, &f.Size, &f.ModTime)
			f.Hash = g.Hash
			g.Files = append(g.Files, f)
		}
		fileRows.Close()
		groups = append(groups, g)
	}

	return GroupPage{
		Groups:     groups,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

// GetStatsByScanID returns stats for a specific scan
func (s *Store) GetStatsByScanID(scanID int64) (ScanStats, error) {
	var stats ScanStats
	err := s.db.QueryRow(
		"SELECT total_files, total_duplicates, total_wasted, COALESCE(scan_duration, '') FROM scans WHERE id = ?",
		scanID,
	).Scan(&stats.TotalFiles, &stats.TotalDuplicates, &stats.TotalWasted, &stats.ScanDuration)
	if err != nil {
		return ScanStats{}, err
	}
	s.db.QueryRow("SELECT COUNT(*) FROM groups WHERE scan_id = ?", scanID).Scan(&stats.TotalGroups)
	return stats, nil
}

// FileCacheEntry represents a cached file hash
type FileCacheEntry struct {
	Size          int64
	ModTime       string
	HashAlgorithm string
	UseSampling   bool
	Hash          string
}

// LoadFileCache loads all cached file hashes into a map
func (s *Store) LoadFileCache() (map[string]FileCacheEntry, error) {
	rows, err := s.db.Query("SELECT path, size, mod_time, COALESCE(hash_algorithm, 'md5'), COALESCE(use_sampling, 0), hash FROM file_cache")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cache := make(map[string]FileCacheEntry)
	for rows.Next() {
		var path string
		var e FileCacheEntry
		var useSamplingInt int
		if err := rows.Scan(&path, &e.Size, &e.ModTime, &e.HashAlgorithm, &useSamplingInt, &e.Hash); err != nil {
			continue
		}
		e.UseSampling = useSamplingInt == 1
		cache[path] = e
	}
	return cache, nil
}

// BatchUpdateCache upserts cache entries
func (s *Store) BatchUpdateCache(updates map[string]FileCacheEntry) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare("INSERT INTO file_cache (path, size, mod_time, hash_algorithm, use_sampling, hash) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET size=excluded.size, mod_time=excluded.mod_time, hash_algorithm=excluded.hash_algorithm, use_sampling=excluded.use_sampling, hash=excluded.hash")
	if err != nil {
		return err
	}
	defer stmt.Close()

	for path, e := range updates {
		useSampling := 0
		if e.UseSampling {
			useSampling = 1
		}
		if _, err := stmt.Exec(path, e.Size, e.ModTime, e.HashAlgorithm, useSampling, e.Hash); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// RemoveFiles removes deleted files from cache and persisted scan results.
func (s *Store) RemoveFiles(paths []string) error {
	if len(paths) == 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	args := stringsToAny(paths)
	pathPlaceholders := sqlPlaceholders(len(paths))

	if _, err := tx.Exec("DELETE FROM file_cache WHERE path IN ("+pathPlaceholders+")", args...); err != nil {
		return err
	}

	affectedGroups := map[int64]struct{}{}
	deletedPerScan := map[int64]int{}

	rows, err := tx.Query(
		fmt.Sprintf(`SELECT g.id, g.scan_id, COUNT(*)
			FROM groups g
			JOIN files f ON f.group_id = g.id
			WHERE f.path IN (%s)
			GROUP BY g.id, g.scan_id`, pathPlaceholders),
		args...,
	)
	if err != nil {
		return err
	}
	for rows.Next() {
		var groupID int64
		var scanID int64
		var fileCount int
		if err := rows.Scan(&groupID, &scanID, &fileCount); err != nil {
			rows.Close()
			return err
		}
		affectedGroups[groupID] = struct{}{}
		deletedPerScan[scanID] += fileCount
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	if _, err := tx.Exec("DELETE FROM files WHERE path IN ("+pathPlaceholders+")", args...); err != nil {
		return err
	}

	if len(affectedGroups) > 0 {
		groupIDs := make([]int64, 0, len(affectedGroups))
		for groupID := range affectedGroups {
			groupIDs = append(groupIDs, groupID)
		}
		groupArgs := int64sToAny(groupIDs)
		groupPlaceholders := sqlPlaceholders(len(groupIDs))

		if _, err := tx.Exec(
			"UPDATE groups SET file_count = (SELECT COUNT(*) FROM files WHERE files.group_id = groups.id) WHERE id IN ("+groupPlaceholders+")",
			groupArgs...,
		); err != nil {
			return err
		}

		dropRows, err := tx.Query(
			"SELECT id FROM groups WHERE id IN ("+groupPlaceholders+") AND file_count < 2",
			groupArgs...,
		)
		if err != nil {
			return err
		}
		var groupsToDrop []int64
		for dropRows.Next() {
			var groupID int64
			if err := dropRows.Scan(&groupID); err != nil {
				dropRows.Close()
				return err
			}
			groupsToDrop = append(groupsToDrop, groupID)
		}
		if err := dropRows.Err(); err != nil {
			dropRows.Close()
			return err
		}
		dropRows.Close()

		if len(groupsToDrop) > 0 {
			dropArgs := int64sToAny(groupsToDrop)
			dropPlaceholders := sqlPlaceholders(len(groupsToDrop))
			if _, err := tx.Exec("DELETE FROM files WHERE group_id IN ("+dropPlaceholders+")", dropArgs...); err != nil {
				return err
			}
			if _, err := tx.Exec("DELETE FROM groups WHERE id IN ("+dropPlaceholders+")", dropArgs...); err != nil {
				return err
			}
		}
	}

	for scanID, deletedCount := range deletedPerScan {
		var totalDuplicates int
		var totalWasted int64
		if err := tx.QueryRow(
			"SELECT COALESCE(SUM(file_count - 1), 0), COALESCE(SUM((file_count - 1) * size), 0) FROM groups WHERE scan_id = ?",
			scanID,
		).Scan(&totalDuplicates, &totalWasted); err != nil {
			return err
		}

		if _, err := tx.Exec(
			`UPDATE scans
			 SET total_files = CASE WHEN total_files > ? THEN total_files - ? ELSE 0 END,
			     total_duplicates = ?,
			     total_wasted = ?
			 WHERE id = ?`,
			deletedCount,
			deletedCount,
			totalDuplicates,
			totalWasted,
			scanID,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func sqlPlaceholders(count int) string {
	return strings.TrimSuffix(strings.Repeat("?,", count), ",")
}

func stringsToAny(values []string) []any {
	args := make([]any, len(values))
	for i, value := range values {
		args[i] = value
	}
	return args
}

func int64sToAny(values []int64) []any {
	args := make([]any, len(values))
	for i, value := range values {
		args[i] = value
	}
	return args
}

func (s *Store) getLatestScanID() (int64, error) {
	var scanID int64
	if err := s.db.QueryRow("SELECT id FROM scans ORDER BY id DESC LIMIT 1").Scan(&scanID); err != nil {
		return 0, err
	}
	return scanID, nil
}
