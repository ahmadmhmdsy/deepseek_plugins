## Task 7: The engine (src/index.ts) — subclass with extended pressure path

**Files:** `compaction-handoff/src/index.ts`; test `compaction-handoff/tests/engine.spec.ts`.

- [ ] **Step 7.1: Failing integration tests.** Mirror the fork's harness (verified in `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts`): raw `Context` + `LlmRuntime` + `TokenMeter` + fake `LlmAdapter` + `Session` builders. Case list (each an `it()` block):

1. `is a BasicCompactionEngine subclass`
2. `auto-fires at the absolute token threshold, archives, and puts the pointer in the checkpoint` (threshold below the fixture size, e.g. `trigger: { tokens: 600 }`; assert the archive dir + index exist and the `<compacted-summary>` user message contains `**Handoff archive:**` and `conversation.md`)
3. `does not fire below the absolute threshold`
4. `disabled preset never auto-fires` (preset for the routed model, `trigger: { tokens: 1 }`)
5. `overflow trigger delegates to the parent unchanged` (`vi.spyOn(BasicCompactionEngine.prototype, 'compactIfNeeded')`)
6. `archive failure under onFailure:block aborts compaction and leaves the surface unchanged` (place a FILE at the session dir path to block the write; expect rejects + `session.surface.nodes.length` unchanged)
7. `hot-reload: a config edit changes the next pressure check` (rewrite the file; `vi.waitFor` for the store to adopt; then `compactIfNeeded` fires)

Builders (adapted verbatim from the fork's spec — verified):

```ts
// (test helpers — engine.spec.ts)
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, createUserMessage, createMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import Session, { SessionId } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import type { Agent } from '@deepseek-ai/dsh-agent'

const MODEL = 'test-model'

class WindowAdapter extends LlmAdapter {
  constructor(private readonly contextWindow: number) { super() }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: this.contextWindow } })
  }
  override async * stream(): AsyncIterable<StreamChunk> {
    yield { type: 'text', text: 'checkpoint' } as StreamChunk
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

function conversation(turns = 4, text = 'fixture '.repeat(40).trim()): Session {
  const session = Session.create(SessionId('handoff-' + turns))
  for (let turn = 1; turn <= turns; turn += 1) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: text + ' user ' + turn }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn, step: 1 })
    if (turn === 1) {
      session.append('request/header', { header: { config: { provider: MODEL, model: MODEL } }, reason: 'initial' })
    }
    session.append('assistant/message', {
      turn, step: 1,
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

function agent(session: Session): Agent {
  return { session, options: { provider: MODEL, model: MODEL } } as Agent
}

function engine(archiveRoot: string, fileConfig: Record<string, unknown>): HandoffCompactionEngine {
  const configFile = join(archiveRoot, 'handoff-config.json')
  writeFileSync(configFile, JSON.stringify(fileConfig))
  return new HandoffCompactionEngine(createContext(1000), { configFile })
}
```

- [ ] **Step 7.2: Run → FAIL, then implement the engine.** Complete module:

```ts
// compaction-handoff/src/index.ts
/**
 * compaction-handoff — configurable auto-compact triggers (percentage and/or
 * absolute tokens), per-model presets, and a handoff archive written on every
 * compaction. Rides the existing seam by subclassing BasicCompactionEngine:
 * the pressure path of compactIfNeeded is overridden with the extended math
 * (spec §5), context-overflow delegates to the parent unchanged, and
 * summarize() wraps upstream summarizeWithLlm with archiving + pointer
 * injection (spec §6).
 *
 * @module compaction-handoff
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import type { CompactionResult, CompactionTrigger } from '@deepseek-ai/dsh-compaction'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import { TargetPressureConfigError } from '@deepseek-ai/dsh-compaction-basic/src/config.ts'
import {
  assertNoActiveCompaction, compactSurfaceRegion, selectCompactableRange,
} from '@deepseek-ai/dsh-compaction-basic/src/region.ts'
import { summarizeWithLlm } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import { parseHandoffConfig, resolvePreset, toBasicConfig } from './config.ts'
import type { ResolvedHandoffConfig } from './types.ts'
import { HandoffConfigStore } from './store.ts'
import { needsWindowFor, resolveHandoffSpec, wouldFire } from './trigger.ts'
import { summarizeWithArchive } from './summarize.ts'

/** Composition-level plugin options. */
export interface HandoffPluginConfig {
  /** Absolute or cwd-relative path of the config file. Defaults to <package parent>/handoff-config.json. */
  configFile?: string
}

/** Re-implementation of the parent module-private routedTarget helper. */
function routedTarget(session: Session): Pick<LlmCallConfig, 'provider' | 'model'> | undefined {
  const config = session.requestHeader()?.config
  if (config === undefined || config.provider.length === 0 || config.model.length === 0) return undefined
  return { provider: config.provider, model: config.model }
}

export class HandoffCompactionEngine extends BasicCompactionEngine {
  static inject = ['llm', 'tokenMeter', 'sessions']

  static Config: z<HandoffPluginConfig> = z.object({
    configFile: z.string(),
  })

  readonly store: HandoffConfigStore
  private readonly defaultCwd: string
  private readonly spanTokensByAgent = new WeakMap<Agent, number>()

  constructor(ctx: Context, config: HandoffPluginConfig = {}) {
    const filePath = resolveConfigFilePath(config)
    const raw = existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) as unknown : undefined
    // Fail-fast at plugin load (spec §9): invalid stored config rejects the plugin.
    super(ctx, toBasicConfig(parseHandoffConfig(raw ?? {})))
    this.store = new HandoffConfigStore(ctx, filePath, raw)
    this.defaultCwd = process.cwd()
  }

  /** The live resolved configuration (hot-reloaded by the store watcher). */
  get handoffConfig(): ResolvedHandoffConfig {
    return this.store.config
  }

  /** Pressure preview for /compact-config test and the web card. */
  previewPressure(agent: Agent, contextWindow?: number): {
    measuredTokens: number
    thresholdTokens: number
    thresholdSource: string
    disabled: boolean
    presetMatched: boolean
    wouldFire: boolean
  } {
    const target = routedTarget(agent.session)
    const measured = this.ctx.tokenMeter.measure(agent.session).totalTokens
    if (target === undefined) {
      return {
        measuredTokens: measured, thresholdTokens: Number.POSITIVE_INFINITY,
        thresholdSource: 'unrouted', disabled: false, presetMatched: false, wouldFire: false,
      }
    }
    const preset = resolvePreset(this.handoffConfig, target)
    const spec = resolveHandoffSpec(this.handoffConfig, preset, contextWindow)
    return {
      measuredTokens: measured,
      thresholdTokens: spec.thresholdTokens,
      thresholdSource: spec.thresholdSource,
      disabled: spec.disabled,
      presetMatched: preset !== undefined,
      wouldFire: wouldFire(spec, measured),
    }
  }

  override async compactIfNeeded(
    agent: Agent,
    trigger: CompactionTrigger,
    signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    if (trigger === 'context-overflow') return super.compactIfNeeded(agent, trigger, signal)
    const target = routedTarget(agent.session)
    if (target === undefined) return null
    const config = this.handoffConfig
    const preset = resolvePreset(config, target)
    if (preset?.disabled === true) return null

    const meter = this.ctx.tokenMeter
    let measurement = meter.measure(agent.session)
    const prune = this.ctx.get('toolResultPruner')

    // Resolve capacity only when a ratio-based field is in play (spec §5).
    const windowed = needsWindowFor(config, preset)
    let contextWindow: number | undefined
    if (windowed) {
      const context = (await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal)).context
      assertNoActiveCompaction(agent.session, 'automatic pressure compaction')
      if (context === undefined) {
        throw new TargetPressureConfigError(
          target.provider + '/' + target.model,
          'compaction-handoff: no context capacity for ' + target.provider + '/' + target.model
          + '; configure contextWindow on that adapter model',
        )
      }
      contextWindow = context.contextWindow
    } else {
      assertNoActiveCompaction(agent.session, 'automatic pressure compaction')
    }
    const spec = resolveHandoffSpec(config, preset, contextWindow)
    if (measurement.totalTokens < spec.thresholdTokens) return null

    // Once pressure qualifies, land the model-free pass before choosing a
    // summary range, then remeasure (mirrors the parent).
    if (prune !== undefined) {
      prune.pruneSession(agent.session)
      measurement = meter.measure(agent.session)
    }
    if (measurement.totalTokens < spec.thresholdTokens) return null

    let result: CompactionResult | null = null
    for (let attempt = 0; attempt <= spec.compactionRetries; attempt += 1) {
      const range = selectCompactableRange(agent.session, measurement, spec.retainTokens)
      if (range === null) {
        if (result === null) return null
        break
      }
      this.stashSpanTokens(agent, measurement, range.start, range.end)
      result = await this.compactRegion(range.start, range.end, agent, signal)
      measurement = meter.measure(agent.session)
      if (measurement.totalTokens < spec.thresholdTokens) return result
    }

    throw new Error(
      'compaction still above threshold after ' + (spec.compactionRetries + 1)
      + ' compaction attempts (' + measurement.totalTokens + ' estimated tokens >= threshold '
      + spec.thresholdTokens + ')',
    )
  }

  /** Priced tokens of the [start, end] span, remembered for the archive header. */
  private stashSpanTokens(
    agent: Agent,
    measurement: { nodes: readonly { seq: number; tokens: number }[] },
    start: number,
    end: number,
  ): void {
    let total = 0
    for (const node of measurement.nodes) {
      if (node.seq >= start && node.seq <= end) total += node.tokens
    }
    this.spanTokensByAgent.set(agent, total)
  }

  protected override async summarize(
    input: SummarizationInput,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<SummaryResult> {
    const routed = routedTarget(agent.session)
    const target = routed
      ?? (agent.options.provider !== undefined && agent.options.provider.length > 0
        && agent.options.model !== undefined && agent.options.model.length > 0
        ? { provider: agent.options.provider, model: agent.options.model }
        : undefined)
    return summarizeWithArchive({
      ctx: this.ctx,
      config: this.handoffConfig,
      summarizer: summarizeWithLlm,
      spanTokens: (a: Agent) => this.spanTokensByAgent.get(a) ?? estimateTokens(input),
      routedModel: target === undefined ? 'unknown' : target.provider + '/' + target.model,
      cwd: this.defaultCwd,
    }, input, agent, signal)
  }

  /** Copy of the parent compactNow with inline region dependencies + span stash. */
  override async compactNow(
    agent: Parameters<BasicCompactionEngine['compactNow']>[0],
    signal: AbortSignal,
    sourceCommandId?: CommandId,
  ): Promise<CompactionResult | null> {
    signal.throwIfAborted()
    try {
      return agent.runMaintenance(async (agentSignal) => {
        const operationSignal = AbortSignal.any([agentSignal, signal])
        try {
          operationSignal.throwIfAborted()
          const measurement = this.ctx.tokenMeter.measure(agent.session)
          const range = selectCompactableRange(agent.session, measurement, 0)
          if (range === null) return null
          this.stashSpanTokens(agent, measurement, range.start, range.end)
          return await compactSurfaceRegion(
            {
              meter: this.ctx.tokenMeter,
              summarize: (input, owner, abort) => this.summarize(input, owner, abort),
            },
            agent.session,
            range.start,
            range.end,
            agent,
            {
              owner: null,
              stability: 'selected-span',
              ...(sourceCommandId === undefined ? {} : { sourceCommandId }),
              flush: async () => { await this.ctx.sessions.flush(agent.session) },
            },
            operationSignal,
          )
        } catch (error: unknown) {
          if (agentSignal.aborted && operationSignal.reason === agentSignal.reason) {
            throw new ManualCompactionError('cancelled', 'manual compaction was cancelled', { cause: error })
          }
          operationSignal.throwIfAborted()
          throw error
        }
      })
    } catch (error: unknown) {
      throw new ManualCompactionError('busy', 'manual compaction requires an idle agent with no waking queued work', { cause: error })
    }
  }

  dispose(): void {
    this.store.dispose()
  }
}

function resolveConfigFilePath(config: HandoffPluginConfig): string {
  if (config.configFile !== undefined) {
    return isAbsolute(config.configFile) ? config.configFile : resolve(process.cwd(), config.configFile)
  }
  // Default: <deepseek_plugins>/handoff-config.json (next to the package folder).
  const here = fileURLToPath(import.meta.url)
  return resolve(dirname(here), '..', '..', 'handoff-config.json')
}

/** Character-heuristic fallback when no span price is known (documented estimate). */
function estimateTokens(input: SummarizationInput): number {
  let chars = 0
  for (const message of input.messages) {
    for (const block of message.content) {
      if (block.type === 'text') chars += block.text.length
    }
  }
  return Math.ceil(chars / 4)
}

export default HandoffCompactionEngine
```

Notes:
- The fork mounts class plugins from the **default export** (that is how `@deepseek-ai/dsh-compaction-basic` itself is composed — its index has `export default BasicCompactionEngine` and no apply).
- Hot-reload scope (documented in Task 14 docs): trigger/retain/archive/disabled/summarization/compactionRetries hot-reload; `maxOverflowRetries` stays load-time (the parent's overflow branch reads its once-built `this.config`).
- If the fork's `token-meter` measure type makes the `measurement` parameter type awkward, type it as `ReturnType<import('@deepseek-ai/dsh-token-meter').TokenMeter['measure']>`.

- [ ] **Step 7.3: Run → PASS** (fix fork-specific type nits as they surface; do not weaken assertions).
- [ ] **Step 7.4: Commit** (if git): `feat(handoff): HandoffCompactionEngine with extended triggers and archiving`.

---


