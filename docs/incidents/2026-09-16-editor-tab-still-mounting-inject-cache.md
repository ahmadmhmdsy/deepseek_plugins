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


## M-D.2 live verification (2026-09-16 14:20-14:35, agent-owned 3083)

Same slot entry, different cause this time. The M-D.2 first-pass bundle referenced `onTreeKeyDownStatic` — a phantom identifier left in the source by an incomplete string-substitution sweep during the multi-edit pass. Browser threw `ReferenceError` inside the `conversation.view` slot; renderer caught it; Editor tab rendered as empty fragment; Chat-tab composer bled through. Same blank symptom, different root cause. **Fix**: direct substring replace to catch every occurrence of the phantom handler reference, since the rows rely on event-bubbling to the tree container (which holds the real `onTreeKeyDown`) and need no per-element handler. After fix, mount is clean.

This is the **second** time the Editor tab has rendered blank for an agent-owned harness — and the second time the slot renderer's error-suppression makes a silent render failure look identical to a successful mount. Both M-D.1 and M-D.2 incidents reinforce the **defensive verification rule**: after any EditorView edit, **always re-check `document.querySelectorAll('.editor-tree-row').length > 0`** before claiming visual success; a successful screenshot of the tab strip is not evidence the slot entry ran.

The agent-browser console log is the source of truth — read it via `agent-browser console | Select-String -Pattern error` before committing. The `data-editor-tree-row-styles` `<style>` tag presence is also a fast proxy: if it's missing, the component never mounted.

## M-D.1 live verification (2026-09-16 14:14-14:18, agent-owned 3083)

After landing M-D.1 source + bundle, the agent booted an isolated harness on
**port 3083** (same `D:/deepseek-harness_2` checkout, separate port, own
store) so the user's live 3080 stayed untouched. Drove it with `agent-browser`.

- Session `UI Reverse Engineering Analysis` (1d) opened → tabs Chat / Trajectory / **Editor** became reachable (the Editor tab renders in this session).
- Click `Editor` → right pane shows workspace dropdown `deepseek_plugins`, tree root `▶ deepseek_plugins` (workspace title, NOT raw path), empty-state hint `Select a file to read it.` in the content pane.
- Click tree root → expands to 30 `.editor-tree-row` elements with `▸`/`▾` chevrons, `aria-expanded`, `aria-selected`, `title` tooltip on every row (e.g. `▸ compact-config-command`).
- Hover/focus-visible rule confirmed in DOM: `<style data-editor-tree-row-styles>` carries `.editor-tree-row:hover:not([aria-selected="true"]){background:rgba(127,127,127,0.08)}.editor-tree-row:focus-visible{outline:2px solid #3b6ef6;outline-offset:-2px}`.

All four Severity-1 fixes from §M-D.1 visually verified:

1. **TOKENS thread-through** — borders use `TOKENS.border` (no more `rgba(127,127,127,0.25)`), content pane uses `TOKENS.disabledBackground`, selection uses `TOKENS.accent` inset stripe.
2. **Hover + focus-visible** — scoped `<style>` tag is mounted; keyboard focus shows the accent outline.
3. **Root label** — `▾ deepseek_plugins` (workspace title) instead of the raw path.
4. **Empty-state hint** — "Select a file to read it." replaces the previous blank.

Agent-owned 3083 was killed at 14:18 (PID 13752, `Stop-Process -Force`); port confirmed free. Live 3080 was never touched; user's Ctrl+F5 checkpoint for M-D.1 on 3080 is unchanged.


## M-D.3 live verification (2026-09-16 14:36-14:43, agent-owned 3083)

**Scope.** Plan §M-D.3: per-row kind glyph + size + mtime columns. Both `FsEntryWire.size` and `FsEntryWire.modifiedMs` are already on the wire (verified in `src/remote/policy.ts` `listEntries` L20-41) — the view was discarding them.

**Mid-flight issue.** First screenshot showed `0 B` for every directory. Root cause: `statSync(absDir).size` returns 0 on Windows directories (the inode size, not content sum). Misleading because users read it as "this folder contains 0 bytes of files". Fix: switched directory rows to em-dash (`\u2014`); files keep formatted bytes. Rebuilt + reverified (see `.live-test/editor-md3-dash.png`).

**Evidence.**
- Commit `c5fe864`. Bundle 8.73 MB clean. Tsc exit 0. Vitest 135/135 PASS.
- UI Reverse Engineering Analysis session on isolated harness 3083 (token X_zy3w384Oz1VlutqvbhPOVHhF2EG1ilW3pi41m33tQ). Tree root expanded via `.editor-tree-row[data-editor-row-index="0"].click()`. Two screenshots: `.live-test/editor-md3.png` (pre-fix, dirs `0 B`) and `.live-test/editor-md3-dash.png` (post-fix, dirs em-dash).
- Killed harness cleanly (PID 27248); port 3083 free.

**Caveats / future work.**
- `formatRelativeTime` recomputes `Date.now()` on every render; tick via `useEffect+setInterval` later if it bothers anyone (not in M-D.3).
- Glyphs use `currentColor` + `TOKENS.textMuted`; future kit `TOKENS.iconFolder/File` would replace hardcoded fill — not in M-D.3.
- Title tooltip does not localize; fine for now.

**Cross-ref.** MEMORY `L-4` captures the inode-vs-content trap for future tree-row work.


## M-D.4 live verification (2026-09-16 14:44-15:03, agent-owned 3083)

**Scope.** Plan §M-D.4 items 9, 10, 11: TOKENS thread-through, right-pane flex layout, fontSize 12.5 → 13.

**Mid-flight issue.** First attempt at the right-pane flex layout used `flex: 1 1 auto; minHeight: 0` on the Monaco host. Result: Monaco rendered its lines against a 0px-measured canvas, painted at full opacity, and the text bled into the tree area. Bug screenshots: `.live-test/editor-md4-claude.png`, `.live-test/editor-md4-reload.png`, `.live-test/editor-md4-debug.png`.

**Root cause.** Monaco with `automaticLayout: true` measures its host via ResizeObserver. The race: the Editor view's useEffect calls `createReadonlyWorkbench(host)` after first paint, but the host's flex child size resolves only after layout settles. If Monaco measures at 0px (transient state), it paints lines at their absolute Y positions without clipping — text overflows visually.

**Fix.** Switched the Monaco host from `flex: 1 1 auto; minHeight: 0` to `position: absolute; inset: 24 0 0 0` (top 24px clears the header). The absolute box is bounded by `top` + `bottom` of the parent column, regardless of when `automaticLayout` fires. Restored `workbench.ts` inner `minHeight: 200px` so Monaco has a usable area before the host's flex size resolves.

**Evidence.**
- Commit `c8e0d84`. Bundle 8.73 MB clean. Tsc exit 0. Vitest 135/135 PASS.
- Agent-owned harness 3083, UI Reverse Engineering Analysis session. Token ZNN_KnVyn5IrxPWopp3Kq3Wm_To5C9QVg1kCig2KcEo.
- Post-fix screenshots: `.live-test/editor-md4-fix1.png` (CLAUDE.md, opaque white background, no bleed); `.live-test/editor-md4-fix1-AGENTS.png` (AGENTS.md, Monaco internal scroll confirmed, header `AGENTS.md (14122 bytes)` stays put at top); `.live-test/editor-md4-placeholder.png` (empty state after Chat→Editor round-trip — workspace name still centered, no regression).
- Killed harness cleanly (PID 9184); port 3083 free.

**Cross-ref.** MEMORY `L-5` captures the Monaco+flex race as a reusable lesson. Bug screenshots preserved.
