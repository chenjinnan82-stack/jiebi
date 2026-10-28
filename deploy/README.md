# Isolated deployment on the existing host

Deployment is not yet verified. The local bridge is not an internet server.

1. Run `deploy/preflight.sh` and retain output. Require Python 3.11+, a free loopback port 5332, at least 1 GB available memory and 1 GB free disk. Check the current site's response time before and after. Do not purchase a host or change the system Python.
2. Put a clean source release in `/opt/jiebi/releases/<release>`, use `/opt/jiebi/current` as a symlink, and create `/opt/jiebi/shared/{data,evidence}` owned only by the dedicated `jiebi` account. Link the release's `data`, `evidence` and `.env` to shared storage. Never put the whole source directory under the website root.
3. Create `/opt/jiebi/venv`, install `requirements-deploy.txt`. The service uses one worker with two request threads; generation is a single durable lane. Do not add workers: each would attempt to recover the same jobs.
4. Before moving inference, finish local jobs and disable local Nebius calls. Use SQLite's backup API to transfer the **existing** `nebius-usage.sqlite3` into the shared data directory. Verify count, charged total and unconfirmed holds match. Never start with an empty ledger or leave independent local/remote inference running.
5. Keep server `.env` mode 0600. Set `SKETCH_PROVIDER=nebius`, the existing project API key, `NEBIUS_BUDGET_USD=1.00`, `NEBIUS_PHASE=judging`, `JIEBI_PUBLIC_URL=https://sanliang.online/jiebi`, and an independently generated `JIEBI_REVIEW_TOKEN` of at least 32 URL-safe characters. Give the review code only in the private judging instructions. The extension creates a separate random session; job access is checked against it. A per-session limit of 24 jobs and global limit of four new jobs/minute apply.
6. Install `jiebi.service`. Add the Nginx include **inside the existing HTTPS server**, save its original config, run `nginx -t`, then reload. Do not replace unrelated locations. No new public port is needed. `systemctl stop jiebi` and removal of this one include provide rollback; keep shared data and the original usage ledger.
7. Verify unauthenticated API access is denied, a wrong session cannot read a job, `/jiebi/evidence/` and `/jiebi/extension-preview/` return 404, and the ordinary website still works. Measure CPU/RSS during a request and after idle; verify a restart retrieves a completed job without generating again. Do not claim deployment from local checks.

Optional external test only: add a distinct `JIEBI_TEST_TOKEN`, `JIEBI_EXTERNAL_SECRET`, official `GROK_WEBHOOK_URL` and `GROK_WEBHOOK_KEY`. Review credentials cannot select this route. A callback capability expires 15 minutes after its job starts and grants no other task access. These keys never enter the public package or browser page.

No free-credit expiration is assumed. Confirm both actual balance and expiration before claiming free judging access through December 15, 2026, 12 PM PT (December 16, 04:00 Beijing).
