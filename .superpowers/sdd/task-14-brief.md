## Task 14: Acceptance walkthrough + docs

- [ ] **Step 14.1: Full test suite + static checks.** Run `vitest.CMD run` (all three packages). Expected: all PASS. Record PASS/FAIL per spec file.
- Typecheck each package: `E:/js_projects/my_deepseek_harness/deepseek-harness/node_modules/typescript/bin/tsc --noEmit -p compaction-handoff/tsconfig.json` (repeat for the other two). Expected: clean. (The M3 client half typechecks with the shared tsconfig's react-jsx settings.)
- Lint: run the fork's oxlint over the three packages (`E:/.../node_modules/.bin/oxlint.CMD compaction-handoff compact-config-command web-compact-config`). If the fork's oxlint config assumptions fight this workspace, record the deviation rather than bending the code.
- [ ] **Step 14.2: Acceptance criteria run-through (spec §12)** — walk each checkbox against evidence, in a real session with the user where an LLM is required:
  - absolute-token trigger fires ~200k on the preset model (estimate drift noted),
  - `first` and `tokens` modes behave per §5 (unit tests cover; confirm live once),
  - every compaction archives (auto + `/compact` manual + an overflow if one occurs),
  - checkpoint contains the pointer with correct paths,
  - the model reads the archive when asked about a condensed detail,
  - archive failure with `block` leaves the surface unchanged (unit covered; live once if cheap),
  - `/compact-config` and the card edit the same file,
  - overflow + manual behavior otherwise match upstream.
- [ ] **Step 14.3: Docs.** Write `deepseek_plugins/docs/compaction-handoff.md`: what it does, config schema, command usage, card usage, archive layout, token-estimate caveat, wiring instructions (patch + junctions + link script), known limitations (overflow-retry hot-reload is load-time; estimate drift; workspace-relative archive paths assume the harness cwd is the workspace root).
- [ ] **Step 14.4: Update the spec's §12 checkboxes** to checked with evidence pointers; Commit (if git): `docs: compaction-handoff usage and acceptance record`.

---


