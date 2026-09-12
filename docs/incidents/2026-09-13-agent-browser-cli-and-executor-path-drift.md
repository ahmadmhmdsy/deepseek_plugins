# Incident — agent-browser CLI drift + executor PATH asymmetry (2026-09-13)

## Issue 1: screenshots silently not saved

While verifying the collapsible plugin card, screenshots fired with
`agent-browser screenshot <path> --full-page` printed a success line
("Screenshot saved to --full-page") but **no PNG appeared on disk** — the CLI
version installed behaves per its current help:

- usage is `screenshot [selector] [path]`; full-page flag is `--full`
- `--full-page` was parsed as an argument (it even created a stray FILE named
  `--full-page` in cwd once)
- the old `help` subcommand no longer exists (`agent-browser --help` or
  `agent-browser skills get core` instead)

**Fix:** `agent-browser screenshot "<abs-path>" --full` — worked immediately
(`card-open-drawer.png` / `card-closed.png` captured). Delete stray files
(`--full-page` removed). If an agent-browser invocation reports unexpected
success, cross-check the CURRENT CLI's help before trusting the output.

## Issue 2: pwsh tool "git is not recognized"

The pwsh tool's fresh process did not resolve `git` (or `rg`) from PATH on
this day, while `run_code`'s `execSync` (cmd shell) executed the same git
commands fine — the commit `500ee19` was created that way.

**Fix/verdict:** not an uninstall; an executor PATH asymmetry. When one
executor reports "not recognized", try the other executor before diagnosing
further. Recorded in ENVIRONMENT.md "Agent tooling drift (2026-09-13)".

## Evidence (timestamps, machine-verifiable)

- 2026-09-13 ~14:40-15:00 CEST: `agent-browser screenshot --help` output
  (`screenshot [selector] [path]`, `--full, -f`), "Screenshot saved to..." for
  the correct-path invocation, image files present under `.live-test/` with
  current mtimes; git operations (commit 500ee19, push) succeeded via cmd-shell
  execSync in the same window.
