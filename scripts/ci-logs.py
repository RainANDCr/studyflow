"""用 curl 拉取失败 job 的错误日志（token 不打印）。"""
import json
import subprocess

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


def curl_json(path):
    out = subprocess.run(
        ['curl', '-s', '--retry', '5', '--retry-delay', '3', '-H', f'Authorization: token {TOKEN}',
         '-H', 'Accept: application/vnd.github+json', f'https://api.github.com{path}'],
        capture_output=True, text=True, timeout=120,
    )
    return json.loads(out.stdout)


def curl_log(path):
    out = subprocess.run(
        ['curl', '-sL', '--retry', '5', '--retry-delay', '3', '-H', f'Authorization: token {TOKEN}',
         f'https://api.github.com{path}'],
        capture_output=True, text=True, timeout=180,
    )
    return out.stdout


TOKEN = get_token()
runs = curl_json(f'/repos/{REPO}/actions/runs?per_page=6').get('workflow_runs', [])
for run in runs:
    if run.get('conclusion') != 'failure':
        continue
    print(f"===== {run['name']} (event={run['event']}) run_id={run['id']} =====")
    jobs = curl_json(f"/repos/{REPO}/actions/runs/{run['id']}/jobs")
    for job in jobs.get('jobs', []):
        print(f"\n--- job: {job['name']} -> {job['conclusion']} ---")
        if job['conclusion'] == 'success':
            continue
        log = curl_log(f"/repos/{REPO}/actions/jobs/{job['id']}/logs")
        error_lines = [l for l in log.splitlines() if '##[error]' in l or 'npm error' in l or 'error:' in l.lower()]
        seen = set()
        for l in error_lines[-30:]:
            key = l[:160]
            if key not in seen:
                seen.add(key)
                print(l[:240])
