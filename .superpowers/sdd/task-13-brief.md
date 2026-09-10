## Task 13: M3 wiring + GUI verification

- [ ] **Step 13.1: Add the host entry to `cordis.patch.yml`'s `insert:` list:**

```yaml
    - id: web-compact-config
      name: 'E:/js_projects/my_deepseek_harness/deepseek_plugins/web-compact-config/src/index.ts'
      config:
        configFile: 'E:/js_projects/my_deepseek_harness/deepseek_plugins/handoff-config.json'
```

- [ ] **Step 13.2: `--dump-config` shows it; the user starts `dsh web` with the patch; verify in the GUI: the Plugin configuration tab shows the compact-handoff card; edit a field → Save → `handoff-config.json` on disk changes; edit the file externally → the card reflects it on the next snapshot refresh; invalid input blocks the save inline.** (Manual checkpoint with the user; the GUI runs from this same checkout.)
- [ ] **Step 13.3: Commit** (if git): `feat(web-compact-config): composition wiring for M3`.

---


