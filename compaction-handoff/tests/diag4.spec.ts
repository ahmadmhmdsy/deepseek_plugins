import { it } from 'vitest'

it('diag4-stack', async () => {
  try {
    await import('@deepseek-ai/dsh-llm/src/index.ts')
    console.log('OK   llm/src/index.ts')
  } catch (e) {
    console.log('STACK for llm/src/index.ts:')
    console.log(String((e as Error)?.stack ?? e).slice(0, 3000))
  }
})
