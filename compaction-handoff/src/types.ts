/** Configuration vocabulary for the compaction-handoff plugins (spec §4). */

export type TriggerMode = 'first' | 'tokens'

export interface TriggerConfig {
  /** Combination rule when both limits are set. Defaults to "first". */
  mode?: TriggerMode
  /** Fraction of the routed model context window; (0, 1]. */
  ratio?: number
  /** Absolute token count trigger; positive integer. */
  tokens?: number
}

export interface RetainConfig {
  /** Kept-verbatim tail as a fraction of the window. Mutually exclusive with tokens. */
  ratio?: number
  /** Kept-verbatim tail in tokens. Mutually exclusive with ratio. */
  tokens?: number
}

export interface ArchiveConfig {
  /** Archive root; relative resolves against the harness process cwd. Default ".dsh/handoffs". */
  root?: string
  /** Ensure <root>/ is listed in .git/info/exclude when a repo exists. Default true. */
  gitExclude?: boolean
  /** "block" (default) aborts compaction when archiving fails; "proceed" warns and continues. */
  onFailure?: 'block' | 'proceed'
}

export interface SummarizationConfig {
  /** Summary provider; set together with model (pair rule like upstream). */
  provider?: string
  /** Summary model; set together with provider. */
  model?: string
  /** Provider generation cap. Default 8192. */
  maxTokens?: number
}

export interface RetriesConfig {
  /** Extra compaction attempts while pressure remains. Default 1. */
  compactionRetries?: number
  /** Overflow recovery retries (load-time only). Default 1. */
  maxOverflowRetries?: number
}

export interface ModelPreset {
  /** Exact provider route to match. */
  provider: string
  /** Exact routed model id to match. */
  model: string
  trigger?: TriggerConfig
  retain?: RetainConfig
  summarization?: SummarizationConfig
  retries?: RetriesConfig
  /** true disables auto-compact for this model; manual compaction is unaffected. */
  disabled?: boolean
}

export interface HandoffConfig {
  trigger?: TriggerConfig
  retain?: RetainConfig
  archive?: ArchiveConfig
  summarization?: SummarizationConfig
  retries?: RetriesConfig
  auto?: boolean
  /** Per-model presets; exact provider+model match, field-wise merge over globals. */
  models?: ModelPreset[]
}

/** Validated immutable configuration (deep-frozen by the caller). */
export interface ResolvedHandoffConfig {
  trigger: { mode: 'first' | 'tokens'; ratio?: number; tokens?: number }
  retain: RetainConfig
  archive: { root: string; gitExclude: boolean; onFailure: 'block' | 'proceed' }
  summarization: { provider: string; model: string; maxTokens: number }
  retries: { compactionRetries: number; maxOverflowRetries: number }
  auto: boolean
  models: ModelPreset[]
}
