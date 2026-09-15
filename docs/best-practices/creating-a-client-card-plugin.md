# Best practices — creating a client (web settings card) plugin

Proven example: `web-compact-config` (M3). Everything below states **proven
behavior only**; every section carries its source pointer. If a referenced
document disagrees with this guide, the reference wins — report the drift, do
not silently edit either side (AGENTS.md §7).

| Claim | Source of truth |
|---|---|
| Client package contract, bundle purity gate | web-compact-config/package.json, tsdown.config.ts |
| Host bridge / settings namespace contract | web-compact-config/src/index.ts (head comment), HANDOFF.md M3 entries |
| Client slot registration | web-compact-config/src/client/index.ts |
| Bundle banner contract | web-compact-config/tsdown.config.ts (documented in its head comment) |
| Header-control sibling rule | Card.tsx head block + commit 6c52415; plugin-kit plan K3-1 |
| Patch-row name rule, delivery, cache staleness | plugin-kit spec §4; MEMORY.md; incident records |

## 1. A card plugin is two plugins in one package

- **Host half** (`src/index.ts`): registers the plugin's settings namespace —

  ```ts
  ctx.inject(['settings'], (sctx) => {
    sctx.settings.register(settingsNamespace(NS), CardSchema, { validate: …, … })
  })
  ```

  The namespace's resolved value mirrors the single store file; the file stays
  the lower layer (no composition `base` layer), so an external key removal
  is visible in the resolved value too (web-compact-config/src/index.ts head
  comment).
- **Client half** (`src/client/index.ts`, bundled): mounts a card into the
  shared `settings.plugin.item` slot, keyed by the namespace it edits —

  ```ts
  export const inject = ['slots', 'connection', 'remote', 'settingsScope']
  export function apply(ctx) {
    const controller = new MyCardController(ctx.settingsScope.bind({ namespace: NS }))
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
      name: 'settings.plugin.item', key: NS, inject: () => controller.inject(),
    }, MyCard))
  }
  ```

  Value imports of `@deepseek-ai/*` are forbidden here (purity gate, §3).
  The slot type declaration merges come in as `import type {}` from
  `dsh-client-ui-settings*/client` — type-only imports are erased and never
  reach the gate.
- The card edits go through the settings scope (staged draft → save plan), not
  by writing the store file directly. The host bridge commits them back to the
  file through the settings commit watcher, and external file edits are
  re-adopted behind an echo guard. Keep that direction: file → namespace is
  adoption; namespace → file is commit; the client never touches the file.
- Cross-field rules the wire schema cannot express go into the registration's
  `validate` option (delegating to the SHARED validator of the plugin that
  owns the store) — never re-implement validation in the card.

## 2. package.json client contract

```json
"dsh": {
  "client": {
    "platform": "web",
    "inject": [
      "@deepseek-ai/dsh-client-connection",
      "@deepseek-ai/dsh-client-runtime",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-api-remotes",
      "@deepseek-ai/dsh-client-ui-settings-plugins"
    ]
  }
}
```

Plus the exports a card package needs that a source-only plugin does not
(source-only anatomy: creating-a-source-plugin.md):

```json
"exports": {
  ".": "./src/index.ts",
  "./src/*": "./src/*",
  "./client": "./lib/client.js",
  "./package.json": "./package.json"
}
```

Source: web-compact-config/package.json. Extend the `inject` list only after
proving the new requirement on the target checkout.

## 3. Bundle contract (tsdown)

The card ships as a **CJS factory artifact** (`lib/client.js`), not as TS
source. The proven config is web-compact-config/tsdown.config.ts — copy it and
change only `ID`, the entry, and (carefully) the externals list.

- **Banner contract**: the bundle opens with a one-line loader banner
  (`window.__ModuleLoader__.load({ id: '<pkg>', factory: (require) => {`),
  closes with its matching footer (`return module.exports; } });`) and carries
  a `var module = { exports: {} }; var exports = module.exports;` intro.
  Copy the exact three strings from `outputOptions` (banner / footer / intro)
  and change only the id. The built-in card's bundle is the reference
  implementation (packages/client/tsdown.client.ts in the checkout); our
  tsdown.config.ts head comment documents why it is a standalone
  reproduction of the preset's client face.
- **externals = the platform module table**: `react`, `react/jsx-runtime`,
  `react-dom`, `react-dom/client`, and the `@deepseek-ai` client packages the
  shell shares into the frozen module table (see PLATFORM_MODULES in the
  config). Everything else — including your own files — is inlined.
- **Bundle purity gate**: a `resolveId` plugin throws for any non-externals
  `@deepseek-ai/*` value import. Keep it. It is the machine check for the
  rule "cross-plugin value imports are forbidden; collaborate through cordis
  services".
- Rebuild after client changes (tsdown; lib/ is gitignored) — the delivery
  junction points at the package on disk (§5), so an in-place rebuild is
  invisible to the browser until the staleness rule is respected (§5).

## 4. Card chrome rules (learned on 6c52415; moves to plugin-kit chrome via K3-1)

- The card head is a **disclosure** (`<button>` toggling the body); pills and
  banners derive from state, not from ad-hoc markup. Read
  web-compact-config/src/client/Card.tsx and the built-in mirror
  (packages/client/ui-settings-plugins/src/client/PluginCard.tsx in the
  checkout).
- **Never nest a control inside the disclosure button.** A header toggle must
  be a SIBLING of the button, wrapped together in a flex-row container — a
  control inside `<button>` is invalid HTML and breaks activation.
  Proven in 6c52415.
- State is drawn from the controller projection (loading / error / value
  states included); row components never edit the store file — writes go
  `face.edit(key, value)` on the staged draft.
- Every control carries an accessible name (`aria-label` / associated label);
  the master enable/disable switch uses `role="switch"` + `aria-checked`.

## 5. Delivery: junction, patch-row name, cache staleness

1. **Patch-row `name` rule — REQUIRED**: mount a card package by **package
   name** (`name: web-compact-config` in cordis.patch.yml), NOT by a
   `file://` URL. A file URL is legal for source-only plugins but silently
   suppresses the client bundle for a card package (proven on M3; recorded in
   the plugin-kit spec §4 and the M3 incident trail).
2. **Delivery junction**: the running profile loads client packages from
   `C:\Users\<user>\.dsh\profiles\node_modules\<pkg-name>`, which is a
   junction into this workspace's package directory — create it when a new
   card package first ships (never recopy files through it).
3. **Cache staleness after in-place rebuilds**: client bundles are fetched
   with `?rev=<boot-hash>`; after an in-place tsdown rebuild the browser can
   keep serving the OLD bundle. A hard reload of the Web GUI (127.0.0.1:3080)
   is required before declaring a visual fix "not applied" — and whether a
   change rendered is ALWAYS a user checkpoint, never agent-verified.
4. `dsh-client-store` and `dsh-client-ui-renderer` are absent on the RUN
   checkout (fork-era packages) — if your card seems to need them, re-check
   what actually provides the seam on the target first (AGENTS.md §4.5).

## 6. Before you claim done

Read plugin-checklist.md — a card plugin additionally needs the junction
reachable and the bundle rebuilt; that checklist owns it.
