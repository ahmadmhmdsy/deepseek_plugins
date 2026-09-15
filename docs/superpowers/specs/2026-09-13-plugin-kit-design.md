# Design: Plugin Kit — best practices, template, and shared modules for future plugins

- **Date:** 2026-09-13
- **Status:** Approved — user requested the spec/plan be written after approving the
  direction in discussion (2026-09-13: "create spec/plan/task first"). Implementation
  plan at `docs/superpowers/plans/2026-09-13-plugin-kit.md`.
- **Workspace:** `D:\my_deepseek_harness\deepseek_plugins\`
- **Targets:** both recorded DSH checkouts (RUN `D:\deepseek_harness\deepseek-harness`,
  DEV `D:\my_deepseek_harness\deepseek-harness`) — universal-target directive applies.
- **Origin:** user request after the third plugin (M3 card) landed: capture what was
  learned so a future plugin "does not create the wheel again"; shared code may be
  imported / inherited with customization points, and per-plugin custom work stays
  possible.

---

## 1. Problem & goals

Every future plugin in this workspace re-pays the same learning tax:

1. **Package anatomy** — `package.json` pointing `main`/`exports` at TS sources (no
   build step for host plugins), the `dsh.client` inject/externals contract for card
   plugins, the `./client → lib/client.js` split, the mandatory `./package.json`
   export (discovered the hard way — the delivery junction could not resolve,
   commit `48ed9eb`).
2. **Toolchain stance** — junction farm via `scripts/link-node-modules.mjs`, tsconfig
   facade, target-driven vitest aliases, "everything resolves to `src/`".
3. **Host-bridge pattern** — settings namespace registration, snapshot/writable
   semantics, hot-reload adoption of external edits (keep the last good config on
   an invalid one).
4. **Card scaffolding** — disclosure header mirroring the built-ins, staged-fields-
   over-user-layer controller, Save/Discard/invalid/read-only banners, status
   pills, bundle purity gate (react + own files only), header controls as siblings
   of the disclosure button (never nested — HTML validity + accessibility).
5. **Delivery traps** — `?rev=<boot-hash>` HTTP-cache staleness; a patch row whose
   `name` is a file URL loads the host half but silently suppresses the client
   bundle (MEMORY §1, 2026-09-12); decorator quirks; cross-checkout API drift.

Goals:

- **G1** — durable, human-readable best-practices docs that a fresh agent (or human)
  reads before creating any new plugin.
- **G2** — a copy-and-rename template package that is a complete, tested, minimal
  example of a plugin.
- **G3** — a thin shared source package (`plugin-kit`) providing the
  proved-in-repo patterns as importable/inheritable modules with customization
  points, so similar behavior is written once and customized per plugin.

## 2. Non-goals (hard lines)

- **No runtime re-architecture.** The kit is a workspace-internal import facade plus
  docs; no new external dependency, no build step added to host plugins, no change
  to how cordis loads the M1/M2 plugins.
- **No speculative abstraction.** A module is extracted into the kit only when the
  pattern has ≥2 proven users in this repo's own history (rule of three, relaxed
  to two). Two anchor extractions are explicitly approved below (§6): the
  settings-form controller and the card chrome.
- **No wrapping of drifted seams.** The kit sits above the `@deepseek-ai/*`
  facades and must not wrap APIs recorded as drifted in MEMORY §2 (call-id brand,
  decorators, StreamChunk shape, token-meter nodes).
- **No framework-ing of the settings card.** Generalizing the field vocabulary
  (`trigger.mode`, `retain.kind`, ...) beyond a parameterized controller and
  chrome is out of scope; table/grid card variants are not built until a real
  plugin needs them.
- The kit is itself a **deliverable with tests** — extraction moves the tests
  along; the workspace suite must not shrink.

## 3. Scope & phasing (three layers)

| Phase | Deliverable | Risk | Value |
|---|---|---|---|
| **K1 — Best-practices docs** | `docs/best-practices/`: source-plugin guide, client-card guide, claim-done checklist | zero (pure docs) | highest; captures fresh knowledge now |
| **K2 — Template package** | `_template-plugin/` — copy-ready skeleton of the simplest complete plugin (based on `compact-config-command`) | low | mechanical correctness for plugin #4 |
| **K3 — plugin-kit package** | `plugin-kit/` source package with host-loop + client-chrome + settings-form modules, extracted incrementally | medium (only with a real consumer) | kills going-forward duplication |

Each phase is valid in isolation, landed green, and committed separately. K3
extraction tasks run against the next real plugin that needs them — if no such
plugin starts, K3 tasks remain queued in the backlog and are not executed
speculatively.

## 4. Layer K1 — `docs/best-practices/` contents

- **`creating-a-source-plugin.md`** — host-side plugin anatomy: package.json shape
  (`main`/`exports` → src), cordis inject + `ctx.effect` entry pattern,
  plugin-config schemas and one validated store file, composition overlay
  (`cordis.patch.yml`) wiring, `--dump-config` verification. Facts sourced from
  M1/M2 (already done); the doc must not present anything as verified that is not.
- **`creating-a-client-card-plugin.md`** — the M3 anatomy: package-JSON client
  contract (`dsh.client.inject`, `./client → lib/client.js`, `./package.json`
  export), host bridge vs client card split, settings-namespace binding,
  tsdown bundle + banner contract, bundle purity gate, delivery junction,
  the patch-row `name` = package name rule, cache-staleness delivery rule,
  card chrome rules (disclosure head; header controls as siblings of the button).
- **`plugin-checklist.md`** — before-you-claim-done: package `tsc`, vitest via the
  target checkout's bin, `--dump-config` for wiring, junction reachability for
  card plugins, docs update per the AGENTS §1 map, commit style, and the standing
  issue-record rule (`docs/incidents/`).

Each doc carries a source-of-truth pointer (HANDOFF §, MEMORY §, incident file)
instead of duplicating rationale, so edits keep one authoritative home.

## 5. Layer K2 — `_template-plugin/` skeleton

A complete, vitest-green minimal command plugin (the smallest useful shape,
based on `compact-config-command`), with TODO-PLUGIN rename markers:

~~~text
_template-plugin/
├─ package.json          name: TODO-PLUGIN; inject list marked
├─ tsconfig.json         extends the workspace facade
├─ src/index.ts          plugin entry (name, inject, ctx.effect) — documented skeleton
├─ src/parse.ts          input parsing / validation example
├─ tests/parse.spec.ts   unit test example
└─ README.md             "how to copy this": rename checklist + kit pointers
~~~

Copy protocol documented in its README: (1) copy the directory, (2) rename
package and ids, (3) wire into `cordis.patch.yml`, (4) run the checklist. The
template path is never exercised in composition (leading underscore = not a real
plugin); its tests still run like any other package.

## 6. Layer K3 — `plugin-kit/` shared modules

A workspace-internal kit package whose modules are imported by relative path
(the same convention sibling plugins use to share `store.ts` today). Two reuse
kinds, exactly as the user framed it: **import** for helpers and components,
**inherit** for base classes a plugin extends.

~~~text
plugin-kit/
├─ package.json                       name: plugin-kit; exports ./src/* (TS source)
├─ src/index.ts                       barrel with JSDoc module header
├─ src/client/chrome.tsx              card chrome from web-compact-config/src/client/Card.tsx:
│                                     card shell, disclosure header (aria-expanded), status
│                                     pills, banner styles, Chevron, Switch, design tokens
│                                     — customization via props (title/description, pill
│                                     derivation fn, head controls slot)
├─ src/client/settings-form.ts        the staged-draft / pendingClear / deep-equal save-plan
│                                     controller extracted from the M3 card — customization
│                                     via a declarative FormSpec (sections, field parsers,
│                                     boolean keys like auto/enabled, optional rows key)
├─ src/host/hot-reload-store.ts       the watch/validate/adopt-or-keep-last-good loop over
│                                     a JSON store — customization via validator + path
├─ src/host/command-mutations.ts      the /compact-config set/preset mutation path over a
│                                     shared validator
└─ README.md                          usage + the kit covenant (§6.1)
~~~

- **sources:** the controller (sections, drafts, save plan, projection) extracted
  from `web-compact-config/src/client/controller.ts`; imports `@deepseek-ai/*`
  types only where already proven in the client bundle contract.

### 6.1 Kit covenant

- Tests migrate with the code: every extracted module carries its tests across;
  the original package imports from the kit.
- Source provenance: each module's JSDoc header names the origin package and the
  commit that extracted it.
- Drift rules (MEMORY §2) apply: no wrapping of drifted seams; every kit module
  typechecks clean on both checkout targets before commit.
- Extraction never rewrites behavior: a module moves with its tests, the
  original import site switches to the kit, and a task is green only when the
  target plugin's observable behavior is unchanged (diff the suite).
- The kit never reaches into a plugin's internals; plugins reach into the kit.

## 7. Constraints & conventions carried over

- Strict TS ESM; JSDoc `@module` headers; no enum/namespace.
- Everything resolves to `src/` (no `lib/` mixing — the `instanceof` identity rule).
- `@deepseek-ai/*` imports only through the alias facade; new seams appended to the
  junction + alias lists per the MEMORY §1 procedure.
- Config mutations always through the shared validator + `atomicWriteJson`.
- No root package.json; junction rebuild only via `scripts/link-node-modules.mjs`.
- Client bundles: tsdown CJS, `react/jsx-runtime` external, banner contract,
  purity gate (react + own files only).
- Kit code must be green on BOTH checkout targets (universal-target rule).
- Every landed layer updates the AGENTS §1 map, TASKS, and HANDOFF.

## 8. Acceptance criteria

1. `docs/best-practices/` exists with the three documents of §4; every claim links
   to its evidence home (HANDOFF / MEMORY / incident); no unverified assertion is
   stated as verified.
2. `_template-plugin/` exists; its vitest file(s) pass in the workspace suite; its
   README contains the copy protocol; no plugin loader touch-point references it.
3. As K3 is executed: kit modules exist, carry tests migrated from their original
   homes, the original package imports from the kit, the full suite is green on
   both targets, and `--dump-config` still shows the wired planes correct
   (`compaction-basic` disabled; all three suite plugins present).
4. AGENTS §1 map, TASKS, and HANDOFF updated for every landed layer.
5. Nothing outside this spec's scope changed (no silent card redesign, no engine
   behavior change); per the standing ledger, any deviation is recorded in
   HANDOFF §5.

## 9. Open questions (none blocking K1/K2)

- **Plugin #4 shape** — command-style (template fits as-is) vs card-style (triggers
  the K3 extractions). Unknown by design; the kit is ready either way.
- **Kit naming** — `plugin-kit` top-level package chosen (a stable relative-path
  import home for the other packages), not a `shared/` folder.
