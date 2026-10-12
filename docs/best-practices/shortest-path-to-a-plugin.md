# Best practices — the shortest path to a working plugin (start here)

This is the funnel: read it first, then the deep guide for the shape you picked.
The **full worked version with evidence and a 14-entry trap list** lives with the
plugin that proved it, and travels with that repo:
`D:\my_deepseek_harness\dsh-autocompact\docs\PLUGIN-GUIDE.md`
(target DSH `0.2.1-alpha.2`). Its `docs/incidents/` holds the record behind every
trap below, and `docs/INCIDENT-INDEX.md` is the one-page catalog.

The habit that saves the most time: **find the shipped implementation of the same
thing and copy its shape** before writing anything.

## 1. Pick the shape (30 seconds)

| You need | Shape | You write | First proof |
|---|---|---|---|
| Host behavior (engine, hook, watcher) | Source plugin | `src/index.ts` (`name` · `Config` · `inject` · `apply`) | suite + `--dump-config` |
| A config form for it | **Nothing extra** | volatile `Config` groups only | live Settings page |
| A chat command | Source plugin | command registration | suite + a live message |
| Live progress in the Web UI | Host HTTP routes + client bundle | `src/gui.ts` + `client.js` | structural tests + user refresh |
| A UI surface inside an existing slot | Client card | bundle + one slot registration | shipped-occupant comparison |

Deciding this first prevents the most common waste: hand-writing a settings form
the harness would have rendered for free.

## 2. The shortest order

1. `package.json` — source form (`main`/`exports` → `src/*.ts`), no build step.
2. `src/config.ts` — schemastery `Config`; one `.volatile()` node per live group.
3. `src/index.ts` — `name`, `Config`, `inject`, `apply`; one config reader.
4. Tests for pure logic → run the suite (target checkout's vitest bin).
5. `tsc -p tsconfig.json --noEmit`.
6. Patch row: package name when there is a client half; disable any base plugin you replace.
7. `--dump-config` — wiring, without booting.
8. Live install: profile junction + row; never copy files through the junction.
9. Client half (optional): `dsh.client` block, `./client` export, one fail-safe slot registration.
10. Structural tests → **user visual checkpoint** → commit → push.

## 3. The traps that cost the most

1. **Volatility is a containment rule** — a volatile node cannot nest inside
   another volatile node or an array element.
2. **`dsh.client.inject` takes package names; the bundle's `inject` takes ctx
   service keys** — two different lists, both required.
3. **A client card's patch-row `name` must be the package name** — a `file://` URL
   there silently drops the bundle.
4. **The bundle's externals are the frozen platform table** (`react`,
   `react/jsx-runtime`, `react-dom`, `react-dom/client`, a few `@deepseek-ai`
   client packages); `@deepseek-ai/*` **value** imports are forbidden. Never pin a
   platform fact in a test comment — assert against the table.
5. **`position:fixed`/`absolute` inside the composer is trapped** by
   `backdrop-filter`/`transform` containing blocks and clipped by overflow →
   portal the panel to `document.body`, clamp it, cap its height, re-anchor on the
   panel + trigger + row, and dismiss on `pointerdown` + capture `click` + Escape.
6. **`configEditor` hands out Loader nodes** — the patch id lives in
   `options.id`.
7. **Routes on `ctx.webServer` are not behind the GUI session gate** — local-only
   surfaces; record them as limitations.
8. **A plugin with no DOM test environment cannot see layout** — structural
   assertions plus a user visual checkpoint, stated as such.

## 4. Target drift — §1 of the client-card guide is the 0.1.x seam

On `0.2.1-alpha.2`, `ctx.settings.register` + `settingsScope` are gone:
a **volatile** `Config` gets a native settings page for free (host `ctx.settings`
→ `volatileForm`; client `ctx.configForms` + `ctx.settingsSchema`; bespoke cards
go into `plugins.item` gated by `whileServed`). Read
`creating-a-client-card-plugin.md` §7 before copying its §1 onto a 0.2.x target.

When something looks impossible, check the incident index before re-deriving it.
