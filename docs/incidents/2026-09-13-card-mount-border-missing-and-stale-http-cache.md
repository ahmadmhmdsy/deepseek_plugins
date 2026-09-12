# 2026-09-13 — web card vanished from 3080 GUI (missing helper + stale HTTP cache)

## Symptoms

After the UI redesign of `web-compact-config/src/client/Card.tsx`, the card
disappeared from Settings → Plugins in the live GUI (127.0.0.1:3080).

## Root causes (two, stacked)

1. **`ReferenceError: border is not defined` at module import.** The redesign
   edit called a `border(color)` style helper but the helper's definition was
   dropped in the rewrite; any throw at factory-evaluation time makes the
   loader drop the whole `web-compact-config` entry, so the card never mounts.
   Evidence: browser console — `failed to import loader entry (web-compact-config):
   border is not defined`; tsdown rebuild after re-adding the helper fixed the
   bundle itself (commit `070adb0`).
2. **Stale HTTP-cached plugin bundle under an unchanged rev URL.** The GUI loads
   `/plugins/web-compact-config/client.js?rev=<hash-at-boot>`. The `rev` query
   does not change for an in-place bundle rebuild, so browsers that cached the
   earlier (broken) response kept re-running the broken bytes even after the
   served file was correct. Evidence: `Invoke-WebRequest` of the same URL
   returned the fresh bundle (`Shorthand style helper` present) while page loads
   still threw; after `fetch(url, {cache:'reload'})` (any fresh fetch that
   re-validates) the very next page load imported cleanly.

## Fixes / effects

- Added the missing helper (`070adb0`) — bundle imports cleanly now.
- For users: one hard refresh (or any cache-bypassing fetch) of the GUI clears
  it; a full harness restart also works (not needed here).
- Lesson: **an in-place `tsdown` rebuild does not invalidate the GUI's cached
  plugin bundle** — when verifying a card change in a cached browser, force a
  cache reload of `client.js?rev=...` (DevTools "Disable cache" or
  `fetch(url,{cache:'reload'})`) before judging the result. Longer term, the
  rev should incorporate the bundle hash (host-side, out of this repo's control).

## Honest caveats

- The stale console messages in an agent-browser session persist across page
  loads in the same session buffer — do not use them as freshness evidence;
  confirm with a fresh page load or a DOM probe (`document.body.innerText`).
- Card confirmed present and rendering via DOM probe + screenshots
  (`.live-test/card-*.png`, session on 2026-09-13); visual judgement is still
  a user checkpoint.
