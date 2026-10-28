"""Install/remove only this user's local paper bridge; no Ollama settings change."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import socket
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
LABEL = 'local.jiebi.bridge'
TARGET = f'gui/{os.getuid()}/{LABEL}'
PLIST = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
LOGS = Path.home() / 'Library/Logs/Jiebi'


def configuration():
    return {'Label': LABEL, 'ProgramArguments': [str(ROOT / '.venv/bin/python'), str(ROOT / 'study.py')],
            'WorkingDirectory': str(ROOT), 'RunAtLoad': True, 'KeepAlive': True,
            'ThrottleInterval': 30, 'ProcessType': 'Background',
            'EnvironmentVariables': {'PYTHONUNBUFFERED': '1'},
            'StandardOutPath': str(LOGS / 'bridge.log'), 'StandardErrorPath': str(LOGS / 'bridge-error.log')}


def managed():
    if PLIST.exists():
        data = plistlib.loads(PLIST.read_bytes())
        if data.get('Label') != LABEL or data.get('WorkingDirectory') != str(ROOT):
            raise RuntimeError('同名后台属于另一目录，未修改。')


def status():
    result = subprocess.run(['launchctl', 'print', TARGET], text=True, capture_output=True)
    match = re.search(r'^\s*pid = (\d+)', result.stdout, re.M)
    info = {'installed': PLIST.exists(), 'loaded': result.returncode == 0, 'pid': int(match[1]) if match else None}
    try:
        with urllib.request.urlopen('http://127.0.0.1:5331/api/status', timeout=2) as response:
            health = json.load(response)
        info['ready'] = health.get('service') == 'jiebi'
    except Exception:
        info['ready'] = False
    return info


def install():
    managed()
    if status()['loaded']:
        return status()
    if not (ROOT / '.venv/bin/python').exists():
        raise RuntimeError('请先准备项目的 Python 环境。')
    with socket.socket() as s:
        if s.connect_ex(('127.0.0.1', 5331)) == 0:
            raise RuntimeError('5331已有进程；请先结束本项目的开发服务。不会停止未知程序。')
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    # ponytail: rotate large logs on install; continuous log rotation is deferred.
    for name in ['bridge.log', 'bridge-error.log']:
        log = LOGS / name
        if log.exists() and log.stat().st_size > 1024 * 1024:
            previous = log.with_suffix('.previous.log')
            if previous.exists():
                raise RuntimeError('旧日志需要先保留或整理，未覆盖。')
            log.rename(previous)
    temp = PLIST.with_suffix('.tmp')
    temp.write_bytes(plistlib.dumps(configuration()))
    temp.chmod(0o600)
    temp.replace(PLIST)
    subprocess.run(['launchctl', 'enable', TARGET], check=True)
    subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(PLIST)], check=True)
    for _ in range(100):
        info = status()
        if info['ready']:
            return info
        time.sleep(.1)
    raise RuntimeError('后台已安装，但尚未就绪；请用 status 查看状态。')


def remove():
    managed()
    if status()['loaded']:
        subprocess.run(['launchctl', 'bootout', TARGET], check=True)
    PLIST.unlink(missing_ok=True)
    return {'removed': True, 'paperAndJobsPreserved': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['install', 'remove', 'status'])
    args = parser.parse_args()
    try:
        print(json.dumps(globals()[args.command](), ensure_ascii=False))
    except Exception as error:
        parser.exit(1, str(error) + '\n')
