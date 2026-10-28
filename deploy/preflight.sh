#!/bin/sh
# Read-only. Run on the existing host before installing anything.
set -eu
uname -a
cat /etc/os-release
free -m
df -h / /opt /var
uptime
command -v python3.12 || command -v python3.11 || command -v python3 || true
python3 --version
command -v nginx || true
command -v docker || true
ss -ltn | awk 'NR==1 || /:80 |:443 |:5332 /'
systemctl --no-pager --type=service --state=running
