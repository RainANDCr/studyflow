# Windows 构建指南（BUILD_WINDOWS）

产出：可直接运行的 `studyflow.exe`（debug）与 **NSIS `setup.exe` 安装包**（release）。

> ⚠️ 当前状态如实说明：本仓库已包含完整的 Tauri 2 工程配置（`src-tauri/`，含 SQLite 插件、迁移、图标、NSIS 配置），但**本机未安装 Rust 工具链，Windows 产物未在本机验证**。以下步骤按 Tauri 2 官方文档（https://v2.tauri.app/）整理，装好依赖后应可直接复现。

## 1. 环境准备

| 依赖 | 说明 | 校验命令 |
|---|---|---|
| Node.js ≥ 18 | 前端构建（本机已验证 v24） | `node -v` |
| Microsoft C++ Build Tools（MSVC） | Rust MSVC target 的链接器 | 「Visual Studio Installer」中勾选 *使用 C++ 的桌面开发* |
| WebView2 Runtime | Windows 10/11 一般已内置；Server 需安装 | https://developer.microsoft.com/microsoft-edge/webview2/ |
| Rust（rustup，MSVC toolchain） | `rustup-init.exe` 默认选项即可 | `rustc -V`、`cargo -V` |

安装 Rust：https://www.rust-lang.org/tools/install （选 x86_64-pc-windows-msvc）。

## 2. 开发运行（热重载）

```bash
npm install
npm run tauri dev
```

首次会编译 Rust 依赖（数分钟）。窗口打开后：

1. 首次启动会自动插入演示数据（三个示例目标）。
2. 创建一个目标、打卡几条、重启应用 → 数据仍在（SQLite 在应用数据目录 `%APPDATA%/app.studyflow.zxing/`，可在「我的」看到最近写入时间）。

## 3. 构建 NSIS 安装包

```bash
npm run tauri build
```

产物路径（以实际输出为准）：

```text
src-tauri/target/release/studyflow.exe                      # 免安装可执行
src-tauri/target/release/bundle/nsis/*-setup.exe           # NSIS 安装包（currentUser 模式）
```

安装后无需 Node.js、无开发服务器，完全离线运行。

## 4. 数据持久化验证清单

- [ ] 安装后创建目标/打卡 → 完全退出 → 重新打开，数据仍在
- [ ] 「我的」显示 存储方式=本机 SQLite、最近成功写入时间在更新
- [ ] 断网状态下全部功能可用
- [ ] 卸载重装后数据按 NSIS currentUser 行为处理（应用数据目录可能保留，属预期）

## 5. 常见问题

- `error: linker link.exe not found` → 未装 MSVC Build Tools。
- WebView2 报错 → 安装 WebView2 Runtime。
- 杀毒软件误报 debug exe → release 构建或签名（正式分发建议自备代码签名证书）。
- 如需修改产品名/标识：`src-tauri/tauri.conf.json`（`productName` / `identifier`，改 identifier 会改变数据目录位置）。
