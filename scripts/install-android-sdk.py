"""Android SDK 全自动安装：下载 cmdline-tools → 许可 → 安装 platform-tools/NDK/build-tools。"""
import os
import subprocess
import urllib.request

SDK = os.path.join(os.environ['LOCALAPPDATA'], 'Android', 'Sdk')
CT_DIR = os.path.join(SDK, 'cmdline-tools', 'latest')
URL = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
ZIP = os.path.join(SDK, 'cmdline-tools', 'ct.zip')

os.makedirs(os.path.dirname(ZIP), exist_ok=True)
print(f'下载 cmdline-tools（约 150MB）...')
urllib.request.urlretrieve(URL, ZIP)
print('下载完成，解压...')

import zipfile
with zipfile.ZipFile(ZIP) as z:
    z.extractall(os.path.join(SDK, 'cmdline-tools'))
# zip 解出为 cmdline-tools/bin —— 移动到 latest/
src = os.path.join(SDK, 'cmdline-tools', 'cmdline-tools')
if os.path.isdir(src) and not os.path.isdir(CT_DIR):
    os.rename(src, CT_DIR)
os.remove(ZIP)
assert os.path.isfile(os.path.join(CT_DIR, 'bin', 'sdkmanager.bat')), 'sdkmanager 未就位'
print('cmdline-tools 就位')

sdkmanager = os.path.join(CT_DIR, 'bin', 'sdkmanager.bat')
env = {**os.environ, 'JAVA_HOME': ''}


def run(cmd, **kw):
    print('>>', cmd if isinstance(cmd, str) else ' '.join(cmd))
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=1800, **kw)
    print(f'   exit={r.returncode}')
    if r.returncode != 0 and r.stderr:
        print(r.stderr[-600:])
    return r


# 许可
r = run(f'yes | "{sdkmanager}" --licenses', env={**os.environ, 'JAVA_HOME': os.environ.get('JAVA_HOME_17', '')})
# 安装组件（NDK 约 600MB 下载 / 解压约 3GB，耐心）
run(f'"{sdkmanager}" --install "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;27.0.12077973"')

ndk = os.path.join(SDK, 'ndk', '27.0.12077973')
assert os.path.isdir(ndk), 'NDK 未安装成功'
print(f'✅ SDK 全部就位: {SDK}')
print(f'✅ NDK: {ndk}')

# 写入环境变量（用户级，永久）
subprocess.run(['setx', 'ANDROID_HOME', SDK], capture_output=True)
subprocess.run(['setx', 'NDK_HOME', ndk], capture_output=True)
print('✅ ANDROID_HOME / NDK_HOME 已写入用户环境变量（新开终端生效）')
