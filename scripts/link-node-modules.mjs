import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NM = join(ROOT, 'node_modules')
const SCOPE = join(NM, '@deepseek-ai')

/**
 * Target DSH checkout. Priority: --target argument, DSH_TARGET env, the
 * running harness checkout, then the sibling dev fork. The choice is recorded
 * in scripts/.dsh-target.txt so the vitest alias facade reads the SAME tree
 * the junctions point at (one target per workspace at a time).
 */
function candidatePaths() {
  const argIndex = process.argv.indexOf('--target')
  const fromArg = argIndex !== -1 ? process.argv[argIndex + 1] : undefined
  return [
    fromArg,
    process.env.DSH_TARGET,
    'D:/deepseek_harness/deepseek-harness',
    resolve(ROOT, '..', 'deepseek-harness'),
  ].filter(Boolean).map(p => resolve(p))
}
function isDshCheckout(p) {
  return existsSync(join(p, 'package.json'))
    && existsSync(join(p, 'packages', 'compaction', 'compaction-basic', 'src', 'index.ts'))
}
const FORK = candidatePaths().find(isDshCheckout)
if (FORK === undefined) {
  throw new Error('no DSH checkout found (pass --target <path> or set DSH_TARGET)')
}
writeFileSync(join(ROOT, 'scripts', '.dsh-target.txt'), FORK + '\n')
console.log('target checkout: ' + FORK)

/** Map @deepseek-ai package names to their checkout-relative dirs by scanning package manifests. */
function scanWorkspacePackages() {
  const found = new Map()
  const visit = (rel) => {
    const dir = join(FORK, rel)
    if (!existsSync(dir)) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'lib') continue
      const childRel = rel === '' ? entry.name : rel + '/' + entry.name
      const manifest = join(dir, entry.name, 'package.json')
      if (existsSync(manifest)) {
        try {
          const name = JSON.parse(readFileSync(manifest, 'utf8')).name
          if (typeof name === 'string' && name.startsWith('@deepseek-ai/') && !found.has(name)) {
            found.set(name, childRel)
          }
        } catch { /* unreadable manifest: skip */ }
      }
      visit(childRel)
    }
  }
  visit('packages')
  visit('vendor')
  return found
}
const packageDirs = scanWorkspacePackages()

/** Junction set: name -> required. Client packages are optional (not present in every checkout). */
const WANTED = [
  ['cordis', true], ['cordis-plugin-include', true], ['cordis-plugin-loader', true],
  ['schemastery', true], ['cosmokit', true],
  ['dsh-compaction', true], ['dsh-compaction-basic', true], ['dsh-compaction-tool-result-pruner', true],
  ['dsh-llm', true], ['dsh-session', true], ['dsh-token-meter', true], ['dsh-agent', true],
  ['dsh-commands', true], ['dsh-settings', true], ['dsh-settings-file', true],
  ['dsh-client-ui-slots', true], ['dsh-client-ui-settings', true], ['dsh-client-ui-settings-plugins', true],
  ['dsh-client-store', false], ['dsh-client-locale', true], ['dsh-client-ui-renderer', false],
  ['dsh-workspace', true],
]

/** npm dependencies resolved through a target consumer (name -> consumer dir that has it installed). */
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

// A stale single-junction node_modules (early probe layout) is replaced wholesale.
const nmStat = lstatSyncSafe(NM)
if (nmStat !== undefined && nmStat.isSymbolicLink()) rmSync(NM)
mkdirSync(SCOPE, { recursive: true })

for (const [name, required] of WANTED) {
  const rel = packageDirs.get('@deepseek-ai/' + name)
  if (rel === undefined) {
    if (required) throw new Error('required target package missing: @deepseek-ai/' + name)
    console.log('@deepseek-ai/' + name + ' -> (absent in target; skipped)')
    continue
  }
  const target = join(FORK, rel)
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
for (const { name, from } of NPM_DEPS) {
  if (!existsSync(join(FORK, from))) { console.log(name + ' -> (consumer absent; skipped)'); continue }
  linkRoot(name, resolvePkg(name, join(FORK, from)))
}
for (const name of ROOT_TOOLS) linkRoot(name, resolvePkg(name, FORK))
console.log('link complete')
