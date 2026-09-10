## Task 6: summarizeWithArchive (summarize → archive → pointer)

**Files:** `compaction-handoff/src/summarize.ts`; test `compaction-handoff/tests/summarize.spec.ts`.

- [ ] **Step 6.1: Failing tests** (injected fake summarizer — no LLM needed).

```ts
// compaction-handoff/tests/summarize.spec.ts
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import { parseHandoffConfig } from '../src/config.ts'
import { summarizeWithArchive } from '../src/summarize.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function fakeSummary(text = 'CHECKPOINT'): Promise<SummaryResult> {
  return Promise.resolve({ summary: [{ type: 'text', text }], provider: 'p', model: 'm', maxTokens: 8192 })
}
const input: SummarizationInput = {
  messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })],
}
const agent = { session: { id: 'sess-9' }, options: {} } as never
const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
const ctx = { logger } as never

function deps(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'handoff-sum-'))
  dirs.push(root)
  return {
    ctx,
    config: parseHandoffConfig({ archive: { root }, trigger: { tokens: 100 } }),
    summarizer: () => fakeSummary(),
    spanTokens: () => 4242,
    routedModel: 'deepseek/deepseek-chat',
    cwd: '/somewhere/else',
    ...overrides,
  } as Parameters<typeof summarizeWithArchive>[0]
}

describe('summarizeWithArchive', () => {
  it('calls the upstream summarizer once and prepends the pointer inside the summary', async () => {
    const summarizer = vi.fn(() => fakeSummary('CHECKPOINT BODY'))
    const result = await summarizeWithArchive(deps({ summarizer }), input, agent)
    expect(summarizer).toHaveBeenCalledTimes(1)
    expect((result.summary[0] as { text: string }).text).toContain('**Handoff archive:**')
    expect((result.summary[1] as { text: string }).text).toBe('CHECKPOINT BODY')
  })
  it('writes handoff.md + conversation.md + index.md and logs the visible notice', async () => {
    const result = await summarizeWithArchive(deps(), input, agent)
    const pointer = (result.summary[0] as { text: string }).text
    const dirAbs = /at `([^`]+)\/conversation\.md`/.exec(pointer)?.[1] ?? ''
    expect(readdirSync(dirAbs).sort()).toEqual(['conversation.md', 'handoff.md'])
    expect(readFileSync(join(dirAbs, 'handoff.md'), 'utf8')).toContain('CHECKPOINT')
    expect(readFileSync(join(dirAbs, 'conversation.md'), 'utf8')).toContain('measured tokens: 4242')
    expect(readFileSync(join(dirAbs, '..', 'index.md'), 'utf8')).toContain('~4242 tokens')
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('handoff archive'))
  })
  it('onFailure block: archive failure rejects, so the compaction transaction aborts', async () => {
    const d = deps({
      config: parseHandoffConfig({ archive: { root: 'Z:/definitely-missing/root', onFailure: 'block' } }),
    })
    await expect(summarizeWithArchive(d, input, agent)).rejects.toThrow()
  })
  it('onFailure proceed: archive failure warns and the summary still lands', async () => {
    const d = deps({
      config: parseHandoffConfig({ archive: { root: 'Z:/definitely-missing/root', onFailure: 'proceed' } }),
    })
    const result = await summarizeWithArchive(d, input, agent)
    expect(logger.warn).toHaveBeenCalled()
    expect((result.summary[1] as { text: string }).text).toBe('CHECKPOINT')
  })
  it('uses workspace-relative pointer paths when the archive sits under cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'handoff-sum-'))
    dirs.push(root)
    const result = await summarizeWithArchive(deps({ cwd: root }), input, agent)
    expect((result.summary[0] as { text: string }).text).not.toMatch(/at `[A-Za-z]:[\\/]/)
  })
})
```

- [ ] **Step 6.2: Run → FAIL, then implement.**

```ts
// compaction-handoff/src/summarize.ts
/**
 * The summarize() override body: call the upstream summarizer unchanged, write
 * the archive, prepend the pointer (spec §6). Extraction lives here so the
 * engine stays thin and tests can inject a fake summarizer.
 *
 * @module compaction-handoff/summarize
 */
import { relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { summarizeWithLlm } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { renderConversation, renderPointerText, writeArchive } from './archive.ts'
import type { ResolvedHandoffConfig } from './types.ts'

/** Reads the condensed span priced token count for the current agent (0 = unknown). */
export type SpanTokensReader = (agent: Agent) => number

export interface SummarizeDeps {
  ctx: Context
  config: ResolvedHandoffConfig
  /** Defaults to the upstream summarizeWithLlm; tests inject a fake. */
  summarizer: typeof summarizeWithLlm
  spanTokens: SpanTokensReader
  /** "provider/model" of the routed or fallback summarization target. */
  routedModel: string
  /** Process workspace root used to relativize pointer paths. */
  cwd: string
}

/** Summarize, archive the condensed span, and prepend the archive pointer. */
export async function summarizeWithArchive(
  deps: SummarizeDeps,
  input: SummarizationInput,
  agent: Agent,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const { config } = deps
  const result = await deps.summarizer(deps.ctx, {
    summarizationProvider: config.summarization.provider,
    summarizationModel: config.summarization.model,
    maxTokens: config.summarization.maxTokens,
  }, input, agent, signal)

  const measuredTokens = deps.spanTokens(agent)
  const summaryText = result.summary.map(block => block.type === 'text' ? block.text : '').join('\n')
  const rootAbs = resolve(deps.cwd, config.archive.root)
  try {
    const written = await writeArchive({
      root: rootAbs,
      sessionId: String(agent.session.id),
      summary: summaryText,
      conversation: renderConversation(input, {
        sessionId: String(agent.session.id),
        timestamp: new Date(),
        routedModel: deps.routedModel,
        measuredTokens,
      }),
      timestamp: new Date(),
      measuredTokens,
      routedModel: deps.routedModel,
    })
    const pointerDir = pointerPath(written.dirAbs, deps.cwd)
    deps.ctx.logger.info('handoff archive: ' + pointerDir
      + ' (conversation.md + handoff.md, ~' + measuredTokens + ' tokens condensed)')
    return { ...result, summary: [{ type: 'text', text: renderPointerText(pointerDir) }, ...result.summary] }
  } catch (error: unknown) {
    if (config.archive.onFailure === 'proceed') {
      const message = error instanceof Error ? error.message : String(error)
      deps.ctx.logger.warn('handoff archive failed (proceeding without archive): ' + message)
      return result
    }
    throw error
  }
}

/** Workspace-relative path when the archive sits under cwd (sandbox-safe), absolute otherwise. */
function pointerPath(dirAbs: string, cwd: string): string {
  const rel = relative(cwd, dirAbs)
  const insideCwd = rel !== '' && !rel.startsWith('..')
  return insideCwd ? rel.split(sep).join('/') : dirAbs
}
```

- [ ] **Step 6.3: Run → PASS.**
- [ ] **Step 6.4: Commit** (if git): `feat(handoff): summarize-with-archive flow and pointer injection`.

---


