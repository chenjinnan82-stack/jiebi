# Jiebi · 接笔

**A small shared paper beside the web. Write, draw, roll it up, and let an assistant continue on the same page.**

Jiebi is an experimental Chrome extension. The paper belongs to you: move an assistant's mark, change its words, erase something you do not want, and hand it back. The assistant can add editable strokes and text, withdraw only its untouched work, or stop.

[Introduction & download](https://chenjinnan82-stack.github.io/jiebi/) · [Verification notes](RELEASE_NOTES.md)

Release status: **0.5.2 preview**. The curtain now has an actual Chrome three-round recording, ten open/fold checks and cross-website draft restoration. Hosted review access, system IME testing and final submission remain pending. Drawing quality is still uneven; see the verification notes.

## Use the paper

- Open the roll at the upper right of an ordinary webpage. On restricted pages, use the toolbar icon.
- Click anywhere in writing mode to start text. Slide the bottom paper edge left/right to switch writing and drawing; your content stays on the same page. The small icons select, erase and undo. Grouping appears after selecting several objects.
- Push the roll edge upward by about 64 pixels and release to hand it over. A shorter push springs back. Clicking outside, Escape or changing tabs only saves and folds away.
- Peel the corner to pull out a blank paper or return to an older one. Each paper has its own conversation.
- A small moving mark means a handoff is pending; a still rose mark means a reply is ready. Reopen when you choose. Any input ends the one-second ink reveal and restores the complete editable response.

Keyboard: focus the bottom mode edge and use left/right; `T` writes, `P` draws, `V` selects, `E` erases. On the canvas, Enter cycles objects, Shift+Enter edits text, arrows move, Shift+arrows move further, Delete erases, Command/Ctrl+G groups, Command/Ctrl+Z undoes. Command/Ctrl+Enter hands over. The roll also supports Enter, Up and Down. Reduced-motion settings disable the animation.

## Run locally

Requires Python 3.11+, Chrome 120+; Node 22 is used only for checks.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-study.txt
.venv/bin/python study.py
```

In Chrome's extension manager, enable Developer mode and load the `extension` directory. Pin **接笔**. The local bridge listens only on `127.0.0.1:5331`. No everyday webpage or terminal interaction is needed after setup. `/extension-preview/` is a development tool.

The default adapter uses an existing Ollama vision model, `kimi-k3:cloud`, at port 11434. This model uses cloud inference. `SKETCH_MODEL` can select another installed vision model; quality is not guaranteed to match. There is no silent provider fallback.

Optional macOS background service:

```sh
.venv/bin/python service.py install
.venv/bin/python service.py status
.venv/bin/python service.py remove
```

This manages only `local.jiebi.bridge`, preserves saved papers/jobs, and does not change Ollama. Restart it after changing configuration, when no job is running.

## Nebius / NVIDIA

Create `.env` from `.env.example` only if it does not already exist. Keep it on the server, never in the extension:

```dotenv
SKETCH_PROVIDER=nebius
NEBIUS_API_KEY=your_key_here
NEBIUS_BUDGET_USD=1.00
NEBIUS_PHASE=development
```

Jiebi calls `nvidia/Nemotron-3.5-Super-VL` through Nebius Token Factory's `/v1/chat/completions`. It sends a PNG and structured objects, not just a text label. The model's own JSON becomes the visible response. Nebius uses one call per turn; invalid output is rejected, not silently repaired or resampled.

The [official catalog](https://tokenfactory.nebius.com/model-catalog.md) was checked for image input and rates of $0.30 input / $0.90 output per million tokens on October 28, 2026. This project maintains a **$1 cumulative cap**, with development plus unknown holds limited to $0.50. `NEBIUS_PHASE=judging` enables the remaining allowance after deployment. Each call reserves the full 1,048,576-token context plus up to 8,192 output tokens before it starts. Unknown outcomes retain their reservation. Reported usage settles it conservatively. This is a project estimate, not an account-wide invoice.

Do not delete or duplicate `data/nebius-usage.sqlite3` to reset spending. Move this ledger when moving inference and disable the old inference process. Optional `NEBIUS_MAX_CALLS` further limits cumulative calls.

## What crosses the handoff

`paper.v2` supplies the current PNG, positioned strokes/text/groups, the last two **actually presented** exchanges, and exact edits with their before/after content. Pending or stale replies do not become fictional shared memories. The model returns `contribute` or `pause`, with additions and permitted retractions; it never returns executable code.

The same geometry draws, selects, bounds and validates the marks. Human originals and edited assistant objects are protected. A response applies and undoes as one operation. Invalid geometry or new text/ink collisions reject the whole response. The model decides what to express; a nicer brush cannot fix misunderstanding.

One durable request runs at a time. Each paper keeps its latest waiting snapshot independently. Lost acknowledgement retries use the same ID; explicit generation failures need a human retry. A new edit cannot be overwritten by an old reply. Only one extension surface holds the editing lease; a late save from another surface is kept as a recovery draft.

## External assistant adapter

An experimental test route can trigger a separate Grok Bot through its official webhook. The Bot receives one short-lived task capability: read that authorized paper and submit one `contribute` or `pause` response. It uses the same validator and brush. Routes are alternatives, not chained models. Queued tasks retain their original recipient and connection.

See [BOT_SKILL.md](BOT_SKILL.md). This is not yet a claim of successful live Bot integration or personal memory. Same-account Grok Bots share their cloud computer; a separate Bot name is not a security sandbox. Public review credentials cannot invoke the private test Bot.

## Privacy and deployment

The content script mounts an extension-owned iframe; it does not inspect page text. The page receives no paper content, API keys or assistant credentials. The worker binds the iframe's tab/document using a nonce, and local storage is limited to trusted extension contexts. Ordinary HTTP/HTTPS page access is needed to show the roll. Restricted browser pages use the toolbar fallback.

Papers remain in extension storage. Handed-over snapshots and limited context go to the selected provider. This is not fully local inference. Local evidence files contain test paper data and are not part of the release.

Do not expose the local development server directly. [deploy/README.md](deploy/README.md) describes the isolated single-worker service, reviewer authentication and session ownership, request/concurrency limits, closed development routes, one shared budget ledger and rollback. In hosted mode, access requires a review code; each installation receives its own random session. Reviewer jobs cannot select the external Bot.

Limits: 100 strokes, 24 text objects and 4,000 characters per paper; one undo snapshot; retained queue receipts within available local storage; 256 server jobs; 24 jobs per hosted reviewer session. Full storage stops instead of deleting content. Old paper.v1/v2 archives are retained; upgrade does not automatically send them.

## Checks

These checks do not call a live model:

```sh
.venv/bin/python check_study.py
.venv/bin/python check_extension.py
# Optional local production-mode smoke test, requires requirements-deploy.txt:
.venv/bin/python check_deploy.py
```

They cover geometry, editing, Chinese composition events, cancelled gestures, mixed grouping, exact history, protected objects, whole-reply rejection/undo, stopping, old results, multiple papers, worker recovery, iframe binding, reviewer isolation, scoped external callbacks and budget limits. Mock checks do not replace real Chrome, IME, model or hosted-service verification.

## Sources

Based on [SketchAgent](https://github.com/yael-vinker/SketchAgent), by Yael Vinker and collaborators. Its MIT [LICENSE](LICENSE), original core files and [upstream README](UPSTREAM_README.md) are retained. Jiebi adds the shared text/drawing paper, roll-up extension, paper stack, durable handoff, user-edit protection, actual-change context and validation. It does not claim the invention of language-model sketching.

The browser brush adapts curve and stable-pressure techniques from a user-supplied line-animation engine. See [ENGINE_SOURCE.md](ENGINE_SOURCE.md). No film assets or unrelated private project files are included.


Public demonstration: [Actual Chrome, three turns (2:51)](https://youtu.be/MJYtpf5_CFU). This is the 0.5.1 recording; version 0.5.2 refines the UI. Model waits are retained. Hosted judge access is still pending.
