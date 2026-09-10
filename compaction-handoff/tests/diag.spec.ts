import { it } from 'vitest'

it('diag3', async () => {
  const ids = ["@deepseek-ai/dsh-compaction-basic/src/config.ts","@deepseek-ai/dsh-compaction-basic/src/region.ts","@deepseek-ai/dsh-compaction-basic/src/summarizer.ts","@deepseek-ai/dsh-llm/src/adapter-failure.ts","@deepseek-ai/dsh-llm/src/api-key.ts","@deepseek-ai/dsh-llm/src/assembler.ts","@deepseek-ai/dsh-llm/src/attribution.ts","@deepseek-ai/dsh-llm/src/brand.ts","@deepseek-ai/dsh-llm/src/call-config.ts","@deepseek-ai/dsh-llm/src/content.ts","@deepseek-ai/dsh-llm/src/error.ts","@deepseek-ai/dsh-llm/src/invariant.ts","@deepseek-ai/dsh-llm/src/message.ts","@deepseek-ai/dsh-llm/src/never.ts","@deepseek-ai/dsh-llm/src/retry-policy.ts","@deepseek-ai/dsh-llm/src/types.ts","@deepseek-ai/dsh-compaction-basic/src/index.ts","@deepseek-ai/dsh-llm/src/index.ts"]
  for (const id of ids) {
    try {
      await import(id)
      console.log('OK  ', id)
    } catch (e) {
      console.log('FAIL', id, '=>', String((e as Error)?.message ?? e).slice(0, 220))
    }
  }
})
