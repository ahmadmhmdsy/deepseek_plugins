# HANDOFF — auto-compact handoff plugin for DeepSeek Harness

**Workspace:** `D:\my_deepseek_harness\deepseek_plugins` (git repo, branch master)
**Written:** 2026-09-10 · **By:** the implementing agent session (DSH session-4755563c)
**Revised:** 2026-09-10 — M2 committed (`5bbbd82`), TODO-0 closed with dual-checkout evidence, CLAUDE/AGENTS re-tuned, TASKS/MEMORY/ENVIRONMENT created (live status: [TASKS.md](./TASKS.md))
**Purpose:** everything a fresh-context agent needs to resume Tasks 11-14 of the
approved implementation plan without re-deriving anything.

---

## 0. Read first (in this order)

1. This file (state + tasks).
2. `docs/superpowers/specs/2026-09-10-auto-compact-handoff-design.md` — approved design (what to build).
3. `docs/superpowers/plans/2026-09-10-auto-compact-handoff.md` — the implementation plan, Tasks 1-14 with exact code (2642 lines; Task sections start at lines 97/309/740/920/1122/1421/1599/1973/2023/2320/2334/2457/2599/2615).
4. `CLAUDE.md` (operating rules) + `AGENTS.md` (repo map) were **re-tuned to this project on 2026-09-10** (they had arrived as stale copies from the unrelated nano_SLMs project). `TASKS.md` (live status), `MEMORY.md` (durable lessons), and `ENVIRONMENT.md` (machine facts) now exist and are the authoritative homes for their concerns (map: AGENTS.md §1).

## 1. Mission

Three approved plugins that give DSH configurable auto-compact triggers
(percentage and/or absolute token count, per-model presets), a model-written
structured handoff archived to disk on **every** compaction, and a pointer
telling the model where the archive lives:

- **M1** `compaction-handoff/` — engine subclass of `BasicCompactionEngine` (DONE)
- **M2** `compact-config-command/` — `/compact-config` chat command (DONE, see §6)
- **M3** `web-compact-config/` — settings-card client plugin + host bridge (TODO)

Spec: one JSON store file (`handoff-config.json`), shared validator, archive
under `<root>/<sessionId>/<NNN>-<timestamp>[-a<k]>/` with `conversation.md` +
`handoff.md` + `index.md`, pointer prepended inside `<compacted-summary>`.

## 2. Machine layout — and the user's universal-target directive

| Role | Path | Notes |
|---|---|---|
| **Workspace (this repo)** | `D:\my_deepseek_harness\deepseek_plugins` | the plugins live here; loaded by path |
| **RUN harness (primary target)** | `D:\deepseek_harness\deepseek-harness` | base version 0.1.0-rc.7; **boots the current running harness** (Web GUI 127.0.0.1:3080 — never kill it) |
| **DEV fork (secondary target)** | `D:\my_deepseek_harness\deepseek-harness` | user fork, version 0.1.2-alpha.1, remotes ahmadmhmdsy/deepseek-harness-work.git |
| DSH home | `C:\Users\Ahmad Mahmoud\.dsh` | profiles: `headless`, `web` (**no `tui`** — plan's examples say tui, use web/headless); global `cordis.patch.yml` lives here too |

**User directive (2026-09-10, mid-session):** the plugin must work against the
RUN harness checkout, and if possible universally against both. **This was
implemented and verified** (47/47 tests green on each checkout, commit c3b9f75).
Default target = RUN.

Target selection mechanics:
- `node scripts/link-node-modules.mjs [--target <path>]` — arg > `DSH_TARGET` env > RUN path > sibling fork; resolves junction targets **by package-name scan**; writes the resolved path to `scripts/.dsh-target.txt`.
- `vitest.config.ts` reads `.dsh-target.txt` and generates its alias facade from THAT checkout's `tsconfig.base.json`. Junctions and test aliases always agree.
- `dsh-client-store` and `dsh-client-ui-renderer` are **absent in the RUN checkout** (fork-era packages) — the link script treats them as optional. M3 (web card) will need a per-target story.

Checkout API drift that matters (verified by hash + diff, 2026-09-10):
- `compaction-basic` src (index/config/summarizer/types) is **byte-identical**; only `region.ts` internal pricing semantics differ (signatures unchanged).
- `dsh-llm` renamed the call-id brand: RUN exports `CallId`, fork exports `ToolCallId` (same runtime shape). Handled adaptively in `archive.spec.ts` via namespace-probe.
- RUN `dsh-llm` has no stage-3 decorators; fork does (`@Remote`) — the inlined decorator plugin in vitest.config.ts is a regex-guarded no-op on RUN.
- `StreamChunk` unions are identical: stream chunks are `text-delta`/`finish`-style; a full-text `{type:'text'}` chunk crashes `BlockAssembler.push` on BOTH checkouts.
- `token-meter` measure nodes: `{ seq, tokens }` on both (fork adds `heuristicTokens` internally).

## 3. Environment facts + copy-paste commands

- node v24.11.1, pnpm 11.7.0, Windows. Machine facts live in ENVIRONMENT.md (the tuned AGENTS.md contains no Python/venv talk anymore).
- **Never** bare-kill processes; the running harness (web profile) is this very session's host.

```powershell
# Re-point junctions (choose target)
node scripts/link-node-modules.mjs                                   # default = RUN checkout
node scripts/link-node-modules.mjs --target 'D:\my_deepseek_harness\deepseek-harness'  # dev fork

# Full test suite (cwd = workspace; use the TARGET's vitest bin)
& 'D:\deepseek_harness\deepseek-harness\node_modules\.bin\vitest.CMD' run
& 'D:\my_deepseek_harness\deepseek-harness\node_modules\.bin\vitest.CMD' run

# Composition check (no boot; cwd = RUN checkout)
node --import tsx/esm apps/cli/src/bin.ts --profile web --patch 'D:/my_deepseek_harness/deepseek_plugins/cordis.patch.yml' --dump-config
```

Expected suite (post-M2, verified 2026-09-10 on BOTH checkouts): **9 spec files / 59 tests**
(pre-M2 was 47; M2 adds 12 via `compact-config-command/tests/{parse,command}.spec.ts`).

## 4. Completed work (commits, oldest first)

| Commit | What |
|---|---|
| `a619cc3` | baseline: design doc, approved spec, plan, resolution probe |
| `85871b9` | Task 1 — toolchain bootstrap (junctions, tsconfig, vitest, smoke) |
| `988402f` | Task 2 — config schema/validator (`src/config.ts`, `types.ts`) |
| `e8bf1f5` | Task 3 — config store (atomic write, watch, last-good) |
| `ac5acf6` | Task 4 — trigger math (modes, presets, wouldFire) |
| `7e4aaa3` | Task 5 — archive module (render, atomic dirs, index, git-exclude, pointer) |
| `3c6e475` | Task 6 — summarize→archive→pointer flow |
| `c3b9f75` | **universalization** (dual-checkout toolchain) |
| `8e5f1ed` | Task 7 — HandoffCompactionEngine + 7 integration tests |
| `c998d57` | Task 8 — composition overlay (`cordis.patch.yml`, `handoff-config.json`), verified via --dump-config |

## 5. Deviations ledger — the plan was written with internal contradictions; these are RESOLVED. Do not "fix" them back.

1. **vitest resolution** (Task 1): replaced `vite-tsconfig-paths` with explicit vite aliases generated from the target's `tsconfig.base.json` (exact keys + `/src/*` subpath aliases, longest-first) + an **inlined** copy of the checkouts' `standardDecoratorPlugin`. Why: the plugin scopes paths to its own project dir (workspace is outside the checkout) and subpath imports were externalized raw → Node SyntaxError; esbuild passes stage-3 decorators through untransformed → vm SyntaxError.
2. **link script fixes**: `linkRoot` creates the parent dir (nested `@types/react`); `resolvePkg` falls back to main-entry + walk-up (some packages don't export `./package.json`); `typescript` added to `ROOT_TOOLS`; junction targets resolved by name-scan with optional client packages.
3. **Task 4 semantics**: a preset `trigger` section **replaces** the global trigger wholesale (only `mode` stays inherited). The plan's own test requires preset `tokens` to beat the global `ratio+tokens` pair; its reference impl contradicted it. Section-level = spec §2 intent ("this model auto-compacts at 200k").
4. **archive.spec**: git-exclude assertion uses `/^\.dsh\/handoffs\/$/m` (file is newline-terminated; plan regex lacked `m`).
5. **summarize.spec**: (a) relativization test must override `config.archive.root` TOGETHER with `cwd` (plan overrode only cwd → unrelativizable); (b) `onFailure: proceed` returns the summary **without** a pointer (plan asserted on a second block its impl never produces; spec §6.5 = "warn and continue without archive").
6. **Task 7 engine spec**: fixture adapter streams `{type:'text-delta', index:0, text:'checkpoint'}` (full-text chunk is not a stream chunk); hot-reload case uses the 4-turn fixture so the shadowed span out-prices the framed checkpoint (~211 tokens; upstream shrink guard rejects tiny spans).
7. **Task 9 command**: top-level trigger shorthand — `set tokens|ratio|mode <v>` maps into `trigger.*` (USAGE grammar promised it; plan's `applySet` wrote a top-level key the shared validator rejects).
8. All plan `E:/js_projects/...` paths map to `D:/my_deepseek_harness/...` here; the patch file uses this workspace's absolute paths.
9. **Task 11 deepEqualJson source**: RUN's `dsh-llm` does not export `deepEqualJson`; it lives in `@deepseek-ai/dsh-settings` (settings/src/index.ts). The bridge imports it from dsh-settings (plan §11.1 said dsh-llm).
10. **Task 11 no composition `base` layer**: the plan registered `base: parseHandoffConfig(file)`. A frozen base resurrects externally-removed keys (resolved = merge(staleBase, newFile) → the watch writes them back to the file, undoing the user's edit). The bridge registers with NO base: the file's user layer IS the lower layer; the card's reset falls back to schema defaults (empty sections render documented defaults).
11. **Task 11 refusal hygiene**: the plan's `void scope.replace(...)` would be an unhandled rejection. Boot adopt and re-adoption catch, warn ("keeping last good"), and the echo guard rolls back on write failure; the dir-watcher timer is cleared on dispose; unreadable JSON is caught and warned; the watcher mounts via try/catch-warn (mirrors M1's store) instead of the plan's existsSync pre-check.
12. **Task 12 `dsh.client.external` dropped**: the client-modules host scan (packages/client/modules/src/index.ts `DshClientDeclaration`) reads only platform/inject/immediately; the real externals list lives in tsdown.config.ts (PLATFORM_MODULES per packages/client/web/src/platform.ts).
13. **Task 11 vitest facade fallback**: the RUN checkout's tsconfig.base.json has no bare keys for `@deepseek-ai/dsh-settings` / `@deepseek-ai/dsh-settings-file` (only `.../types`), so junction imports resolved to **lib** builds. vitest.config.ts gained a checkout-relative `FALLBACK_SRC_DIRS` map (bare + `/src/*` aliases, merged into the longest-first exact-alias sort) so the settings chain resolves to src on both checkouts.
14. **Task 11 tests above the plan minimum**: bridge tests boot the REAL FileSettingsProvider (chokidar) and drive writes via `ctx.settings.update/replace` — boot adopt + normalize, card write→file, external re-adopt, invalid-edit keeps last good, cross-field refusal, fresh-install semantics — while keeping plan Step 11.2's three required assertions.
15. **Client bundle delivery for out-of-tree plugins (Task 13 input, NEEDS_USER_DECISION)**: `ClientModuleRegistry.resolveMeta` resolves each loader entry's package via `require.resolve(name + '/package.json')` anchored at the profile dir; out-of-tree packages are NOT resolvable → negative verdict → no boot row → the card never loads. Delivery requires a junction `$DSH_HOME/profiles/node_modules/web-compact-config` → the workspace package (the healer never deletes foreign links) or a profile dependency + pnpm install. Also: a missing `lib/client.js` at boot throws MissingClientBundleError (loud boot failure) — build the bundle BEFORE booting with the patch entry.

16. **Task 12 typecheck-facade parity (§5.16)**: the facade compiles vendor sources into the program (type-only `@deepseek-ai/*` imports still resolve real files), so the root tsconfig must match the flags those sources compile under — copied vendor/cordis's own relaxations (`noImplicitAny/noImplicitThis/strictFunctionTypes/noUncheckedIndexedAccess/exactOptionalPropertyTypes/noImplicitOverride/noUnusedLocals/noUnusedParameters` = false). Vendor client files also import `*.module.css` (bundler-resolved only) — `web-compact-config/src/css-modules.d.ts` ambient-shims them for tsc. My own sources were written full-strict and stay clean.
17. **Task 12 card save protocol (§5.17)**: the client `SettingsScope` exposes per-field path ops only (`set(field,value)`/`unset(field)`), so the card stages and writes WHOLE sections (one field whose value is an object) — the plan's client `scope.update(patch)` does not exist. Reset = staged `unset` (pending clear) so the field re-inherits schema defaults; every write is read back from the snapshot's user layer (landed check); a save that did not land keeps its drafts.
18. **Task 12 bundler API (§5.18)**: tsdown 0.22.2 deprecates `external/noExternal` in favor of `deps: { neverBundle, alwaysBundle }` (the plan's snippet already used the modern form). Verified invocation: `node <checkout>\node_modules\tsdown\dist\run.mjs -c tsdown.config.ts`; the config's own `import 'tsdown'` resolves through the junction farm.

## 6. In-flight state — CLOSED (was the resume point)

- [x] M2 committed → `5bbbd82` (includes the trigger-shorthand deviation §5.7).
- [x] Full suite re-verified post-M2: **59/59 (9 files) on RUN and on DEV**
      (2026-09-10; target flipped to DEV, run, restored to RUN; evidence in TASKS.md).
- [x] Composition check re-run on RUN checkout: exit 0, all three entries present.
- [x] HANDOFF committed → `dc49f80`.
- Target record = RUN checkout (`scripts/.dsh-target.txt`).

**Resume point: Task 13** (M3 wiring + GUI gate — see §7 and [TASKS.md](./TASKS.md)). Task 12 is done (commit a23ca4d, 82/82 on RUN).

## 6b. Task 12 — DONE (was the in-flight pause; finished on resume, commit a23ca4d)

**Written:** 2026-09-10, mid-Task-12, by the M3 session (goal: M3 web settings
card). This is the exact pause point; a fresh agent should `git log --oneline -4`
to confirm nothing moved, then continue at Step 12-T1 below.

### Finished on resume (2026-09-10, same session)
- **12-T1 tsc clean (exit 0).** Checkbox `onEdit` unified on `(text: string) => void` (one
  declaration fix cleared all four call sites); `onClick={sectionReset('auto')}` de-inlined;
  `controller.ts` gained a private `isDirty` getter now shared by save() and projection().
  Facade: root tsconfig relaxed to the flags vendor/cordis itself compiles under (§5.16) and
  `src/css-modules.d.ts` ambient-shims vendor `*.module.css` imports (folded into §5.16).
- **12-T2 full suite: 82/82 (11 files), exit 0** on RUN.
- **12-T3 bundle rebuilt:** `lib/client.js` 43.11 kB; first line `window.__ModuleLoader__.load({`;
  `react/jsx-runtime` still external. Verified build cmd (tsdown 0.22.2, cwd = web-compact-config):
  `node 'D:\deepseek_harness\deepseek-harness\node_modules\tsdown\dist\run.mjs' -c tsdown.config.ts`.
- **12-T4 commit `a23ca4d`** — 9 files, 1572 insertions (client card + toolchain), tree clean.
- **12-T5 ledger extended to §5.16-5.18** + TASKS + MEMORY (this docs commit).

### Already committed
- Task 11 (host bridge): code `c299596`, docs `89291e7`. Suite was 71/71 (10 files) on RUN at that point.
- Deviations ledger was current through §5.15 at the pause; extended to §5.18 on resume. Target record = RUN (`scripts/.dsh-target.txt`).

### Task 12 — written and verified so far (UNCOMMITTED)
- Code: `web-compact-config/src/client/store.ts` (local SnapshotStore-like),
  `src/client/controller.ts` (staged section form; save = section-level
  `scope.set/unset` — see §5.17), `src/client/Card.tsx` (inline-styled `<li>`
  card, plain English), `src/client/index.ts` (keyed `settings.plugin.item`
  registration, inject `['slots','connection','remote','settingsScope']`),
  `tsdown.config.ts` (PLATFORM_MODULES externals + purity gate + loader banner).
- Tests: `tests/controller.spec.ts` — 11 tests, ALL GREEN (fake scope; staging,
  save patches, reset→unset, rows/carry-through, empty-row drop, failed-save
  keeps drafts, discard, preview, unavailable namespace).
- Bundle: BUILT + verified — `web-compact-config/lib/client.js` (42.95 kB),
  first line = `window.__ModuleLoader__.load({`, `react/jsx-runtime` external via
  require. Build cmd (cwd = workspace):
  `& 'D:\deepseek_harness\deepseek-harness\node_modules\.bin\tsdown.CMD' --config web-compact-config/tsdown.config.ts`
  (`lib/` is gitignored — rebuild after checkout).
- Toolchain: link script WANTED + `['dsh-client-runtime', true]`, NPM_DEPS +
  `{ name: '@types/node', from: '' }`; root `tsconfig.json`: +dsh-client-runtime
  paths, `baseUrl` DROPPED (TS 6.0.3 deprecates it) with every paths value
  prefixed `../deepseek-harness/`; junctions RELINKED (target still RUN).

### Step-by-step resume checklist (Task 12 finish line)
- [x] **12-T1 — tsc clean (exit 0).** Ran
      `node 'D:\deepseek_harness\deepseek-harness\node_modules\typescript\bin\tsc' --noEmit -p web-compact-config/tsconfig.json`
      (cwd = workspace). Known remaining errors, in two buckets:
      1. MY files (small, exact fixes):
         - `Card.tsx` Checkbox: unify `onEdit` on `(value: string) => void`
           (it already emits 'true'/'false'); fix the 4 boolean-typed call
           sites (archive.gitExclude, auto, row.disabled ×2).
         - `Card.tsx` (~line 350): `onClick={sectionReset('auto')()}` →
           `onClick={sectionReset('auto')}` (inline call returns void).
         - `controller.ts` save(): `!this.dirty` — no such member; add a
           private `isDirty` getter (same flags the projection uses:
           pendingClear/autoPendingClear/modelsPendingClear/staged.size/
           autoStaged/modelsStaged) and use it in save() + projection().
      2. VENDOR cordis src (TS7053/TS7023/...): `vendor/cordis/tsconfig.json`
         compiles with RELAXED flags (`noImplicitAny/noImplicitThis: false`,
         `strictFunctionTypes: false`, `noUncheckedIndexedAccess: false`,
         `exactOptionalPropertyTypes: false`, `noImplicitOverride: false`,
         `noUnused*: false`) — the workspace facade is stricter than the flags
         cordis itself compiles under. RECOMMENDED (record as deviation §5.16):
         copy those relaxations into the root tsconfig (they only REMOVE
         errors; my sources were written under full strict and still compile),
         then re-run tsc until only zero errors remain.
- [x] **12-T2 — full suite.** Got **82/82 (11 files), exit 0**: 71 previous + 11
      controller. If a bridge test flakes on timing, see MEMORY §3 (wait for the
      boot-normalized shape before editing the config file).
- [x] **12-T3 — rebuilt the bundle** (43.11 kB) and re-verified the banner +
      `require("react/jsx-runtime")` line.
- [x] **12-T4 — committed** (a23ca4d, 9 files, 1572 insertions). Planned subject:
      `feat(web-compact-config): client card with staged form and loader artifact`
      (files: web-compact-config/{package.json,tsconfig.json,tsdown.config.ts},
      src/**, tests/controller.spec.ts, scripts/link-node-modules.mjs, tsconfig.json).
- [x] **12-T5 — extended the deviations ledger + TASKS + MEMORY** (commit docs):
      §5.16 typecheck-flag relaxation; §5.17 card save protocol (client
      `SettingsScope` has per-field path ops only → the card stages WHOLE
      sections; plan's `scope.update(patch)` does not exist client-side);
      §5.18 tsdown `deps.neverBundle/alwaysBundle` (modern API; the plan's
      snippet already used it — `external/noExternal` warn as deprecated).

### After Task 12 — remaining M3 steps
- **Task 13**: add the patch entry (plan Step 13.1, workspace paths);
  composition check (`node --import tsx/esm apps/cli/src/bin.ts --profile web
  --patch 'D:/my_deepseek_harness/deepseek_plugins/cordis.patch.yml'
  --dump-config`, cwd = RUN checkout; expect web-compact-config row); then the
  **NEEDS_USER_DECISION** delivery step (§5.15): junction
  `$DSH_HOME/profiles/node_modules/web-compact-config` → this workspace package
  (writes OUTSIDE the repo — ask the user first), and the user-gated GUI
  checkpoint (boot with the patch; card visible; edit→file changes; external
  edit→card reflects; invalid input blocks inline).
- **Task 14**: acceptance walkthrough (spec §12), typecheck the other two
  packages (same facade now), oxlint if it cooperates, README/docs
  (docs/compaction-handoff.md per plan 14.3), final PASS/FAIL/SKIPPED report.
- **User checkpoints owed** (never perform alone): plan 8.4 (patch boot mounts),
  10.2 (`/compact-config show` + `test` live), Task 13 GUI card check.

### Task 13 progress (2026-09-10)
- Patch entry + composition check PASS (commit `811579e`): exit 0 on the RUN checkout;
  compaction-basic disabled; compaction-handoff / compact-config-command / web-compact-config
  rows all present with correct name/config.
- Delivery junction created (user-approved): `C:\Users\Ahmad Mahmoud\.dsh\profiles\node_modules\web-compact-config`
  → the workspace package. Resolve check: `require.resolve('web-compact-config/package.json', { paths: [<profile dir>] })`
  returns the workspace path; `lib/client.js` reachable through the junction.
- Delivery gotcha found and fixed: the registry resolves `name + '/package.json'`, so the package
  MUST export `./package.json` (fixed `48ed9eb`; mirrors in-tree client manifests). Without it the
  boot scan fails even with the junction in place — this is the §5.15 failure mode in a new disguise.
- GUI check (plan 13.2) handed to the user: boot the RUN checkout with
  `node --import tsx/esm apps/cli/src/bin.ts --profile web --patch 'D:/my_deepseek_harness/deepseek_plugins/cordis.patch.yml'`
  and verify (a) the Plugin configuration tab shows the compact-handoff card; (b) edit → Save →
  `handoff-config.json` changes on disk; (c) an external file edit is reflected on the next
  snapshot refresh; (d) invalid input blocks the save inline. The same boot is plan 8.4 evidence.

## 7. Remaining TODO (Tasks 11-14)

- [x] **Task 11 — M3 host bridge** — DONE 2026-09-10, commit `c299596`. Settings seam verified on RUN first (register options `{base, applies, validate}`, scope `get/watch/update/replace`; agent-presets is the in-tree precedent). Bridge: no `base` layer (deviation §5.10), echo-guarded commit watcher, debounced dir re-adopt with refusal warnings. Tests: 12 (schema defaults/refusals, echo-guard, 6 service-level integration tests over the real FileSettingsProvider). Suite 71/71 (10 files) on RUN.
- [x] **Task 12 — M3 client card** — DONE 2026-09-10, commit `a23ca4d`: tsc clean, suite 82/82 (11 files) on RUN, bundle 43.11 kB (banner + purity gate). Plan lines 2457-2599.
- [ ] **Task 13 — M3 wiring + GUI verification** (plan 2599-2615) `in_progress`: patch entry + composition check PASS (`811579e`); delivery junction created (user-approved); `./package.json` export fixed (`48ed9eb`); GUI check (plan 13.2) handed to the user — awaiting report.
- [ ] **Task 14 — acceptance walkthrough + docs** (plan 2615-2634): walk the 9 acceptance criteria (spec §12) with evidence; write user docs (README-style usage: install via patch, config file reference, command reference); check off plan checkboxes only for what actually passed; final report to the user with PASS/FAIL/SKIPPED labels.
- [ ] **User checkpoints owed** (do not perform alone): plan 8.4 (boot session with the patch; confirm engine mounts, no load error), 10.2 (run `/compact-config show` + `/compact-config test` in a real session), Task 13 GUI card check. Surface these clearly in the final report.

## 8. Gotchas (hard-won)

- Class identity demands **everything resolves to src** (alias facade) — mixing junction `lib/` builds with src breaks `instanceof`. If new tests import new `@deepseek-ai/*` names, extend `WORKSPACE_PACKAGES` in BOTH `scripts/link-node-modules.mjs` and `vitest.config.ts` (keep the lists equal).
- Writing TS spec files through tooling: escape backticks (`\x60` or `new RegExp('...')`) — heredoc-style writes choke on raw fences/regexes.
- Watch tests depend on fs.watch + 150ms debounce; `vi.waitFor` defaults suffice on this machine (verified repeatedly).
- `--profile tui` does not exist on this machine; use `web` or `headless`.
- The archive pointer path is workspace-relative only when the archive sits under cwd (`pointerPath` in summarize.ts) — tests cover both branches.
- `deepFreeze` comes from `@deepseek-ai/dsh-llm` in BOTH checkouts (verified 2026-09-10; recorded in MEMORY.md §1).
- git: this workspace is its own repo (remote ahmadmhmdsy/*). `node_modules/` is gitignored; junctions live there. Commit after every green task (house pattern).

## 9. File inventory (workspace)

```
scripts/link-node-modules.mjs        junction builder (target-aware, name-scan)
scripts/.dsh-target.txt              recorded target (gitignored — machine-local)
tsconfig.json                        editor/typecheck facade (paths → dev fork; types-only, not used by vitest)
vitest.config.ts                     target-driven aliases + inlined decorator plugin
cordis.patch.yml                     M1+M2 wiring overlay (--patch)
handoff-config.json                  the single store file (user-editable)
compaction-handoff/                  M1: src/{index,config,store,trigger,archive,summarize,types}.ts + tests/ (7 files incl. toolchain.spec)
compact-config-command/              M2: src/{index,parse}.ts + tests/{parse,command}.spec
probe-dsh-resolution/                keep — resolution regression probe
docs/superpowers/{specs,plans}/      the two source documents
HANDOFF.md                           this file (narrative + deviations ledger)
TASKS.md · MEMORY.md · ENVIRONMENT.md  live status · durable lessons · machine facts
```
