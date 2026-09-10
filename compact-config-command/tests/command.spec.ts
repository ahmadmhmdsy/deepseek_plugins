import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import HandoffCompactionEngine from '../../compaction-handoff/src/index.ts'
import { apply } from '../src/index.ts'

const dirs: string[] = []
const engines: HandoffCompactionEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface RegisteredCommand {
  name: string
  description: string
  handler: (invocation: CommandInvocation) => Promise<CommandResult>
}

function setup(fileConfig: Record<string, unknown>): {
  ctx: Context
  handler: (invocation: CommandInvocation) => Promise<CommandResult>
  engine: HandoffCompactionEngine
  configFile: string
} {
  const dir = mkdtempSync(join(tmpdir(), 'compact-config-cmd-'))
  dirs.push(dir)
  const configFile = join(dir, 'handoff-config.json')
  writeFileSync(configFile, JSON.stringify(fileConfig))
  const realCtx = new Context()
  void new LlmRuntime(realCtx)
  void new TokenMeter(realCtx)
  const engineInstance = new HandoffCompactionEngine(realCtx, { configFile })
  engines.push(engineInstance)
  const registered: RegisteredCommand[] = []
  const ctx = {
    effect: (factory: () => Generator): void => { void factory().next() },
    commands: {
      register: (spec: RegisteredCommand): Promise<unknown> => {
        registered.push(spec)
        return Promise.resolve(undefined)
      },
    },
    compaction: engineInstance,
    llm: realCtx.llm,
  } as never as Context
  apply(ctx)
  expect(registered).toHaveLength(1)
  return { ctx, handler: registered[0]!.handler, engine: engineInstance, configFile }
}

function invocation(rawInput: string): CommandInvocation {
  return {
    agent: { session: { id: 'sess-x', requestHeader: () => undefined }, options: {} } as never as Agent,
    signal: new AbortController().signal,
    commandId: 'test-command' as never,
    rawInput,
  } as CommandInvocation
}

describe('/compact-config handler', () => {
  it('show reports the effective config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'compact-config-cmd-root-'))
    dirs.push(root)
    const { handler } = setup({ trigger: { tokens: 100 }, retain: { tokens: 10 }, archive: { root } })
    const result = await handler(invocation('show'))
    expect(result.kind).toBe('success')
    expect(result.text).toContain('trigger:')
    expect(result.text).toContain('{"mode":"first","tokens":100}')
  })

  it('set tokens 100 persists and the engine adopts it', async () => {
    const { handler, engine, configFile } = setup({ retain: { tokens: 10 } })
    const result = await handler(invocation('set tokens 100'))
    expect(result.kind).toBe('success')
    expect(JSON.parse(readFileSync(configFile, 'utf8')).trigger.tokens).toBe(100)
    await vi.waitFor(() => { expect(engine.handoffConfig.trigger.tokens).toBe(100) })
  })

  it('preset add p m tokens 5 lands on disk', async () => {
    const { handler, configFile } = setup({})
    const result = await handler(invocation('preset add p m tokens 5'))
    expect(result.kind).toBe('success')
    const raw = JSON.parse(readFileSync(configFile, 'utf8'))
    expect(raw.models).toHaveLength(1)
    expect(raw.models[0]).toMatchObject({ provider: 'p', model: 'm', trigger: { tokens: 5 } })
  })

  it('invalid set rejects with usage text and leaves the file untouched', async () => {
    const { handler, configFile } = setup({ trigger: { tokens: 7 }, retain: { tokens: 3 } })
    const before = readFileSync(configFile, 'utf8')
    const result = await handler(invocation('set tokens -1'))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('trigger.tokens')
    expect(result.text).toContain('Usage: /compact-config')
    expect(readFileSync(configFile, 'utf8')).toBe(before)
  })
})
