"""本地 APK 构建一条龙：init → build → debug-key 签名。"""
import os
import subprocess

ROOT = 'E:/zcode/学习工作台/studyflow'
SDK = os.path.join(os.environ['LOCALAPPDATA'], 'Android', 'Sdk')
NDK = os.path.join(SDK, 'ndk', '27.0.12077973')
JDK17 = next(d for d in [f'C:/Program Files/Eclipse Adoptium/jdk-17.0.20.101-hotspot'] if os.path.isdir(d))

env = {**os.environ,
       'PATH': f"{JDK17}/bin;{SDK}/platform-tools;{os.environ.get('PATH', '')}",
       'JAVA_HOME': JDK17,
       'ANDROID_HOME': SDK,
       'NDK_HOME': NDK}
print(f'ANDROID_HOME={SDK}')
print(f'NDK_HOME={NDK}')
print(f'JAVA_HOME={JDK17}')


def run(cmd, timeout=3600):
    print(f'>> {cmd}', flush=True)
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, cwd=ROOT, env=env)
    if r.returncode != 0:
        tail = (r.stderr or r.stdout).strip().splitlines()[-25:]
        print('!!! 失败输出：')
        for l in tail:
            print('   ' + l[:220])
        raise SystemExit(1)
    return r


# 1) 初始化 Android 工程（gen/ 不在仓库中）
if not os.path.isdir(os.path.join(ROOT, 'src-tauri', 'gen', 'android')):
    run('npm run tauri android init', timeout=600)
else:
    print('gen/android 已存在，跳过 init')

# 2) 构建 release APK（4 个 Rust target，10-20 分钟）
run('npm run tauri android build -- --apk', timeout=3600)

apk_dir = os.path.join(ROOT, 'src-tauri', 'gen', 'android', 'app', 'build', 'outputs', 'apk', 'universal', 'release')
unsigned = os.path.join(apk_dir, 'app-universal-release-unsigned.apk')
assert os.path.isfile(unsigned), f'APK 未产出: {unsigned}'
print(f'✅ APK 已构建: {unsigned} ({os.path.getsize(unsigned)/1048576:.1f} MB)')

# 3) 用 debug 密钥签名（可安装）
bt = os.path.join(SDK, 'build-tools', '34.0.0')
ks = os.path.join(os.environ['USERPROFILE'], '.android', 'debug.keystore')
if not os.path.isfile(ks):
    run(f'"{JDK17}/bin/keytool" -genkeypair -v -keystore "{ks}" -storepass android -alias androiddebugkey -keypass android -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -validity 10000')
signed = os.path.join(apk_dir, 'app-universal-release-signed.apk')
run(f'"{bt}/zipalign.exe" -f 4 "{unsigned}" "{signed}"')
run(f'"{bt}/apksigner.bat" sign --ks "{ks}" --ks-pass pass:android --key-pass pass:android "{signed}"')
r = run(f'"{bt}/apksigner.bat" verify "{signed}"')
print(f'✅ 签名验证通过')

# 4) 复制到桌面
import shutil
dest = r'C:\Users\Crain\Desktop\知行StudyFlow.apk'
shutil.copy2(signed, dest)
print(f'✅ 已复制到桌面: {dest} ({os.path.getsize(dest)/1048576:.1f} MB)')
