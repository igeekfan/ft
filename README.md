# FT - 文件查重工具

基于 Wails v2 + React + TypeScript 开发的跨平台文件查重桌面应用。

## 功能特性

- **多文件夹扫描** - 支持添加多个文件夹进行扫描
- **内置文件浏览器** - 可视化浏览磁盘和目录，无需手动输入路径
- **MD5 哈希查重** - 基于文件内容计算 MD5，准确识别重复文件
- **分组展示结果** - 重复文件按组显示，按浪费空间降序排列
- **快速批量选择** - 支持按文件夹批量勾选重复文件
- **安全删除** - 删除前弹窗确认，支持批量删除
- **打开文件位置** - 一键在系统文件管理器中定位文件
- **深色/浅色主题** - 支持主题切换，自动保存偏好
- **状态持久化** - 文件夹列表和扫描结果自动保存

## 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | [Wails v2](https://wails.io/) |
| 后端 | Go 1.23 |
| 前端 | React 18 + TypeScript |
| 构建工具 | Vite |
| UI 组件 | shadcn/ui + Tailwind CSS |
| 图标 | Lucide React |

## 下载

前往 [Releases](https://github.com/igeekfan/ft/releases) 页面下载对应平台的安装包。

| 平台 | 安装包 | 便携版 |
|------|--------|--------|
| Windows | `FT_Setup_{version}_windows_x64.exe` | `FT_Portable_{version}_windows_x64.zip` |
| macOS | `FT_{version}_mac_arm64.dmg` / `FT_{version}_mac_intel.dmg` | - |
| Linux | `ft_{version}_linux_amd64.deb` | `ft_{version}_linux_amd64.AppImage` |

## 开发

### 前置要求

- Go 1.23+
- Node.js 18+
- [Wails CLI](https://wails.io/docs/gettingstarted/installation)

### 运行开发模式

```bash
wails dev
```

### 构建

```bash
# 构建前端
cd frontend && npm install && npm run build && cd ..

# 构建应用
wails build
```

构建产物位于 `build/bin/` 目录。

## 项目结构

```
.
├── main.go              # 入口文件，Wails 应用配置
├── app.go               # App 结构体，绑定到前端的方法
├── scanner.go           # 文件扫描与哈希计算逻辑
├── types.go             # 数据结构定义
├── go.mod / go.sum      # Go 模块依赖
├── wails.json           # Wails 项目配置
├── frontend/
│   ├── src/
│   │   ├── App.tsx      # 主布局组件
│   │   ├── types.ts     # TypeScript 类型定义
│   │   └── components/  # UI 组件
│   └── package.json     # 前端依赖
└── build/               # 构建资源
```

## 截图

<!-- 添加应用截图 -->
<!-- ![screenshot](screenshots/main.png) -->

## License

MIT