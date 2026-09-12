# AGENTS.md — agent guide & document map

**Standing rule — document every issue and its fix.** Whenever debugging, testing,
or live verification surfaces a real issue (bug, misdiagnosis, silent failure,
deferral behavior), record BOTH the issue and its fix/effects durably before
closing the work: root cause (what was actually wrong), the fix or verdict (with
commit hash), the evidence (timestamps/files/commands), and any honest caveats.
Write cross-referenced entries — token-config knowledge in MEMORY, narrative in
HANDOFF, and a self-contained reusable record under
`docs/incidents/<date>-<topic>.md` — so a future agent can reuse the diagnosis
without re-deriving it. Raw test rigs go under a gitignored dir (e.g.
`.live-test/`, `.dsh-test/`); the docs keep the conclusions.

Any agent working in this repo continues one project: build the **auto-compact
handoff plugin suite for DeepSeek Harness (DSH)** — configurable auto-compact
triggers (percentage and/or absolute tokens, per-model presets), a model-written
structured handoff archived on **every** compaction, an archive pointer, a
`/compact-config` chat command, and (planned) a web settings card. Strict
TypeScript ESM on Windows; plugins load as TS sources; tests run through the
target DSH checkout's vitest.

[CLAUDE.md](./CLAUDE.md) is the **operating system** — read it first. This
file is the **repo supplement**: it maps every durable document to its job
and fixes the repo-specific conventions CLAUDE.md points here for.

## 1) Document map — one authoritative home per concern

| Concern | File | Read it when | Update it when |
|---|---|---|---|
| Operating rules | [CLAUDE.md](./CLAUDE.md) | every session | only for deliberate OS changes (rare) |
| **Spec** (approved design) | `docs/superpowers/specs/2026-09-10-auto-compact-handoff-design.md` | before any feature work | only with user approval |
| **Plan** (Tasks 1-14, exact code) | `docs/superpowers/plans/2026-09-10-auto-compact-handoff.md` | before implementing a task | only with user approval; deviations go to HANDOFF §5 |
| **State** (where we are) | [HANDOFF.md](./HANDOFF.md) | at session start | as milestones/incidents land — snapshot style, newest entries win |
| **Tasks** (what's next) | [TASKS.md](./TASKS.md) | at session start | whenever a task starts/finishes/gets gated |
| **Memory** (lessons & decisions) | [MEMORY.md](./MEMORY.md) | before touching anything non-obvious | every hard-won gotcha or user decision, immediately |
| **Environment** (what we run on) | [ENVIRONMENT.md](./ENVIRONMENT.md) | before running anything | after any tool/version/checkout change |
| Usage (humans) | `README.md` — **does not exist yet**; created in Task 14 | after Task 14 | when commands or usage change |
| **Incidents** (issue + fix records) | `docs/incidents/<date>-<topic>.md` | when a recorded issue recurs or is referenced | per the standing rule above: every real issue gets its issue+fix record |

The five an agent needs before doing anything: spec+plan (what to build),
HANDOFF (where we are), TASKS (what's next), MEMORY (what we learned),
ENVIRONMENT (what we run on).

## 2) Repository layout

```
deepseek_plugins/
├─ AGENTS.md · CLAUDE.md · HANDOFF.md · TASKS.md · MEMORY.md · ENVIRONMENT.md
├─ docs/superpowers/
│  ├─ specs/  2026-09-10-auto-compact-handoff-design.md   approved design (spec §1-13, acceptance §12)
│  └─ plans/  2026-09-10-auto-compact-handoff.md          implementation plan, Tasks 1-14 with exact code
├─ compaction-handoff/      M1 engine (DONE): src/{index,config,store,trigger,archive,summarize,types}.ts + tests/
├─ compact-config-command/  M2 /compact-config command (DONE): src/{index,parse}.ts + tests/
├─ web-compact-config/      M3 settings card + host bridge (TODO — create in Tasks 11-12)
├─ probe-dsh-resolution/    keep — module-resolution regression probe (cordis.yml + hello.ts + probe.ts)
├─ scripts/
│  ├─ link-node-modules.mjs  junction builder (target-aware; arg > DSH_TARGET env > RUN > sibling fork)
│  └─ .dsh-target.txt        recorded target checkout (gitignored — machine-local)
├─ cordis.patch.yml         M1+M2 composition overlay (--patch); absolute paths into this workspace
├─ handoff-config.json      the single store file (user-editable; validated on load)
├─ tsconfig.json            editor/typecheck facade (paths → DEV fork; types only — vitest uses its own aliases)
├─ vitest.config.ts         target-driven alias facade (from target tsconfig.base.json) + inlined decorator plugin
└─ node_modules/            junction farm → target checkout sources (gitignored; REBUILD ONLY via the link script)
```

Plugin packages are **source-loaded**: each `package.json` points `main`/`exports`
at `src/*.ts` — no build step for M1/M2. The M3 client card is the exception
(tsdown CJS bundle, Task 12). There is no root `package.json` — see §4.

## 3) Commands (copy-paste; workdir = this workspace unless stated)

```powershell
# Re-point the junction farm at a DSH checkout (records it in scripts/.dsh-target.txt)
node scripts/link-node-modules.mjs                                                     # default = RUN checkout
node scripts/link-node-modules.mjs --target 'D:\my_deepseek_harness\deepseek-harness'   # dev fork

# Full test suite — ALWAYS the TARGET checkout's vitest bin (must match .dsh-target.txt)
& 'D:\deepseek_harness\deepseek-harness\node_modules\.bin\vitest.CMD' run        # RUN target (default)
& 'D:\my_deepseek_harness\deepseek-harness\node_modules\.bin\vitest.CMD' run     # dev fork target

# Composition check — no boot; workdir = RUN checkout; verifies cordis.patch.yml wiring
node --import tsx/esm apps/cli/src/bin.ts --profile web --patch 'D:/my_deepseek_harness/deepseek_plugins/cordis.patch.yml' --dump-config
```

- Expected suite (post-M2): **9 spec files / 59 tests**, green on BOTH checkouts
  (verified 2026-09-10). New `@deepseek-ai/*` imports require extending the
  junction+alias lists (see [MEMORY.md](./MEMORY.md) §1).
- Composition check expectations: exit 0; `compaction-handoff` and
  `compact-config-command` entries present; base `compaction-basic` disabled.
- `--profile tui` does not exist on this machine; use `web` or `headless`.
- Never boot long-lived harness servers from an agent session — GUI
  verification is a user checkpoint.

## 4) Environment constraints (hard facts — details in [ENVIRONMENT.md](./ENVIRONMENT.md))

1. **Dual-checkout universal-target directive** (user, 2026-09-10, implemented
   `c3b9f75`): everything must work on the RUN checkout
   (`D:\deepseek_harness\deepseek-harness`, v0.1.0-rc.7 — boots the currently
   RUNNING harness, Web GUI `127.0.0.1:3080`) and the DEV fork
   (`D:\my_deepseek_harness\deepseek-harness`, v0.1.2-alpha.1). Default target = RUN.
2. **Never kill or restart the running harness** — it hosts the current agent
   session. Never start replacement servers. Boot verification is a user checkpoint.
3. **Everything resolves to `src/`** — mixing junctioned `lib/` builds with src
   breaks `instanceof` class identity.
4. Workspace has **no root package.json/lockfile**; `node_modules` is a junction
   farm. Never `pnpm install` here; never delete/hand-edit junctions.
5. Client packages `dsh-client-store` and `dsh-client-ui-renderer` are **absent
   on RUN** (fork-era; verified 2026-09-10) — the link script treats them as
   optional; M3 (web card) needs a per-target story (Task 12).
6. The settings seam (`packages/settings/settings/src`, `settingsNamespace`,
   `ctx.settings.register(ns, schema, {…})`) exists on **both** checkouts
   (verified 2026-09-10) — M3 host bridge (Task 11) may proceed on RUN.
7. Cross-checkout API drift is recorded in [MEMORY.md](./MEMORY.md) §2
   (call-id brand, decorators, StreamChunk shape, token-meter nodes).

## 5) Git rules (this workspace is its own repo)

- Remote: `origin https://github.com/ahmadmhmdsy/deepseek_plugins.git`; branch
  `master`. Commit after **every green task** with conventional subjects
  (`feat(handoff): …`, `feat(compact-config): …`, `docs: …`, `chore: …`).
- Gitignored: `node_modules/`, `lib/`, `dist/`, `*.tsbuildinfo`, `.superpowers/`,
  `.vite/`, `*.log`, `scripts/.dsh-target.txt` (machine-local).
- No LFS, nothing large tracked — keep it that way. Never force-push or rewrite
  history; never change remotes without authorization.
- Only processes this agent started may be stopped; the running harness is
  never collateral.

## 6) Conventions

- Validation labels PASS / FAIL / SKIPPED / BLOCKED / NEEDS_USER_DECISION;
  honest reporting over optimistic claims (CLAUDE.md §10, §16).
- Task statuses `pending` / `in_progress` / `blocked` / `done` in
  [TASKS.md](./TASKS.md); user-gated items say so explicitly.
- **Deviations ledger**: [HANDOFF.md](./HANDOFF.md) §5 records resolved
  contradictions between plan and spec — they are RESOLVED decisions; do not
  "fix" them back. New deviations extend that ledger, then echo in
  [MEMORY.md](./MEMORY.md) if durable.
- Style: strict TS ESM; JSDoc `@module` header on every entry file; sibling
  plugins import each other by **relative path** (`../../compaction-handoff/src/store.ts`),
  never through junctions; `@deepseek-ai/*` imports only through the alias
  facade; config mutations always through the shared validator
  (`parseHandoffConfig`) + `atomicWriteJson`.
- Keep dates machine-verifiable (git log, test output) rather than vague.

## 7) Keeping the map honest

- New durable knowledge → [MEMORY.md](./MEMORY.md). New work → [TASKS.md](./TASKS.md).
  State changes → [HANDOFF.md](./HANDOFF.md). A new *kind* of document must be
  added to the map in §1 — the map is the index; a doc outside the map does not
  exist for the next agent.
- HANDOFF.md and TASKS.md may describe the same next step: TASKS.md owns the
  live status, HANDOFF owns the narrative and evidence.
- The spec and plan are **user-approved** documents: implement them; record
  deviations; never silently rewrite them.
