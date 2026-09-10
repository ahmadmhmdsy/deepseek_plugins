/**
 * Handoff archive writer (spec §6): conversation.md + handoff.md under
 * <root>/<sessionId>/<NNN>-<YYYYMMDD-HHmmss>[-a<k]>/, atomic (temp → rename),
 * an index.md register, the model-visible pointer paragraph, and
 * .git/info/exclude hygiene. The conversation is never deleted — writes only.
 *
 * @module compaction-handoff/archive
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SummarizationInput } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'

export interface ArchiveHeader {
  sessionId: string
  timestamp: Date
  routedModel: string
  measuredTokens: number
}

export interface ArchiveWriteResult {
  /** Directory name under <root>/<sessionId>/, e.g. "001-20260910-120000". */
  dirName: string
  /** Absolute archive directory. */
  dirAbs: string
}

/** Render the full readable transcript of the condensed span (spec §6.2). */
export function renderConversation(input: SummarizationInput, header: ArchiveHeader): string {
  const lines: string[] = [
    '# Conversation archive — ' + header.sessionId,
    '',
    '- timestamp: ' + header.timestamp.toISOString(),
    '- routed model: ' + header.routedModel,
    '- measured tokens: ' + header.measuredTokens,
    '- note: each compaction archives the span since the previous checkpoint; the session',
    '  index.md plus the chain of conversation.md files reconstructs the whole conversation.',
    '',
  ]
  for (const message of input.messages) lines.push(...renderMessage(message))
  return lines.join('\n') + '\n'
}

function renderMessage(message: Message): string[] {
  const role = message.role === 'tool' ? 'tool' : message.role
  const lines = ['## ' + role, '']
  for (const block of message.content) lines.push(...renderBlock(block))
  lines.push('')
  return lines
}

function renderBlock(block: ContentBlock): string[] {
  if (block.type === 'text') return [block.text, '']
  if (block.type === 'tool-call') {
    return ['```tool-call ' + block.name, String((block as { arguments?: unknown }).arguments ?? '{}'), '```', '']
  }
  if (block.type === 'tool-result') {
    return ['```tool-result',
      ...renderBlocks((block as { content?: readonly ContentBlock[] }).content ?? []), '```', '']
  }
  // Any image/attachment/other block: a placeholder line (never binary).
  return ['[image attachment] (' + String(block.type) + ')', '']
}

function renderBlocks(blocks: readonly ContentBlock[]): string[] {
  return blocks.flatMap(block => renderBlock(block))
}

/** The pointer paragraph prepended to the summary (spec §6.3, exact wording). */
export function renderPointerText(archiveDir: string): string {
  return '**Handoff archive:** the full verbatim transcript of the condensed span and this handoff are saved '
    + 'at `' + archiveDir + '/conversation.md` and `' + archiveDir + '/handoff.md`. '
    + 'If any detail you need is not captured below, read those files before proceeding.'
}

/** Next archive dir name: ordinal continues; -a<k> disambiguates same-second archives. */
export function nextArchiveName(sessionDir: string, timestamp: Date): string {
  const stamp = formatStamp(timestamp)
  let max = 0
  let sameSecond = 0
  if (existsSync(sessionDir)) {
    for (const name of readdirSync(sessionDir)) {
      const match = /^(\d{3})-(\d{8}-\d{6})(?:-a(\d+))?$/.exec(name)
      if (match === null) continue
      max = Math.max(max, Number.parseInt(match[1]!, 10))
      if (match[2] === stamp) sameSecond = Math.max(sameSecond, Number.parseInt(match[3] ?? '1', 10))
    }
  }
  const base = String(max + 1).padStart(3, '0') + '-' + stamp
  return sameSecond === 0 ? base : base + '-a' + (sameSecond + 1)
}

function formatStamp(timestamp: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return pad(timestamp.getFullYear(), 4) + pad(timestamp.getMonth() + 1) + pad(timestamp.getDate())
    + '-' + pad(timestamp.getHours()) + pad(timestamp.getMinutes()) + pad(timestamp.getSeconds())
}

/** Write one archive atomically and append the index line. Throws on fs failure. */
export async function writeArchive(options: {
  root: string
  sessionId: string
  summary: string
  conversation: string
  timestamp: Date
  measuredTokens: number
  routedModel: string
}): Promise<ArchiveWriteResult> {
  const sessionDir = join(options.root, options.sessionId)
  const dirName = nextArchiveName(sessionDir, options.timestamp)
  const finalDir = join(sessionDir, dirName)
  const tempDir = join(sessionDir, '.' + dirName + '.tmp')
  mkdirSync(tempDir, { recursive: true })
  writeFileSync(join(tempDir, 'handoff.md'), options.summary.trim() + '\n')
  writeFileSync(join(tempDir, 'conversation.md'), options.conversation)
  renameSync(tempDir, finalDir)
  appendIndexLine(sessionDir, {
    timestamp: options.timestamp, dirName,
    measuredTokens: options.measuredTokens, routedModel: options.routedModel,
  })
  return { dirName, dirAbs: finalDir }
}

function appendIndexLine(
  sessionDir: string,
  line: { timestamp: Date; dirName: string; measuredTokens: number; routedModel: string },
): void {
  mkdirSync(sessionDir, { recursive: true })
  const index = join(sessionDir, 'index.md')
  if (!existsSync(index)) {
    writeFileSync(index, '# Handoff archive index\n\n| timestamp | directory | condensed | model |\n|---|---|---|---|\n')
  }
  const appended = '| ' + line.timestamp.toISOString() + ' | ' + line.dirName
    + ' | ~' + line.measuredTokens + ' tokens | ' + line.routedModel + ' |\n'
  writeFileSync(index, readFileSync(index, 'utf8') + appended)
}

/** Ensure <rootRel>/ is in .git/info/exclude; idempotent; false when no repo. */
export function ensureGitExclude(workspaceRoot: string, rootRel: string): boolean {
  const gitDir = join(workspaceRoot, '.git')
  if (!existsSync(gitDir)) return false
  const infoDir = join(gitDir, 'info')
  const excludeFile = join(infoDir, 'exclude')
  const entry = rootRel.replace(/[\\/]+$/, '') + '/'
  const existing = existsSync(excludeFile) ? readFileSync(excludeFile, 'utf8') : ''
  if (existing.split(/\r?\n/).some(line => line.trim() === entry)) return true
  mkdirSync(infoDir, { recursive: true })
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
  writeFileSync(excludeFile, existing + prefix + '# added by compaction-handoff\n' + entry + '\n')
  return true
}
