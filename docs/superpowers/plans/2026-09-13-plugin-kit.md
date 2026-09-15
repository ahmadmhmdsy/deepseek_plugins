# Plugin Kit Implementation Plan

> Task-driven plan for the approved spec
> `../specs/2026-09-13-plugin-kit-design.md`. Steps use checkbox syntax.
> Validation commands: the AGENTS §3 table (vitest via the TARGET checkout's bin;
> `--dump-config` from the RUN checkout when wiring changes).

**Goal:** capture the repo's proved plugin patterns in (K1) best-practices docs,
(K2) a copy-and-rename template package, and (K3) a thin plugin-kit source
package — so future plugins import/inherit instead of re-deriving, while custom
work stays free.

**Ground rules (from the spec):** no speculative abstraction; extraction only
with ≥2 proven users or a real imminent consumer; kit modules migrate their
tests; both-checkout green; docs chain updated per landed task.

---

## Established facts (verified in this repo — the implementer need not re-derive)

1. Toolchain: junction farm + `scripts/.dsh-target.txt` driven tsconfig/vitest
   facades exist and are proven (Tasks 1..., commits `85871b9`, `c3b9f75`).
2. Host-plugin anatomy is proven twice: `compaction-handoff` (engine) and
   `compact-config-command` (command), plus the `--dump-config` wiring check
   (`811579e`, composition check expectations in AGENTS §3).
3. Client-card anatomy is proven once (M3) and mirrored onto the built-in
   `ui-settings-plugins/PluginCard.tsx` (RUN checkout) — client contract details,
   bundle banner/purity, delivery junction, and the two delivery traps are
   recorded in HANDOFF §8, MEMORY §1/§4, and
   `docs/incidents/2026-09-13-card-mount-border-missing-and-stale-http-cache.md`.
4. The settings-scope controller and card chrome in
   `web-compact-config/src/client/{controller.ts,Card.tsx}` are the extraction
   sources for K3; their tests live in `web-compact-config/tests/`.
5. The workspace suite baseline: **9→11 spec files / 95 tests** green on both
   checkout targets (latest full run 2026-09-13 after the header-toggle change,
   commit `6c52415`).

---

## Tasks

### Task K1-1 — `docs/best-practices/creating-a-source-plugin.md`  `in_progress`

- [ ] Write the guide (§4 of the spec): package.json anatomy, cordis entry
      pattern, store-file + shared-validator pattern, patch wiring,
      verification commands. Evidence pointers only, no rationale duplication.
- [ ] Source-verified claims only (M1/M2 proven behavior).
- Validation: docs-only task; readability pass + link check by reading.
- Commit: `docs(kit): source-plugin best-practices guide`.

### Task K1-2 — `docs/best-practices/creating-a-client-card-plugin.md`

- [ ] Write the guide (§4): client package contract, host bridge vs card,
      settings namespace, tsdown bundle contract, purity gate, delivery
      junction + cache-staleness rule, patch-row name rule, card chrome rules
      (incl. header-control sibling rule from 6c52415).
- Validation: read-back; every section carries its source pointer.
- Commit: `docs(kit): client-card best-practices guide`.

### Task K1-3 — `docs/best-practices/plugin-checklist.md`

- [ ] Write the claim-done checklist (§4): tsc / vitest(target bin) /
      `--dump-config` / junction / docs / commit / incident-recording rules.
- Commit: `docs(kit): claim-done checklist`.

### Task K2 — `_template-plugin/` copy-and-rename skeleton

- [ ] Create the five files listed in spec §5, content adapted from
      `compact-config-command` (renamed to TODO-PLUGIN, injected with
      `TODO-PLUGIN` markers and a rename checklist README).
- [ ] Template tests green in the workspace suite (no loader references).
- Validation: vitest run (target bin) — suite count grows, all green.
- Commit: `feat(kit): copy-and-rename plugin template`.
- Note: template package.json `main` points at `src/index.ts` like its siblings;
  tests import by relative path only.

### Task K3-1 — Extract `plugin-kit/src/client/chrome.tsx` (only on a real consumer)

Precondition: a new card plugin starts, or the user explicitly orders the
extraction early. Otherwise stays queued (backlog).

- [ ] Create `plugin-kit/` package (package.json + tsconfig facade entries /
      junction+alias list extension per MEMORY §1 procedure).
- [ ] Move shell/header/pills/banners/Chevron/Switch/tokens from
      `web-compact-config/src/client/Card.tsx` into `chrome.tsx` with a props
      surface (title, description, derivePill(state), headControls slot).
- [ ] Card.tsx consumes chrome by relative import; behavior unchanged.
- [ ] Move/adapt the relevant tests; suite green on RUN **and** DEV.
- Commit: `refactor(kit): extract card chrome`.

### Task K3-2 — Extract `plugin-kit/src/client/settings-form.ts` (same gating)

- [ ] Extract the controller's generic machinery (staged drafts, pendingClear,
      save plan, projection lifecycle) behind a declarative FormSpec
      (sections, field parsers, boolean keys, rows key override).
- [ ] M3 card controller becomes a thin subclass specifying the handoff
      vocabulary; its tests unchanged in observable assertions.
- Validation: full suite both targets; card behavior identical in the
      controller.spec expectations.
- Commit: `refactor(kit): extract settings-form controller`.

### Task K3-3 — Extract host helpers (`hot-reload-store`, `command-mutations`)

- [ ] Extract the store watch/validate/adopt loop (M1 store.ts) and the command
      mutation path (M2 index.ts) behind small parameterized surfaces.
- [ ] `compaction-handoff` / `compact-config-command` import from the kit;
      unit tests migrate; suite green both targets; `--dump-config` still
      exit 0 with all rows present.
- Commit: `refactor(kit): host store/mutation helpers`.

### Task KitDocs — AGENTS map + README updates (with each landed task)

- [ ] Add the new docs and packages to AGENTS §1/§2 map and the README link web.
- [ ] Record HANDOFF entries + TASKS rows per task.

---

## Execution notes

- This plan deviates from the M1-M3 plan's style (no exact-code blocks): the kit
  work is extraction-with-tests, and the authoritative behavior is defined by
  the existing passing tests, not new code. Where a step's observable outcome is
  ambiguous, the spec's acceptance list (`§8`) wins.
- If a future card plugin needs a shipped K3 before it starts, K3 tasks unlock
  by the user's explicit call recorded in TASKS (they are user-gated by this
  plan).
