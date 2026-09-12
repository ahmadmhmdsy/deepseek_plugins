# Incident record — "auto-compact not working" (2026-09-12)

> Task 14 companion. Full narrative in HANDOFF §8b-§8d; decisions/durable lessons in
> MEMORY §4b/§5. This file is the self-contained issue-and-fix record for later use.

## Issue 1 — trigger set, tokens crossed, zero compaction (silent poison)

**Report (verbatim):** "the auto compact not work, (read the log), on agents and put
trigger to some level and the agent cross that limit and no auto compact. test the
plugin on small token (to not waste money) and see where the issue, use cli /gui/and
sub agent on it."

**Root cause.** `resolveHandoffSpec` throws when `retainTokens >= thresholdTokens`
(`retain.ratio` resolves against the **context window**, not the trigger — so
`trigger {tokens: 1000}` + `retain {ratio: 0.16}` means retain ≈ 26k+ for any
window over 162.5k = guaranteed contradiction). The parent's `agent/pre-step` catch
treats that throw as TRANSIENT: warn-once per target, then `next()` — so
auto-compact never fires and only a swallowed console warn marks it, forever.
Load-time validation cannot catch ratio-retain (window-relative).

**Diagnosis method.** Cheap A/B on an isolated 3082 test instance (own patch + own
store): `trigger {tokens:1000}` + `retain {tokens:400}` → 6 archived compactions in
~15 s; same trigger + `retain {ratio:0.16}` or `retain {tokens:40000}` → ZERO
compactions. Small-token schedule, isolated instance — near-zero cost.

**Fix (Decision A, user-approved; commit `2764dc0`):**
1. `resolveHandoffSpec` CLAMPS over-tight retain to `thresholdTokens - 1` and
   reports `retainClamped: true` (warns once per signature) instead of throwing.
2. `parseHandoffConfig` rejects absolute-only contradictions (`retain.tokens >=
   trigger.tokens`) at load, globally and inside presets.
3. New top-level `enabled` master switch (hot-reloaded); false = no auto-compact,
   no archive/pointer; overflow recovery still delegates to upstream for safety.
   Card checkbox + `/compact-config set enabled ...` + shown in `/compact-config test`.
4. `toBasicConfig` guard: `retainRatio` forwarded only when strictly below the
   paired trigger ratio (protects the parent's invariant).

## Issue 2 — GUI trigger change "not applied" while an agent is in deep dive

**Report (verbatim):** trigger changed in the GUI while the agent ran; compaction
only used the new value after the dive exited or was paused/re-entered.

**Root cause investigation + verdict.** Cheap discriminator on the isolated 3082
instance: trigger 800 → boundary compact 001 at 08:47:22.714Z → trigger edited to
500, applied 08:47:25.384Z → **compact 002 fired 08:47:26.248Z, mid-turn, 0.86 s
after the edit**; raising to 10000 silenced compaction entirely. Verdict: hot
reload applies mid-turn in BOTH directions (restart/turn-boundary requirement
DISPROVED). Honest caveat: 002 measured 1241 tokens (< both triggers) —
single-archive trigger-value causality is not demonstrable; the TIMING is proven.
The original deep-dive report is explained by issue 1's poison (pre-fix installs)
and/or the unrouted-session guard (`routedTarget` undefined → null), plus
estimate drift (spans can measure below the trigger). No engine change needed.

## Issue 3 — "3080 never runs the plugins" misdiagnosis

The 3080 harness (PID 9084) boots with a bare `dsh web` cmdline — no `--patch` —
and was initially recorded as "plugins never load there". WRONG: the **web
profile's own** `cordis.patch.yml` (`$DSH_HOME/profiles/web/cordis.patch.yml`)
compiles into every boot of that profile (`apps/cli/src/profile-boot.ts`: layers
= bundle layers, profile cordis.patch.yml, `--patch` overlays). After that
profile patch was written (11:04:16), the running, never-restarted 3080 produced
33 engine-written compaction archives in our own session (001-033,
11:04:34-11:52:33). Fix: none needed — the suite is live on 3080; profile patch
edits apply on the next boot; `--patch` is only for overlays (e.g. the 3082
test rig pointing the engine at `.dsh-test/handoff-config-test.json`).
Operationally: **never restart the 3080 harness without user approval** — it
hosts live agent sessions (PID check first).

## Verification at close

- vitest **95/95** (11 files), exit 0, RUN target (fresh run 2026-09-12 11:53).
- oxlint: 0 errors / 10 style warnings.
- tsc: `web-compact-config` clean; the other two show only the pre-existing
  fork-target drift ledger (HANDOFF §8c), verified unchanged at HEAD.
- Spec §12 acceptance: 8/9 checked with evidence pointers (§12.5 model-reads
  archive live = user checkpoint).

## Follow-ups

- Plan 10.2: run `/compact-config show` + `/compact-config test` in a real 3080
  session (USER-GATED).
- Task 13 hands-on sub-checks: card Save→file, external edit→card, invalid-input
  block (USER-GATED).
- Flood note: very small absolute triggers compact fast turns repeatedly (6
  archives in ~15 s) — document/monitor if a small trigger is ever shipped.
