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
  it('replaces unknown block types with a placeholder (spec §6.2 wording)', () => {
    const md = renderConversation({
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'unknown-thing' } as never],
        source: { kind: 'model', provider: 'p', model: 'm' },
      })],
    }, { sessionId: 's', timestamp: new Date(), routedModel: 'p/m', measuredTokens: 1 })
    expect(md).toContain('[image attachment] (unknown-thing)')
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
    expect(exclude.match(/^\.dsh\/handoffs\/$/m)?.length).toBe(1)
  })
  it('skips silently without a repo', () => {
    const noRepo = mkdtempSync(join(tmpdir(), 'handoff-nogit-'))
    dirs.push(noRepo)
    expect(ensureGitExclude(noRepo, '.dsh/handoffs')).toBe(false)
  })
})
