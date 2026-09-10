import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { standardDecoratorPlugin } from '../deepseek-harness/vitest.shared.ts'
import { defineConfig } from 'vitest/config'

const ROOT = dirname(fileURLToPath(import.meta.url))
const FORK = resolve(ROOT, '..', 'deepseek-harness')

// The fork's tsconfig.base.json is its documented resolution facade (header
// comment there; plan §0.1): exact paths for every repo-local bare specifier,
// no include (match-all). Its lib/ builds would create a second
// module-singleton copy beside src, so — like the harness runtime (tsx over
// the same paths) — vitest must resolve everything to fresh src.
// vite-tsconfig-paths cannot do that here: it scopes a project's paths to
// files inside the project directory (our workspace sits outside the fork),
// and subpath imports then fell through to the junction exports under
// node_modules and were externalized raw (SyntaxError on TS sources). These
// explicit aliases carry the same mapping to every importer instead.

// The base file's only comments are whole-line // comments (no string value
// spans lines), so stripping those lines yields valid JSON.
const base = JSON.parse(
  readFileSync(resolve(FORK, 'tsconfig.base.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
)
const paths = base.compilerOptions.paths as Record<string, string[]>

// Fork workspace packages this workspace can reach (same set as
// scripts/link-node-modules.mjs). Subpath aliases need each package's src dir.
const WORKSPACE_PACKAGES = [
  'cordis', 'cordis-plugin-include', 'cordis-plugin-loader', 'schemastery', 'cosmokit',
  'dsh-compaction', 'dsh-compaction-basic', 'dsh-compaction-tool-result-pruner',
  'dsh-llm', 'dsh-session', 'dsh-token-meter', 'dsh-agent', 'dsh-commands',
  'dsh-settings', 'dsh-settings-file', 'dsh-client-ui-slots', 'dsh-client-ui-settings',
  'dsh-client-ui-settings-plugins', 'dsh-client-store', 'dsh-client-locale',
  'dsh-client-ui-renderer', 'dsh-workspace',
]

const aliases: { find: string, replacement: string }[] = []

// 1) '/src/*' subpath imports -> the package's src dir (exports-mapped TS
//    sources; the base facade has no patterns for them). Must precede the
//    bare-package keys below.
for (const name of WORKSPACE_PACKAGES) {
  const exact = paths['@deepseek-ai/' + name]
  if (!exact || exact.length === 0) continue
  const target = resolve(FORK, exact[0])
  const srcDir = /\.ts$/.test(target) ? dirname(target) : target
  aliases.push({ find: '@deepseek-ai/' + name + '/src/', replacement: srcDir + '/' })
}

// 2) Base facade keys, longest-first so a specific subpath key wins over its
//    bare package prefix. Wildcard keys (dsh-client-*) are added when the M3
//    client card needs them.
const keys = Object.keys(paths)
  .filter(k => !k.includes('*') && Array.isArray(paths[k]) && paths[k].length > 0)
  .sort((a, b) => b.length - a.length)
for (const k of keys) aliases.push({ find: k, replacement: resolve(FORK, paths[k][0]) })

export default defineConfig({
  // dsh-llm/src (and other fork sources) use standard (stage-3) decorators
  // that esbuild passes through untransformed; the fork's shared pre-plugin
  // transpiles them before Vite's parser sees the source.
  plugins: [standardDecoratorPlugin()],
  resolve: { alias: aliases },
  test: {
    environment: 'node',
    include: [
      'compaction-handoff/tests/**/*.spec.ts',
      'compact-config-command/tests/**/*.spec.ts',
      'web-compact-config/tests/**/*.spec.ts',
    ],
  },
})
