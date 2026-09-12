# MEMORY — durable lessons & decisions

Every hard-won gotcha or user decision lands here immediately. One
authoritative home per fact: the full plan-vs-spec **deviations ledger** lives
in [HANDOFF.md](./HANDOFF.md) §5 (keep the detail there); this file holds the
durable, reusable lessons and cross-checkout facts.

**Last updated:** 2026-09-10.

## 1. Toolchain & module resolution

- This workspace has **no root package.json/lockfile by design**. `node_modules`
  is a junction farm into the target DSH checkout, built only by
  `scripts/link-node-modules.mjs`. Never `pnpm install` / `npm install` here;
  never delete or hand-edit junctions — re-run the script. (2026-09-10)
- One target checkout at a time: the link script records it in
  `scripts/.dsh-target.txt`; `vitest.config.ts` reads that record and generates
  its alias facade from the SAME tree — junctions and test aliases always agree.
- Vitest resolution (HANDOFF §5.1): explicit vite aliases generated from the
  target's `tsconfig.base.json` (exact keys + `/src/*` subpath aliases,
  longest-first) + an inlined copy of the checkouts' `standardDecoratorPlugin`.
  Why: `vite-tsconfig-paths` scopes paths to files inside its project dir (this
  workspace sits outside the checkout) and subpath imports were externalized raw
  (Node SyntaxError); esbuild passes stage-3 decorators through untransformed
  (vm SyntaxError).
- **Class identity demands everything resolves to src** — mixing junction
  `lib/` builds with src breaks `instanceof`. If new tests import new
  `@deepseek-ai/*` names, extend the package list in BOTH
  `scripts/link-node-modules.mjs` (`WANTED`) and `vitest.config.ts`
  (`WORKSPACE_PACKAGES`) — keep the lists equal.
- `deepFreeze` comes from `@deepseek-ai/dsh-llm` in BOTH checkouts (verified;
  older notes about util-values are stale). `deepEqualJson` does NOT: it lives in
  `@deepseek-ai/dsh-settings` (RUN dsh-llm never re-exports it).
- Base-facade gaps: the RUN checkout's `tsconfig.base.json` has NO bare key for
  `@deepseek-ai/dsh-settings` / `@deepseek-ai/dsh-settings-file` (only
  `.../types`). vitest.config.ts carries a checkout-relative `FALLBACK_SRC_DIRS`
  map (bare + `/src/*` aliases, merged into the longest-first sort) — extend it
  the same way if another package's bare key is missing, and keep
  WANTED/WORKSPACE_PACKAGES equal when adding packages.
- `dsh-client-store` and `dsh-client-ui-renderer` exist only on the fork
  (verified 2026-09-10); the link script treats them as optional.
- The typecheck facade compiles VENDOR sources into the program: type-only `@deepseek-ai/*`
  imports still resolve real files, so keep root-tsconfig flag parity with the vendor's own
  tsconfig (§5.16 relaxations; cordis compiles with noImplicitAny/noImplicitThis/
  strictFunctionTypes/noUncheckedIndexedAccess/exactOptionalPropertyTypes/noImplicitOverride/
  noUnused* relaxed) and ambient-shim bundler-only imports (`*.module.css` →
  `web-compact-config/src/css-modules.d.ts`). (2026-09-10)
- Out-of-tree client-bundle builds: `node <checkout>\node_modules\tsdown\dist\run.mjs
  -c tsdown.config.ts` (tsdown 0.22.2, `deps.neverBundle/alwaysBundle`); the junction farm
  exposes `tsdown` so the config's own import resolves. `lib/client.js` is gitignored —
  rebuild after checkout, and it must EXIST before the first patched boot. (2026-09-10)
- Out-of-tree CLIENT packages must export `./package.json`: the client module registry resolves
  `name + '/package.json'` anchored at the profile dir — without that export the boot scan fails
  (no boot row, card never loads) even when the junction is in place. Verify a delivery junction
  with `require.resolve('<name>/package.json', { paths: ['<profile dir>'] })`. (2026-09-10)
- A second, separate DSH instance is fine on ANOTHER port with the same command
  shape as the `web` app owns the port flag: the launcher flags (`--profile`,
  `--patch`) must come FIRST — everything after the launcher's first unknown
  token is handed verbatim to the app (which knows only `--host/--port/
  --trusted-host`): `dsh --profile web --patch <patch> --port 3081` works,
  `--port` placed before `--patch` errors with `unknown option '--patch'`.
- **Out-of-tree patch rows must name the PACKAGE, not a file URL** (2026-09-12,
  GUI-verified fix): `ClientModuleRegistry.resolveMeta` keys on the loader
  ENTRY's `name` — a row with `name: 'file:///...index.ts'` mounts the HOST half
  (the Plugin list shows it Mounted/Enabled) but gets a negative client verdict
  (require.resolve on a URL fails), so `/plugins/<pkg>/client.js` is never served
  and the settings card silently never appears. Fix: `name: web-compact-config`
  (the registry resolves the package through the delivery junction and reads its
  own `dsh.client` declaration; the host half loads via the package main → same
  src/index.ts). Symptom check: page never requests `/plugins/<name>/client.js`.

## 2. Cross-checkout API drift (verified by hash + diff, 2026-09-10)

- `dsh-llm` renamed the call-id brand: RUN exports `CallId`, fork exports
  `ToolCallId` (same runtime shape). Handled adaptively in `archive.spec.ts`
  via a namespace probe.
- RUN `dsh-llm` has no stage-3 decorators; fork does (`@Remote`). The inlined
  decorator plugin in `vitest.config.ts` is regex-guarded — a no-op on RUN.
- `dsh-compaction-basic` src is byte-identical across checkouts except
  `region.ts` internal pricing semantics (signatures unchanged).
- `StreamChunk` unions are identical: real stream chunks are
  `text-delta`/`finish`-style; a full-text `{type:'text'}` chunk **crashes
  `BlockAssembler.push` on BOTH checkouts** — fixture adapters must stream.
- token-meter measure nodes are `{ seq, tokens }` on both (fork adds
  `heuristicTokens` internally).

## 3. Testing gotchas

- Writing TS spec files through tooling: escape backticks (`\x60`) or use
  `new RegExp('...')` — heredoc-style writes choke on raw fences/regexes.
- Watch tests depend on `fs.watch` + 150 ms debounce; `vi.waitFor` defaults
  suffice on this machine (verified repeatedly).
- Summarize tests (HANDOFF §5.5): relativization requires overriding
  `config.archive.root` **together with** `cwd`; `onFailure: proceed` returns
  the summary **without** a pointer (spec §6.5 = warn and continue).
- Archive git-exclude assertion must use `/^\.dsh\/handoffs\/$/m` (the exclude
  file is newline-terminated).
- Settings-bridge tests: ALWAYS wait for the boot-normalized file shape
  (`models: []` present) before editing the config file in a test — the boot
  adopt's normalized write can land AFTER a hasty `writeFileSync` and clobber it
  (matchObject on the raw boot file passes too early). Adopt latency observed
  ~200-300ms (150ms debounce + provider chain).
- Schemastery defaults (vendor lib): object schemas default to `{}`, arrays to
  `[]`, absent optional scalars are OMITTED from resolved values, unions of
  string literals are required consts, numbers are strict (`typeof !== 'number'`
  throws — no coercion), and host settings resolution runs WITHOUT autofix.
  Consequence: the resolved handoff config omits `auto` until something writes it.

## 4. Config semantics decisions (RESOLVED — do not "fix" back)

- A preset `trigger` section **replaces** the global trigger wholesale; only
  `mode` is inherited (spec §2 intent; HANDOFF §5.3).
- M2 top-level shorthand — `set tokens|ratio|mode <v>` maps into
  `trigger.*`; the shared validator rejects a top-level key (HANDOFF §5.7).
- Hot-reload engine test needs the 4-turn fixture so the shadowed span
  out-prices the framed checkpoint (~211 tokens); the upstream shrink guard
  rejects tiny spans (HANDOFF §5.6).

## 5. Runtime facts

- `--profile tui` does not exist on this machine; use `web` or `headless`.
- The running web harness (`127.0.0.1:3080`) hosts the agent session — never
  kill it, never start replacement servers; boot verification is a user checkpoint.
- The archive pointer path is workspace-relative only when the archive sits
  under cwd (`pointerPath` in `summarize.ts`); tests cover both branches.
- Plugin packages are **source-loaded TS** (`package.json` main/exports →
  `src/*.ts`); no build step for M1/M2. The M3 client card is the tsdown CJS
  exception (Task 12).
- Machine-local absolute paths belong in `cordis.patch.yml` / config files —
  never in plugin source code.
- The checkouts' TypeScript is **6.0.3**; `baseUrl` is deprecated there — the
  workspace root tsconfig now declares paths WITHOUT baseUrl (values resolve
  relative to the declaring file, prefixed `../deepseek-harness/`).
- The workspace typecheck facade must relax the flags vendor packages compile
  under: `vendor/cordis/tsconfig.json` sets `noImplicitAny/noImplicitThis/
  strictFunctionTypes/noUncheckedIndexedAccess/exactOptionalPropertyTypes/
  noImplicitOverride/noUnusedLocals/noUnusedParameters` to false. A strict-only
  facade drowns tsc in vendor errors (TS7053/TS7023 in cordis src).
- `@types/node` is junctioned from the checkout ROOT (link script NPM_DEPS
  `{ name: '@types/node', from: '' }`) — tsc's `types: ["node"]` needs it inside
  the workspace node_modules.
- Client bundle delivery (M3): `ClientModuleRegistry` (packages/client/modules)
  resolves each loader entry's package by NAME from the profile dir; out-of-tree
  plugins need a junction in `$DSH_HOME/profiles/node_modules` (the healer keeps
  foreign links). Missing `lib/client.js` at boot = MissingClientBundleError =
  loud boot failure — build before booting with the patch entry.
- Decision A shipped (2026-09-12, commit 2764dc0): over-tight retain now CLAMPS to
  threshold-1 (`retainClamped`) instead of throwing, absolute-only contradictions are
  rejected at load, and `enabled:false` is the hot-reloaded master switch (no auto, no
  archive/pointer; overflow recovery still delegates to the parent for safety). Card
  checkbox + `/compact-config set enabled true|false`; test output shows plugin/retain state.
- **Live-verified 2026-09-12 (auto-compact "not working" investigation):** the retain/threshold contradiction POISONS auto-compact silently. `resolveHandoffSpec` throws when `retainTokens >= thresholdTokens` (retain.ratio resolves against the CONTEXT WINDOW, not the threshold); the parent's `agent/pre-step` catch treats it as transient — warn-once per target then `next()` ("step compaction failed ... continuing the turn") — so compaction NEVER fires. Live A/B on 3082 (trigger.tokens=1000): retain {tokens:400} -> 6 archived compactions; retain {ratio:0.16} and retain {tokens:40000} -> ZERO compaction, only a swallowed console warn. Any ABSOLUTE token trigger below ~0.16x contextWindow is dead on arrival. Second fact: the 3080 harness boots WITHOUT --patch (cmdline evidence, PID 9084) — plugins never run there; only patched boots apply the trigger config. Parent agents DO compact (same path as children; subagent children run in-process on the shared root event bus, so their pre-steps reach the engine too; live child verification awaited a reliable spawn). Also: fast turns fire the compact+archive flow repeatedly mid-turn (6 archives in ~15s at a 1000-token trigger) — a flood risk at very small thresholds.
- The card's edit surface on RUN: `ctx.settingsScope.bind({namespace})` exposes
  per-field path ops only (`set(field)`/`unset(field)`) — nested handoff
  sections are written as whole-section objects (`set('trigger', {...})`); the
  host `applyPathOp` accepts object values, and object layers merge recursively.
