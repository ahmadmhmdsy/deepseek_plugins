## Task 5: Archive module (archive.ts)

**Files:** `compaction-handoff/src/archive.ts`; test `compaction-handoff/tests/archive.spec.ts`.

- [ ] **Step 5.1: Failing tests.**

```ts
// compaction-handoff/tests/archive.spec.ts
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createUserMessage, createMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SummarizationInput } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import {
  ensureGitExclude, nextArchiveName, renderConversation, renderPointerText, writeArchive,
} from '../src/archive.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-archive-'))
  dirs.push(dir)
  return join(dir, 'handoffs')
}

function input(): SummarizationInput {
  const callId = ToolCallId('call-1')
  return {
    system: 'You are a helpful assistant.',
    messages: [
      createUserMessage({ content: [{ type: 'text', text: 'user question' }], source: { kind: 'user' } }),
      createMessage({
        role: 'assistant',
        content: [
          { type: 'text', text: 'thinking' },
          { type: 'tool-call', id: callId, name: 'read', arguments: '{"path":"a.ts"}' },
        ],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      }),
      createToolResultMessage({ callId, content: [{ type: 'text', text: 'file body' }], isError: false }),
    ],
  }
}

describe('renderConversation', () => {
  it('renders role headers, inline text, fenced tool blocks', () => {
    const md = renderConversation(input(), {
      sessionId: 'sess-1', timestamp: new Date('2026-09-10T12:00:00Z'),
      routedModel: 'deepseek/deepseek-chat', measuredTokens: 1234,
    })
    expect(md).toContain('# Conversation archive — sess-1')
    expect(md).toContain('routed model: deepseek/deepseek-chat')
    expect(md).toContain('measured tokens: 1234')
    expect(md).toContain('## user')
    expect(md).toContain('user question')
    expect(md).toContain('## assistant')
    expect(md).toContain('```tool-call read')
    expect(md).toContain('```tool-result')
    expect(md).toContain('file body')
  })
  it('replaces unknown block types with a fenced placeholder', () => {
    const md = renderConversation({
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'unknown-thing' } as never],
        source: { kind: 'model', provider: 'p', model: 'm' },
      })],
    }, { sessionId: 's', timestamp: new Date(), routedModel: 'p/m', measuredTokens: 1 })
    expect(md).toContain('```unknown-block')
  })
})

describe('nextArchiveName + writeArchive', () => {
  it('continues the ordinal from existing dirs and counts same-second attempts', () => {
    const root = tempRoot()
    const sessionDir = join(root, 'sess-1')
    mkdirSync(join(sessionDir, '001-20260910-100000'), { recursive: true })
    mkdirSync(join(sessionDir, '002-20260910-100000-a2'), { recursive: true })
    expect(nextArchiveName(sessionDir, new Date(2026, 8, 10, 10, 0, 0))).toBe('003-20260910-100000-a3')
  })
  it('writes conversation.md + handoff.md atomically and appends an index line', async () => {
    const root = tempRoot()
    const result = await writeArchive({
      root, sessionId: 'sess-1', summary: 'HANDOFF BODY', conversation: 'CONV BODY',
      timestamp: new Date(2026, 8, 10, 12, 30, 0), measuredTokens: 999, routedModel: 'deepseek/deepseek-chat',
    })
    const files = readdirSync(join(root, 'sess-1', result.dirName))
    expect(files.sort()).toEqual(['conversation.md', 'handoff.md'])
    expect(readFileSync(join(root, 'sess-1', result.dirName, 'handoff.md'), 'utf8')).toContain('HANDOFF BODY')
    expect(readFileSync(join(root, 'sess-1', 'index.md'), 'utf8'))
      .toContain('| ' + result.dirName + ' | ~999 tokens | deepseek/deepseek-chat')
    expect(readdirSync(join(root, 'sess-1')).every(n => !n.includes('.tmp'))).toBe(true)
  })
  it('does not clobber an existing directory of the same second (attempt suffix)', async () => {
    const root = tempRoot()
    const first = await writeArchive({
      root, sessionId: 's', summary: 'a', conversation: 'a', timestamp: new Date(0),
      measuredTokens: 1, routedModel: 'p/m',
    })
    const second = await writeArchive({
      root, sessionId: 's', summary: 'b', conversation: 'b', timestamp: new Date(0),
      measuredTokens: 1, routedModel: 'p/m',
    })
    expect(second.dirName).not.toBe(first.dirName)
  })
})

describe('renderPointerText', () => {
  it('formats the archive pointer paragraph', () => {
    const text = renderPointerText('.dsh/handoffs/sess-1/001-20260910-120000')
    expect(text).toContain('**Handoff archive:**')
    expect(text).toContain('.dsh/handoffs/sess-1/001-20260910-120000/conversation.md')
    expect(text).toContain('read those files before proceeding')
  })
})

describe('ensureGitExclude', () => {
  it('appends the root once and is idempotent', () => {
    const repo = mkdtempSync(join(tmpdir(), 'handoff-git-'))
    dirs.push(repo)
    mkdirSync(join(repo, '.git', 'info'), { recursive: true })
    expect(ensureGitExclude(repo, '.dsh/handoffs')).toBe(true)
    expect(ensureGitExclude(repo, '.dsh/handoffs')).toBe(true)
    const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude.match(/\.dsh\/handoffs\/$/g)?.length).toBe(1)
  })
  it('skips silently without a repo', () => {
    const noRepo = mkdtempSync(join(tmpdir(), 'handoff-nogit-'))
    dirs.push(noRepo)
    expect(ensureGitExclude(noRepo, '.dsh/handoffs')).toBe(false)
  })
})
```

- [ ] **Step 5.2: Run → FAIL, then implement.**

```ts
// compaction-handoff/src/archive.ts
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
```

If the fork's `ContentBlock` union names image blocks differently, adjust `renderBlock`'s cases against `packages/llm/llm/src/types.ts` — the placeholder behavior is what matters. The engine also calls `ensureGitExclude` once per compaction (Task 7) with workspace root = process cwd.

- [ ] **Step 5.3: Run → PASS.**
- [ ] **Step 5.4: Commit** (if git): `feat(handoff): atomic handoff archive writer with index and git hygiene`.

---


