# web-compact-config — web settings card + host bridge

The settings card for the auto-compact handoff suite: a React card in the DSH
web GUI, backed by a host service that reads/writes the shared
`handoff-config.json` store. Edits made in the card hot-reload into the engine
exactly like file edits or [/compact-config](../compact-config-command/README.md)
commands.

## What it does

- **Host side** (`src/index.ts`) — registers the settings namespace/seam
  (`ctx.settings.register(ns, schema, {...})`, present on both supported DSH
  checkouts) and exposes the service the client card talks to.
- **Client side** (`src/client/*`, `tsdown` CJS bundle) — the card UI: current
  trigger/retain settings, edit fields, apply button; has explicit loading /
  empty / error / success states.

Unlike the other two plugins this is **not** pure source-loaded: the client card
is built to a CJS bundle (`tsdown.config.ts`).

## Install

1. Build the dependency junctions once from the suite root (targets **your**
   DSH checkout):

   ```powershell
   node scripts/link-node-modules.mjs
   ```

2. Build the client bundle (from this plugin directory, with your checkout's
   toolchain):

   ```powershell
   npx tsdown
   ```

3. Register it in `cordis.patch.yml` (suite root):

   ```yaml
   - insert:
       - id: web-compact-config
         name: web-compact-config
         config:
           configFile: <absolute-path-to>/handoff-config.json
   ```

4. Make the package resolvable by the web profile — junction it into your DSH
   checkout's profile `node_modules` under the name `web-compact-config`
   (exact destination depends on your profile; see step 3 of the root README).

## Store file

Same single store as everything else in the suite: `handoff-config.json`, passed
as `configFile`. Validates through the shared validator; writes are atomic.

## Test

```powershell
& '<dsh-checkout>/node_modules/.bin/vitest.CMD' run     # from deepseek_plugins root
```

Specs: `tests/bridge.spec.ts` (host bridge), `tests/controller.spec.ts` (client
controller). The rendered card itself is user-verified in the live GUI:

> Live GUI verification is a user checkpoint — the agent never boots the
> running harness to check it (AGENTS.md §4).

## Limitations

- Requires the settings seam `@deepseek-ai/*` settings packages on the target
  DSH checkout; the suite's link script treats fork-era client deps as optional,
  and the card degrades without them.
- The client bundle must be rebuilt after client-side changes (unlike the
  source-loaded plugins).
- A card edit failing validation reports the error in-card and leaves the store
  untouched (atomic writes).
- **Cache note (rebuilds):** the GUI serves the card as
  `/plugins/web-compact-config/client.js?rev=<boot-hash>`; that `rev` does NOT
  change on an in-place `npx tsdown` rebuild, so the browser can keep serving
  the previously cached bundle. After rebuilding, bust the cache once
  (`fetch(url, { cache: 'reload' })` in the page console) or hard-refresh
  (Ctrl+F5), or the card may keep showing stale behavior. Details:
  `docs/incidents/2026-09-13-card-mount-border-missing-and-stale-http-cache.md`.
- The card follows the built-in plugin cards' disclosure pattern (title +
  description header always visible; the body mounts only while open), mirroring
  `ui-settings-plugins/client/PluginCard.tsx`; the status pill
  (unsaved/invalid/saving/failed) rides on the header so a collapsed card still
  reports state. Live evidence: `.live-test/card-open-drawer.png` /
  `.live-test/card-closed.png` (2026-09-13, commit 500ee19).
