"""后台重试推送：网络恢复后自动 push main + 删旧 tag，并用 API 验证远端状态。"""
import json
import subprocess
import sys
import time
import urllib.request

REPO = 'RainANDCr/studyflow'
EXPECTED_SHA = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True, cwd='E:/zcode/学习工作台/studyflow').stdout.strip()


def get_token():
    out = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', capture_output=True, text=True, timeout=30).stdout
    for line in out.splitlines():
        if line.startswith('password='):
            return line.split('=', 1)[1].strip()


TOKEN = get_token()


def remote_main_sha():
    try:
        req = urllib.request.Request(f'https://api.github.com/repos/{REPO}/branches/main', headers={'Authorization': f'token {TOKEN}', 'User-Agent': 'studyflow-push'})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)['commit']['sha']
    except Exception as e:
        print(f'  API 查询失败: {e}')
        return None


def try_push(args):
    """不带管道，保留 git 退出码。"""
    r = subprocess.run(['git', 'push'] + args, capture_output=True, text=True, cwd='E:/zcode/学习工作台/studyflow', timeout=300)
    tail = (r.stdout or r.stderr).strip().splitlines()
    print(f'  push {" ".join(args)}: exit={r.returncode} | {tail[-1][:150] if tail else ""}')
    return r.returncode == 0


print(f'本地 HEAD: {EXPECTED_SHA}')
for attempt in range(1, 11):
    print(f'--- 第 {attempt}/10 次尝试 ---')
    ok_main = try_push(['origin', 'main'])
    ok_tag = try_push(['origin', '--delete', 'refs/tags/v0.2.2'])
    sha = remote_main_sha()
    print(f'  远端 main: {sha}')
    if sha == EXPECTED_SHA:
        print('=== 推送成功，远端已更新 ===')
        # 验证 tag 是否也删了
        time.sleep(5)
        try:
            req = urllib.request.Request(f'https://api.github.com/repos/{REPO}/git/ref/tags/v0.2.2', headers={'Authorization': f'token {TOKEN}', 'User-Agent': 'studyflow-push'})
            with urllib.request.urlopen(req, timeout=30) as r:
                print('注意：tag v0.2.2 仍存在')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                print('tag v0.2.2 已删除 ✓')
            else:
                print(f'tag 查询: HTTP {e.code}')
        sys.exit(0)
    time.sleep(90)
print('=== 10 次尝试后仍未成功 ===')
sys.exit(1)
