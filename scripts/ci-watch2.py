"""重跑失败的 Pages 部署，并轮询 Pages + Release 直到全部完成。"""
import json
import subprocess
import time
import urllib.request
import urllib.error

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


TOKEN = get_token()


def api_req(path, method='GET'):
    req = urllib.request.Request(
        f'https://api.github.com{path}',
        headers={
            'Authorization': f'token {TOKEN}',
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'studyflow-ci-watch',
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode('utf-8', errors='replace')
            return resp.status, (json.loads(body) if body and resp.headers.get('Content-Type', '').startswith('application/json') else {})
    except urllib.error.HTTPError as e:
        return e.code, {'message': e.reason}


# 1) 重跑 Pages 失败的 jobs
status, body = api_req('/repos/RainANDCr/studyflow/actions/runs?per_page=5')
runs = body.get('workflow_runs', [])
pages_run = next((r for r in runs if r['name'].startswith('Deploy Website')), None)
if pages_run and pages_run['status'] != 'completed':
    print('Pages 正在运行，无需重跑')
elif pages_run:
    code, resp = api_req(f"/repos/{REPO}/actions/runs/{pages_run['id']}/rerun-failed-jobs", 'POST')
    print(f'Pages 重跑触发: HTTP {code} {resp.get("message", "")}')
    time.sleep(5)

# 2) 轮询两条工作流
deadline = time.time() + 9 * 60
while time.time() < deadline:
    status, body = api_req(f'/repos/{REPO}/actions/runs?per_page=6')
    runs = body.get('workflow_runs', [])
    states = {}
    for r in runs:
        states.setdefault(r['name'], []).append((r['status'], r.get('conclusion'), r['head_sha'][:7]))
    for name, lst in states.items():
        latest = lst[0]
        print(f"{name:32s} | {latest[0]:14s} | {latest[1]} | sha={latest[2]}")
    print('---')
    pages_latest = states.get('Deploy Website (GitHub Pages)', [(None,) * 3])[0]
    release_list = [s for s in states.get('Build Installers (EXE + APK)', []) if s[2] == 'd44e649']
    pages_done = pages_latest[0] == 'completed'
    # Release：最新 tag 运行（d44e649）完成才算
    if release_list and release_list[0][0] == 'completed' and pages_done:
        print('=== 全部完成 ===')
        print(f"Pages: {pages_latest[1]}")
        print(f"Release: {release_list[0][1]}")
        break
    time.sleep(40)
else:
    print('=== 9 分钟内未全部结束（Android 编译耗时较长），稍后再查 ===')
