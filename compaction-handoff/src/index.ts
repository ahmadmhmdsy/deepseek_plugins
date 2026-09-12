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
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import type { CompactionResult, CompactionTrigger } from '@deepseek-ai/dsh-compaction'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
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

/** Token price of one surface node (both checkout token-meter shapes agree). */
interface MeterNode {
  readonly seq: number
  readonly tokens: number
}
interface MeterMeasurement {
  readonly totalTokens: number
  readonly nodes: readonly MeterNode[]
}

export class HandoffCompactionEngine extends BasicCompactionEngine {
  static inject = ['llm', 'tokenMeter', 'sessions']

  static Config: z<HandoffPluginConfig> = z.object({
    configFile: z.string(),
  })

  readonly store: HandoffConfigStore
  private readonly defaultCwd: string
  private readonly spanTokensByAgent = new WeakMap<Agent, number>()
  /** Warn-once keys for retain clamps: target@threshold:retain. */
  private readonly clampedRetainWarned = new Set<string>()

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
    retainClamped: boolean
    pluginEnabled: boolean
  } {
    const target = routedTarget(agent.session)
    const measured = (this.ctx.tokenMeter.measure(agent.session) as MeterMeasurement).totalTokens
    if (target === undefined) {
      return {
        measuredTokens: measured, thresholdTokens: Number.POSITIVE_INFINITY,
        thresholdSource: 'unrouted', disabled: false, presetMatched: false, wouldFire: false,
        retainClamped: false, pluginEnabled: this.handoffConfig.enabled,
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
      retainClamped: spec.retainClamped,
      pluginEnabled: this.handoffConfig.enabled,
    }
  }

  override async compactIfNeeded(
    agent: Agent,
    trigger: CompactionTrigger,
    signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    if (trigger === 'context-overflow') return super.compactIfNeeded(agent, trigger, signal)
    // Master switch (hot-reloaded): disabled means no pressure compaction and no
    // archive/pointer; overflow recovery keeps the parent path for session safety.
    if (!this.handoffConfig.enabled) return null
    const target = routedTarget(agent.session)
    if (target === undefined) return null
    const config = this.handoffConfig
    const preset = resolvePreset(config, target)
    if (preset?.disabled === true) return null

    const meter = this.ctx.tokenMeter
    let measurement = meter.measure(agent.session) as MeterMeasurement
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
    if (spec.retainClamped) {
      const key = target.provider + '/' + target.model + '@' + spec.thresholdTokens + ':' + spec.retainTokens
      if (!this.clampedRetainWarned.has(key)) {
        this.clampedRetainWarned.add(key)
        this.ctx.logger.warn(
          'compaction-handoff: retain exceeds the trigger for ' + target.provider + '/' + target.model
          + '; clamped the kept tail to ' + spec.retainTokens + ' of ' + spec.thresholdTokens + ' trigger tokens'
          + ' (lower retain.ratio/tokens for the full budget)',
        )
      }
    }
    if (measurement.totalTokens < spec.thresholdTokens) return null

    // Once pressure qualifies, land the model-free pass before choosing a
    // summary range, then remeasure (mirrors the parent).
    if (prune !== undefined) {
      prune.pruneSession(agent.session)
      measurement = meter.measure(agent.session) as MeterMeasurement
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
      measurement = meter.measure(agent.session) as MeterMeasurement
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
    measurement: MeterMeasurement,
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
    if (!this.handoffConfig.enabled) return super.summarize(input, agent, signal)
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
          const measurement = this.ctx.tokenMeter.measure(agent.session) as MeterMeasurement
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
