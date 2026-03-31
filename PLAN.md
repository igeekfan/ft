# FT 开发计划

## 技术架构

```
Go 后端                              React 前端
┌─────────────────┐                  ┌──────────────────────────────┐
│ types.go        │                  │ App.tsx (主布局)              │
│ - FileInfo      │   Wails Bind    │ ├── FolderPanel.tsx          │
│ - DuplicateGroup│ ◄──────────────► │ ├── Results.tsx              │
│ - ScanResult    │                  │ │   └── DuplicateGroup 卡片   │
│                 │                  │ ├── ActionBar.tsx            │
│ scanner.go      │                  │ ├── ConfirmDialog.tsx        │
│ - Scanner       │                  │ ├── FolderBrowser.tsx        │
│ - computeHash() │                  │ └── Settings.tsx             │
│ - StartScan()   │                  └──────────────────────────────┘
│ - PauseScan()   │
│ - ResumeScan()  │                  SQLite 存储
│ - CancelScan()  │                  ┌─────────────────┐
│                 │                  │ store.go        │
│ app.go          │                  │ - SaveScanResult│
│ - StartScan     │                  │ - GetStats      │
│ - PauseScan     │                  │ - GetGroups     │
│ - ResumeScan    │                  │ - GetAllGroups  │
│ - CancelScan    │                  └─────────────────┘
│ - DeleteFiles   │
│ - ExportResults │
│ - OpenPath      │
│ - OpenFileLocation │
│ - OpenFile      │
│ - GetScanStats  │
│ - GetGroupsPage │
└─────────────────┘
```

---

## 已实现

| 功能 | 说明 |
|------|------|
| 多文件夹扫描 | 支持添加多个文件夹，基于 MD5 哈希查重 |
| 内置文件浏览器 | 可视化浏览磁盘和目录 |
| 分组展示结果 | 重复文件按组显示，按浪费空间降序 |
| 文件类型过滤 | 按视频/图片/音频/文档/压缩包/其他分类过滤 |
| 快速批量选择 | 按文件夹批量勾选、组内全选/取消 |
| 安全删除 | 单个/批量删除，确认弹窗 |
| 暂停/继续/取消 | 扫描过程中支持暂停、继续、取消 |
| 打开文件位置 | 在系统文件管理器中定位文件 |
| 打开文件 | 用默认程序打开文件 |
| 导出 CSV | 扫描结果导出为 CSV（含 file:// 链接列，导出后自动打开文件夹） |
| 深色/浅色主题 | 主题切换，自动保存偏好 |
| 状态持久化 | 文件夹列表和扫描结果自动保存到 localStorage |
| 最小文件大小过滤 | 扫描时可设置最小文件大小阈值，跳过小文件 |
| 扫描耗时统计 | 显示扫描耗时，格式化为秒/分钟 |
| 排序选项 | 支持按浪费空间↓、文件大小↓、文件数量↓、哈希值 A-Z 排序 |
| 文件名搜索过滤 | 搜索框按文件名过滤重复组 |
| 排除文件夹 | 可设置要排除的文件夹路径 |
| SQLite 存储 | 扫描结果持久化到 SQLite 数据库 |
| 分页显示 | 支持分页加载大量重复组 |

### 核心实现

**扫描流程：**
1. `countFiles()` 统计总文件数
2. `filepath.WalkDir` 递归遍历
3. 跳过排除文件夹和小于最小大小的文件
4. `computeHash()` 流式计算 MD5（64KB 分块）
5. `map[string][]FileInfo` 按哈希分组
6. 过滤单文件组，返回 `ScanResult`
7. 保存到 SQLite 数据库

**暂停机制：**
- `Scanner` 结构体持有 `context.CancelFunc` 和 `pauseCh chan struct{}`
- `PauseScan()` 发送信号到 pauseCh，WalkDir 回调中检测并阻塞
- `ResumeScan()` 再次发送信号解除阻塞
- `CancelScan()` 调用 cancel() 终止上下文

**SQLite 存储：**
- `store.go` 实现数据持久化层
- 支持分页查询、排序（浪费空间/文件大小/文件数量/哈希值）
- 支持文件名搜索过滤
- 数据库路径: `~/.cache/ft/scan.db`

---

## TODO

### 1. ~~最小文件大小过滤~~ ✅ 已完成

- **后端** `scanner.go`: `StartScan` 增加 `minSize int64` 参数，WalkDir 中跳过 `info.Size() < minSize`
- **后端** `app.go`: 签名变为 `StartScan(folders []string, minSize int64, excludeFolders []string)`
- **前端** `Settings.tsx`: 最小文件大小输入框 + 单位选择（B/KB/MB/GB）
- **前端** `App.tsx`: 传递 minSize

### 2. ~~扫描耗时统计~~ ✅ 已完成

- **后端** `types.go`: `ScanResult` 加 `ScanDuration string` 字段
- **后端** `scanner.go`: 记录 `time.Now()` 开始，结束时算差值，格式化为 `"3.2s"` / `"1m 5s"`
- **前端** `App.tsx`: header 区域显示耗时

### 3. ~~排序选项~~ ✅ 已完成

- `Results.tsx` 增加 `sortKey` state
- 排序方式：浪费空间↓（默认）、文件大小↓、文件数量↓、哈希值 A-Z
- filter bar 加排序按钮组

### 4. ~~文件名搜索过滤~~ ✅ 已完成

- `Results.tsx` 增加搜索输入框 + `searchQuery` state
- 按文件名过滤重复组（支持防抖）

### 5. ~~智能选择旧文件~~ ✅ 已完成

### 6. ~~修复打开文件位置 + 打开文件~~ ✅ 已完成

- `Results.tsx` 已使用 `OpenFileLocation` / `OpenFile` Wails 绑定
- `app.go` 新增 `OpenFile` 方法
- `ExportResults` 导出后自动打开文件夹

### 7. ~~排除文件夹~~ ✅ 已完成

- **后端** `scanner.go`: `StartScan` 增加 `excludeFolders []string` 参数
- **前端** `Settings.tsx`: 排除文件夹输入框和列表管理
- 支持排除多个文件夹路径

### 8. ~~SQLite 存储~~ ✅ 已完成

- **后端** `store.go`: 实现 SQLite 存储层
- 支持保存扫描结果、分页查询、排序和搜索
- 数据库路径: `~/.cache/ft/scan.db`

### 后续建议

| 优先级 | 建议 | 说明 |
|--------|------|------|
| P0 | 错误边界 | ErrorBoundary 组件兜底崩溃，防止白屏 |
| P0 | 回收站删除 | `os.Remove` 永久删除不可逆，用系统回收站替代 |
| P1 | 默认忽略目录 | 自动跳过 `.git`、`node_modules`、`$RECYCLE.BIN` |
| P1 | 并行哈希 | goroutine worker pool 并行计算 MD5，提速数倍 |
| P2 | 文件预览 | 图片/视频缩略图 |
| P2 | 键盘快捷键 | Delete / Ctrl+A / Escape |
| P3 | 忽略规则配置 | 用户自定义跳过特定扩展名/大小/目录 |

### 文件变更清单（已完成）

| 文件 | 变更 |
|------|------|
| `types.go` | +ScanDuration 字段 ✅ |
| `scanner.go` | +minSize 参数、+耗时统计、+excludeFolders 参数 ✅ |
| `store.go` | 新增 SQLite 存储层 ✅ |
| `app.go` | StartScan 签名变更、+GetScanStats、+GetGroupsPage ✅ |
| `App.tsx` | minSize 传参、耗时展示、Settings 集成、分页加载 ✅ |
| `Settings.tsx` | 新增设置对话框（最小大小、文件类型、排除文件夹） ✅ |
| `Results.tsx` | 排序、搜索、分页 ✅ |
| `ActionBar.tsx` | 智能选择按钮 ✅ |

### 验证

1. `go build ./...`
2. `npm run build`（frontend 目录）
3. `wails dev` 功能测试
