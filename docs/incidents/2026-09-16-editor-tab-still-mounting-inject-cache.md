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


## Follow-up 13:33-14:05 — "blank after reload" (three stacked root causes)

The hooks fix was necessary but not sufficient. Driven by the user's report, the
tab was reproduced agent-side on an isolated 3082 harness (booted by this agent
from the same checkout, killed after verification; the live 3080 was never
touched) and driven with the `agent-browser` CLI. Browser console evidence:

1. **Inject-gated ctx property access.** The loader's client ctx throws
   `cannot get property "<key>" without inject` at RUNTIME when a plugin reads
   a context key it did not declare in its `inject` array — optional chaining
   does NOT bypass the gate. `ctx.remote`/`ctx.workspaces` reads from
   `fsSource`/`workspacesSource` crashed the whole slot entry ("slot entry
   crashed in 'conversation.view'" on the console; the tab rendered **blank**
   because the placeholder itself lives inside the crashed component).
   Fix: `inject = ['slots','settingsScope','remote','workspaces']` and
   the matching feature entries in the package's `dsh.client.inject`
   (`@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-api-workspace-controller`).

2. **Mounted namespaces are ctx services named `remote.<namespace>`, NOT
   properties of the `ctx.remote` service.** `faceForRemote(remote[ns])`
   reading off `ctx.remote` therefore never resolved (placeholder pinned
   "still mounting" forever). The gateway client registers each mounted
   namespace (`createNamespace` → `RemoteNamespaceService`) on the owner's
   context tree; the consumer reaches it via `ctx.get('remote.fileEditor')`
   after its own `$mount` resolves. **Do not add `remote.fileEditor` to the
   declared `inject` list**: a waitable declared key that only this plugin's
   own later `$mount` can create parks the whole plugin at boot
   ("pending (waiting for service: remote.fileEditor)" — observed).

3. **Missing import → ReferenceError → blank.** The rewrite used
   `FS_NAMESPACE` without importing it; TypeScript-through-tsdown happily
   emitted a bare unbound identifier so the bundle crashed at first render
   even after (1)+(2). Now: `import { faceForRemote, fileEditorFsContribution, FS_NAMESPACE } from './fs-remote.ts'`.

Verification evidence (agent-owned 3082, headlessChrome/152):
- Before: console `[error] ReferenceError: FS_NAMESPACE is not defined` /
  `[error] slot entry crashed in 'conversation.view'`, empty tab area.
- After (13:58-14:02 bundles + reboot): clean console on fresh load; Editor tab
  renders workspace combobox (deepseek_plugins selected), directory tree
  expands (`web-file-editor` → `src` → `index.ts`), file pane renders
  "web-file-editor/src/index.ts (5517 bytes)" with the Monaco content box.
- Suite re-run 31/31 PASS after each edit (13:49, 13:55, 13:57); tsdown
  rebuilds exit 0; single fs-remote module copy in the bundle verified by
  grep (renamed `FS_NAMESPACE$1` artifact gone — the bare-name crash was ALSO
  a symptom of two copies when the import was absent, so import list + alias
  discipline matters for the bundler).

## New durable lesson (bundler/inject)
A client plugin that mounts its own Remote namespace must (a) declare
`remote` + NOT the '`remote.<ns>`' key, (b) read the namespace lazily via
`ctx.get('remote.' + ns)` after `$mount` resolves, and (c) import EVERY
bare identifier it references (tsdown will not expand an omitted import into
bundles without failing the build). The agent-side 30xx harness + headless
agent-browser loop is the sanctioned way to see slot crashes without the
user's 3080 session.


## Cross-reference
The blank-after-reload correctness fix above (the three root causes) is the
prerequisite for the UX polish milestone
`docs/superpowers/plans/2026-09-14-file-editor-plugin.md` §M-D (2026-09-16
14:09). M-D is display-only; it assumes the tab actually renders.
