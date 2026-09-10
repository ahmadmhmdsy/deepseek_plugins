# TASKS — live task status

TASKS.md owns the **live status**; [HANDOFF.md](./HANDOFF.md) owns the narrative
and evidence; the plan (`docs/superpowers/plans/2026-09-10-auto-compact-handoff.md`)
owns the approved task definitions.

**Last updated:** 2026-09-10 · **Active front:** M3 (Tasks 11-14) · resume at **Task 12** (Task 11 done).
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
| Plan Task 11 — M3 host bridge (web-compact-config) | `c299596` | 71/71 (10 files) on RUN; 12 bridge tests incl. 6 service-level integration tests over the real FileSettingsProvider |
| Doc tuning: CLAUDE.md/AGENTS.md rewritten for this project; TASKS/MEMORY/ENVIRONMENT created | this change set | 2026-09-10 |

## Next (queued — approved plan Tasks 11-14)

- **Task 12 — M3 client card** `pending` — plan lines 2457-2599: client bundle
  (tsdown CJS, `window.__ModuleLoader__` banner contract). **Preconditions
  VERIFIED on RUN 2026-09-10:** `ctx.settingsScope` exists (dsh-client-ui-settings
  `SettingsScopeBinder.bind({namespace})` → scope `getSnapshot/subscribe/set/unset`
  — per-field path ops ONLY, so the card stages whole sections); the card pattern
  is `packages/client/ui-settings-plugins/src/client` (`card-form.ts` staging,
  BashCard controller, keyed `settings.plugin.item` registration via
  `ctx.slots.inject`, inject face `hooks.card` → `useCard` props); bundle contract =
  `packages/client/tsdown.client.ts` clientConfig + `PLATFORM_MODULES` externals +
  purity gate (type-only @deepseek-ai imports only; value imports = build error).
  Needs: junction `dsh-client-runtime` (add to link script WANTED + relink) and
  root tsconfig paths for it. Client-card save maps to `scope.set(section, value)` /
  `scope.unset(section)` — NOT the plan's `scope.update(patch)` (no such client API).
- **Task 12 — M3 client card** `pending` — plan lines 2457-2599: client bundle
  (tsdown CJS, `window.__ModuleLoader__` banner contract). **CAUTION (verified
  2026-09-10):** `dsh-client-store` and `dsh-client-ui-renderer` are ABSENT on
  RUN, present on fork. Follow the RUN tree
  (`packages/client/ui-settings-plugins/src/client`); card types from
  `@deepseek-ai/dsh-client-ui-slots` (type-only); React 18 JSX. If a needed
  client package is missing on RUN → **NEEDS_USER_DECISION** (fork-only card?).
- **Task 13 — M3 wiring + GUI verification** `pending` — plan lines 2599-2615:
  extend `cordis.patch.yml`, tsdown build, GUI check. GUI verification is
  **user-gated** (needs a running web harness; do NOT boot one from a session).
  NEW (HANDOFF §5.15): the card only ships if the package is resolvable by name
  from the profile — needs a junction `$DSH_HOME/profiles/node_modules/web-compact-config`
  → this workspace (writes OUTSIDE the repo ⇒ **NEEDS_USER_DECISION**), and
  `lib/client.js` must exist BEFORE the first patched boot (missing bundle =
  loud boot failure).
- **Task 14 — acceptance walkthrough + docs** `pending` — plan lines 2615-2634:
  walk the 9 acceptance criteria (spec §12) with evidence; write README
  (install via patch, config file reference, command reference); check plan
  checkboxes only for what actually passed; final report with PASS/FAIL/SKIPPED.

## User checkpoints owed (surface in reports; never perform alone)

- [ ] Plan 8.4 — boot a session with `cordis.patch.yml`; confirm the handoff
      engine mounts with no load error.
- [ ] Plan 10.2 — run `/compact-config show` and `/compact-config test` in a
      real session.
- [ ] Task 13 — settings card visible and functional in the web GUI.

## Backlog / parked (out-of-scope ideas; do not expand current tasks into these)

- (empty — record out-of-scope ideas here instead of expanding the requested scope)
