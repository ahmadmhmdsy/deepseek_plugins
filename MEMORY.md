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
  older notes about util-values are stale).
- `dsh-client-store` and `dsh-client-ui-renderer` exist only on the fork
  (verified 2026-09-10); the link script treats them as optional.

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
