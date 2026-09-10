import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin } from '../deepseek-harness/vitest.shared.ts'

export default defineConfig({
  plugins: [
    // Resolution facade, mirroring the fork's own vitest config: the fork's
    // include-less tsconfig.base.json is match-all over the fork tree, so bare
    // imports inside fork sources resolve to src/ — otherwise lib/index.js
    // loads a second module-singleton copy and instanceof checks fail. This
    // workspace's own tsconfig covers the plugin test files.
    tsconfigPaths({ projects: ['./tsconfig.json', '../deepseek-harness/tsconfig.base.json'], logFile: 'node_modules/vttp-diag.log' }),
    // Fork sources (e.g. @deepseek-ai/dsh-llm) use standard (stage-3)
    // decorators, which Vite's SSR transform passes through unlowered and
    // Node cannot parse — reuse the fork's pre-transform plugin.
    standardDecoratorPlugin(),
  ],
  test: {
    environment: 'node',
    include: [
      'compaction-handoff/tests/**/*.spec.ts',
      'compact-config-command/tests/**/*.spec.ts',
      'web-compact-config/tests/**/*.spec.ts',
    ],
  },
})
