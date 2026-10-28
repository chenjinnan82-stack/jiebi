# Jiebi — A shared paper for human and AI

**Submission draft, not yet submitted. Three real three-round Nebius/NVIDIA scenarios have been recorded in a developer harness. The new curtain still needs installed-Chrome verification; hosted judge access and the continuous target-platform video remain incomplete.**

Suggested track: Best Apps and Agents.

## Short description

A paper roll beside the web, for words, sketches, and a small response from AI. Write or draw, fold the paper to hand it over, and reopen it when you are ready. Edit the response and continue on the same page.

## Inspiration

Some thoughts begin as a few words next to a rough drawing. Turning that into a chat prompt can interrupt the moment. We wanted a small shared surface where a person can leave a mark, let an assistant respond, and keep ownership of what stays on the page.

## What it does

Jiebi unfolds at the upper right of an ordinary webpage, with a toolbar fallback on restricted pages. A paper contains positioned text, freehand strokes, and groups that move together. Slide the paper edge to switch between writing and drawing. Roll upward to hand over a saved snapshot; clicking away only saves the draft. Pull a new paper from the corner or return to an older conversation.

The assistant may add a drawing, leave a short line of text, withdraw its own untouched content, or stop. Its response is made of editable objects. When the person moves, edits, or groups an assistant object, that object becomes protected from automatic removal.

A reply cannot overwrite a newer edit. Older replies remain in the exchange history. Reopening an unchanged paper does not make the assistant reply to itself.

## How it works

The Chrome extension owns the editable page and a durable local handoff queue. A small Python service accepts idempotent jobs and validates model responses before applying them as one undoable contribution.

Each request contains the current page image, structured text and strokes, the last two actually presented exchanges, and exact before/after changes. The model generates points and text, rather than choosing from a library of object drawings. Rendering and hit testing use the same bounded geometry. New assistant content is checked for collisions with text, and human-controlled objects are protected by code.

The brush adapts Catmull–Rom curves and stable pressure variation for an editable browser canvas. It preserves deliberate corners and closed contours. This affects how a stroke is drawn; it does not substitute for the model's understanding of the page.

### Competition integration — real, bounded tests

- Nebius runtime endpoint: `https://api.tokenfactory.nebius.com/v1/chat/completions`, authenticated and called by the project.
- NVIDIA model: `nvidia/Nemotron-3.5-Super-VL`, verified with actual PNG input and structured paper context.
- Actual runtime responsibility: the model must read the paper and generate the real editable contribution, not merely label or log a response from another model.
- The latest verification used nine calls across three three-turn scenarios: words and a drawing, visual-only editing, and an explicit ending. Eight validated; one response used flattened coordinates and was rejected atomically. All protected objects remained unchanged. Both explicit endings returned `pause`. No paid repair or resampling occurred.
- Model-request latency: median 7.158 seconds, range 2.260–13.081 seconds. The developer-page wait was 2.587–13.358 seconds. These are not native-extension latency measurements or a stable P95.
- Cumulative project ledger: $0.035729 over 13 calls, including earlier tests and one unintended regression call. Total cap $1; development plus unknown holds capped at $0.50. Full-context reservations remain conservative. These are recorded usage estimates, not account-wide billing.

Keep the development adapter separate from the competition claim. Earlier recorded examples use `kimi-k3:cloud` through Ollama, with cloud inference; they must not be presented as Nebius outputs.

## What we built on

This work began from [SketchAgent](https://github.com/yael-vinker/SketchAgent), retaining its MIT license and attribution. Our additions are the webpage-curtain and toolbar workflow, separate papers, asynchronous durable handoff, a shared editable text-and-drawing page, human-edit protection, exact change context, explicit stopping, and layout validation. We do not claim the underlying idea of language-model sketch generation as our invention.

The browser brush also references a user-provided local line-animation engine. The submitted package must include only the adapted code and clearly documented sources; it must not include unrelated film assets or private project files.

## Challenges and current limits

Making a response editable introduces problems that a flat generated image does not have: stale replies, moved objects, text collisions, interrupted requests, and deciding what the assistant is allowed to revise. We made those rules explicit and checked them in code.

Expression is still uneven. Text-and-sketch exchanges have produced legible responses and respected explicit endings. Purely graphical edits are harder: in one test the assistant added more rain marks instead of clearly responding to a new corner. The model has not yet demonstrated reliable voluntary cleanup of its previous drawing. We preserve these results instead of presenting every valid JSON response as successful communication.

Earlier toolbar versions were verified in Chrome on an M1 Pro. The 0.5 curtain has not yet passed its final installed-Chrome tests. The project has not been validated as an offline or fully local inference product, and it does not yet connect to a personal assistant's private memory.

## What's next

Improve how the assistant interprets a person's changes and decides what to keep, withdraw, or leave alone. Integrating a personal assistant can follow after this shared-paper interaction is reliable.

## Final submission checklist

- [x] Real Nebius + NVIDIA image and three-round exchange verification (three scenarios; one rejected response and uneven expression disclosed).
- [ ] Working, free judge access without the author's laptop being online.
- [x] Public repository owned by the entrant, with license and English setup instructions: https://github.com/chenjinnan82-stack/jiebi
- [ ] New curtain permissions and installed-Chrome interaction/performance checks.
- [ ] Actual Chrome demonstration under three minutes, publicly visible on YouTube, with English narration or captions.
- [ ] All links checked, limits disclosed, and the provider/model names match the recording.
- [ ] Final Devpost form, platform feedback, and required account/terms confirmation.

Do not publish verification drafts, absolute personal filesystem paths, API keys, user page logs, or unrelated project history as submission assets.


## Prepared form fields

- Project name: **Jiebi — a shared paper beside the web**
- Tagline: **Write, draw, roll it up. An assistant responds on your paper; your next edit continues the conversation.**
- Track: **Best Apps and Agents**
- Built with: **JavaScript, Python, Chrome Extensions, Canvas 2D, Flask, SQLite, NVIDIA Nemotron, Nebius Token Factory**
- Code: https://github.com/chenjinnan82-stack/jiebi
- Introduction and download: https://chenjinnan82-stack.github.io/jiebi/
- Hosted generation / reviewer instructions: **pending**. The introduction URL is not a claim of working hosted inference.
- Public YouTube video: **pending**. Do not substitute a screenshot sequence or developer harness.

### Platform feedback from actual use

Token Factory let the application send a PNG alongside precise object and edit records without operating a GPU server. Reported token usage was useful for a persistent cost ledger. In the nine latest calls, model latency ranged from 2.260 to 13.081 seconds; this fits an asynchronous handoff better than a live drawing interaction.

A 2,800-token output limit could end before producing useful content; increasing it to 8,192 made room for reasoning and output. JSON-object mode still allowed an invalid flattened point array in one of nine later calls. Clearer per-model structured-output guarantees would help small apps avoid rejection without adding another model call. Our validator kept the original intact.

The optional company-website field in the promotional-credit form rejected the entrant's GitHub profile. The credit application and expiration are not yet verified; no conclusion about long-term free availability is claimed.

### Pre-existing work and changes

SketchAgent and the referenced line-animation techniques predate this project and remain attributed. During this build we added the Chrome paper workflow, positioned editable text, shared text/ink grouping, user-edit protection, a durable asynchronous queue, exact change history, explicit stopping, a per-paper library, isolated iframe curtain, hosted-session boundary and Nebius cost controls. The external Bot interface is prepared but not claimed as a completed live integration.
