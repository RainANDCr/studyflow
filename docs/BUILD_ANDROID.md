# Android 构建指南（BUILD_ANDROID）

产出：可安装到真机的 **APK**（debug 与 release 两种），复用同一 Tauri 2 工程（不另写 Android 项目）。

> ✅ 2026-10-26 已本机验证：产出 `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`（8.7MB，含 4 个 ABI 的 `libstudyflow_lib.so` + 全部前端 assets）。真机安装验收待用户执行。
>
> 本机环境：Android SDK 在 `E:\develop\Android\Sdk`（platform 34/37、build-tools 34、NDK 27.1）、Temurin JDK 21 在 `E:\develop\Android\jdk`、Rust 4 个 android target。
>
> **本机构建三条坑（均已解决，留档）**：
> 1. 未开启 Windows 开发者模式时 Tauri CLI 无法创建符号链接（jniLibs 部署失败）→ 改用 `cargo ndk -t arm64-v8a -t armeabi-v7a -t x86 -t x86_64 -o gen/android/app/src/main/jniLibs build --release` 交叉编译并复制；前端 dist 需手动拷贝到 `gen/android/app/src/main/assets/`。
> 2. AGP 拒绝含中文的项目路径（「学习工作台」）→ `mklink /J E:\zcode\studyflow-b <项目路径>` 建 ASCII 联接，从联接路径跑 Gradle；`gradle.properties` 中 `android.overridePathCheck=true` 保留。
> 3. `local.properties` 的 `sdk.dir` 用正斜杠写法（`E:/develop/Android/Sdk`），反斜杠转义错误会报「文件名、目录名或卷标语法不正确」。
>
> Gradle 打包命令（从联接路径，排除 rust 任务）：
> ```bash
> cd E:\zcode\studyflow-b\src-tauri\gen\android
> ./gradlew.bat assembleUniversalDebug -x rustBuildUniversalDebug -x rustBuildArm64Debug -x rustBuildArmDebug -x rustBuildX86Debug -x rustBuildX86_64Debug
> ```

## 1. 环境准备

| 依赖 | 说明 |
|---|---|
| Android Studio | SDK Manager 安装：Android SDK Platform（API 34）、SDK Platform-Tools、NDK（r27 系列）、CMake |
| JDK 17+ | Android Gradle Plugin 要求（本机已有 JDK 25 可用） |
| Rust Android targets | `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android` |
| 环境变量 | `ANDROID_HOME`（或 `NDK_HOME`）指向 SDK/NDK 目录，例如 `set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk` |

校验：Android Studio → Settings → Languages & Frameworks → Android SDK 可看到 SDK/NDK 路径；`rustup target list --installed` 包含 aarch64。

## 2. 初始化与开发运行

```bash
npm install
npm run tauri android init      # 生成 src-tauri/gen/android（已 gitignore）
npm run tauri android dev       # 连接真机（开启 USB 调试）或模拟器运行
```

真机验证要点：

- 首次启动插入演示数据；创建目标/打卡 → 杀进程重开 → 数据仍在（应用私有目录 SQLite）。
- 飞行模式下全部功能可用。
- 底部 Tab 避让系统导航栏（safe-area）、软键盘弹出表单可完整输入、竖屏/横屏布局正常、触摸目标尺寸舒适。

## 3. 打包 APK

### 调试 APK（自己安装测试）

```bash
npm run tauri android build -- --apk
```

产物：`src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
（具体目录以命令实际输出为准；debug APK 用调试密钥签名，仅用于测试，不适合分发。）

### 正式可分发 APK（release，需自签）

1. 生成自己的密钥库（一次性，**私钥绝不提交仓库**）：

   ```bash
   keytool -genkey -v -keystore studyflow-release.keystore -alias studyflow -keyalg RSA -keysize 2048 -validity 10000
   ```

2. 在 `src-tauri/gen/android/gradle.properties`（或 local.properties，勿提交）配置签名读取路径与密码，`build.gradle.kts` 的 release 块引用之。
3. `npm run tauri android build -- --apk --target aarch64`（或 universal）。

产物：`src-tauri/gen/android/app/build/outputs/apk/universal/release/` 下的 unsigned/signed APK。

**签名要求说明**：

- debug 与 release 的区别：debug 用 Android SDK 自动生成的调试密钥签名，方便卸载重装与日志排查，不对外分发；release 用你的私有密钥签名，体积更小、可上架或直接分发。
- **升级必须同签名**：用户手机上已装的 APK 只能被「相同包名 + 相同签名密钥」的新版本覆盖安装；密钥丢失将无法向老用户推升级，请把 keystore 与密码离线妥善备份。

## 4. 权限最小化

本应用不联网、不读通讯录/存储，AndroidManifest 由 Tauri 生成的基础权限即可；如需上传 Play 需再按目标 API 级别适配审阅要求（当前未做，属未验证项）。
