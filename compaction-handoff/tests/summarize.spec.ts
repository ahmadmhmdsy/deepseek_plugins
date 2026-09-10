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

// 'at <dir>/conversation.md' inside the pointer paragraph.
const pointerDirRe = new RegExp('at \x60([^\x60]+)/conversation\.md')
// An absolute Windows path in the pointer (drive letter) means it was not relativized.
const absolutePointerRe = new RegExp('at \x60[A-Za-z]:')

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
    const dirAbs = pointerDirRe.exec(pointer)?.[1] ?? ''
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
    // Spec §6.5 "proceed": warn and continue WITHOUT archive — the summary
    // lands unchanged and carries no pointer (it would point nowhere).
    const first = result.summary[0] as { text: string }
    expect(first.text).toBe('CHECKPOINT')
    expect(first.text).not.toContain('Handoff archive')
  })
  it('uses workspace-relative pointer paths when the archive sits under cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'handoff-sum-'))
    dirs.push(root)
    // The archive root AND the cwd must be the same tree for relativization.
    const result = await summarizeWithArchive(deps({
      cwd: root,
      config: parseHandoffConfig({ archive: { root }, trigger: { tokens: 100 } }),
    }), input, agent)
    const pointer = (result.summary[0] as { text: string }).text
    expect(pointer).not.toMatch(absolutePointerRe)
    expect(pointer).toContain('sess-9/')
  })
})
