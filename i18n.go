package main

import "sync"

type Lang string

const (
	LangZhCN Lang = "zh-CN"
	LangEnUS Lang = "en-US"
)

type I18n struct {
	mu   sync.RWMutex
	lang Lang
	data map[Lang]map[string]string
}

func NewI18n() *I18n {
	return &I18n{
		lang: LangZhCN,
		data: map[Lang]map[string]string{
			LangZhCN: zhCN,
			LangEnUS: enUS,
		},
	}
}

func (i *I18n) SetLang(lang Lang) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if lang == LangZhCN || lang == LangEnUS {
		i.lang = lang
	}
}

func (i *I18n) GetLang() Lang {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return i.lang
}

func (i *I18n) T(key string) string {
	i.mu.RLock()
	defer i.mu.RUnlock()
	if m, ok := i.data[i.lang]; ok {
		if v, ok := m[key]; ok {
			return v
		}
	}
	// fallback to zh-CN
	if m, ok := i.data[LangZhCN]; ok {
		if v, ok := m[key]; ok {
			return v
		}
	}
	return key
}

var zhCN = map[string]string{
	"app.title":                "文件查重",
	"scan.preparing":           "准备扫描...",
	"scan.loadingCache":        "加载缓存...",
	"scan.computingHash":       "计算%s: %s (%s)",
	"scan.computingSampleHash": "采样计算%s: %s (%s)",
	"scan.cacheHitHash":        "缓存命中%s: %s (%s)",
	"scan.walking":             "遍历: %s",
	"csv.groupHash":            "分组哈希",
	"csv.filename":             "文件名",
	"csv.filePath":             "文件路径",
	"csv.fileSize":             "文件大小",
	"csv.modified":             "修改时间",
	"csv.openFile":             "打开文件",
	"scan.cacheLoaded":         "[扫描] 缓存加载完成: %d 条, 耗时 %v",
	"scan.cacheLoadedProgress": "缓存加载完成: %d 条, 耗时 %v",
	"scan.startWalking":        "[扫描] 开始遍历: %s",
	"scan.walkingProgress":     "遍历中: %s | 已发现 %d 个文件 | 当前: %s",
	"scan.walkDone":            "[扫描] 遍历 %s 完成: %d 个文件, 耗时 %v",
	"scan.hashingStart":        "开始计算%s，共 %d 个文件",
	"scan.groupingByFilename":  "正在按文件名整理结果...",
	"scan.finalizing":          "正在整理重复结果...",
	"scan.cancelled":           "扫描已取消",
	"scan.paused":              "扫描已暂停",
	"scan.resumed":             "继续扫描...",
	"scan.completed":           "扫描完成: 共遍历 %d 个文件，发现 %d 组重复，用时 %s",
}

var enUS = map[string]string{
	"app.title":                "Duplicate Finder",
	"scan.preparing":           "Preparing scan...",
	"scan.loadingCache":        "Loading cache...",
	"scan.computingHash":       "Computing %s: %s (%s)",
	"scan.computingSampleHash": "Sampling %s: %s (%s)",
	"scan.cacheHitHash":        "Cache hit %s: %s (%s)",
	"scan.walking":             "Walking: %s",
	"csv.groupHash":            "Group Hash",
	"csv.filename":             "Filename",
	"csv.filePath":             "File Path",
	"csv.fileSize":             "File Size",
	"csv.modified":             "Modified",
	"csv.openFile":             "Open File",
	"scan.cacheLoaded":         "[Scan] Cache loaded: %d entries, took %v",
	"scan.cacheLoadedProgress": "Cache loaded: %d entries, took %v",
	"scan.startWalking":        "[Scan] Start walking: %s",
	"scan.walkingProgress":     "Walking: %s | %d files found | Current: %s",
	"scan.walkDone":            "[Scan] Walk %s completed: %d files, took %v",
	"scan.hashingStart":        "Starting %s for %d files",
	"scan.groupingByFilename":  "Grouping results by filename...",
	"scan.finalizing":          "Building duplicate groups...",
	"scan.cancelled":           "Scan cancelled",
	"scan.paused":              "Scan paused",
	"scan.resumed":             "Resuming scan...",
	"scan.completed":           "Scan complete: %d files walked, %d duplicate groups, took %s",
}
