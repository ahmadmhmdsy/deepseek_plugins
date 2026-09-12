import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, createUserMessage, createMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import type { Agent } from '@deepseek-ai/dsh-agent'
import HandoffCompactionEngine from '../src/index.ts'

const SIGNAL = new AbortController().signal
const MODEL = 'test-model'
const SESSION_ID = 'conversation-4'

class WindowAdapter extends LlmAdapter {
  constructor(private readonly contextWindow: number) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: this.contextWindow },
    })
  }

  override async * stream(): AsyncIterable<StreamChunk> {
    // Stream chunks are deltas (the full-text chunk is a message block, not a
    // stream chunk); 'text-delta' is valid on both target checkouts.
    yield { type: 'text-delta', index: 0, text: 'checkpoint' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function createContext(window = 1000): Context {
  const ctx = new Context()
  void new LlmRuntime(ctx)
  void new TokenMeter(ctx)
  ctx.llm.registerAdapter([MODEL, 'actual', 'unlisted-provider'], new WindowAdapter(window))
  return ctx
}

function agent(session: Session): Agent {
  return { session, options: { provider: MODEL, model: MODEL } } as Agent
}

/** Closed two-message turns followed by one open turn (fork fixture). */
function conversation(turns = 4, text = 'fixture '.repeat(40).trim()): Session {
  const session = Session.create(SessionId('conversation-' + turns))
  for (let turn = 1; turn <= turns; turn += 1) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: text + ' user ' + turn }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn, step: 1 })
    if (turn === 1) {
      session.append('request/header', {
        header: { config: { provider: MODEL, model: MODEL } },
        reason: 'initial',
      })
    }
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: text + ' assistant ' + turn }],
        source: { kind: 'model', provider: MODEL, model: MODEL },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  session.append('turn/start', { turn: turns + 1 })
  return session
}

const dirs: string[] = []
const engines: HandoffCompactionEngine[] = []
afterEach(() => {
  for (const created of engines.splice(0)) created.dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-engine-'))
  dirs.push(dir)
  return dir
}

function engine(archiveRoot: string, fileConfig: Record<string, unknown>): HandoffCompactionEngine {
  const configFile = join(archiveRoot, 'handoff-config.json')
  writeFileSync(configFile, JSON.stringify(fileConfig))
  const created = new HandoffCompactionEngine(createContext(1000), { configFile })
  engines.push(created)
  return created
}

function headText(session: Session): string {
  const head = session.deriveMessages()[0]!
  return head.content.map(block => block.type === 'text' ? block.text : '').join('')
}

function archiveNames(root: string, sessionId: string): string[] {
  return existsSync(join(root, sessionId)) ? readdirSync(join(root, sessionId)) : []
}

describe('HandoffCompactionEngine', () => {
  it('is a BasicCompactionEngine subclass with the parent service contract', () => {
    expect(HandoffCompactionEngine.prototype instanceof BasicCompactionEngine).toBe(true)
    expect(HandoffCompactionEngine.inject).toEqual(BasicCompactionEngine.inject)
  })

  it('auto-fires at the absolute token threshold, archives, and puts the pointer in the checkpoint', async () => {
    const root = tempRoot()
    const compact = engine(root, {
      trigger: { tokens: 500 }, retain: { tokens: 100 }, archive: { root },
    })
    const session = conversation(4)
    const result = await compact.compactIfNeeded(agent(session), 'pressure', SIGNAL)
    expect(result).not.toBeNull()

    const entries = archiveNames(root, SESSION_ID)
    expect(entries).toContain('index.md')
    const archiveDir = entries.find(name => /^\d{3}-/.test(name))
    expect(archiveDir).toBeDefined()
    const files = readdirSync(join(root, SESSION_ID, archiveDir!)).sort()
    expect(files).toEqual(['conversation.md', 'handoff.md'])
    const index = readFileSync(join(root, SESSION_ID, 'index.md'), 'utf8')
    expect(index).toContain(archiveDir!)
    expect(index).toContain('test-model/test-model')

    const text = headText(session)
    expect(text).toContain('<compacted-summary>')
    expect(text).toContain('**Handoff archive:**')
    expect(text).toContain('/conversation.md')
  })

  it('does not fire below the absolute threshold', async () => {
    const root = tempRoot()
    const compact = engine(root, {
      trigger: { tokens: 500 }, retain: { tokens: 100 }, archive: { root },
    })
    const session = conversation(1)
    await expect(compact.compactIfNeeded(agent(session), 'pressure', SIGNAL)).resolves.toBeNull()
    expect(archiveNames(root, 'conversation-1')).toEqual([])
  })

  it('disabled preset never auto-fires', async () => {
    const root = tempRoot()
    const compact = engine(root, {
      trigger: { tokens: 500 }, retain: { tokens: 100 },
      models: [{ provider: MODEL, model: MODEL, disabled: true }],
      archive: { root },
    })
    const session = conversation(4)
    await expect(compact.compactIfNeeded(agent(session), 'pressure', SIGNAL)).resolves.toBeNull()
    expect(archiveNames(root, SESSION_ID)).toEqual([])
  })

  it('overflow trigger delegates to the parent unchanged', async () => {
    const root = tempRoot()
    const compact = engine(root, {
      trigger: { tokens: 500 }, retain: { tokens: 100 }, archive: { root },
    })
    const parentSpy = vi.spyOn(BasicCompactionEngine.prototype, 'compactIfNeeded')
      .mockResolvedValue(null)
    try {
      const session = conversation(1)
      const sessionAgent = agent(session)
      await expect(compact.compactIfNeeded(sessionAgent, 'context-overflow', SIGNAL))
        .resolves.toBeNull()
      expect(parentSpy).toHaveBeenCalledTimes(1)
      expect(parentSpy).toHaveBeenCalledWith(sessionAgent, 'context-overflow', SIGNAL)
      expect(archiveNames(root, 'conversation-1')).toEqual([])
    } finally {
      parentSpy.mockRestore()
    }
  })

  it('archive failure under onFailure:block aborts compaction and leaves the surface unchanged', async () => {
    const root = tempRoot()
    const compact = engine(root, {
      trigger: { tokens: 500 }, retain: { tokens: 100 }, archive: { root },
    })
    const session = conversation(4)
    // A plain file where the session archive directory must be created blocks the write.
    writeFileSync(join(root, SESSION_ID), 'blocked')
    const nodesBefore = session.surface.nodes.length
    const generationBefore = session.surface.replaceGeneration
    await expect(compact.compactIfNeeded(agent(session), 'pressure', SIGNAL)).rejects.toThrow()
    expect(session.surface.nodes.length).toBe(nodesBefore)
    expect(session.surface.replaceGeneration).toBe(generationBefore)
  })

  it('hot-reload: a config edit changes the next pressure check', async () => {
    const root = tempRoot()
    // The 4-turn fixture keeps the shadowed span well above the framed
    // checkpoint price (the shrink guard rejects tiny spans).
    const compact = engine(root, {
      trigger: { tokens: 6000 }, retain: { tokens: 50 }, archive: { root },
    })
    const session = conversation(4)
    await expect(compact.compactIfNeeded(agent(session), 'pressure', SIGNAL)).resolves.toBeNull()

    writeFileSync(join(root, 'handoff-config.json'), JSON.stringify({
      trigger: { tokens: 500 }, retain: { tokens: 50 }, archive: { root },
    }))
    await vi.waitFor(() => { expect(compact.handoffConfig.trigger.tokens).toBe(500) })

    await expect(compact.compactIfNeeded(agent(session), 'pressure', SIGNAL)).resolves.not.toBeNull()
    expect(archiveNames(root, SESSION_ID).length).toBeGreaterThan(0)
    expect(headText(session)).toContain('**Handoff archive:**')
  })

  it('enabled:false is the master switch: no pressure compaction, no archive', async () => {
    const root = tempRoot()
    const compact = engine(root, {
      trigger: { tokens: 500 }, retain: { tokens: 100 }, archive: { root },
      enabled: false,
    })
    const session = conversation(4)
    await expect(compact.compactIfNeeded(agent(session), 'pressure', SIGNAL)).resolves.toBeNull()
    expect(archiveNames(root, SESSION_ID)).toEqual([])
  })

  it('enabled:false still delegates context-overflow to the parent (session safety)', async () => {
    const root = tempRoot()
    const compact = engine(root, {
      trigger: { tokens: 500 }, retain: { tokens: 100 }, archive: { root },
      enabled: false,
    })
    const parentSpy = vi.spyOn(BasicCompactionEngine.prototype, 'compactIfNeeded')
      .mockResolvedValue(null)
    try {
      const session = conversation(1)
      const sessionAgent = agent(session)
      await expect(compact.compactIfNeeded(sessionAgent, 'context-overflow', SIGNAL))
        .resolves.toBeNull()
      expect(parentSpy).toHaveBeenCalledTimes(1)
      expect(parentSpy).toHaveBeenCalledWith(sessionAgent, 'context-overflow', SIGNAL)
    } finally {
      parentSpy.mockRestore()
    }
  })

  it('hot-reloaded enabled:false disables auto-compact mid-flight; re-enabling restores it', async () => {
    const root = tempRoot()
    const compact = engine(root, {
      trigger: { tokens: 500 }, retain: { tokens: 100 }, archive: { root },
    })
    const session = conversation(4)
    await expect(compact.compactIfNeeded(agent(session), 'pressure', SIGNAL)).resolves.not.toBeNull()

    writeFileSync(join(root, 'handoff-config.json'), JSON.stringify({
      trigger: { tokens: 500 }, retain: { tokens: 100 }, archive: { root }, enabled: false,
    }))
    await vi.waitFor(() => { expect(compact.handoffConfig.enabled).toBe(false) })
    await expect(compact.compactIfNeeded(agent(session), 'pressure', SIGNAL)).resolves.toBeNull()

    writeFileSync(join(root, 'handoff-config.json'), JSON.stringify({
      trigger: { tokens: 500 }, retain: { tokens: 50 }, archive: { root }, enabled: true,
    }))
    await vi.waitFor(() => { expect(compact.handoffConfig.enabled).toBe(true) })
    // Re-enable restores the trigger on a FRESH session: the earlier compaction
    // of `session` already pulled its measurement below any useful threshold.
    const session2 = conversation(4)
    await expect(compact.compactIfNeeded(agent(session2), 'pressure', SIGNAL)).resolves.not.toBeNull()
  })

  it('a window-relative retain above the resolved threshold clamps instead of poisoning (Decision A)', async () => {
    const root = tempRoot()
    // configured retain = 0.9 x 1000 = 900 >= trigger 500; clamped to 499.
    const compact = engine(root, {
      trigger: { tokens: 500 }, retain: { ratio: 0.9 }, archive: { root },
    })
    expect(compact.handoffConfig.retain.ratio).toBe(0.9)
    const session = conversation(4)
    // Whatever the underlying guard decides about the now-small span, the config
    // poison must be gone: either it compacts, the shrink guard rejects this one
    // attempt (a per-attempt, content-driven error the run loop handles by
    // continuing the turn), or no range qualifies. What may NOT happen is the
    // old per-target feign-failure silent forever-off.
    const ordered = compact.compactIfNeeded(agent(session), 'pressure', SIGNAL)
    await expect(ordered.then(() => 'compactOrEmpty' as const, error => {
      if (!/summary is not smaller|no safe range|unable/i.test(String(error))) throw error
      return 'guardRejectedThisAttempt' as const
    })).resolves.toBeDefined()
    expect(compact.previewPressure(agent(session), 1000).retainClamped).toBe(true)
  })
})
