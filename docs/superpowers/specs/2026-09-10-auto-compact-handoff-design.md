# Design: Auto-Compact Handoff Plugin for DeepSeek Harness

- **Date:** 2026-09-10
- **Status:** Approved — brainstorming design approved, written spec reviewed and approved by the user (2026-09-10); implementation plan at `docs/superpowers/plans/2026-09-10-auto-compact-handoff.md`
- **Workspace:** `E:\js_projects\my_deepseek_harness\deepseek_plugins\`
- **Target harness:** DeepSeek Harness (DSH) — user fork at `E:\js_projects\my_deepseek_harness\deepseek-harness\`

---

## 1. Problem & goals

The user wants configurable, automatic context compaction ("auto-compact") for DeepSeek Harness sessions:

1. **Configurable trigger limits** — fire auto-compact at a *percentage* of the model's context window and/or at an *absolute token count*. The user may enter both; the combination rule is configurable.
2. **Per-model presets** — named presets keyed by exact `provider + model` (e.g. "this model auto-compacts at 200k tokens").
3. **Handoff on trigger** — when the limit is reached, the model produces a **structured summary ("handoff")** that lets the conversation resume from that point with its knowledge intact.
4. **Never delete — archive instead** — the conversation is *not* deleted. The full transcript is saved to disk in a model-readable directory, and the model is explicitly told where the archive is, so it can re-read details the summary does not capture.

### What DSH already provides (verified 2026-09-10 against `E:\deepseek-harness\`)

| Capability | Status | Where |
|---|---|---|
| Auto-compact at a percentage of the routed model's context window (default 0.8) | ✅ exists | `@deepseek-ai/dsh-compaction-basic` (`thresholdRatio`, serial `agent/pre-step` listener) |
| Per-model policy overrides (exact provider+model match) | ✅ exists | `modelPolicies` in `BasicCompactionConfig` — but **ratio-only** triggers |
| Absolute token-count *trigger* | ❌ missing | only `retainTokens` (kept tail) exists; no `thresholdTokens` |
| Combination rule when both ratio and absolute tokens are set | ❌ missing | n/a |
| Model-written structured checkpoint (Primary Request / Key Concepts / Files and Code / Errors and Fixes / Pending Jobs / Current Work / Next Step / Critical Context) | ✅ exists | `COMPACTION_INSTRUCTION` in `compaction-basic/src/summarizer.ts` |
| Conversation never deleted | ✅ exists | append-only session log; summary *shadows* surface nodes |
| Full transcript saved as model-readable files + pointer told to the model | ❌ missing | history stays in DSH's internal session storage |
| User-facing config surface | ⚠️ composition YAML only | no file/command/GUI tuning |

### Chosen architecture (user decision)

**Ride the existing seam**: a new backend that **subclasses `BasicCompactionEngine`**. Verified feasibility against source:

- `BasicCompactionEngine` is exported; `protected summarize(input, agent, signal?)` is the documented sole subclass hook. `input.messages` contains the full shadowed region in surface order — sufficient to render the transcript archive.
- `summarizeWithLlm` is exported — the override reuses the upstream cache-friendly call unchanged.
- `selectCompactableRange` (region.ts) and `compactSurfaceRegion` are exported; `compactRegion` is public — the pressure-path override reuses range selection and the shared transaction, so locking, tool-call pairing, durability, and cancellation semantics remain upstream.
- The parent's `agent/pre-step` listener calls `this.compactIfNeeded`, so overriding it (public method) redirects automatic triggering to our extended math. The `context-overflow` branch delegates to `super.compactIfNeeded` unchanged.

## 2. Scope & phasing

Three independently valuable deliverables over one shared config store:

| Phase | Deliverable | Value |
|---|---|---|
| **M1 — Core engine** | `compaction-handoff` Cordis plugin | Absolute-token triggers + combination modes; per-model presets; handoff archive on disk; model-visible pointer; config file |
| **M2 — Chat commands** | `compact-config` command plugin | `/compact-config show · set · preset · test · archive` — live tuning persisted to the same file |
| **M3 — Web GUI card** | `web-compact-config` client plugin + host bridge | Form-based editing in the harness Web GUI writing the same file |

Each phase is implemented, tested, and validated before the next starts.

## 3. Package layout

```
deepseek_plugins/
├─ compaction-handoff/          M1 — engine plugin (TypeScript, loaded by path)
│   ├─ src/index.ts             HandoffCompactionEngine (subclass) + plugin entry (apply)
│   ├─ src/config.ts            extended config schema, validation, per-model merge
│   ├─ src/trigger.ts           effective-threshold math (first | tokens modes)
│   ├─ src/archive.ts           conversation.md / handoff.md rendering, atomic writes, index
│   └─ src/summarize.ts         summarize() override: call → archive → pointer injection
├─ compact-config-command/      M2 — /compact-config command plugin
│   └─ src/index.ts             command registration + mutation via shared validator
└─ web-compact-config/          M3 — settings card (client half) + host bridge
```

Loaded as composition entries (`name` accepts relative/absolute module paths — per `docs/cordis-tutorial/01-first-plugin.md`).

**Known risk (resolved by probe in planning, not by assumption):** the plugin folder sits *outside* the harness checkout, so bare `@deepseek-ai/dsh-*` imports may not resolve from there. First planning step: a hello-world path-loaded plugin importing `@deepseek-ai/dsh-compaction` types. If resolution fails, mitigations in order: (a) workspace link (pnpm), (b) place the package inside the fork's `packages/` tree. Decided by evidence.

## 4. Config model (single source of truth)

One JSON file, watched for changes (edits apply to subsequent checks without restart). Default path: `<deepseek_plugins>/handoff-config.json` (next to the plugin); overridable via the plugin's composition `config: { configFile }`.

```jsonc
{
  "trigger": {
    "mode": "first",            // "first" = whichever limit comes first (default) | "tokens" = token count wins when set
    "ratio": 0.8,               // optional — fraction of the routed model's context window
    "tokens": 200000            // optional — absolute token count
  },
  "retain": { "ratio": 0.16 },  // kept-verbatim recent tail; alternatively { "tokens": N } (mutually exclusive)
  "archive": {
    "root": ".dsh/handoffs",    // relative to agent workspace (model-readable); absolute allowed
    "gitExclude": true,         // ensure "<root>/" is in .git/info/exclude (local-only, idempotent)
    "onFailure": "block"        // "block" = archive failure aborts compaction (default) | "proceed" = warn only
  },
  "summarization": { "provider": "", "model": "", "maxTokens": 8192 },
  "retries": { "compactionRetries": 1, "maxOverflowRetries": 1 },
  "auto": true,
  "models": [                   // per-model presets — exact provider+model match, field-wise merge over globals
    {
      "provider": "deepseek",
      "model": "deepseek-chat",
      "trigger": { "tokens": 200000 },   // partial override; omit subfields to inherit
      "retain": { "tokens": 32768 },
      "summarization": { "provider": "", "model": "", "maxTokens": 8192 },
      "disabled": false                   // true = never auto-compact this model (manual /compact unaffected)
    }
  ]
}
```

**Validation (fail-fast at load, upstream pattern):** unknown keys rejected; duplicate model entries rejected; `retainRatio ≥ thresholdRatio` rejected at load; `retainTokens ≥ effective threshold` checked at first use for a model (needs its context window — same as upstream). Neither `ratio` nor `tokens` set → inherit upstream default `thresholdRatio: 0.8`, so the plugin is safe unconfigured.

**Precedence:** per-model preset field → global field → upstream default.

## 5. Trigger behavior

Per routed model, on the serial `agent/pre-step` pressure check (overridden in the subclass):

```
window          = adapter-declared context window (upstream resolution; capacity errors inherited)
ratioThreshold  = ratio set ? floor(window × ratio) : ∞
effective       = (mode === "tokens" && tokens set) ? tokens
                : min(ratioThreshold, tokens ?? ∞)
fire when       measuredTokens >= effective     // two-phase: prune → remeasure → recheck (mirrors upstream)
```

- `mode: "first"` (default): entering both ratio and tokens means *two limits, earliest wins*.
- `mode: "tokens"`: an absolute token count, when set, replaces the ratio as the trigger; ratio remains only the fallback for models without a count.
- `disabled: true` preset → pressure check returns null; manual compaction unaffected.
- `context-overflow` trigger → `super.compactIfNeeded(agent, 'context-overflow', signal)` — upstream recovery behavior byte-for-byte.
- Manual `compactNow` / `compactRegion` inherit threshold-free behavior and route through our `summarize()` override — **every compaction archives**.
- **Documented caveat:** token counts are the harness's estimates (character-heuristic fallback where provider usage is unavailable); the fire point can drift a few percent at large thresholds. A `triggerMargin` knob is a documented future option, not built now.
- Auto-compact fires between steps, not mid-stream; a single turn ballooning past the limit is still caught at the next step boundary or by overflow recovery.
- `mode: "tokens"` with ratio unset and absolute retain set can trigger without resolving the model window; if a ratio-based field is needed and capacity is unknown, the inherited upstream `TargetPressureConfigError` surfaces with an actionable message.

## 6. Handoff & archive behavior (`summarize()` override)

1. **Summarize:** call the upstream exported `summarizeWithLlm` unchanged — same warm-prefix replay, same structured-checkpoint instruction, same text-only safe projection.
2. **Archive before replacement:** atomically write (temp file → rename) into `<archive-root>/<sessionId>/<NNN>-<YYYYMMDD-HHmmss>[-a<k]>/`:
   - `handoff.md` — the structured summary text (the resume document).
   - `conversation.md` — full readable transcript of the condensed span: role headers; text inline; tool calls and results as fenced blocks; images as `[image attachment]` placeholders. Header records session id, timestamp, routed model, measured token count.
   - `-a<k>` suffix distinguishes retry attempts within one compaction (never clobbered).
   - Ordinal `NNN` continues from existing dirs on session resume.
3. **Pointer injection:** prepend to the returned summary (lands inside the `<compacted-summary>` checkpoint the model sees). Paths in the pointer are workspace-relative when the archive sits under the workspace (sandbox-safe for the fs read tool), absolute otherwise:
   > **Handoff archive:** the full verbatim transcript of the condensed span and this handoff are saved at `<path>/conversation.md` and `<path>/handoff.md`. If any detail you need is not captured below, read those files before proceeding.
4. **Index:** append one line per archive to `<archive-root>/<sessionId>/index.md` (timestamp, ordinal, path, condensed token count, routed model).
5. **Failure policy:** any archive write failure → `block` (default): compaction aborts, surface unchanged, failed attempt visible in the session log — no knowledge loss. `proceed`: warn and continue without archive.
6. **Git hygiene:** if `gitExclude` is true and a `.git` exists at the workspace root, ensure `<root>/` appears in `.git/info/exclude` (append-only, idempotent, never touches tracked files). No git repo → skip silently.

**"Entire conversation" honesty note:** each compaction archives the span since the previous checkpoint (which itself embeds the prior `<compacted-summary>`, and the summarizer folds still-true prior-checkpoint facts forward). The session's `index.md` plus the chain of `conversation.md` files reconstructs the whole conversation; no single file is the entire verbatim history.

## 7. M2 — `/compact-config` chat command

Command plugin following the `dsh-command-compact` pattern. One command, subcommanded:

```
/compact-config show                          # effective config, per-model table, this session's status
/compact-config set ratio 0.8                 # globals: ratio · tokens · mode first|tokens
/compact-config set tokens 200000
/compact-config set retain ratio 0.16         # or: set retain tokens 32768
/compact-config preset add <provider> <model> [tokens N] [ratio R] [mode M] [retain tokens N | retain ratio R] [disabled]
/compact-config preset remove <provider> <model>
/compact-config preset set <provider> <model> <field> <value>   # incl. disabled true|false
/compact-config test                          # current session: measured tokens vs effective threshold; would-it-fire-now
/compact-config archive                       # archive root + this session's latest handoff path
```

Every mutation runs the **same validator module** as the file, then atomically rewrites the file; the watcher applies it. Invalid input → usage message, no file change.

## 8. M3 — Web GUI settings card

Client settings-card plugin (per `docs/cookbook/adding-a-settings-card.md`) plus a thin host bridge:

- **Fields:** mode dropdown; global ratio/tokens; retain; archive root; git-exclude toggle; summarization routing (provider/model/maxTokens); auto on/off; per-model preset table (add/remove/edit rows, `disabled` toggle).
- **Save:** host validates with the shared validator → atomic write; validation errors surface inline in the card.
- **Live preview:** for routed models with a known window, show effective threshold and "fires at" values as edited.
- One store, three views: file, command, and card all read/write the same JSON through the same validator.

## 9. Error handling & edge cases

| Case | Behavior |
|---|---|
| Invalid config at plugin load | Plugin fails to load with an actionable message |
| Bad config edit while running | Watcher keeps last good config, logs the validation error; session unaffected |
| Unknown model capacity + ratio needed | Inherited upstream `TargetPressureConfigError` with clear message |
| Ratio unset + absolute retain set | Works without window resolution (pure-tokens mode) |
| Archive write failure | `block` (default): abort compaction, surface unchanged; `proceed`: warn and continue |
| Retried compaction attempts | Distinct `-a<k>` archive dirs; index records each |
| Session restart/resume | Archive ordinal continues; upstream lock/orphan semantics inherited |
| Multiple agents in one context | One engine, shared policy; archives isolated per session id |
| Preset `disabled: true` | Never auto-fires; manual `/compact` works and still archives |

## 10. Testing strategy

- **Unit:** config validation matrix (unknown keys, duplicate models, retain ≥ threshold, mode semantics); trigger-math table (window sizes × ratio × tokens × mode × disabled); archive rendering (roles, tool call/result blocks, image placeholders); atomic write + attempt suffixing; git-exclude idempotence; pointer injection.
- **Integration** (fake LLM + session specs, mirroring upstream `compaction-basic` tests): absolute-threshold trigger fires and archives; checkpoint message contains the pointer; manual `/compact` archives; overflow path delegates unchanged; archive failure blocks compaction with surface intact; config hot-reload.
- **Manual smoke:** long real session → auto-compact at the preset limit → verify archive files and index; ask the model about a condensed detail and confirm it reads the archive.
- **Checks:** package vitest specs + lint + typecheck for each plugin.

## 11. Accepted gap additions (user-delegated suggestions; individually veto-able)

All eight proposed additions were folded in; the user may strike any during spec review:

1. Retention tail knob (`retain`) — **accepted**
2. Git-exclude for the archive — **accepted**
3. Summarizer routing + cost documentation — **accepted**
4. Atomic, attempt-suffixed archive writes — **accepted**
5. Token-estimate accuracy caveat documented — **accepted**
6. User-visible compaction notice (log line: trigger, condensed size, archive path) — **accepted**
7. `/compact-config test` preview — **accepted**
8. Per-model `disabled` flag — **accepted**

## 12. Acceptance criteria

- [x] With `models: [{ provider, model, trigger: { tokens: 200000 } }]`, a session routed to that model auto-compacts when measured tokens reach ~200k (estimate drift documented). EVIDENCE: per-model preset routing + trigger math unit tests (compaction-handoff/tests/); live absolute-threshold firing verified on the 3082 instance (trigger 100000; boundaries archived) and in the user's 3080 session. Estimate drift documented (HANDOFF §8d: archive 002 measured 1241 tokens).
- [x] Combination modes `first` and `tokens` behave per §5 for ratio-only, tokens-only, and both-set configurations. EVIDENCE: trigger.spec.ts unit coverage; live `tokens` mode on 3082/3080.
- [x] Every compaction (auto, overflow, manual) produces `handoff.md` + `conversation.md` + an `index.md` line under the configured archive root, written atomically, attempt-suffixed on retries. EVIDENCE: archive.spec.ts + engine.spec.ts; live flood run produced six attempt-suffixed archives 001-006 (.live-test); discriminator run produced 001-002.
- [x] The landed checkpoint message contains the archive pointer with correct paths. EVIDENCE: summarize.spec.ts pointer-path assertions; live sessions show the checkpoint with archive paths (HANDOFF §8/§8b).
- [ ] The model, when asked about a detail not in the summary, can find and read the archive via the fs read tool. (Live behavior — remains a user checkpoint per plan 14.2.)
- [x] Archive write failure with `onFailure: "block"` leaves the conversation surface unchanged. EVIDENCE: archive-failure engine tests (block path); live-if-cheap live confirmation recorded SKIPPED on 2026-09-12.
- [x] `/compact-config` show/set/preset/test mutate and persist the config file; the web card edits the same file. EVIDENCE: command.spec.ts + bridge.spec.ts (12 service tests over the real FileSettingsProvider) + store.spec.ts hot-reload test; live: the 08:47:25Z trigger edit landed in handoff-config-test.json and the engine adopted it.
- [x] Overflow recovery and manual `/compact` behavior otherwise match upstream. EVIDENCE: engine.spec.ts delegation tests; toBasicConfig guard keeps the ratio invariant; overflow recovery persists with enabled:false (Decision A tests).
- [x] All unit + integration specs pass; lint + typecheck clean. EVIDENCE: vitest run 2026-09-12: 95/95 (11 files), exit 0, RUN target; oxlint 0 errors / 10 style warnings; web-compact-config tsc clean; the other two tsc failure sets == the pre-existing fork-target drift errors recorded in HANDOFF §8c (verified unchanged at HEAD).

## 13. Open items for the implementation plan

1. **Module-resolution probe** (first task of M1): hello-world path-loaded plugin importing `@deepseek-ai/dsh-*`; pick link strategy vs in-fork placement by evidence.
2. Final composition/profile wiring in the user's fork for each phase.
3. Exact command parse grammar details for M2 (kept loose above).
4. Settings-card field layout details for M3 (cookbook-conformant).
