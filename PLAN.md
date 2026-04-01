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

## 当前状态

当前已实现功能以 [README.md](README.md) 为准，PLAN 仅保留后续开发方向和仍未完成的事项，避免文档重复维护。

## 待办

| 优先级 | 事项 | 说明 |
|--------|------|------|
| P3 | 删除撤销 | 当前删除走系统回收站，若要支持可靠撤销，需要设计受控的恢复方案 |

## 后续方向

- 删除体验：评估自管回收站或平台级恢复能力，补齐撤销删除
- 结果能力：继续优化大批量结果场景下的交互效率与稳定性
- 扫描能力：在保持准确性的前提下继续优化超大目录和大文件扫描体验
- 文档维护：产品功能说明集中放在 README，PLAN 只记录后续规划和未完成项
