# Best practices — creating a source (host-side) plugin

Source-of-truth pointers live in the references column, not here. If this guide
and a referenced document disagree, the referenced document wins; report the
drift instead of quietly editing either side (AGENTS.md §1, §7).

| Claim | Source of truth |
|---|---|
| Package anatomy, relative imports, no root package.json | AGENTS.md §2, §4, §6 |
| Junction farm mechanics | MEMORY.md §1, ENVIRONMENT.md |
| M1 proven behavior (engine/store/trigger/archive) | compaction-handoff/src, its tests, HANDOFF.md M1 entries |
| M2 proven behavior (chat command) | compact-config-command/src, its tests, HANDOFF.md M2 entries |
| Patch-file URL scheme rule | docs/incidents/ (ERR_UNSUPPORTED_ESM_URL_SCHEME record); header comment in cordis.patch.yml |

## 1. Package anatomy (proven: compaction-handoff, compact-config-command)

A host-side plugin is a minimal package that stays a **TS source** — no build
step:

```json
{
  "name": "<plugin-id>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./src/*": "./src/*" }
}
```

Rules:

- `main`/"exports" point at `src/*.ts`. A client-card package is the only
  exception (see creating-a-client-card-plugin.md).
- Sibling plugins import each other **by relative path**
  (`../../compaction-handoff/src/store.ts`), never through junctions
  (AGENTS.md §6).
- `@deepseek-ai/*` value imports go through the alias facade only. If your
  plugin needs a `@deepseek-ai/*` package not yet in the facade, extend the
  junction farm + `vitest.config.ts` aliases per MEMORY.md §1 — do not import
  by absolute checkout path.
- No root package.json/lockfile exists in the workspace and none may be
  created; dependencies resolve through `node_modules` junctions into the
  target DSH checkout. Re-point with `node scripts/link-node-modules.mjs`
  only (AGENTS.md §3).
- Every entry file carries a JSDoc `@module <name>` header (AGENTS.md §6).
- Keep logic in focused modules (`config.ts` (validator), `store.ts` (single
  store file), `types.ts` (schemas), `index.ts` (entry)) — the M1/M2 layout
  is the pattern; see their sources for the file split.

## 2. Cordis entry pattern (proven: both M1 & M2)

The entry module exports exactly:

- `export const name = '<plugin-id>'` — the loader entry id.
- `export const Config: z<…> = z.object({…})` — composition options schema
  (schemastery). Optional; omit when the plugin takes no options.
- `export const inject = ['<service>', …]` and
  `export function apply(ctx, options): void`.

Use `ctx.effect(fn, cb)` / `ctx.inject([...], (svc) => {…})` so cleanup rides
the context lifecycle; never manage resources outside `ctx`. M1 does this for
the token-meter subscription and the store watcher; M2 for the command — read
their `index.ts` as the working examples.

## 3. Config: one store file + one shared validator

The suite's pattern (proven by M1 and reused by the M3 bridge):

- A single JSON store file is the only mutable state. It is **user-editable**
  (market line in HANDOFF.md) — treat user edits as a supported input path.
- All reads go through `readConfigRaw`/the store module; all mutations go
  through `parseHandoffConfig` (shared validator in `config.ts`) +
  `atomicWriteJson`. Never ad-hoc-validate or direct-write the store.
- Cross-field rules the schema cannot express belong in the validator, not in
  the schema mirror (see web-compact-config/src/index.ts comment lines 38-43).

If your new plugin manages its own config, re-create this split rather than
inventing a second validation path; see Task K3-3 (kit extraction planned) —
until it lands, copy from `compaction-handoff` and keep consumption-gating in
mind (spec 2026-09-13 §2: prove ≥2 users before abstracting).

## 4. Wiring: cordis.patch.yml

The workspace composition overlay (`cordis.patch.yml` at the repo root) is
how a plugin gets mounted:

```yaml
- insert:
    - id: '<plugin-id>'
      name: 'file:///D:/my_deepseek_harness/deepseek_plugins/<pkg>/src/index.ts'
      config:
        configFile: 'D:/my_deepseek_harness/deepseek_plugins/<your-config>.json'
```

Hard rules (both proven by incidents — see the header comment in
cordis.patch.yml):

1. **Windows absolute paths MUST be `file://` URLs.** The loader's
   `tree.import()` does a raw `import(name)`; `import('D:/…')` fails with
   `ERR_UNSUPPORTED_ESM_URL_SCHEME`.
2. A mounted plugin may instead be referenced **by package name**
   (`name: <pkg-name>`) — this is how `web-compact-config` is mounted, and it
   is REQUIRED for a client-card package (patch-row `name` = package name;
   a file URL there silently suppresses the client bundle). Source-only
   plugins may use either form.
3. To replace a base-suite plugin, list `- id: <base-id>` with
   `disabled: true` before the `insert` block.
4. Configuration passed via the patch row `config` lands as the export-loaded
   `Config` schema values described in §2.

## 5. Verification loop (see also plugin-checklist.md)

1. `& '<target-checkout>\node_modules\.bin\vitest.CMD' run` from the workspace
   root — unit tests through the target checkout's bin (target is recorded in
   scripts/.dsh-target.txt).
2. `node --import tsx/esm apps/cli/src/bin.ts --profile web --patch
   'D:/…/deepseek_plugins/cordis.patch.yml' --dump-config` **with workdir =
   the target checkout** — wiring check without booting. Expect exit 0 and
   your plugin's row in the dump.
3. Never boot a long-lived harness server yourself; GUI/live verification is a
   user checkpoint (AGENTS.md §3, §4.2).

## 6. Before you claim done

That is a separate checklist — read plugin-checklist.md. This guide ends
before "done" and does not restate it.
