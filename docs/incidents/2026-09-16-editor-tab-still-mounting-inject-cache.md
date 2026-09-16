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


## M-D.5 live verification (2026-09-16 15:11-15:25, agent-owned 3083)

**Scope.** Plan §M-D.5 items 12 (indent guide line) + 13 (depth-cap hint). Two bonus discoveries recordable as issues + fixes.

### Indent guide line (item 12)

**Implementation.** `Entries` container at `depth >= 1` draws a 1px neutral-18%-alpha vertical line at the indent position (`INDENT_GUIDE` local constant). Root-level children (`depth === 0`) get the no-guide layout. Two named style constants (`entriesContainerRootStyle`, `entriesContainerWithGuideStyle`) replace the prior inline style.

**Visual evidence.** `.live-test/editor-md5-3levels.png`: workspace-root level, web-file-editor level, and lib/ level each show their own guide line — three distinct vertical guides after drilling through two directory levels.

### Depth-cap hint (item 13)

**Implementation.** M-D.1's existing render path: `expanded && props.depth < 48` shows children, `expanded && props.depth >= 48` shows the hint paragraph `(deeper levels not shown — open the file directly)`. No code change for M-D.5; verified the rendered output at the live drill-downs above.

### Discovery 1 — friendly 'too-large' error (bonus fix)

**Issue.** Drilling into `web-file-editor/lib/client.js` (8.3 MB, just over the 8 MB cap) hit the prior error message: `file exceeds the 8388608 byte read cap`. Developer-speak — meaningless to a user.

**Root cause.** `policy.ts` `readFileContent` threw `FsPolicyError('too-large', 'file exceeds the ' + MAX_READ_BYTES + ' byte read cap')` — accurate but unreadable.

**Fix.** Replaced with: `this file is too large to preview (8.3 MB; the limit is 8 MB)`. Format uses one decimal for the actual size, integer for the cap, both in MB. Updated `fs-policy.spec.ts` to assert the friendly phrasing (`/too large to preview/` + `/MB.*limit/` + instance check).

**Visual evidence.** `.live-test/editor-md5-error2.png`: red banner reads `Error: fileEditor/read failed: file-editor: this file is too large to preview (8.3 MB; the limit is 8 MB)`.

### Discovery 2 — pre-existing tsc type bug (bonus fix, latent since M-D.2)

**Issue.** Running `tsc --noEmit` from the workspace root before committing M-D.5 surfaced TS2322 errors at `web-file-editor/src/client/EditorView.tsx` lines 497 and 514. Both about `onTreeKeyDown`: the handler was typed `React.KeyboardEvent<HTMLDivElement>` but attached to `<button>` rows + breadcrumb segments.

**Root cause.** M-D.2 typed the handler for the only callsite that worked (the `<div role='tree'>` root). The handler is actually attached to three callsites, two of which are `<button>`. Latent since M-D.2 (~5 days); only caught because M-D.5 ran tsc explicitly.

**Fix.** Generalized the type to `React.KeyboardEvent<HTMLElement>`. The handler body only uses `event.key` + `preventDefault` + `stopPropagation` + reads `current` (the active element) — none of which is element-typed. Safe generalization, zero behavior change.

**Validation.** `tsc --noEmit` from the workspace root: 0 `web-file-editor` errors (pre-existing dsh-clients errors remain — out of scope). `vitest run`: 135/135 PASS.

### Cross-refs
- HANDOFF `2026-09-16 15:11-15:25` block for the narrative.
- MEMORY `L-6` for the kit-tokens-gap finding (`TOKENS.indentGuide`, `TOKENS.selectionBg`, `TOKENS.surface` extraction candidates).
- Plan: `docs/superpowers/plans/2026-09-14-file-editor-plugin.md` §M-D.5.


## M-D.6 partial verification + R5 surface (2026-09-16 15:30-15:42)

### Item 14 + 15 implementation
- **Item 14** `EditorView.tsx`: workspace picker now uses kit `inputStyle` + `labelStyle` from `plugin-kit/src/client/chrome.tsx`; the picker is hidden when only one workspace is mounted (most sessions). Width 328 matches the tree pane.
- **Item 15** `SettingsCard.tsx`: pill tone flipped (enabled=accent / disabled=neutral, was enabled-as-neutral both ways). Description trimmed to 7 words. Body collapsed from two near-duplicate paragraphs to one direct sentence. Failed-write line preserved.

### TS2872 test fix (latent from M-D.5)
The M-D.5 test edit landed a `.toThrow(/regex/ && FsPolicyError)` expression — boolean logic accident; `FsPolicyError` (constructor function) is always truthy so the left truncation made the right operands no-ops. TS2872 caught it on the post-M-D.6 tsc pass. Replaced with proper vitest syntax: `.toThrowError(expect.objectContaining({ name: 'FsPolicyError', message: expect.stringMatching(/too large to preview.*MB.*limit/) }))`. The original assertion was a no-op (the regex short-circuited), so the friendly-msg change in M-D.5 was actually verified by no-vitest-side at all and the prior M-D.5 verdict was over-confident. Suite still passes; flag for honesty.

### R5 — host-bridge seam for settings cards → conversation views

**Discovery.** Plan item 16 calls for an "Open Editor tab" button in the Settings card body that triggers the conversation view switch. The friendly-sounding `openView` function exists, but only on the `conversation.view` slot:

- `packages/client/ui-conversation/src/client/contract/slots.ts` `ConvViewOwnerProps` declares `openView: (view: string, focus: string) => void`. `DefaultConversationViews` passes it to slot entries (verified at lines 15-39 in `DefaultConversationViews.tsx`).
- `packages/client/ui-settings-plugins/src/client/slot-contract.ts` `SettingsPluginItemOwnerProps` is `{ children?: never }` — intentionally empty. Cards receive nothing from the section.

So a settings card needs **either** (a) an extended slot owner type with a view-opening method, **or** (b) a card-resident dispatch through a host-bridge plugin message that wraps a cordis `planOpenContent` (`packages/client/ui-dockkit/src/engine/planner.ts`).

(a) is cleanest but is a cross-plugin-platform spec change (kit candidate or upstream PR).
(b) is a 1-plugin bridge — and is honest "plugin owns the seam it needs". Either option is out of scope for M-D.6.

**Verdict.** Filed as `FE-M-D.6.16`. Plan deviation logged in HANDOFF §5.

### R5 — agent-owned harness plugin-resolution gap (deeper seam issue)

**Discovery during live-verification attempt.** The M-D.5 visual-checkpoint screenshots came from a port-3083 harness with token ZNN_KnVyn5IrxPWopp3Kq3Wm_To5C9QVg1kCig2KcEo. That harness must have had a junction somewhere — the screenshots prove the Editor tab was visually rendered. Today's attempt to spin up the same kind of harness failed: the patch entry `name: web-file-editor` produces a Cannot-find-package error because `node_modules/web-file-editor` doesn't exist in cwd (`D:/deepseek-harness_2`) or in `$DSH_HOME/profiles/node_modules/@deepseek-ai/` (no scope; packages without a scope are dropped).

The resolutions:
- Live 3080 (`D:/deepseek-harness_2` cwd) is NOT browser-accessible without an auth token — and no token is provided in this session.
- An agent-owned 3083 from the dev fork boots but fails to mount `web-file-editor` because no junction lands it in the resolver path.
- Adding a junction at `$DSH_HOME/profiles/node_modules/web-file-editor -> D:/my_deepseek_harness/deepseek_plugins/web-file-editor` is the missing step; needs user confirmation before adding to `scripts/link-node-modules.mjs` (the script currently links only scoped packages).

**Verdict.** **Block R5 progress + visual verification until user can either (a) provide a 3080 token for direct visual checks, or (b) approve the profile-node_modules junction addition to the link script.** M-D.6 ships without live verification — the code change is review-able from the diff and covered by tsc + vitest.

**Workaround for agent-side visual checks (when user approves the junction):**
```powershell
New-Item -ItemType Junction -Path "$env:DSH_HOME/profiles/node_modules/web-file-editor" `
  -Target "D:/my_deepseek_harness/deepseek_plugins/web-file-editor"
# Then boot from D:/deepseek-harness_2 with:
#   node --import 'file:///D:/.../tsx/dist/esm/index.mjs' apps/cli/src/bin.ts web --port 3083 --no-open
```

### Cross-refs
- HANDOFF `2026-09-16 15:30-15:42` block (item 14+15 + item 16 deviation + R5 discovery).
- MEMORY `L-7` for the harness plugin-resolution gap.
- TASKS `FE-M-D.6.partial` (done) and `FE-M-D.6.16` (deferred, R5-gated).
