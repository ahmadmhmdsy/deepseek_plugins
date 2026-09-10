import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FORK = resolve(ROOT, '..', 'deepseek-harness')
const NM = join(ROOT, 'node_modules')
const SCOPE = join(NM, '@deepseek-ai')

/** Fork workspace packages this workspace imports (junction name -> fork-relative dir). */
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

/** npm dependencies resolved through a fork consumer (name -> fork dir that has it installed). */
const NPM_DEPS = [
  { name: 'react', from: 'packages/client/ui-settings-plugins' },
  { name: '@types/react', from: 'packages/client/ui-settings-plugins' },
]

/** Root dev tools used directly from this workspace. */
const ROOT_TOOLS = ['vitest', 'vite-tsconfig-paths', 'tsdown', 'typescript']

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
  // Nested root links (e.g. '@types/react') need their parent dir created first.
  mkdirSync(dirname(dest), { recursive: true })
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
  // Some packages (e.g. vite-tsconfig-paths) do not export './package.json';
  // fall back to the main entry and walk up to the package root.
  const probe = 'const p = (() => { try { return require.resolve(' + JSON.stringify(name + '/package.json') + ') } catch { return require.resolve(' + JSON.stringify(name) + ') } })(); console.log(p)'
  const entry = execFileSync('node', ['-e', probe], { cwd, encoding: 'utf8' }).trim()
  let dir = dirname(entry)
  while (dir !== dirname(dir) && !existsSync(join(dir, 'package.json'))) dir = dirname(dir)
  if (!existsSync(join(dir, 'package.json'))) throw new Error('cannot locate package root for ' + name)
  return dir
}
for (const { name, from } of NPM_DEPS) linkRoot(name, resolvePkg(name, join(FORK, from)))
for (const name of ROOT_TOOLS) linkRoot(name, resolvePkg(name, FORK))
console.log('link complete')
