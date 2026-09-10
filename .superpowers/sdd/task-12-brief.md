## Task 12: M3 client card

**Files:** `web-compact-config/src/client/{index.ts,controller.ts,Card.tsx,store.ts}`, `tsdown.config.ts`, manifest.

- [ ] **Step 12.1: Pin the renderer hooks contract.** Read `E:/js_projects/my_deepseek_harness/deepseek-harness/packages/client/ui-renderer/src/client` to confirm how a face's `hooks` entries become component props (expected: a `{ getSnapshot, subscribe }` snapshot store bound as a `use<Key>` hook, per the fork's card usage `props.useBashCard(snapshot => snapshot)`). Adjust `store.ts` to the confirmed interface; the code below implements the contract observed in the fork's `card-form.ts`:

```ts
// web-compact-config/src/client/store.ts
/** Minimal SnapshotStore-compatible store (same contract as dsh-client-store's). */
export interface SnapshotStoreLike<S> {
  getSnapshot(): S
  subscribe(listener: () => void): () => void
  set(next: S): void
}
export function createSnapshotStoreLike<S>(initial: S): SnapshotStoreLike<S> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      if (Object.is(snapshot, next)) return
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}
```

- [ ] **Step 12.2: Controller** (`client/controller.ts`). Staged form over `ctx.settingsScope.bind({ namespace: 'compact-handoff' })`; follow the staging/plan/save algorithm of fork `packages/client/ui-settings-plugins/src/client/card-form.ts` (summarized in §0.2), adapted to nested fields:
  - Field specs: `trigger.mode` (select), `trigger.ratio`, `trigger.tokens`, `retain.ratio`, `retain.tokens`, `archive.root`, `archive.gitExclude` (bool), `archive.onFailure` (select), `summarization.provider`, `summarization.model`, `summarization.maxTokens`, `auto` (bool).
  - Models table state: `rows: Array<{ provider, model, tokens, ratio, mode, retainKind, retainValue, disabled, invalid }>` with `addRow() / removeRow(i) / editRow(i, field, text)`; save maps rows to `models[]` entries (drop empty rows).
  - Save builds the nested patch and calls `scope.update(patch)`; staged drafts re-seed from the committed snapshot; `failed` keeps drafts on failure (card-form semantics).
  - Publishes through `createSnapshotStoreLike` (a `bind(project)` mirror of `CardForm.bind`).
  - Face: `{ hooks: { card: store }, edit, resetField, save, discard, editRow, addRow, removeRow }`.
  - Vitest test with a fake scope (`getSnapshot/subscribe/set/unset/update`): stage edits → save → assert `update` received the expected nested patch; an invalid numeric draft → save blocked (`invalid` true, no update call).

- [ ] **Step 12.2b: Live-preview scope (spec §8 deviation to record).** The browser cannot resolve a model's context window without a remote call, so the card's live preview shows the **pure-tokens** effective threshold computed from staged values (plus a note that ratio-based previews come from `/compact-config test`). This is a scoped-down version of the spec's live-preview bullet; the user may veto at execution.
- [ ] **Step 12.3: Card component** (`client/Card.tsx`, React JSX): renders the spec §8 fields — mode select, ratio/tokens inputs, retain pair (the non-empty one wins), archive root, gitExclude checkbox, onFailure select, summarization provider/model/maxTokens, auto checkbox, models table (per-row inputs + add/remove + disabled checkbox), Save/Discard, inline invalid error, disabled while `!writable`. Plain English labels (i18n deferred). Inline styles only (no CSS pipeline).

- [ ] **Step 12.4: Registration** (`client/index.ts`):

```ts
// web-compact-config/src/client/index.ts
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: slot contract + settingsScope merge. Value imports stay bundled-local.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { CompactConfigCardController } from './controller.ts'
import { CompactConfigCard } from './Card.tsx'

export const inject = ['slots', 'connection', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const controller = new CompactConfigCardController(ctx.settingsScope.bind({ namespace: 'compact-handoff' }))
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'compact-handoff',
    inject: () => controller.inject(),
  }, CompactConfigCard))
}
```

- [ ] **Step 12.5: Manifest + build config.**

```jsonc
// web-compact-config/package.json (full)
{
  "name": "web-compact-config",
  "description": "Web settings card for handoff auto-compact configuration",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./src/*": "./src/*",
    "./client": "./lib/client.js"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-settings-plugins"],
      "external": ["react", "react/jsx-runtime"]
    }
  }
}
```

```ts
// web-compact-config/tsdown.config.ts
// Reproduction of the fork preset's client face (packages/client/tsdown.client.ts
// clientConfig), reduced to this package: CJS factory artifact with the loader
// banner, module-table externals (react), everything else inlined.
import { defineConfig } from 'tsdown'

const ID = 'web-compact-config'

export default defineConfig({
  name: ID + '/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: (specifier: string) => specifier === 'react' || specifier === 'react/jsx-runtime',
    alwaysBundle: (specifier: string) => specifier !== 'react' && specifier !== 'react/jsx-runtime',
  },
  inputOptions: {
    resolve: { conditionNames: ['production', 'browser', 'import', 'module', 'default'] },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(ID) + ', factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
```

- [ ] **Step 12.6: Build + verify the artifact.**

Run: `E:/js_projects/my_deepseek_harness/deepseek-harness/node_modules/.bin/tsdown.CMD --config web-compact-config/tsdown.config.ts` (cwd `deepseek_plugins`).
Expected: `web-compact-config/lib/client.js` exists; its first line is the `window.__ModuleLoader__.load({...factory: (require) => {` banner. If the purity/external contract rejects something, align the external list with `packages/client/web/src/platform.ts` (read it at implementation time).

- [ ] **Step 12.7: Commit** (if git): `feat(web-compact-config): client card with staged form and loader artifact`.

---


