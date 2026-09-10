## Task 1: Toolchain bootstrap (junctions, tsconfig, vitest, smoke)

**Files:**
- Create: `scripts/link-node-modules.mjs`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `compaction-handoff/tests/toolchain.spec.ts`

- [ ] **Step 1.1: Ask the user about git** (one question): "Initialize git in `deepseek_plugins` for commit checkpoints?" If yes → `git init` + initial commit of existing docs. If no → all Commit steps below become SKIPPED.

- [ ] **Step 1.2: Replace the probe's root junction with real per-package junctions.** The probe created `deepseek_plugins/node_modules` as one junction to the fork's node_modules; the script replaces it with a real directory containing per-package junctions.

```js
// scripts/link-node-modules.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FORK = resolve(ROOT, '..', 'deepseek-harness')
const NM = join(ROOT, 'node_modules')
const SCOPE = join(NM, '@deepseek-ai')

/** Fork workspace packages this workspace imports (junction name → fork-relative dir). */
const WORKSPACE_PACKAGES = {
  cordis: 'vendor/cordis',
  'cordis-plugin-include': 'vendor/include',
  'cordis-plugin-loader': 'vendor/loader',
  schemastery: 'vendor/schemastery',
  cosmokit: 'vendor/cosmokit',
  'dsh-compaction': 'packages/compaction/compaction',
  'dsh-compaction-basic': 'packages/compaction/compaction-basic',
  'dsh-compaction-tool-result-pruner': 'packages/compaction/compaction-tool-result-pruner',
  'dsh-llm': 'packages/llm/llm',
  'dsh-session': 'packages/core/session',
  'dsh-token-meter': 'packages/llm/token-meter',
  'dsh-agent': 'packages/core/agent',
  'dsh-commands': 'packages/interaction/commands',
  'dsh-settings': 'packages/settings/settings',
  'dsh-settings-file': 'packages/settings/settings-file',
  'dsh-client-ui-slots': 'packages/client/ui-slots',
  'dsh-client-ui-settings': 'packages/client/ui-settings',
  'dsh-client-ui-settings-plugins': 'packages/client/ui-settings-plugins',
  'dsh-client-store': 'packages/client/store',
  'dsh-client-locale': 'packages/client/locale',
  'dsh-client-ui-renderer': 'packages/client/ui-renderer',
  'dsh-workspace': 'packages/workspace/workspace',
}

/** npm dependencies resolved through a fork consumer (name → fork dir that has it installed). */
const NPM_DEPS = [
  { name: 'react', from: 'packages/client/ui-settings-plugins' },
  { name: '@types/react', from: 'packages/client/ui-settings-plugins' },
]

/** Root dev tools used directly from this workspace. */
const ROOT_TOOLS = ['vitest', 'vite-tsconfig-paths', 'tsdown']

function lstatSyncSafe(p) {
  try { return lstatSync(p) } catch { return undefined }
}
function removeJunction(dest) {
  if (lstatSyncSafe(dest) === undefined && !existsSync(dest)) return
  // lstat sees junctions as symlinks; rmSync removes the link, not the target.
  rmSync(dest, { recursive: true, force: true })
}
function linkScoped(name, target) {
  const dest = join(SCOPE, name)
  removeJunction(dest)
  symlinkSync(target, dest, 'junction')
  console.log('@deepseek-ai/' + name + ' -> ' + target)
}
function linkRoot(name, target) {
  const dest = join(NM, name)
  removeJunction(dest)
  symlinkSync(target, dest, 'junction')
  console.log(name + ' -> ' + target)
}

// The probe created node_modules itself as one junction; replace it with a real dir.
const nmStat = lstatSyncSafe(NM)
if (nmStat !== undefined && nmStat.isSymbolicLink()) rmSync(NM)
mkdirSync(SCOPE, { recursive: true })

for (const [name, rel] of Object.entries(WORKSPACE_PACKAGES)) {
  const target = join(FORK, rel)
  if (!existsSync(join(target, 'package.json'))) throw new Error('fork package missing: ' + target)
  linkScoped(name, target)
}
function resolvePkg(name, cwd) {
  return dirname(execFileSync('node',
    ['-e', 'console.log(require.resolve(' + JSON.stringify(name + '/package.json') + '))'],
    { cwd, encoding: 'utf8' }).trim())
}
for (const { name, from } of NPM_DEPS) linkRoot(name, resolvePkg(name, join(FORK, from)))
for (const name of ROOT_TOOLS) linkRoot(name, resolvePkg(name, FORK))
console.log('link complete')
```

Run: `node scripts/link-node-modules.mjs` (from `deepseek_plugins`).
Expected: one `-> <path>` line per package, then `link complete`. `Get-Item deepseek_plugins/node_modules` shows a **real directory** containing `@deepseek-ai` (junctions inside), `react`, `vitest`, etc.

- [ ] **Step 1.3: Root tsconfig (paths → fork src, mirroring the fork's resolution facade).**

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["node"],
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "baseUrl": "../deepseek-harness",
    "paths": {
      "@deepseek-ai/cordis": ["./vendor/cordis/src"],
      "@deepseek-ai/cosmokit": ["./vendor/cosmokit/src"],
      "@deepseek-ai/schemastery": ["./vendor/schemastery/src"],
      "@deepseek-ai/dsh-compaction": ["./packages/compaction/compaction/src"],
      "@deepseek-ai/dsh-compaction/types": ["./packages/compaction/compaction/src/types.ts"],
      "@deepseek-ai/dsh-compaction/checkpoint": ["./packages/compaction/compaction/src/checkpoint.ts"],
      "@deepseek-ai/dsh-compaction-basic": ["./packages/compaction/compaction-basic/src"],
      "@deepseek-ai/dsh-compaction-basic/*": ["./packages/compaction/compaction-basic/src/*"],
      "@deepseek-ai/dsh-compaction-tool-result-pruner": ["./packages/compaction/compaction-tool-result-pruner/src"],
      "@deepseek-ai/dsh-llm": ["./packages/llm/llm/src"],
      "@deepseek-ai/dsh-llm/types": ["./packages/llm/llm/src/types.ts"],
      "@deepseek-ai/dsh-llm/brand": ["./packages/llm/llm/src/brand.ts"],
      "@deepseek-ai/dsh-llm/message": ["./packages/llm/llm/src/message.ts"],
      "@deepseek-ai/dsh-session": ["./packages/core/session/src"],
      "@deepseek-ai/dsh-session/types": ["./packages/core/session/src/types.ts"],
      "@deepseek-ai/dsh-session/surface": ["./packages/core/session/src/surface.ts"],
      "@deepseek-ai/dsh-token-meter": ["./packages/llm/token-meter/src"],
      "@deepseek-ai/dsh-agent": ["./packages/core/agent/src"],
      "@deepseek-ai/dsh-agent/types": ["./packages/core/agent/src/types.ts"],
      "@deepseek-ai/dsh-commands": ["./packages/interaction/commands/src"],
      "@deepseek-ai/dsh-commands/brand": ["./packages/interaction/commands/src/brand.ts"],
      "@deepseek-ai/dsh-commands/types": ["./packages/interaction/commands/src/types.ts"],
      "@deepseek-ai/dsh-settings": ["./packages/settings/settings/src"],
      "@deepseek-ai/dsh-settings/types": ["./packages/settings/settings/src/types.ts"],
      "@deepseek-ai/dsh-workspace": ["./packages/workspace/workspace/src"],
      "@deepseek-ai/dsh-client-ui-slots": ["./packages/client/ui-slots/src"],
      "@deepseek-ai/dsh-client-ui-settings": ["./packages/client/ui-settings/src"],
      "@deepseek-ai/dsh-client-ui-settings/client": ["./packages/client/ui-settings/src/client"],
      "@deepseek-ai/dsh-client-ui-settings-plugins": ["./packages/client/ui-settings-plugins/src"],
      "@deepseek-ai/dsh-client-ui-settings-plugins/client": ["./packages/client/ui-settings-plugins/src/client"],
      "@deepseek-ai/dsh-client-store": ["./packages/client/store/src"],
      "@deepseek-ai/dsh-client-locale": ["./packages/client/locale/src"],
      "@deepseek-ai/dsh-client-ui-renderer": ["./packages/client/ui-renderer/src"],
      "@deepseek-ai/dsh-client-ui-renderer/client": ["./packages/client/ui-renderer/src/client"]
    }
  }
}
```

- [ ] **Step 1.4: vitest config.**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: [
      'compaction-handoff/tests/**/*.spec.ts',
      'compact-config-command/tests/**/*.spec.ts',
      'web-compact-config/tests/**/*.spec.ts',
    ],
  },
})
```

- [ ] **Step 1.5: Toolchain smoke test (regression probe as a test).**

```ts
// compaction-handoff/tests/toolchain.spec.ts
import { describe, expect, it } from 'vitest'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { CompactionEngine } from '@deepseek-ai/dsh-compaction'
import { selectCompactableRange } from '@deepseek-ai/dsh-compaction-basic/src/region.ts'
import { summarizeWithLlm } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import { TargetPressureConfigError } from '@deepseek-ai/dsh-compaction-basic/src/config.ts'

describe('fork module resolution', () => {
  it('loads the compaction backend through junctions and tsconfig paths', () => {
    expect(typeof BasicCompactionEngine).toBe('function')
    expect(BasicCompactionEngine.prototype instanceof CompactionEngine).toBe(true)
    expect(typeof selectCompactableRange).toBe('function')
    expect(typeof summarizeWithLlm).toBe('function')
    expect(TargetPressureConfigError.name).toBe('TargetPressureConfigError')
  })
})
```

- [ ] **Step 1.6: Run the smoke test.**

Run: `E:/js_projects/my_deepseek_harness/deepseek-harness/node_modules/.bin/vitest.CMD run compaction-handoff/tests/toolchain.spec.ts` (cwd `deepseek_plugins`).
Expected: `1 passed`. If module resolution fails, fix junctions before proceeding — everything downstream depends on this.

- [ ] **Step 1.7: Commit** (if git approved): `feat: bootstrap plugin toolchain over fork junctions`.

---


