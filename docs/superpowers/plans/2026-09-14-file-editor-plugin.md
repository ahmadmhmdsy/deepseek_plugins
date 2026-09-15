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
