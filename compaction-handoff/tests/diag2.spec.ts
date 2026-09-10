import { it } from 'vitest'

it('diag-leaf', async () => {
  const ids = [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-typert-protocol',
    '@deepseek-ai/dsh-invariants',
    '@deepseek-ai/dsh-brand',
    '@deepseek-ai/dsh-commands',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/schemastery',
    '@deepseek-ai/dsh-token-meter',
    '@deepseek-ai/dsh-compaction',
    '@deepseek-ai/dsh-compaction-basic',
    '@deepseek-ai/cordis/src/index.ts',
    '@deepseek-ai/dsh-typert-protocol/src/index.ts',
    '@deepseek-ai/dsh-invariants/src/index.ts',
    '@deepseek-ai/dsh-brand/src/index.ts',
  ]
  for (const id of ids) {
    try {
      await import(id)
      console.log('OK  ', id)
    } catch (e) {
      console.log('FAIL', id, '=>', String((e as Error)?.message ?? e).slice(0, 200))
    }
  }
})
