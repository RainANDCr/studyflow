"""用 git credential 里的 GitHub token 查询 Actions 状态（token 不打印）。"""
import json
import subprocess
import sys
import time
import urllib.request

REPO = 'RainANDCr/studyflow'


def get_token():
    out = subprocess.run(
        ['git', 'credential', 'fill'],
        input='protocol=https\nhost=github.com\n\n',
        capture_output=True,
        text=True,
        timeout=30,
    ).stdout
    for line in out.splitlines():
        if line.startswith('password='):
            return line.split('=', 1)[1].strip()
    return None


def api(path):
    req = urllib.request.Request(
        f'https://api.github.com{path}',
        headers={
            'Authorization': f'token {TOKEN}',
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'studyflow-ci-watch',
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


TOKEN = get_token()
if not TOKEN:
    print('未找到凭据')
    sys.exit(1)

deadline = time.time() + 25 * 60
last = {}
while time.time() < deadline:
    try:
        runs = api(f'/repos/{REPO}/actions/runs?per_page=10').get('workflow_runs', [])
    except Exception as e:  # 网络抖动重试
        print(f'查询失败，重试：{e}')
        time.sleep(15)
        continue
    states = {}
    for r in runs:
        key = r['name']
        states[key] = (r['status'], r.get('conclusion'), r['event'])
        print(f"{r['name']:32s} | {r['event']:8s} | {r['status']:14s} | {r.get('conclusion')}")
    print('---')
    # 两条工作流都出现且非进行中 → 结束
    pages = states.get('Deploy Website (GitHub Pages)')
    release = states.get('Build Installers (EXE + APK)')
    pages_done = pages and pages[0] == 'completed'
    release_done = release and release[0] == 'completed'
    if pages_done and (release_done or release is None):
        break
    time.sleep(30)

print('=== 最终状态 ===')
for name, (status, conclusion, event) in states.items():
    print(f'{name}: {conclusion or status}')
