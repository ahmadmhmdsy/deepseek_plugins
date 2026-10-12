# TASKS — live task status

TASKS.md owns the **live status**; [HANDOFF.md](./HANDOFF.md) owns the narrative
and evidence; the plan (`docs/superpowers/plans/2026-09-10-auto-compact-handoff.md`)
owns the approved task definitions.

**Last updated:** 2026-10-12 14:10 · **Active front:** none in this workspace — the auto-compact plugin now lives in its own repo (`dsh-autocompact`) and the File Editor front was RETIRED (native replacement; see the banner below).

## File Editor plugin — RETIRED 2026-10-12 (was: queued; direction approved 2026-09-14, plan: docs/superpowers/plans/2026-09-14-file-editor-plugin.md)

**RETIRED 2026-10-12 (user decision).** `web-file-editor/` was deleted from this repo:
DSH 0.2.1-alpha.2 ships the native replacement — right-Sidebar file tree
(`@deepseek-ai/dsh-client-ui-sidebar-files`) + document preview
(`@deepseek-ai/dsh-client-ui-sidebar-documentpreview`: Markdown, code, images, PDF, HTML,
Office/spreadsheets). The uncommitted WIP at removal is archived at
`.archive/web-file-editor-wip-2026-10-12/` (gitignored, with a restore recipe) and the
tracked code stays in history. **Everything in this section and every FE-M-* entry below is
historical.** Deliberately left in place: `file-editor-config.json` and three uncommitted
`plugin-kit` theme files (see Backlog).

- **FE-M-A — View-only Monaco editor tab** `in_progress` —
  - [x] FE-M-A Task 1 — tab path de-risk: conversation.view placeholder registered (id 'editor', order 15); bundle 3.03 kB; suite 106/106 (14 files) on RUN and DEV; tsc zero NEW errors (local slot shim; vendor-baseline noise documented in HANDOFF §8g); patch rows + profile delivery junction + composition check PASS — commit 364043f. **Live-GUI tab = user checkpoint (needs a harness boot of the web profile; never restart the running harness ourselves).**
  - [x] FE-M-A Task 2 — settings enable/disable gate (commit fe66813): file-editor-config.json store + parseEditorConfig validator (fail-fast); host bridge registers the `file-editor` settings namespace via plugin-kit hot-reload-store (boot adopt / echo-guarded commit / external re-adopt); the client gate mounts/withdraws the tab live off settingsScope. 113/113 (16 files) on RUN and DEV; tsc zero NEW delta; DEV composition check exit 0.
  - [x] FE-M-A Task 3b — client fileEditor Remote mount + explorer tree workbench (f0f639c): strict hand-built contribution (src-json refused by the Client $mount), faceForRemote unwrap, EditorView replacement — workspace selector + lazy recursive tree + read-only content pane. 26/26 editor tests green RUN+DEV; composition exit 0.
- [x] FE-M-A Task 4 — Monaco engine inlined (`be164f0`): monaco-editor 0.56.0 added as root devDependency in BOTH checkouts (user-approved install), junctioned via link-node-modules NPM_DEPS; bundle single-file 8.69 MB (strict css stubs + inlineDynamicImports, no external require remains); read-only workbench pane (highlighting via main thread, Blob-worker fallback recorded, per-language dynamic imports inline). DELTA from plan: 'lazy chunk' degraded to lazy INSTANTIATION — the loader forbids extra script URLs, so the engine ships inside the one bundle (deviation recorded HANDOFF §9). 26/26 green RUN+DEV; composition exit 0.
  - [x] FE-M-A Task 1 — tab path de-risk: conversation.view placeholder registered (id 'editor', order 15); bundle 3.03 kB; suite 106/106 (14 files) on RUN and DEV; tsc zero NEW errors (local slot shim; vendor-baseline noise documented in HANDOFF §8g); patch rows + profile delivery junction + composition check PASS — commit 364043f. **Live-GUI tab = user checkpoint (needs a harness boot of the web profile; never restart the running harness ourselves).**
  - [x] FE-M-A Task 5 — Plugins settings card (9d48d78): EditorCardController over the bound file-editor settingsScope + SettingsCard (kit PluginCardShell, head Switch, live-gate copy) registered into 'settings.plugin.item'; 31/31 (6 files) RUN+DEV, bundle rebuilt (8.71 MB), composition exit 0.
  - [x] FE-M-A Fix — Editor tab “still mounting” placeholder (2026-09-16): ui-renderer memoizes inject results per binding, so the static inject face was pinned before the async remote.$mount resolved. Reactivity moved into the face: inject: () => ({ hooks: { fs, workspaces } }) with manual HostObservable sources (fs snapshot flips after mount + emitFs(); workspaces rides workspaces.list with identity-stable EMPTY_ROWS); view consumes synthesized useFs/useWorkspaces selector hooks. 135/135 (19 files, target vitest bin) exit 0; bundle rebuilt; composition exit 0; guide §1b added. **Live browser confirmation = USER checkpoint (hard reload 3080).**
- **FE-M-A Task 6 — Chat-click → editor** `deferred by user decision (2026-09-15, defer option)` — plugin-side IMPOSSIBLE at current platform boundary: the per-session active-view state (chatStore) is created privately inside ui-conversation's day apply and never published; the only writer of `view` is `actions.setView` (ConversationSession header tabs / ChatView inspectCall); slot children receive neither the store handle nor actions unless they declare the same (private) handle. Researched 2026-09-15 (run reads ui-conversation/src/client/{apply,slots,contract/views}.ts, ui-slots/src/index.ts, runtime/src/client/slots.ts). NEEDS_USER_DECISION on the unblock path (see agent question). — host fs service (allowlist'd workspace roots), save/dirty/conflict flow, create/rename/delete.
- **FE-M-B — Write support** `pending` — host fs service (allowlist'd workspace roots), save/dirty/conflict flow, create/rename/delete.
- **FE-M-C — Drag-drop & reorganize** `pending` — DnD move, external import, workspace search. NOT forgotten — lives here and in the plan doc.
- **COMPAT-1 — port plugin suite to DSH 0.1.6-alpha.1** `done`(2026-09-15) — suite 135/135 (vitest, target vitest bin), tsc zero errors (incl. vendor noise), both client bundles rebuilt, composition check exit 0 (4 plugin rows). Harness application: LIVE 3080 harness already boots from `D:\deepseek-harness_2` via the `profiles/web` permanent patch layer + shared fallback symlinks (native composition verified: dump exits 0, four rows, compaction-basic disabled); new plugin code activates at next restart (user checkpoint). Target-lock = `D:\deepseek-harness_2` only; old checkouts dropped where conflicting (user decision, incl. FE-M-A Task 6 superseded by native file preview in chat). Drift record: docs/incidents/2026-09-15-dsh-0.1.6-alpha.1-compatibility-contrast.md.

Statuses: `pending` / `in_progress` / `blocked` / `done` (done = finished AND validated).
User-gated tasks say so explicitly.

## Done (evidence attached)

| Task | Commit(s) | Evidence |
|---|---|---|
| Baseline: spec + plan + resolution probe | `a619cc3` | docs/superpowers/{specs,plans}, probe-dsh-resolution/ |
| Plan Task 1 — toolchain bootstrap (junctions, tsconfig, vitest, smoke) | `85871b9` | smoke test green on fork |
| Plan Tasks 2-6 — config schema/validator, store, trigger math, archive, summarize flow | `988402f` `e8bf1f5` `ac5acf6` `7e4aaa3` `3c6e475` | unit + integration tests |
| Universal dual-checkout toolchain (RUN + DEV) | `c3b9f75` | 47/47 tests green on each checkout (2026-09-10) |
| Plan Task 7 — HandoffCompactionEngine + integration tests | `8e5f1ed` | 7 integration tests |
| Plan Task 8 — composition overlay wiring | `c998d57` | `--dump-config` exit 0 |
| Plan Tasks 9-10 — M2 `/compact-config` + wiring | `5bbbd82` | parse 8 + command 4 tests; suite 59/59 on RUN |
| TODO-0 re-verification (post-M2 full suite) | — | **59/59 (9 files) on RUN and on DEV** (2026-09-10); target flipped to DEV, run, restored to RUN |
| Resume handoff document | `dc49f80` | HANDOFF.md |
| Doc tuning: CLAUDE.md/AGENTS.md rewritten for this project; TASKS/MEMORY/ENVIRONMENT created | `cd2035e` | 2026-09-10 |
| Plan Task 11 — M3 host bridge (web-compact-config) | `c299596` | 71/71 (10 files) on RUN; 12 bridge tests incl. 6 service-level integration tests over the real FileSettingsProvider |
| Task 11 deviations ledger + M3 discoveries | `89291e7` | HANDOFF §5.9-5.15, §6b |
| Plan Task 12 — M3 client card (web-compact-config) | `a23ca4d` | tsc clean; 82/82 (11 files) on RUN; bundle 43.11 kB (loader banner, `react/jsx-runtime` external); deviations §5.16-5.18 |
| Per-plugin READMEs (user request) | `0078b0e` | compaction-handoff / compact-config-command / web-compact-config README.md |
| Card UI redesign + mount-fix + incident record | `682f923` `070adb0` `b4c3970` | 95/95 after fix; card restored in live GUI (cache-bust proven); docs/incidents/2026-09-13-card-mount-border-missing-and-stale-http-cache.md |
| Collapsible disclosure card like built-ins (user request) | `500ee19` | live GUI round-trip verified (expand/collapse + aria-expanded); screenshots .live-test/card-open-drawer.png & card-closed.png; suite 95/95; pushed origin `500ee19` |
| Header enable/disable toggle in the card head (user request) | `6c52415` | tsc exit 0; vitest 95/95 (11 files) on RUN; bundle rebuilt 60.61 kB; live-GUI refresh is the user's checkpoint (cache-staleness caveat in HANDOFF §8) |

## Next (queued — approved plan Tasks 11-14)

- **Task 13 — M3 wiring + GUI verification** `in_progress` — plan lines 2599-2615:
  - [x] Patch entry in `cordis.patch.yml`; composition check PASS (exit 0 on RUN;
        compaction-basic disabled; compaction-handoff / compact-config-command /
        web-compact-config rows all present) — commit `811579e`
  - [x] Delivery junction created (user-approved):
        `C:\Users\Ahmad Mahmoud\.dsh\profiles\node_modules\web-compact-config` →
        this workspace package; `require.resolve('web-compact-config/package.json')`
        from the profile dir resolves and `lib/client.js` is reachable (manifest gained
        the required `./package.json` export — `48ed9eb`)
  - [x] GUI check (plan 13.2) — **agent side done 2026-09-12** (agent-browser on
        a second DSH instance, `--port 3082`): all three plugin rows Mounted/Enabled,
        `compaction-basic` disabled, and the "Handoff auto-compact" card renders in
        Settings → Plugins → Plugin configuration. Enabler: the patch row's `name`
        had to be the package name (`web-compact-config`), not a file URL — a file
        URL loads the host half but silently suppresses the client bundle
        (MEMORY §1, 2026-09-12 entry; screenshot `gui-card-3082.png`).
        STILL USER-GATED: edit→Save→file changes, external edit→card reflection,
        and invalid-input inline block — report to the user for a final sign-off.
  - [x] Hot-reload discriminator (post-user-report): mid-turn compact fires
        ~0.9 s after a trigger edit on the isolated 3082 instance (001
        08:47:22.714Z -> edit 08:47:25.384Z -> 002 08:47:26.248Z); raising the
        trigger silences compaction. HANDOFF §8d / MEMORY §4b concluded
        (commit c665b84). Test artifacts gitignored under .dsh-test/.
- **Task 14 — acceptance walkthrough + docs** `in_progress` (agent side done
  2026-09-12; two live user checkpoints remain):
  - [x] 14.1 — vitest 95/95 (11 files) exit 0 on RUN (fresh run 11:53); oxlint
        0 errors / 10 style warnings; tsc: web-compact-config clean; the other two
        == the pre-existing fork-target drift ledger (HANDOFF §8c), verified
        unchanged.
  - [x] 14.3 — docs/compaction-handoff.md (full reference) + README.md (quickstart).
  - [x] 14.4 — spec §12 checkboxes updated with evidence pointers (8/9 checked;
        5th — model reads archive live — left unchecked as a user checkpoint).
  - [ ] 14.2 live run-through with the user: model-reads-archive check + confirm
        `first` mode live + manual `/compact`/overflow observation. Remaining
        steps are USER-GATED (never performed by the agent).

## User checkpoints owed (surface in reports; never perform alone)

- [x] Plan 8.4 — boot a session with `cordis.patch.yml`; the handoff engine mounts
      with no load error — evidenced 2026-09-12 in the 3082 boot's Plugin list
      (`compaction-handoff` Mounted/Enabled, `compaction-basic` Disabled).
- [ ] Plan 10.2 — run `/compact-config show` and `/compact-config test` in a
      real session (3080 now confirmed running the suite live via its profile
      patch — session 2264f2e2 archived 001-033; no restart needed).
- [x] Task 13 — settings card visible and functional in the web GUI (visible and
      rendered 2026-09-12 via agent-browser; save→file / external-edit / invalid-input
      sub-checks still await the user's hands-on sign-off).

## Plugin kit front (approved spec/plan 2026-09-13)

Spec: `docs/superpowers/specs/2026-09-13-plugin-kit-design.md` · Plan:
`docs/superpowers/plans/2026-09-13-plugin-kit.md`. Goal: docs + template +
plugin-kit so future plugins import/inherit instead of re-deriving.

- **Task K1 — best-practices docs** `done` (3 guides: source plugin, client
  card, claim-done checklist)
- **Task K2 — `_template-plugin/` copy-and-rename skeleton** `done`
- **Task K3 — plugin-kit extraction** `done` — user ordered early
  extraction (2026-09-13; the consumer-gating note is superseded by that
  explicit call). K3-1 chrome · K3-2 settings-form · K3-3 host helpers —
  all landed, suite green on BOTH checkouts after each.

Next plugin-kit step: the next real plugin consumes the kit (see
`_template-plugin/README.md` and docs/best-practices/).

- **Task FE-M-F — Editor tab blank-after-reload fix (inject gate + namespace access)** `done` **[RETIRED 2026-10-12 — historical]**
  (2026-09-16 14:05) — user reported blank. Root causes: inject-gated ctx reads
  (added 'remote'/'workspaces' to `inject` + package features), mounted
  namespaces reach via `ctx.get('remote.'+ns)` (never inject-declared), and a
  missing `FS_NAMESPACE` import emitted as a bare identifier by tsdown.
  Verified live on an agent-owned 3082 instance (headless agent-browser drive:
  explorer + file read PASS, clean console); suite + rebuild green at each step.
  Record: docs/incidents/2026-09-16-editor-tab-still-mounting-inject-cache.md
  follow-up. Live 3080 re-verify remains a user checkpoint (Ctrl+F5).

- **Task FE-M-D — Editor tab UX polish (UX review milestone)** `retired` **[2026-10-12 — historical]**
  (2026-09-16 14:09; **M-D.1 done 2026-09-16 14:18**) — milestone added to the
  file-editor plan in `docs/superpowers/plans/2026-09-14-file-editor-plugin.md`
  §M-D after the thorough UI/UX review. Eight sub-batches (M-D.1 … M-D.7)
  plus a parked list for M-E (search, copy-path, recent files). Display-only;
  no data-plane changes. Acceptance: 31/31 editor tests still green, tsdown
  rebuild green, user-checks-the-live-3080 visual confirmation. Risks R1–R4
  documented in the plan (openView contract, theme seam, focus trap, row
  height budget).
  - [x] **FE-M-D.1** — tree interaction (Severity 1, 4 fixes + row title
    tooltip): import `TOKENS` from `plugin-kit/src/client/chrome.tsx`;
    thread into border/content-pane bg/selection stripe/error banner;
    scoped `<style data-editor-tree-row-styles>` for `.editor-tree-row:hover`
    (non-selected) and `:focus-visible` accent outline; rewrite `Entries`
    with separate `loading` / `error` / `(empty directory)` states (error
    banner above entries, `role=group` on container, `aria-expanded`,
    `aria-selected`, `title` on every row); root label shows workspace
    **title** instead of the raw path. Bundle 8,711,187 bytes; 31/31 editor
    tests PASS; agent-owned 3083 visual confirm (Editor tab → workspace
    dropdown → tree expand → hover/focus style tag in DOM → empty-state
    hint); user's live 3080 Ctrl+F5 = remaining checkpoint.
  - [x] ~~FE-M-D.2 … FE-M-D.8~~ — **MOOT** (front retired 2026-10-12; the native Sidebar
    tree + document preview cover this ground). Listed for history only; no work owed.

## Backlog / parked (out-of-scope ideas; do not expand current tasks into these)

- (record out-of-scope ideas here instead of expanding the requested scope)
- **File-Editor leftovers after the 2026-10-12 retirement** (decide; do not expand):
  `file-editor-config.json` is orphaned (kept — it holds harness-runtime edits);
  `plugin-kit/src/client/{theme-bus.ts,use-theme-snapshot.tsx}` +
  `plugin-kit/tests/theme-bus.spec.ts` are uncommitted WIP that only the retired editor
  consumed — keep as kit material (then commit) or drop.
- **M3 card retired on 0.2.x** `done` (2026-10-12): `web-compact-config` was the suite's one
  failing item — its bridge calls `ctx.settings.register()`, which the redesigned
  `SettingsForms` dropped, and its client half needs the removed `SettingsScope` + the renamed
  `settings.general.item` slot. Now unwired (not in the vitest include, not in
  `cordis.patch.yml`) and the facade/farm/tsconfig entries cleaned; suite **12 files / 90 tests
  green**. Record: docs/incidents/2026-10-12-settings-seam-redesign-retires-m3-card.md.
  **OPEN USER DECISION:** delete the `web-compact-config` directory outright (like
  `web-file-editor`) or keep it as history.

### dsh-autocompact standalone repo (2026-10-12)

The plugin moved to `D:\my_deepseek_harness\dsh-autocompact` (remote `alshahia/dsh-autocompact`,
branch `main`); its own README/TASKS-less docs carry the status. Open items:

- [ ] **Native settings migration — recorded, NOT started (user decision).** Drop the
      bespoke dock tuning form + `POST /dsh-autocompact/config` and let the harness render
      the plugin's volatile `Config` (host `ctx.settings.describe()` → `volatileForm`;
      Settings → Plugins → Configurable). Decide: label/i18n source (`locale/*.json` vs
      schema text), pill = status+link vs quick-edit popover, and `configure({auto:false})`
      if a bespoke page stays. Unverified: generic-form rendering of nested groups + the
      `models` array. Evidence: `dsh-autocompact/docs/incidents/2026-10-12-native-settings-surface-already-serves-us.md`
      + README limitation 7.
- [ ] **Route auth gate.** `GET /dsh-autocompact/status` and `POST /config` answer without
      the GUI session cookie (verified 2026-10-12). Gate them, or delete the write route
      with the migration above. README limitation 8.
- [ ] **`/compact-config` chat command port** — deferred, NEEDS_USER_DECISION.
- [ ] **User checkpoints owed**: one page refresh (floating tuner) and one harness restart
      (tuning writes: `write=false` until then).
