# FT

[English](README.md) | [简体中文](README.zh-CN.md)

FT is a cross-platform desktop duplicate finder designed for cleaning duplicate files, organizing same-name files, and understanding how much disk space duplicated content is wasting.

## Overview

- Scan multiple folders with a built-in folder browser for fast drive and directory selection
- Support both duplicate-by-content and duplicate-by-filename workflows for exact cleanup and same-name organization
- Configure file type filters, minimum file size, excluded folders, excluded extensions, hidden file scanning, and symlink handling
- Run parallel scans with live progress logs, pause, resume, and cancel support for large folders
- Choose between xxHash and MD5, with large-file sampling for better performance on heavy workloads
- Review duplicate results with grouping, search, sorting, pagination, and folder-based quick filtering
- Preview images, videos, and audio files directly from the result list, and open files or reveal them in the system file manager
- Use smart selection, batch selection, and safe deletion through the system recycle bin or trash
- Reopen previous scans through built-in scan history
- Analyze duplicate space usage by file type to see where the biggest waste is
- Export CSV reports, import or export settings, switch themes, use the app in Chinese or English, and receive update checks on startup

## Common Use Cases

- Clean duplicate downloads, media libraries, and backup folders
- Organize same-name documents, screenshots, and design assets
- Scan large storage volumes to find the most expensive duplicate files first
- Export results for archiving, sharing, or follow-up processing

## Downloads

You can download the latest builds from [Releases](https://github.com/igeekfan/ft/releases).

| Platform | Installer | Portable |
|------|--------|--------|
| Windows | `FT_Setup_{version}_windows_x64.exe` | `FT_Portable_{version}_windows_x64.zip` |
| macOS | `FT_{version}_mac_arm64.dmg` / `FT_{version}_mac_intel.dmg` | - |
| Linux | `ft_{version}_linux_amd64.deb` | `ft_{version}_linux_amd64.AppImage` |

## Development

Requirements: Go 1.23+, Node.js 18+, and [Wails CLI](https://wails.io/docs/gettingstarted/installation)

Development mode:

```bash
wails dev
```

Build:

```bash
cd frontend && npm install && npm run build && cd ..
wails build
```

Build outputs are generated in `build/bin/`.

## Stack

- Wails v2
- Go
- React + TypeScript
- Vite
- Tailwind CSS + shadcn/ui

## License

MIT