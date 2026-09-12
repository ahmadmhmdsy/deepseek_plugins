# TASKS — live task status

TASKS.md owns the **live status**; [HANDOFF.md](./HANDOFF.md) owns the narrative
and evidence; the plan (`docs/superpowers/plans/2026-09-10-auto-compact-handoff.md`)
owns the approved task definitions.

**Last updated:** 2026-09-10 · **Active front:** M3 (Tasks 13-14) · resume at **Task 13** (patch entry → composition check → NEEDS_USER_DECISION junction).
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
- **Task 14 — acceptance walkthrough + docs** `pending` — plan lines 2615-2634:
  walk the 9 acceptance criteria (spec §12) with evidence; write README
  (install via patch, config file reference, command reference); typecheck the
  other two packages; check plan checkboxes only for what actually passed;
  final report with PASS/FAIL/SKIPPED.

## User checkpoints owed (surface in reports; never perform alone)

- [x] Plan 8.4 — boot a session with `cordis.patch.yml`; the handoff engine mounts
      with no load error — evidenced 2026-09-12 in the 3082 boot's Plugin list
      (`compaction-handoff` Mounted/Enabled, `compaction-basic` Disabled).
- [ ] Plan 10.2 — run `/compact-config show` and `/compact-config test` in a
      real session.
- [x] Task 13 — settings card visible and functional in the web GUI (visible and
      rendered 2026-09-12 via agent-browser; save→file / external-edit / invalid-input
      sub-checks still await the user's hands-on sign-off).

## Backlog / parked (out-of-scope ideas; do not expand current tasks into these)

- (empty — record out-of-scope ideas here instead of expanding the requested scope)
