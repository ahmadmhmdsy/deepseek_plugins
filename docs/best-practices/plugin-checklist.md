# Best practices — before you claim done (plugin checklist)

Run this list for EVERY plugin task in this workspace. The per-plugin anatomy
guides (creating-a-source-plugin.md, creating-a-client-card-plugin.md) end
before "done" and hand off here; this list does not restate them.

Source pointers: AGENTS.md §3 (commands), §5 (git), §6 (conventions), §10
(CLAUDE.md validation rules). Do not re-derive; trust and link.

## 1. Type + unit validation

- [ ] `tsc --noEmit` for the touched package (package-level tsconfig; there is
      no root package.json — see AGENTS.md §4.4).
- [ ] Full vitest suite via the TARGET checkout's bin, from the workspace
      root:
      `& '<target-checkout>\node_modules\.bin\vitest.CMD' run`.
      Report file/test counts and exit code, not a vibe (CLAUDE.md §10). The
      current recorded baseline lives in HANDOFF.md; green ON THE TARGET is
      the rule (universal-target directive, AGENTS.md §4.1 — kit/shared code
      additionally goes green on the OTHER checkout before claiming done).
- [ ] New tests are added for new behavior; existing observable assertions
      were not weakened.
SKIPPED format (when a check cannot run): `SKIPPED: <check> — REASON: <why>`.

## 2. Wiring validation

- [ ] `--dump-config` composition check after any cordis.patch.yml or package
      wiring change (workdir = the RUN checkout):
      `node --import tsx/esm apps/cli/src/bin.ts --profile web --patch 'D:/…/deepseek_plugins/cordis.patch.yml' --dump-config`.
      PASS = exit 0 + the plugin rows present + base rows you displaced are
      `disabled: true`. No boot happened.
- [ ] Card packages additionally: `lib/client.js` rebuilt (tsdown) and the
      delivery junction in the current user's profile\node_modules resolves
      to the workspace package.

## 3. Junction / environment hygiene

- [ ] Junction farm re-pointed only via `node scripts/link-node-modules.mjs`
      (target recorded in scripts/.dsh-target.txt); nothing in node_modules
      was hand-edited.
- [ ] No `pnpm/npm install` was run in this workspace.
- [ ] The running DSH harness was never killed, restarted, or replaced; boot
      or GUI verification is left as an explicit NEEDS_USER_DECISION (also
      called a user checkpoint) rather than claimed.

## 4. Standing rules before the commit

- [ ] Every REAL issue encountered (bug, misdiagnosis, silent failure) has its
      durable record: MEMORY.md entry (knowledge), HANDOFF.md entry
      (narrative + evidence), and `docs/incidents/<date>-<topic>.md`
      (self-contained issue+fix). Raw rigs live in gitignored dirs.
- [ ] HANDOFF.md snapshot entry and TASKS.md status row updated (TASKS owns
      live status; HANDOFF owns narrative and evidence); any
      plan/spec contradiction resolved WITHOUT editing those files silently —
      the resolution goes to HANDOFF.md §5.
- [ ] AGENTS.md §1/§2 map updated if a new durable document or package was
      created; a document outside the map does not exist for the next agent.
- [ ] Final diff reviewed: no unrelated changes, no secrets, no large
      binaries (gitignore rules in AGENTS.md §5 hold).

## 5. Commit + push

- Conventional subject per the touched area (`feat(<scope>): …`, `fix: …`,
  `docs(kit): …`, `refactor(kit): …`); one commit per green task.
- Push to `origin master`; no force-push, no history rewrite, no remote
  changes.
- Git CRLF warnings are benign; fix nothing because of them.

## 6. Honest labels

Every claim in your final report carries its validation method and its exact
evidence (command output, file counts, mtimes). PASS / FAIL / SKIPPED /
BLOCKED / NEEDS_USER_DECISION — optimistic claims are the failure mode this
checklist exists to prevent (CLAUDE.md §10, §16).
