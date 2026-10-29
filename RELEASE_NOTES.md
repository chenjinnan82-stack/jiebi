# 0.5.1 preview — October 29, 2026

This is an implementation preview, not a completed competition submission. [Static introduction and extension download](https://chenjinnan82-stack.github.io/jiebi/) and [public source](https://github.com/chenjinnan82-stack/jiebi) are available; hosted inference remains pending.

## This revision: actual Chrome and a steadier paper

The curtain keeps its width while rolling, so the paper no longer narrows and stretches during handoff. The roll has a quieter paper-back gradient and edge shadow. The input-mode label follows the edge gesture. Text width moved into the menu and new text starts with more usable writing space. No new dependency or permission was added.

An installed Chrome session on an M1 Pro covered more than fourteen minutes of actual interaction, including ten explicit empty/unchanged open/fold cycles, short-gesture cancellation, drawing, moving and erasing assistant marks, and restoring an edited draft on another website. Those ten cycles created no model jobs. Fourteen native-console save/enqueue samples ranged from **11.1 to 56.9 ms**; they exclude the 420 ms animation and model/network wait. This is not a measured 60 fps or P95 claim.

A real three-turn exchange used a hand-drawn envelope and ordinary scripted human inputs. The first response added two tiny nested squares (a stamp); after moving that group, erasing its inner square and clarifying the meaning, the second added a small loop. The third accepted an explicit ending with `pause`. Model times were **7.834 / 11.019 / 3.404 s**. The original browser recording is continuous; its 172-second edit keeps all three model waits, crops to the paper, and removes human/tool idle gaps without speeding up playback. It is available on the introduction page; a public YouTube upload is still pending.

These small marks are not a convincing finished visual response. After a prompt adjustment asking for legible, coherent forms at the actual paper size, one separate bench-and-river test returned only “坐下来，先歇歇。” in **8.455 s**. This is a relevant short sentence, not evidence that drawing quality improved. There were no resamples or paid repairs.

The latest cumulative ledger reports **$0.049685 across 17 calls**, with **$0 held**. The $1 cap and $0.50 development/unknown-hold boundary remain. Offline checks still pass. Real system Chinese IME, a current-version full browser restart and frame-rate measurement remain unverified; an earlier toolbar version's full restart test remains historical evidence only. One recorded drag did not submit; the explicit alternative did. The gesture is not claimed flawless.

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

At the earlier nine-turn checkpoint, the ledger reported **$0.035729** over 13 calls, with **$0** held. This includes earlier tests and one unintended regression-test call; it is not an account-wide bill. The current total is above. Current maximum output is 8,192 tokens and each request reserves $0.321946 before starting; the previous 2,800-token limit could be consumed by reasoning without a usable reply.

## Verification and remaining gates

Offline checks cover paper edits, Chinese composition events, cancelled gestures, grouping, protection, invalid atomic replies, stop behavior, multiple papers, stale views, persistent leases, offline/repeated submissions, recovery, caller binding, scoped callbacks and money limits. Production-mode smoke testing runs without a real key. These are software checks, not evidence of aesthetic quality or real Chinese IME behavior.

Developer-preview checks also completed ten consecutive empty-paper open/fold cycles without enqueuing a model request (software preparation 1.1–2.0 ms; this excludes animation and is not native Chrome). A local production-mode smoke check used one master plus one worker, with summed idle RSS 73,312 KB and 20 status requests at median 0.75 ms; these are not remote server or model-load measurements.

Site permission was approved and the actual Chrome curtain was upgraded and exercised. The promotional-credit form was submitted, but receipt of credits and expiry are unverified. An independent Grok test Bot and webhook routine were created; end-to-end callback validation is pending. Remote-host access still needs the owner's MFA. Hosted judging, system IME, YouTube publication and final submission are incomplete. Devpost login succeeded, but no entry or final terms were submitted.

## Recovery notes

- Keep the same extension ID and storage. Reload the installed extension instead of uninstalling it. The original archives are retained and not automatically handed over.
- A stale surface may keep a recovery draft in the paper stack. It must never overwrite the active editor.
- Do not run two inference hosts with copied usage ledgers. Stop local inference, transfer the existing ledger, verify its totals, then start the hosted service.
- A model call interrupted after acceptance is not automatically retried. An unknown charge retains its reservation.
- Only a gesture that passes the handoff threshold, or its explicit keyboard/button equivalent, submits. Escape, outside clicks and tab switches only save.
- Website-host pages cannot read paper data through the public message interface. The editor is an extension iframe, bound to a tab/document by the worker. Do not add a general page-to-model message bridge.
- Release packaging uses a file allowlist. The inherited upstream `.env` was tracked; `.gitignore` alone was insufficient. Publish the clean package, never this working tree's history or private evidence folder.

No hosted availability, personal-memory integration, Chrome Web Store review or competition acceptance is claimed by this preview.
