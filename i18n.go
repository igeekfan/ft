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
	"app.title":         "文件查重",
	"scan.loadingCache": "加载缓存...",
	"scan.computingMD5": "计算MD5: %s (%s)",
	"scan.walking":      "遍历: %s",
	"csv.groupHash":     "分组哈希",
	"csv.filename":      "文件名",
	"csv.filePath":      "文件路径",
	"csv.fileSize":      "文件大小",
	"csv.modified":      "修改时间",
	"csv.openFile":      "打开文件",
	"scan.cacheLoaded":  "[扫描] 缓存加载完成: %d 条, 耗时 %v",
	"scan.startWalking": "[扫描] 开始遍历: %s",
	"scan.walkDone":     "[扫描] 遍历 %s 完成: %d 个文件, 耗时 %v",
}

var enUS = map[string]string{
	"app.title":         "Duplicate Finder",
	"scan.loadingCache": "Loading cache...",
	"scan.computingMD5": "Computing MD5: %s (%s)",
	"scan.walking":      "Walking: %s",
	"csv.groupHash":     "Group Hash",
	"csv.filename":      "Filename",
	"csv.filePath":      "File Path",
	"csv.fileSize":      "File Size",
	"csv.modified":      "Modified",
	"csv.openFile":      "Open File",
	"scan.cacheLoaded":  "[Scan] Cache loaded: %d entries, took %v",
	"scan.startWalking": "[Scan] Start walking: %s",
	"scan.walkDone":     "[Scan] Walk %s completed: %d files, took %v",
}
