# 2026-09-16 — Editor tab stuck on "The workspace file service is still mounting..."

## Symptom
Clicking the **Editor** tab in the live 3080 harness (DSH 0.1.6-alpha.1) showed only:

> Editor / The workspace file service is still mounting...

No explorer, no error. The tab gate worked; the VIEW never got its `fs` face.

## Root cause
**ui-renderer memoizes each slot entry's inject result per binding** (`packages/client/ui-renderer/src/client/scoped-slots.tsx`: `cachedRootInject` / `cachedSessionInject` WeakMaps). Our inject face was a **static object literal** `{ fs, workspaces }` evaluated by a factory at registration time. That evaluation runs ONCE — before the async `remote.$mount` promise resolves — so `fs` was `undefined` and the sync memoization pinned that first (empty) result forever. No reactive channel exists between the mount completing and the memoized inject result.

This is a framework property, not a bug in the renderer: inject faces are treated as injective snapshots. Anything async or later-changing must be delivered through an **observable hook face**.

## Fix (the renderer-blessed pattern, copied from ui-workspace)
The inject face must carry **hook sources** — objects with `getSnapshot()`/`subscribe()` (the `HostObservable` currency). The renderer mines each source name via `standardHookPropName(name)` and hands the component synthetic hook props: `use<Name>` (e.g. `useFs`, `useWorkspaces`), of shape `<R>(select: (value: T) => R) => R` (ui-renderer `observableHook` caches one uSES-bound hook per source identity).

- `web-file-editor/src/client/index.ts`: inject face is now
  `() => ({ hooks: { fs: fsSource, workspaces: workspacesSource } })`.
  - `fsSource`: a manual observable whose snapshot is `undefined` until the
    `$mount` inside the lifetime `ctx.effect` resolves, then the parsed
    `EditorFsFace` (cached once — identity-stable). `emitFs()` notifies
    listeners after the mount resolves.
  - `workspacesSource`: rides the runtime's own `workspaces.list` store;
    getSnapshot returns an `EMPTY_ROWS` constant when empty so the hook never
    loops on a fresh array literal.
- `web-file-editor/src/client/EditorView.tsx`: consumes optional
  `useFs?`/`useWorkspaces?` hook props (local structural
  `SnapshotSelectorHook<T>` type— no value import), calling
  `props.useFs(v => v)` when present.

## Why the old code ever "worked" in tests
Unit tests called the view factory directly with a fully-formed face; nothing
exercised the memoized-inject timing, so the regression was invisible until the
live GUI.

## Validation evidence (2026-09-16 13:29-13:32)
- Full suite via `D:/deepseek-harness_2/node_modules/.bin/vitest.CMD`: **19 files / 135 tests PASS** (exit 0); web-file-editor 31/31 re-run green after the final source simplification.
- tsdown rebuild `lib/client.js` 8.71 MB, exit 0 (loader-banner shape unchanged).
- Composition: `--profile web --dump-config` exit 0 from `D:/deepseek-harness_2`, `web-file-editor` row present.

## Honest caveat
Live browser confirmation (tab leaves the placeholder, lists/reads workspaces) is a **user checkpoint** — agents never restart or drive the running 3080 harness. The harness read the plugin files at boot; the rebuilt bundle is picked up via the combo/revision channel on the next page reload (Ctrl+F5 if cache-stale; see the 2026-09-13 rev incident).

## Durable lesson for client card/slot plugins
**Never put async or later-resolving values inside an inject face.** Declare hook sources (`getSnapshot`/`subscribe`, stable snapshot identities) and consume them through renderer-synthesized `use<Name>` selector hooks. Verify the best-practices guide carries this pattern.
