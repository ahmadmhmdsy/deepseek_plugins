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

## 6. In-flight state — CLOSED (was the resume point)

- [x] M2 committed → `5bbbd82` (includes the trigger-shorthand deviation §5.7).
- [x] Full suite re-verified post-M2: **59/59 (9 files) on RUN and on DEV**
      (2026-09-10; target flipped to DEV, run, restored to RUN; evidence in TASKS.md).
- [x] Composition check re-run on RUN checkout: exit 0, all three entries present.
- [x] HANDOFF committed → `dc49f80`.
- Target record = RUN checkout (`scripts/.dsh-target.txt`).

**Resume point: Task 11** (M3 host bridge — see §7 and [TASKS.md](./TASKS.md)).

## 7. Remaining TODO (Tasks 11-14)

- [ ] **Task 11 — M3 host bridge** (plan lines 2334-2457): `web-compact-config/src/index.ts` — settings namespace as a synced VIEW of handoff-config.json. BEFORE coding: verify the settings seam (`ctx.settings.register(ns, schema, {validate?})`, `settingsNamespace('compact-handoff')`) exists in the **RUN** checkout's `packages/settings/settings/src` (plan §0.2 verified it on the fork only). Mutations must go through the shared validator (`parseHandoffConfig`) + `atomicWriteJson` (reuse `compaction-handoff/src/store.ts` by relative import — sibling packages import each other by relative path, no junction needed).
- [ ] **Task 12 — M3 client card** (plan 2457-2599): `src/client/{index,controller}.tsx-ish,Card.tsx,store.ts`, tsdown CJS client bundle (`window.__ModuleLoader__` banner contract, entry lib/client.js). Universal-target caveat: `dsh-client-store`/`dsh-client-ui-renderer` packages don't exist in RUN sources; check what the RUN checkout's `packages/client/ui-settings-plugins/src/client` actually exports and follow the RUN tree for the card (the card ships to the RUNNING harness). React 18 JSX; card types from `@deepseek-ai/dsh-client-ui-slots` (type-only). If a needed client package is missing on RUN, stop and report — M3 client may be fork-only by user decision (ASK; do not assume).
- [ ] **Task 13 — M3 wiring + GUI verification** (plan 2599-2615): extend `cordis.patch.yml`, tsdown build of the client bundle, then GUI verification needs a RUNNING web harness — do NOT boot long-lived servers from the session; hand to the user (checkpoint).
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
