# _template-plugin — copy-and-rename skeleton for a host-side plugin

Proven example of the smallest useful plugin shape (a minimal chat command),
adapted from compact-config-command and named TODO-PLUGIN throughout. It is
NOT mounted anywhere — the leading underscore marks it "not a real plugin";
the loader never sees it, but its tests still run in the workspace suite like
any other package (spec 2026-09-13 §5).

Read before copying: docs/best-practices/creating-a-source-plugin.md (anatomy
and wiring) and docs/best-practices/plugin-checklist.md (claim-done gates).
This template does NOT cover the client-card half — for that, read
creating-a-client-card-plugin.md and start from web-compact-config instead.

## Copy protocol

1. Copy the directory as your real package (a real name, no leading
   underscore). Git-add nothing until step 6 is green.
2. Rename every TODO-PLUGIN marker; afterwards grep the copy for
   TODO-PLUGIN and expect zero hits. Places to sweep (see the marker
   comments in the files):
   - package.json: name + description.
   - src/index.ts: @module, "export const name", the command name (the verb
     users type after the slash), the usage strings, the ctx.effect label.
   - src/parse.ts: @module, the request type name, the grammar itself.
   - tests/parse.spec.ts: assertions updated to YOUR grammar.
3. Edit the example logic out. Keep the CONTRACT, not the demo words:
   - parse returns a closed union incl. usage { error? };
   - the handler maps usage to an error result plus a usage line and never
     throws outward; failures inside are caught and rendered as
     { kind: "error" } with no partial state change;
   - cleanup rides ctx.effect (registration is lifecycle-managed;
     never unsubscribe manually);
   - all state mutations go through one shared validator + one store file
     (creating-a-source-plugin.md §3).
4. Wire the copy: add an insert row to cordis.patch.yml with the absolute
   path as a file:// URL (the ERR_UNSUPPORTED_ESM_URL_SCHEME trap is
   documented in that file header).
5. Run the gates from docs/best-practices/plugin-checklist.md §1-2: package
   tsconfig-level typecheck, full vitest suite via the TARGET checkout bin,
   and the --dump-config composition check (workdir = the RUN checkout) to
   confirm the new row.
6. Update the docs chain (TASKS row, HANDOFF entry, AGENTS §2 layout row) and
   commit with a feat(<plugin>) conventional subject.

## Kit pointers

Shared field-tested logic lives in plugin-kit/ (Task K3, consumer-gated per
spec §2: ≥2 proven users before extraction). Until a module exists there,
copy this template and keep the contracts; do not invent a second validation
or mutation path alongside the suite's existing shared validator pattern.
