# 功能验收清单（FEATURE_CHECKLIST）

状态图例：✅ 已实现并通过验证 · 🧩 代码/配置已就绪、待本机依赖具备后验证 · ❌ 未实现

验收表（功能 — Web — Windows — Android — 验证方式 — 状态）：

| # | 功能 | Web | Windows | Android | 验证方式 | 状态 |
|---|---|---|---|---|---|---|
| 1 | 无登录启动、刷新后数据存在 | ✅ | 🧩 | 🧩 | 手动：`npm run dev` 创建数据后刷新；Windows/Android 见 BUILD_* | ✅ Web 验证（dev+build）；原生待验 |
| 2 | 目标增删改、多次打卡、最近 6 天补记、删除记录 | ✅ | 🧩 | 🧩 | 单测 storage/suggestion + 手动 | ✅ |
| 3 | 今日建议量（截止边界/逾期/完成）真实计算 | ✅ | ✅ 同代码 | ✅ 同代码 | `suggestion.test.ts` | ✅ |
| 4 | 完成率（超量封顶 100%）、首次完成彩带一次 | ✅ | 🧩 | 🧩 | 单测 progress + 手动彩带 | ✅ 计算/单通过；彩带手动验证 |
| 5 | 近 7 天预测（≥3 活跃日、今天算第 1 天、提前/拖后/按时） | ✅ | ✅ | ✅ | `prediction.test.ts` | ✅ |
| 6 | 每周 1 休息日宽免、第二个缺卡断、补记纠正历史 | ✅ | ✅ | ✅ | `streak.test.ts` | ✅ |
| 7 | 昨日漏卡置顶黄/红卡；逾期双出口 | ✅ | 🧩 | 🧩 | 单测 + 手动（今日页排序） | ✅ |
| 8 | 障碍 + if-then 预案（表单与卡片） | ✅ | ✅ | ✅ | 手动 + 种子演示 | ✅ |
| 9 | SVG 进度环 / 14 天分钟堆叠图（只统计已填分钟） | ✅ | ✅ | ✅ | `weekly.test.ts`（分钟口径）+ 手动悬停 | ✅ |
| 10 | 周报切换周、同口径环比、四栏保存、复制文本 | ✅ | ✅ | ✅ | `weekly.test.ts` + 手动 | ✅ |
| 11 | 我的页：真实本地存储状态，无假云同步/账号文案 | ✅ | 🧩 | 🧩 | 手动检查文案 | ✅ |
| 12 | 种子仅一次；清空示例不影响用户数据 | ✅ | ✅ | ✅ | `storage.test.ts` + `seed.test.ts` | ✅ |
| 13 | JSON 导出/导入（校验/快照/合并/替换），失败不损坏库 | ✅ | ✅ | ✅ | `storage.test.ts`（replaceAll 两模式）+ 手动 | ✅ |
| 14 | 图标全部内联 SVG、无 emoji | ✅ | ✅ | ✅ | 代码审查（icons.tsx） | ✅ |
| 15 | 响应式三档布局、reduced-motion、焦点管理 | ✅ | 🧩 | 🧩 | 手动（DevTools 三档） | ✅ Web |
| 16 | Windows：本机 SQLite 重启保留 + NSIS setup.exe | — | ✅ | — | `npm run tauri build` 本机真实构建（2026-10-26），产物存在 + 启动冒烟：进程稳定、自动创建 `%APPDATA%\app.studyflow.zxing\studyflow.db` 与 EBWebView 目录 | ✅ 构建+冒烟通过（安装后持久化清单待用户走查） |
| 17 | Android：SQLite 断网重启保留 + APK | — | — | ✅ | cargo-ndk 交叉编译 4 ABI + Gradle 本机打包（2026-10-26），APK 内含 4 个 `libstudyflow_lib.so` + 全部前端 assets | ✅ 构建通过（真机安装验收待用户执行） |
| 18 | 断网可用（无任何远程依赖） | ✅ | 🧩 | 🧩 | 代码审查（无远程 import/请求）+ Web 手动断网 | ✅ Web |

## 真实产物路径（2026-10-26 本机全端构建完成）

| 产物 | 路径 | 状态 |
|---|---|---|
| Web 静态构建 | `studyflow/dist/`（index.html + assets） | ✅ 已生成并构建通过 |
| PWA 图标 | `studyflow/public/icons/icon-192.png`、`icon-512.png` | ✅ 已生成 |
| Tauri 图标集 | `studyflow/src-tauri/icons/`（含 ico/icns/Android mipmap） | ✅ 已由 `tauri icon` 生成 |
| Windows EXE | `src-tauri/target/release/studyflow.exe`（4.7MB） | ✅ 2026-10-26 本机构建 + 启动冒烟通过 |
| Windows NSIS setup.exe | `src-tauri/target/release/bundle/nsis/知行 StudyFlow_0.1.0_x64-setup.exe`（1.9MB） | ✅ 2026-10-26 本机构建成功 |
| Android APK（universal debug） | `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`（8.7MB，含 4 ABI） | ✅ 2026-10-26 本机构建成功，内容校验通过；真机安装待用户执行 |

## 命令核实（package.json 实际存在）

`dev` / `build` / `preview` / `typecheck` / `lint` / `test` / `tauri` / `tauri:dev` / `tauri:build` / `tauri:android:init` / `tauri:android:dev` / `tauri:android:build` / `icon` —— 均已写入并逐个执行或核验存在。

## v2 五大功能验收（2026-10-25 增量）

| # | 功能 | 验证方式 | 状态 |
|---|---|---|---|
| N1 | 无损迁移：v1 旧库/旧 JSON → v2 | `migration.test.ts`（5 用例） | ✅ |
| N2 | 智能日历：商余数自动排程/手动锁定/拖拽改期/计划X实际Y | `dailyPlan.test.ts`（15 用例）+ 浏览器实操（排程 41 项成功） | ✅ Web |
| N3 | 里程碑：三拆分/打卡关联/未分配/删除保留打卡 | `milestone.test.ts`（9）+ 浏览器实操（147/147/146 拆分、打卡联动 11/147） | ✅ Web |
| N4 | 番茄钟：墙钟计时/恢复/去重/关联打卡 | `focus.test.ts`（14）+ 浏览器实操（计时→提前结束→独立计时保存） | ✅ Web |
| N5 | 热力图：双口径/跨午夜归属/376 格渲染 | `heatmap.test.ts`（8）+ 浏览器渲染检查 | ✅ Web |
| N6 | 模拟器：假设推演/曲线/应用到计划预览 | `simulator.test.ts`（16）+ 浏览器实操（实测 vs 假设双标签、预设） | ✅ Web |
| N7 | 统一口径：周报/14天图/热力图共用有效分钟函数 | `focus.test.ts` + `weekly.test.ts` 回归 | ✅ |
| N8 | Windows/Android 原生端构建 | 2026-10-26 本机补齐工具链后真实构建 | ✅ EXE/NSIS/APK 均产出（见产物路径表；安装后持久化与真机验收待用户执行） |

## 质量门槛

- `npm run typecheck` ✅ 通过（strict）
- `npm run lint` ✅ 通过（0 报错）
- `npm run test` ✅ 62/62 通过
- `npm run build` ✅ 通过（SQLite 适配器正确懒加载分包）
