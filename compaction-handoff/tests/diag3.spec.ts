import { it } from 'vitest'

it('diag3-index-files', async () => {
  const ids = [
    '@deepseek-ai/dsh-llm/src/index.ts',
    '@deepseek-ai/dsh-session/src/index.ts',
    '@deepseek-ai/dsh-commands/src/index.ts',
    '@deepseek-ai/dsh-token-meter/src/index.ts',
    '@deepseek-ai/dsh-compaction-basic/src/index.ts',
    '@deepseek-ai/dsh-compaction/src/index.ts',
    '@deepseek-ai/dsh-agent/src/index.ts',
    '@deepseek-ai/dsh-scope/src/index.ts',
    '@deepseek-ai/dsh-attachment/src/index.ts',
    '@deepseek-ai/dsh-util-crypto/src/index.ts',
  ]
  for (const id of ids) {
    try {
      await import(id)
      console.log('OK  ', id)
    } catch (e) {
      console.log('FAIL', id, '=>', String((e as Error)?.message ?? e).slice(0, 200))
    }
  }
  // typert-protocol is not junctioned; go through the fork tree relative path.
  try {
    await import('../../../deepseek-harness/packages/typert/protocol/src/index.ts')
    console.log('OK   typert/protocol/src/index.ts (relative)')
  } catch (e) {
    console.log('FAIL typert/protocol/src/index.ts (relative) =>', String((e as Error)?.message ?? e).slice(0, 200))
  }
  try {
    await import('../../../deepseek-harness/packages/typert/protocol/src/types.ts')
    console.log('OK   typert/protocol/src/types.ts (relative)')
  } catch (e) {
    console.log('FAIL typert/protocol/src/types.ts (relative) =>', String((e as Error)?.message ?? e).slice(0, 200))
  }
})
