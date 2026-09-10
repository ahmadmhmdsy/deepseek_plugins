## Task 8: M1 composition wiring + boot verification

**Files:** `cordis.patch.yml`, `handoff-config.json`.

- [ ] **Step 8.1: Default config file.**

```jsonc
// handoff-config.json
{
  "trigger": { "mode": "first", "ratio": 0.8 },
  "retain": { "ratio": 0.16 },
  "archive": { "root": ".dsh/handoffs", "gitExclude": true, "onFailure": "block" },
  "summarization": { "provider": "", "model": "", "maxTokens": 8192 },
  "retries": { "compactionRetries": 1, "maxOverflowRetries": 1 },
  "auto": true,
  "models": [
    {
      "provider": "deepseek",
      "model": "deepseek-chat",
      "trigger": { "tokens": 200000 },
      "retain": { "tokens": 32768 }
    }
  ]
}
```

- [ ] **Step 8.2: Wiring overlay.**

```yaml
# cordis.patch.yml — loaded with: dsh --profile <profile> --patch <this file>
# Disable the base ratio-only engine and mount the handoff engine instead.
- id: compaction-basic
  disabled: true
- insert:
    - id: compaction-handoff
      name: 'E:/js_projects/my_deepseek_harness/deepseek_plugins/compaction-handoff/src/index.ts'
      config:
        configFile: 'E:/js_projects/my_deepseek_harness/deepseek_plugins/handoff-config.json'
```

- [ ] **Step 8.3: Verify the composed tree without booting.**

Run from the fork: `node --import tsx/esm apps/cli/src/bin.ts --profile tui --patch E:/js_projects/my_deepseek_harness/deepseek_plugins/cordis.patch.yml --dump-config`
Expected: the tree shows `compaction-basic` disabled and the `compaction-handoff` entry present. (Flags verified in `apps/cli/src/args.ts`.)

- [ ] **Step 8.4: Boot smoke (user checkpoint).** The user starts their usual profile with the patch and confirms: no plugin-load error; the engine mounted. Do not boot long-lived servers from this session.
- [ ] **Step 8.5: Commit** (if git): `feat(handoff): composition overlay wiring for M1`.

---


