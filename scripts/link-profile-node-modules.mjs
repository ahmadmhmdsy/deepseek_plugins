import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Junction each workspace plugin into the harness profile-level
 * node_modules at $DSH_HOME/profiles/node_modules (the host healer keeps
 * foreign links) so cordis-plugin-loader's package-name resolution finds
 * out-of-tree, non-@-scoped plugin packages.
 *
 * Why this exists (MEMORY L-7): cordis-plugin-loader resolves patch entry
 * `name:` values via Node's package resolution. The process cwd's
 * node_modules (the workspace junction farm) only links @deepseek-ai/*
 * packages (per scripts/link-node-modules.mjs); non-scoped workspace
 * plugins (e.g. a client-card package) live at `<workspace>/<name>` but never
 * reach the resolver. The profile-level node_modules
 * ($DSH_HOME/profiles/node_modules) is the host healer's view and the
 * loader's effective fallback; once a junction lands there, every boot
 * (live or isolated) sees the plugin.
 *
 * Companion to scripts/link-node-modules.mjs. Re-run after any plugin
 * add/rename. Idempotent: an existing junction is rebuilt, not duplicated.
 *
 * Workspace plugins enumerated by reading each subdir's package.json
 * `name` (so renames stay accurate) and skipping leading-underscore
 * directories (`_template-plugin` is not a real plugin) plus a small
 * deny-list (plugin-kit is shared infrastructure, not a loadable plugin;
 * probe-dsh-resolution is a regression probe, not a deliverable).
 *
 * @module scripts/link-profile-node-modules
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.dsh')
const PROFILE_NM = join(DSH_HOME, 'profiles', 'node_modules')

const PLUGIN_DENY = new Set([
  'plugin-kit',              // shared presentation kit, not a loadable plugin
  'probe-dsh-resolution',    // module-resolution regression probe
  '_template-plugin',        // copy-and-rename skeleton (leading underscore = skip)
  'docs', 'screenshots', 'scripts', 'node_modules', '.dsh', '.git',
  'cordis.patch.yml-old',
])

function listWorkspacePlugins() {
  const found = []
  let entries
  try {
    entries = readdirSync(ROOT, { withFileTypes: true })
  } catch (error) {
    throw new Error('cannot enumerate workspace root ' + ROOT + ': ' + error.message)
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    if (PLUGIN_DENY.has(entry.name)) continue
    const manifest = join(ROOT, entry.name, 'package.json')
    if (!existsSync(manifest)) continue
    let json
    try {
      json = JSON.parse(readFileSync(manifest, 'utf8'))
    } catch {
      continue
    }
    const name = typeof json.name === 'string' ? json.name : entry.name
    found.push({ dirName: entry.name, pkgName: name, manifest })
  }
  return found
}

function lstatSafe(p) {
  try { return lstatSync(p) } catch { return undefined }
}

function relink(dest, target) {
  // Windows junctions are seen as symlinks by lstat. Recreate idempotently.
  const existing = lstatSafe(dest)
  if (existing !== undefined) rmSync(dest, { recursive: true, force: true })
  symlinkSync(target, dest, 'junction')
}

function main() {
  // The profile directory may not exist (fresh machine). Bail with a
  // helpful message rather than creating $DSH_HOME silently — that
  // belongs to the harness itself.
  const profileStat = lstatSafe(PROFILE_NM)
  if (profileStat === undefined) {
    console.log('skip: ' + PROFILE_NM + ' does not exist (no DSH profile yet)')
    return
  }
  if (!profileStat.isDirectory()) {
    throw new Error(PROFILE_NM + ' is not a directory')
  }

  const plugins = listWorkspacePlugins()
  if (plugins.length === 0) {
    console.log('no workspace plugins to link')
    return
  }

  // Plugin packages can be scoped (@scope/name) or unscoped (name).
  // Junction layout mirrors npm: scoped packages live at
  // profiles/node_modules/<scope>/<name>; unscoped at profiles/node_modules/<name>.
  let placed = 0
  const problems = []
  for (const plugin of plugins) {
    const target = join(ROOT, plugin.dirName)
    const dest = plugin.pkgName.startsWith('@')
      ? join(PROFILE_NM, ...plugin.pkgName.split('/'))
      : join(PROFILE_NM, plugin.pkgName)
    try {
      relink(dest, target)
      console.log(plugin.pkgName + ' -> ' + target)
      placed += 1
    } catch (error) {
      problems.push({ pkg: plugin.pkgName, error: error.message })
    }
  }
  console.log('linked ' + placed + '/' + plugins.length + ' plugins')
  if (problems.length > 0) {
    console.log('problems:')
    for (const { pkg, error } of problems) console.log('  ' + pkg + ': ' + error)
    if (placed === 0) process.exitCode = 1
  }
}

main()
