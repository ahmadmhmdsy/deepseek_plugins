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
