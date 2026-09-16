# Plan — File Editor (Monaco) client plugin (DRAFT — approved direction, code work pending final confirmation)

Status: direction approved in chat 2026-09-14 (user answered Q1–Q6). This file is
the durable milestone plan so M-B / M-C are not forgotten. A formal spec pass
(docs/superpowers/specs/) is owed before implementation starts.

## Proven facts (verified in DEV fork checkout, 2026-09-14)

- TRUE TAB SLOT EXISTS: `packages/client/ui-trajectory/src/client/index.ts` registers
  the "Trajectory" tab into `ctx.slots.inject('conversation.view', ...)` with
  `{ id, order: 10, locale NS, label thunk, inject: (sessionId) => props }`.
  Our plugin registers the same way: id 'editor', order 15, label "Editor".
  Plugin unload removes the tab (slot effect semantics) — this is our enable/disable path.
- WORKSPACE STRUCTURE: `ui-workspace` client half provides `useWorkspaces` global
  hook over `IWorkspaces` (`@deepseek-ai/dsh-api-workspace-controller/client`),
  WorkspaceSnapshot; sessions bind to workspaces (`ISessions`). The chat view
  opens views via `openView('trajectory', callId)` on `uiConversation` — the same
  openView action can target our 'editor' view id (Q2 hook for "chat click → editor").
- Client plugin delivery pattern: proven by web-compact-config (bundle banner,
  externals table, purity gate; see docs/best-practices/creating-a-client-card-plugin.md).

## Milestones

### M-A — View-only editor (first shippable)
1. `web-file-editor` package: host half (settings ns `fileEditor`: enabled flag)
   + client half registering into `conversation.view` (id 'editor').
2. Explorer tree, scoped to the CURRENT session's workspace root (reactive:
   follows workspace switches via useWorkspaces/session binding). Session cwd only (Q3).
   Lazy directory listing per expansion; gitignoreish default hiding (node_modules, .git, dist).
3. Monaco lazy-loaded as a separate chunk (dynamic import on first open); read-only mode.
4. Resizable tree/editor split with min widths (tree ≥180px, editor ≥320px).
5. File click in Chat (tool-call file paths) → switch to editor view (openView) when enabled.
6. Enable/disable toggle in plugin settings card; disabled = no tab, no chat hook.

### M-B — Writing (deferred, in this plan so it is NOT forgotten)
- Save/dirty state, unsaved-close confirm, host-side fs service over Cordis
  (allowlist: workspace dirs only; path traversal checks; size/binary caps).
- Create/rename/delete files & folders from the tree; conflict detection
  (mtime compare on save; reload-or-keep choices).

### M-C — Drag-drop & reorganize (deferred, NOT forgotten)
- Move files/folders via DnD inside the tree; external drag-drop import;
  workspace-wide search (grep via host). Accessibility + keyboard parity.

## Known risks carried forward
- `dsh-client-ui-settings` etc. absent on RUN? (must re-verify inject list per checkout)
- Monaco = separate chunk, never in frozen module table externals list failure
- openView('editor') requires the view to exist first (ordering caveat)


### M-D — UX polish on M-A (post-shipping review pass, 2026-09-16)

Triggered by a thorough UI/UX review (read in
`docs/best-practices/creating-a-client-card-plugin.md` §1b/§1c conventions and
the slot contract `packages/client/ui-conversation/.../slots.ts`). The chrome
scaffolding (kit disclosure + sibling switch) is correct; the Editor view
itself is functional but several notches below the rest of the GUI. Goals:
discoverability, feedback density, accessibility, and consistency with the
kit tokens. No data-plane changes; only `EditorView.tsx`, `workbench.ts`,
`SettingsCard.tsx`, `card-controller.ts` (display-only).

#### M-D.1 — Tree interaction correctness (Severity 1, four fixes)

1. **Root label is the absolute path** (`EditorView.tsx:DirButton`). Replace
   with the workspace title (already in the select). Move the path into the
   `<select>` `title` attribute.
2. **No hover/focus-visible on tree rows** (same). Add hover
   (`background: rgba(127,127,127,0.08)`) and
   `:focus-visible { outline: 2px solid ${TOKENS.accent}; outline-offset: -2px }`
   on `rowStyle`. Strengthen the selected state to a combined tint + accent
   inset-border on the inline-start edge.
3. **Loading/error rendering hides entries** (same). Render the previous
   entries with a single muted overlay row when `loading: true`; render
   `error` as a danger banner ABOVE the cached entries using the kit's
   `errorStyle` (do not replace the list).
4. **Empty directory renders blank** (same). Add a single muted row
   `(empty directory)` when `expanded && entries.length === 0 && !loading && !error`.

Also: add `title={childRel}` to both dir and file rows (Severity 3.5).

#### M-D.2 — Navigation primitives (Severity 1)

5. **Breadcrumb row above the tree.** Render `root › segment › … › leaf`
   where every segment except the leaf is a clickable jump. Reuses the
   `dirs` map (key `workspaceId#relDir`).
6. **Keyboard navigation on the tree.** ArrowDown/ArrowUp move focus,
   ArrowRight expands, ArrowLeft collapses (or jumps to parent), Enter
   activates, Home/End jump to first/last. `aria-expanded` on directory
   rows; `role="treeitem"`/`role="tree"` on the container. The face
   already returns enough metadata for a future per-kind glyph column.
7. **Empty / boot identity placeholder** (Severity 1.5). Replace the literal
   "Editor" / "still mounting..." placeholder with: title + one-line
   description ("Browse and read files in the active workspace") + the
   active workspace title when available + a tiny inline SVG spinner while
   mounting. Same identity on the right pane when no file is selected.

#### M-D.3 — Row metadata (Severity 2)

8. **Kind glyph + size + modified time per row.** Leading 14-px inline-SVG
   glyph in a 18-px fixed-width column (folder for dir, file for file),
   right-aligned muted size (`"4.2 KB"`) and modified timestamp
   (`"2 days ago"`). Reuses fields already on `FsEntryWire` (`size`,
   `modifiedMs`) that the view currently throws away.

#### M-D.4 — Kit consistency (Severity 2)

9. **Thread `TOKENS` into `EditorView.tsx`.** Replace every hardcoded
   color (`#b91c1c`, the various `rgba(127,127,127,0.07|0.18|0.25)`)
   with kit constants. The chrome sibling already exports them; just import.
10. **Move `overflow: auto` from the right pane onto the Monaco host.**
    Make the content pane `display: flex; flexDirection: column` with the
    file header as a fixed row and the Monaco host as `flex: 1`; Monaco
    already scrolls internally. Eliminates the layout bug where short files
    leave a gap and long files scroll the wrong axis.
11. **Round fontSize to 13** in both the tree rows and the Monaco workbench
    (drop the 12.5 oddity). Use `fontSize: 13` in `createReadonlyWorkbench`.

#### M-D.5 — Indent guides + depth cap (Severity 2)

12. **Indent guide line per nesting level.** `Entries` container gets
    `border-inline-start: 1px solid rgba(127,127,127,0.18)`.
13. **Depth cap surfaces a hint, not a silent drop.** When `depth >= 48`,
    render `(deeper levels not shown — open the file directly)` instead of
    hiding children.

#### M-D.6 — Settings card discoverability + pill tone (Severity 3)

14. **Use the kit `Select` shell** for the workspace picker (border +
    focus ring + label pattern). The settings card already exports it via
    `chrome.tsx`.
15. **Pill tone**: `enabled` = `accent`, `disabled` = `neutral`
    (current code is reversed). Tighten the body to one sentence instead
    of two near-duplicates.
16. **`Open Editor tab` button** in the card body, calling
    `openView(VIEW_ID, '')` via the standard Session hook contract
    (`conversation.view` exposes `openView` to slot entries). Adds
    discoverability for users who land in the Settings page.

#### M-D.7 — Monaco polish (Severity 2-3)

17. **Theme awareness**: read the host's theme (`document.documentElement.dataset.theme`
    or a CSS variable) and call `monaco.editor.setTheme`. Register both
    light and dark themes using `TOKENS` so the editor matches the rest
    of the GUI. **Spike first**: confirm the host exposes a theme attribute
    to slot entries; if not, defer to M-E (theme seam).
18. **`Read-only` pill** in the `ContentPane` header (next to the
    `{relPath} ({size} bytes)` line). Confirms the constraint so the user
    doesn't wonder why typing does nothing.

#### M-D.8 — Out of scope (parked for M-E "polish v2")

- Search/filter (`cmd+k` over the tree)
- Copy-path button (small ghost button in ContentPane header)
- Recent files (per-workspace `localStorage` of last-opened path)
- Drag-drop, multi-select, keyboard `j/k`

## M-D acceptance criteria

- Every fix in M-D.1–M-D.7 lands in one PR (or a small number of atomic PRs).
- No data-plane changes (`fs-remote.ts`, host half, contribution
  descriptors untouched).
- Full vitest suite green (target = RUN checkout); editor tests stay 31/31+.
- tsdown rebuild green; `lib/client.js` size growth documented.
- Live visual confirmation on the user's 3080 session is a USER CHECKPOINT
  (Ctrl+F5, see `creating-a-client-card-plugin.md` §5.3).
- MEMORY §kit updated with the new "thread TOKENS through EditorView"
  pattern if any non-obvious bundler/import ordering emerges.
- Incident file `docs/incidents/2026-09-16-editor-tab-blank-after-reload.md`
  cross-references the M-D milestone (UX is downstream of M-A's correctness
  fix; same plugin, different lens).

## M-D risk register

- **R1** — `openView` from the settings card body needs the slot owner
  contract; the editor's settings card is currently mounted in the
  `settings.plugin.item` slot, NOT in `conversation.view`. The card
  must NOT inject `openView` via its own owner — it must pull from the
  standard Session hook contract the card's host already binds. Confirm
  the binding site before implementing M-D.6.
- **R2** — Theme propagation into Monaco: if the host doesn't expose a
  CSS variable or data attribute visible to slot entries, the fallback is
  to detect `prefers-color-scheme` from `window.matchMedia`. Document
  which one wins in the implementation.
- **R3** — Keyboard navigation on the tree can fight the host's global
  focus trap (modal/dialog overlays). The arrow-key handler must
  `event.stopPropagation()` and check `event.defaultPrevented` before
  acting. Pattern proven by ui-workspace's tree.
- **R4** — Indent guides + larger row height (M-D.3 metadata column)
  increase the row height from ~22px to ~28px. With 100+ files visible
  this is fine; confirm the tree pane `minHeight: 240` on the container
  is still respected after the changes.
