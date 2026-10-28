# 0.5 preview — October 29, 2026

This is an implementation preview, not a completed competition submission.

## Included

- An extension-owned paper curtain on ordinary webpages, with a toolbar fallback on restricted pages.
- Positioned text and ink, an edge gesture for writing/drawing, a roll gesture for handoff, a paper stack and interrupted-reveal handling.
- A persisted single-editor lease, recovery drafts, one global active job and one latest waiting snapshot per paper.
- Human-edit protection, exact before/after changes, the last two actually presented turns, atomic contributions and explicit stopping.
- Authenticated, session-isolated hosted-service mode and a scoped external-assistant callback. The default competition adapter is Nebius / NVIDIA.

## Real model tests

Three scripted-human scenarios, three turns each, used actual `nvidia/Nemotron-3.5-Super-VL` calls through Nebius. No assistant output was scripted, repaired or resampled. Tests ran in a browser development harness; they are not an installed-extension recording.

| Scenario | Actual outcome |
| --- | --- |
| Two cups and a correction | One ambiguous curved mark; then steam plus “杯还热着，人没来。” after a moved mark and a clarification; explicit ending returned `pause`. |
| Pure drawing edits | A puddle-like contour; a second contour after moving it; the third response had flattened coordinates and was rejected as a whole. The original stayed unchanged. |
| Reading and an ending | “Two pages today. That's enough.” led to `pause`; a clarification received “A bookmark for later.” without a drawing; the ending returned `pause`. |

Eight of nine responses passed validation. Protected input objects were unchanged in all nine. Each scenario carried 0/1/2 actual presented turns. No response voluntarily withdrew old content. Valid output does not establish good expression: the first cup response is fragmentary, the drawing edits were not clearly understood, and the reading sentence is rather literal.

Model-request time: median **7.158 s**, range **2.260–13.081 s**. Developer-page visible wait: **2.587–13.358 s**, including 500 ms polling and canvas submission. Nine observations are not a stable P95 estimate. The original 3 s / 5 s targets are not met.

The cumulative project ledger after these tests reports **$0.035729** over 13 calls, with **$0** held. This includes earlier tests and one unintended regression-test call; it is not an account-wide bill. The $1 project cap remains, with development and unknown holds limited to $0.50. Current maximum output is 8,192 tokens and each request reserves $0.321947 before starting; the previous 2,800-token limit could be consumed by reasoning without a usable reply.

## Verification and remaining gates

Offline checks cover paper edits, Chinese composition events, cancelled gestures, grouping, protection, invalid atomic replies, stop behavior, multiple papers, stale views, persistent leases, offline/repeated submissions, recovery, caller binding, scoped callbacks and money limits. Production-mode smoke testing runs without a real key. These are software checks, not evidence of aesthetic quality or real Chinese IME behavior.

Pending: the new site permission and actual Chrome curtain upgrade; real cross-tab/IME/ten-minute and continuous-video validation; remote host access and deployment; the free-credit form and expiry; optional live Grok Bot setup; final judging and submission. Prior toolbar-version tests are not a substitute for these.

## Recovery notes

- Keep the same extension ID and storage. Reload the installed extension instead of uninstalling it. The original archives are retained and not automatically handed over.
- A stale surface may keep a recovery draft in the paper stack. It must never overwrite the active editor.
- Do not run two inference hosts with copied usage ledgers. Stop local inference, transfer the existing ledger, verify its totals, then start the hosted service.
- A model call interrupted after acceptance is not automatically retried. An unknown charge retains its reservation.
- Only a gesture that passes the handoff threshold, or its explicit keyboard/button equivalent, submits. Escape, outside clicks and tab switches only save.
- Website-host pages cannot read paper data through the public message interface. The editor is an extension iframe, bound to a tab/document by the worker. Do not add a general page-to-model message bridge.
- Release packaging uses a file allowlist. The inherited upstream `.env` was tracked; `.gitignore` alone was insufficient. Publish the clean package, never this working tree's history or private evidence folder.

No hosted availability, personal-memory integration, Chrome Web Store review or competition acceptance is claimed by this preview.
