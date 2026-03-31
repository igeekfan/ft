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
| ~~P0~~ | ~~错误边界~~ | ✅ ErrorBoundary 组件兜底崩溃，防止白屏 |
| ~~P0~~ | ~~回收站删除~~ | ✅ 用系统回收站替代 `os.Remove` |
| ~~P1~~ | ~~默认忽略目录~~ | ✅ 自动跳过 `.git`、`node_modules`、`$RECYCLE.BIN` 等 |
| ~~P1~~ | ~~并行哈希~~ | ✅ goroutine worker pool 并行计算 MD5 |
| ~~P1~~ | ~~多语言支持~~ | ✅ i18n 中英文切换 |
| **P1** | **大文件哈希优化** | 大文件 MD5 慢，需优化。见下方详细方案 |
| P2 | 文件预览 | 图片/视频缩略图 |
| P2 | 键盘快捷键 | Delete / Ctrl+A / Escape |
| P2 | 扫描历史 UI | 查看/恢复历史扫描结果 |
| P2 | 自动更新机制 | 检测新版本，提示更新 |
| P3 | 忽略规则配置 | 用户自定义跳过特定扩展名/大小/目录 |
| P3 | 删除撤销 | 支持撤销删除操作 |
| P3 | 符号链接处理 | 跳过/跟随/仅报告 |
| P3 | 隐藏文件开关 | Settings 增加是否扫描隐藏文件 |
| P3 | 文件名查重模式 | 除 MD5 外，支持按文件名查重 |
| P3 | 设置导入导出 | 备份/恢复扫描配置 |
| P3 | 磁盘空间分析 | 按文件类型统计占用 |

---

### 多语言支持方案（P1）

**目标**：支持中文（zh-CN）和英文（en-US），用户可切换，偏好持久化。

**架构**：轻量 context + JSON 翻译文件，不引入重型 i18n 库。

```
frontend/src/
├── i18n/
│   ├── context.tsx       # I18nProvider + useI18n hook
│   ├── zh-CN.ts          # 中文翻译
│   └── en-US.ts          # 英文翻译
├── main.tsx              # 包裹 I18nProvider
└── components/
    └── Settings.tsx      # 增加语言选择下拉
```

**实现步骤**：

1. **创建 `i18n/context.tsx`**
   - `I18nProvider`：管理当前语言 state，从 localStorage 读取/保存
   - `useI18n()` hook：返回 `{t, lang, setLang}`
   - `t(key: string)`：按 key 查翻译，支持 `t('settings.minSize')` 点号路径
   - 支持插值：`t('results.wasted', {size: '1.2 MB'})`

2. **创建翻译文件**
   - `zh-CN.ts`：导出嵌套对象，包含所有 UI 文案
   - `en-US.ts`：英文对应翻译
   - 需要翻译的文本来源（逐组件扫描）：
     - App.tsx: "文件夹"、"添加"、"夜间/日间"、"扫描文件"、"重复文件" 等
     - Results.tsx: "搜索文件名..."、"全部"、"视频/图片/音频/文档/压缩包/其他"、"浪费↓" 等
     - Settings.tsx: "扫描设置"、"最小文件大小"、"扫描文件类型"、"排除文件夹" 等
     - FolderPanel.tsx: "暂无文件夹"、"开始扫描"、"暂停/继续/取消" 等
     - ActionBar.tsx: "共 X 组重复"、"全选"、"删除选中" 等
     - ConfirmDialog.tsx: "确认删除"、"取消"、"确认删除" 等
     - FolderBrowser.tsx: "选择文件夹"、"上级"、"选择此文件夹" 等

3. **修改 `main.tsx`**
   - 用 `I18nProvider` 包裹 `ErrorBoundary > App`

4. **修改 `Settings.tsx`**
   - 增加"语言"选择：中文 / English
   - 切换即时生效，写入 localStorage

5. **各组件替换硬编码文案**
   - 导入 `useI18n`，用 `t('key')` 替换所有中文字符串
   - 保持组件逻辑不变，只替换显示文本

**localStorage key**: `duplicate-scanner-lang`（默认 `zh-CN`）

**不翻译的部分**：
- Wails 自动生成的方法名/类型名
- 文件路径、哈希值等动态数据
- Go 后端（后端不涉及 UI 文案）

### 额外建议（基于目标分析）

| 优先级 | 建议 | 说明 | 收益 |
|--------|------|------|------|
| **P1** | **智能选择旧文件** | PLAN 标记已完成但 UI 无入口。自动勾选每组中较旧/较深路径的副本，一键清理 | 核心价值，减少手动逐个勾选 |
| **P1** | **扫描历史** | SQLite 有 `scans` 表但无 UI。增加历史记录面板，可查看/恢复上次扫描结果 | 避免重复扫描，提升体验 |
| P2 | 按文件名查重 | 当前仅按 MD5 哈希。增加按文件名查重模式（同名不同内容） | 覆盖更多重复场景 |
| P2 | 删除撤销 | 当前删除不可撤销（即使回收站也可能误操作）。增加内存级撤销队列 | 安全性提升 |
| P2 | 符号链接处理 | `scanner.go` 未显式处理 symlink。可选跳过/跟随/仅报告 | 避免循环扫描 |
| P2 | 隐藏文件开关 | 当前无选项控制是否扫描隐藏文件。Settings 增加 toggle | 用户控制粒度 |
| P3 | 磁盘空间分析 | 按文件类型统计磁盘占用，展示饼图/柱状图 | 增值功能 |
| P3 | 设置导入导出 | 用户可备份/恢复扫描配置（排除规则、最小大小等） | 团队/多设备场景 |

### 大文件哈希优化方案（P1）

**问题**：大文件（>1GB）MD5 计算慢，扫描耗时长。

**优化思路**（多种方案可组合）：

| 方案 | 说明 | 预期收益 |
|------|------|----------|
| **1. 更快的哈希算法** | 用 xxHash/BLAKE3 替代 MD5。xxHash 比 MD5 快 5-10 倍，BLAKE3 比 MD5 快 10-20 倍且更安全 | ⭐⭐⭐⭐⭐ |
| **2. 增大缓冲区** | 当前 64KB，可增至 1MB/4MB，减少 IO 次数 | ⭐⭐⭐ |
| **3. 采样哈希** | 大文件只取首/中/尾各 64KB 计算哈希（可选） | ⭐⭐⭐⭐ |
| **4. 硬件加速** | 使用 SIMD 指令集（需 cgo 或汇编） | ⭐⭐⭐ |
| **5. 分块并行** | 大文件分块，多 goroutine 并行计算 | ⭐⭐⭐ |

**推荐实现**：

1. **引入 xxHash**（github.com/cespare/xxhash/v2）
   - 纯 Go 实现，无 cgo 依赖
   - 比 MD5 快 5-10 倍
   - 64 位哈希，碰撞率极低（足够用于文件查重）

2. **可选：采样模式**
   - Settings 增加「大文件采样」开关
   - 开启后：文件 >100MB 时只取首/中/尾各 64KB
   - 风险：极小概率误判（不同文件采样相同），但实际几乎不会发生

3. **可选：多算法支持**
   - Settings 增加「哈希算法」选择：MD5 / xxHash / BLAKE3
   - 默认 xxHash（速度优先）

**实现步骤**：

1. 添加 xxHash 依赖：`go get github.com/cespare/xxhash/v2`
2. 修改 `scanner.go`：`computeHashBuf` 支持多种算法
3. 修改 `types.go`：`ScanResult` 增加 `HashAlgorithm string` 字段
4. 前端 Settings：增加算法选择和采样开关
5. 测试：大文件扫描速度对比

### 开发流程规范

**每个 TODO 完成后必须自动提交代码**，形成闭环：

1. 实现功能
2. 验证编译（`go build ./...` + `npm run build`）
3. 自动提交：`git add -A && git commit -m "<type>: <description>"`
4. 自动推送：`git push`
5. 更新 PLAN.MD 标记完成 ✅

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
