/**
 * Shared validator for handoff-config.json — the single store used by the
 * engine, the /compact-config command, and the web card (spec §4, §7, §8).
 *
 * @module compaction-handoff/config
 */
import { deepFreeze } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { HandoffConfig, ModelPreset, ResolvedHandoffConfig, RetainConfig } from './types.ts'

const TRIGGER_KEYS = new Set(['mode', 'ratio', 'tokens'])
const RETAIN_KEYS = new Set(['ratio', 'tokens'])
const ARCHIVE_KEYS = new Set(['root', 'gitExclude', 'onFailure'])
const SUMMARIZATION_KEYS = new Set(['provider', 'model', 'maxTokens'])
const RETRIES_KEYS = new Set(['compactionRetries', 'maxOverflowRetries'])
const MODEL_KEYS = new Set(['provider', 'model', 'trigger', 'retain', 'summarization', 'retries', 'disabled'])
const TOP_KEYS = new Set(['trigger', 'retain', 'archive', 'summarization', 'retries', 'auto', 'enabled', 'models'])

/** Validate an untrusted raw document and resolve defaults (fail-fast). */
export function parseHandoffConfig(raw: unknown): ResolvedHandoffConfig {
  const config = assertObject(raw, 'handoff config')
  validateKeys(config, TOP_KEYS, 'handoff config')

  const trigger = config.trigger === undefined ? {} : validateTrigger(config.trigger, 'trigger')
  const retain = config.retain === undefined ? {} : validateRetain(config.retain, 'retain')
  const archive = validateArchive(config.archive ?? {}, 'archive')
  const summarization = validateSummarization(config.summarization ?? {}, 'summarization')
  const retries = validateRetries(config.retries ?? {}, 'retries')
  const models = validateModels(config.models)
  if (config.auto !== undefined && typeof config.auto !== 'boolean') {
    throw new Error('handoff config: auto must be a boolean')
  }
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new Error('handoff config: enabled must be a boolean')
  }
  // Absolute-only contradiction is decidable at load (A1): the fire-at level and
  // the kept tail are both absolute, so retain >= trigger can never resolve.
  // Ratio-based pairs stay decidable only per model window; resolveHandoffSpec
  // clamps those instead of poisoning every pre-step with an unresolved throw.
  if (trigger.tokens !== undefined && retain.tokens !== undefined && retain.tokens >= trigger.tokens) {
    throw new Error(
      'handoff config: retain.tokens (' + retain.tokens + ') must be less than trigger.tokens (' + trigger.tokens + ')',
    )
  }
  if (trigger.ratio !== undefined && retain.ratio !== undefined && retain.ratio >= trigger.ratio) {
    throw new Error('handoff config: retain.ratio (' + retain.ratio + ') must be less than trigger.ratio (' + trigger.ratio + ')')
  }

  return deepFreeze({
    trigger: {
      mode: trigger.mode ?? 'first',
      ...(trigger.ratio === undefined ? {} : { ratio: trigger.ratio }),
      ...(trigger.tokens === undefined ? {} : { tokens: trigger.tokens }),
    },
    retain,
    archive,
    summarization,
    retries,
    auto: config.auto ?? true,
    enabled: config.enabled ?? true,
    models,
  })
}

/**
 * Map a resolved handoff config onto the upstream BasicCompactionConfig shape for super().
 * The parent validates a retain ratio against its own resolved threshold ratio; with an
 * absolute-only trigger the handoff threshold is NOT the parent's ratio semantics (the
 * subclass override owns pressure), so a window-relative retain must not leak into the
 * parent's ratio invariant — it is omitted and the subclass clamps at resolve time.
 */
export function toBasicConfig(resolved: ResolvedHandoffConfig): Record<string, unknown> {
  const retainRatio = resolved.retain.ratio !== undefined
    && resolved.trigger.ratio !== undefined
    && resolved.retain.ratio < resolved.trigger.ratio
    ? resolved.retain.ratio
    : undefined
  return {
    thresholdRatio: resolved.trigger.ratio,
    retainRatio,
    retainTokens: resolved.retain.tokens,
    summarizationProvider: resolved.summarization.provider,
    summarizationModel: resolved.summarization.model,
    maxTokens: resolved.summarization.maxTokens,
    compactionRetries: resolved.retries.compactionRetries,
    maxOverflowRetries: resolved.retries.maxOverflowRetries,
    modelPolicies: resolved.models.map(model => ({
      provider: model.provider,
      model: model.model,
      thresholdRatio: model.trigger?.ratio,
      retainRatio: model.retain?.ratio !== undefined
        && model.trigger?.ratio !== undefined
        && model.retain.ratio < model.trigger.ratio
        ? model.retain.ratio
        : undefined,
      retainTokens: model.retain?.tokens,
      summarizationProvider: model.summarization?.provider,
      summarizationModel: model.summarization?.model,
      maxTokens: model.summarization?.maxTokens,
      compactionRetries: model.retries?.compactionRetries,
      maxOverflowRetries: model.retries?.maxOverflowRetries,
    })),
    auto: resolved.auto,
  }
}

/** Find the exact provider+model preset, if any. */
export function resolvePreset(
  config: ResolvedHandoffConfig,
  target: Pick<LlmCallConfig, 'provider' | 'model'>,
): ModelPreset | undefined {
  return config.models.find(preset => preset.provider === target.provider && preset.model === target.model)
}

// ---- validation helpers (upstream config.ts style) ----

function validateKeys(config: Record<string, unknown>, keys: ReadonlySet<string>, name: string): void {
  for (const key of Object.keys(config)) {
    if (!keys.has(key)) throw new Error(name + ': unknown key "' + key + '"')
  }
}
function assertObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(name + ' must be a JSON object')
  }
  return value as Record<string, unknown>
}
function assertPositiveInteger(name: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(name + ' (' + String(value) + ') must be a positive integer')
  }
}
function assertRatio(name: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(name + ' (' + String(value) + ') must be a number in (0, 1]')
  }
}
function assertNonEmptyString(name: string, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(name + ' must be a non-empty string')
  }
}
function validateTrigger(raw: unknown, name: string): { mode?: 'first' | 'tokens'; ratio?: number; tokens?: number } {
  const config = assertObject(raw, name)
  validateKeys(config, TRIGGER_KEYS, name)
  if (config.mode !== undefined && config.mode !== 'first' && config.mode !== 'tokens') {
    throw new Error(name + '.mode ("' + String(config.mode) + '") must be "first" or "tokens"')
  }
  if (config.ratio !== undefined) assertRatio(name + '.ratio', config.ratio)
  if (config.tokens !== undefined) assertPositiveInteger(name + '.tokens', config.tokens)
  return config as { mode?: 'first' | 'tokens'; ratio?: number; tokens?: number }
}
function validateRetain(raw: unknown, name: string): RetainConfig {
  const config = assertObject(raw, name)
  validateKeys(config, RETAIN_KEYS, name)
  if (config.ratio !== undefined) assertRatio(name + '.ratio', config.ratio)
  if (config.tokens !== undefined) assertPositiveInteger(name + '.tokens', config.tokens)
  if (config.ratio !== undefined && config.tokens !== undefined) {
    throw new Error(name + '.ratio and ' + name + '.tokens are mutually exclusive')
  }
  return config as RetainConfig
}
function validateArchive(raw: unknown, name: string): ResolvedHandoffConfig['archive'] {
  const config = assertObject(raw, name)
  validateKeys(config, ARCHIVE_KEYS, name)
  const root = config.root === undefined ? '.dsh/handoffs' : config.root
  assertNonEmptyString(name + '.root', root)
  if (config.gitExclude !== undefined && typeof config.gitExclude !== 'boolean') {
    throw new Error(name + '.gitExclude must be a boolean')
  }
  if (config.onFailure !== undefined && config.onFailure !== 'block' && config.onFailure !== 'proceed') {
    throw new Error(name + '.onFailure ("' + String(config.onFailure) + '") must be "block" or "proceed"')
  }
  return {
    root: root as string,
    gitExclude: (config.gitExclude as boolean | undefined) ?? true,
    onFailure: (config.onFailure as 'block' | 'proceed' | undefined) ?? 'block',
  }
}
function validateSummarization(raw: unknown, name: string): ResolvedHandoffConfig['summarization'] {
  const config = assertObject(raw, name)
  validateKeys(config, SUMMARIZATION_KEYS, name)
  const provider = (config.provider as string | undefined) ?? ''
  const model = (config.model as string | undefined) ?? ''
  if (typeof provider !== 'string') throw new Error(name + '.provider must be a string')
  if (typeof model !== 'string') throw new Error(name + '.model must be a string')
  if ((provider.length === 0) !== (model.length === 0)) {
    throw new Error(name + '.provider and ' + name + '.model must be set together as an empty or non-empty pair')
  }
  const maxTokens = config.maxTokens === undefined ? 8192 : config.maxTokens
  assertPositiveInteger(name + '.maxTokens', maxTokens)
  return { provider, model, maxTokens: maxTokens as number }
}
function validateRetries(raw: unknown, name: string): ResolvedHandoffConfig['retries'] {
  const config = assertObject(raw, name)
  validateKeys(config, RETRIES_KEYS, name)
  const assertNonNegative = (field: string): void => {
    const value = config[field]
    if (value === undefined) return
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(name + '.' + field + ' (' + String(value) + ') must be a non-negative integer')
    }
  }
  assertNonNegative('compactionRetries')
  assertNonNegative('maxOverflowRetries')
  return {
    compactionRetries: (config.compactionRetries as number | undefined) ?? 1,
    maxOverflowRetries: (config.maxOverflowRetries as number | undefined) ?? 1,
  }
}
function validateModels(raw: unknown): ModelPreset[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new Error('handoff config: models must be an array')
  const seen = new Set<string>()
  return raw.map((entry, index) => {
    const name = 'handoff config: models[' + index + ']'
    const config = assertObject(entry, name)
    validateKeys(config, MODEL_KEYS, name)
    assertNonEmptyString(name + '.provider', config.provider)
    assertNonEmptyString(name + '.model', config.model)
    const key = String(config.provider) + '\u0000' + String(config.model)
    if (seen.has(key)) {
      throw new Error('handoff config: duplicate model preset for ' + String(config.provider) + '/' + String(config.model))
    }
    seen.add(key)
    if (config.disabled !== undefined && typeof config.disabled !== 'boolean') {
      throw new Error(name + '.disabled must be a boolean')
    }
    const preset: ModelPreset = {
      provider: config.provider as string,
      model: config.model as string,
      ...(config.trigger === undefined ? {} : { trigger: validateTrigger(config.trigger, name + '.trigger') }),
      ...(config.retain === undefined ? {} : { retain: validateRetain(config.retain, name + '.retain') }),
      ...(config.summarization === undefined ? {} : { summarization: validateSummarization(config.summarization, name + '.summarization') }),
      ...(config.retries === undefined ? {} : { retries: validateRetries(config.retries, name + '.retries') }),
      ...(config.disabled === undefined ? {} : { disabled: config.disabled as boolean }),
    }
    if (preset.trigger?.tokens !== undefined && preset.retain?.tokens !== undefined
      && preset.retain.tokens >= preset.trigger.tokens) {
      throw new Error(name + ': retain.tokens (' + preset.retain.tokens + ') must be less than trigger.tokens ('
        + preset.trigger.tokens + ')')
    }
    if (preset.trigger?.ratio !== undefined && preset.retain?.ratio !== undefined
      && preset.retain.ratio >= preset.trigger.ratio) {
      throw new Error(name + ': retain.ratio (' + preset.retain.ratio + ') must be less than trigger.ratio (' + preset.trigger.ratio + ')')
    }
    return preset
  })
}
