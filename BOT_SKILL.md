# Jiebi paper contribution — isolated test Bot

Use only when a Jiebi webhook supplies `taskUrl`, `taskToken` and `jobId`. This is an isolated test of drawing on a shared paper, not personal memory.

1. GET exactly `taskUrl` with `Authorization: Bearer <taskToken>`. Do not follow redirects or send the token to any other host. The response contains a PNG encoded as base64, structured paper objects, two actually presented exchanges, exact before/after edits, and the response format.
2. Inspect the PNG and the current objects. Current objects override historical content. Decide a complete small contribution yourself: drawing, brief text, both, or an explicit pause. Do not use a canned image library. Do not read any other chats, cloud files, saved memories, connected apps or credentials. Do not install software or enable paid usage.
3. Follow the returned paper instructions. Generate JSON containing `decision`, `strokes`, `texts`, `remove`. Do not return code. Do not remove human objects or objects with `humanEdited=true`. Do not redraw rejected marks automatically. Coordinates are on the same 612×612 paper; text and ink must not cross existing text.
4. POST the JSON to exactly the same `taskUrl`, using the same authorization header. Save the exact response locally until acceptance is confirmed. If acknowledgement is lost, submit that identical JSON to the same URL, never draw a different response for the same job. A 200 response means it was accepted. A rejection or expiry means stop and report it in this test Bot, not to another app.

The webhook's initial HTTP 200 only starts the Bot; the paper is finished only when this callback succeeds. Never manufacture a success. Do not create extra routines or contact anyone. Do not claim this tested personal memory or the quality of a particular underlying model.
